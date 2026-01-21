# Demo₈: Self-Build Test

## Overview

Demo₈ validates that Eklavya can autonomously build a project end-to-end. This is the capstone demo that proves the platform's core value proposition: given a project description, Eklavya can orchestrate multiple AI agents to plan, implement, test, and deliver software.

## Success Criteria

| Criteria | Description | Verification |
|----------|-------------|--------------|
| Project Creation | Create project from description | Project record in database |
| Plan Generation | Orchestrator creates execution plan | Plan with phases and dependencies |
| Agent Spawning | Spawn agents based on plan | Agent records with correct types |
| Task Execution | Agents execute assigned tasks | Tasks transition through states |
| Parallel Execution | Multiple agents work simultaneously | Concurrent agent activity |
| Dependency Resolution | Tasks respect dependencies | Correct execution order |
| Outcome Recording | RL outcomes recorded for learning | Outcomes in rl_outcomes table |
| Project Completion | All tasks complete successfully | Final project status |

## Quality Thresholds

| Metric | Threshold |
|--------|-----------|
| Code Quality | ≥ 85% |
| Test Coverage | ≥ 60% |
| Requirements Coverage | ≥ 90% |
| Critical Issues | 0 |

## Technical Design

### 1. Self-Build Flow

```
┌─────────────────┐
│ Project Request │
│  (Description)  │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Project Created │
│   (Database)    │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Orchestrator   │
│  Initializes    │
└────────┬────────┘
         │
         v
┌─────────────────┐     ┌─────────────────┐
│ Task Breakdown  │ --> │ Execution Plan  │
│   (Phases)      │     │  (Dependencies) │
└────────┬────────┘     └────────┬────────┘
         │                       │
         v                       v
┌─────────────────────────────────────────┐
│          Phase Execution Loop           │
│  ┌─────────────────────────────────┐   │
│  │ Phase 1: Architect (sequential)  │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ Phase 2: Developers (parallel)   │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ Phase 3: Tester (sequential)     │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ Phase 4: QA (sequential)         │   │
│  └─────────────────────────────────┘   │
└────────────────────┬────────────────────┘
                     │
                     v
┌─────────────────────────────────────────┐
│         Project Completion              │
│  - All tasks completed                  │
│  - RL outcomes recorded                 │
│  - Demo marked ready                    │
└─────────────────────────────────────────┘
```

### 2. Self-Build Manager

```typescript
interface SelfBuildConfig {
  projectName: string;
  projectDescription: string;
  features: string[];
  techStack: string[];
  maxExecutionTime?: number;  // minutes, default 60
  maxBudget?: number;         // USD, default 50
  maxConcurrentAgents?: number; // default 5
}

interface SelfBuildResult {
  success: boolean;
  projectId: string;
  executionPlan: ExecutionPlan;
  phases: PhaseResult[];
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalAgents: number;
  executionTimeMs: number;
  estimatedCost: number;
  errors: string[];
}

interface PhaseResult {
  phaseNumber: number;
  tasks: TaskResult[];
  agents: AgentResult[];
  startedAt: Date;
  completedAt: Date;
  success: boolean;
}

interface TaskResult {
  taskId: string;
  title: string;
  type: string;
  status: 'completed' | 'failed' | 'timeout';
  agentId?: string;
  executionTimeMs: number;
  error?: string;
}

interface AgentResult {
  agentId: string;
  type: string;
  promptId: string;
  status: 'completed' | 'failed' | 'timeout';
  exitCode?: number;
  tokensUsed?: number;
  executionTimeMs: number;
}
```

### 3. Execution Plan

```typescript
interface ExecutionPlan {
  id: string;
  projectId: string;
  phases: ExecutionPhase[];
  totalTasks: number;
  estimatedDurationMs: number;
  createdAt: Date;
}

interface ExecutionPhase {
  phaseNumber: number;
  tasks: TaskDefinition[];
  parallelizable: boolean;
  estimatedDurationMs: number;
}

interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  agentType: AgentType;
  priority: number;
  dependencies: string[];
  estimatedDurationMs: number;
  specification?: string;
}

type TaskType = 'architecture' | 'development' | 'testing' | 'qa' | 'documentation';
type AgentType = 'orchestrator' | 'architect' | 'developer' | 'tester' | 'qa' | 'pm' | 'uat' | 'sre' | 'monitor' | 'mentor';
```

### 4. Sample Project: Todo CLI

For Demo₈ validation, we use a simple "Todo CLI" project:

```typescript
const sampleProject: SelfBuildConfig = {
  projectName: 'todo-cli',
  projectDescription: 'A simple command-line todo list application',
  features: [
    'Add new todo items',
    'List all todos',
    'Mark todos as complete',
    'Delete todos',
    'Persist todos to file',
  ],
  techStack: ['TypeScript', 'Node.js', 'Commander.js'],
  maxExecutionTime: 30,
  maxBudget: 25,
  maxConcurrentAgents: 3,
};
```

### 5. Task Breakdown for Sample Project

| Task | Type | Agent | Dependencies | Duration |
|------|------|-------|--------------|----------|
| Design system architecture | architecture | architect | - | 5 min |
| Create project scaffolding | development | developer | Task 1 | 5 min |
| Implement add command | development | developer | Task 2 | 10 min |
| Implement list command | development | developer | Task 2 | 5 min |
| Implement complete command | development | developer | Task 2 | 5 min |
| Implement delete command | development | developer | Task 2 | 5 min |
| Add file persistence | development | developer | Tasks 3-6 | 10 min |
| Write unit tests | testing | tester | Task 7 | 10 min |
| Run E2E tests | qa | qa | Task 8 | 5 min |

### 6. Simulated Execution Mode

For testing without actual Claude CLI processes, we support a simulated mode:

```typescript
interface SimulatedAgentConfig {
  simulatedMode: true;
  simulatedDuration: number;      // ms per task
  simulatedSuccessRate: number;   // 0.0 - 1.0
  simulatedTokensPerTask: number;
}
```

In simulated mode:
- Agents are created in database but no processes spawned
- Tasks complete after simulated duration
- Success/failure based on configured rate
- RL outcomes still recorded for learning system validation

## Database Schema

### self_build_runs table

```sql
CREATE TABLE IF NOT EXISTS self_build_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Configuration
  config JSONB NOT NULL,

  -- Execution plan
  execution_plan JSONB,

  -- Status
  status VARCHAR(30) NOT NULL DEFAULT 'pending',

  -- Results
  result JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Metrics
  total_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  total_agents INTEGER DEFAULT 0,
  execution_time_ms INTEGER,
  estimated_cost_usd NUMERIC(10, 2)
);

CREATE INDEX idx_self_build_project ON self_build_runs(project_id);
CREATE INDEX idx_self_build_status ON self_build_runs(status);
```

### self_build_status enum

```sql
DO $$ BEGIN
  CREATE TYPE self_build_status AS ENUM (
    'pending',
    'planning',
    'executing',
    'completed',
    'failed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
```

## API Endpoints

### Self-Build Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/self-build` | Start a new self-build run |
| GET | `/api/self-build/:runId` | Get self-build status |
| GET | `/api/self-build/:runId/plan` | Get execution plan |
| GET | `/api/self-build/:runId/phases` | Get phase results |
| DELETE | `/api/self-build/:runId` | Cancel self-build |
| GET | `/api/projects/:projectId/self-builds` | List project's self-builds |

## Implementation Plan

### Phase 1: Core Self-Build Service (40% of effort)

1. Create database migration
2. Create `src/core/self-build/index.ts` - SelfBuildManager
3. Implement execution plan creation
4. Implement phase execution (simulated mode)
5. Implement result tracking

### Phase 2: Integration with Orchestrator (30% of effort)

1. Connect to existing Orchestrator
2. Integrate with AgentManager
3. Integrate with TaskQueue
4. Integrate with MessageBus

### Phase 3: Validation & Testing (30% of effort)

1. Create sample project specs
2. Create Demo₈ tester
3. End-to-end validation
4. RL outcome verification

## Test Plan

### Unit Tests (10 tests)

1. Self-build configuration validation
2. Execution plan creation
3. Task dependency resolution
4. Phase ordering
5. Agent type mapping
6. Result aggregation
7. Status transitions
8. Error handling
9. Timeout handling
10. Cost estimation

### Integration Tests (8 tests)

1. Full self-build flow (simulated)
2. Multi-phase execution
3. Parallel agent execution
4. Dependency resolution
5. RL outcome recording
6. Task queue integration
7. Message bus integration
8. Demo creation integration

### E2E Tests (4 tests)

1. Simple project self-build
2. Multi-agent parallel execution
3. Error recovery and retry
4. Complete workflow validation

## Files to Create/Modify

### New Files

- `migrations/008_demo8_self_build.sql` - Database schema
- `src/core/self-build/index.ts` - SelfBuildManager service
- `src/core/self-build/planner.ts` - Execution plan generator
- `src/core/self-build/executor.ts` - Phase executor
- `src/core/self-build/sample-projects.ts` - Sample project definitions
- `src/scripts/run-demo8-tester.ts` - Demo₈ tester

### Modified Files

- `src/api/index.ts` - Add self-build routes

## Demo Verification

```bash
# Run Demo₈ tests
npx tsx src/scripts/run-demo8-tester.ts

# Run architect review
npx tsx src/scripts/run-architect-review.ts 8
```

## Estimated Scope

| Component | Lines of Code |
|-----------|---------------|
| Self-Build Manager | ~400 |
| Planner | ~200 |
| Executor | ~300 |
| Sample Projects | ~100 |
| API | ~200 |
| Migration | ~50 |
| Tests | ~400 |
| **Total** | **~1650** |
