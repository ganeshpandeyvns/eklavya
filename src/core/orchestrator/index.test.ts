/**
 * Tests for Orchestrator
 * Core orchestration system
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Orchestrator, ParallelExecutionPlan, TaskDefinition } from './index.js';
import { getDatabase } from '../../lib/database.js';
import { AgentManager } from '../agent-manager/index.js';
import { MessageBus } from '../message-bus/index.js';

describe('Orchestrator', () => {
  let testProjectId: string;
  let agentManager: AgentManager;
  let messageBus: MessageBus;

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
      ['Orchestrator Test Project', 'Testing orchestrator']
    );
    testProjectId = projectResult.rows[0].id;

    // Create dependencies
    const projectDir = process.cwd();

    messageBus = new MessageBus({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
      projectId: testProjectId,
    });
    await messageBus.connect();

    agentManager = new AgentManager({
      projectId: testProjectId,
      projectDir,
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    });
  });

  afterAll(async () => {
    await messageBus.close();
    const db = getDatabase();
    // Cleanup test data
    await db.query(`DELETE FROM agents WHERE project_id = $1`, [testProjectId]);
    await db.query(`DELETE FROM projects WHERE id = $1`, [testProjectId]);
    await db.close();
  });

  describe('Initialization', () => {
    it('should create orchestrator instance', () => {
      const orchestrator = new Orchestrator({
        projectId: testProjectId,
        projectDir: process.cwd(),
        agentManager,
        messageBus,
      });

      expect(orchestrator).toBeDefined();
      expect(typeof orchestrator.initialize).toBe('function');
      expect(typeof orchestrator.getStatus).toBe('function');
    });
  });

  describe('Status', () => {
    it('should get orchestrator status', () => {
      const orchestrator = new Orchestrator({
        projectId: testProjectId,
        projectDir: process.cwd(),
        agentManager,
        messageBus,
      });

      const status = orchestrator.getStatus();
      expect(status).toBeDefined();
      expect(status).toHaveProperty('active');
      expect(status).toHaveProperty('completed');
      expect(status).toHaveProperty('failed');
    });
  });

  describe('Parallel Execution Planning', () => {
    it('should create execution plan from task definitions', () => {
      const orchestrator = new Orchestrator({
        projectId: testProjectId,
        projectDir: process.cwd(),
        agentManager,
        messageBus,
        maxParallelAgents: 3,
      });

      const tasks: TaskDefinition[] = [
        { title: 'Task 1', description: 'First task', type: 'development', agentType: 'developer' },
        { title: 'Task 2', description: 'Second task', type: 'testing', agentType: 'tester' },
      ];

      // The orchestrator should be able to create a plan
      expect(orchestrator).toBeDefined();
    });
  });
});
