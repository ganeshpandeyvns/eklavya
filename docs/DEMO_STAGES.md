# Eklavya Demo Stages

## Overview

Each demo stage follows this workflow:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DEMO WORKFLOW                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│   │   BUILD      │ -> │   TEST       │ -> │   REVIEW     │         │
│   │              │    │              │    │              │         │
│   │ Implement    │    │ Functional   │    │ Architect    │         │
│   │ features     │    │ tester       │    │ quality gate │         │
│   └──────────────┘    └──────────────┘    └──────────────┘         │
│          │                   │                   │                  │
│          │                   │                   │                  │
│          v                   v                   v                  │
│   ┌──────────────────────────────────────────────────────┐         │
│   │              NEXT DEMO (if all pass)                  │         │
│   └──────────────────────────────────────────────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Running a Demo Workflow

```bash
# Complete workflow for any demo (tests + architect review)
./scripts/run-demo-workflow.sh 4

# Or run components separately:
npx tsx src/scripts/run-demo4-tester.ts      # Functional tests
npx tsx src/scripts/post-demo-review.ts 4    # Architect review
```

---

## Demo Stages

### ✅ Demo₀: UI Foundation
**Status**: Complete

| Aspect | Details |
|--------|---------|
| Focus | Dashboard, project cards, responsive design |
| Files | `web/src/**/*` |
| Tester | `src/scripts/run-demo0-tester.ts` |
| Success | Dashboard renders, mobile responsive |

---

### ✅ Demo₁: Agent Lifecycle
**Status**: Complete

| Aspect | Details |
|--------|---------|
| Focus | Agent spawn, terminate, status tracking |
| Files | `src/core/agent-manager/*`, `src/api/*` |
| Tester | `src/scripts/run-demo1-tester.ts` |
| Success | Agents created, status updates, termination works |

---

### ✅ Demo₂: Learning System
**Status**: Complete

| Aspect | Details |
|--------|---------|
| Focus | Thompson Sampling, prompt evolution, RL feedback |
| Files | `src/core/learning/*` |
| Tester | `src/scripts/run-demo2-tester.ts` |
| Success | Prompts versioned, sampling works, outcomes recorded |

---

### ✅ Demo₃: Autonomous Task Execution
**Status**: Complete

| Aspect | Details |
|--------|---------|
| Focus | Task queue, orchestrator, checkpoints, messaging |
| Files | `src/core/task-queue/*`, `src/api/tasks.ts`, `src/api/orchestrator.ts` |
| Tester | `src/scripts/run-demo3-tester.ts` |
| Success | 30/30 tests passing |

---

### ✅ Demo₄: Agent Lifecycle Management
**Status**: Complete

| Aspect | Details |
|--------|---------|
| Focus | Process tracking, health monitoring, resources |
| Files | `src/core/agent-manager/lifecycle.ts`, `src/api/lifecycle.ts` |
| Tester | `src/scripts/run-demo4-tester.ts` |
| Success | 35/35 tests passing |

---

### 🔲 Demo₅: Multi-Agent Coordination
**Status**: Pending

| Aspect | Details |
|--------|---------|
| Focus | Multiple agents working on same project |
| Features | Task distribution, coordination, conflict resolution |
| Success Criteria | |
| - | Multiple agents spawn concurrently |
| - | Tasks distributed to appropriate agents |
| - | Agents coordinate via messaging |
| - | Conflict resolution works |

**Quality Thresholds:**
- Code Quality: ≥ 80%
- Test Coverage: ≥ 45%
- Requirements: ≥ 85%
- Critical Issues: 0

---

### 🔲 Demo₆: Real-Time Portal
**Status**: Pending

| Aspect | Details |
|--------|---------|
| Focus | WebSocket updates, notifications, live dashboard |
| Features | Real-time status, smart notifications, live activity |
| Success Criteria | |
| - | Real-time status updates via WebSocket |
| - | Smart notifications (4 levels) |
| - | Live agent activity stream |
| - | Project progress streaming |

**Quality Thresholds:**
- Code Quality: ≥ 80%
- Test Coverage: ≥ 50%
- Requirements: ≥ 85%
- Critical Issues: 0

---

### 🔲 Demo₇: Demo System
**Status**: Pending

| Aspect | Details |
|--------|---------|
| Focus | Preview URLs, approval gates, scaffolding reuse |
| Features | Demo deployment, admin workflow, client feedback |
| Success Criteria | |
| - | Demo preview URLs generated |
| - | Admin approval workflow |
| - | Client feedback recording |
| - | Scaffolding reuse logic |

**Quality Thresholds:**
- Code Quality: ≥ 85%
- Test Coverage: ≥ 55%
- Requirements: ≥ 90%
- Critical Issues: 0

---

### 🔲 Demo₈: Self-Build Test
**Status**: Pending

| Aspect | Details |
|--------|---------|
| Focus | Eklavya builds a simple project end-to-end |
| Features | Full autonomous project execution |
| Success Criteria | |
| - | Create project from description |
| - | Orchestrator creates plan |
| - | Agents execute tasks |
| - | Project completes successfully |

**Quality Thresholds:**
- Code Quality: ≥ 85%
- Test Coverage: ≥ 60%
- Requirements: ≥ 90%
- Critical Issues: 0

---

## After All Demos → Full Build

Once all 9 demos pass (Demo₀ - Demo₈), the platform is ready for the Full Build phase:

1. **Complete remaining P0 features**
2. **Import existing project feature**
3. **Budget tracking and limits**
4. **Comprehensive testing**
5. **Documentation**
6. **Self-build validation**

---

## Architect Review Criteria

Each demo must pass the architect review with these checks:

| Criteria | Description |
|----------|-------------|
| Code Quality | Clean, maintainable code |
| Test Coverage | Adequate tests for critical paths |
| Requirements | Features implemented per spec |
| Critical Issues | No critical bugs or security issues |
| TypeScript Strict | Proper typing |
| Error Handling | Graceful error handling |

The thresholds increase as demos progress, ensuring quality improves throughout development.

---

## Quick Reference

| Demo | Name | Tests | Architect |
|------|------|-------|-----------|
| 0 | UI Foundation | ✅ | run-architect-review.ts Demo0 |
| 1 | Agent Lifecycle | ✅ | run-architect-review.ts Demo1 |
| 2 | Learning System | ✅ | run-architect-review.ts Demo2 |
| 3 | Task Execution | ✅ 30/30 | run-architect-review.ts Demo3 |
| 4 | Lifecycle Mgmt | ✅ 35/35 | run-architect-review.ts Demo4 |
| 5 | Multi-Agent | 🔲 | run-architect-review.ts Demo5 |
| 6 | Real-Time | 🔲 | run-architect-review.ts Demo6 |
| 7 | Demo System | 🔲 | run-architect-review.ts Demo7 |
| 8 | Self-Build | 🔲 | run-architect-review.ts Demo8 |
