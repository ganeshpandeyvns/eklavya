/**
 * Tests for Task Queue
 * Core task management system
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TaskQueue } from './index.js';
import { getDatabase } from '../../lib/database.js';

describe('TaskQueue', () => {
  let taskQueue: TaskQueue;
  let testProjectId: string;
  let testAgentId: string;
  let testTaskId: string;

  beforeAll(async () => {
    // Initialize database
    const db = getDatabase({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'eklavya',
      user: process.env.DB_USER || 'eklavya',
      password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
    });
    await db.connect();

    // Create test project
    const projectResult = await db.query<{ id: string }>(
      `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING id`,
      ['TaskQueue Test Project', 'Testing task queue']
    );
    testProjectId = projectResult.rows[0].id;

    // Create test agent
    const agentResult = await db.query<{ id: string }>(
      `INSERT INTO agents (project_id, type, status) VALUES ($1, $2, $3) RETURNING id`,
      [testProjectId, 'developer', 'idle']
    );
    testAgentId = agentResult.rows[0].id;

    // Create task queue
    taskQueue = new TaskQueue({
      projectId: testProjectId,
      pollIntervalMs: 1000,
      maxConcurrent: 5,
    });
  });

  afterAll(async () => {
    await taskQueue.stop();
    const db = getDatabase();
    // Cleanup test data
    await db.query(`DELETE FROM tasks WHERE project_id = $1`, [testProjectId]);
    await db.query(`DELETE FROM agents WHERE id = $1`, [testAgentId]);
    await db.query(`DELETE FROM projects WHERE id = $1`, [testProjectId]);
    await db.close();
  });

  describe('Queue Lifecycle', () => {
    it('should create task queue instance', () => {
      expect(taskQueue).toBeDefined();
      expect(typeof taskQueue.start).toBe('function');
      expect(typeof taskQueue.stop).toBe('function');
    });

    it('should start and emit event', async () => {
      let started = false;
      taskQueue.on('started', () => { started = true; });

      await taskQueue.start();
      expect(started).toBe(true);
    });

    it('should stop and emit event', async () => {
      let stopped = false;
      taskQueue.on('stopped', () => { stopped = true; });

      await taskQueue.stop();
      expect(stopped).toBe(true);
    });
  });

  describe('Task Creation', () => {
    it('should create a task', async () => {
      const task = await taskQueue.createTask({
        projectId: testProjectId,
        title: 'Test Task',
        description: 'A test task for coverage',
        priority: 1,
      });

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe('pending');

      testTaskId = task.id;
    });

    it('should create task with dependencies', async () => {
      const task = await taskQueue.createTask({
        projectId: testProjectId,
        title: 'Dependent Task',
        dependencies: [testTaskId],
        priority: 2,
      });

      expect(task).toBeDefined();
      expect(task.title).toBe('Dependent Task');
    });
  });

  describe('Task Retrieval', () => {
    it('should get tasks with status filter', async () => {
      const tasks = await taskQueue.getTasks({ status: 'pending' });
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should get task by id', async () => {
      const task = await taskQueue.getTask(testTaskId);
      expect(task).toBeDefined();
      expect(task?.id).toBe(testTaskId);
    });

    it('should return null for non-existent task', async () => {
      const task = await taskQueue.getTask('00000000-0000-0000-0000-000000000000');
      expect(task).toBeNull();
    });
  });

  describe('Task Assignment', () => {
    it('should assign task to agent', async () => {
      // Create a new pending task for this test
      const newTask = await taskQueue.createTask({
        projectId: testProjectId,
        title: 'Task to Assign',
      });

      const result = await taskQueue.assignTask(newTask.id, testAgentId);
      expect(result).toBe(true);
    });
  });

  describe('Task Completion', () => {
    it('should complete a task', async () => {
      // Create and assign a fresh task for completion
      const newTask = await taskQueue.createTask({
        projectId: testProjectId,
        title: 'Task to Complete',
      });
      await taskQueue.assignTask(newTask.id, testAgentId);

      const result = await taskQueue.completeTask(newTask.id, { output: 'Test output' });
      expect(result).toBe(true);

      const task = await taskQueue.getTask(newTask.id);
      expect(task?.status).toBe('completed');
    });
  });

  describe('Task Failure', () => {
    it('should handle task failure', async () => {
      // Create a new task to fail
      const failTask = await taskQueue.createTask({
        projectId: testProjectId,
        title: 'Task to Fail',
        maxRetries: 1,
      });

      await taskQueue.assignTask(failTask.id, testAgentId);
      const result = await taskQueue.failTask(failTask.id, 'Test failure');

      // failTask returns an object with status, retryCount, maxRetries
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('retryCount');
      expect(result).toHaveProperty('maxRetries');
    });
  });

  describe('Queue Statistics', () => {
    it('should get queue stats', async () => {
      const stats = await taskQueue.getQueueStats();

      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('inProgress');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
    });
  });
});
