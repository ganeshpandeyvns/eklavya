/**
 * Demo₄: Agent Lifecycle API Endpoints
 *
 * Provides REST API endpoints for:
 * - Agent process spawning and termination
 * - Health monitoring
 * - Resource tracking
 * - Manager operations
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getDatabase } from '../lib/database.js';
import { getLifecycleManager } from '../core/agent-manager/lifecycle.js';

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function parseBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}') as T);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================================================
// Agent Lifecycle Endpoints
// ============================================================================

/**
 * POST /api/agents/:id/spawn - Spawn agent process
 */
export async function spawnAgent(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const body = await parseBody<{
      workingDirectory?: string;
      environment?: Record<string, string>;
      timeout?: number;
    }>(req);

    const manager = getLifecycleManager();
    const result = await manager.spawnAgent({
      agentId,
      workingDirectory: body.workingDirectory,
      environment: body.environment,
      timeout: body.timeout,
    });

    if (result.success) {
      sendJson(res, 201, {
        success: true,
        processId: result.processId,
        pid: result.pid,
        message: 'Agent process spawned successfully',
      });
    } else {
      sendJson(res, 400, {
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Error spawning agent:', error);
    sendJson(res, 500, { error: 'Failed to spawn agent process' });
  }
}

/**
 * POST /api/agents/:id/terminate - Terminate agent gracefully
 */
export async function terminateAgent(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const body = await parseBody<{
      graceful?: boolean;
      saveCheckpoint?: boolean;
    }>(req);

    const manager = getLifecycleManager();
    const result = await manager.terminateAgent(agentId, body.graceful !== false);

    sendJson(res, 200, {
      success: result.success,
      checkpointSaved: result.checkpointSaved,
      exitCode: result.exitCode,
      error: result.error,
      message: result.success ? 'Agent terminated successfully' : 'Termination failed',
    });
  } catch (error) {
    console.error('Error terminating agent:', error);
    sendJson(res, 500, { error: 'Failed to terminate agent' });
  }
}

/**
 * POST /api/agents/:id/kill - Force kill agent process
 */
export async function killAgent(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const manager = getLifecycleManager();
    const success = await manager.forceKillAgent(agentId);

    sendJson(res, 200, {
      success,
      message: success ? 'Agent process killed' : 'Failed to kill agent',
    });
  } catch (error) {
    console.error('Error killing agent:', error);
    sendJson(res, 500, { error: 'Failed to kill agent process' });
  }
}

/**
 * POST /api/agents/:id/restart - Restart agent (terminate + spawn)
 */
export async function restartAgent(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const manager = getLifecycleManager();
    const result = await manager.restartAgent(agentId);

    if (result.success) {
      sendJson(res, 200, {
        success: true,
        processId: result.processId,
        pid: result.pid,
        message: 'Agent restarted successfully',
      });
    } else {
      sendJson(res, 400, {
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Error restarting agent:', error);
    sendJson(res, 500, { error: 'Failed to restart agent' });
  }
}

/**
 * GET /api/agents/:id/process - Get agent process info
 */
export async function getAgentProcess(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const manager = getLifecycleManager();
    const status = await manager.getAgentStatus(agentId);

    if (!status) {
      sendJson(res, 404, { error: 'Agent not found' });
      return;
    }

    sendJson(res, 200, status);
  } catch (error) {
    console.error('Error getting agent process:', error);
    sendJson(res, 500, { error: 'Failed to get agent process info' });
  }
}

/**
 * GET /api/agents/:id/health - Get agent health status
 */
export async function getAgentHealth(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const manager = getLifecycleManager();
    const health = await manager.checkAgentHealth(agentId);

    sendJson(res, 200, health);
  } catch (error) {
    console.error('Error getting agent health:', error);
    sendJson(res, 500, { error: 'Failed to get agent health' });
  }
}

/**
 * GET /api/agents/:id/resources - Get agent resource usage
 */
export async function getAgentResources(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const manager = getLifecycleManager();
    const resources = await manager.getAgentResources(agentId);

    sendJson(res, 200, resources);
  } catch (error) {
    console.error('Error getting agent resources:', error);
    sendJson(res, 500, { error: 'Failed to get agent resources' });
  }
}

/**
 * POST /api/agents/:id/resources - Record agent resource usage
 */
export async function recordAgentResources(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const body = await parseBody<{
      cpuPercent: number;
      memoryMb: number;
      tokensUsed?: number;
      apiCalls?: number;
      filesModified?: number;
    }>(req);

    const manager = getLifecycleManager();
    await manager.recordAgentResources(
      agentId,
      body.cpuPercent,
      body.memoryMb,
      body.tokensUsed,
      body.apiCalls,
      body.filesModified
    );

    sendJson(res, 201, {
      success: true,
      message: 'Resource usage recorded',
    });
  } catch (error) {
    console.error('Error recording agent resources:', error);
    sendJson(res, 500, { error: 'Failed to record agent resources' });
  }
}

// ============================================================================
// Agent Manager Endpoints
// ============================================================================

/**
 * GET /api/agent-manager/status - Get manager status and all agents
 */
export async function getManagerStatus(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId') || undefined;

    const manager = getLifecycleManager();
    const status = await manager.getManagerStatus(projectId);

    sendJson(res, 200, status);
  } catch (error) {
    console.error('Error getting manager status:', error);
    sendJson(res, 500, { error: 'Failed to get manager status' });
  }
}

/**
 * POST /api/agent-manager/spawn-all - Spawn all idle agents for project
 */
export async function spawnAllAgents(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await parseBody<{ projectId: string }>(req);

    if (!body.projectId) {
      sendJson(res, 400, { error: 'projectId is required' });
      return;
    }

    const manager = getLifecycleManager();
    const results = await manager.spawnAllIdle(body.projectId);

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    sendJson(res, 200, {
      success: true,
      totalSpawned: successCount,
      totalFailed: failCount,
      results,
      message: `Spawned ${successCount} agents, ${failCount} failed`,
    });
  } catch (error) {
    console.error('Error spawning all agents:', error);
    sendJson(res, 500, { error: 'Failed to spawn agents' });
  }
}

/**
 * POST /api/agent-manager/terminate-all - Terminate all agents for project
 */
export async function terminateAllAgents(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await parseBody<{ projectId: string }>(req);

    if (!body.projectId) {
      sendJson(res, 400, { error: 'projectId is required' });
      return;
    }

    const manager = getLifecycleManager();
    const results = await manager.terminateAll(body.projectId);

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    sendJson(res, 200, {
      success: true,
      totalTerminated: successCount,
      totalFailed: failCount,
      results,
      message: `Terminated ${successCount} agents, ${failCount} failed`,
    });
  } catch (error) {
    console.error('Error terminating all agents:', error);
    sendJson(res, 500, { error: 'Failed to terminate agents' });
  }
}

/**
 * GET /api/agent-manager/resources - Get aggregate resource usage
 */
export async function getAggregateResources(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId') || undefined;

    const manager = getLifecycleManager();
    const resources = await manager.getAggregateResources(projectId);

    sendJson(res, 200, resources);
  } catch (error) {
    console.error('Error getting aggregate resources:', error);
    sendJson(res, 500, { error: 'Failed to get aggregate resources' });
  }
}

/**
 * POST /api/agent-manager/gc - Garbage collect dead processes
 */
export async function garbageCollect(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const manager = getLifecycleManager();
    const cleanedCount = await manager.garbageCollect();

    sendJson(res, 200, {
      success: true,
      cleanedCount,
      message: `Garbage collected ${cleanedCount} dead processes`,
    });
  } catch (error) {
    console.error('Error during garbage collection:', error);
    sendJson(res, 500, { error: 'Failed to garbage collect' });
  }
}

/**
 * POST /api/agent-manager/start - Start the lifecycle manager
 */
export async function startManager(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const manager = getLifecycleManager();
    await manager.start();

    sendJson(res, 200, {
      success: true,
      running: true,
      message: 'Lifecycle manager started',
    });
  } catch (error) {
    console.error('Error starting manager:', error);
    sendJson(res, 500, { error: 'Failed to start lifecycle manager' });
  }
}

/**
 * POST /api/agent-manager/stop - Stop the lifecycle manager
 */
export async function stopManager(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const manager = getLifecycleManager();
    await manager.stop();

    sendJson(res, 200, {
      success: true,
      running: false,
      message: 'Lifecycle manager stopped',
    });
  } catch (error) {
    console.error('Error stopping manager:', error);
    sendJson(res, 500, { error: 'Failed to stop lifecycle manager' });
  }
}

// ============================================================================
// Health Check History
// ============================================================================

/**
 * GET /api/agents/:id/health-history - Get agent health check history
 */
export async function getAgentHealthHistory(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    const db = getDatabase();
    const result = await db.query<{
      id: string;
      status: string;
      latency_ms: number;
      last_activity: Date;
      error_message: string;
      created_at: Date;
    }>(
      `SELECT id, status, latency_ms, last_activity, error_message, created_at
       FROM agent_health_checks
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [agentId, limit]
    );

    sendJson(res, 200, result.rows.map(row => ({
      id: row.id,
      status: row.status,
      latencyMs: row.latency_ms,
      lastActivity: row.last_activity,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    })));
  } catch (error) {
    console.error('Error getting health history:', error);
    sendJson(res, 500, { error: 'Failed to get health history' });
  }
}

/**
 * GET /api/agents/:id/resource-history - Get agent resource usage history
 */
export async function getAgentResourceHistory(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const db = getDatabase();
    const result = await db.query<{
      id: string;
      cpu_percent: number;
      memory_mb: number;
      tokens_used: number;
      api_calls: number;
      files_modified: number;
      timestamp: Date;
    }>(
      `SELECT id, cpu_percent, memory_mb, tokens_used, api_calls, files_modified, timestamp
       FROM agent_resources
       WHERE agent_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [agentId, limit]
    );

    sendJson(res, 200, result.rows.map(row => ({
      id: row.id,
      cpuPercent: row.cpu_percent,
      memoryMb: row.memory_mb,
      tokensUsed: row.tokens_used,
      apiCalls: row.api_calls,
      filesModified: row.files_modified,
      timestamp: row.timestamp,
    })));
  } catch (error) {
    console.error('Error getting resource history:', error);
    sendJson(res, 500, { error: 'Failed to get resource history' });
  }
}
