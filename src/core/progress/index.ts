/**
 * Progress Tracking Module
 * Demo₆: Real-Time Portal
 *
 * Provides real-time project progress monitoring:
 * - Overall progress calculation
 * - Agent status summary
 * - Task status summary
 * - Budget tracking
 * - Progress snapshots for historical tracking
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';

export interface ProjectProgress {
  projectId: string;
  timestamp: Date;

  // Overall progress
  overallPercent: number;
  currentPhase: string;

  // Agent status summary
  agents: {
    total: number;
    active: number;
    idle: number;
    working: number;
  };

  // Task status summary
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  };

  // Budget tracking
  budget: {
    used: number;
    total: number;
    percentUsed: number;
  };

  // Time tracking
  elapsed: number; // ms
  estimatedRemaining?: number;
}

export interface ProgressSnapshot {
  id: string;
  projectId: string;
  overallPercent: number;
  currentPhase: string;
  agentsTotal: number;
  agentsActive: number;
  agentsIdle: number;
  agentsWorking: number;
  tasksTotal: number;
  tasksPending: number;
  tasksInProgress: number;
  tasksCompleted: number;
  tasksFailed: number;
  budgetUsed: number;
  budgetTotal: number;
  elapsedMs: number;
  estimatedRemainingMs?: number;
  createdAt: Date;
}

/**
 * ProgressService tracks and broadcasts project progress.
 */
export class ProgressService extends EventEmitter {
  private progressCache: Map<string, ProjectProgress> = new Map();
  private projectStartTimes: Map<string, Date> = new Map();

  constructor() {
    super();
  }

  /**
   * Get current progress for a project.
   */
  async getProjectProgress(projectId: string): Promise<ProjectProgress> {
    const db = getDatabase();

    // Use the database function to calculate progress
    const result = await db.query<{
      overall_percent: number;
      current_phase: string;
      agents_total: number;
      agents_active: number;
      agents_idle: number;
      agents_working: number;
      tasks_total: number;
      tasks_pending: number;
      tasks_in_progress: number;
      tasks_completed: number;
      tasks_failed: number;
      budget_used: string;
      budget_total: string;
    }>(
      `SELECT * FROM calculate_project_progress($1)`,
      [projectId]
    );

    if (result.rows.length === 0) {
      return this.getEmptyProgress(projectId);
    }

    const row = result.rows[0];
    const budgetUsed = parseFloat(row.budget_used) || 0;
    const budgetTotal = parseFloat(row.budget_total) || 100;

    // Get project start time
    const startTime = await this.getProjectStartTime(projectId);
    const elapsed = startTime ? Date.now() - startTime.getTime() : 0;

    // Estimate remaining time based on progress
    let estimatedRemaining: number | undefined;
    if (row.overall_percent > 0 && row.overall_percent < 100) {
      const timePerPercent = elapsed / row.overall_percent;
      estimatedRemaining = Math.round(timePerPercent * (100 - row.overall_percent));
    }

    const progress: ProjectProgress = {
      projectId,
      timestamp: new Date(),
      overallPercent: row.overall_percent,
      currentPhase: row.current_phase,
      agents: {
        total: row.agents_total,
        active: row.agents_active,
        idle: row.agents_idle,
        working: row.agents_working,
      },
      tasks: {
        total: row.tasks_total,
        pending: row.tasks_pending,
        inProgress: row.tasks_in_progress,
        completed: row.tasks_completed,
        failed: row.tasks_failed,
      },
      budget: {
        used: budgetUsed,
        total: budgetTotal,
        percentUsed: budgetTotal > 0 ? (budgetUsed / budgetTotal) * 100 : 0,
      },
      elapsed,
      estimatedRemaining,
    };

    // Update cache
    this.progressCache.set(projectId, progress);

    return progress;
  }

  /**
   * Get progress for all projects.
   */
  async getAllProjectsProgress(): Promise<ProjectProgress[]> {
    const db = getDatabase();

    const projectsResult = await db.query<{ id: string }>(
      `SELECT id FROM projects WHERE status IN ('active', 'planning')`
    );

    const progressPromises = projectsResult.rows.map(row =>
      this.getProjectProgress(row.id)
    );

    return Promise.all(progressPromises);
  }

  /**
   * Save a progress snapshot for historical tracking.
   */
  async saveProgressSnapshot(projectId: string): Promise<ProgressSnapshot> {
    const progress = await this.getProjectProgress(projectId);
    const db = getDatabase();

    const result = await db.query<{
      id: string;
      created_at: Date;
    }>(
      `INSERT INTO project_progress (
        project_id, overall_percent, current_phase,
        agents_total, agents_active, agents_idle, agents_working,
        tasks_total, tasks_pending, tasks_in_progress, tasks_completed, tasks_failed,
        budget_used, budget_total, elapsed_ms, estimated_remaining_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, created_at`,
      [
        projectId,
        progress.overallPercent,
        progress.currentPhase,
        progress.agents.total,
        progress.agents.active,
        progress.agents.idle,
        progress.agents.working,
        progress.tasks.total,
        progress.tasks.pending,
        progress.tasks.inProgress,
        progress.tasks.completed,
        progress.tasks.failed,
        progress.budget.used,
        progress.budget.total,
        progress.elapsed,
        progress.estimatedRemaining || null,
      ]
    );

    const row = result.rows[0];

    return {
      id: row.id,
      projectId,
      overallPercent: progress.overallPercent,
      currentPhase: progress.currentPhase,
      agentsTotal: progress.agents.total,
      agentsActive: progress.agents.active,
      agentsIdle: progress.agents.idle,
      agentsWorking: progress.agents.working,
      tasksTotal: progress.tasks.total,
      tasksPending: progress.tasks.pending,
      tasksInProgress: progress.tasks.inProgress,
      tasksCompleted: progress.tasks.completed,
      tasksFailed: progress.tasks.failed,
      budgetUsed: progress.budget.used,
      budgetTotal: progress.budget.total,
      elapsedMs: progress.elapsed,
      estimatedRemainingMs: progress.estimatedRemaining,
      createdAt: row.created_at,
    };
  }

  /**
   * Get historical progress snapshots for a project.
   */
  async getProgressHistory(
    projectId: string,
    options: { limit?: number; since?: Date } = {}
  ): Promise<ProgressSnapshot[]> {
    const db = getDatabase();
    const { limit = 100, since } = options;

    let query = `SELECT * FROM project_progress WHERE project_id = $1`;
    const params: unknown[] = [projectId];
    let paramIndex = 2;

    if (since) {
      query += ` AND created_at > $${paramIndex++}`;
      params.push(since);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.query<{
      id: string;
      project_id: string;
      overall_percent: number;
      current_phase: string;
      agents_total: number;
      agents_active: number;
      agents_idle: number;
      agents_working: number;
      tasks_total: number;
      tasks_pending: number;
      tasks_in_progress: number;
      tasks_completed: number;
      tasks_failed: number;
      budget_used: string;
      budget_total: string;
      elapsed_ms: string;
      estimated_remaining_ms: string;
      created_at: Date;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      overallPercent: row.overall_percent,
      currentPhase: row.current_phase,
      agentsTotal: row.agents_total,
      agentsActive: row.agents_active,
      agentsIdle: row.agents_idle,
      agentsWorking: row.agents_working,
      tasksTotal: row.tasks_total,
      tasksPending: row.tasks_pending,
      tasksInProgress: row.tasks_in_progress,
      tasksCompleted: row.tasks_completed,
      tasksFailed: row.tasks_failed,
      budgetUsed: parseFloat(row.budget_used) || 0,
      budgetTotal: parseFloat(row.budget_total) || 100,
      elapsedMs: parseInt(row.elapsed_ms, 10) || 0,
      estimatedRemainingMs: row.estimated_remaining_ms
        ? parseInt(row.estimated_remaining_ms, 10)
        : undefined,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get cached progress (without database query).
   */
  getCachedProgress(projectId: string): ProjectProgress | undefined {
    return this.progressCache.get(projectId);
  }

  /**
   * Broadcast progress update via event emitter.
   */
  async broadcastProgressUpdate(projectId: string): Promise<ProjectProgress> {
    const progress = await this.getProjectProgress(projectId);
    this.emit('progress:updated', progress);
    return progress;
  }

  /**
   * Start tracking time for a project.
   */
  async startProjectTimer(projectId: string): Promise<void> {
    this.projectStartTimes.set(projectId, new Date());
    // Note: We use the project's created_at as the start time
    // since there's no dedicated started_at column
  }

  /**
   * Get project start time.
   */
  private async getProjectStartTime(projectId: string): Promise<Date | null> {
    // Check memory cache first
    if (this.projectStartTimes.has(projectId)) {
      return this.projectStartTimes.get(projectId)!;
    }

    // Fall back to database - use created_at as the start time
    const db = getDatabase();
    const result = await db.query<{ created_at: Date }>(
      `SELECT created_at FROM projects WHERE id = $1`,
      [projectId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const startTime = result.rows[0].created_at;
    if (startTime) {
      this.projectStartTimes.set(projectId, startTime);
    }

    return startTime;
  }

  /**
   * Calculate progress velocity (progress per hour).
   */
  async getProgressVelocity(projectId: string): Promise<number> {
    const progress = await this.getProjectProgress(projectId);

    if (progress.elapsed <= 0 || progress.overallPercent <= 0) {
      return 0;
    }

    // Calculate percent per hour
    const hoursElapsed = progress.elapsed / (1000 * 60 * 60);
    return progress.overallPercent / hoursElapsed;
  }

  /**
   * Get progress comparison between two snapshots.
   */
  async getProgressDelta(
    projectId: string,
    fromSnapshot: string,
    toSnapshot?: string
  ): Promise<{
    percentChange: number;
    tasksCompleted: number;
    timeElapsed: number;
    budgetUsed: number;
  }> {
    const db = getDatabase();

    // Get "from" snapshot
    const fromResult = await db.query<ProgressSnapshot>(
      `SELECT * FROM project_progress WHERE id = $1`,
      [fromSnapshot]
    );

    if (fromResult.rows.length === 0) {
      throw new Error(`Snapshot not found: ${fromSnapshot}`);
    }

    const from = fromResult.rows[0];

    // Get "to" snapshot or current progress
    let to: {
      overallPercent: number;
      tasksCompleted: number;
      elapsedMs: number;
      budgetUsed: number;
    };

    if (toSnapshot) {
      const toResult = await db.query<{
        overall_percent: number;
        tasks_completed: number;
        elapsed_ms: string;
        budget_used: string;
      }>(
        `SELECT overall_percent, tasks_completed, elapsed_ms, budget_used FROM project_progress WHERE id = $1`,
        [toSnapshot]
      );

      if (toResult.rows.length === 0) {
        throw new Error(`Snapshot not found: ${toSnapshot}`);
      }

      const toRow = toResult.rows[0];
      to = {
        overallPercent: toRow.overall_percent,
        tasksCompleted: toRow.tasks_completed,
        elapsedMs: parseInt(toRow.elapsed_ms, 10) || 0,
        budgetUsed: parseFloat(toRow.budget_used) || 0,
      };
    } else {
      const current = await this.getProjectProgress(projectId);
      to = {
        overallPercent: current.overallPercent,
        tasksCompleted: current.tasks.completed,
        elapsedMs: current.elapsed,
        budgetUsed: current.budget.used,
      };
    }

    const fromRow = from as unknown as {
      overall_percent: number;
      tasks_completed: number;
      elapsed_ms: string;
      budget_used: string;
    };

    return {
      percentChange: to.overallPercent - fromRow.overall_percent,
      tasksCompleted: to.tasksCompleted - fromRow.tasks_completed,
      timeElapsed: to.elapsedMs - (parseInt(fromRow.elapsed_ms as string, 10) || 0),
      budgetUsed: to.budgetUsed - (parseFloat(fromRow.budget_used as string) || 0),
    };
  }

  /**
   * Clean up old progress snapshots.
   */
  async cleanupOldSnapshots(daysToKeep: number = 30): Promise<number> {
    const db = getDatabase();
    const result = await db.query(
      `DELETE FROM project_progress WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
      [daysToKeep]
    );

    return result.rowCount ?? 0;
  }

  /**
   * Get empty progress for a project with no data.
   */
  private getEmptyProgress(projectId: string): ProjectProgress {
    return {
      projectId,
      timestamp: new Date(),
      overallPercent: 0,
      currentPhase: 'not_started',
      agents: {
        total: 0,
        active: 0,
        idle: 0,
        working: 0,
      },
      tasks: {
        total: 0,
        pending: 0,
        inProgress: 0,
        completed: 0,
        failed: 0,
      },
      budget: {
        used: 0,
        total: 100,
        percentUsed: 0,
      },
      elapsed: 0,
    };
  }
}

// Factory functions
export function createProgressService(): ProgressService {
  return new ProgressService();
}

let defaultService: ProgressService | null = null;

export function getProgressService(): ProgressService {
  if (!defaultService) {
    defaultService = new ProgressService();
  }
  return defaultService;
}
