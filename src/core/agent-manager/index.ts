import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import type { Agent, AgentType, AgentStatus, EklavyaConfig } from '../../types/index.js';
import { getDatabase } from '../../lib/database.js';
import { MessageBus } from '../message-bus/index.js';

export interface AgentManagerOptions {
  config: EklavyaConfig;
  projectId: string;
  projectDir: string;
  messageBus: MessageBus;
}

export interface SpawnAgentOptions {
  type: AgentType;
  taskId?: string;
  workingDirectory?: string;
}

export class AgentManager extends EventEmitter {
  private config: EklavyaConfig;
  private projectId: string;
  private projectDir: string;
  private messageBus: MessageBus;
  private agents: Map<string, { agent: Agent; process?: ChildProcess }> = new Map();
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
    const result = await db.query<Agent>(
      `SELECT * FROM agents WHERE project_id = $1 AND status NOT IN ('completed', 'terminated', 'failed')`,
      [this.projectId]
    );

    for (const row of result.rows) {
      this.agents.set(row.id, { agent: row });
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

    // Terminate all agents
    for (const [agentId] of this.agents) {
      await this.terminateAgent(agentId);
    }

    this.emit('stopped');
  }

  async spawnAgent(options: SpawnAgentOptions): Promise<Agent> {
    const db = getDatabase();
    const agentId = uuidv4();
    const workingDir = options.workingDirectory ||
      path.join(this.projectDir, 'agents', options.type, agentId);

    // Create working directory
    await fs.mkdir(workingDir, { recursive: true });

    // Create agent-specific CLAUDE.md with system prompt
    const promptContent = await this.getAgentPrompt(options.type);
    await fs.writeFile(path.join(workingDir, 'CLAUDE.md'), promptContent);

    // Create agent record
    const agent: Agent = {
      id: agentId,
      projectId: this.projectId,
      type: options.type,
      status: 'initializing',
      workingDirectory: workingDir,
      currentTaskId: options.taskId,
      metrics: { tasksCompleted: 0, tasksFailed: 0, tokensUsed: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.query(
      `INSERT INTO agents (id, project_id, type, status, working_directory, current_task_id, metrics, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        agent.id,
        agent.projectId,
        agent.type,
        agent.status,
        agent.workingDirectory,
        agent.currentTaskId || null,
        JSON.stringify(agent.metrics),
        agent.createdAt,
        agent.updatedAt,
      ]
    );

    // Spawn Claude Code process
    const process = await this.spawnClaudeProcess(agent);

    this.agents.set(agentId, { agent, process });

    // Update status to idle
    await this.updateAgentStatus(agentId, 'idle');

    // Subscribe to messages
    await this.messageBus.subscribe(agentId);

    this.emit('agent:spawned', agent);
    return agent;
  }

  private async spawnClaudeProcess(agent: Agent): Promise<ChildProcess> {
    const args = [
      '--dangerously-skip-permissions',
      '--project-dir', agent.workingDirectory!,
    ];

    const proc = spawn('claude', args, {
      cwd: agent.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        EKLAVYA_AGENT_ID: agent.id,
        EKLAVYA_PROJECT_ID: this.projectId,
        EKLAVYA_AGENT_TYPE: agent.type,
      },
    });

    proc.on('exit', async (code) => {
      const status: AgentStatus = code === 0 ? 'completed' : 'failed';
      await this.updateAgentStatus(agent.id, status);
      this.emit('agent:exited', { agent, code });
    });

    proc.on('error', async (error) => {
      await this.updateAgentStatus(agent.id, 'failed');
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

  async terminateAgent(agentId: string): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) return;

    const { agent, process } = entry;

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

    await this.updateAgentStatus(agentId, 'terminated');
    this.agents.delete(agentId);

    this.emit('agent:terminated', agent);
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
      await this.updateAgentStatus(agent.id, 'failed');
    }
  }

  private async getAgentPrompt(type: AgentType): Promise<string> {
    // Load from prompts table using Thompson Sampling
    const db = getDatabase();
    const result = await db.query<{ content: string; id: string }>(
      `SELECT id, content, alpha, beta FROM prompts
       WHERE agent_type = $1 AND status IN ('production', 'candidate', 'experimental')
       ORDER BY
         CASE status
           WHEN 'production' THEN 1
           WHEN 'candidate' THEN 2
           ELSE 3
         END`,
      [type]
    );

    if (result.rows.length === 0) {
      return this.getDefaultPrompt(type);
    }

    // Thompson Sampling: sample from Beta distribution
    // For simplicity, just use the production prompt or first available
    return result.rows[0].content;
  }

  private getDefaultPrompt(type: AgentType): string {
    const prompts: Record<AgentType, string> = {
      orchestrator: `# Orchestrator Agent
You coordinate project execution, spawn other agents, and ensure tasks are completed.
Your responsibilities:
- Break down project requirements into tasks
- Assign tasks to appropriate agents
- Monitor progress and handle blockers
- Ensure quality and integration`,

      architect: `# Architect Agent
You design technical solutions and create implementation plans.
Your responsibilities:
- Analyze requirements and create technical designs
- Define system architecture and patterns
- Create task breakdowns for developers
- Review code for architectural compliance`,

      developer: `# Developer Agent
You implement features and write high-quality code.
Your responsibilities:
- Write clean, tested, maintainable code
- Follow established patterns and conventions
- Create unit tests for your code
- Document complex logic`,

      tester: `# Tester Agent
You create and run tests to ensure quality.
Your responsibilities:
- Write unit and integration tests
- Identify edge cases and error conditions
- Report bugs with clear reproduction steps
- Verify fixes`,

      qa: `# QA Agent
You perform end-to-end testing and validate user flows.
Your responsibilities:
- Test complete user journeys
- Verify UI/UX requirements
- Perform cross-browser testing
- Validate accessibility`,

      pm: `# PM Agent
You manage requirements and acceptance criteria.
Your responsibilities:
- Define clear requirements
- Create acceptance criteria
- Prioritize features
- Validate deliverables`,

      uat: `# UAT Agent
You simulate end-user testing.
Your responsibilities:
- Test from user perspective
- Validate usability
- Report UX issues
- Confirm feature completeness`,

      sre: `# SRE Agent
You handle deployment and infrastructure.
Your responsibilities:
- Configure CI/CD pipelines
- Manage deployments
- Monitor system health
- Handle incidents`,

      monitor: `# Monitor Agent
You watch system health and report issues.
Your responsibilities:
- Monitor logs and metrics
- Alert on anomalies
- Track performance
- Report status`,

      mentor: `# Mentor Agent
You provide guidance and help unblock other agents.
Your responsibilities:
- Research solutions
- Provide code examples
- Suggest best practices
- Encourage and guide`,
    };

    return prompts[type] || '# Agent\nYou are an AI agent working on a software project.';
  }

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId)?.agent;
  }

  getAgentsByType(type: AgentType): Agent[] {
    return Array.from(this.agents.values())
      .filter(({ agent }) => agent.type === type)
      .map(({ agent }) => agent);
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values()).map(({ agent }) => agent);
  }

  getActiveAgentCount(): number {
    return Array.from(this.agents.values())
      .filter(({ agent }) => ['idle', 'working'].includes(agent.status))
      .length;
  }
}

// Factory function
export function createAgentManager(options: AgentManagerOptions): AgentManager {
  return new AgentManager(options);
}
