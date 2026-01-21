import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import type { Agent, AgentType, AgentStatus, EklavyaConfig, Prompt } from '../../types/index.js';
import { getDatabase } from '../../lib/database.js';
import { MessageBus } from '../message-bus/index.js';
import { getLearningSystem } from '../learning/index.js';
import { getCostTracker } from '../cost/index.js';

export interface AgentManagerOptions {
  config: EklavyaConfig;
  projectId: string;
  projectDir: string;
  messageBus: MessageBus;
}

export interface SpawnAgentOptions {
  type: AgentType;
  taskId?: string;
  taskDescription?: string;
  workingDirectory?: string;
  parentAgentId?: string;  // For tracking agent hierarchy
}

export interface AgentOutcome {
  agentId: string;
  promptId: string;
  success: boolean;
  taskId?: string;
  metrics: {
    tasksCompleted: number;
    tasksFailed: number;
    tokensUsed: number;
    executionTimeMs: number;
    bugsIntroduced?: number;
    codeQualityScore?: number;
  };
  context?: Record<string, unknown>;
}

// Extended Agent type with RL tracking
export interface RLAgent extends Agent {
  promptId?: string;
  promptVersion?: number;
  spawnedAt: Date;
  parentAgentId?: string;
}

export class AgentManager extends EventEmitter {
  private config: EklavyaConfig;
  private projectId: string;
  private projectDir: string;
  private messageBus: MessageBus;
  private agents: Map<string, { agent: RLAgent; process?: ChildProcess; startTime: number }> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(options: AgentManagerOptions) {
    super();
    this.config = options.config;
    this.projectId = options.projectId;
    this.projectDir = options.projectDir;
    this.messageBus = options.messageBus;
  }

  async start(): Promise<void> {
    // Load existing agents from database
    const db = getDatabase();
    const result = await db.query<RLAgent>(
      `SELECT a.*, p.version as prompt_version
       FROM agents a
       LEFT JOIN prompts p ON a.prompt_id = p.id
       WHERE a.project_id = $1 AND a.status NOT IN ('completed', 'terminated', 'failed')`,
      [this.projectId]
    );

    for (const row of result.rows) {
      this.agents.set(row.id, { agent: row, startTime: Date.now() });
    }

    // Start heartbeat monitoring
    this.heartbeatInterval = setInterval(
      () => this.checkHeartbeats(),
      this.config.heartbeatIntervalMs
    );

    this.emit('started');
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Terminate all agents and record outcomes
    for (const [agentId] of this.agents) {
      await this.terminateAgent(agentId, 'system_shutdown');
    }

    this.emit('stopped');
  }

  /**
   * Check if project has budget remaining
   */
  async checkBudget(): Promise<boolean> {
    try {
      const costTracker = getCostTracker();
      return await costTracker.enforceBudgetLimit(this.projectId);
    } catch (error) {
      console.error('Failed to check budget:', error);
      // If we can't check budget, allow the operation to proceed
      return true;
    }
  }

  /**
   * Record token usage for an agent
   */
  async recordTokenUsage(
    agentId: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    taskId?: string
  ): Promise<void> {
    try {
      const costTracker = getCostTracker();
      await costTracker.recordApiCall(this.projectId, {
        model,
        inputTokens,
        outputTokens,
        agentId,
        taskId,
        requestType: 'completion',
      });

      // Update agent metrics
      const entry = this.agents.get(agentId);
      if (entry) {
        entry.agent.metrics.tokensUsed += inputTokens + outputTokens;
      }
    } catch (error) {
      console.error('Failed to record token usage:', error);
    }
  }

  /**
   * Spawn a single agent with RL-based prompt selection
   */
  async spawnAgent(options: SpawnAgentOptions): Promise<RLAgent> {
    try {
      // Check budget before spawning
      const withinBudget = await this.checkBudget();
      if (!withinBudget) {
        throw new Error('Project budget exceeded. Cannot spawn new agents.');
      }

      const db = getDatabase();
      const learningSystem = getLearningSystem();
      const agentId = uuidv4();
      const workingDir = options.workingDirectory ||
        path.join(this.projectDir, 'agents', options.type, agentId);

      // Select prompt using Thompson Sampling
      const selectedPrompt = await learningSystem.selectPrompt(options.type);
      const promptContent = selectedPrompt?.content || this.getDefaultPrompt(options.type);
      const promptId = selectedPrompt?.id;

    // Create working directory
    await fs.mkdir(workingDir, { recursive: true });

    // Create agent-specific CLAUDE.md with the selected prompt
    await fs.writeFile(path.join(workingDir, 'CLAUDE.md'), promptContent);

    // Create agent record with prompt tracking
    const agent: RLAgent = {
      id: agentId,
      projectId: this.projectId,
      type: options.type,
      status: 'initializing',
      workingDirectory: workingDir,
      currentTaskId: options.taskId,
      promptId,
      promptVersion: selectedPrompt?.version,
      parentAgentId: options.parentAgentId,
      spawnedAt: new Date(),
      metrics: { tasksCompleted: 0, tasksFailed: 0, tokensUsed: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.query(
      `INSERT INTO agents (id, project_id, type, status, working_directory, current_task_id, prompt_id, metrics, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        agent.id,
        agent.projectId,
        agent.type,
        agent.status,
        agent.workingDirectory,
        agent.currentTaskId || null,
        agent.promptId || null,
        JSON.stringify(agent.metrics),
        agent.createdAt,
        agent.updatedAt,
      ]
    );

    // Spawn Claude Code process
    const process = await this.spawnClaudeProcess(agent, options.taskDescription);

    this.agents.set(agentId, { agent, process, startTime: Date.now() });

    // Update status to idle
    await this.updateAgentStatus(agentId, 'idle');

    // Subscribe to messages
    await this.messageBus.subscribe(agentId);

    this.emit('agent:spawned', { agent, promptId, promptVersion: selectedPrompt?.version });
    return agent;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to spawn agent of type ${options.type}:`, errorMessage);
      this.emit('agent:spawn:failed', { type: options.type, error: errorMessage });
      throw error;
    }
  }

  /**
   * Spawn multiple agents in parallel for a task
   */
  async spawnParallelAgents(
    agentConfigs: SpawnAgentOptions[]
  ): Promise<RLAgent[]> {
    // Check budget before spawning multiple agents
    const withinBudget = await this.checkBudget();
    if (!withinBudget) {
      throw new Error('Project budget exceeded. Cannot spawn new agents.');
    }

    // Check concurrent agent limit
    const currentActive = this.getActiveAgentCount();
    const maxAllowed = this.config.maxConcurrentAgents;

    if (currentActive + agentConfigs.length > maxAllowed) {
      throw new Error(
        `Cannot spawn ${agentConfigs.length} agents. Current: ${currentActive}, Max: ${maxAllowed}`
      );
    }

    // Spawn all agents in parallel
    const spawnPromises = agentConfigs.map(config => this.spawnAgent(config));
    const agents = await Promise.all(spawnPromises);

    this.emit('agents:spawned:parallel', {
      count: agents.length,
      types: agents.map(a => a.type),
      ids: agents.map(a => a.id),
    });

    return agents;
  }

  /**
   * Record agent outcome and apply RL reward/penalty
   */
  async recordAgentOutcome(outcome: AgentOutcome): Promise<void> {
    try {
      const learningSystem = getLearningSystem();
      const entry = this.agents.get(outcome.agentId);

      if (!entry) {
        console.warn(`Agent ${outcome.agentId} not found for outcome recording`);
        return;
      }

      const { agent, startTime } = entry;
      const executionTime = Date.now() - startTime;

      // Calculate reward based on outcome
      const reward = this.calculateReward(outcome, agent.type);

      // Apply reward to the prompt
      if (outcome.promptId) {
        await learningSystem.recordOutcome({
          promptId: outcome.promptId,
          projectId: this.projectId,
          taskId: outcome.taskId,
          agentId: outcome.agentId,
          outcome: outcome.success ? 'success' : 'failure',
          reward,
          context: {
            agentType: agent.type,
            ...outcome.metrics,
            ...outcome.context,
          },
        });
      }

      // Update agent metrics in database
      const db = getDatabase();
      await db.query(
        `UPDATE agents SET
          metrics = $1,
          status = $2,
          updated_at = NOW()
         WHERE id = $3`,
        [
          JSON.stringify(outcome.metrics),
          outcome.success ? 'completed' : 'failed',
          outcome.agentId,
        ]
      );

      this.emit('agent:outcome', {
        agent,
        outcome,
        reward,
        executionTimeMs: executionTime,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to record outcome for agent ${outcome.agentId}:`, errorMessage);
      this.emit('agent:outcome:failed', { agentId: outcome.agentId, error: errorMessage });
    }
  }

  /**
   * Calculate reward based on agent type and outcome
   */
  private calculateReward(outcome: AgentOutcome, agentType: AgentType): number {
    let baseReward = outcome.success ? 0.5 : -0.5;

    // Adjust based on agent type and specific metrics
    switch (agentType) {
      case 'developer':
        // Penalize for bugs introduced
        if (outcome.metrics.bugsIntroduced && outcome.metrics.bugsIntroduced > 0) {
          baseReward -= 0.2 * outcome.metrics.bugsIntroduced;
        }
        // Reward for code quality
        if (outcome.metrics.codeQualityScore) {
          baseReward += (outcome.metrics.codeQualityScore - 0.5) * 0.4;
        }
        break;

      case 'tester':
        // Testers are rewarded for finding bugs (higher is better)
        if (outcome.context?.bugsFound && typeof outcome.context.bugsFound === 'number') {
          baseReward += 0.1 * outcome.context.bugsFound;
        }
        break;

      case 'orchestrator':
        // Orchestrators are rewarded for efficient task distribution
        if (outcome.context?.parallelEfficiency && typeof outcome.context.parallelEfficiency === 'number') {
          baseReward += (outcome.context.parallelEfficiency - 0.5) * 0.3;
        }
        break;

      case 'architect':
        // Architects are rewarded for design clarity and completeness
        if (outcome.context?.designScore && typeof outcome.context.designScore === 'number') {
          baseReward += (outcome.context.designScore - 0.5) * 0.4;
        }
        break;
    }

    // Clamp to valid range
    return Math.max(-1, Math.min(1, baseReward));
  }

  private async spawnClaudeProcess(agent: RLAgent, taskDescription?: string): Promise<ChildProcess> {
    const args = [
      '--dangerously-skip-permissions',
      '--project-dir', agent.workingDirectory!,
    ];

    // If there's a task description, pass it as the initial prompt
    if (taskDescription) {
      args.push('--prompt', taskDescription);
    }

    const proc = spawn('claude', args, {
      cwd: agent.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        EKLAVYA_AGENT_ID: agent.id,
        EKLAVYA_PROJECT_ID: this.projectId,
        EKLAVYA_AGENT_TYPE: agent.type,
        EKLAVYA_PROMPT_ID: agent.promptId || '',
      },
    });

    proc.on('exit', async (code) => {
      const success = code === 0;
      const entry = this.agents.get(agent.id);

      if (entry) {
        // Record outcome with RL feedback
        const defaultMetrics = {
          tasksCompleted: success ? 1 : 0,
          tasksFailed: success ? 0 : 1,
          tokensUsed: 0,
          executionTimeMs: Date.now() - entry.startTime,
        };
        await this.recordAgentOutcome({
          agentId: agent.id,
          promptId: agent.promptId || '',
          success,
          taskId: agent.currentTaskId,
          metrics: {
            ...defaultMetrics,
            ...(entry.agent.metrics || {}),
          },
          context: { exitCode: code },
        });
      }

      this.emit('agent:exited', { agent, code, success });
    });

    proc.on('error', async (error) => {
      await this.recordAgentOutcome({
        agentId: agent.id,
        promptId: agent.promptId || '',
        success: false,
        taskId: agent.currentTaskId,
        metrics: {
          tasksCompleted: 0,
          tasksFailed: 1,
          tokensUsed: 0,
          executionTimeMs: Date.now() - (this.agents.get(agent.id)?.startTime || Date.now()),
        },
        context: { error: error.message },
      });

      this.emit('agent:error', { agent, error });
    });

    // Update PID
    const db = getDatabase();
    await db.query(
      `UPDATE agents SET pid = $1 WHERE id = $2`,
      [proc.pid, agent.id]
    );

    return proc;
  }

  async terminateAgent(agentId: string, reason?: string): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) return;

    const { agent, process, startTime } = entry;

    // Unsubscribe from messages
    await this.messageBus.unsubscribe(agentId);

    // Kill process if running
    if (process && !process.killed) {
      process.kill('SIGTERM');

      // Force kill after 5 seconds
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      }, 5000);
    }

    // Record termination outcome (neutral reward for manual termination)
    if (agent.promptId) {
      await this.recordAgentOutcome({
        agentId,
        promptId: agent.promptId,
        success: reason !== 'failure',
        taskId: agent.currentTaskId,
        metrics: {
          ...agent.metrics,
          executionTimeMs: Date.now() - startTime,
        },
        context: { terminationReason: reason },
      });
    }

    await this.updateAgentStatus(agentId, 'terminated');
    this.agents.delete(agentId);

    this.emit('agent:terminated', { agent, reason });
  }

  async updateAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
    const db = getDatabase();
    await db.query(
      `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, agentId]
    );

    const entry = this.agents.get(agentId);
    if (entry) {
      entry.agent.status = status;
      entry.agent.updatedAt = new Date();
    }

    this.emit('agent:status', { agentId, status });
  }

  async heartbeat(agentId: string): Promise<void> {
    const db = getDatabase();
    await db.query(
      `UPDATE agents SET last_heartbeat = NOW() WHERE id = $1`,
      [agentId]
    );

    const entry = this.agents.get(agentId);
    if (entry) {
      entry.agent.lastHeartbeat = new Date();
    }
  }

  private async checkHeartbeats(): Promise<void> {
    const timeout = this.config.heartbeatTimeoutMs;
    const cutoff = new Date(Date.now() - timeout);

    const db = getDatabase();
    const result = await db.query<Agent>(
      `SELECT * FROM agents
       WHERE project_id = $1
       AND status IN ('idle', 'working')
       AND (last_heartbeat IS NULL OR last_heartbeat < $2)`,
      [this.projectId, cutoff]
    );

    for (const agent of result.rows) {
      this.emit('agent:timeout', agent);
      // Record timeout as negative outcome
      await this.terminateAgent(agent.id, 'timeout');
    }
  }

  private getDefaultPrompt(type: AgentType): string {
    const prompts: Record<AgentType, string> = {
      orchestrator: `# Orchestrator Agent

You coordinate project execution by spawning and managing other agents.

## Core Responsibilities
- Analyze project requirements and break them into parallelizable tasks
- Spawn appropriate agents (Developer, Tester, etc.) for each task
- Monitor agent progress and handle blockers
- Ensure quality through proper agent coordination
- Maximize parallel execution efficiency

## Decision Framework
1. Identify independent tasks that can run in parallel
2. Assign tasks to agents based on their specialization
3. Create dependencies between tasks when needed
4. Monitor for completion and handle failures
5. Aggregate results and verify integration

## Communication Protocol
- Send TASK_ASSIGN messages to spawn agents
- Listen for TASK_COMPLETE and TASK_FAILED messages
- Broadcast STATUS_UPDATE for progress
- Request MENTOR_SUGGESTION when blocked`,

      architect: `# Architect Agent

You design technical solutions and create implementation plans.

## Core Responsibilities
- Analyze requirements and create technical designs
- Define system architecture, patterns, and structure
- Create detailed task breakdowns for developers
- Review code for architectural compliance
- Ensure scalability and maintainability

## Output Format
1. Architecture document with diagrams
2. Task breakdown with dependencies
3. Technical decisions and rationale
4. Risk assessment
5. Integration points`,

      developer: `# Developer Agent

You implement features and write high-quality, production-ready code.

## Core Responsibilities
- Write clean, tested, maintainable code
- Follow established patterns and conventions
- Create unit tests alongside implementation
- Document complex logic
- Handle edge cases and errors properly

## Quality Standards
- All code must have tests
- Follow SOLID principles
- No security vulnerabilities
- Clear naming conventions
- Comprehensive error handling`,

      tester: `# Tester Agent

You ensure code quality through comprehensive testing.

## Core Responsibilities
- Write unit and integration tests
- Identify edge cases and error conditions
- Report bugs with clear reproduction steps
- Verify bug fixes
- Measure code coverage

## Testing Strategy
1. Unit tests for all functions
2. Integration tests for API endpoints
3. Edge case testing
4. Error path testing
5. Performance testing when relevant`,

      qa: `# QA Agent

You validate the complete user experience through end-to-end testing.

## Core Responsibilities
- Test complete user journeys
- Verify UI/UX requirements
- Perform cross-browser testing
- Validate accessibility (WCAG)
- Report UX issues

## Testing Approach
1. Happy path testing
2. Error state testing
3. Responsive design verification
4. Accessibility audit
5. Performance perception`,

      pm: `# PM Agent

You manage requirements and validate deliverables against acceptance criteria.

## Core Responsibilities
- Define clear, testable requirements
- Create acceptance criteria
- Prioritize features by value
- Validate deliverables match requirements
- Track scope and changes

## Output Format
1. User stories with acceptance criteria
2. Priority rankings
3. Scope documents
4. Validation reports`,

      uat: `# UAT Agent

You simulate real end-user testing to validate usability.

## Core Responsibilities
- Test from user perspective (not developer)
- Validate usability and intuitiveness
- Report UX friction points
- Confirm feature completeness
- Verify real-world use cases

## Testing Mindset
- "As a user, I want to..."
- Focus on task completion
- Note confusion points
- Measure time-to-complete`,

      sre: `# SRE Agent

You handle deployment, infrastructure, and operational reliability.

## Core Responsibilities
- Configure CI/CD pipelines
- Manage deployments
- Monitor system health
- Handle incidents
- Optimize performance

## Key Areas
1. Build and deployment automation
2. Infrastructure as code
3. Monitoring and alerting
4. Incident response
5. Capacity planning`,

      monitor: `# Monitor Agent

You continuously watch system health and report issues.

## Core Responsibilities
- Monitor logs and metrics
- Alert on anomalies
- Track performance trends
- Report status
- Identify potential issues

## Monitoring Scope
1. Application logs
2. Error rates
3. Response times
4. Resource utilization
5. User-facing health`,

      mentor: `# Mentor Agent

You provide guidance, research solutions, and help unblock other agents.

## Core Responsibilities
- Research solutions to technical problems
- Provide code examples and best practices
- Suggest alternative approaches
- Help debug complex issues
- Share knowledge across agents

## Support Mode
1. Receive help requests
2. Research and analyze
3. Provide actionable guidance
4. Follow up on implementation`,
    };

    return prompts[type] || '# Agent\nYou are an AI agent working on a software project.';
  }

  // Getters
  getAgent(agentId: string): RLAgent | undefined {
    return this.agents.get(agentId)?.agent;
  }

  getAgentsByType(type: AgentType): RLAgent[] {
    return Array.from(this.agents.values())
      .filter(({ agent }) => agent.type === type)
      .map(({ agent }) => agent);
  }

  getAllAgents(): RLAgent[] {
    return Array.from(this.agents.values()).map(({ agent }) => agent);
  }

  getActiveAgentCount(): number {
    return Array.from(this.agents.values())
      .filter(({ agent }) => ['idle', 'working'].includes(agent.status))
      .length;
  }

  /**
   * Get agent performance statistics for RL analysis
   */
  async getAgentStats(): Promise<{
    byType: Record<AgentType, { total: number; active: number; avgReward: number }>;
    topPrompts: Array<{ agentType: AgentType; promptId: string; version: number; avgReward: number }>;
  }> {
    const db = getDatabase();

    // Stats by agent type
    const typeStats = await db.query<{
      type: AgentType;
      total: string;
      active: string;
      avg_reward: string;
    }>(
      `SELECT
        a.type,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE a.status IN ('idle', 'working')) as active,
        COALESCE(AVG(r.reward), 0) as avg_reward
       FROM agents a
       LEFT JOIN rl_outcomes r ON r.agent_id = a.id
       WHERE a.project_id = $1
       GROUP BY a.type`,
      [this.projectId]
    );

    const byType: Record<string, { total: number; active: number; avgReward: number }> = {};
    for (const row of typeStats.rows) {
      byType[row.type] = {
        total: parseInt(row.total, 10),
        active: parseInt(row.active, 10),
        avgReward: parseFloat(row.avg_reward),
      };
    }

    // Top performing prompts
    const topPrompts = await db.query<{
      agent_type: AgentType;
      prompt_id: string;
      version: number;
      avg_reward: string;
    }>(
      `SELECT
        p.agent_type,
        p.id as prompt_id,
        p.version,
        AVG(r.reward) as avg_reward
       FROM prompts p
       JOIN rl_outcomes r ON r.prompt_id = p.id
       WHERE r.project_id = $1
       GROUP BY p.id, p.agent_type, p.version
       ORDER BY avg_reward DESC
       LIMIT 10`,
      [this.projectId]
    );

    return {
      byType: byType as Record<AgentType, { total: number; active: number; avgReward: number }>,
      topPrompts: topPrompts.rows.map(row => ({
        agentType: row.agent_type,
        promptId: row.prompt_id,
        version: row.version,
        avgReward: parseFloat(row.avg_reward),
      })),
    };
  }
}

// Factory function
export function createAgentManager(options: AgentManagerOptions): AgentManager {
  return new AgentManager(options);
}
