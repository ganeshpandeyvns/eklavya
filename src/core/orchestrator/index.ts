import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { AgentType, Task, TaskStatus } from '../../types/index.js';
import { getDatabase } from '../../lib/database.js';
import { AgentManager, RLAgent, SpawnAgentOptions } from '../agent-manager/index.js';
import { MessageBus } from '../message-bus/index.js';
import { getLearningSystem } from '../learning/index.js';

export interface TaskDefinition {
  id?: string;
  title: string;
  description: string;
  type: string;
  agentType: AgentType;
  dependencies?: string[];  // Task IDs that must complete first
  priority?: number;        // Higher = more important
  estimatedTokens?: number;
  files?: string[];         // Files this task will touch
}

export interface ParallelExecutionPlan {
  phases: Array<{
    phaseNumber: number;
    tasks: TaskDefinition[];
    parallelAgents: number;
  }>;
  totalTasks: number;
  estimatedParallelism: number;
}

export interface OrchestratorOptions {
  projectId: string;
  projectDir: string;
  agentManager: AgentManager;
  messageBus: MessageBus;
  maxParallelAgents?: number;
}

/**
 * The Orchestrator coordinates parallel agent execution.
 * It breaks down work into phases, spawns agents in parallel,
 * and tracks outcomes for RL feedback.
 */
export class Orchestrator extends EventEmitter {
  private projectId: string;
  private projectDir: string;
  private agentManager: AgentManager;
  private messageBus: MessageBus;
  private maxParallelAgents: number;

  private activeTasks: Map<string, { task: Task; agentId?: string }> = new Map();
  private completedTasks: Set<string> = new Set();
  private failedTasks: Set<string> = new Set();

  private orchestratorAgentId?: string;
  private orchestratorPromptId?: string;
  private startTime?: number;

  constructor(options: OrchestratorOptions) {
    super();
    this.projectId = options.projectId;
    this.projectDir = options.projectDir;
    this.agentManager = options.agentManager;
    this.messageBus = options.messageBus;
    this.maxParallelAgents = options.maxParallelAgents || 5;
  }

  /**
   * Initialize the orchestrator and select its prompt via Thompson Sampling
   */
  async initialize(): Promise<void> {
    const learningSystem = getLearningSystem();

    // Select orchestrator prompt using Thompson Sampling
    const selectedPrompt = await learningSystem.selectPrompt('orchestrator');
    this.orchestratorPromptId = selectedPrompt?.id;

    // Create orchestrator agent record
    const db = getDatabase();
    this.orchestratorAgentId = uuidv4();

    await db.query(
      `INSERT INTO agents (id, project_id, type, status, prompt_id, created_at, updated_at)
       VALUES ($1, $2, 'orchestrator', 'working', $3, NOW(), NOW())`,
      [this.orchestratorAgentId, this.projectId, this.orchestratorPromptId]
    );

    this.startTime = Date.now();

    // Subscribe to agent messages
    this.messageBus.on('message', (msg) => this.handleAgentMessage(msg));

    this.emit('initialized', {
      orchestratorId: this.orchestratorAgentId,
      promptId: this.orchestratorPromptId,
    });
  }

  /**
   * Analyze tasks and create a parallel execution plan
   */
  createExecutionPlan(tasks: TaskDefinition[]): ParallelExecutionPlan {
    // Build dependency graph
    const taskMap = new Map<string, TaskDefinition>();
    const dependencyCount = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const task of tasks) {
      const taskId = task.id || uuidv4();
      task.id = taskId;
      taskMap.set(taskId, task);
      dependencyCount.set(taskId, task.dependencies?.length || 0);

      for (const dep of task.dependencies || []) {
        if (!dependents.has(dep)) {
          dependents.set(dep, []);
        }
        dependents.get(dep)!.push(taskId);
      }
    }

    // Topological sort into phases
    const phases: ParallelExecutionPlan['phases'] = [];
    const remaining = new Set(taskMap.keys());

    while (remaining.size > 0) {
      // Find tasks with no pending dependencies
      const ready: TaskDefinition[] = [];

      for (const taskId of remaining) {
        if (dependencyCount.get(taskId) === 0) {
          ready.push(taskMap.get(taskId)!);
        }
      }

      if (ready.length === 0 && remaining.size > 0) {
        throw new Error('Circular dependency detected in task graph');
      }

      // Sort by priority (higher first)
      ready.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      // Limit to max parallel agents
      const phaseTasks = ready.slice(0, this.maxParallelAgents);

      phases.push({
        phaseNumber: phases.length + 1,
        tasks: phaseTasks,
        parallelAgents: phaseTasks.length,
      });

      // Remove completed tasks and update dependency counts
      for (const task of phaseTasks) {
        remaining.delete(task.id!);

        for (const dependent of dependents.get(task.id!) || []) {
          dependencyCount.set(dependent, dependencyCount.get(dependent)! - 1);
        }
      }
    }

    const totalParallelism = phases.reduce((sum, p) => sum + p.parallelAgents, 0) / phases.length;

    return {
      phases,
      totalTasks: tasks.length,
      estimatedParallelism: totalParallelism,
    };
  }

  /**
   * Execute a plan by spawning agents in parallel phases
   */
  async executePlan(plan: ParallelExecutionPlan): Promise<{
    success: boolean;
    completed: number;
    failed: number;
    duration: number;
  }> {
    const startTime = Date.now();

    this.emit('plan:started', {
      totalPhases: plan.phases.length,
      totalTasks: plan.totalTasks,
    });

    for (const phase of plan.phases) {
      this.emit('phase:started', {
        phaseNumber: phase.phaseNumber,
        taskCount: phase.tasks.length,
      });

      // Spawn all agents for this phase in parallel
      const results = await this.executePhase(phase);

      // Check for failures
      const failures = results.filter(r => !r.success);
      if (failures.length > 0) {
        this.emit('phase:failed', {
          phaseNumber: phase.phaseNumber,
          failures: failures.map(f => f.taskId),
        });

        // Decide whether to continue or abort
        // For now, we continue with remaining phases
      }

      this.emit('phase:completed', {
        phaseNumber: phase.phaseNumber,
        succeeded: results.filter(r => r.success).length,
        failed: failures.length,
      });
    }

    const duration = Date.now() - startTime;
    const success = this.failedTasks.size === 0;

    // Record orchestrator outcome
    await this.recordOrchestratorOutcome(success, duration, plan);

    this.emit('plan:completed', {
      success,
      completed: this.completedTasks.size,
      failed: this.failedTasks.size,
      duration,
    });

    return {
      success,
      completed: this.completedTasks.size,
      failed: this.failedTasks.size,
      duration,
    };
  }

  /**
   * Execute a single phase by spawning agents in parallel
   */
  private async executePhase(
    phase: ParallelExecutionPlan['phases'][0]
  ): Promise<Array<{ taskId: string; success: boolean; agentId: string }>> {
    const db = getDatabase();

    // Create task records
    const taskRecords: Task[] = [];
    for (const taskDef of phase.tasks) {
      const task: Task = {
        id: taskDef.id!,
        projectId: this.projectId,
        title: taskDef.title,
        description: taskDef.description,
        type: taskDef.type,
        status: 'pending',
        priority: taskDef.priority || 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.query(
        `INSERT INTO tasks (id, project_id, title, description, type, status, priority, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET status = 'pending', updated_at = NOW()`,
        [task.id, task.projectId, task.title, task.description, task.type, task.status, task.priority, task.createdAt, task.updatedAt]
      );

      taskRecords.push(task);
      this.activeTasks.set(task.id, { task });
    }

    // Spawn agents in parallel
    const spawnConfigs: SpawnAgentOptions[] = phase.tasks.map(taskDef => ({
      type: taskDef.agentType,
      taskId: taskDef.id,
      taskDescription: `${taskDef.title}\n\n${taskDef.description}`,
      parentAgentId: this.orchestratorAgentId,
    }));

    const agents = await this.agentManager.spawnParallelAgents(spawnConfigs);

    // Link agents to tasks
    for (let i = 0; i < agents.length; i++) {
      const taskId = phase.tasks[i].id!;
      const agent = agents[i];

      this.activeTasks.get(taskId)!.agentId = agent.id;

      await db.query(
        `UPDATE tasks SET assigned_agent_id = $1, status = 'assigned' WHERE id = $2`,
        [agent.id, taskId]
      );
    }

    // Wait for all agents to complete
    const results = await this.waitForAgents(agents, taskRecords);

    return results;
  }

  /**
   * Wait for all agents in a phase to complete
   */
  private async waitForAgents(
    agents: RLAgent[],
    tasks: Task[]
  ): Promise<Array<{ taskId: string; success: boolean; agentId: string }>> {
    const results: Array<{ taskId: string; success: boolean; agentId: string }> = [];

    // Create promises for each agent completion
    const completionPromises = agents.map((agent, index) => {
      return new Promise<{ taskId: string; success: boolean; agentId: string }>((resolve) => {
        const task = tasks[index];

        const handleOutcome = (event: { agent: RLAgent; outcome: { success: boolean } }) => {
          if (event.agent.id === agent.id) {
            this.agentManager.off('agent:outcome', handleOutcome);

            const success = event.outcome.success;
            if (success) {
              this.completedTasks.add(task.id);
            } else {
              this.failedTasks.add(task.id);
            }

            this.activeTasks.delete(task.id);

            resolve({
              taskId: task.id,
              success,
              agentId: agent.id,
            });
          }
        };

        this.agentManager.on('agent:outcome', handleOutcome);

        // Timeout after 30 minutes
        setTimeout(() => {
          this.agentManager.off('agent:outcome', handleOutcome);
          this.failedTasks.add(task.id);
          this.activeTasks.delete(task.id);
          resolve({
            taskId: task.id,
            success: false,
            agentId: agent.id,
          });
        }, 30 * 60 * 1000);
      });
    });

    const allResults = await Promise.all(completionPromises);
    results.push(...allResults);

    return results;
  }

  /**
   * Record the orchestrator's own outcome for RL feedback
   */
  private async recordOrchestratorOutcome(
    success: boolean,
    duration: number,
    plan: ParallelExecutionPlan
  ): Promise<void> {
    if (!this.orchestratorPromptId || !this.orchestratorAgentId) return;

    const learningSystem = getLearningSystem();

    // Calculate parallel efficiency (how well we utilized parallelism)
    const idealTime = plan.totalTasks * (duration / plan.phases.length);
    const parallelEfficiency = idealTime / duration;

    // Calculate overall success rate
    const successRate = this.completedTasks.size / plan.totalTasks;

    // Calculate reward based on efficiency and success
    let reward = success ? 0.5 : -0.3;
    reward += (parallelEfficiency - 1) * 0.2;  // Bonus for parallelism
    reward += (successRate - 0.8) * 0.3;       // Adjust for success rate

    await learningSystem.recordOutcome({
      promptId: this.orchestratorPromptId,
      projectId: this.projectId,
      agentId: this.orchestratorAgentId,
      outcome: success ? 'success' : 'failure',
      reward: Math.max(-1, Math.min(1, reward)),
      context: {
        type: 'orchestration_complete',
        totalTasks: plan.totalTasks,
        completedTasks: this.completedTasks.size,
        failedTasks: this.failedTasks.size,
        phases: plan.phases.length,
        parallelEfficiency,
        successRate,
        durationMs: duration,
      },
    });

    // Update orchestrator agent status
    const db = getDatabase();
    await db.query(
      `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2`,
      [success ? 'completed' : 'failed', this.orchestratorAgentId]
    );
  }

  /**
   * Handle messages from agents
   */
  private handleAgentMessage(msg: {
    type: string;
    fromAgentId: string;
    payload: Record<string, unknown>;
  }): void {
    switch (msg.type) {
      case 'TASK_COMPLETE':
        this.emit('task:complete', {
          taskId: msg.payload.taskId,
          agentId: msg.fromAgentId,
          result: msg.payload.result,
        });
        break;

      case 'TASK_FAILED':
        this.emit('task:failed', {
          taskId: msg.payload.taskId,
          agentId: msg.fromAgentId,
          error: msg.payload.error,
        });
        break;

      case 'TASK_BLOCKED':
        this.emit('task:blocked', {
          taskId: msg.payload.taskId,
          agentId: msg.fromAgentId,
          reason: msg.payload.reason,
        });
        // Could spawn a Mentor agent to help
        break;

      case 'STATUS_UPDATE':
        this.emit('agent:progress', {
          agentId: msg.fromAgentId,
          progress: msg.payload.progress,
          status: msg.payload.status,
        });
        break;
    }
  }

  /**
   * Get current execution status
   */
  getStatus(): {
    active: number;
    completed: number;
    failed: number;
    tasks: Array<{ taskId: string; status: string; agentId?: string }>;
  } {
    const tasks = Array.from(this.activeTasks.entries()).map(([taskId, { task, agentId }]) => ({
      taskId,
      status: task.status,
      agentId,
    }));

    return {
      active: this.activeTasks.size,
      completed: this.completedTasks.size,
      failed: this.failedTasks.size,
      tasks,
    };
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    // Terminate any remaining active agents
    for (const [taskId, { agentId }] of this.activeTasks) {
      if (agentId) {
        await this.agentManager.terminateAgent(agentId, 'orchestrator_shutdown');
      }
    }

    this.activeTasks.clear();
    this.emit('shutdown');
  }
}

/**
 * High-level function to execute a project with parallel agents
 */
export async function executeProjectWithParallelAgents(
  projectId: string,
  projectDir: string,
  tasks: TaskDefinition[],
  agentManager: AgentManager,
  messageBus: MessageBus,
  options: { maxParallelAgents?: number } = {}
): Promise<{
  success: boolean;
  completed: number;
  failed: number;
  duration: number;
  orchestratorReward: number;
}> {
  const orchestrator = new Orchestrator({
    projectId,
    projectDir,
    agentManager,
    messageBus,
    maxParallelAgents: options.maxParallelAgents,
  });

  await orchestrator.initialize();

  // Create execution plan
  const plan = orchestrator.createExecutionPlan(tasks);

  console.log(`\n📋 Execution Plan:`);
  console.log(`   Total Tasks: ${plan.totalTasks}`);
  console.log(`   Phases: ${plan.phases.length}`);
  console.log(`   Est. Parallelism: ${plan.estimatedParallelism.toFixed(2)}x`);

  for (const phase of plan.phases) {
    console.log(`\n   Phase ${phase.phaseNumber}:`);
    for (const task of phase.tasks) {
      console.log(`     - [${task.agentType}] ${task.title}`);
    }
  }

  // Execute
  const result = await orchestrator.executePlan(plan);

  await orchestrator.shutdown();

  // Get orchestrator's reward for this execution
  const db = getDatabase();
  const rewardResult = await db.query<{ reward: string }>(
    `SELECT reward FROM rl_outcomes
     WHERE agent_id = (SELECT id FROM agents WHERE project_id = $1 AND type = 'orchestrator' ORDER BY created_at DESC LIMIT 1)
     ORDER BY created_at DESC LIMIT 1`,
    [projectId]
  );

  const orchestratorReward = rewardResult.rows.length > 0
    ? parseFloat(rewardResult.rows[0].reward)
    : 0;

  return {
    ...result,
    orchestratorReward,
  };
}

// Factory function
export function createOrchestrator(options: OrchestratorOptions): Orchestrator {
  return new Orchestrator(options);
}
