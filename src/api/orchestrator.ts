import type { IncomingMessage, ServerResponse } from 'http';
import { getDatabase } from '../lib/database.js';
import { getCheckpointManager } from '../core/checkpoint/index.js';
import type { AgentType } from '../types/index.js';

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

/**
 * GET /api/orchestrator/status - Get orchestrator status for a project
 */
export async function getOrchestratorStatus(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId');

    if (!projectId) {
      sendJson(res, 400, { error: 'projectId is required' });
      return;
    }

    const db = getDatabase();

    // Get orchestrator state
    const stateResult = await db.query<{
      id: string;
      status: string;
      current_plan: Record<string, unknown>;
      active_agents: string[];
      pending_tasks: number;
      running_tasks: number;
      completed_tasks: number;
      failed_tasks: number;
      last_health_check: Date;
      started_at: Date;
      stopped_at: Date;
    }>(
      `SELECT * FROM orchestrator_state WHERE project_id = $1`,
      [projectId]
    );

    // Get active agent details
    const agentsResult = await db.query<{
      id: string;
      type: string;
      status: string;
      current_task_id: string;
    }>(
      `SELECT id, type, status, current_task_id
       FROM agents
       WHERE project_id = $1 AND status IN ('idle', 'working')`,
      [projectId]
    );

    // Get task queue status
    const queueResult = await db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count
       FROM tasks
       WHERE project_id = $1
       GROUP BY status`,
      [projectId]
    );

    const taskCounts: Record<string, number> = {};
    for (const row of queueResult.rows) {
      taskCounts[row.status] = parseInt(row.count, 10);
    }

    const state = stateResult.rows[0];

    sendJson(res, 200, {
      projectId,
      status: state?.status || 'stopped',
      currentPlan: state?.current_plan || null,
      activeAgents: agentsResult.rows,
      taskQueue: taskCounts,
      metrics: state ? {
        pendingTasks: state.pending_tasks,
        runningTasks: state.running_tasks,
        completedTasks: state.completed_tasks,
        failedTasks: state.failed_tasks,
        lastHealthCheck: state.last_health_check,
        startedAt: state.started_at,
        stoppedAt: state.stopped_at,
      } : null,
    });
  } catch (error) {
    console.error('Error getting orchestrator status:', error);
    sendJson(res, 500, { error: 'Failed to get orchestrator status' });
  }
}

/**
 * POST /api/orchestrator/start - Start the orchestrator for a project
 */
export async function startOrchestrator(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await parseBody<{ projectId: string }>(req);

    if (!body.projectId) {
      sendJson(res, 400, { error: 'projectId is required' });
      return;
    }

    const db = getDatabase();

    // Create or update orchestrator state
    const result = await db.query(
      `INSERT INTO orchestrator_state (project_id, status, started_at)
       VALUES ($1, 'running', NOW())
       ON CONFLICT (project_id)
       DO UPDATE SET status = 'running', started_at = NOW(), stopped_at = NULL
       RETURNING *`,
      [body.projectId]
    );

    sendJson(res, 200, {
      success: true,
      status: 'running',
      message: 'Orchestrator started',
      state: result.rows[0],
    });
  } catch (error) {
    console.error('Error starting orchestrator:', error);
    sendJson(res, 500, { error: 'Failed to start orchestrator' });
  }
}

/**
 * POST /api/orchestrator/stop - Stop the orchestrator for a project
 */
export async function stopOrchestrator(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await parseBody<{ projectId: string }>(req);

    if (!body.projectId) {
      sendJson(res, 400, { error: 'projectId is required' });
      return;
    }

    const db = getDatabase();

    // Update orchestrator state
    await db.query(
      `UPDATE orchestrator_state
       SET status = 'stopped', stopped_at = NOW()
       WHERE project_id = $1`,
      [body.projectId]
    );

    sendJson(res, 200, {
      success: true,
      status: 'stopped',
      message: 'Orchestrator stopped',
    });
  } catch (error) {
    console.error('Error stopping orchestrator:', error);
    sendJson(res, 500, { error: 'Failed to stop orchestrator' });
  }
}

/**
 * POST /api/orchestrator/plan - Submit a plan for execution
 */
export async function submitPlan(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await parseBody<{
      projectId: string;
      plan: {
        phases: Array<{
          phaseNumber: number;
          tasks: Array<{
            id?: string;
            title: string;
            description: string;
            type: string;
            agentType: AgentType;
            dependencies?: string[];
            priority?: number;
          }>;
        }>;
      };
    }>(req);

    if (!body.projectId || !body.plan) {
      sendJson(res, 400, { error: 'projectId and plan are required' });
      return;
    }

    const db = getDatabase();

    // Create tasks from plan
    const createdTasks: Array<{ id: string; title: string; phaseNumber: number }> = [];

    for (const phase of body.plan.phases) {
      for (const taskDef of phase.tasks) {
        const result = await db.query<{ id: string }>(
          `INSERT INTO tasks (project_id, title, description, type, priority, specification)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            body.projectId,
            taskDef.title,
            taskDef.description,
            taskDef.type,
            taskDef.priority || (10 - phase.phaseNumber), // Higher priority for earlier phases
            JSON.stringify({ agentType: taskDef.agentType, phase: phase.phaseNumber }),
          ]
        );

        createdTasks.push({
          id: result.rows[0].id,
          title: taskDef.title,
          phaseNumber: phase.phaseNumber,
        });
      }
    }

    // Update orchestrator state with plan
    await db.query(
      `UPDATE orchestrator_state
       SET current_plan = $2,
           pending_tasks = $3,
           updated_at = NOW()
       WHERE project_id = $1`,
      [body.projectId, JSON.stringify(body.plan), createdTasks.length]
    );

    sendJson(res, 201, {
      success: true,
      message: `Plan submitted with ${createdTasks.length} tasks`,
      tasks: createdTasks,
    });
  } catch (error) {
    console.error('Error submitting plan:', error);
    sendJson(res, 500, { error: 'Failed to submit plan' });
  }
}

/**
 * POST /api/agents/:id/checkpoint - Force checkpoint for an agent
 */
export async function forceAgentCheckpoint(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const body = await parseBody<{
      state?: Record<string, unknown>;
      taskId?: string;
      recoveryInstructions?: string;
    }>(req);

    const db = getDatabase();

    // Get agent info
    const agentResult = await db.query<{ project_id: string; checkpoint_data: Record<string, unknown> }>(
      `SELECT project_id, checkpoint_data FROM agents WHERE id = $1`,
      [agentId]
    );

    if (agentResult.rows.length === 0) {
      sendJson(res, 404, { error: 'Agent not found' });
      return;
    }

    const agent = agentResult.rows[0];
    const checkpointManager = getCheckpointManager();

    // Use provided state or current checkpoint data
    const state = body.state || agent.checkpoint_data || {
      currentStep: 'unknown',
      progress: 0,
      workingMemory: {},
      pendingActions: [],
    };

    const checkpoint = await checkpointManager.createCheckpoint(
      agentId,
      state,
      body.taskId,
      undefined,
      undefined,
      body.recoveryInstructions
    );

    sendJson(res, 201, {
      success: true,
      checkpointId: checkpoint.id,
      createdAt: checkpoint.createdAt,
    });
  } catch (error) {
    console.error('Error creating checkpoint:', error);
    sendJson(res, 500, { error: 'Failed to create checkpoint' });
  }
}

/**
 * POST /api/agents/:id/resume - Resume agent from checkpoint
 */
export async function resumeAgentFromCheckpoint(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const body = await parseBody<{ checkpointId?: string }>(req);

    const checkpointManager = getCheckpointManager();

    let checkpointId = body.checkpointId;

    // If no checkpoint ID provided, get the latest
    if (!checkpointId) {
      const latest = await checkpointManager.getLatestCheckpoint(agentId);
      if (!latest) {
        sendJson(res, 404, { error: 'No checkpoint found for this agent' });
        return;
      }
      checkpointId = latest.id;
    }

    const { checkpoint, state, restoredFiles } = await checkpointManager.restoreFromCheckpoint(checkpointId);

    sendJson(res, 200, {
      success: true,
      checkpointId: checkpoint.id,
      restoredState: state,
      restoredFiles,
      recoveryInstructions: checkpoint.recoveryInstructions,
    });
  } catch (error) {
    console.error('Error resuming from checkpoint:', error);
    sendJson(res, 500, { error: 'Failed to resume from checkpoint' });
  }
}

/**
 * GET /api/agents/:id/messages - Get agent message queue
 */
export async function getAgentMessages(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const unprocessedOnly = url.searchParams.get('unprocessedOnly') === 'true';
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const db = getDatabase();

    const condition = unprocessedOnly ? 'AND processed = false' : '';

    const result = await db.query<{
      id: string;
      from_agent_id: string;
      type: string;
      payload: Record<string, unknown>;
      processed: boolean;
      created_at: Date;
    }>(
      `SELECT id, from_agent_id, type, payload, processed, created_at
       FROM messages
       WHERE to_agent_id = $1 ${condition}
       ORDER BY created_at DESC
       LIMIT $2`,
      [agentId, limit]
    );

    sendJson(res, 200, result.rows);
  } catch (error) {
    console.error('Error getting agent messages:', error);
    sendJson(res, 500, { error: 'Failed to get agent messages' });
  }
}

/**
 * POST /api/agents/:id/message - Send message to agent
 */
export async function sendMessageToAgent(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const body = await parseBody<{
      type: string;
      payload: Record<string, unknown>;
      fromAgentId?: string;
    }>(req);

    if (!body.type || !body.payload) {
      sendJson(res, 400, { error: 'type and payload are required' });
      return;
    }

    const db = getDatabase();

    // Get agent's project
    const agentResult = await db.query<{ project_id: string }>(
      `SELECT project_id FROM agents WHERE id = $1`,
      [agentId]
    );

    if (agentResult.rows.length === 0) {
      sendJson(res, 404, { error: 'Agent not found' });
      return;
    }

    const result = await db.query<{
      id: string;
      created_at: Date;
    }>(
      `INSERT INTO messages (project_id, from_agent_id, to_agent_id, type, payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [
        agentResult.rows[0].project_id,
        body.fromAgentId || null,
        agentId,
        body.type,
        JSON.stringify(body.payload),
      ]
    );

    sendJson(res, 201, {
      success: true,
      messageId: result.rows[0].id,
      createdAt: result.rows[0].created_at,
    });
  } catch (error) {
    console.error('Error sending message:', error);
    sendJson(res, 500, { error: 'Failed to send message' });
  }
}

/**
 * GET /api/checkpoints - Get checkpoint statistics
 */
export async function getCheckpointStats(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId') || undefined;

    const checkpointManager = getCheckpointManager();
    const stats = await checkpointManager.getCheckpointStats(projectId);

    sendJson(res, 200, stats);
  } catch (error) {
    console.error('Error getting checkpoint stats:', error);
    sendJson(res, 500, { error: 'Failed to get checkpoint statistics' });
  }
}

/**
 * GET /api/checkpoints/:agentId - Get checkpoint history for an agent
 */
export async function getAgentCheckpoints(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);

    const checkpointManager = getCheckpointManager();
    const checkpoints = await checkpointManager.getCheckpoints(agentId);

    sendJson(res, 200, checkpoints.slice(0, limit));
  } catch (error) {
    console.error('Error getting agent checkpoints:', error);
    sendJson(res, 500, { error: 'Failed to get agent checkpoints' });
  }
}

/**
 * GET /api/execution-logs - Get execution logs
 */
export async function getExecutionLogs(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId');
    const agentId = url.searchParams.get('agentId');
    const taskId = url.searchParams.get('taskId');
    const level = url.searchParams.get('level');
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);

    const db = getDatabase();

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (projectId) {
      conditions.push(`project_id = $${paramIndex++}`);
      params.push(projectId);
    }
    if (agentId) {
      conditions.push(`agent_id = $${paramIndex++}`);
      params.push(agentId);
    }
    if (taskId) {
      conditions.push(`task_id = $${paramIndex++}`);
      params.push(taskId);
    }
    if (level) {
      conditions.push(`log_level = $${paramIndex++}`);
      params.push(level);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query<{
      id: string;
      project_id: string;
      agent_id: string;
      task_id: string;
      log_level: string;
      message: string;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT * FROM execution_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      params
    );

    sendJson(res, 200, result.rows);
  } catch (error) {
    console.error('Error getting execution logs:', error);
    sendJson(res, 500, { error: 'Failed to get execution logs' });
  }
}
