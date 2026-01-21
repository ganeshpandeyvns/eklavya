import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { Task, TaskStatus, AgentType } from '../../types/index.js';
import { getDatabase } from '../../lib/database.js';

export interface TaskCreateParams {
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
}

export interface TaskQueueOptions {
  projectId: string;
  pollIntervalMs?: number;
  maxConcurrent?: number;
}

export interface QueuedTask extends Task {
  specification?: Record<string, unknown>;
  assignedAt?: Date;
  executionContext?: Record<string, unknown>;
  estimatedDurationMinutes?: number;
}

/**
 * TaskQueue manages the queue of tasks awaiting execution.
 * It handles task creation, assignment, completion, and failure with retry logic.
 */
export class TaskQueue extends EventEmitter {
  private projectId: string;
  private pollIntervalMs: number;
  private maxConcurrent: number;
  private pollInterval?: NodeJS.Timeout;
  private isRunning = false;

  constructor(options: TaskQueueOptions) {
    super();
    this.projectId = options.projectId;
    this.pollIntervalMs = options.pollIntervalMs || 1000;
    this.maxConcurrent = options.maxConcurrent || 10;
  }

  /**
   * Start the task queue polling
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.isRunning = true;

      // Poll for new tasks
      this.pollInterval = setInterval(() => {
        this.processQueue().catch(err => {
          console.error('Task queue processing error:', err);
        });
      }, this.pollIntervalMs);

      this.emit('started');
    } catch (error) {
      this.isRunning = false;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'start', error: errorMessage });
      throw error;
    }
  }

  /**
   * Stop the task queue
   */
  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    this.isRunning = false;
    this.emit('stopped');
  }

  /**
   * Create a new task
   */
  async createTask(params: TaskCreateParams): Promise<QueuedTask> {
    try {
      const db = getDatabase();
      const taskId = uuidv4();

      const task: QueuedTask = {
        id: taskId,
        projectId: params.projectId,
        parentTaskId: params.parentTaskId,
        title: params.title,
        description: params.description || '',
        type: params.type || 'general',
        status: 'pending',
        priority: params.priority || 5,
        specification: params.specification,
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: params.maxRetries || 3,
        estimatedDurationMinutes: params.estimatedDurationMinutes,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.query(
        `INSERT INTO tasks (
          id, project_id, parent_task_id, title, description, type,
          status, priority, specification, max_retries,
          estimated_duration_minutes, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          task.id,
          task.projectId,
          task.parentTaskId || null,
          task.title,
          task.description,
          task.type,
          task.status,
          task.priority,
          JSON.stringify(task.specification || {}),
          task.maxRetries,
          task.estimatedDurationMinutes || null,
          task.createdAt,
          task.updatedAt,
        ]
      );

      // Add dependencies if provided
      if (params.dependencies && params.dependencies.length > 0) {
        for (const depId of params.dependencies) {
          await db.query(
            `INSERT INTO task_dependencies (task_id, depends_on_task_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [task.id, depId]
          );
        }
      }

      this.emit('task:created', task);
      return task;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'createTask', error: errorMessage });
      throw error;
    }
  }

  /**
   * Get the next available task for an agent type
   */
  async getNextTask(agentType?: AgentType): Promise<QueuedTask | null> {
    try {
      const db = getDatabase();

      // Use database function for atomic task selection
      const result = await db.query<{ id: string }>(
        `SELECT get_next_task($1, $2) as id`,
        [this.projectId, agentType || 'developer']
      );

      if (!result.rows[0]?.id) {
        return null;
      }

      const taskId = result.rows[0].id;

      // Fetch full task details
      const taskResult = await db.query<QueuedTask>(
        `SELECT
          id, project_id as "projectId", parent_task_id as "parentTaskId",
          title, description, type, status, priority,
          specification, assigned_agent_id as "assignedAgentId",
          assigned_at as "assignedAt", started_at as "startedAt",
          completed_at as "completedAt", result, error_message as "errorMessage",
          retry_count as "retryCount", max_retries as "maxRetries",
          estimated_duration_minutes as "estimatedDurationMinutes",
          execution_context as "executionContext",
          created_at as "createdAt", updated_at as "updatedAt"
        FROM tasks WHERE id = $1`,
        [taskId]
      );

      return taskResult.rows[0] || null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'getNextTask', error: errorMessage });
      throw error;
    }
  }

  /**
   * Assign a task to an agent
   */
  async assignTask(taskId: string, agentId: string): Promise<boolean> {
    try {
      const db = getDatabase();

      const result = await db.query(
        `SELECT start_task($1, $2) as success`,
        [taskId, agentId]
      );

      const success = result.rows[0]?.success === true;

      if (success) {
        this.emit('task:assigned', { taskId, agentId });

        // Log execution
        await this.logExecution(taskId, agentId, 'info', 'Task assigned to agent');
      }

      return success;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'assignTask', error: errorMessage });
      throw error;
    }
  }

  /**
   * Mark a task as completed
   */
  async completeTask(
    taskId: string,
    result?: Record<string, unknown>,
    metrics?: Record<string, unknown>
  ): Promise<boolean> {
    try {
      const db = getDatabase();

      const queryResult = await db.query(
        `SELECT complete_task($1, $2, $3) as success`,
        [taskId, JSON.stringify(result || {}), JSON.stringify(metrics || {})]
      );

      const success = queryResult.rows[0]?.success === true;

      if (success) {
        // Get full task for event
        const taskResult = await db.query<QueuedTask>(
          `SELECT * FROM tasks WHERE id = $1`,
          [taskId]
        );

        this.emit('task:completed', { task: taskResult.rows[0], result });

        // Log completion
        const task = taskResult.rows[0];
        if (task?.assignedAgentId) {
          await this.logExecution(taskId, task.assignedAgentId, 'info', 'Task completed successfully', result);
        }
      }

      return success;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'completeTask', error: errorMessage });
      throw error;
    }
  }

  /**
   * Mark a task as failed with optional retry
   */
  async failTask(
    taskId: string,
    errorMessage: string,
    shouldRetry = true
  ): Promise<{ status: string; retryCount: number; maxRetries: number }> {
    try {
      const db = getDatabase();

      const result = await db.query<{ status: string; retry_count: number; max_retries: number }>(
        `SELECT fail_task($1, $2, $3) as result`,
        [taskId, errorMessage, shouldRetry]
      );

      const failResult = result.rows[0]?.result as { status: string; retry_count: number; max_retries: number };

      if (failResult.status === 'retrying') {
        this.emit('task:retrying', { taskId, retryCount: failResult.retry_count, maxRetries: failResult.max_retries });
      } else {
        this.emit('task:failed', { taskId, errorMessage });
      }

      // Log failure
      await this.logExecution(taskId, undefined, 'error', `Task failed: ${errorMessage}`, { shouldRetry, ...failResult });

      return {
        status: failResult.status,
        retryCount: failResult.retry_count,
        maxRetries: failResult.max_retries,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'failTask', error: errMsg });
      throw error;
    }
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<QueuedTask | null> {
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
          execution_context as "executionContext",
          created_at as "createdAt", updated_at as "updatedAt"
        FROM tasks WHERE id = $1`,
        [taskId]
      );

      return result.rows[0] || null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'getTask', error: errorMessage });
      throw error;
    }
  }

  /**
   * Get all tasks for the project with optional filtering
   */
  async getTasks(filters?: {
    status?: TaskStatus | TaskStatus[];
    agentId?: string;
    limit?: number;
    offset?: number;
  }): Promise<QueuedTask[]> {
    try {
      const db = getDatabase();
      const conditions: string[] = ['project_id = $1'];
      const params: unknown[] = [this.projectId];
      let paramIndex = 2;

      if (filters?.status) {
        const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
        conditions.push(`status = ANY($${paramIndex})`);
        params.push(statuses);
        paramIndex++;
      }

      if (filters?.agentId) {
        conditions.push(`assigned_agent_id = $${paramIndex}`);
        params.push(filters.agentId);
        paramIndex++;
      }

      let query = `
        SELECT
          id, project_id as "projectId", parent_task_id as "parentTaskId",
          title, description, type, status, priority,
          specification, assigned_agent_id as "assignedAgentId",
          assigned_at as "assignedAt", started_at as "startedAt",
          completed_at as "completedAt", result, error_message as "errorMessage",
          retry_count as "retryCount", max_retries as "maxRetries",
          created_at as "createdAt", updated_at as "updatedAt"
        FROM tasks
        WHERE ${conditions.join(' AND ')}
        ORDER BY priority DESC, created_at ASC
      `;

      if (filters?.limit) {
        query += ` LIMIT ${filters.limit}`;
      }
      if (filters?.offset) {
        query += ` OFFSET ${filters.offset}`;
      }

      const result = await db.query<QueuedTask>(query, params);
      return result.rows;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'getTasks', error: errorMessage });
      throw error;
    }
  }

  /**
   * Get task queue statistics
   */
  async getQueueStats(): Promise<{
    pending: number;
    assigned: number;
    inProgress: number;
    completed: number;
    failed: number;
    blocked: number;
    avgWaitTimeMs: number;
    avgExecutionTimeMs: number;
  }> {
    try {
      const db = getDatabase();

      const statsResult = await db.query<{
        status: string;
        count: string;
        avg_wait: string;
        avg_exec: string;
      }>(
        `SELECT
          status,
          COUNT(*) as count,
          AVG(EXTRACT(EPOCH FROM (started_at - created_at)) * 1000) as avg_wait,
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_exec
        FROM tasks
        WHERE project_id = $1
        GROUP BY status`,
        [this.projectId]
      );

      const stats: Record<string, number> = {
        pending: 0,
        assigned: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        blocked: 0,
      };

      let avgWaitTimeMs = 0;
      let avgExecutionTimeMs = 0;
      let waitCount = 0;
      let execCount = 0;

      for (const row of statsResult.rows) {
        stats[row.status] = parseInt(row.count, 10);

        if (row.avg_wait) {
          avgWaitTimeMs += parseFloat(row.avg_wait) * parseInt(row.count, 10);
          waitCount += parseInt(row.count, 10);
        }
        if (row.avg_exec) {
          avgExecutionTimeMs += parseFloat(row.avg_exec) * parseInt(row.count, 10);
          execCount += parseInt(row.count, 10);
        }
      }

      return {
        pending: stats.pending,
        assigned: stats.assigned,
        inProgress: stats.in_progress,
        completed: stats.completed,
        failed: stats.failed,
        blocked: stats.blocked,
        avgWaitTimeMs: waitCount > 0 ? avgWaitTimeMs / waitCount : 0,
        avgExecutionTimeMs: execCount > 0 ? avgExecutionTimeMs / execCount : 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'getQueueStats', error: errorMessage });
      throw error;
    }
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string, reason?: string): Promise<boolean> {
    try {
      const db = getDatabase();

      const result = await db.query(
        `UPDATE tasks
         SET status = 'cancelled',
             error_message = $2,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND status IN ('pending', 'assigned')
         RETURNING id`,
        [taskId, reason || 'Cancelled by user']
      );

      if (result.rowCount && result.rowCount > 0) {
        this.emit('task:cancelled', { taskId, reason });
        return true;
      }

      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'cancelTask', error: errorMessage });
      throw error;
    }
  }

  /**
   * Log task execution event
   */
  private async logExecution(
    taskId: string,
    agentId: string | undefined,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      const db = getDatabase();

      await db.query(
        `INSERT INTO execution_logs (project_id, agent_id, task_id, log_level, message, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [this.projectId, agentId || null, taskId, level, message, JSON.stringify(metadata || {})]
      );
    } catch (error) {
      // Non-critical, just log the error
      console.error('Failed to log execution:', error);
    }
  }

  /**
   * Process the queue (called periodically)
   */
  private async processQueue(): Promise<void> {
    // This method can be used to implement background task processing
    // For now, it emits an event that orchestrators can listen to
    this.emit('queue:poll');
  }
}

// Factory function
export function createTaskQueue(options: TaskQueueOptions): TaskQueue {
  return new TaskQueue(options);
}
