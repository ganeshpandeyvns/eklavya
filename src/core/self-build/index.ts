/**
 * Self-Build Manager
 * Demo₈: Self-Build Test
 *
 * Manages autonomous project builds end-to-end:
 * - Configuration and initialization
 * - Execution plan management
 * - Phase and task coordination
 * - Result tracking and reporting
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';
import { ExecutionPlanGenerator, ExecutionPlan, ExecutionPhase } from './planner.js';
import { PhaseExecutor, PhaseResult, TaskResult, AgentResult } from './executor.js';

export type SelfBuildStatus = 'pending' | 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled';

export interface SelfBuildConfig {
  projectName: string;
  projectDescription: string;
  features: string[];
  techStack: string[];
  maxExecutionTime?: number;  // minutes, default 60
  maxBudget?: number;         // USD, default 50
  maxConcurrentAgents?: number; // default 5
  simulatedMode?: boolean;    // For testing without real agents
  simulatedDuration?: number; // ms per task in simulated mode
  simulatedSuccessRate?: number; // 0.0 - 1.0
}

export interface SelfBuildResult {
  success: boolean;
  projectId: string;
  runId: string;
  executionPlan?: ExecutionPlan;
  phases: PhaseResult[];
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalAgents: number;
  executionTimeMs: number;
  estimatedCost: number;
  errors: string[];
}

export interface SelfBuildRun {
  id: string;
  projectId: string;
  config: SelfBuildConfig;
  executionPlan?: ExecutionPlan;
  status: SelfBuildStatus;
  result?: SelfBuildResult;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalAgents: number;
  executionTimeMs?: number;
  estimatedCostUsd?: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface SelfBuildProgress {
  runId: string;
  status: SelfBuildStatus;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  progressPercent: number;
  currentPhase?: number;
  totalPhases?: number;
  elapsedTimeMs: number;
}

/**
 * SelfBuildManager orchestrates autonomous project builds.
 */
export class SelfBuildManager extends EventEmitter {
  private planner: ExecutionPlanGenerator;
  private executor: PhaseExecutor;

  constructor() {
    super();
    this.planner = new ExecutionPlanGenerator();
    this.executor = new PhaseExecutor();

    // Forward executor events
    this.executor.on('phase:started', (data) => this.emit('phase:started', data));
    this.executor.on('phase:completed', (data) => this.emit('phase:completed', data));
    this.executor.on('task:started', (data) => this.emit('task:started', data));
    this.executor.on('task:completed', (data) => this.emit('task:completed', data));
    this.executor.on('agent:spawned', (data) => this.emit('agent:spawned', data));
    this.executor.on('agent:completed', (data) => this.emit('agent:completed', data));
  }

  /**
   * Start a new self-build run.
   */
  async startBuild(projectId: string, config: SelfBuildConfig): Promise<SelfBuildRun> {
    if (!projectId) {
      throw new Error('projectId is required');
    }
    if (!config.projectName) {
      throw new Error('projectName is required');
    }

    const db = getDatabase();

    // Set defaults
    const fullConfig: SelfBuildConfig = {
      ...config,
      maxExecutionTime: config.maxExecutionTime ?? 60,
      maxBudget: config.maxBudget ?? 50,
      maxConcurrentAgents: config.maxConcurrentAgents ?? 5,
      simulatedMode: config.simulatedMode ?? false,
      simulatedDuration: config.simulatedDuration ?? 5000,
      simulatedSuccessRate: config.simulatedSuccessRate ?? 0.95,
    };

    try {
      const result = await db.query<{ start_self_build: string }>(
        `SELECT start_self_build($1, $2)`,
        [projectId, JSON.stringify(fullConfig)]
      );

      const runId = result.rows[0].start_self_build;
      const run = await this.getRun(runId);

      this.emit('build:started', run);
      return run;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to start self-build: ${message}`);
    }
  }

  /**
   * Get a self-build run by ID.
   */
  async getRun(runId: string): Promise<SelfBuildRun> {
    const db = getDatabase();

    const result = await db.query<{
      id: string;
      project_id: string;
      config: SelfBuildConfig;
      execution_plan: ExecutionPlan | null;
      status: string;
      result: SelfBuildResult | null;
      total_tasks: number;
      completed_tasks: number;
      failed_tasks: number;
      total_agents: number;
      execution_time_ms: number | null;
      estimated_cost_usd: string | null;
      created_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
    }>(
      `SELECT * FROM self_build_runs WHERE id = $1`,
      [runId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Self-build run not found: ${runId}`);
    }

    return this.mapRowToRun(result.rows[0]);
  }

  /**
   * List self-build runs for a project.
   */
  async listRuns(projectId: string, options: { status?: SelfBuildStatus; limit?: number } = {}): Promise<SelfBuildRun[]> {
    const db = getDatabase();
    const { status, limit = 20 } = options;

    let query = `SELECT * FROM self_build_runs WHERE project_id = $1`;
    const params: unknown[] = [projectId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex++}::self_build_status`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.query<{
      id: string;
      project_id: string;
      config: SelfBuildConfig;
      execution_plan: ExecutionPlan | null;
      status: string;
      result: SelfBuildResult | null;
      total_tasks: number;
      completed_tasks: number;
      failed_tasks: number;
      total_agents: number;
      execution_time_ms: number | null;
      estimated_cost_usd: string | null;
      created_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
    }>(query, params);

    return result.rows.map(row => this.mapRowToRun(row));
  }

  /**
   * Update self-build run status.
   */
  async updateStatus(runId: string, status: SelfBuildStatus): Promise<boolean> {
    const db = getDatabase();

    const result = await db.query<{ update_self_build_status: boolean }>(
      `SELECT update_self_build_status($1, $2::self_build_status)`,
      [runId, status]
    );

    const success = result.rows[0].update_self_build_status;

    if (success) {
      const run = await this.getRun(runId);
      this.emit('build:status_changed', { run, status });
    }

    return success;
  }

  /**
   * Create and set execution plan for a run.
   */
  async createPlan(runId: string): Promise<ExecutionPlan> {
    const run = await this.getRun(runId);

    // Update status to planning
    await this.updateStatus(runId, 'planning');

    // Generate execution plan
    const plan = await this.planner.generatePlan(run.projectId, run.config);

    // Save plan to database
    const db = getDatabase();
    await db.query(
      `SELECT set_execution_plan($1, $2)`,
      [runId, JSON.stringify(plan)]
    );

    // Create phases and tasks in database
    for (const phase of plan.phases) {
      const phaseResult = await db.query<{ create_self_build_phase: string }>(
        `SELECT create_self_build_phase($1, $2, $3, $4)`,
        [runId, phase.phaseNumber, phase.parallelizable, phase.estimatedDurationMs]
      );
      const phaseId = phaseResult.rows[0].create_self_build_phase;

      for (const task of phase.tasks) {
        await db.query(
          `SELECT create_self_build_task($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            runId,
            phaseId,
            task.title,
            task.description,
            task.type,
            task.agentType,
            task.priority,
            task.dependencies,
            task.specification || null,
            task.estimatedDurationMs,
            task.id, // Pass the task ID from the plan
          ]
        );
      }
    }

    this.emit('build:planned', { runId, plan });
    return plan;
  }

  /**
   * Execute the self-build run.
   */
  async execute(runId: string): Promise<SelfBuildResult> {
    const run = await this.getRun(runId);

    if (!run.executionPlan) {
      throw new Error('No execution plan found. Call createPlan first.');
    }

    // Update status to executing
    await this.updateStatus(runId, 'executing');

    const startTime = Date.now();
    const errors: string[] = [];
    const phaseResults: PhaseResult[] = [];

    try {
      // Execute each phase
      for (const phase of run.executionPlan.phases) {
        const phaseResult = await this.executor.executePhase(
          runId,
          phase,
          run.config
        );
        phaseResults.push(phaseResult);

        if (!phaseResult.success) {
          errors.push(`Phase ${phase.phaseNumber} failed: ${phaseResult.error || 'Unknown error'}`);
          break; // Stop on phase failure
        }
      }

      const executionTimeMs = Date.now() - startTime;
      const updatedRun = await this.getRun(runId);

      const result: SelfBuildResult = {
        success: errors.length === 0 && updatedRun.failedTasks === 0,
        projectId: run.projectId,
        runId,
        executionPlan: run.executionPlan,
        phases: phaseResults,
        totalTasks: updatedRun.totalTasks,
        completedTasks: updatedRun.completedTasks,
        failedTasks: updatedRun.failedTasks,
        totalAgents: updatedRun.totalAgents,
        executionTimeMs,
        estimatedCost: this.calculateCost(phaseResults),
        errors,
      };

      // Finalize the run
      const db = getDatabase();
      await db.query(
        `SELECT finalize_self_build($1, $2)`,
        [runId, JSON.stringify(result)]
      );

      this.emit('build:completed', result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(message);

      await this.updateStatus(runId, 'failed');

      const executionTimeMs = Date.now() - startTime;
      const updatedRun = await this.getRun(runId);

      const result: SelfBuildResult = {
        success: false,
        projectId: run.projectId,
        runId,
        executionPlan: run.executionPlan,
        phases: phaseResults,
        totalTasks: updatedRun.totalTasks,
        completedTasks: updatedRun.completedTasks,
        failedTasks: updatedRun.failedTasks,
        totalAgents: updatedRun.totalAgents,
        executionTimeMs,
        estimatedCost: this.calculateCost(phaseResults),
        errors,
      };

      this.emit('build:failed', result);
      return result;
    }
  }

  /**
   * Run the complete self-build process.
   */
  async runSelfBuild(projectId: string, config: SelfBuildConfig): Promise<SelfBuildResult> {
    // Start the build
    const run = await this.startBuild(projectId, config);

    // Create execution plan
    await this.createPlan(run.id);

    // Execute the plan
    return this.execute(run.id);
  }

  /**
   * Cancel a running self-build.
   */
  async cancel(runId: string): Promise<boolean> {
    const run = await this.getRun(runId);

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return false;
    }

    const success = await this.updateStatus(runId, 'cancelled');

    if (success) {
      this.emit('build:cancelled', { runId });
    }

    return success;
  }

  /**
   * Get progress for a running self-build.
   */
  async getProgress(runId: string): Promise<SelfBuildProgress> {
    const run = await this.getRun(runId);

    const progressPercent = run.totalTasks > 0
      ? Math.round((run.completedTasks / run.totalTasks) * 100)
      : 0;

    const elapsedTimeMs = run.startedAt
      ? Date.now() - run.startedAt.getTime()
      : 0;

    // Determine current phase
    let currentPhase: number | undefined;
    let totalPhases: number | undefined;

    if (run.executionPlan) {
      totalPhases = run.executionPlan.phases.length;
      // Find the first incomplete phase
      const db = getDatabase();
      const phaseResult = await db.query<{ phase_number: number }>(
        `SELECT phase_number FROM self_build_phases
         WHERE run_id = $1 AND status != 'completed'
         ORDER BY phase_number ASC LIMIT 1`,
        [runId]
      );
      if (phaseResult.rows.length > 0) {
        currentPhase = phaseResult.rows[0].phase_number;
      }
    }

    return {
      runId,
      status: run.status,
      totalTasks: run.totalTasks,
      completedTasks: run.completedTasks,
      failedTasks: run.failedTasks,
      progressPercent,
      currentPhase,
      totalPhases,
      elapsedTimeMs,
    };
  }

  /**
   * Get phases for a run.
   */
  async getPhases(runId: string): Promise<PhaseResult[]> {
    const db = getDatabase();

    const result = await db.query<{
      id: string;
      phase_number: number;
      status: string;
      started_at: Date | null;
      completed_at: Date | null;
      success: boolean | null;
      error_message: string | null;
      total_tasks: string;
      completed_tasks: string;
      failed_tasks: string;
      executing_tasks: string;
    }>(
      `SELECT * FROM self_build_phase_progress WHERE run_id = $1 ORDER BY phase_number`,
      [runId]
    );

    return result.rows.map(row => ({
      phaseNumber: row.phase_number,
      tasks: [], // Tasks loaded separately if needed
      agents: [], // Agents loaded separately if needed
      startedAt: row.started_at || new Date(),
      completedAt: row.completed_at || new Date(),
      success: row.success ?? false,
      error: row.error_message || undefined,
    }));
  }

  /**
   * Calculate estimated cost from phase results.
   */
  private calculateCost(phases: PhaseResult[]): number {
    let totalTokens = 0;
    for (const phase of phases) {
      for (const agent of phase.agents) {
        totalTokens += agent.tokensUsed || 0;
      }
    }
    // Estimate cost: $15 per million tokens (approximation)
    return Math.round((totalTokens / 1000000) * 15 * 100) / 100;
  }

  /**
   * Map database row to SelfBuildRun interface.
   */
  private mapRowToRun(row: {
    id: string;
    project_id: string;
    config: SelfBuildConfig;
    execution_plan: ExecutionPlan | null;
    status: string;
    result: SelfBuildResult | null;
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    total_agents: number;
    execution_time_ms: number | null;
    estimated_cost_usd: string | null;
    created_at: Date;
    started_at: Date | null;
    completed_at: Date | null;
  }): SelfBuildRun {
    return {
      id: row.id,
      projectId: row.project_id,
      config: row.config,
      executionPlan: row.execution_plan || undefined,
      status: row.status as SelfBuildStatus,
      result: row.result || undefined,
      totalTasks: row.total_tasks,
      completedTasks: row.completed_tasks,
      failedTasks: row.failed_tasks,
      totalAgents: row.total_agents,
      executionTimeMs: row.execution_time_ms || undefined,
      estimatedCostUsd: row.estimated_cost_usd ? parseFloat(row.estimated_cost_usd) : undefined,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
    };
  }
}

// Factory functions
export function createSelfBuildManager(): SelfBuildManager {
  return new SelfBuildManager();
}

let defaultManager: SelfBuildManager | null = null;

export function getSelfBuildManager(): SelfBuildManager {
  if (!defaultManager) {
    defaultManager = new SelfBuildManager();
  }
  return defaultManager;
}

// Re-export types from submodules
export type { ExecutionPlan, ExecutionPhase } from './planner.js';
export type { PhaseResult, TaskResult, AgentResult } from './executor.js';
