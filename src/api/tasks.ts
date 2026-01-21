import type { IncomingMessage, ServerResponse } from 'http';
import { getDatabase } from '../lib/database.js';
import { createTaskQueue, TaskQueue, QueuedTask } from '../core/task-queue/index.js';
import type { TaskStatus, AgentType } from '../types/index.js';

// Task queue instances per project
const taskQueues: Map<string, TaskQueue> = new Map();

function getTaskQueue(projectId: string): TaskQueue {
  if (!taskQueues.has(projectId)) {
    const queue = createTaskQueue({ projectId });
    taskQueues.set(projectId, queue);
  }
  return taskQueues.get(projectId)!;
}

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
 * GET /api/tasks - List all tasks (with optional filters)
 */
export async function listAllTasks(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const db = getDatabase();
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    const status = url.searchParams.get('status');
    const projectId = url.searchParams.get('projectId');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (projectId) {
      conditions.push(`project_id = $${paramIndex++}`);
      params.push(projectId);
    }

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query<QueuedTask>(
      `SELECT
        id, project_id as "projectId", parent_task_id as "parentTaskId",
        title, description, type, status, priority,
        specification, assigned_agent_id as "assignedAgentId",
        assigned_at as "assignedAt", started_at as "startedAt",
        completed_at as "completedAt", result, error_message as "errorMessage",
        retry_count as "retryCount", max_retries as "maxRetries",
        created_at as "createdAt", updated_at as "updatedAt"
      FROM tasks
      ${whereClause}
      ORDER BY priority DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    sendJson(res, 200, result.rows);
  } catch (error) {
    console.error('Error listing tasks:', error);
    sendJson(res, 500, { error: 'Failed to list tasks' });
  }
}

/**
 * GET /api/tasks/:id - Get task details
 */
export async function getTaskById(
  _req: IncomingMessage,
  res: ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const db = getDatabase();

    const result = await db.query<QueuedTask>(
      `SELECT
        id, project_id as "projectId", parent_task_id as "parentTaskId",
        title, description, type, status, priority,
        specification, assigned_agent_id as "assignedAgentId",
        assigned_at as "assignedAt", started_at as "startedAt",
        completed_at as "completedAt", result, error_message as "errorMessage",
        retry_count as "retryCount", max_retries as "maxRetries",
        created_at as "createdAt", updated_at as "updatedAt"
      FROM tasks WHERE id = $1`,
      [taskId]
    );

    if (result.rows.length === 0) {
      sendJson(res, 404, { error: 'Task not found' });
      return;
    }

    // Get dependencies
    const depsResult = await db.query<{ depends_on_task_id: string }>(
      `SELECT depends_on_task_id FROM task_dependencies WHERE task_id = $1`,
      [taskId]
    );

    // Get execution logs
    const logsResult = await db.query<{
      id: string;
      log_level: string;
      message: string;
      created_at: Date;
    }>(
      `SELECT id, log_level, message, created_at
       FROM execution_logs
       WHERE task_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [taskId]
    );

    const task = result.rows[0];
    sendJson(res, 200, {
      ...task,
      dependencies: depsResult.rows.map(r => r.depends_on_task_id),
      executionLogs: logsResult.rows,
    });
  } catch (error) {
    console.error('Error getting task:', error);
    sendJson(res, 500, { error: 'Failed to get task' });
  }
}

/**
 * PUT /api/tasks/:id/assign - Assign task to agent
 */
export async function assignTaskToAgent(
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const body = await parseBody<{ agentId: string }>(req);

    if (!body.agentId) {
      sendJson(res, 400, { error: 'agentId is required' });
      return;
    }

    const db = getDatabase();

    // Get the task's project
    const taskResult = await db.query<{ project_id: string }>(
      `SELECT project_id FROM tasks WHERE id = $1`,
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      sendJson(res, 404, { error: 'Task not found' });
      return;
    }

    const queue = getTaskQueue(taskResult.rows[0].project_id);
    const success = await queue.assignTask(taskId, body.agentId);

    if (success) {
      const updatedTask = await queue.getTask(taskId);
      sendJson(res, 200, { success: true, task: updatedTask });
    } else {
      sendJson(res, 400, { error: 'Failed to assign task. Task may already be assigned or completed.' });
    }
  } catch (error) {
    console.error('Error assigning task:', error);
    sendJson(res, 500, { error: 'Failed to assign task' });
  }
}

/**
 * PUT /api/tasks/:id/complete - Mark task as completed
 */
export async function completeTask(
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const body = await parseBody<{
      result?: Record<string, unknown>;
      metrics?: Record<string, unknown>;
    }>(req);

    const db = getDatabase();

    // Get the task's project
    const taskResult = await db.query<{ project_id: string }>(
      `SELECT project_id FROM tasks WHERE id = $1`,
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      sendJson(res, 404, { error: 'Task not found' });
      return;
    }

    const queue = getTaskQueue(taskResult.rows[0].project_id);
    const success = await queue.completeTask(taskId, body.result, body.metrics);

    if (success) {
      const updatedTask = await queue.getTask(taskId);
      sendJson(res, 200, { success: true, task: updatedTask });
    } else {
      sendJson(res, 400, { error: 'Failed to complete task. Task may not be in progress.' });
    }
  } catch (error) {
    console.error('Error completing task:', error);
    sendJson(res, 500, { error: 'Failed to complete task' });
  }
}

/**
 * PUT /api/tasks/:id/fail - Mark task as failed
 */
export async function failTask(
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const body = await parseBody<{
      errorMessage: string;
      shouldRetry?: boolean;
    }>(req);

    if (!body.errorMessage) {
      sendJson(res, 400, { error: 'errorMessage is required' });
      return;
    }

    const db = getDatabase();

    // Get the task's project
    const taskResult = await db.query<{ project_id: string }>(
      `SELECT project_id FROM tasks WHERE id = $1`,
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      sendJson(res, 404, { error: 'Task not found' });
      return;
    }

    const queue = getTaskQueue(taskResult.rows[0].project_id);
    const result = await queue.failTask(taskId, body.errorMessage, body.shouldRetry ?? true);

    const updatedTask = await queue.getTask(taskId);
    sendJson(res, 200, { ...result, task: updatedTask });
  } catch (error) {
    console.error('Error failing task:', error);
    sendJson(res, 500, { error: 'Failed to fail task' });
  }
}

/**
 * POST /api/tasks/:id/retry - Retry a failed task
 */
export async function retryTask(
  _req: IncomingMessage,
  res: ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const db = getDatabase();

    // Reset task to pending
    const result = await db.query<QueuedTask>(
      `UPDATE tasks
       SET status = 'pending',
           error_message = NULL,
           assigned_agent_id = NULL,
           assigned_at = NULL,
           started_at = NULL,
           completed_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND status = 'failed'
       RETURNING *`,
      [taskId]
    );

    if (result.rowCount === 0) {
      sendJson(res, 400, { error: 'Task not found or is not in failed status' });
      return;
    }

    sendJson(res, 200, { success: true, task: result.rows[0] });
  } catch (error) {
    console.error('Error retrying task:', error);
    sendJson(res, 500, { error: 'Failed to retry task' });
  }
}

/**
 * GET /api/tasks/queue/stats - Get task queue statistics
 */
export async function getTaskQueueStats(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId');

    const db = getDatabase();

    const condition = projectId ? 'WHERE project_id = $1' : '';
    const params = projectId ? [projectId] : [];

    // Status breakdown
    const statusResult = await db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count
       FROM tasks
       ${condition}
       GROUP BY status`,
      params
    );

    // Execution metrics
    const metricsResult = await db.query<{
      avg_wait_time: string;
      avg_execution_time: string;
      total_retries: string;
      success_rate: string;
    }>(
      `SELECT
        AVG(EXTRACT(EPOCH FROM (started_at - created_at))) as avg_wait_time,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_execution_time,
        SUM(retry_count) as total_retries,
        CASE WHEN COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) > 0
          THEN (COUNT(*) FILTER (WHERE status = 'completed')::float /
                COUNT(*) FILTER (WHERE status IN ('completed', 'failed'))) * 100
          ELSE 0
        END as success_rate
       FROM tasks
       ${condition}`,
      params
    );

    // Recent failures
    const failuresResult = await db.query<{
      id: string;
      title: string;
      error_message: string;
      updated_at: Date;
    }>(
      `SELECT id, title, error_message, updated_at
       FROM tasks
       ${projectId ? 'WHERE project_id = $1 AND status = \'failed\'' : 'WHERE status = \'failed\''}
       ORDER BY updated_at DESC
       LIMIT 5`,
      params
    );

    const statusBreakdown: Record<string, number> = {};
    for (const row of statusResult.rows) {
      statusBreakdown[row.status] = parseInt(row.count, 10);
    }

    const metrics = metricsResult.rows[0];

    sendJson(res, 200, {
      statusBreakdown,
      metrics: {
        avgWaitTimeSeconds: parseFloat(metrics?.avg_wait_time || '0'),
        avgExecutionTimeSeconds: parseFloat(metrics?.avg_execution_time || '0'),
        totalRetries: parseInt(metrics?.total_retries || '0', 10),
        successRate: parseFloat(metrics?.success_rate || '0'),
      },
      recentFailures: failuresResult.rows,
    });
  } catch (error) {
    console.error('Error getting queue stats:', error);
    sendJson(res, 500, { error: 'Failed to get queue statistics' });
  }
}

/**
 * GET /api/tasks/queue/next - Get next available task for agent type
 */
export async function getNextTask(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId');
    const agentType = url.searchParams.get('agentType') as AgentType | null;

    if (!projectId) {
      sendJson(res, 400, { error: 'projectId is required' });
      return;
    }

    const queue = getTaskQueue(projectId);
    const task = await queue.getNextTask(agentType || undefined);

    if (task) {
      sendJson(res, 200, { task });
    } else {
      sendJson(res, 200, { task: null, message: 'No tasks available' });
    }
  } catch (error) {
    console.error('Error getting next task:', error);
    sendJson(res, 500, { error: 'Failed to get next task' });
  }
}

/**
 * POST /api/tasks - Create a new task (enhanced version)
 */
export async function createTaskEnhanced(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await parseBody<{
      projectId: string;
      title: string;
      description?: string;
      type?: string;
      specification?: Record<string, unknown>;
      priority?: number;
      parentTaskId?: string;
      dependencies?: string[];
      maxRetries?: number;
      estimatedDurationMinutes?: number;
    }>(req);

    if (!body.projectId || !body.title) {
      sendJson(res, 400, { error: 'projectId and title are required' });
      return;
    }

    const queue = getTaskQueue(body.projectId);
    const task = await queue.createTask({
      projectId: body.projectId,
      title: body.title,
      description: body.description,
      type: body.type,
      specification: body.specification,
      priority: body.priority,
      parentTaskId: body.parentTaskId,
      dependencies: body.dependencies,
      maxRetries: body.maxRetries,
      estimatedDurationMinutes: body.estimatedDurationMinutes,
    });

    sendJson(res, 201, task);
  } catch (error) {
    console.error('Error creating task:', error);
    sendJson(res, 500, { error: 'Failed to create task' });
  }
}

/**
 * DELETE /api/tasks/:id - Cancel a task
 */
export async function cancelTask(
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const body = await parseBody<{ reason?: string }>(req);

    const db = getDatabase();

    // Get the task's project
    const taskResult = await db.query<{ project_id: string }>(
      `SELECT project_id FROM tasks WHERE id = $1`,
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      sendJson(res, 404, { error: 'Task not found' });
      return;
    }

    const queue = getTaskQueue(taskResult.rows[0].project_id);
    const success = await queue.cancelTask(taskId, body.reason);

    if (success) {
      sendJson(res, 200, { success: true, message: 'Task cancelled' });
    } else {
      sendJson(res, 400, { error: 'Failed to cancel task. Task may already be in progress or completed.' });
    }
  } catch (error) {
    console.error('Error cancelling task:', error);
    sendJson(res, 500, { error: 'Failed to cancel task' });
  }
}
