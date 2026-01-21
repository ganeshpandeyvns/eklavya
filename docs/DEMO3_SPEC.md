# Demo₃: Autonomous Task Execution

## Overview

Demo₃ demonstrates the core value proposition of Eklavya: **autonomous agents that can execute development tasks without human intervention**.

This demo shows agents actually working - spawning, executing tasks, coordinating, and producing real output.

## Success Criteria (Strict)

| Criterion | Threshold | Measurement |
|-----------|-----------|-------------|
| Agent Spawn Success | ≥95% | Spawned agents reach RUNNING state |
| Task Completion Rate | ≥80% | Tasks reach COMPLETED status |
| Inter-Agent Communication | ≥90% | Messages delivered and acknowledged |
| Orchestrator Coordination | 100% | All agent lifecycles managed correctly |
| Real-Time Updates | <500ms | Dashboard reflects changes |
| Error Recovery | ≥80% | Failed tasks retried successfully |
| Checkpoint Integrity | 100% | All checkpoints valid and restorable |
| Code Quality (Generated) | ≥80% | Architect review passes |

## Expert Agent Definitions

### Orchestrator Agent (Master Coordinator)
**Expertise Level**: Principal Architect (30+ years experience)
**Peak Performance Indicators**:
- Zero missed task assignments
- Optimal agent utilization (no idle agents with pending work)
- Perfect escalation decisions
- Proactive bottleneck detection

**Core Responsibilities**:
- Spawn and terminate agents based on workload
- Route tasks to appropriate agent types
- Monitor agent health and performance
- Escalate blockers to admin
- Maintain project-wide context

### Developer Agent (Code Craftsman)
**Expertise Level**: Staff Engineer (15+ years experience)
**Peak Performance Indicators**:
- First-attempt success rate ≥70%
- Code passes linting on first write
- Minimal revision cycles
- Efficient file operations (no redundant reads)

**Core Responsibilities**:
- Implement features from specifications
- Write clean, tested, documented code
- Follow existing codebase patterns
- Handle edge cases proactively

### Tester Agent (Quality Guardian)
**Expertise Level**: Principal QA Engineer (20+ years experience)
**Peak Performance Indicators**:
- Test coverage ≥80% for new code
- Zero false positives in test results
- Comprehensive edge case coverage
- Performance test inclusion

**Core Responsibilities**:
- Write unit tests for new code
- Run test suites and report results
- Identify test gaps
- Suggest testability improvements

### Architect Agent (System Designer)
**Expertise Level**: Distinguished Engineer (25+ years experience)
**Peak Performance Indicators**:
- Zero critical design flaws
- Scalability considered in all decisions
- Security-first architecture
- Clear, actionable specifications

**Core Responsibilities**:
- Review code for architectural compliance
- Design system components
- Create technical specifications
- Identify technical debt

## Demo₃ Features

### 1. Task Queue System
- Tasks stored in PostgreSQL with priority
- Real-time task status updates via WebSocket
- Task dependencies tracked and enforced
- Automatic retry on failure (max 3 attempts)

### 2. Agent Spawning
- Orchestrator spawns agents on demand
- Each agent gets isolated working directory
- Agent state persisted for recovery
- Graceful shutdown with checkpoint

### 3. Task Execution Pipeline
```
Task Created → Assigned to Agent → Agent Executes → Result Recorded → RL Feedback
     ↓              ↓                    ↓                ↓              ↓
  WebSocket      Dashboard           Checkpoint        Dashboard     Learning
   Event          Update              Saved            Update        System
```

### 4. Inter-Agent Communication
- Message queue via Redis pub/sub
- Persistent message log in PostgreSQL
- Request/Response pattern for synchronous needs
- Broadcast for project-wide updates

### 5. Checkpoint & Recovery
- Automatic checkpoint every 15 minutes
- Checkpoint on task completion
- Checkpoint before risky operations
- Full state restoration on recovery

## API Endpoints (New)

### Task Management
```
POST   /api/tasks                    Create task
GET    /api/tasks                    List tasks (filterable)
GET    /api/tasks/:id                Get task details
PUT    /api/tasks/:id/assign         Assign task to agent
PUT    /api/tasks/:id/complete       Mark task complete
PUT    /api/tasks/:id/fail           Mark task failed
POST   /api/tasks/:id/retry          Retry failed task
```

### Agent Operations
```
POST   /api/agents/spawn             Spawn new agent
DELETE /api/agents/:id               Terminate agent
POST   /api/agents/:id/checkpoint    Force checkpoint
POST   /api/agents/:id/resume        Resume from checkpoint
GET    /api/agents/:id/messages      Get agent message queue
POST   /api/agents/:id/message       Send message to agent
```

### Orchestrator Controls
```
POST   /api/orchestrator/start       Start orchestrator
POST   /api/orchestrator/stop        Stop orchestrator
GET    /api/orchestrator/status      Get orchestrator status
POST   /api/orchestrator/plan        Submit plan for execution
```

## Database Schema (New Tables)

### tasks
```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id),
    parent_task_id UUID REFERENCES tasks(id),
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    specification JSONB,
    status VARCHAR(20) DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    assigned_agent_id UUID REFERENCES agents(id),
    assigned_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    result JSONB,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### agent_messages
```sql
CREATE TABLE agent_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_agent_id UUID REFERENCES agents(id),
    to_agent_id UUID REFERENCES agents(id),
    project_id UUID REFERENCES projects(id),
    type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### checkpoints
```sql
CREATE TABLE checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id),
    project_id UUID REFERENCES projects(id),
    task_id UUID REFERENCES tasks(id),
    state JSONB NOT NULL,
    file_state JSONB,
    conversation_state JSONB,
    recovery_instructions TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Test Scenarios

### Scenario 1: Simple Task Execution
1. Create a "write_file" task
2. Orchestrator assigns to Developer agent
3. Developer executes and completes
4. Dashboard shows real-time progress
5. RL feedback recorded

### Scenario 2: Multi-Agent Coordination
1. Create a "implement_feature" task
2. Orchestrator spawns Developer + Tester
3. Developer writes code
4. Tester writes and runs tests
5. Results aggregated and reported

### Scenario 3: Error Recovery
1. Create task that will fail
2. Agent fails, checkpoint saved
3. Automatic retry triggered
4. Task eventually succeeds
5. Recovery metrics recorded

### Scenario 4: Checkpoint Restore
1. Agent working on task
2. Simulate crash (kill process)
3. Resume from checkpoint
4. Task continues from last state
5. No work lost

## Quality Gates

All agents must pass these gates before task completion:

1. **Code Lint Pass**: `npm run lint` succeeds
2. **Type Check Pass**: `npm run typecheck` succeeds
3. **Test Pass**: All tests pass
4. **No Console Errors**: Browser console clean
5. **API Contract Valid**: Frontend/Backend aligned

## Improvements from Demo₂ Applied

1. **Frontend/API Compatibility Check**: Validate status values match
2. **Error Handling Coverage**: All core modules have try-catch
3. **TypeScript Strict Mode**: Enabled project-wide
4. **Test Coverage Metrics**: Accurate calculation excluding non-source files
5. **Graceful Error Responses**: Invalid inputs return proper HTTP codes
6. **Default Fallbacks**: Unknown values handled gracefully

## Demo₃ Verification Criteria

The demo is ONLY ready when:

1. ✓ Task can be created via API
2. ✓ Orchestrator spawns agent for task
3. ✓ Agent executes task successfully
4. ✓ Dashboard shows real-time progress
5. ✓ Task completion triggers RL feedback
6. ✓ Checkpoint saves agent state
7. ✓ Agent can resume from checkpoint
8. ✓ Multi-agent coordination works
9. ✓ Error recovery works (retry mechanism)
10. ✓ All API endpoints return correct responses

## Timeline

Phase 1: Task Queue System (core)
Phase 2: Agent Spawning & Lifecycle
Phase 3: Task Execution Pipeline
Phase 4: Inter-Agent Communication
Phase 5: Checkpoint & Recovery
Phase 6: Dashboard Integration
Phase 7: Verification & Testing

## Files to Create/Modify

### New Files
- `src/core/task-queue/index.ts` - Task queue management
- `src/core/task-queue/task-executor.ts` - Task execution logic
- `src/core/checkpoint/index.ts` - Checkpoint system
- `src/core/checkpoint/state-serializer.ts` - State serialization
- `src/api/tasks.ts` - Task API endpoints
- `src/api/orchestrator.ts` - Orchestrator API endpoints
- `src/scripts/run-demo3-tester.ts` - Demo₃ verification
- `scripts/manual-demo3-verification.sh` - Manual verification

### Modified Files
- `src/core/agent-manager/index.ts` - Add checkpoint integration
- `src/core/message-bus/index.ts` - Add persistence layer
- `src/core/orchestrator/index.ts` - Add task assignment logic
- `src/api/agents.ts` - Add checkpoint/resume endpoints
- `src/index.ts` - Register new routes
- `web/src/app/page.tsx` - Add task progress view
