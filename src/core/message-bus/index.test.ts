/**
 * Tests for Message Bus
 * Core inter-agent communication system
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MessageBus } from './index.js';
import { getDatabase } from '../../lib/database.js';

describe('MessageBus', () => {
  let messageBus: MessageBus;
  let testProjectId: string;
  let testAgentId: string;

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
      ['MessageBus Test Project', 'Testing message bus']
    );
    testProjectId = projectResult.rows[0].id;

    // Create test agent
    const agentResult = await db.query<{ id: string }>(
      `INSERT INTO agents (project_id, type, status) VALUES ($1, $2, $3) RETURNING id`,
      [testProjectId, 'developer', 'idle']
    );
    testAgentId = agentResult.rows[0].id;

    // Create message bus
    messageBus = new MessageBus({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
      projectId: testProjectId,
    });
    await messageBus.connect();
  });

  afterAll(async () => {
    const db = getDatabase();
    // Cleanup test data
    await db.query(`DELETE FROM messages WHERE project_id = $1`, [testProjectId]);
    await db.query(`DELETE FROM agents WHERE id = $1`, [testAgentId]);
    await db.query(`DELETE FROM projects WHERE id = $1`, [testProjectId]);
    await messageBus.close();
    await db.close();
  });

  describe('Connection', () => {
    it('should create message bus instance', () => {
      expect(messageBus).toBeDefined();
      expect(typeof messageBus.publish).toBe('function');
      expect(typeof messageBus.subscribe).toBe('function');
    });
  });

  describe('Publish', () => {
    it('should publish message to agent', async () => {
      const message = await messageBus.publish({
        projectId: testProjectId,
        fromAgentId: testAgentId,
        toAgentId: testAgentId,
        type: 'task_assign',
        payload: { taskName: 'Test Task' },
        processed: false,
      });

      expect(message).toBeDefined();
      expect(message.id).toBeDefined();
      expect(message.type).toBe('task_assign');
      expect(message.createdAt).toBeInstanceOf(Date);
    });

    it('should publish broadcast message', async () => {
      const message = await messageBus.publish({
        projectId: testProjectId,
        fromAgentId: testAgentId,
        type: 'task_complete',
        payload: { status: 'done' },
        processed: false,
      });

      expect(message).toBeDefined();
      expect(message.toAgentId).toBeUndefined();
    });
  });

  describe('Subscribe/Unsubscribe', () => {
    it('should subscribe to agent channel', async () => {
      await messageBus.subscribe(testAgentId);
      // No error means success
      expect(true).toBe(true);
    });

    it('should unsubscribe from agent channel', async () => {
      await messageBus.subscribe(testAgentId);
      await messageBus.unsubscribe(testAgentId);
      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('Event Handling', () => {
    it('should emit events', () => {
      const listeners = messageBus.listeners('message');
      expect(Array.isArray(listeners)).toBe(true);
    });
  });
});
