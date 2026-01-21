# Demo₅: Multi-Agent Coordination

## Overview

Demo₅ focuses on enabling multiple agents to work simultaneously on the same project while coordinating their activities efficiently. This includes task distribution, parallel execution, messaging coordination, and conflict resolution.

## Success Criteria

| Criteria | Description | Verification |
|----------|-------------|--------------|
| Concurrent Spawning | Multiple agents spawn and run simultaneously | Spawn 3+ agents, verify all active |
| Task Distribution | Tasks routed to appropriate agent types | Create tasks, verify assignment by type |
| Messaging Coordination | Agents communicate via message bus | Send/receive messages between agents |
| Conflict Resolution | File conflicts detected and resolved | Two agents modify same file |
| Resource Limits | Respect max concurrent agent limits | Attempt to exceed limit, verify rejection |

## Quality Thresholds

| Metric | Threshold |
|--------|-----------|
| Code Quality | ≥ 80% |
| Test Coverage | ≥ 45% |
| Requirements Coverage | ≥ 85% |
| Critical Issues | 0 |

## Technical Design

### 1. Agent Coordinator

```typescript
interface AgentCoordinator {
  // Spawn multiple agents concurrently
  spawnAgents(specs: AgentSpec[]): Promise<SpawnResult[]>;

  // Get all active agents for a project
  getActiveAgents(projectId: string): Promise<Agent[]>;

  // Coordinate task assignment
  assignTasks(tasks: Task[]): Promise<TaskAssignment[]>;

  // Handle agent-to-agent communication
  relay(message: Message): Promise<void>;
}
```

### 2. Task Router

```typescript
interface TaskRouter {
  // Route task to best available agent
  route(task: Task): Promise<string | null>;

  // Get agent workload
  getWorkload(agentId: string): Promise<number>;

  // Balance tasks across agents
  rebalance(projectId: string): Promise<void>;
}
```

### 3. Conflict Resolver

```typescript
interface ConflictResolver {
  // Detect file conflicts
  detectConflicts(changes: FileChange[]): Promise<Conflict[]>;

  // Lock file for agent
  lockFile(agentId: string, filePath: string): Promise<boolean>;

  // Release file lock
  unlock(filePath: string): Promise<void>;

  // Resolve conflict (merge/override/reject)
  resolve(conflict: Conflict, strategy: Strategy): Promise<void>;
}
```

### 4. Coordination Messages

```typescript
type CoordinationMessage =
  | { type: 'AGENT_STARTED'; agentId: string; agentType: AgentType }
  | { type: 'AGENT_IDLE'; agentId: string }
  | { type: 'TASK_CLAIMED'; agentId: string; taskId: string }
  | { type: 'FILE_LOCKED'; agentId: string; filePath: string }
  | { type: 'FILE_RELEASED'; agentId: string; filePath: string }
  | { type: 'CONFLICT_DETECTED'; conflict: Conflict }
  | { type: 'HELP_NEEDED'; agentId: string; reason: string };
```

## Database Schema

### agent_coordination table

```sql
CREATE TABLE agent_coordination (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id),
  coordinator_id UUID REFERENCES agents(id),
  max_concurrent_agents INTEGER DEFAULT 10,
  current_agent_count INTEGER DEFAULT 0,
  coordination_strategy VARCHAR(50) DEFAULT 'round_robin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### file_locks table

```sql
CREATE TABLE file_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  file_path VARCHAR(500) NOT NULL,
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '5 minutes',
  UNIQUE(project_id, file_path)
);
```

### agent_workload view

```sql
CREATE VIEW agent_workload AS
SELECT
  a.id as agent_id,
  a.project_id,
  a.type as agent_type,
  a.status,
  COUNT(t.id) FILTER (WHERE t.status = 'in_progress') as active_tasks,
  COUNT(t.id) FILTER (WHERE t.status = 'pending') as pending_tasks,
  AVG(EXTRACT(EPOCH FROM (t.completed_at - t.started_at))) as avg_task_duration
FROM agents a
LEFT JOIN tasks t ON a.id = t.assigned_agent_id
GROUP BY a.id, a.project_id, a.type, a.status;
```

## API Endpoints

### Coordination Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/coordination/spawn-multiple` | Spawn multiple agents |
| GET | `/api/coordination/agents/:projectId` | Get all active agents |
| POST | `/api/coordination/assign` | Assign tasks to agents |
| GET | `/api/coordination/workload/:projectId` | Get agent workloads |
| POST | `/api/coordination/rebalance/:projectId` | Rebalance tasks |

### File Lock Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/locks/acquire` | Acquire file lock |
| DELETE | `/api/locks/:lockId` | Release file lock |
| GET | `/api/locks/:projectId` | Get all active locks |
| POST | `/api/locks/check` | Check if file is locked |

### Conflict Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/conflicts/:projectId` | Get pending conflicts |
| POST | `/api/conflicts/resolve` | Resolve a conflict |
| GET | `/api/conflicts/:conflictId` | Get conflict details |

## Implementation Plan

### Phase 1: Core Coordination (35% of effort)

1. Create `src/core/coordination/index.ts` - Main coordinator
2. Implement concurrent agent spawning with limits
3. Add agent status tracking and heartbeat monitoring
4. Create workload balancing logic

### Phase 2: Task Routing (25% of effort)

1. Create `src/core/coordination/router.ts` - Task router
2. Implement type-based routing (developer, tester, etc.)
3. Add load-aware distribution
4. Create priority queue handling

### Phase 3: Conflict Resolution (25% of effort)

1. Create `src/core/coordination/conflicts.ts` - Conflict resolver
2. Implement file locking mechanism
3. Add conflict detection on file changes
4. Create resolution strategies (merge/override/queue)

### Phase 4: API & Integration (15% of effort)

1. Create `src/api/coordination.ts` - API endpoints
2. Add WebSocket events for real-time coordination
3. Integrate with existing agent manager
4. Add coordination dashboard components

## Test Plan

### Unit Tests (12 tests)

1. AgentCoordinator spawn multiple
2. AgentCoordinator respect limits
3. AgentCoordinator get active agents
4. TaskRouter route by type
5. TaskRouter workload balancing
6. TaskRouter priority handling
7. ConflictResolver detect conflicts
8. ConflictResolver file locking
9. ConflictResolver lock expiry
10. ConflictResolver resolve merge
11. ConflictResolver resolve override
12. Coordination message handling

### Integration Tests (8 tests)

1. Multiple agents working concurrently
2. Task distribution across agents
3. Inter-agent messaging
4. File lock acquisition/release
5. Conflict detection in parallel edits
6. Agent failure and recovery
7. Workload rebalancing
8. Max agent limit enforcement

### E2E Tests (5 tests)

1. Full multi-agent project execution
2. Coordinated feature implementation
3. Parallel test execution
4. Real-time status updates
5. Conflict resolution workflow

## Files to Create/Modify

### New Files

- `migrations/005_demo5_coordination.sql` - Database schema
- `src/core/coordination/index.ts` - Agent coordinator
- `src/core/coordination/router.ts` - Task router
- `src/core/coordination/conflicts.ts` - Conflict resolver
- `src/api/coordination.ts` - API endpoints
- `src/scripts/run-demo5-tester.ts` - Demo tester

### Modified Files

- `src/api/index.ts` - Add coordination routes
- `src/core/agent-manager/index.ts` - Add coordination hooks
- `src/core/message-bus/index.ts` - Add coordination messages

## Demo Verification

```bash
# Run Demo₅ tests
npx tsx src/scripts/run-demo5-tester.ts

# Run architect review
npx tsx src/scripts/post-demo-review.ts 5

# Or use unified workflow
./scripts/run-demo-workflow.sh 5
```

## Estimated Scope

| Component | Lines of Code |
|-----------|--------------|
| Coordinator | ~400 |
| Router | ~250 |
| Conflicts | ~300 |
| API | ~350 |
| Migration | ~80 |
| Tests | ~500 |
| **Total** | **~1880** |
