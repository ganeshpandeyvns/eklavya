/**
 * Tests for Agent Lifecycle Manager
 * Demo₄: Agent Lifecycle Management
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDatabase } from '../../lib/database.js';
import {
  AgentLifecycleManager,
  getLifecycleManager,
  initializeLifecycleManager,
} from './lifecycle.js';

describe('AgentLifecycleManager', () => {
  let manager: AgentLifecycleManager;
  let testProjectId: string;
  let testAgentId: string;

  beforeAll(async () => {
    // Initialize database connection with config
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
      ['Lifecycle Test Project', 'Testing lifecycle management']
    );
    testProjectId = projectResult.rows[0].id;

    // Create test agent
    const agentResult = await db.query<{ id: string }>(
      `INSERT INTO agents (project_id, type, status) VALUES ($1, $2, $3) RETURNING id`,
      [testProjectId, 'developer', 'idle']
    );
    testAgentId = agentResult.rows[0].id;

    // Initialize manager
    manager = initializeLifecycleManager();
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

  describe('Manager Lifecycle', () => {
    it('should start the manager', async () => {
      await manager.start();
      expect(manager.isRunning()).toBe(true);
    });

    it('should stop the manager', async () => {
      await manager.stop();
      expect(manager.isRunning()).toBe(false);
    });

    it('should get singleton instance', () => {
      const instance1 = getLifecycleManager();
      const instance2 = getLifecycleManager();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Agent Spawning', () => {
    it('should spawn an agent successfully', async () => {
      const result = await manager.spawnAgent({ agentId: testAgentId });

      expect(result.success).toBe(true);
      expect(result.processId).toBeDefined();
      expect(result.pid).toBeDefined();
      expect(typeof result.pid).toBe('number');
    });

    it('should fail to spawn non-existent agent', async () => {
      const result = await manager.spawnAgent({
        agentId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should spawn with custom working directory', async () => {
      const db = getDatabase();
      const agentResult = await db.query<{ id: string }>(
        `INSERT INTO agents (project_id, type, status) VALUES ($1, $2, $3) RETURNING id`,
        [testProjectId, 'tester', 'idle']
      );
      const agentId = agentResult.rows[0].id;

      const result = await manager.spawnAgent({
        agentId,
        workingDirectory: '/tmp/custom-test-dir',
      });

      expect(result.success).toBe(true);

      // Cleanup
      await manager.terminateAgent(agentId);
      await db.query(`DELETE FROM agents WHERE id = $1`, [agentId]);
    });

    it('should spawn with environment variables', async () => {
      const db = getDatabase();
      const agentResult = await db.query<{ id: string }>(
        `INSERT INTO agents (project_id, type, status) VALUES ($1, $2, $3) RETURNING id`,
        [testProjectId, 'architect', 'idle']
      );
      const agentId = agentResult.rows[0].id;

      const result = await manager.spawnAgent({
        agentId,
        environment: { CUSTOM_VAR: 'test_value' },
      });

      expect(result.success).toBe(true);

      // Cleanup
      await manager.terminateAgent(agentId);
      await db.query(`DELETE FROM agents WHERE id = $1`, [agentId]);
    });
  });

  describe('Agent Status', () => {
    it('should get agent process status', async () => {
      // Ensure agent is spawned
      await manager.spawnAgent({ agentId: testAgentId });

      const status = await manager.getAgentStatus(testAgentId);

      expect(status).not.toBeNull();
      expect(status?.agentId).toBe(testAgentId);
      expect(status?.agentType).toBe('developer');
      expect(status?.processStatus).toBe('running');
    });

    it('should return null for non-existent agent', async () => {
      const status = await manager.getAgentStatus('00000000-0000-0000-0000-000000000000');
      expect(status).toBeNull();
    });

    it('should get all agents for project', async () => {
      const agents = await manager.getAllAgents(testProjectId);

      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.some(a => a.agentId === testAgentId)).toBe(true);
    });

    it('should get manager status', async () => {
      const status = await manager.getManagerStatus(testProjectId);

      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('totalAgents');
      expect(status).toHaveProperty('runningAgents');
      expect(status).toHaveProperty('agents');
      expect(Array.isArray(status.agents)).toBe(true);
    });
  });

  describe('Health Monitoring', () => {
    it('should check agent health', async () => {
      const health = await manager.checkAgentHealth(testAgentId);

      expect(health).toHaveProperty('agentId', testAgentId);
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('latencyMs');
      expect(typeof health.latencyMs).toBe('number');
    });

    it('should return healthy for running agent', async () => {
      // Ensure agent is running
      await manager.spawnAgent({ agentId: testAgentId });

      const health = await manager.checkAgentHealth(testAgentId);
      expect(health.status).toBe('healthy');
    });

    it('should measure latency under threshold', async () => {
      const health = await manager.checkAgentHealth(testAgentId);
      expect(health.latencyMs).toBeLessThan(5000);
    });
  });

  describe('Resource Tracking', () => {
    it('should record resource usage', async () => {
      await manager.recordAgentResources(
        testAgentId,
        25.5,  // cpuPercent
        512.8, // memoryMb
        1500,  // tokensUsed
        10,    // apiCalls
        3      // filesModified
      );

      // Verify by getting resources
      const resources = await manager.getAgentResources(testAgentId);
      expect(resources.cpuPercent).toBeCloseTo(25.5, 1);
      expect(resources.memoryMb).toBeCloseTo(512.8, 1);
    });

    it('should get resource usage', async () => {
      const resources = await manager.getAgentResources(testAgentId);

      expect(resources).toHaveProperty('agentId', testAgentId);
      expect(resources).toHaveProperty('cpuPercent');
      expect(resources).toHaveProperty('memoryMb');
      expect(resources).toHaveProperty('tokensUsed');
      expect(resources).toHaveProperty('timestamp');
    });

    it('should get aggregate resources for project', async () => {
      const aggregate = await manager.getAggregateResources(testProjectId);

      expect(aggregate).toHaveProperty('totalTokens');
      expect(aggregate).toHaveProperty('totalApiCalls');
      expect(aggregate).toHaveProperty('avgCpu');
      expect(aggregate).toHaveProperty('agentCount');
    });
  });

  describe('Agent Termination', () => {
    it('should terminate agent gracefully', async () => {
      // Ensure agent is spawned
      await manager.spawnAgent({ agentId: testAgentId });

      const result = await manager.terminateAgent(testAgentId, true);

      expect(result.success).toBe(true);
      expect(result.checkpointSaved).toBe(true);
    });

    it('should update process status after termination', async () => {
      const status = await manager.getAgentStatus(testAgentId);
      expect(status?.processStatus).toBe('stopped');
    });

    it('should force kill agent', async () => {
      // Spawn first
      await manager.spawnAgent({ agentId: testAgentId });

      const success = await manager.forceKillAgent(testAgentId);
      expect(success).toBe(true);
    });

    it('should be idempotent for already stopped agent', async () => {
      const result = await manager.terminateAgent(testAgentId, true);
      expect(result.success).toBe(true);
    });
  });

  describe('Agent Restart', () => {
    it('should restart agent', async () => {
      // Ensure agent is spawned
      await manager.spawnAgent({ agentId: testAgentId });

      const result = await manager.restartAgent(testAgentId);

      expect(result.success).toBe(true);
      expect(result.processId).toBeDefined();
    });

    it('should have healthy status after restart', async () => {
      const health = await manager.checkAgentHealth(testAgentId);
      expect(health.status).toBe('healthy');
    });
  });

  describe('Bulk Operations', () => {
    it('should terminate all agents for project', async () => {
      const results = await manager.terminateAll(testProjectId);

      expect(Array.isArray(results)).toBe(true);
      for (const result of results) {
        expect(result.success).toBe(true);
      }
    });

    it('should spawn all idle agents for project', async () => {
      const results = await manager.spawnAllIdle(testProjectId);

      expect(Array.isArray(results)).toBe(true);
    });

    it('should garbage collect dead processes', async () => {
      const cleanedCount = await manager.garbageCollect();
      expect(typeof cleanedCount).toBe('number');
      expect(cleanedCount).toBeGreaterThanOrEqual(0);
    });
  });
});
