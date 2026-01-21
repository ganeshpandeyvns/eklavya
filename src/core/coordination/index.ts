/**
 * Multi-Agent Coordination Module
 * Demo₅: Coordinates multiple agents working on the same project
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { AgentType, Task, Message } from '../../types/index.js';
import { getDatabase } from '../../lib/database.js';
import { MessageBus } from '../message-bus/index.js';

export interface AgentSpec {
  type: AgentType;
  workingDirectory?: string;
  environment?: Record<string, string>;
}

export interface SpawnResult {
  agentId: string;
  type: AgentType;
  success: boolean;
  error?: string;
}

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  success: boolean;
  error?: string;
}

export interface FileLock {
  id: string;
  agentId: string;
  filePath: string;
  lockedAt: Date;
  expiresAt: Date;
}

export interface Conflict {
  id: string;
  filePath: string;
  agentAId: string;
  agentBId: string;
  conflictType: string;
  status: 'pending' | 'resolved';
  resolution?: string;
}

export interface CoordinationStatus {
  projectId: string;
  maxAgents: number;
  activeAgents: number;
  pendingTasks: number;
  activeTasks: number;
  activeLocks: number;
  pendingConflicts: number;
}

export interface CoordinatorOptions {
  projectId: string;
  messageBus?: MessageBus;
  maxConcurrentAgents?: number;
}

/**
 * AgentCoordinator manages multiple agents working on the same project.
 * It handles spawning, task distribution, messaging, and conflict resolution.
 *
 * Features:
 * - Concurrent agent spawning with configurable limits
 * - Intelligent task routing based on agent type and workload
 * - File locking to prevent concurrent edit conflicts
 * - Conflict detection and resolution strategies
 * - Real-time messaging between agents
 *
 * @example
 * ```typescript
 * const coordinator = createCoordinator({ projectId: 'uuid', maxConcurrentAgents: 5 });
 * await coordinator.initialize();
 * const results = await coordinator.spawnAgents([{ type: 'developer' }, { type: 'tester' }]);
 * ```
 */
export class AgentCoordinator extends EventEmitter {
  private readonly projectId: string;
  private readonly messageBus?: MessageBus;
  private readonly maxConcurrentAgents: number;

  /**
   * Creates a new AgentCoordinator instance.
   * @param options - Configuration options for the coordinator
   * @throws {Error} If projectId is not provided
   */
  constructor(options: CoordinatorOptions) {
    super();
    if (!options.projectId) {
      throw new Error('projectId is required for AgentCoordinator');
    }
    this.projectId = options.projectId;
    this.messageBus = options.messageBus;
    this.maxConcurrentAgents = options.maxConcurrentAgents || 10;
  }

  /**
   * Initialize coordination for the project
   */
  async initialize(): Promise<void> {
    const db = getDatabase();

    // Create or update coordination record
    await db.query(
      `INSERT INTO agent_coordination (project_id, max_concurrent_agents)
       VALUES ($1, $2)
       ON CONFLICT (project_id) DO UPDATE SET
         max_concurrent_agents = $2,
         updated_at = NOW()`,
      [this.projectId, this.maxConcurrentAgents]
    );

    this.emit('initialized', { projectId: this.projectId });
  }

  /**
   * Check if we can spawn more agents
   */
  async canSpawnAgent(): Promise<{ canSpawn: boolean; currentCount: number; maxCount: number }> {
    const db = getDatabase();
    const result = await db.query<{ can_spawn: boolean; current_count: number; max_count: number }>(
      `SELECT * FROM check_agent_limit($1)`,
      [this.projectId]
    );

    const row = result.rows[0];
    return {
      canSpawn: row.can_spawn,
      currentCount: row.current_count,
      maxCount: row.max_count,
    };
  }

  /**
   * Spawn multiple agents concurrently with configurable limits.
   * Agents are spawned up to the available capacity based on max concurrent settings.
   *
   * @param specs - Array of agent specifications to spawn
   * @returns Array of spawn results indicating success/failure for each agent
   */
  async spawnAgents(specs: AgentSpec[]): Promise<SpawnResult[]> {
    // Input validation
    if (!Array.isArray(specs) || specs.length === 0) {
      return [];
    }

    const results: SpawnResult[] = [];
    const db = getDatabase();

    // Check limits first
    const { canSpawn, currentCount, maxCount } = await this.canSpawnAgent();
    const availableSlots = maxCount - currentCount;

    if (!canSpawn || availableSlots <= 0) {
      return specs.map(spec => ({
        agentId: '',
        type: spec.type,
        success: false,
        error: `Agent limit reached (${currentCount}/${maxCount})`,
      }));
    }

    // Spawn up to available slots
    const toSpawn = specs.slice(0, availableSlots);

    for (const spec of toSpawn) {
      try {
        const agentId = uuidv4();

        await db.query(
          `INSERT INTO agents (id, project_id, type, status, created_at, updated_at)
           VALUES ($1, $2, $3, 'initializing', NOW(), NOW())`,
          [agentId, this.projectId, spec.type]
        );

        // Update to idle after spawn
        await db.query(
          `UPDATE agents SET status = 'idle', updated_at = NOW() WHERE id = $1`,
          [agentId]
        );

        // Record coordination message
        await this.recordMessage('AGENT_STARTED', agentId, null, { agentType: spec.type });

        results.push({
          agentId,
          type: spec.type,
          success: true,
        });

        this.emit('agentSpawned', { agentId, type: spec.type });
      } catch (error) {
        results.push({
          agentId: '',
          type: spec.type,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Mark remaining specs as failed due to limits
    for (let i = availableSlots; i < specs.length; i++) {
      results.push({
        agentId: '',
        type: specs[i].type,
        success: false,
        error: 'Agent limit exceeded',
      });
    }

    return results;
  }

  /**
   * Get all active agents for the project
   */
  async getActiveAgents(): Promise<Array<{
    agentId: string;
    type: AgentType;
    status: string;
    activeTasks: number;
    activeLocks: number;
  }>> {
    const db = getDatabase();
    const result = await db.query<{
      agent_id: string;
      agent_type: string;
      agent_status: string;
      active_tasks: number;
      active_locks: number;
    }>(
      `SELECT * FROM agent_workload_summary WHERE project_id = $1`,
      [this.projectId]
    );

    return result.rows.map(row => ({
      agentId: row.agent_id,
      type: row.agent_type as AgentType,
      status: row.agent_status,
      activeTasks: row.active_tasks,
      activeLocks: row.active_locks,
    }));
  }

  /**
   * Get coordination status for the project
   */
  async getStatus(): Promise<CoordinationStatus> {
    const db = getDatabase();
    const result = await db.query<{
      project_id: string;
      max_agents: number;
      active_agents: number;
      pending_tasks: number;
      active_tasks: number;
      active_locks: number;
      pending_conflicts: number;
    }>(
      `SELECT * FROM project_coordination_status WHERE project_id = $1`,
      [this.projectId]
    );

    const row = result.rows[0];
    if (!row) {
      return {
        projectId: this.projectId,
        maxAgents: this.maxConcurrentAgents,
        activeAgents: 0,
        pendingTasks: 0,
        activeTasks: 0,
        activeLocks: 0,
        pendingConflicts: 0,
      };
    }

    return {
      projectId: row.project_id,
      maxAgents: row.max_agents,
      activeAgents: row.active_agents,
      pendingTasks: row.pending_tasks,
      activeTasks: row.active_tasks,
      activeLocks: row.active_locks,
      pendingConflicts: row.pending_conflicts,
    };
  }

  /**
   * Route a task to the best available agent
   */
  async routeTask(taskId: string, preferredType?: AgentType): Promise<string | null> {
    const db = getDatabase();
    const result = await db.query<{ route_task_to_agent: string }>(
      `SELECT route_task_to_agent($1, $2)`,
      [taskId, preferredType || null]
    );

    return result.rows[0]?.route_task_to_agent || null;
  }

  /**
   * Assign multiple tasks to agents
   */
  async assignTasks(tasks: Task[]): Promise<TaskAssignment[]> {
    const results: TaskAssignment[] = [];

    for (const task of tasks) {
      const agentId = await this.routeTask(task.id);

      if (agentId) {
        const db = getDatabase();
        const assignResult = await db.query<{ success: boolean }>(
          `SELECT start_task($1, $2) as success`,
          [task.id, agentId]
        );

        const success = assignResult.rows[0]?.success === true;

        if (success) {
          await this.recordMessage('TASK_CLAIMED', agentId, null, { taskId: task.id });
        }

        results.push({
          taskId: task.id,
          agentId,
          success,
          error: success ? undefined : 'Failed to assign task',
        });

        this.emit('taskAssigned', { taskId: task.id, agentId, success });
      } else {
        results.push({
          taskId: task.id,
          agentId: '',
          success: false,
          error: 'No available agent found',
        });
      }
    }

    return results;
  }

  /**
   * Acquire a file lock for an agent to prevent concurrent modifications.
   * If the agent already holds the lock, it will be extended.
   *
   * @param agentId - The ID of the agent requesting the lock
   * @param filePath - The path of the file to lock
   * @param durationMinutes - Lock duration in minutes (default: 5)
   * @returns Object with success status, lockId if successful, and message
   */
  async acquireLock(agentId: string, filePath: string, durationMinutes = 5): Promise<{
    success: boolean;
    lockId?: string;
    message: string;
  }> {
    // Input validation
    if (!agentId || !filePath) {
      return { success: false, message: 'agentId and filePath are required' };
    }

    const db = getDatabase();
    const result = await db.query<{ success: boolean; lock_id: string; message: string }>(
      `SELECT * FROM acquire_file_lock($1, $2, $3, $4)`,
      [this.projectId, agentId, filePath, durationMinutes]
    );

    const row = result.rows[0];

    if (row.success) {
      await this.recordMessage('FILE_LOCKED', agentId, null, { filePath });
      this.emit('fileLocked', { agentId, filePath, lockId: row.lock_id });
    }

    return {
      success: row.success,
      lockId: row.lock_id,
      message: row.message,
    };
  }

  /**
   * Release a file lock
   */
  async releaseLock(lockId: string, agentId: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db.query<{ release_file_lock: boolean }>(
      `SELECT release_file_lock($1, $2)`,
      [lockId, agentId]
    );

    const success = result.rows[0]?.release_file_lock === true;

    if (success) {
      await this.recordMessage('FILE_RELEASED', agentId, null, { lockId });
      this.emit('fileReleased', { agentId, lockId });
    }

    return success;
  }

  /**
   * Get all active locks for the project
   */
  async getActiveLocks(): Promise<FileLock[]> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      agent_id: string;
      file_path: string;
      locked_at: Date;
      expires_at: Date;
    }>(
      `SELECT * FROM file_locks
       WHERE project_id = $1 AND expires_at > NOW()
       ORDER BY locked_at DESC`,
      [this.projectId]
    );

    return result.rows.map(row => ({
      id: row.id,
      agentId: row.agent_id,
      filePath: row.file_path,
      lockedAt: row.locked_at,
      expiresAt: row.expires_at,
    }));
  }

  /**
   * Check if a file is locked
   */
  async isFileLocked(filePath: string): Promise<{ locked: boolean; lockedBy?: string }> {
    const db = getDatabase();
    const result = await db.query<{ agent_id: string }>(
      `SELECT agent_id FROM file_locks
       WHERE project_id = $1 AND file_path = $2 AND expires_at > NOW()`,
      [this.projectId, filePath]
    );

    if (result.rows.length > 0) {
      return { locked: true, lockedBy: result.rows[0].agent_id };
    }
    return { locked: false };
  }

  /**
   * Detect and record a conflict between two agents modifying the same file.
   * Creates a conflict record that can be resolved using resolveConflict().
   *
   * @param agentAId - The ID of the first agent involved in the conflict
   * @param agentBId - The ID of the second agent involved in the conflict
   * @param filePath - The path of the file where conflict occurred
   * @param conflictType - Type of conflict (e.g., 'concurrent_edit', 'merge_conflict')
   * @returns The created conflict record
   * @throws {Error} If any required parameter is missing
   */
  async detectConflict(agentAId: string, agentBId: string, filePath: string, conflictType: string): Promise<Conflict> {
    // Input validation
    if (!agentAId || !agentBId || !filePath || !conflictType) {
      throw new Error('All parameters (agentAId, agentBId, filePath, conflictType) are required');
    }

    const db = getDatabase();
    const conflictId = uuidv4();

    await db.query(
      `INSERT INTO file_conflicts (id, project_id, file_path, agent_a_id, agent_b_id, conflict_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [conflictId, this.projectId, filePath, agentAId, agentBId, conflictType]
    );

    await this.recordMessage('CONFLICT_DETECTED', agentAId, agentBId, { filePath, conflictType });

    this.emit('conflictDetected', { conflictId, filePath, agentAId, agentBId, conflictType });

    return {
      id: conflictId,
      filePath,
      agentAId,
      agentBId,
      conflictType,
      status: 'pending',
    };
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(conflictId: string, resolution: 'merge' | 'override_a' | 'override_b' | 'reject', resolvedBy: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db.query(
      `UPDATE file_conflicts
       SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [conflictId, resolution, resolvedBy]
    );

    const success = (result.rowCount ?? 0) > 0;

    if (success) {
      this.emit('conflictResolved', { conflictId, resolution, resolvedBy });
    }

    return success;
  }

  /**
   * Get pending conflicts
   */
  async getPendingConflicts(): Promise<Conflict[]> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      file_path: string;
      agent_a_id: string;
      agent_b_id: string;
      conflict_type: string;
      status: string;
      resolution: string;
    }>(
      `SELECT * FROM file_conflicts
       WHERE project_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [this.projectId]
    );

    return result.rows.map(row => ({
      id: row.id,
      filePath: row.file_path,
      agentAId: row.agent_a_id,
      agentBId: row.agent_b_id,
      conflictType: row.conflict_type,
      status: row.status as 'pending' | 'resolved',
      resolution: row.resolution,
    }));
  }

  /**
   * Record a coordination message
   */
  private async recordMessage(
    type: string,
    fromAgentId: string | null,
    toAgentId: string | null,
    payload: Record<string, unknown>
  ): Promise<void> {
    const db = getDatabase();
    await db.query(
      `SELECT record_coordination_message($1, $2, $3, $4, $5)`,
      [this.projectId, type, fromAgentId, toAgentId, JSON.stringify(payload)]
    );

    // Also broadcast via message bus if available
    if (this.messageBus) {
      try {
        await this.messageBus.broadcast('broadcast', payload, fromAgentId || undefined);
      } catch {
        // Non-critical, ignore broadcast errors
      }
    }
  }

  /**
   * Relay a message between agents
   */
  async relay(message: Message): Promise<void> {
    await this.recordMessage(
      message.type,
      message.fromAgentId || null,
      message.toAgentId || null,
      message.payload as Record<string, unknown>
    );

    if (this.messageBus && message.toAgentId) {
      await this.messageBus.sendToAgent(message.toAgentId, message.type as any, message.payload as Record<string, unknown>, message.fromAgentId);
    }

    this.emit('messageRelayed', message);
  }

  /**
   * Terminate an agent
   */
  async terminateAgent(agentId: string): Promise<boolean> {
    const db = getDatabase();

    // Release all locks held by this agent
    await db.query(
      `DELETE FROM file_locks WHERE agent_id = $1`,
      [agentId]
    );

    // Update agent status
    const result = await db.query(
      `UPDATE agents SET status = 'terminated', updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [agentId]
    );

    const success = (result.rowCount ?? 0) > 0;

    if (success) {
      this.emit('agentTerminated', { agentId });
    }

    return success;
  }

  /**
   * Rebalance tasks across agents
   */
  async rebalance(): Promise<{ reassigned: number }> {
    const db = getDatabase();
    let reassigned = 0;

    // Get agents with high workload
    const overloaded = await db.query<{ agent_id: string; active_tasks: number }>(
      `SELECT agent_id, active_tasks FROM agent_workload_summary
       WHERE project_id = $1 AND active_tasks > 3
       ORDER BY active_tasks DESC`,
      [this.projectId]
    );

    // Get agents with low workload
    const underloaded = await db.query<{ agent_id: string; active_tasks: number }>(
      `SELECT agent_id, active_tasks FROM agent_workload_summary
       WHERE project_id = $1 AND agent_status = 'idle' AND active_tasks = 0
       LIMIT 5`,
      [this.projectId]
    );

    if (underloaded.rows.length === 0) {
      return { reassigned: 0 };
    }

    // Try to reassign pending tasks from overloaded agents
    for (const overloadedAgent of overloaded.rows) {
      const pendingTasks = await db.query<{ id: string }>(
        `SELECT id FROM tasks
         WHERE assigned_agent_id = $1 AND status = 'pending'
         LIMIT 1`,
        [overloadedAgent.agent_id]
      );

      if (pendingTasks.rows.length > 0 && underloaded.rows.length > reassigned) {
        const targetAgent = underloaded.rows[reassigned];

        await db.query(
          `UPDATE tasks SET assigned_agent_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [targetAgent.agent_id, pendingTasks.rows[0].id]
        );

        reassigned++;
        this.emit('taskReassigned', {
          taskId: pendingTasks.rows[0].id,
          fromAgent: overloadedAgent.agent_id,
          toAgent: targetAgent.agent_id,
        });
      }
    }

    return { reassigned };
  }
}

// Factory function
export function createCoordinator(options: CoordinatorOptions): AgentCoordinator {
  return new AgentCoordinator(options);
}

// Singleton for default project
let defaultCoordinator: AgentCoordinator | null = null;

export function getCoordinator(options?: CoordinatorOptions): AgentCoordinator {
  if (!defaultCoordinator && options) {
    defaultCoordinator = new AgentCoordinator(options);
  }
  if (!defaultCoordinator) {
    throw new Error('Coordinator not initialized. Call with options first.');
  }
  return defaultCoordinator;
}

export function initializeCoordinator(options: CoordinatorOptions): AgentCoordinator {
  defaultCoordinator = new AgentCoordinator(options);
  return defaultCoordinator;
}
