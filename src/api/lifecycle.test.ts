/**
 * Tests for Lifecycle API Endpoints
 * Demo₄: Agent Lifecycle Management
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabase } from '../lib/database.js';
import {
  initializeLifecycleManager,
  getLifecycleManager,
} from '../core/agent-manager/lifecycle.js';

// Mock HTTP request/response for API testing
interface MockRequest {
  params: Record<string, string>;
  body: Record<string, unknown>;
  query: Record<string, string>;
}

interface MockResponse {
  statusCode: number;
  data: unknown;
  status(code: number): MockResponse;
  json(data: unknown): MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.data = data;
      return this;
    },
  };
  return res;
}

describe('Lifecycle API', () => {
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
      ['API Test Project', 'Testing lifecycle API']
    );
    testProjectId = projectResult.rows[0].id;

    // Create test agent
    const agentResult = await db.query<{ id: string }>(
      `INSERT INTO agents (project_id, type, status) VALUES ($1, $2, $3) RETURNING id`,
      [testProjectId, 'developer', 'idle']
    );
    testAgentId = agentResult.rows[0].id;

    // Initialize manager
    initializeLifecycleManager();
  });

  afterAll(async () => {
    const db = getDatabase();
    // Cleanup test data
    await db.query(`DELETE FROM agent_processes WHERE agent_id = $1`, [testAgentId]);
    await db.query(`DELETE FROM agent_health_checks WHERE agent_id = $1`, [testAgentId]);
    await db.query(`DELETE FROM agent_resources WHERE agent_id = $1`, [testAgentId]);
    await db.query(`DELETE FROM agents WHERE id = $1`, [testAgentId]);
    await db.query(`DELETE FROM projects WHERE id = $1`, [testProjectId]);
    await db.close();
  });

  describe('Manager Operations', () => {
    it('should have manager available', () => {
      const manager = getLifecycleManager();
      expect(manager).toBeDefined();
    });

    it('should validate spawn parameters', async () => {
      const manager = getLifecycleManager();

      // Test with valid agent
      const result = await manager.spawnAgent({ agentId: testAgentId });
      expect(result).toHaveProperty('success');

      // Cleanup
      await manager.terminateAgent(testAgentId);
    });
  });

  describe('Agent Lifecycle Operations', () => {
    it('should spawn and track agent', async () => {
      const manager = getLifecycleManager();
      const result = await manager.spawnAgent({ agentId: testAgentId });

      expect(result.success).toBe(true);

      const status = await manager.getAgentStatus(testAgentId);
      expect(status).not.toBeNull();
      expect(status?.processStatus).toBe('running');

      // Cleanup
      await manager.terminateAgent(testAgentId);
    });

    it('should handle health check', async () => {
      const manager = getLifecycleManager();
      await manager.spawnAgent({ agentId: testAgentId });

      const health = await manager.checkAgentHealth(testAgentId);

      expect(health).toHaveProperty('agentId', testAgentId);
      expect(health).toHaveProperty('status');
      expect(['healthy', 'unhealthy', 'degraded']).toContain(health.status);

      // Cleanup
      await manager.terminateAgent(testAgentId);
    });

    it('should track resources', async () => {
      const manager = getLifecycleManager();
      await manager.spawnAgent({ agentId: testAgentId });

      // Record resources
      await manager.recordAgentResources(testAgentId, 15.5, 256.0, 500, 5, 2);

      const resources = await manager.getAgentResources(testAgentId);

      expect(resources.agentId).toBe(testAgentId);
      expect(resources.cpuPercent).toBeCloseTo(15.5, 1);
      expect(resources.memoryMb).toBeCloseTo(256.0, 1);

      // Cleanup
      await manager.terminateAgent(testAgentId);
    });

    it('should handle graceful termination', async () => {
      const manager = getLifecycleManager();
      await manager.spawnAgent({ agentId: testAgentId });

      const result = await manager.terminateAgent(testAgentId, true);

      expect(result.success).toBe(true);
      expect(result.checkpointSaved).toBe(true);
    });

    it('should handle force kill', async () => {
      const manager = getLifecycleManager();
      await manager.spawnAgent({ agentId: testAgentId });

      const result = await manager.forceKillAgent(testAgentId);

      expect(result).toBe(true);
    });
  });

  describe('Manager Status', () => {
    it('should return manager status for project', async () => {
      const manager = getLifecycleManager();

      const status = await manager.getManagerStatus(testProjectId);

      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('totalAgents');
      expect(typeof status.totalAgents).toBe('number');
    });

    it('should return all agents for project', async () => {
      const manager = getLifecycleManager();

      const agents = await manager.getAllAgents(testProjectId);

      expect(Array.isArray(agents)).toBe(true);
    });
  });

  describe('Aggregate Resources', () => {
    it('should get aggregate resources for project', async () => {
      const manager = getLifecycleManager();
      await manager.spawnAgent({ agentId: testAgentId });
      await manager.recordAgentResources(testAgentId, 20, 512, 1000, 10, 5);

      const aggregate = await manager.getAggregateResources(testProjectId);

      expect(aggregate).toHaveProperty('totalTokens');
      expect(aggregate).toHaveProperty('totalApiCalls');
      expect(aggregate).toHaveProperty('agentCount');

      // Cleanup
      await manager.terminateAgent(testAgentId);
    });
  });

  describe('Bulk Operations', () => {
    it('should terminate all agents', async () => {
      const manager = getLifecycleManager();

      const results = await manager.terminateAll(testProjectId);

      expect(Array.isArray(results)).toBe(true);
    });

    it('should spawn all idle agents', async () => {
      const manager = getLifecycleManager();

      const results = await manager.spawnAllIdle(testProjectId);

      expect(Array.isArray(results)).toBe(true);

      // Cleanup
      await manager.terminateAll(testProjectId);
    });
  });
});
