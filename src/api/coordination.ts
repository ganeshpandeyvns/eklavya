/**
 * Coordination API Endpoints
 * Demo₅: Multi-Agent Coordination
 */

import express, { Request, Response, Router } from 'express';
import { AgentCoordinator, createCoordinator, initializeCoordinator, getCoordinator } from '../core/coordination/index.js';
import type { AgentType } from '../types/index.js';

const router: Router = express.Router();

// Store coordinators per project
const coordinators: Map<string, AgentCoordinator> = new Map();

function getOrCreateCoordinator(projectId: string): AgentCoordinator {
  if (!coordinators.has(projectId)) {
    const coordinator = createCoordinator({ projectId });
    coordinators.set(projectId, coordinator);
  }
  return coordinators.get(projectId)!;
}

/**
 * POST /api/coordination/:projectId/initialize
 * Initialize coordination for a project
 */
router.post('/:projectId/initialize', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { maxConcurrentAgents } = req.body;

    const coordinator = createCoordinator({
      projectId,
      maxConcurrentAgents: maxConcurrentAgents || 10,
    });

    await coordinator.initialize();
    coordinators.set(projectId, coordinator);

    res.json({
      success: true,
      projectId,
      maxConcurrentAgents: maxConcurrentAgents || 10,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/coordination/:projectId/spawn-multiple
 * Spawn multiple agents concurrently
 */
router.post('/:projectId/spawn-multiple', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { agents } = req.body;

    if (!agents || !Array.isArray(agents)) {
      return res.status(400).json({
        success: false,
        error: 'agents array is required',
      });
    }

    const coordinator = getOrCreateCoordinator(projectId);
    const results = await coordinator.spawnAgents(agents);

    res.json({
      success: true,
      results,
      spawned: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/coordination/:projectId/agents
 * Get all active agents for a project
 */
router.get('/:projectId/agents', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const coordinator = getOrCreateCoordinator(projectId);

    const agents = await coordinator.getActiveAgents();

    res.json({
      success: true,
      agents,
      count: agents.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/coordination/:projectId/status
 * Get coordination status for a project
 */
router.get('/:projectId/status', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const coordinator = getOrCreateCoordinator(projectId);

    const status = await coordinator.getStatus();

    res.json({
      success: true,
      status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/coordination/:projectId/can-spawn
 * Check if more agents can be spawned
 */
router.get('/:projectId/can-spawn', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const coordinator = getOrCreateCoordinator(projectId);

    const result = await coordinator.canSpawnAgent();

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/coordination/:projectId/assign
 * Assign tasks to agents
 */
router.post('/:projectId/assign', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { tasks } = req.body;

    if (!tasks || !Array.isArray(tasks)) {
      return res.status(400).json({
        success: false,
        error: 'tasks array is required',
      });
    }

    const coordinator = getOrCreateCoordinator(projectId);
    const results = await coordinator.assignTasks(tasks);

    res.json({
      success: true,
      results,
      assigned: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/coordination/:projectId/route-task
 * Route a single task to the best agent
 */
router.post('/:projectId/route-task', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { taskId, preferredType } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'taskId is required',
      });
    }

    const coordinator = getOrCreateCoordinator(projectId);
    const agentId = await coordinator.routeTask(taskId, preferredType);

    res.json({
      success: !!agentId,
      agentId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/coordination/:projectId/rebalance
 * Rebalance tasks across agents
 */
router.post('/:projectId/rebalance', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const coordinator = getOrCreateCoordinator(projectId);

    const result = await coordinator.rebalance();

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/coordination/:projectId/agents/:agentId
 * Terminate an agent
 */
router.delete('/:projectId/agents/:agentId', async (req: Request, res: Response) => {
  try {
    const { projectId, agentId } = req.params;
    const coordinator = getOrCreateCoordinator(projectId);

    const success = await coordinator.terminateAgent(agentId);

    res.json({
      success,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============ FILE LOCKS ============

/**
 * POST /api/coordination/:projectId/locks/acquire
 * Acquire a file lock
 */
router.post('/:projectId/locks/acquire', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { agentId, filePath, durationMinutes } = req.body;

    if (!agentId || !filePath) {
      return res.status(400).json({
        success: false,
        error: 'agentId and filePath are required',
      });
    }

    const coordinator = getOrCreateCoordinator(projectId);
    const result = await coordinator.acquireLock(agentId, filePath, durationMinutes);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/coordination/:projectId/locks/:lockId
 * Release a file lock
 */
router.delete('/:projectId/locks/:lockId', async (req: Request, res: Response) => {
  try {
    const { projectId, lockId } = req.params;
    const { agentId } = req.body;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'agentId is required',
      });
    }

    const coordinator = getOrCreateCoordinator(projectId);
    const success = await coordinator.releaseLock(lockId, agentId);

    res.json({ success });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/coordination/:projectId/locks
 * Get all active locks
 */
router.get('/:projectId/locks', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const coordinator = getOrCreateCoordinator(projectId);

    const locks = await coordinator.getActiveLocks();

    res.json({
      success: true,
      locks,
      count: locks.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/coordination/:projectId/locks/check
 * Check if a file is locked
 */
router.post('/:projectId/locks/check', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'filePath is required',
      });
    }

    const coordinator = getOrCreateCoordinator(projectId);
    const result = await coordinator.isFileLocked(filePath);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============ CONFLICTS ============

/**
 * GET /api/coordination/:projectId/conflicts
 * Get pending conflicts
 */
router.get('/:projectId/conflicts', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const coordinator = getOrCreateCoordinator(projectId);

    const conflicts = await coordinator.getPendingConflicts();

    res.json({
      success: true,
      conflicts,
      count: conflicts.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/coordination/:projectId/conflicts/detect
 * Detect a conflict between agents
 */
router.post('/:projectId/conflicts/detect', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { agentAId, agentBId, filePath, conflictType } = req.body;

    if (!agentAId || !agentBId || !filePath || !conflictType) {
      return res.status(400).json({
        success: false,
        error: 'agentAId, agentBId, filePath, and conflictType are required',
      });
    }

    const coordinator = getOrCreateCoordinator(projectId);
    const conflict = await coordinator.detectConflict(agentAId, agentBId, filePath, conflictType);

    res.json({
      success: true,
      conflict,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/coordination/:projectId/conflicts/:conflictId/resolve
 * Resolve a conflict
 */
router.post('/:projectId/conflicts/:conflictId/resolve', async (req: Request, res: Response) => {
  try {
    const { projectId, conflictId } = req.params;
    const { resolution, resolvedBy } = req.body;

    if (!resolution || !resolvedBy) {
      return res.status(400).json({
        success: false,
        error: 'resolution and resolvedBy are required',
      });
    }

    if (!['merge', 'override_a', 'override_b', 'reject'].includes(resolution)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid resolution. Must be: merge, override_a, override_b, or reject',
      });
    }

    const coordinator = getOrCreateCoordinator(projectId);
    const success = await coordinator.resolveConflict(conflictId, resolution, resolvedBy);

    res.json({ success });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============ MESSAGING ============

/**
 * POST /api/coordination/:projectId/relay
 * Relay a message between agents
 */
router.post('/:projectId/relay', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const message = req.body;

    if (!message || !message.type) {
      return res.status(400).json({
        success: false,
        error: 'message with type is required',
      });
    }

    const coordinator = getOrCreateCoordinator(projectId);
    await coordinator.relay({
      ...message,
      projectId,
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
