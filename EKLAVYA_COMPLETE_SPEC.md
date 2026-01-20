# Eklavya Complete Implementation Specification

> **Purpose**: This document contains everything needed to build Eklavya autonomously. No ambiguity. No clarification needed. Every decision is made.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Agent Execution Model](#2-agent-execution-model)
3. [Inter-Agent Communication](#3-inter-agent-communication)
4. [Tool System & Permissions](#4-tool-system--permissions)
5. [Project Isolation & Structure](#5-project-isolation--structure)
6. [Reinforcement Learning System](#6-reinforcement-learning-system)
7. [Context Management](#7-context-management)
8. [Recovery & Persistence](#8-recovery--persistence)
9. [Security Model](#9-security-model)
10. [Cost Management](#10-cost-management)
11. [Observability](#11-observability)
12. [Complete Agent Prompts](#12-complete-agent-prompts)
13. [API Specifications](#13-api-specifications)
14. [Database Schema](#14-database-schema)
15. [Configuration](#15-configuration)
16. [Bootstrap Process](#16-bootstrap-process)

---

## 1. Executive Summary

### What Eklavya Is

Eklavya is a **self-improving autonomous agent orchestration platform** that:
- Takes a project description from a human
- Creates a plan (requires human approval)
- Executes the entire project autonomously (no further approval)
- Learns from every action to improve future performance

### Core Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Node.js 20+ with TypeScript | Best AI SDK support, async-native |
| Database | PostgreSQL 16 | JSONB for flexibility, LISTEN/NOTIFY for events |
| Cache/Queue | Redis 7 | Pub/sub, caching, rate limiting |
| AI Provider | Anthropic Claude | Best coding capability, tool use support |
| Agent Execution | Claude Code CLI | Built-in tools, sandboxing, proven reliability |
| Web Framework | Next.js 14 | Full-stack, real-time capable |
| Container | Docker | Project isolation, reproducibility |

### Non-Negotiable Principles

1. **Projects are fully isolated** - Each project runs in its own directory with its own agent instances
2. **Agents use Claude Code** - Agents ARE Claude Code instances with specialized prompts
3. **Everything is logged** - Every action, decision, and outcome is recorded for learning
4. **Fail gracefully** - Agents checkpoint progress and can resume from any point
5. **Cost-aware** - Hard limits prevent runaway spending

---

## 2. Agent Execution Model

### 2.1 Core Insight: Agents ARE Claude Code

Instead of building a custom agent runtime, **each agent is a Claude Code instance** with:
- A specialized system prompt (loaded via CLAUDE.md in the agent's working directory)
- Specific tool permissions (controlled via Claude Code's permission system)
- Access to a message queue for coordination

This gives us:
- Battle-tested tool execution (file I/O, git, terminal, browser)
- Built-in sandboxing and safety
- Conversation persistence
- Multi-model support

### 2.2 Agent Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                      AGENT LIFECYCLE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  SPAWN   │ -> │  INIT    │ -> │  READY   │ -> │ WORKING  │  │
│  │          │    │          │    │          │    │          │  │
│  │ Create   │    │ Load     │    │ Wait for │    │ Execute  │  │
│  │ process  │    │ context  │    │ task     │    │ task     │  │
│  └──────────┘    └──────────┘    └──────────┘    └────┬─────┘  │
│                                                       │         │
│       ┌───────────────────────────────────────────────┤         │
│       │                                               │         │
│       v                                               v         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │CHECKPOINT│ <- │ PAUSED   │    │ BLOCKED  │ -> │  FAILED  │  │
│  │          │    │          │    │          │    │          │  │
│  │ Save     │    │ Wait for │    │ Need     │    │ Unrecov- │  │
│  │ state    │    │ resume   │    │ help     │    │ erable   │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       │                                               │         │
│       v                                               v         │
│  ┌──────────┐                                   ┌──────────┐   │
│  │ COMPLETE │                                   │TERMINATED│   │
│  │          │                                   │          │   │
│  │ Task     │                                   │ Cleanup  │   │
│  │ done     │                                   │ resources│   │
│  └──────────┘                                   └──────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Agent Process Structure

Each agent runs as a separate process:

```typescript
interface AgentProcess {
  // Identity
  id: string;                    // UUID
  projectId: string;             // Parent project
  agentType: AgentType;          // orchestrator, developer, etc.
  instanceNumber: number;        // For multiple agents of same type

  // Process
  pid: number;                   // OS process ID
  workingDirectory: string;      // Agent's workspace
  claudeSessionId: string;       // Claude Code session ID

  // State
  status: AgentStatus;
  currentTask: Task | null;
  checkpoint: Checkpoint | null;

  // Resources
  tokenBudget: number;           // Remaining tokens
  timeBudget: number;            // Remaining time (ms)

  // Communication
  messageQueueId: string;        // Redis queue ID
  lastHeartbeat: Date;
}
```

### 2.4 Spawning an Agent

```typescript
async function spawnAgent(config: AgentSpawnConfig): Promise<AgentProcess> {
  const agentId = generateUUID();
  const workDir = path.join(
    PROJECTS_DIR,
    config.projectId,
    '.eklavya',
    'agents',
    `${config.agentType}-${agentId.slice(0, 8)}`
  );

  // 1. Create agent workspace
  await fs.mkdir(workDir, { recursive: true });

  // 2. Write agent-specific CLAUDE.md
  const prompt = await getPromptForAgent(config.agentType, config.projectId);
  await fs.writeFile(
    path.join(workDir, 'CLAUDE.md'),
    prompt
  );

  // 3. Write agent context file
  await fs.writeFile(
    path.join(workDir, '.eklavya-context.json'),
    JSON.stringify({
      agentId,
      projectId: config.projectId,
      agentType: config.agentType,
      projectRoot: path.join(PROJECTS_DIR, config.projectId),
      messageQueue: `eklavya:${config.projectId}:${agentId}`,
      orchestratorQueue: `eklavya:${config.projectId}:orchestrator`,
    })
  );

  // 4. Spawn Claude Code process
  const proc = spawn('claude', [
    '--project-dir', workDir,
    '--allowedTools', getToolsForAgent(config.agentType).join(','),
    '--model', config.model || 'claude-sonnet-4-20250514',
    '--print', // Non-interactive mode
  ], {
    cwd: workDir,
    env: {
      ...process.env,
      EKLAVYA_AGENT_ID: agentId,
      EKLAVYA_PROJECT_ID: config.projectId,
      EKLAVYA_AGENT_TYPE: config.agentType,
    }
  });

  // 5. Register in database
  await db.agents.create({
    id: agentId,
    projectId: config.projectId,
    agentType: config.agentType,
    pid: proc.pid,
    workingDirectory: workDir,
    status: 'initializing',
    tokenBudget: config.tokenBudget || DEFAULT_TOKEN_BUDGET,
    timeBudget: config.timeBudget || DEFAULT_TIME_BUDGET,
  });

  // 6. Send initialization message
  await messageQueue.publish(`eklavya:${config.projectId}:${agentId}`, {
    type: 'INIT',
    payload: {
      task: config.initialTask,
      context: config.context,
    }
  });

  return getAgentProcess(agentId);
}
```

### 2.5 Agent Heartbeat & Health

Agents must send heartbeats every 30 seconds:

```typescript
// Agent sends this via tool call to Eklavya API
interface Heartbeat {
  agentId: string;
  timestamp: Date;
  status: 'working' | 'idle' | 'blocked';
  currentTask?: string;
  progress?: number;          // 0-100
  tokenUsed: number;
  tokenRemaining: number;
  memoryUsage: number;
}

// Monitor checks for stale agents
async function checkAgentHealth() {
  const agents = await db.agents.findActive();
  const now = Date.now();

  for (const agent of agents) {
    const staleness = now - agent.lastHeartbeat.getTime();

    if (staleness > 60000) { // 1 minute without heartbeat
      await handleStaleAgent(agent);
    }
  }
}

async function handleStaleAgent(agent: Agent) {
  // 1. Try to ping the process
  const isAlive = await pingProcess(agent.pid);

  if (!isAlive) {
    // 2. Process died - attempt recovery
    await recoverAgent(agent);
  } else {
    // 3. Process alive but not responding - force checkpoint
    await forceCheckpoint(agent);
  }
}
```

---

## 3. Inter-Agent Communication

### 3.1 Message Bus Architecture

Using Redis Pub/Sub with PostgreSQL for persistence:

```
┌─────────────────────────────────────────────────────────────────┐
│                     MESSAGE BUS ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐     ┌─────────────────┐     ┌──────────────────┐  │
│  │  Agent   │────>│  Redis Pub/Sub  │────>│  Other Agents    │  │
│  │          │     │                 │     │                  │  │
│  └──────────┘     └────────┬────────┘     └──────────────────┘  │
│                            │                                     │
│                            v                                     │
│                   ┌─────────────────┐                           │
│                   │   PostgreSQL    │                           │
│                   │  (persistence)  │                           │
│                   └─────────────────┘                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Message Types

```typescript
type MessageType =
  // Task Management
  | 'TASK_ASSIGN'        // Orchestrator assigns task to agent
  | 'TASK_ACCEPTED'      // Agent accepts task
  | 'TASK_REJECTED'      // Agent rejects task (with reason)
  | 'TASK_PROGRESS'      // Agent reports progress
  | 'TASK_COMPLETE'      // Agent completes task
  | 'TASK_FAILED'        // Agent fails task
  | 'TASK_BLOCKED'       // Agent is blocked, needs help

  // Agent Coordination
  | 'AGENT_SPAWN'        // Request to spawn new agent
  | 'AGENT_TERMINATE'    // Request to terminate agent
  | 'AGENT_HEARTBEAT'    // Health check

  // Mentor Interactions
  | 'MENTOR_SUGGESTION'  // Mentor offers advice
  | 'MENTOR_REQUEST'     // Agent asks mentor for help
  | 'MENTOR_RESEARCH'    // Mentor shares research findings

  // System Events
  | 'PROJECT_PAUSE'      // Pause all agents
  | 'PROJECT_RESUME'     // Resume all agents
  | 'CHECKPOINT_REQUEST' // Request agent to checkpoint
  | 'BUDGET_WARNING'     // Token/time budget running low
  | 'BUDGET_EXHAUSTED'   // Budget exhausted, must stop

  // Learning Events
  | 'REWARD_EVENT'       // Positive outcome recorded
  | 'PENALTY_EVENT'      // Negative outcome recorded
  | 'LEARNING_UPDATE';   // Prompt/policy updated
```

### 3.3 Message Schema

```typescript
interface AgentMessage {
  // Identity
  id: string;                          // UUID
  type: MessageType;
  correlationId?: string;              // Links related messages

  // Routing
  from: {
    agentId: string;
    agentType: AgentType;
  };
  to: {
    agentId: string;                   // Specific agent or 'broadcast'
    agentType?: AgentType;             // For type-based routing
  };

  // Content
  payload: Record<string, unknown>;

  // Metadata
  timestamp: Date;
  priority: 'low' | 'normal' | 'high' | 'critical';
  ttl?: number;                        // Time-to-live in ms

  // Delivery
  requiresAck: boolean;
  ackTimeout?: number;
  retryCount?: number;
}
```

### 3.4 Task Assignment Protocol

```typescript
// Orchestrator assigns task to Developer
const taskAssignment: AgentMessage = {
  id: generateUUID(),
  type: 'TASK_ASSIGN',
  correlationId: generateUUID(), // Used to track this entire task flow
  from: {
    agentId: 'orch-001',
    agentType: 'orchestrator'
  },
  to: {
    agentId: 'dev-003',
    agentType: 'developer'
  },
  payload: {
    task: {
      id: 'task-123',
      type: 'implement_feature',
      title: 'Implement user authentication',
      description: 'Create JWT-based auth with login/logout/refresh',
      requirements: [
        'POST /api/auth/login - accepts email/password, returns JWT',
        'POST /api/auth/logout - invalidates token',
        'POST /api/auth/refresh - refreshes JWT',
        'Middleware to protect routes',
        'Password hashing with bcrypt',
      ],
      acceptanceCriteria: [
        'All endpoints return correct status codes',
        'JWT expires in 1 hour',
        'Refresh token expires in 7 days',
        'Unit tests cover happy path and errors',
      ],
      dependencies: ['task-100'], // Must complete after this task
      estimatedComplexity: 'medium',
      files: {
        toCreate: [
          'src/api/auth/login.ts',
          'src/api/auth/logout.ts',
          'src/api/auth/refresh.ts',
          'src/middleware/auth.ts',
          'src/utils/jwt.ts',
        ],
        toModify: [
          'src/api/index.ts', // Add routes
        ],
        toReference: [
          'src/db/models/user.ts', // Existing user model
        ]
      }
    },
    context: {
      projectType: 'nextjs',
      existingPatterns: 'See src/api/users for API pattern',
      relatedDocs: '.eklavya/docs/auth-spec.md',
    },
    constraints: {
      tokenBudget: 50000,
      timeLimit: 3600000, // 1 hour
      mustPassTests: true,
    }
  },
  timestamp: new Date(),
  priority: 'normal',
  requiresAck: true,
  ackTimeout: 30000,
};
```

### 3.5 Channel Structure

```
Redis Channels:
├── eklavya:{projectId}:orchestrator     # Orchestrator's inbox
├── eklavya:{projectId}:broadcast        # All agents in project
├── eklavya:{projectId}:{agentId}        # Specific agent inbox
├── eklavya:{projectId}:mentor           # Mentor's inbox
├── eklavya:{projectId}:monitor          # Monitor's inbox
├── eklavya:system                        # System-wide events
└── eklavya:learning                      # Learning system events
```

---

## 4. Tool System & Permissions

### 4.1 Tool Categories

```typescript
enum ToolCategory {
  FILE_SYSTEM = 'file_system',     // Read, write, edit files
  GIT = 'git',                      // Version control
  TERMINAL = 'terminal',            // Run commands
  BROWSER = 'browser',              // Web automation
  DATABASE = 'database',            // DB operations
  NETWORK = 'network',              // HTTP requests
  AI = 'ai',                        // AI model calls
  EKLAVYA = 'eklavya',             // Eklavya-specific tools
}
```

### 4.2 Permission Matrix

| Agent | File System | Git | Terminal | Browser | Database | Network | AI | Eklavya |
|-------|-------------|-----|----------|---------|----------|---------|----|---------|
| Orchestrator | Read | Read | No | No | Read | No | Yes | Full |
| Architect | Read/Write (.md, .json) | Read | No | Research | Read | Docs only | Yes | Status |
| Developer | Full (project scope) | Full | Full | No | Migrate | Package repos | Yes | Status |
| Tester | Read + Write tests | Read | Test commands | No | Test DB | No | Yes | Status |
| QA | Read | Read | No | Full | Read | API testing | Yes | Status |
| PM | Read (.md, .json) | Read | No | Research | Read | Docs only | Yes | Status |
| UAT | Read | Read | No | Full | Read | No | Yes | Status |
| SRE | Full | Full | Full | Monitoring | Full | Full | Yes | Status |
| Monitor | Read (logs) | Read | Health checks | Dashboards | Read | Metrics | Yes | Alerts |
| Mentor | Read | Read | No | Research | Read | Research | Yes | Suggest |

### 4.3 Tool Definitions

```typescript
// Eklavya-specific tools that agents can call

const eklavyaTools = {
  // Communication
  sendMessage: {
    description: 'Send a message to another agent or the orchestrator',
    parameters: {
      to: { type: 'string', description: 'Target agent ID or "orchestrator"' },
      type: { type: 'string', enum: Object.values(MessageType) },
      payload: { type: 'object' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
    },
    returns: { messageId: 'string' },
  },

  // Status
  reportProgress: {
    description: 'Report task progress to orchestrator',
    parameters: {
      taskId: { type: 'string' },
      progress: { type: 'number', min: 0, max: 100 },
      status: { type: 'string' },
      blockers: { type: 'array', items: { type: 'string' } },
    },
  },

  // Checkpointing
  checkpoint: {
    description: 'Save current state for recovery',
    parameters: {
      state: { type: 'object', description: 'Serializable state to save' },
      description: { type: 'string' },
    },
  },

  // Learning
  recordOutcome: {
    description: 'Record task outcome for learning system',
    parameters: {
      taskId: { type: 'string' },
      success: { type: 'boolean' },
      metrics: { type: 'object' },
      notes: { type: 'string' },
    },
  },

  // Resource queries
  getBudget: {
    description: 'Get remaining token and time budget',
    parameters: {},
    returns: {
      tokensRemaining: 'number',
      timeRemaining: 'number',
      percentUsed: 'number',
    },
  },

  // Agent spawning (Orchestrator only)
  spawnAgent: {
    description: 'Spawn a new agent',
    parameters: {
      agentType: { type: 'string', enum: Object.values(AgentType) },
      task: { type: 'object' },
      config: { type: 'object' },
    },
    returns: { agentId: 'string' },
  },

  terminateAgent: {
    description: 'Terminate an agent',
    parameters: {
      agentId: { type: 'string' },
      reason: { type: 'string' },
    },
  },
};
```

### 4.4 Sandboxing Rules

```typescript
interface SandboxConfig {
  // File system
  allowedPaths: string[];           // Glob patterns for allowed paths
  deniedPaths: string[];            // Explicitly denied (overrides allowed)
  maxFileSize: number;              // Max file size in bytes
  maxTotalFiles: number;            // Max files agent can create

  // Terminal
  allowedCommands: string[];        // Allowed command prefixes
  deniedCommands: string[];         // Explicitly denied
  maxProcessTime: number;           // Max time for single command
  maxConcurrentProcesses: number;   // Max parallel processes

  // Network
  allowedDomains: string[];         // Domains agent can access
  deniedDomains: string[];          // Explicitly blocked
  maxRequestsPerMinute: number;     // Rate limiting

  // Resources
  maxMemoryMB: number;              // Memory limit
  maxCPUPercent: number;            // CPU limit
}

// Default sandbox for Developer agent
const developerSandbox: SandboxConfig = {
  allowedPaths: [
    '${PROJECT_ROOT}/**/*',         // Full project access
    '!${PROJECT_ROOT}/.eklavya/**', // Except Eklavya internals
    '!${PROJECT_ROOT}/.env*',       // Except env files
  ],
  deniedPaths: [
    '/etc/**',
    '/usr/**',
    '~/.ssh/**',
    '~/.aws/**',
  ],
  maxFileSize: 10 * 1024 * 1024,    // 10MB
  maxTotalFiles: 1000,

  allowedCommands: [
    'npm', 'npx', 'yarn', 'pnpm',   // Package managers
    'node', 'ts-node', 'tsx',       // Runtimes
    'git',                          // Version control
    'cat', 'ls', 'find', 'grep',    // Read-only unix
    'mkdir', 'cp', 'mv', 'rm',      // File operations (within sandbox)
    'docker', 'docker-compose',      // Containers (if enabled)
    'psql', 'redis-cli',            // DB clients
    'curl', 'wget',                 // Downloads (controlled)
  ],
  deniedCommands: [
    'sudo', 'su',                   // Privilege escalation
    'rm -rf /',                     // Dangerous patterns
    'chmod 777',                    // Insecure permissions
    ':(){:|:&};:',                  // Fork bomb
  ],
  maxProcessTime: 300000,           // 5 minutes per command
  maxConcurrentProcesses: 5,

  allowedDomains: [
    'registry.npmjs.org',
    'github.com',
    'raw.githubusercontent.com',
    'api.anthropic.com',
    'api.openai.com',
  ],
  deniedDomains: [
    'localhost',                    // Prevent SSRF
    '127.0.0.1',
    '0.0.0.0',
    '*.internal',
  ],
  maxRequestsPerMinute: 60,

  maxMemoryMB: 2048,
  maxCPUPercent: 80,
};
```

---

## 5. Project Isolation & Structure

### 5.1 Directory Structure

```
eklavya/                              # Platform root
├── src/                              # Platform source code
├── prompts/                          # Agent prompt templates
├── projects/                         # User projects live here
│   └── {project-id}/                 # Individual project
│       ├── .eklavya/                 # Eklavya metadata (hidden)
│       │   ├── config.json           # Project configuration
│       │   ├── state.json            # Current project state
│       │   ├── plan.md               # Approved implementation plan
│       │   ├── agents/               # Agent workspaces
│       │   │   ├── orch-abc123/      # Orchestrator workspace
│       │   │   │   ├── CLAUDE.md     # Agent-specific prompt
│       │   │   │   └── context.json  # Agent context
│       │   │   ├── dev-def456/       # Developer workspace
│       │   │   └── ...
│       │   ├── checkpoints/          # Recovery checkpoints
│       │   │   └── {timestamp}/
│       │   ├── logs/                 # Agent and system logs
│       │   │   ├── orchestrator.log
│       │   │   ├── dev-001.log
│       │   │   └── system.log
│       │   ├── metrics/              # Performance metrics
│       │   │   └── rewards.jsonl
│       │   └── docs/                 # Generated documentation
│       │       ├── architecture.md
│       │       └── api-spec.md
│       ├── src/                      # Actual project source
│       ├── tests/                    # Project tests
│       ├── package.json              # Project dependencies
│       └── ...                       # Other project files
└── data/                             # Platform data
    ├── prompts/                      # Versioned prompts
    └── learning/                     # RL training data
```

### 5.2 Project Configuration

```typescript
// .eklavya/config.json
interface ProjectConfig {
  // Identity
  id: string;
  name: string;
  description: string;
  createdAt: Date;

  // Settings
  autonomyLevel: 'conservative' | 'standard' | 'aggressive';
  model: {
    default: string;               // claude-sonnet-4-20250514
    architect?: string;            // Can override per agent
    developer?: string;
  };

  // Budgets
  budgets: {
    totalTokens: number;           // Max tokens for entire project
    totalTime: number;             // Max time in ms
    maxConcurrentAgents: number;   // Max parallel agents
    maxCostUSD: number;            // Hard cost limit
  };

  // Project type hints
  projectType: {
    framework: string;             // nextjs, react, node, python, etc.
    language: string;              // typescript, javascript, python
    features: string[];            // auth, database, api, etc.
  };

  // Integration
  integrations: {
    github?: {
      repo: string;
      branch: string;
      autoCommit: boolean;
      autoPR: boolean;
    };
    notifications?: {
      slack?: string;
      email?: string;
    };
  };
}
```

### 5.3 Project State Machine

```typescript
// .eklavya/state.json
interface ProjectState {
  // Current status
  status: ProjectStatus;
  phase: ProjectPhase;

  // Progress
  tasksTotal: number;
  tasksCompleted: number;
  currentTasks: Task[];

  // Agents
  activeAgents: AgentSummary[];

  // Metrics
  tokensUsed: number;
  timeElapsed: number;
  costUSD: number;

  // History
  phaseHistory: PhaseTransition[];

  // Checkpoints
  lastCheckpoint: string;          // Timestamp
  checkpointCount: number;
}

type ProjectStatus =
  | 'initializing'      // Project created, not yet started
  | 'planning'          // Architect creating plan
  | 'awaiting_approval' // Plan ready, waiting for human
  | 'executing'         // Agents working
  | 'paused'           // Manually paused
  | 'blocked'          // Blocked on issue
  | 'completed'        // Successfully finished
  | 'failed'           // Unrecoverable failure
  | 'cancelled';       // User cancelled

type ProjectPhase =
  | 'research'         // Mentor researching
  | 'architecture'     // Architect designing
  | 'foundation'       // Initial setup
  | 'implementation'   // Core development
  | 'testing'          // Test creation and execution
  | 'qa'              // Quality assurance
  | 'deployment'       // Deploy and SRE
  | 'monitoring';      // Post-deploy monitoring
```

---

## 6. Reinforcement Learning System

### 6.1 Learning Architecture

We use **Contextual Bandits** (simpler than full RL, more practical for this use case):

```
┌─────────────────────────────────────────────────────────────────┐
│                    LEARNING ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    CONTEXT VECTOR                         │   │
│  │  [agent_type, task_type, complexity, project_type, ...]  │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                      │
│                           v                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   PROMPT SELECTOR                         │   │
│  │           (Thompson Sampling / UCB)                       │   │
│  │                                                           │   │
│  │    prompt_v1: μ=7.2, σ=1.1, n=150                        │   │
│  │    prompt_v2: μ=7.8, σ=1.4, n=45   <-- selected          │   │
│  │    prompt_v3: μ=6.1, σ=2.3, n=12                         │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                      │
│                           v                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   AGENT EXECUTION                         │   │
│  │              (using selected prompt)                      │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                      │
│                           v                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   REWARD SIGNAL                           │   │
│  │                                                           │   │
│  │  Immediate: task_success (+5), tests_pass (+3)           │   │
│  │  Delayed: code_review (+2), prod_stability (+5)          │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                      │
│                           v                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   UPDATE BELIEFS                          │   │
│  │           (Bayesian update of prompt stats)               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Context Features

```typescript
interface LearningContext {
  // Agent context
  agentType: AgentType;
  promptVersion: string;

  // Task context
  taskType: TaskType;
  taskComplexity: 'trivial' | 'simple' | 'medium' | 'complex' | 'very_complex';
  estimatedLines: number;
  numFilesToModify: number;

  // Project context
  projectType: string;           // nextjs, express, python, etc.
  projectSize: 'small' | 'medium' | 'large';
  projectAge: number;            // Days since creation
  codebaseLines: number;

  // Historical context
  previousAttempts: number;      // Retries on this task
  agentExperienceLevel: number;  // Tasks completed by this agent type
  similarTaskSuccessRate: number;

  // Resource context
  tokenBudgetRemaining: number;
  timeBudgetRemaining: number;
}
```

### 6.3 Reward Signals

```typescript
interface RewardConfig {
  // Immediate rewards (given right after task completion)
  immediate: {
    taskComplete: 5,
    taskCompleteFirstTry: 8,
    testsPass: 3,
    testsPassFirstRun: 5,
    codeCompiles: 2,
    noLintErrors: 1,
    underBudget: 2,            // Completed under token budget
    earlyCompletion: 2,        // Completed under time budget
  };

  // Delayed rewards (given after subsequent validation)
  delayed: {
    codeReviewApproved: 3,
    codeReviewNoChanges: 5,
    qaApproved: 3,
    uatApproved: 5,
    productionStable24h: 5,
    productionStable7d: 10,
    noRegressions: 3,
  };

  // Penalties (negative rewards)
  penalties: {
    taskFailed: -5,
    taskFailedMultipleTries: -8,
    testsFailure: -3,
    compilationError: -3,
    securityVulnerability: -10,
    codeReviewRejected: -3,
    qaRejected: -5,
    productionIncident: -10,
    budgetExceeded: -3,
    timeoutExceeded: -3,
    requiredHumanIntervention: -5,
  };
}
```

### 6.4 Prompt Evolution

```typescript
interface PromptVersion {
  id: string;
  agentType: AgentType;
  version: string;                    // Semantic versioning
  prompt: string;
  status: 'experimental' | 'candidate' | 'production' | 'deprecated';

  // Statistics (Bayesian)
  stats: {
    totalUses: number;
    successCount: number;
    totalReward: number;
    rewardMean: number;
    rewardVariance: number;

    // For Thompson Sampling
    alpha: number;                    // Success pseudo-count
    beta: number;                     // Failure pseudo-count
  };

  // Lineage
  parentId: string | null;
  mutations: PromptMutation[];
  createdAt: Date;

  // Context-specific performance
  contextPerformance: Map<string, PromptStats>;  // Context hash -> stats
}

interface PromptMutation {
  type: 'add_instruction' | 'remove_instruction' | 'modify_instruction' |
        'add_example' | 'remove_example' | 'restructure' | 'tone_shift';
  description: string;
  diff: string;                       // What changed
  reason: string;                     // Why (from learning analysis)
}
```

### 6.5 Prompt Selection Algorithm

```typescript
// Thompson Sampling for prompt selection
function selectPrompt(
  agentType: AgentType,
  context: LearningContext
): PromptVersion {
  const candidates = getActivePrompts(agentType);
  let bestPrompt: PromptVersion | null = null;
  let bestSample = -Infinity;

  for (const prompt of candidates) {
    // Get context-specific stats if available
    const contextKey = hashContext(context);
    const stats = prompt.contextPerformance.get(contextKey) || prompt.stats;

    // Sample from Beta distribution
    const sample = sampleBeta(stats.alpha, stats.beta);

    // Weight by mean reward
    const weightedSample = sample * stats.rewardMean;

    if (weightedSample > bestSample) {
      bestSample = weightedSample;
      bestPrompt = prompt;
    }
  }

  return bestPrompt!;
}

// Update after observing reward
function updatePromptStats(
  promptId: string,
  context: LearningContext,
  reward: number,
  maxReward: number
): void {
  const prompt = getPrompt(promptId);
  const contextKey = hashContext(context);

  // Normalize reward to [0, 1]
  const normalizedReward = (reward - MIN_REWARD) / (maxReward - MIN_REWARD);
  const success = normalizedReward > 0.5;

  // Update global stats
  prompt.stats.totalUses++;
  prompt.stats.totalReward += reward;
  prompt.stats.rewardMean = prompt.stats.totalReward / prompt.stats.totalUses;
  prompt.stats.alpha += success ? 1 : 0;
  prompt.stats.beta += success ? 0 : 1;

  // Update context-specific stats
  let contextStats = prompt.contextPerformance.get(contextKey);
  if (!contextStats) {
    contextStats = { alpha: 1, beta: 1, totalUses: 0, totalReward: 0, rewardMean: 0 };
  }
  contextStats.totalUses++;
  contextStats.totalReward += reward;
  contextStats.rewardMean = contextStats.totalReward / contextStats.totalUses;
  contextStats.alpha += success ? 1 : 0;
  contextStats.beta += success ? 0 : 1;

  prompt.contextPerformance.set(contextKey, contextStats);

  // Check for promotion/demotion
  await checkPromptPromotion(prompt);
}
```

### 6.6 Automatic Prompt Mutation

```typescript
// Triggered when prompt performance degrades or plateaus
async function mutatePrompt(
  basePrompt: PromptVersion,
  analysisResults: PerformanceAnalysis
): Promise<PromptVersion> {
  const mutationPrompt = `
You are a prompt engineer improving an AI agent prompt.

CURRENT PROMPT:
${basePrompt.prompt}

PERFORMANCE ANALYSIS:
- Success rate: ${analysisResults.successRate}%
- Common failures: ${analysisResults.commonFailures.join(', ')}
- Comparison to best: ${analysisResults.gapToBest}% behind

FAILURE EXAMPLES:
${analysisResults.failureExamples.slice(0, 3).map(f =>
  `Task: ${f.task}\nOutcome: ${f.outcome}\nRoot cause: ${f.analysis}`
).join('\n\n')}

Generate an improved version of this prompt that addresses the identified issues.
Return ONLY the new prompt, no explanation.
`;

  const newPromptText = await callAI(mutationPrompt);

  const newPrompt: PromptVersion = {
    id: generateUUID(),
    agentType: basePrompt.agentType,
    version: incrementVersion(basePrompt.version),
    prompt: newPromptText,
    status: 'experimental',
    stats: { alpha: 1, beta: 1, totalUses: 0, totalReward: 0, rewardMean: 0, rewardVariance: 0 },
    parentId: basePrompt.id,
    mutations: [{
      type: 'modify_instruction',
      description: 'Automated mutation based on failure analysis',
      diff: generateDiff(basePrompt.prompt, newPromptText),
      reason: analysisResults.commonFailures.join('; '),
    }],
    createdAt: new Date(),
    contextPerformance: new Map(),
  };

  await savePrompt(newPrompt);
  return newPrompt;
}
```

---

## 7. Context Management

### 7.1 The Context Problem

Agents running for hours/days will exceed context windows. Solutions:

1. **Hierarchical Summarization** - Compress old context periodically
2. **External Memory** - Store detailed context in files, reference as needed
3. **Checkpoint-based Recovery** - Full state saved, can restart fresh with context

### 7.2 Context Structure

```typescript
interface AgentContext {
  // Core identity (always in context)
  identity: {
    agentId: string;
    agentType: AgentType;
    projectId: string;
    currentTask: Task;
  };

  // Project knowledge (summarized)
  projectKnowledge: {
    summary: string;               // 500-word project summary
    architecture: string;          // Key architectural decisions
    conventions: string;           // Coding patterns and conventions
    keyFiles: FileReference[];     // Important files to know about
  };

  // Task history (compressed)
  taskHistory: {
    completed: TaskSummary[];      // Last 10 completed tasks
    failed: TaskSummary[];         // Last 5 failed tasks (for learning)
    currentContext: string;        // Relevant context for current task
  };

  // Working memory (full detail)
  workingMemory: {
    currentFiles: FileContent[];   // Files currently being worked on
    recentActions: Action[];       // Last 20 actions
    pendingDecisions: Decision[];  // Decisions awaiting resolution
    notes: string;                 // Agent's notes to self
  };

  // External references (pointers to files)
  externalMemory: {
    fullHistory: string;           // Path to detailed log
    allCheckpoints: string[];      // Paths to checkpoints
    documentation: string;         // Path to project docs
  };
}
```

### 7.3 Context Compression

```typescript
async function compressContext(agent: Agent): Promise<void> {
  const currentContext = await loadContext(agent.id);

  // 1. Summarize completed tasks
  if (currentContext.taskHistory.completed.length > 10) {
    const oldTasks = currentContext.taskHistory.completed.slice(0, -10);
    const summary = await summarizeTasks(oldTasks);

    // Save full details to file
    await appendToFile(
      agent.externalMemory.fullHistory,
      JSON.stringify(oldTasks)
    );

    // Keep only summary
    currentContext.taskHistory.completed =
      currentContext.taskHistory.completed.slice(-10);
    currentContext.projectKnowledge.summary += `\n\nRecent work: ${summary}`;
  }

  // 2. Compress working memory
  if (currentContext.workingMemory.recentActions.length > 20) {
    const oldActions = currentContext.workingMemory.recentActions.slice(0, -20);

    // Save to file
    await appendToFile(
      agent.externalMemory.fullHistory,
      JSON.stringify(oldActions)
    );

    // Keep only recent
    currentContext.workingMemory.recentActions =
      currentContext.workingMemory.recentActions.slice(-20);
  }

  // 3. Prune working files
  const activeFiles = getActiveFiles(currentContext.workingMemory.currentFiles);
  currentContext.workingMemory.currentFiles = activeFiles;

  await saveContext(agent.id, currentContext);
}

async function summarizeTasks(tasks: TaskSummary[]): Promise<string> {
  const prompt = `
Summarize these completed tasks in 2-3 sentences, focusing on:
- What was built/changed
- Key decisions made
- Lessons learned

Tasks:
${tasks.map(t => `- ${t.title}: ${t.outcome}`).join('\n')}
`;

  return await callAI(prompt, { maxTokens: 200 });
}
```

### 7.4 Context Refresh on Resume

```typescript
async function refreshContextForResume(agent: Agent): Promise<string> {
  const checkpoint = await loadLatestCheckpoint(agent.id);
  const projectState = await loadProjectState(agent.projectId);
  const recentActivity = await loadRecentActivity(agent.projectId);

  const refreshPrompt = `
You are resuming work after a pause. Here's what you need to know:

## Your Identity
- Agent Type: ${agent.agentType}
- Agent ID: ${agent.id}
- Project: ${projectState.name}

## Where You Left Off
${checkpoint.description}

Last task: ${checkpoint.currentTask.title}
Progress: ${checkpoint.progress}%
Status: ${checkpoint.status}

## What Happened While You Were Away
${recentActivity.map(a => `- ${a.timestamp}: ${a.description}`).join('\n')}

## Current Project State
- Phase: ${projectState.phase}
- Tasks completed: ${projectState.tasksCompleted}/${projectState.tasksTotal}
- Active agents: ${projectState.activeAgents.length}

## Your Immediate Next Steps
${checkpoint.nextSteps.join('\n')}

Review this context and confirm you're ready to continue, or ask questions if anything is unclear.
`;

  return refreshPrompt;
}
```

---

## 8. Recovery & Persistence

### 8.1 Checkpoint System

```typescript
interface Checkpoint {
  id: string;
  agentId: string;
  projectId: string;
  timestamp: Date;

  // Agent state
  agentState: {
    status: AgentStatus;
    currentTask: Task;
    progress: number;
    workingMemory: object;
    pendingDecisions: Decision[];
  };

  // File state
  fileState: {
    modifiedFiles: FileSnapshot[];  // Files changed since last checkpoint
    stagedChanges: string[];        // Git staged files
    uncommittedChanges: string[];   // All uncommitted files
  };

  // Conversation state
  conversationState: {
    messageCount: number;
    lastMessages: Message[];        // Last 10 messages
    summaryToDate: string;          // Compressed conversation history
  };

  // Recovery info
  recovery: {
    canResume: boolean;
    resumeInstructions: string;
    requiredContext: string[];      // Files needed to resume
    nextSteps: string[];
  };
}
```

### 8.2 Automatic Checkpointing

```typescript
// Checkpoints are created:
// 1. Every 15 minutes during active work
// 2. After each task completion
// 3. Before any risky operation
// 4. On graceful shutdown
// 5. When budget warnings occur

async function createCheckpoint(
  agent: Agent,
  reason: CheckpointReason
): Promise<Checkpoint> {
  const checkpoint: Checkpoint = {
    id: generateUUID(),
    agentId: agent.id,
    projectId: agent.projectId,
    timestamp: new Date(),

    agentState: {
      status: agent.status,
      currentTask: agent.currentTask,
      progress: agent.progress,
      workingMemory: await loadWorkingMemory(agent.id),
      pendingDecisions: agent.pendingDecisions,
    },

    fileState: await captureFileState(agent),

    conversationState: await captureConversationState(agent),

    recovery: {
      canResume: true,
      resumeInstructions: generateResumeInstructions(agent),
      requiredContext: identifyRequiredContext(agent),
      nextSteps: agent.plannedNextSteps,
    },
  };

  // Save checkpoint
  const checkpointPath = path.join(
    PROJECTS_DIR,
    agent.projectId,
    '.eklavya',
    'checkpoints',
    `${checkpoint.timestamp.toISOString()}-${reason}.json`
  );

  await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));

  // Update agent record
  await db.agents.update(agent.id, { lastCheckpoint: checkpoint.id });

  // Emit event for monitoring
  await messageQueue.publish('eklavya:system', {
    type: 'CHECKPOINT_CREATED',
    payload: { agentId: agent.id, checkpointId: checkpoint.id, reason },
  });

  return checkpoint;
}
```

### 8.3 Recovery Procedures

```typescript
async function recoverAgent(agent: Agent): Promise<void> {
  logger.info(`Recovering agent ${agent.id}`);

  // 1. Load latest valid checkpoint
  const checkpoint = await loadLatestCheckpoint(agent.id);
  if (!checkpoint) {
    throw new RecoveryError('No checkpoint available', agent.id);
  }

  // 2. Verify file state
  const currentFiles = await getFileState(agent);
  const conflicts = findConflicts(checkpoint.fileState, currentFiles);

  if (conflicts.length > 0) {
    // Resolve conflicts - prefer checkpoint state for uncommitted changes
    await resolveFileConflicts(conflicts, checkpoint);
  }

  // 3. Spawn new agent process
  const newProcess = await spawnAgent({
    projectId: agent.projectId,
    agentType: agent.agentType,
    tokenBudget: agent.tokenBudget,
    timeBudget: agent.timeBudget,
    recoveryMode: true,
  });

  // 4. Send recovery context
  const recoveryContext = await buildRecoveryContext(checkpoint);
  await messageQueue.publish(`eklavya:${agent.projectId}:${newProcess.id}`, {
    type: 'RECOVERY_INIT',
    payload: {
      checkpoint,
      recoveryContext,
      immediateTask: checkpoint.recovery.nextSteps[0],
    },
  });

  // 5. Update database
  await db.agents.update(agent.id, { status: 'terminated', terminatedReason: 'recovered' });
  await db.agents.update(newProcess.id, { recoveredFrom: agent.id });

  // 6. Record for learning
  await recordRecoveryEvent(agent, newProcess, checkpoint);
}

async function buildRecoveryContext(checkpoint: Checkpoint): Promise<string> {
  return `
## RECOVERY MODE - IMPORTANT

You are resuming from a checkpoint after an interruption.

### What You Were Doing
Task: ${checkpoint.agentState.currentTask.title}
Progress: ${checkpoint.agentState.progress}%

### Last Known State
${checkpoint.recovery.resumeInstructions}

### Files You Were Working On
${checkpoint.fileState.modifiedFiles.map(f => `- ${f.path}`).join('\n')}

### Uncommitted Changes
${checkpoint.fileState.uncommittedChanges.join('\n')}

### Your Next Steps
${checkpoint.recovery.nextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

### CRITICAL
1. DO NOT start over - continue from where you left off
2. Verify file state matches your expectations
3. If anything seems wrong, checkpoint immediately and report
`;
}
```

---

## 9. Security Model

### 9.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Agent escapes sandbox | Process isolation, filesystem jails, network restrictions |
| Agent accesses secrets | Env vars not passed, .env files excluded, secret scanning |
| Agent runs malicious code | Command allowlisting, execution timeouts, resource limits |
| Agent exfiltrates data | Network allowlist, egress monitoring, size limits |
| Prompt injection | Structured prompts, output validation, anomaly detection |
| Resource exhaustion | Hard limits on tokens, time, memory, disk, processes |

### 9.2 Isolation Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     ISOLATION LAYERS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: Process Isolation                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Each agent runs in separate OS process                     │ │
│  │ - Separate memory space                                    │ │
│  │ - Independent crash domain                                 │ │
│  │ - Resource limits via cgroups                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Layer 2: Filesystem Jail                                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Agents can only access:                                    │ │
│  │ - Their project directory                                  │ │
│  │ - Explicitly allowed system paths (read-only)             │ │
│  │ - Temp directories (sandboxed)                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Layer 3: Network Restrictions                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Allowlisted domains only:                                  │ │
│  │ - Package registries (npm, pypi)                          │ │
│  │ - GitHub (for cloning)                                    │ │
│  │ - AI APIs (anthropic, openai)                             │ │
│  │ - Documentation sites                                     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Layer 4: Command Filtering                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Commands parsed and validated before execution:            │ │
│  │ - Allowlist of permitted commands                         │ │
│  │ - Argument sanitization                                   │ │
│  │ - Pattern matching for dangerous sequences                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Layer 5: Output Validation                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ All agent outputs scanned for:                            │ │
│  │ - Secrets/credentials (regex + ML)                        │ │
│  │ - Malicious code patterns                                 │ │
│  │ - Anomalous behavior                                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.3 Secret Management

```typescript
// Secrets are NEVER passed to agents directly
// Instead, agents request operations that require secrets

interface SecretOperation {
  type: 'api_call' | 'db_connection' | 'external_service';
  service: string;
  operation: string;
  parameters: Record<string, unknown>;  // No secrets here
}

// Agent requests an API call
const request: SecretOperation = {
  type: 'api_call',
  service: 'stripe',
  operation: 'create_customer',
  parameters: { email: 'user@example.com', name: 'John Doe' },
};

// Eklavya runtime injects secrets and makes the call
async function executeSecretOperation(
  op: SecretOperation,
  projectId: string
): Promise<unknown> {
  const secrets = await loadProjectSecrets(projectId);
  const serviceSecret = secrets[op.service];

  if (!serviceSecret) {
    throw new Error(`No secret configured for service: ${op.service}`);
  }

  // Execute with injected secret
  switch (op.type) {
    case 'api_call':
      return await makeApiCall(op.service, op.operation, op.parameters, serviceSecret);
    // ... other types
  }
}
```

---

## 10. Cost Management

### 10.1 Budget Structure

```typescript
interface ProjectBudget {
  // Token budgets
  tokens: {
    total: number;           // Total tokens for project
    used: number;
    perAgent: number;        // Default per-agent limit
    perTask: number;         // Default per-task limit
    warningThreshold: 0.8;   // Warn at 80% usage
  };

  // Time budgets
  time: {
    totalMs: number;         // Total wall-clock time
    usedMs: number;
    perTaskMs: number;       // Default per-task limit
    maxIdleMs: number;       // Max idle time before termination
  };

  // Cost budgets
  cost: {
    maxUSD: number;          // Hard limit in USD
    usedUSD: number;
    warningUSD: number;      // Warning threshold
  };

  // Compute budgets
  compute: {
    maxConcurrentAgents: number;
    maxProcesses: number;
    maxMemoryMB: number;
    maxDiskMB: number;
  };
}
```

### 10.2 Cost Tracking

```typescript
interface CostTracker {
  // Track token usage per API call
  async trackTokens(
    agentId: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<void>;

  // Calculate cost
  calculateCost(model: string, inputTokens: number, outputTokens: number): number;

  // Check if within budget
  async checkBudget(projectId: string): Promise<BudgetStatus>;

  // Get current usage
  async getUsage(projectId: string): Promise<UsageReport>;
}

const MODEL_COSTS = {
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
  'claude-haiku-3-5-20241022': { input: 0.0008, output: 0.004 },
};

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = MODEL_COSTS[model];
  return (inputTokens * costs.input + outputTokens * costs.output) / 1000;
}
```

### 10.3 Budget Enforcement

```typescript
async function enforceBudget(agent: Agent): Promise<BudgetAction> {
  const budget = await getBudget(agent.projectId);

  // Check token budget
  if (budget.tokens.used >= budget.tokens.total) {
    return { action: 'terminate', reason: 'Token budget exhausted' };
  }

  if (budget.tokens.used >= budget.tokens.total * budget.tokens.warningThreshold) {
    await sendBudgetWarning(agent, 'tokens', budget);
  }

  // Check cost budget
  if (budget.cost.usedUSD >= budget.cost.maxUSD) {
    return { action: 'terminate', reason: 'Cost budget exhausted' };
  }

  // Check time budget
  if (budget.time.usedMs >= budget.time.totalMs) {
    return { action: 'terminate', reason: 'Time budget exhausted' };
  }

  // Check per-task limits
  if (agent.currentTask) {
    const taskUsage = await getTaskUsage(agent.currentTask.id);
    if (taskUsage.tokens > budget.tokens.perTask) {
      return { action: 'checkpoint_and_reassess', reason: 'Task token limit reached' };
    }
  }

  return { action: 'continue' };
}
```

---

## 11. Observability

### 11.1 Logging Structure

```typescript
// All logs follow this structure
interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  source: {
    type: 'agent' | 'system' | 'api' | 'learning';
    id: string;
    projectId?: string;
  };
  event: string;
  data: Record<string, unknown>;
  traceId: string;           // For distributed tracing
  spanId: string;
}

// Log destinations
// 1. Project-specific: projects/{id}/.eklavya/logs/
// 2. System-wide: data/logs/
// 3. Real-time: WebSocket to dashboard
// 4. Metrics: Prometheus/StatsD
```

### 11.2 Metrics

```typescript
// Key metrics to track
const METRICS = {
  // Agent metrics
  'eklavya.agent.spawn': 'counter',
  'eklavya.agent.terminate': 'counter',
  'eklavya.agent.task_complete': 'counter',
  'eklavya.agent.task_failed': 'counter',
  'eklavya.agent.checkpoint': 'counter',
  'eklavya.agent.recovery': 'counter',

  // Performance metrics
  'eklavya.task.duration_ms': 'histogram',
  'eklavya.task.tokens_used': 'histogram',
  'eklavya.agent.idle_time_ms': 'histogram',

  // Cost metrics
  'eklavya.cost.tokens_input': 'counter',
  'eklavya.cost.tokens_output': 'counter',
  'eklavya.cost.usd': 'counter',

  // Learning metrics
  'eklavya.learning.reward': 'histogram',
  'eklavya.learning.prompt_selection': 'counter',
  'eklavya.learning.prompt_mutation': 'counter',

  // System metrics
  'eklavya.system.active_projects': 'gauge',
  'eklavya.system.active_agents': 'gauge',
  'eklavya.system.message_queue_depth': 'gauge',
};
```

### 11.3 Tracing

```typescript
// Distributed tracing for following task execution
interface Trace {
  traceId: string;
  projectId: string;
  rootTask: string;

  spans: Span[];
}

interface Span {
  spanId: string;
  parentSpanId?: string;
  agentId: string;
  operation: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'success' | 'error';
  tags: Record<string, string>;
  logs: SpanLog[];
}

// Example trace for implementing a feature
// TraceId: abc123
// └─ Span: Orchestrator.assignTask (orch-001)
//    ├─ Span: Developer.implementFeature (dev-003)
//    │  ├─ Span: Developer.writeCode (dev-003)
//    │  ├─ Span: Developer.writeTests (dev-003)
//    │  └─ Span: Developer.runTests (dev-003)
//    └─ Span: Tester.validateTests (test-002)
//       └─ Span: Tester.runIntegration (test-002)
```

---

## 12. Complete Agent Prompts

See [AGENT_PROMPTS.md](./AGENT_PROMPTS.md) for full system prompts for all 10 agent types.

---

## 13. API Specifications

### 13.1 REST API Overview

Base URL: `http://localhost:3000/api`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /projects | Create new project |
| GET | /projects | List all projects |
| GET | /projects/:id | Get project details |
| PATCH | /projects/:id | Update project |
| DELETE | /projects/:id | Delete project |
| POST | /projects/:id/approve | Approve project plan |
| POST | /projects/:id/pause | Pause project execution |
| POST | /projects/:id/resume | Resume project execution |
| GET | /projects/:id/agents | List agents in project |
| GET | /projects/:id/tasks | List tasks in project |
| GET | /projects/:id/logs | Get project logs |
| GET | /agents/:id | Get agent details |
| GET | /agents/:id/actions | Get agent action history |
| POST | /agents/:id/terminate | Terminate agent |
| GET | /prompts | List prompt versions |
| GET | /prompts/:agentType | Get prompts for agent type |
| POST | /prompts/:id/promote | Promote prompt version |
| GET | /metrics/overview | Dashboard overview |
| GET | /metrics/learning | Learning curve data |
| WS | /ws/project/:id | Real-time project updates |

### 13.2 API Request/Response Schemas

#### Create Project
```typescript
// POST /api/projects
// Request
interface CreateProjectRequest {
  name: string;
  description: string;
  autonomyLevel?: 'conservative' | 'standard' | 'aggressive';
  model?: string;
  budgets?: {
    totalTokens?: number;
    totalTime?: number;
    maxCostUSD?: number;
  };
  projectType?: {
    framework?: string;
    language?: string;
    features?: string[];
  };
}

// Response
interface CreateProjectResponse {
  id: string;
  name: string;
  description: string;
  status: 'initializing';
  createdAt: string;
  config: ProjectConfig;
}
```

#### Get Project
```typescript
// GET /api/projects/:id
interface ProjectResponse {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  phase: ProjectPhase;
  progress: {
    tasksTotal: number;
    tasksCompleted: number;
    percentage: number;
  };
  agents: AgentSummary[];
  budgets: {
    tokens: { total: number; used: number };
    time: { total: number; used: number };
    cost: { max: number; used: number };
  };
  timestamps: {
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  };
}
```

#### Approve Project
```typescript
// POST /api/projects/:id/approve
// Request
interface ApproveProjectRequest {
  modifications?: string[];  // Optional plan modifications
}

// Response
interface ApproveProjectResponse {
  success: boolean;
  status: 'executing';
  message: string;
  orchestratorId: string;
}
```

#### Get Agent
```typescript
// GET /api/agents/:id
interface AgentResponse {
  id: string;
  projectId: string;
  agentType: AgentType;
  status: AgentStatus;
  currentTask?: TaskSummary;
  metrics: {
    tokensUsed: number;
    tasksCompleted: number;
    tasksFailed: number;
    totalReward: number;
  };
  timestamps: {
    createdAt: string;
    lastHeartbeat: string;
  };
}
```

### 13.3 WebSocket Protocol

```typescript
// Connection: ws://localhost:3000/ws/project/:projectId

// Client -> Server Messages
type ClientMessage =
  | { type: 'subscribe'; channels: string[] }
  | { type: 'unsubscribe'; channels: string[] }
  | { type: 'ping' };

// Server -> Client Messages
type ServerMessage =
  | { type: 'pong' }
  | { type: 'agent_update'; payload: AgentUpdate }
  | { type: 'task_update'; payload: TaskUpdate }
  | { type: 'log'; payload: LogEntry }
  | { type: 'alert'; payload: Alert }
  | { type: 'project_status'; payload: ProjectStatus }
  | { type: 'metrics'; payload: MetricsUpdate };

// Example flow:
// 1. Client connects to ws://localhost:3000/ws/project/proj-123
// 2. Client sends: { type: 'subscribe', channels: ['agents', 'tasks', 'logs'] }
// 3. Server streams updates as they happen
```

### 13.4 Internal Agent API

Agents communicate with Eklavya via a local HTTP API:

```typescript
// Base URL: http://localhost:3001/internal (only accessible from agent processes)

// Heartbeat
POST /internal/heartbeat
{
  agentId: string;
  status: 'working' | 'idle' | 'blocked';
  progress?: number;
  currentTask?: string;
}

// Send Message
POST /internal/message
{
  from: string;
  to: string;
  type: MessageType;
  payload: object;
  priority?: string;
}

// Get Messages
GET /internal/messages/:agentId
Response: AgentMessage[]

// Checkpoint
POST /internal/checkpoint
{
  agentId: string;
  state: object;
  description: string;
}

// Get Budget
GET /internal/budget/:agentId
Response: { tokensRemaining: number; timeRemaining: number; }

// Record Outcome (for learning)
POST /internal/outcome
{
  agentId: string;
  taskId: string;
  success: boolean;
  reward: number;
  metrics: object;
}

// Spawn Agent (Orchestrator only)
POST /internal/agents/spawn
{
  projectId: string;
  agentType: AgentType;
  task: object;
  config?: object;
}

// Terminate Agent (Orchestrator only)
POST /internal/agents/:agentId/terminate
{
  reason: string;
}
```

---

## 14. Database Schema

### 14.1 Complete Schema

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enum types
CREATE TYPE project_status AS ENUM (
  'initializing', 'planning', 'awaiting_approval', 'executing',
  'paused', 'blocked', 'completed', 'failed', 'cancelled'
);

CREATE TYPE project_phase AS ENUM (
  'research', 'architecture', 'foundation', 'implementation',
  'testing', 'qa', 'deployment', 'monitoring'
);

CREATE TYPE agent_type AS ENUM (
  'orchestrator', 'architect', 'developer', 'tester', 'qa',
  'pm', 'uat', 'sre', 'monitor', 'mentor'
);

CREATE TYPE agent_status AS ENUM (
  'initializing', 'ready', 'working', 'paused', 'blocked',
  'completed', 'failed', 'terminated'
);

CREATE TYPE prompt_status AS ENUM (
  'experimental', 'candidate', 'production', 'deprecated'
);

CREATE TYPE message_priority AS ENUM (
  'low', 'normal', 'high', 'critical'
);

-- Projects table
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status project_status NOT NULL DEFAULT 'initializing',
  phase project_phase,

  -- Configuration (stored as JSONB for flexibility)
  config JSONB NOT NULL DEFAULT '{}',

  -- Budgets
  token_budget INTEGER NOT NULL DEFAULT 1000000,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  time_budget_ms BIGINT NOT NULL DEFAULT 86400000, -- 24 hours
  time_used_ms BIGINT NOT NULL DEFAULT 0,
  cost_budget_usd DECIMAL(10,2) NOT NULL DEFAULT 100.00,
  cost_used_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,

  -- Progress tracking
  tasks_total INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Indexes
  CONSTRAINT valid_progress CHECK (tasks_completed <= tasks_total)
);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_created ON projects(created_at DESC);

-- Agents table
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_type agent_type NOT NULL,
  instance_number INTEGER NOT NULL DEFAULT 1,
  status agent_status NOT NULL DEFAULT 'initializing',

  -- Process info
  pid INTEGER,
  working_directory TEXT,

  -- Current state
  current_task_id UUID,
  progress INTEGER DEFAULT 0,

  -- Prompt version being used
  prompt_version_id UUID,

  -- Budgets
  token_budget INTEGER NOT NULL DEFAULT 100000,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  time_budget_ms BIGINT NOT NULL DEFAULT 3600000, -- 1 hour
  time_used_ms BIGINT NOT NULL DEFAULT 0,

  -- Recovery
  last_checkpoint_id UUID,
  recovered_from UUID REFERENCES agents(id),

  -- Metrics
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_failed INTEGER NOT NULL DEFAULT 0,
  total_reward DECIMAL(10,2) NOT NULL DEFAULT 0.00,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_heartbeat TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  terminated_at TIMESTAMP WITH TIME ZONE,
  terminated_reason TEXT,

  UNIQUE(project_id, agent_type, instance_number)
);

CREATE INDEX idx_agents_project ON agents(project_id);
CREATE INDEX idx_agents_status ON agents(status) WHERE status NOT IN ('terminated', 'completed');
CREATE INDEX idx_agents_heartbeat ON agents(last_heartbeat) WHERE status NOT IN ('terminated', 'completed');

-- Tasks table
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id UUID REFERENCES tasks(id),

  -- Task definition
  task_type VARCHAR(100) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  requirements JSONB DEFAULT '[]',
  acceptance_criteria JSONB DEFAULT '[]',
  estimated_complexity VARCHAR(20),

  -- Assignment
  assigned_to UUID REFERENCES agents(id),
  assigned_at TIMESTAMP WITH TIME ZONE,

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  blocked_reason TEXT,

  -- Results
  success BOOLEAN,
  result JSONB,
  files_created JSONB DEFAULT '[]',
  files_modified JSONB DEFAULT '[]',

  -- Metrics
  tokens_used INTEGER DEFAULT 0,
  duration_ms BIGINT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to) WHERE assigned_to IS NOT NULL;

-- Task dependencies
CREATE TABLE task_dependencies (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on),
  CHECK (task_id != depends_on)
);

-- Prompt versions table
CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_type agent_type NOT NULL,
  version VARCHAR(20) NOT NULL,
  prompt TEXT NOT NULL,
  status prompt_status NOT NULL DEFAULT 'experimental',

  -- Lineage
  parent_id UUID REFERENCES prompt_versions(id),
  mutations JSONB DEFAULT '[]',

  -- Statistics
  total_uses INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  total_reward DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  reward_mean DECIMAL(10,4) NOT NULL DEFAULT 0.00,
  reward_variance DECIMAL(10,4) NOT NULL DEFAULT 0.00,

  -- Thompson Sampling parameters
  alpha DECIMAL(10,4) NOT NULL DEFAULT 1.0,
  beta DECIMAL(10,4) NOT NULL DEFAULT 1.0,

  -- Context-specific performance (hash -> stats)
  context_performance JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  promoted_at TIMESTAMP WITH TIME ZONE,
  deprecated_at TIMESTAMP WITH TIME ZONE,

  UNIQUE(agent_type, version)
);

CREATE INDEX idx_prompts_agent_status ON prompt_versions(agent_type, status);

-- Reward events table
CREATE TABLE reward_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id),
  prompt_version_id UUID REFERENCES prompt_versions(id),

  -- Reward details
  reward_value DECIMAL(10,2) NOT NULL,
  reward_type VARCHAR(100) NOT NULL,
  reason TEXT,

  -- Context for learning
  context JSONB NOT NULL DEFAULT '{}',

  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rewards_agent ON reward_events(agent_id);
CREATE INDEX idx_rewards_prompt ON reward_events(prompt_version_id);
CREATE INDEX idx_rewards_created ON reward_events(created_at DESC);

-- Agent messages table (persistent message log)
CREATE TABLE agent_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Routing
  from_agent_id UUID REFERENCES agents(id),
  to_agent_id UUID REFERENCES agents(id),
  message_type VARCHAR(100) NOT NULL,

  -- Content
  payload JSONB NOT NULL,
  priority message_priority NOT NULL DEFAULT 'normal',
  correlation_id UUID,

  -- Delivery
  requires_ack BOOLEAN NOT NULL DEFAULT false,
  acked_at TIMESTAMP WITH TIME ZONE,

  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_project ON agent_messages(project_id);
CREATE INDEX idx_messages_to ON agent_messages(to_agent_id, created_at DESC) WHERE acked_at IS NULL;
CREATE INDEX idx_messages_correlation ON agent_messages(correlation_id);

-- Checkpoints table
CREATE TABLE checkpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Checkpoint data
  reason VARCHAR(100) NOT NULL,
  agent_state JSONB NOT NULL,
  file_state JSONB NOT NULL,
  conversation_state JSONB NOT NULL,
  recovery_info JSONB NOT NULL,

  -- Storage
  checkpoint_path TEXT NOT NULL,

  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_checkpoints_agent ON checkpoints(agent_id, created_at DESC);

-- Agent actions table (detailed action log for learning)
CREATE TABLE agent_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id),

  -- Action details
  action_type VARCHAR(100) NOT NULL,
  action_input JSONB,
  action_output JSONB,
  success BOOLEAN,
  error TEXT,

  -- Metrics
  duration_ms INTEGER,
  tokens_used INTEGER,

  -- Tracing
  trace_id UUID,
  span_id UUID,
  parent_span_id UUID,

  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_actions_agent ON agent_actions(agent_id, created_at DESC);
CREATE INDEX idx_actions_trace ON agent_actions(trace_id);

-- Cost tracking table
CREATE TABLE cost_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id),

  -- Cost details
  model VARCHAR(100) NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd DECIMAL(10,6) NOT NULL,

  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_costs_project ON cost_events(project_id, created_at DESC);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to update project token/cost usage
CREATE OR REPLACE FUNCTION update_project_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE projects
  SET
    tokens_used = tokens_used + NEW.input_tokens + NEW.output_tokens,
    cost_used_usd = cost_used_usd + NEW.cost_usd
  WHERE id = NEW.project_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cost_events_update_project
  AFTER INSERT ON cost_events
  FOR EACH ROW EXECUTE FUNCTION update_project_usage();
```

### 14.2 Initial Data (Seeds)

```sql
-- Initial prompt versions for each agent type
INSERT INTO prompt_versions (agent_type, version, prompt, status)
VALUES
  ('orchestrator', '1.0.0', '[See AGENT_PROMPTS.md]', 'production'),
  ('architect', '1.0.0', '[See AGENT_PROMPTS.md]', 'production'),
  ('developer', '1.0.0', '[See AGENT_PROMPTS.md]', 'production'),
  ('tester', '1.0.0', '[See AGENT_PROMPTS.md]', 'production'),
  ('qa', '1.0.0', '[See AGENT_PROMPTS.md]', 'production'),
  ('pm', '1.0.0', '[See AGENT_PROMPTS.md]', 'production'),
  ('uat', '1.0.0', '[See AGENT_PROMPTS.md]', 'production'),
  ('sre', '1.0.0', '[See AGENT_PROMPTS.md]', 'production'),
  ('monitor', '1.0.0', '[See AGENT_PROMPTS.md]', 'production'),
  ('mentor', '1.0.0', '[See AGENT_PROMPTS.md]', 'production');
```

---

## 15. Configuration

### 15.1 Environment Variables

```bash
# .env.example

# ======================
# REQUIRED CONFIGURATION
# ======================

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/eklavya

# Redis
REDIS_URL=redis://localhost:6379

# AI Provider
ANTHROPIC_API_KEY=sk-ant-...

# ======================
# OPTIONAL CONFIGURATION
# ======================

# Server
PORT=3000
INTERNAL_PORT=3001
NODE_ENV=development

# AI Models
DEFAULT_MODEL=claude-sonnet-4-20250514
ARCHITECT_MODEL=claude-sonnet-4-20250514
DEVELOPER_MODEL=claude-sonnet-4-20250514

# Budgets (defaults)
DEFAULT_PROJECT_TOKEN_BUDGET=1000000
DEFAULT_PROJECT_TIME_BUDGET=86400000
DEFAULT_PROJECT_COST_BUDGET=100.00
DEFAULT_AGENT_TOKEN_BUDGET=100000
DEFAULT_AGENT_TIME_BUDGET=3600000

# Agent Configuration
MAX_CONCURRENT_AGENTS=10
AGENT_HEARTBEAT_INTERVAL=30000
AGENT_HEARTBEAT_TIMEOUT=90000
CHECKPOINT_INTERVAL=900000

# Learning
LEARNING_ENABLED=true
EXPERIMENTAL_TRAFFIC=0.10
CANDIDATE_TRAFFIC=0.30

# Logging
LOG_LEVEL=info

# Security
ALLOWED_DOMAINS=registry.npmjs.org,github.com,api.anthropic.com

# Paths
PROJECTS_DIR=./projects
DATA_DIR=./data
PROMPTS_DIR=./prompts
```

### 15.2 Configuration Schema

```typescript
// src/config/schema.ts

export interface EklavyaConfig {
  // Server
  server: {
    port: number;
    internalPort: number;
    env: 'development' | 'staging' | 'production';
  };

  // Database
  database: {
    url: string;
    poolSize: number;
  };

  // Redis
  redis: {
    url: string;
  };

  // AI
  ai: {
    provider: 'anthropic' | 'openai';
    apiKey: string;
    defaultModel: string;
    modelOverrides: Partial<Record<AgentType, string>>;
  };

  // Budgets
  budgets: {
    project: {
      tokens: number;
      timeMs: number;
      costUsd: number;
    };
    agent: {
      tokens: number;
      timeMs: number;
    };
  };

  // Agents
  agents: {
    maxConcurrent: number;
    heartbeatInterval: number;
    heartbeatTimeout: number;
    checkpointInterval: number;
  };

  // Learning
  learning: {
    enabled: boolean;
    experimentalTraffic: number;
    candidateTraffic: number;
  };

  // Security
  security: {
    allowedDomains: string[];
    sandboxEnabled: boolean;
  };

  // Paths
  paths: {
    projects: string;
    data: string;
    prompts: string;
  };
}
```

---

## 16. Bootstrap Process

### 16.1 Self-Building Instructions

This is the prompt to give Eklavya to build itself:

```markdown
# EKLAVYA BOOTSTRAP PROMPT

You are Eklavya, the autonomous agent orchestration platform.

## YOUR MISSION

Build yourself according to the specifications in:
- `EKLAVYA_COMPLETE_SPEC.md` - Complete technical specification
- `AGENT_PROMPTS.md` - All agent system prompts

## APPROVAL STATUS

You have been approved to proceed autonomously. No further human approval needed.

## EXECUTION PHASES

### Phase 1: Foundation (Priority: CRITICAL)

1. **Project Setup**
   - Initialize Node.js project with TypeScript
   - Configure ESLint, Prettier
   - Set up directory structure as specified
   - Create package.json with dependencies

2. **Database Setup**
   - Create PostgreSQL schema from spec
   - Set up Prisma (or raw SQL client)
   - Create seed scripts for initial prompts

3. **Core Infrastructure**
   - Redis connection and pub/sub setup
   - Configuration management
   - Logging system
   - Error handling

### Phase 2: Agent Runtime (Priority: HIGH)

1. **Agent Process Manager**
   - Spawn agents as Claude Code processes
   - Health monitoring (heartbeats)
   - Graceful shutdown/restart

2. **Message Bus**
   - Redis pub/sub implementation
   - Message persistence to PostgreSQL
   - Delivery guarantees

3. **Checkpoint System**
   - State serialization
   - File state capture
   - Recovery procedures

### Phase 3: Core Services (Priority: HIGH)

1. **Orchestrator Service**
   - Project parsing
   - Task management
   - Agent coordination

2. **Learning Service**
   - Thompson Sampling implementation
   - Reward processing
   - Prompt selection

3. **Internal API**
   - Agent communication endpoints
   - Heartbeat handling
   - Budget tracking

### Phase 4: External API (Priority: MEDIUM)

1. **REST API**
   - All endpoints from spec
   - Request validation
   - Error responses

2. **WebSocket Server**
   - Real-time project updates
   - Connection management

### Phase 5: Web Dashboard (Priority: MEDIUM)

1. **Next.js App**
   - Project management UI
   - Agent monitoring
   - Learning curves visualization

### Phase 6: Integration & Testing (Priority: HIGH)

1. **Integration Tests**
   - Full workflow tests
   - Agent coordination tests
   - Recovery tests

2. **End-to-End Test**
   - Create a simple project
   - Watch it execute
   - Verify completion

## FILE STRUCTURE TO CREATE

```
eklavya/
├── package.json
├── tsconfig.json
├── .env.example
├── docker-compose.yml
├── prisma/
│   └── schema.prisma
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── index.ts
│   │   └── schema.ts
│   ├── core/
│   │   ├── agent-manager/
│   │   │   ├── index.ts
│   │   │   ├── spawner.ts
│   │   │   ├── health.ts
│   │   │   └── recovery.ts
│   │   ├── message-bus/
│   │   │   ├── index.ts
│   │   │   ├── redis.ts
│   │   │   └── persistence.ts
│   │   ├── learning/
│   │   │   ├── index.ts
│   │   │   ├── thompson-sampling.ts
│   │   │   ├── rewards.ts
│   │   │   └── prompt-evolution.ts
│   │   └── checkpoint/
│   │       ├── index.ts
│   │       ├── capture.ts
│   │       └── restore.ts
│   ├── services/
│   │   ├── project.ts
│   │   ├── agent.ts
│   │   ├── task.ts
│   │   └── prompt.ts
│   ├── api/
│   │   ├── routes/
│   │   │   ├── projects.ts
│   │   │   ├── agents.ts
│   │   │   ├── prompts.ts
│   │   │   └── metrics.ts
│   │   ├── internal/
│   │   │   ├── heartbeat.ts
│   │   │   ├── messages.ts
│   │   │   └── checkpoint.ts
│   │   └── websocket.ts
│   ├── lib/
│   │   ├── db.ts
│   │   ├── redis.ts
│   │   └── logger.ts
│   └── types/
│       └── index.ts
├── web/                          # Next.js dashboard
│   ├── app/
│   │   ├── page.tsx
│   │   ├── projects/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   └── api/
│   └── components/
├── prompts/                      # Agent prompt templates
│   ├── orchestrator.md
│   ├── architect.md
│   └── ...
├── projects/                     # User projects directory
├── data/                        # Platform data
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

## DEPENDENCIES

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0",
    "@prisma/client": "^5.0.0",
    "express": "^4.18.0",
    "ioredis": "^5.3.0",
    "next": "^14.0.0",
    "pino": "^8.0.0",
    "socket.io": "^4.7.0",
    "uuid": "^9.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "prisma": "^5.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

## SUCCESS CRITERIA

The build is complete when:
1. All files from the structure exist
2. `npm run build` succeeds
3. `npm run test` passes
4. A demo project can be created and executed
5. The web dashboard shows real-time updates

## CONSTRAINTS

- Stay within token budget
- Checkpoint every 15 minutes
- Report progress every phase
- Do not skip testing

## BEGIN

Start with Phase 1. Report when each phase is complete.
Good luck building yourself!
```

### 16.2 Demo Project

After Eklavya is built, test it with this demo:

```markdown
# Demo Project: Simple Todo API

## Description
Build a simple REST API for managing todo items with the following features:
- CRUD operations for todos
- User authentication
- PostgreSQL database
- Proper error handling
- Unit and integration tests

## Requirements
1. POST /api/auth/register - Register new user
2. POST /api/auth/login - Login and get JWT
3. GET /api/todos - List user's todos
4. POST /api/todos - Create todo
5. PATCH /api/todos/:id - Update todo
6. DELETE /api/todos/:id - Delete todo

## Acceptance Criteria
- All endpoints return proper status codes
- Authentication required for todo endpoints
- Validation on all inputs
- 80%+ test coverage
- Deployable via Docker

## Tech Stack
- Node.js + TypeScript
- Express.js
- PostgreSQL + Prisma
- JWT authentication
- Jest for testing
```

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| Agent | A Claude Code instance with a specialized prompt |
| Checkpoint | Saved state that allows recovery/resume |
| Context | Information an agent needs to do its job |
| Heartbeat | Regular signal from agent indicating it's alive |
| Orchestrator | The agent that coordinates all other agents |
| Prompt Version | A versioned system prompt used by agents |
| Reward | Positive/negative signal for learning |
| Task | A discrete unit of work assigned to an agent |

## Appendix B: Error Codes

| Code | Meaning |
|------|---------|
| E001 | Project not found |
| E002 | Agent not found |
| E003 | Task not found |
| E004 | Budget exceeded |
| E005 | Agent unresponsive |
| E006 | Checkpoint failed |
| E007 | Recovery failed |
| E008 | Message delivery failed |
| E009 | Prompt selection failed |
| E010 | Security violation |

## Appendix C: Metrics Reference

| Metric | Type | Description |
|--------|------|-------------|
| `eklavya.project.created` | counter | Projects created |
| `eklavya.project.completed` | counter | Projects completed successfully |
| `eklavya.agent.spawned` | counter | Agents spawned |
| `eklavya.agent.terminated` | counter | Agents terminated |
| `eklavya.task.completed` | counter | Tasks completed |
| `eklavya.task.failed` | counter | Tasks failed |
| `eklavya.tokens.used` | counter | Total tokens consumed |
| `eklavya.cost.usd` | counter | Total cost in USD |
| `eklavya.reward.total` | histogram | Reward distribution |
| `eklavya.latency.api` | histogram | API response latency |

---

**End of Specification**

*This document contains everything needed to build Eklavya autonomously.*
*Version: 1.0.0*
*Last Updated: {{DATE}}*
