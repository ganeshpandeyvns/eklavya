/**
 * Phase Executor
 * Demo₈: Self-Build Test
 *
 * Executes phases in self-build runs:
 * - Task execution with agent spawning
 * - Parallel execution support
 * - Dependency resolution
 * - Progress tracking
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';
import { SelfBuildConfig } from './index.js';
import { ExecutionPhase, TaskDefinition, AgentType } from './planner.js';

export interface TaskResult {
  taskId: string;
  title: string;
  type: string;
  status: 'completed' | 'failed' | 'timeout';
  agentId?: string;
  executionTimeMs: number;
  error?: string;
}

export interface AgentResult {
  agentId: string;
  type: string;
  promptId: string;
  status: 'completed' | 'failed' | 'timeout';
  exitCode?: number;
  tokensUsed?: number;
  executionTimeMs: number;
}

export interface PhaseResult {
  phaseNumber: number;
  tasks: TaskResult[];
  agents: AgentResult[];
  startedAt: Date;
  completedAt: Date;
  success: boolean;
  error?: string;
}

interface ExecutingTask {
  taskId: string;
  agentId?: string;
  startTime: number;
  promise: Promise<TaskResult>;
}

/**
 * PhaseExecutor handles the execution of phases and tasks.
 */
export class PhaseExecutor extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Execute a single phase.
   */
  async executePhase(
    runId: string,
    phase: ExecutionPhase,
    config: SelfBuildConfig
  ): Promise<PhaseResult> {
    const startedAt = new Date();
    const tasks: TaskResult[] = [];
    const agents: AgentResult[] = [];
    let error: string | undefined;

    this.emit('phase:started', { runId, phaseNumber: phase.phaseNumber });

    // Start the phase in database
    const db = getDatabase();
    await db.query(
      `UPDATE self_build_phases SET status = 'executing', started_at = NOW()
       WHERE run_id = $1 AND phase_number = $2`,
      [runId, phase.phaseNumber]
    );

    try {
      if (phase.parallelizable) {
        // Execute tasks in parallel (respecting dependencies and concurrency limits)
        const results = await this.executeTasksParallel(
          runId,
          phase.tasks,
          config
        );
        tasks.push(...results.tasks);
        agents.push(...results.agents);
      } else {
        // Execute tasks sequentially
        const results = await this.executeTasksSequential(
          runId,
          phase.tasks,
          config
        );
        tasks.push(...results.tasks);
        agents.push(...results.agents);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    }

    const completedAt = new Date();
    const success = !error && tasks.every(t => t.status === 'completed');

    // Complete the phase in database
    await db.query(
      `UPDATE self_build_phases
       SET status = $1, completed_at = NOW(), success = $2, error_message = $3
       WHERE run_id = $4 AND phase_number = $5`,
      [success ? 'completed' : 'failed', success, error || null, runId, phase.phaseNumber]
    );

    const result: PhaseResult = {
      phaseNumber: phase.phaseNumber,
      tasks,
      agents,
      startedAt,
      completedAt,
      success,
      error,
    };

    this.emit('phase:completed', { runId, result });
    return result;
  }

  /**
   * Execute tasks sequentially.
   */
  private async executeTasksSequential(
    runId: string,
    tasks: TaskDefinition[],
    config: SelfBuildConfig
  ): Promise<{ tasks: TaskResult[]; agents: AgentResult[] }> {
    const taskResults: TaskResult[] = [];
    const agentResults: AgentResult[] = [];

    for (const task of tasks) {
      const { taskResult, agentResult } = await this.executeTask(runId, task, config);
      taskResults.push(taskResult);
      if (agentResult) {
        agentResults.push(agentResult);
      }

      // Stop if task failed (for sequential execution)
      if (taskResult.status !== 'completed') {
        break;
      }
    }

    return { tasks: taskResults, agents: agentResults };
  }

  /**
   * Execute tasks in parallel with dependency resolution.
   */
  private async executeTasksParallel(
    runId: string,
    tasks: TaskDefinition[],
    config: SelfBuildConfig
  ): Promise<{ tasks: TaskResult[]; agents: AgentResult[] }> {
    const taskResults: TaskResult[] = [];
    const agentResults: AgentResult[] = [];
    const completedTaskIds = new Set<string>();
    const maxConcurrent = config.maxConcurrentAgents || 5;

    // Build task map for dependency lookup (only tasks in this phase)
    const taskMap = new Map<string, TaskDefinition>();
    for (const task of tasks) {
      taskMap.set(task.id, task);
    }

    // Execute until all tasks are done
    while (completedTaskIds.size < tasks.length) {
      // Find tasks ready to execute (dependencies satisfied)
      // Dependencies not in this phase are assumed to be from prior phases (already completed)
      const readyTasks = tasks.filter(task => {
        if (completedTaskIds.has(task.id)) return false;
        return task.dependencies.every(depId => {
          // If dependency is in this phase, it must be completed
          if (taskMap.has(depId)) {
            return completedTaskIds.has(depId);
          }
          // Otherwise, assume it was completed in a prior phase
          return true;
        });
      });

      if (readyTasks.length === 0 && completedTaskIds.size < tasks.length) {
        // Deadlock detected - remaining tasks have unresolvable dependencies
        throw new Error('Deadlock detected: some tasks have circular or missing dependencies');
      }

      // Execute up to maxConcurrent tasks at once
      const batch = readyTasks.slice(0, maxConcurrent);
      const batchPromises = batch.map(task => this.executeTask(runId, task, config));
      const batchResults = await Promise.all(batchPromises);

      for (const { taskResult, agentResult } of batchResults) {
        taskResults.push(taskResult);
        if (agentResult) {
          agentResults.push(agentResult);
        }
        completedTaskIds.add(taskResult.taskId);
      }

      // Check for failures
      const failedTask = taskResults.find(t => t.status === 'failed');
      if (failedTask) {
        // Continue with other tasks but note the failure
        // Could also break here depending on desired behavior
      }
    }

    return { tasks: taskResults, agents: agentResults };
  }

  /**
   * Execute a single task.
   */
  private async executeTask(
    runId: string,
    task: TaskDefinition,
    config: SelfBuildConfig
  ): Promise<{ taskResult: TaskResult; agentResult?: AgentResult }> {
    const startTime = Date.now();

    this.emit('task:started', { runId, taskId: task.id, title: task.title });

    // Start task in database
    const db = getDatabase();
    await db.query(
      `UPDATE self_build_tasks SET status = 'executing', started_at = NOW()
       WHERE run_id = $1 AND id = $2`,
      [runId, task.id]
    );

    try {
      if (config.simulatedMode) {
        return await this.executeTaskSimulated(runId, task, config, startTime);
      } else {
        return await this.executeTaskReal(runId, task, config, startTime);
      }
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Complete task as failed
      await db.query(
        `SELECT complete_self_build_task($1, $2, $3)`,
        [task.id, false, errorMessage]
      );

      const taskResult: TaskResult = {
        taskId: task.id,
        title: task.title,
        type: task.type,
        status: 'failed',
        executionTimeMs,
        error: errorMessage,
      };

      this.emit('task:completed', { runId, result: taskResult });
      return { taskResult };
    }
  }

  /**
   * Execute task in simulated mode (for testing).
   */
  private async executeTaskSimulated(
    runId: string,
    task: TaskDefinition,
    config: SelfBuildConfig,
    startTime: number
  ): Promise<{ taskResult: TaskResult; agentResult?: AgentResult }> {
    const db = getDatabase();

    // Simulate agent creation
    const agentId = `sim-agent-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Increment agent count
    await db.query(`SELECT increment_self_build_agents($1)`, [runId]);

    this.emit('agent:spawned', {
      runId,
      agentId,
      agentType: task.agentType,
      taskId: task.id,
    });

    // Simulate execution time
    const simulatedDuration = config.simulatedDuration || 5000;
    await this.sleep(simulatedDuration);

    const executionTimeMs = Date.now() - startTime;

    // Determine success based on configured rate
    const successRate = config.simulatedSuccessRate ?? 0.95;
    const success = Math.random() < successRate;

    // Complete task in database
    await db.query(
      `SELECT complete_self_build_task($1, $2, $3)`,
      [task.id, success, success ? null : 'Simulated failure']
    );

    const taskResult: TaskResult = {
      taskId: task.id,
      title: task.title,
      type: task.type,
      status: success ? 'completed' : 'failed',
      agentId,
      executionTimeMs,
      error: success ? undefined : 'Simulated failure',
    };

    const agentResult: AgentResult = {
      agentId,
      type: task.agentType,
      promptId: `prompt-${task.agentType}-v1`,
      status: success ? 'completed' : 'failed',
      exitCode: success ? 0 : 1,
      tokensUsed: Math.floor(Math.random() * 10000) + 1000,
      executionTimeMs,
    };

    this.emit('agent:completed', { runId, result: agentResult });
    this.emit('task:completed', { runId, result: taskResult });

    return { taskResult, agentResult };
  }

  /**
   * Execute task with real agent.
   */
  private async executeTaskReal(
    runId: string,
    task: TaskDefinition,
    config: SelfBuildConfig,
    startTime: number
  ): Promise<{ taskResult: TaskResult; agentResult?: AgentResult }> {
    const db = getDatabase();

    // In a real implementation, this would:
    // 1. Spawn a Claude Code agent with the appropriate prompt
    // 2. Pass the task specification to the agent
    // 3. Monitor agent progress
    // 4. Handle agent output and completion

    // For now, we'll create a placeholder implementation that
    // could be connected to the real agent manager

    // Check if we have an agent manager available
    const agentManager = await this.getAgentManager();

    if (agentManager) {
      // Use real agent manager
      const agent = await agentManager.spawnAgent({
        type: task.agentType,
        projectId: runId, // Use runId as project context
        taskId: task.id,
        specification: task.specification,
      });

      // Increment agent count
      await db.query(`SELECT increment_self_build_agents($1)`, [runId]);

      this.emit('agent:spawned', {
        runId,
        agentId: agent.id,
        agentType: task.agentType,
        taskId: task.id,
      });

      // Wait for agent completion (with timeout)
      const maxTime = config.maxExecutionTime
        ? config.maxExecutionTime * 60 * 1000
        : 60 * 60 * 1000;
      const taskTimeout = Math.min(task.estimatedDurationMs * 3, maxTime);

      const result = await Promise.race([
        agentManager.waitForCompletion(agent.id),
        this.timeout(taskTimeout),
      ]);

      const executionTimeMs = Date.now() - startTime;
      const success = result && result.success;

      await db.query(
        `SELECT complete_self_build_task($1, $2, $3)`,
        [task.id, success, success ? null : (result?.error || 'Task failed')]
      );

      const taskResult: TaskResult = {
        taskId: task.id,
        title: task.title,
        type: task.type,
        status: success ? 'completed' : 'failed',
        agentId: agent.id,
        executionTimeMs,
        error: success ? undefined : (result?.error || 'Task failed'),
      };

      const agentResult: AgentResult = {
        agentId: agent.id,
        type: task.agentType,
        promptId: agent.promptId || `prompt-${task.agentType}`,
        status: success ? 'completed' : 'failed',
        exitCode: result?.exitCode,
        tokensUsed: result?.tokensUsed,
        executionTimeMs,
      };

      this.emit('agent:completed', { runId, result: agentResult });
      this.emit('task:completed', { runId, result: taskResult });

      return { taskResult, agentResult };
    } else {
      // Fallback to simulated mode if no agent manager available
      console.warn('No agent manager available, falling back to simulated execution');
      return this.executeTaskSimulated(runId, task, { ...config, simulatedMode: true }, startTime);
    }
  }

  /**
   * Get the agent manager if available.
   */
  private async getAgentManager(): Promise<AgentManagerInterface | null> {
    try {
      // Try to import the agent manager dynamically
      const module = await import('../agent-manager/index.js');
      if (module.getAgentManager) {
        return module.getAgentManager();
      }
    } catch {
      // Agent manager not available
    }
    return null;
  }

  /**
   * Create a timeout promise.
   */
  private timeout(ms: number): Promise<null> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Task execution timeout')), ms);
    });
  }

  /**
   * Sleep for specified milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Interface for agent manager (to avoid circular dependencies).
 */
interface AgentManagerInterface {
  spawnAgent(options: {
    type: AgentType;
    projectId: string;
    taskId: string;
    specification?: string;
  }): Promise<{ id: string; promptId?: string }>;

  waitForCompletion(agentId: string): Promise<{
    success: boolean;
    error?: string;
    exitCode?: number;
    tokensUsed?: number;
  }>;
}

// Factory function
export function createPhaseExecutor(): PhaseExecutor {
  return new PhaseExecutor();
}
