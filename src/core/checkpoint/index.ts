import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import type { Checkpoint, Agent } from '../../types/index.js';
import { getDatabase } from '../../lib/database.js';

export interface CheckpointOptions {
  intervalMs: number;
  maxCheckpointsPerAgent: number;
}

export interface AgentState {
  currentStep: string;
  progress: number;
  workingMemory: Record<string, unknown>;
  pendingActions: string[];
  lastAction?: string;
}

export interface FileState {
  workingDirectory: string;
  modifiedFiles: Array<{
    path: string;
    hash: string;
    size: number;
    lastModified: Date;
  }>;
}

export class CheckpointManager extends EventEmitter {
  private intervalMs: number;
  private maxCheckpointsPerAgent: number;
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: CheckpointOptions = { intervalMs: 900000, maxCheckpointsPerAgent: 10 }) {
    super();
    this.intervalMs = options.intervalMs;
    this.maxCheckpointsPerAgent = options.maxCheckpointsPerAgent;
  }

  /**
   * Start automatic checkpointing for an agent
   */
  startAutoCheckpoint(agentId: string, getState: () => Promise<Record<string, unknown>>): void {
    if (this.intervals.has(agentId)) {
      this.stopAutoCheckpoint(agentId);
    }

    const interval = setInterval(async () => {
      try {
        const state = await getState();
        await this.createCheckpoint(agentId, state);
      } catch (error) {
        console.error(`Checkpoint failed for agent ${agentId}:`, error);
      }
    }, this.intervalMs);

    this.intervals.set(agentId, interval);
  }

  /**
   * Stop automatic checkpointing for an agent
   */
  stopAutoCheckpoint(agentId: string): void {
    const interval = this.intervals.get(agentId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(agentId);
    }
  }

  /**
   * Create a checkpoint for an agent
   */
  async createCheckpoint(
    agentId: string,
    state: Record<string, unknown>,
    taskId?: string,
    fileState?: Record<string, unknown>,
    conversationSummary?: string,
    recoveryInstructions?: string
  ): Promise<Checkpoint> {
    const db = getDatabase();
    const checkpointId = uuidv4();

    await db.query(
      `INSERT INTO checkpoints (id, agent_id, task_id, state, file_state, conversation_summary, recovery_instructions, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        checkpointId,
        agentId,
        taskId || null,
        JSON.stringify(state),
        fileState ? JSON.stringify(fileState) : null,
        conversationSummary || null,
        recoveryInstructions || null,
      ]
    );

    // Clean up old checkpoints
    await this.cleanupOldCheckpoints(agentId);

    const result = await db.query<Checkpoint>(
      `SELECT * FROM checkpoints WHERE id = $1`,
      [checkpointId]
    );

    return result.rows[0];
  }

  /**
   * Get the latest checkpoint for an agent
   */
  async getLatestCheckpoint(agentId: string): Promise<Checkpoint | null> {
    const db = getDatabase();
    const result = await db.query<Checkpoint>(
      `SELECT * FROM checkpoints WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [agentId]
    );

    return result.rows[0] || null;
  }

  /**
   * Get all checkpoints for an agent
   */
  async getCheckpoints(agentId: string): Promise<Checkpoint[]> {
    const db = getDatabase();
    const result = await db.query<Checkpoint>(
      `SELECT * FROM checkpoints WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agentId]
    );

    return result.rows;
  }

  /**
   * Restore agent state from a checkpoint
   */
  async restoreFromCheckpoint(checkpointId: string): Promise<{
    checkpoint: Checkpoint;
    state: Record<string, unknown>;
    restoredFiles: number;
  }> {
    const db = getDatabase();

    try {
      const result = await db.query<Checkpoint>(
        `SELECT * FROM checkpoints WHERE id = $1 AND is_valid = true`,
        [checkpointId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Checkpoint ${checkpointId} not found or invalid`);
      }

      const checkpoint = result.rows[0];
      const state = typeof checkpoint.state === 'string'
        ? JSON.parse(checkpoint.state)
        : checkpoint.state;

      // Update restore count
      await db.query(
        `UPDATE checkpoints
         SET restored_count = COALESCE(restored_count, 0) + 1,
             last_restored_at = NOW()
         WHERE id = $1`,
        [checkpointId]
      );

      // Update agent status
      await db.query(
        `UPDATE agents
         SET status = 'idle',
             checkpoint_data = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [checkpoint.agentId, JSON.stringify(state)]
      );

      const restoredFiles = checkpoint.fileState ?
        (typeof checkpoint.fileState === 'string'
          ? JSON.parse(checkpoint.fileState)
          : checkpoint.fileState
        ).modifiedFiles?.length || 0 : 0;

      this.emit('checkpoint:restored', {
        checkpointId,
        agentId: checkpoint.agentId,
        restoredFiles,
      });

      return { checkpoint, state, restoredFiles };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'restoreFromCheckpoint', error: errorMessage });
      throw error;
    }
  }

  /**
   * Create a checkpoint before a risky operation
   */
  async createPreRiskyCheckpoint(
    agentId: string,
    state: Record<string, unknown>,
    operation: string,
    taskId?: string
  ): Promise<Checkpoint> {
    return this.createCheckpoint(
      agentId,
      state,
      taskId,
      undefined,
      undefined,
      `Checkpoint before risky operation: ${operation}. Restore if something goes wrong.`
    );
  }

  /**
   * Create a checkpoint after task completion
   */
  async createTaskCompleteCheckpoint(
    agentId: string,
    state: Record<string, unknown>,
    taskId: string
  ): Promise<Checkpoint> {
    return this.createCheckpoint(
      agentId,
      state,
      taskId,
      undefined,
      `Task ${taskId} completed successfully`,
      `Agent ready for next task after completing ${taskId}`
    );
  }

  /**
   * Capture current file state from working directory
   */
  async captureFileState(workingDirectory: string): Promise<FileState> {
    try {
      const modifiedFiles: FileState['modifiedFiles'] = [];
      const files = await this.walkDirectory(workingDirectory);

      for (const filePath of files) {
        try {
          const stat = await fs.stat(filePath);
          const hash = `${stat.size}-${stat.mtime.getTime()}`;

          modifiedFiles.push({
            path: path.relative(workingDirectory, filePath),
            hash,
            size: stat.size,
            lastModified: stat.mtime,
          });
        } catch {
          // Skip files we can't read
        }
      }

      return { workingDirectory, modifiedFiles };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'captureFileState', error: errorMessage });
      throw error;
    }
  }

  /**
   * Invalidate a checkpoint
   */
  async invalidateCheckpoint(checkpointId: string, reason?: string): Promise<void> {
    const db = getDatabase();
    await db.query(
      `UPDATE checkpoints SET is_valid = false WHERE id = $1`,
      [checkpointId]
    );
    this.emit('checkpoint:invalidated', { checkpointId, reason });
  }

  /**
   * Get checkpoint statistics
   */
  async getCheckpointStats(projectId?: string): Promise<{
    totalCheckpoints: number;
    validCheckpoints: number;
    totalRestores: number;
    byAgent: Array<{
      agentId: string;
      checkpointCount: number;
      lastCheckpoint: Date;
    }>;
  }> {
    try {
      const db = getDatabase();
      const condition = projectId ? 'WHERE c.project_id = $1' : '';
      const params = projectId ? [projectId] : [];

      const statsResult = await db.query<{
        total: string;
        valid: string;
        restores: string;
      }>(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_valid = true OR is_valid IS NULL) as valid,
          COALESCE(SUM(COALESCE(restored_count, 0)), 0) as restores
        FROM checkpoints c
        ${condition}`,
        params
      );

      const byAgentResult = await db.query<{
        agent_id: string;
        count: string;
        last_checkpoint: Date;
      }>(
        `SELECT
          c.agent_id,
          COUNT(*) as count,
          MAX(c.created_at) as last_checkpoint
        FROM checkpoints c
        ${condition}
        GROUP BY c.agent_id
        ORDER BY count DESC`,
        params
      );

      return {
        totalCheckpoints: parseInt(statsResult.rows[0]?.total || '0', 10),
        validCheckpoints: parseInt(statsResult.rows[0]?.valid || '0', 10),
        totalRestores: parseInt(statsResult.rows[0]?.restores || '0', 10),
        byAgent: byAgentResult.rows.map(row => ({
          agentId: row.agent_id,
          checkpointCount: parseInt(row.count, 10),
          lastCheckpoint: row.last_checkpoint,
        })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { phase: 'getCheckpointStats', error: errorMessage });
      throw error;
    }
  }

  /**
   * Recursively walk a directory
   */
  private async walkDirectory(dir: string, files: string[] = []): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (['node_modules', '.git', 'dist', '.next'].includes(entry.name)) {
          continue;
        }

        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, files);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch {
      // Ignore permission errors
    }

    return files;
  }

  /**
   * Clean up old checkpoints beyond the max limit
   */
  private async cleanupOldCheckpoints(agentId: string): Promise<void> {
    const db = getDatabase();
    await db.query(
      `DELETE FROM checkpoints
       WHERE agent_id = $1
       AND id NOT IN (
         SELECT id FROM checkpoints
         WHERE agent_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       )`,
      [agentId, this.maxCheckpointsPerAgent]
    );
  }

  /**
   * Stop all auto-checkpoints
   */
  stopAll(): void {
    for (const [agentId] of this.intervals) {
      this.stopAutoCheckpoint(agentId);
    }
  }
}

// Singleton
let checkpointManager: CheckpointManager | null = null;

export function getCheckpointManager(options?: CheckpointOptions): CheckpointManager {
  if (!checkpointManager) {
    checkpointManager = new CheckpointManager(options);
  }
  return checkpointManager;
}
