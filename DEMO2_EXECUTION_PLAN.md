# Demo₂ Execution Plan: Real-Time Dashboard

> **Status**: IN PROGRESS
> **Started**: January 2026
> **Target**: Real-time dashboard with live agent status and API integration

---

## Parallel Agent Tasks

### Phase 1: Backend Services (Parallel)

#### Agent 1: WebSocket Service
**Type**: Developer
**Files**: `src/services/websocket.ts`, `src/api/index.ts`

| Success Criteria | Metric | Pass/Fail |
|-----------------|--------|-----------|
| WebSocket server starts on port 4001 | Server binds successfully | ⬜ |
| Client can connect via ws://localhost:4001 | Connection established | ⬜ |
| Subscribe to project events | Receives subscription confirmation | ⬜ |
| Broadcast on agent status change | Event received < 1s after DB change | ⬜ |
| Broadcast on task status change | Event received < 1s after DB change | ⬜ |
| Graceful reconnection handling | Client reconnects after disconnect | ⬜ |

**Reward Criteria**:
- All criteria pass: +0.8
- 5/6 pass: +0.5
- 4/6 pass: +0.2
- <4 pass: -0.5

---

#### Agent 2: Dashboard API Endpoints
**Type**: Developer
**Files**: `src/api/dashboard.ts`, `src/api/index.ts`

| Endpoint | Response | Success Criteria | Pass/Fail |
|----------|----------|-----------------|-----------|
| `GET /api/dashboard/stats` | `{activeProjects, activeAgents, demosWaiting, todaySpend}` | Returns valid aggregated data | ⬜ |
| `GET /api/projects/:id/activity` | `[{agentType, action, details, timestamp}]` | Returns last 50 activities | ⬜ |
| `GET /api/agents/:id/stats` | `{tasksCompleted, tasksFailed, tokensUsed, avgReward}` | Returns agent metrics | ⬜ |
| `GET /api/projects/:id/agents/live` | `[{id, type, status, currentTask, progress}]` | Returns real-time agent list | ⬜ |
| `GET /api/prompts/:agentType/stats` | `{versions, thompsonScores, totalUses}` | Returns RL learning stats | ⬜ |

**Reward Criteria**:
- All 5 endpoints work: +0.8
- 4/5 work: +0.5
- 3/5 work: +0.2
- <3 work: -0.5

---

### Phase 2: Frontend Integration (Parallel, after Phase 1)

#### Agent 3: API Client Wiring
**Type**: Developer
**Files**: `web/src/lib/api.ts`, `web/src/hooks/useApi.ts`, `web/src/app/page.tsx`

| Success Criteria | Metric | Pass/Fail |
|-----------------|--------|-----------|
| Dashboard loads projects from API | No mock data imports in page.tsx | ⬜ |
| Stats cards show real data | API call to /api/dashboard/stats | ⬜ |
| Agent grid shows real agents | API call to /api/projects/:id/agents | ⬜ |
| Activity feed shows real data | API call to /api/projects/:id/activity | ⬜ |
| Loading states implemented | Skeleton/spinner while fetching | ⬜ |
| Error states implemented | Error message on API failure | ⬜ |

**Reward Criteria**:
- All criteria pass: +0.8
- 5/6 pass: +0.5
- 4/6 pass: +0.2
- <4 pass: -0.5

---

#### Agent 4: WebSocket Integration
**Type**: Developer
**Files**: `web/src/lib/websocket.ts`, `web/src/hooks/useWebSocket.ts`, components

| Success Criteria | Metric | Pass/Fail |
|-----------------|--------|-----------|
| WebSocket service connects | Connection to ws://localhost:4001 | ⬜ |
| Auto-reconnect on disconnect | Reconnects within 5s | ⬜ |
| Agent status updates in real-time | UI updates < 1s after backend change | ⬜ |
| Task progress updates in real-time | Progress bar updates live | ⬜ |
| Activity feed updates in real-time | New items appear without refresh | ⬜ |
| Connection status indicator | Shows connected/disconnected state | ⬜ |

**Reward Criteria**:
- All criteria pass: +0.8
- 5/6 pass: +0.5
- 4/6 pass: +0.2
- <4 pass: -0.5

---

### Phase 3: Testing & Verification

#### Agent 5: Tester Agent
**Type**: Tester
**Files**: `src/scripts/run-demo2-tester.ts`

| Test Suite | Tests | Pass Criteria |
|------------|-------|---------------|
| API Endpoints | 5 tests | All endpoints return 200 with valid data |
| WebSocket Connection | 3 tests | Connect, subscribe, receive events |
| Dashboard Integration | 4 tests | Pages load with real data |
| Real-Time Updates | 3 tests | Updates appear < 1s latency |
| Error Handling | 3 tests | Graceful failures on API down |

**Total**: 18 tests
**Pass Threshold**: 16/18 (89%)

---

## Execution Flow

```
Phase 1 (Parallel)           Phase 2 (Parallel)           Phase 3
─────────────────           ─────────────────           ─────────

┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Agent 1:       │         │  Agent 3:       │         │  Agent 5:       │
│  WebSocket      │────────▶│  API Client     │────────▶│  Tester         │
│  Service        │         │  Wiring         │         │                 │
└─────────────────┘         └─────────────────┘         │  Verifies ALL   │
                                                        │  success        │
┌─────────────────┐         ┌─────────────────┐         │  criteria       │
│  Agent 2:       │────────▶│  Agent 4:       │────────▶│                 │
│  Dashboard API  │         │  WebSocket      │         └─────────────────┘
│  Endpoints      │         │  Integration    │
└─────────────────┘         └─────────────────┘
```

---

## Demo₂ Success Criteria (Overall)

| Criterion | Required | Status |
|-----------|----------|--------|
| Dashboard shows real project data from API | Yes | ⬜ |
| Agent status updates in real-time (< 1s latency) | Yes | ⬜ |
| Can create project and watch agents spawn | Yes | ⬜ |
| RL rewards visible in UI | Yes | ⬜ |
| All tester tests pass (16/18 minimum) | Yes | ⬜ |

---

## Files to Create/Modify

### New Files
- `src/services/websocket.ts` - WebSocket server
- `src/api/dashboard.ts` - Dashboard-specific endpoints
- `web/src/lib/websocket.ts` - WebSocket client
- `web/src/hooks/useApi.ts` - API data fetching hooks
- `web/src/hooks/useWebSocket.ts` - WebSocket subscription hook
- `src/scripts/run-demo2-tester.ts` - Demo₂ verification script

### Modified Files
- `src/api/index.ts` - Add new routes
- `src/index.ts` - Start WebSocket server
- `web/src/app/page.tsx` - Use real API data
- `web/src/components/dashboard/*` - Real-time updates
- `web/src/lib/api.ts` - Add new methods

---

## RL Feedback Summary

After Demo₂ completion, rewards/penalties applied:

| Agent | Outcome | Reward Range |
|-------|---------|--------------|
| Developer (WebSocket) | Based on criteria | -0.5 to +0.8 |
| Developer (API) | Based on criteria | -0.5 to +0.8 |
| Developer (Frontend API) | Based on criteria | -0.5 to +0.8 |
| Developer (Frontend WS) | Based on criteria | -0.5 to +0.8 |
| Tester | Based on bug detection | +0.1 per bug found |
| Orchestrator | Overall success | -0.3 to +0.5 |

All outcomes feed into Thompson Sampling for prompt evolution.

---

*This plan is executed by the Orchestrator agent with parallel spawning.*
