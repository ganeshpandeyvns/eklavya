# Demo₄: Agent Lifecycle Management

## Overview

Demo₄ implements the core agent lifecycle management system - spawning actual Claude Code processes, managing their lifecycle, monitoring health, and coordinating termination. This is the foundation that enables Eklavya to be a true multi-agent orchestration platform.

**Duration**: 45-60 minutes
**Cost Estimate**: $20-35
**Foundation Created**: 25% of final platform (agent infrastructure)

## Success Criteria (Strict Thresholds)

| Criteria | Threshold | Measurement |
|----------|-----------|-------------|
| Agent spawn success | 100% | All spawn requests create valid agent processes |
| Agent termination | 100% | All agents cleanly terminate on request |
| Health monitoring | < 5s | Health check detects unhealthy agents within 5 seconds |
| Process isolation | 100% | Each agent runs in isolated process/context |
| Resource tracking | 100% | CPU, memory, token usage tracked per agent |
| Graceful shutdown | 100% | Agents checkpoint state before termination |
| Recovery from crash | 100% | Crashed agents can be restarted from checkpoint |
| API response time | < 200ms | All lifecycle APIs respond within threshold |

## Expert Agent Profiles

### Principal Infrastructure Architect
- **Expertise**: Distributed systems, process management, IPC
- **Mindset**: "Every process boundary is a security boundary"
- **Standards**: Zero tolerance for zombie processes, resource leaks

### Staff Platform Engineer
- **Expertise**: Node.js child processes, worker threads, system monitoring
- **Mindset**: "Observable by default, debuggable in production"
- **Standards**: Every agent action logged, every state change tracked

### Senior Reliability Engineer
- **Expertise**: Health checks, failure detection, automatic recovery
- **Mindset**: "Assume everything will fail, design for recovery"
- **Standards**: Sub-second failure detection, automatic remediation

## Architecture

### Agent Process Model

```
┌─────────────────────────────────────────────────────────────┐
│                     Eklavya Core                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Agent Manager                           │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │ Spawner │ │ Monitor │ │ Router  │ │ Cleaner │   │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │   │
│  └───────┼──────────┼──────────┼──────────┼──────────┘   │
│          │          │          │          │               │
│  ┌───────▼──────────▼──────────▼──────────▼───────────┐   │
│  │              Process Pool                           │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │ Agent 1 │ │ Agent 2 │ │ Agent 3 │ │ Agent N │   │   │
│  │  │ (dev)   │ │ (test)  │ │ (arch)  │ │ (...)   │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Agent States

```
PENDING → STARTING → RUNNING → STOPPING → STOPPED
    │         │          │          │
    │         │          │          └──→ TERMINATED
    │         │          │
    │         │          └──→ CRASHED ──→ RECOVERING ──→ RUNNING
    │         │
    │         └──→ FAILED (spawn failure)
    │
    └──→ CANCELLED
```

## Database Schema

```sql
-- Agent process tracking
CREATE TABLE agent_processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    pid INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE,
    stopped_at TIMESTAMP WITH TIME ZONE,
    exit_code INTEGER,
    error_message TEXT,
    working_directory TEXT,
    environment JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent resource usage
CREATE TABLE agent_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    cpu_percent DECIMAL(5,2),
    memory_mb DECIMAL(10,2),
    tokens_used INTEGER DEFAULT 0,
    api_calls INTEGER DEFAULT 0,
    files_modified INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent health checks
CREATE TABLE agent_health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL, -- 'healthy', 'unhealthy', 'unknown'
    latency_ms INTEGER,
    last_activity TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_agent_processes_agent ON agent_processes(agent_id);
CREATE INDEX idx_agent_processes_status ON agent_processes(status);
CREATE INDEX idx_agent_resources_agent ON agent_resources(agent_id);
CREATE INDEX idx_agent_resources_timestamp ON agent_resources(timestamp);
CREATE INDEX idx_agent_health_agent ON agent_health_checks(agent_id);
```

## API Endpoints

### Agent Lifecycle

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/agents/:id/spawn` | Spawn agent process |
| POST | `/api/agents/:id/terminate` | Terminate agent gracefully |
| POST | `/api/agents/:id/kill` | Force kill agent process |
| POST | `/api/agents/:id/restart` | Restart agent (terminate + spawn) |
| GET | `/api/agents/:id/process` | Get agent process info |
| GET | `/api/agents/:id/health` | Get agent health status |
| GET | `/api/agents/:id/resources` | Get agent resource usage |

### Agent Manager

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agent-manager/status` | Get manager status and all agents |
| POST | `/api/agent-manager/spawn-all` | Spawn all idle agents for project |
| POST | `/api/agent-manager/terminate-all` | Terminate all agents for project |
| GET | `/api/agent-manager/resources` | Get aggregate resource usage |
| POST | `/api/agent-manager/gc` | Garbage collect dead processes |

## Core Components

### 1. AgentSpawner

```typescript
interface SpawnOptions {
  agentId: string;
  agentType: AgentType;
  projectId: string;
  workingDirectory: string;
  environment?: Record<string, string>;
  timeout?: number;
}

interface SpawnResult {
  success: boolean;
  pid?: number;
  error?: string;
}

class AgentSpawner {
  async spawn(options: SpawnOptions): Promise<SpawnResult>;
  async prepareEnvironment(agentId: string): Promise<string>; // Returns working dir
  async loadAgentPrompt(agentType: AgentType): Promise<string>;
}
```

### 2. AgentMonitor

```typescript
interface HealthStatus {
  agentId: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  latencyMs: number;
  lastActivity: Date;
  errorMessage?: string;
}

class AgentMonitor {
  async checkHealth(agentId: string): Promise<HealthStatus>;
  async startMonitoring(agentId: string, intervalMs: number): void;
  async stopMonitoring(agentId: string): void;
  async getResourceUsage(agentId: string): Promise<ResourceUsage>;
}
```

### 3. AgentTerminator

```typescript
interface TerminateOptions {
  agentId: string;
  graceful: boolean;
  timeoutMs?: number;
  saveCheckpoint?: boolean;
}

interface TerminateResult {
  success: boolean;
  checkpointSaved: boolean;
  exitCode?: number;
  error?: string;
}

class AgentTerminator {
  async terminate(options: TerminateOptions): Promise<TerminateResult>;
  async forceKill(agentId: string): Promise<boolean>;
  async cleanup(agentId: string): Promise<void>;
}
```

### 4. AgentManager (Orchestrator)

```typescript
class AgentManager extends EventEmitter {
  private spawner: AgentSpawner;
  private monitor: AgentMonitor;
  private terminator: AgentTerminator;
  private processes: Map<string, AgentProcess>;

  async spawnAgent(agentId: string): Promise<SpawnResult>;
  async terminateAgent(agentId: string, graceful?: boolean): Promise<TerminateResult>;
  async restartAgent(agentId: string): Promise<SpawnResult>;
  async getAgentStatus(agentId: string): Promise<AgentProcessStatus>;
  async getAllAgents(projectId?: string): Promise<AgentProcessStatus[]>;
  async spawnAllIdle(projectId: string): Promise<SpawnResult[]>;
  async terminateAll(projectId: string): Promise<TerminateResult[]>;
  async garbageCollect(): Promise<number>; // Returns cleaned count
}
```

## Test Scenarios

### Category 1: Agent Spawning (8 tests)
1. Spawn developer agent successfully
2. Spawn multiple agents concurrently
3. Spawn with custom working directory
4. Spawn with environment variables
5. Spawn fails gracefully on invalid agent
6. Spawn respects project agent limit
7. Spawn sets correct agent status
8. Spawn records process info in database

### Category 2: Agent Termination (6 tests)
1. Graceful termination with checkpoint
2. Force kill agent process
3. Terminate non-existent agent returns error
4. Terminate already stopped agent is idempotent
5. Termination cleans up resources
6. Termination updates database status

### Category 3: Health Monitoring (6 tests)
1. Health check returns healthy for running agent
2. Health check detects crashed agent
3. Health check measures latency
4. Health monitoring auto-starts on spawn
5. Unhealthy agent triggers event
6. Health history recorded in database

### Category 4: Resource Tracking (5 tests)
1. Track CPU usage per agent
2. Track memory usage per agent
3. Track token usage per agent
4. Aggregate resources for project
5. Resource limits enforced

### Category 5: Recovery (5 tests)
1. Restart crashed agent from checkpoint
2. Auto-recovery on crash detection
3. Recovery preserves agent state
4. Recovery increments restart count
5. Max restarts prevents infinite loops

### Category 6: Manager Operations (5 tests)
1. Get manager status shows all agents
2. Spawn all idle agents for project
3. Terminate all agents for project
4. Garbage collect removes dead processes
5. Manager events emitted correctly

## Implementation Phases

### Phase 1: Database & Types (10 min)
- Create migration for new tables
- Define TypeScript interfaces
- Set up event types

### Phase 2: Agent Spawner (15 min)
- Implement spawn logic
- Working directory preparation
- Environment setup
- Process tracking

### Phase 3: Agent Monitor (10 min)
- Health check implementation
- Resource tracking
- Monitoring intervals
- Database recording

### Phase 4: Agent Terminator (10 min)
- Graceful termination
- Force kill
- Checkpoint before terminate
- Cleanup logic

### Phase 5: Agent Manager (10 min)
- Integrate all components
- Event emission
- Bulk operations
- Garbage collection

### Phase 6: API Endpoints (10 min)
- Lifecycle endpoints
- Manager endpoints
- Route registration

### Phase 7: Testing & Verification (15 min)
- Automated test suite
- Manual verification
- Performance validation

## Notes

- For Demo₄, we simulate agent processes (don't actually spawn Claude Code)
- Process simulation uses mock objects with realistic behavior
- Real Claude Code integration comes in Demo₅ or later
- Focus is on the lifecycle management infrastructure
- All state changes must be persisted to database
- Events must be emitted for WebSocket real-time updates
