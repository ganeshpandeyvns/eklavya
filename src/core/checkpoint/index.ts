import { v4 as uuidv4 } from 'uuid';
import type { Checkpoint, Agent } from '../../types/index.js';
import { getDatabase } from '../../lib/database.js';

export interface CheckpointOptions {
  intervalMs: number;
  maxCheckpointsPerAgent: number;
}

export class CheckpointManager {
  private intervalMs: number;
  private maxCheckpointsPerAgent: number;
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: CheckpointOptions = { intervalMs: 900000, maxCheckpointsPerAgent: 10 }) {
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
  }> {
    const db = getDatabase();
    const result = await db.query<Checkpoint>(
      `SELECT * FROM checkpoints WHERE id = $1`,
      [checkpointId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    const checkpoint = result.rows[0];
    const state = typeof checkpoint.state === 'string'
      ? JSON.parse(checkpoint.state)
      : checkpoint.state;

    return { checkpoint, state };
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
