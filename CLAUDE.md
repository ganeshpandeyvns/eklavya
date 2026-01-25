# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Eklavya is an autonomous agent orchestration platform using Reinforcement Learning to create self-improving AI agents. The platform follows the principle that **the system should be capable of building itself**.

**Business Model**: Admin runs a software development business. Clients submit project requests. Eklavya builds projects with autonomous agents that work 24/7. Admin reviews demos, shows clients, gets feedback, and iterates.

## Prerequisites

- **Node.js**: 20+
- **PostgreSQL**: 16 (uses LISTEN/NOTIFY for events)
- **Redis**: 7 (pub/sub, rate limiting)
- **Environment**: Copy `.env.example` to `.env` and configure database/Redis credentials

## Monorepo Structure

Three npm package locations:
- `package.json` (root) - CLI entry point and demo scripts
- `src/package.json` (@eklavya/core) - Backend with PostgreSQL, Redis, agent management
- `web/package.json` - Next.js 14 dashboard

**Always run `npm install` in the specific directory you're working in.**

## Development Commands

### Root (CLI & Demo Scripts)
```bash
npm run cli                  # Run Eklavya CLI
npm run demo:6               # Run demo 6 tester
npm run demo:7               # Run demo 7 tester
npm run demo:8               # Run demo 8 tester
```

### Backend Core (`src/`)
```bash
cd src && npm install        # Install backend dependencies
cd src && npm run build      # Compile TypeScript
cd src && npm run dev        # Watch mode development (tsx)
cd src && npm run start      # Run compiled dist/index.js
cd src && npm run test       # Run all Vitest tests
cd src && npm run test:coverage  # Tests with coverage
cd src && npm run lint       # ESLint check
cd src && npm run db:migrate # Run database migrations
cd src && npm run db:seed    # Seed prompt data
```

**Running a single test:**
```bash
cd src && npx vitest run core/learning/index.test.ts    # Run specific test file
cd src && npx vitest run -t "should create"             # Run tests matching pattern
cd src && npx vitest watch core/learning/               # Watch mode for directory
```

### Web Dashboard (`web/`)
```bash
cd web && npm install        # Install frontend dependencies
cd web && npm run dev        # Start Next.js dev server (port 3000)
cd web && npm run build      # Production build
cd web && npm run start      # Start production server
cd web && npm run lint       # ESLint check
```

### Demo Scripts (from repo root)
```bash
./scripts/run-dev-server.sh   # Start web frontend
./scripts/run-demo-tester.sh  # Verify demo works
./scripts/run-overnight.sh    # Full overnight autonomous build
```

## Documentation

| Document | Purpose |
|----------|---------|
| `EKLAVYA_COMPLETE_SPEC.md` | Complete technical specification |
| `AGENT_PROMPTS.md` | Full system prompts for all 10 agent types |
| `ARCHITECTURE.md` | System architecture details |
| `ROADMAP.md` | Development roadmap |
| `eklavya.md` | Original vision document |

## Core Architecture

### Agents ARE Claude Code Instances
Each agent is a Claude Code process with:
- Specialized system prompt (loaded via CLAUDE.md in agent's working directory)
- Scoped tool permissions
- Message queue access for coordination

### Ten Agent Types

| Agent | Role | Key Tools |
|-------|------|-----------|
| Orchestrator | Project coordination, agent spawning | spawnAgent, terminateAgent, sendMessage |
| Architect | Technical design, task breakdown | Read, Write (docs), research |
| Developer | Code implementation | Full file system, git, terminal |
| Tester | Test creation and execution | Read, Write tests, run tests |
| QA | E2E and user flow validation | Browser automation (Playwright) |
| PM | Requirements and acceptance | Read, Write docs |
| UAT | End-user simulation | Browser automation |
| SRE | CI/CD, deployment, infrastructure | Full system access |
| Monitor | Health checks, alerting | Read logs, metrics |
| Mentor | Research, guidance, encouragement | Web search, docs |

## Agent Escalation Policy

**Agents STOP and wait when**: Demo ready, architecture approval needed, budget threshold, build failure after 3 retries, external API integration

**Agents PROCEED autonomously when**: Writing code within plan, running tests, fixing tests, formatting, minor refactoring, git commits

## Technology Stack

- **Runtime**: Node.js 20+ with TypeScript (ES modules)
- **Database**: PostgreSQL 16 (main storage, LISTEN/NOTIFY for events)
- **Cache/Queue**: Redis 7 (pub/sub, rate limiting)
- **AI Provider**: Anthropic Claude (claude-sonnet-4-20250514 default)
- **Web Framework**: Next.js 14 (App Router)
- **Testing**: Vitest (unit), Playwright (E2E)
- **Styling**: Tailwind CSS

## Project Structure

```
eklavya/
├── src/                           # Backend core (@eklavya/core)
│   ├── core/
│   │   ├── agent-manager/         # Agent lifecycle (lifecycle.ts spawns Claude Code processes)
│   │   ├── message-bus/           # Redis pub/sub + PostgreSQL persistence
│   │   ├── learning/              # Thompson Sampling for prompt selection (metrics.ts)
│   │   ├── checkpoint/            # State persistence
│   │   ├── orchestrator/          # Project coordination, parallel execution
│   │   ├── coordination/          # Multi-agent coordination
│   │   ├── workflow/              # Workflow engine (engine.ts, auto-trigger.ts)
│   │   ├── task-queue/            # Task management and queuing
│   │   ├── notifications/         # Smart notification system
│   │   ├── activity/              # Activity tracking
│   │   ├── progress/              # Progress tracking
│   │   ├── demos/                 # Demo management (verification, approval, feedback)
│   │   ├── cost/                  # Budget and cost tracking
│   │   ├── self-build/            # Eklavya building itself (planner, executor)
│   │   ├── architect-agent/       # Architecture design (quality-analyzer, requirements-mapper)
│   │   ├── tester-agent/          # Test execution
│   │   ├── qa-agent/              # E2E and user flow validation
│   │   ├── mentor-agent/          # Research, guidance
│   │   ├── monitor-agent/         # Health checks, alerting
│   │   └── index.ts               # Exports all core modules
│   ├── types/index.ts             # Zod schemas for all entities
│   ├── lib/
│   │   ├── database.ts            # PostgreSQL connection
│   │   └── cache.ts               # Redis cache
│   └── index.ts                   # Main entry point
├── web/                           # Next.js 14 dashboard
│   └── src/
│       ├── app/                   # App router pages
│       │   ├── page.tsx           # Dashboard home
│       │   ├── new/page.tsx       # New project form
│       │   ├── import/page.tsx    # Import existing project
│       │   ├── projects/          # Projects list and detail ([id]/page.tsx)
│       │   ├── learning/page.tsx  # Learning system dashboard
│       │   └── settings/page.tsx  # Settings
│       ├── components/
│       │   ├── dashboard/         # StatsCards, ProjectCard, ActivityFeed, AgentGrid, AgentStatus
│       │   ├── layout/            # Header, Sidebar
│       │   └── chat/              # ChatInterface
│       ├── data/mock.ts           # Mock data for demos
│       ├── lib/                   # Utils, API client
│       └── types/index.ts         # Frontend type definitions
│   └── tests/                     # Playwright E2E tests (demo-verification.ts)
├── scripts/                       # Autonomous operation scripts
│   ├── run-dev-server.sh          # Start web frontend
│   ├── run-demo-tester.sh         # Verify demo is ready
│   ├── run-overnight.sh           # Full overnight build
│   ├── run-demo-workflow.sh       # Run demo workflow
│   └── manual-demo*-verification.sh  # Manual verification scripts
├── prompts/                       # Agent prompt templates
└── projects/                      # User projects (isolated)
```

## Communication Protocol

Agents communicate via Redis pub/sub with PostgreSQL persistence:
- `eklavya:{projectId}:orchestrator` - Orchestrator inbox
- `eklavya:{projectId}:{agentId}` - Specific agent inbox
- `eklavya:{projectId}:broadcast` - All project agents

Key message types: `TASK_ASSIGN`, `TASK_COMPLETE`, `TASK_FAILED`, `TASK_BLOCKED`, `MENTOR_SUGGESTION`

## Core Types (src/types/index.ts)

All entities validated with Zod schemas:

| Type | Values |
|------|--------|
| `AgentType` | orchestrator, architect, developer, tester, qa, pm, uat, sre, monitor, mentor |
| `AgentStatus` | initializing, idle, working, blocked, completed, failed, terminated |
| `TaskStatus` | pending, assigned, in_progress, blocked, completed, failed, cancelled |
| `MessageType` | task_assign, task_complete, task_failed, task_blocked, status_update, checkpoint, mentor_suggestion, broadcast |
| `PromptStatus` | experimental, candidate, production, deprecated |

Key schemas: `ProjectSchema`, `AgentSchema`, `TaskSchema`, `MessageSchema`, `PromptSchema`, `CheckpointSchema`, `LearningEventSchema`

## Learning System

Uses Thompson Sampling (Contextual Bandits) for prompt selection:
1. **Experimental** (10% traffic) - New prompts
2. **Candidate** (30% traffic) - Promising prompts
3. **Production** (60% traffic) - Proven prompts

Prompts evolve based on reward signals from task outcomes.

## Checkpointing

Agents checkpoint every 15 minutes, after task completion, and before risky operations. Checkpoints include:
- Agent state (current task, progress, working memory)
- File state (modified files, git status)
- Conversation state (compressed history)
- Recovery info (resume instructions)

## Budgets & Limits

Default per-project:
- Tokens: 1,000,000
- Time: 24 hours
- Cost: $100 USD
- Concurrent agents: 10

## Building Eklavya

To build Eklavya autonomously, use the bootstrap prompt in `EKLAVYA_COMPLETE_SPEC.md` Section 16. The specification contains everything needed:
- Complete API schemas
- Full database schema
- All agent prompts
- Configuration details
- Demo project for testing

## Git & GitHub Requirements

- **GitHub Account**: Always use `ganeshpandeyvns` for creating repositories and commits
- **Incremental Commits**: Make small, frequent commits as work progresses - never batch large changes
  - Commit after each logical unit of work is complete
  - Use meaningful commit messages describing the change
  - Push changes regularly to avoid losing work
- **Applies to Both**:
  - Eklavya platform development itself
  - All projects that Eklavya creates autonomously

## Prerequisite Verification (Before Any Implementation)

Before starting work on Eklavya or any project it creates, take time to verify:

1. **Verify Prompts**: Ensure all agent prompts are correctly loaded and accessible
2. **Verify Tools**: Confirm all required tools (file system, git, terminal, browser automation, etc.) are available and working
3. **Verify Plugins**: Check that MCP servers and integrations are properly configured
4. **Verify Permissions**: Ensure appropriate access levels for the task at hand
5. **Verify Dependencies**: Confirm external services (PostgreSQL, Redis, APIs) are reachable
6. **Don't Rush**: Take time to validate the setup is correct before proceeding with implementation

This verification applies to:
- Building Eklavya itself
- Every project Eklavya creates autonomously
- Any agent spawned during project execution

## Project Lifecycle with Demo Phase

```
DESCRIBE → PLAN/ARCH → [ADMIN APPROVAL] → DEMO → [ADMIN DECISION] → BUILD → DONE
               │              │              │            │
               │              │              │            ├─→ "More demos" → Demo₂
               │              │              │            ├─→ "Skip to build" → BUILD
               │              │              │            └─→ "Adjust" → Revise demo
               │              │              │
               │              │              └─ Interactive prototype (15-30 min)
               │              │                 Client sees something CONCRETE
               │              │                 Validates it solves their problem
               │              │
               │              └─ GATE: Architecture, Plan, Roadmap, Key Features
               │                 MUST be approved by Admin before any demo build
               │
               └─ Technical design, task breakdown, feature list
```

**Why Demo Matters:**
- Client is unsure and wants to see something concrete before deciding
- Demo proves the solution actually solves their problem
- Catch mismatches EARLY before investing in full build
- Iterative demos = course correction opportunities

**Admin Approval Gates:**
1. **Before Demo Build**: Architecture, plan, roadmap, key features must be approved
2. **After Each Demo**: Admin decides next step:
   - Continue to next milestone demo
   - Skip remaining demos → go directly to full build
   - Request adjustments → revise and rebuild demo

**Demo is NOT throwaway** - it becomes the scaffold for the real build. Layout, components, routing are reused; only mock data/APIs get replaced.

**Milestone Demos** (optional checkpoints during development):
- After foundation
- After core feature
- Before final polish
- Admin can skip to full build after 1st or 2nd demo if confident

**Parallel Autonomous Agents**:
All development (demo and full build) uses logically divided parallel autonomous agents:
- Agents work from one milestone to another
- OR from 1st demo directly to final product
- Division based on what makes sense for the specific product being built

This applies to:
- All projects Eklavya builds for clients
- **Eklavya platform development itself**

## Code Quality Standards

**CRITICAL RULE: No AI/Claude References**
- NEVER include "Claude", "AI", "GPT", "LLM", "AI-generated", or similar references in any code, comments, commit messages, or content
- All code appears as if written by a seasoned human developer
- No "Co-Authored-By" AI attributions in commits

**Code Quality (30-40 Year Old Architect Standard)**
- Clean, readable, well-structured code
- Proper comments explaining WHY, not WHAT
- Consistent naming conventions
- SOLID principles followed
- Efficient algorithms and data structures
- Proper error handling
- Security best practices
- No over-engineering, no under-engineering
- Code reviews would pass senior architect scrutiny

**Documentation**
- Clear, concise, professional
- No AI disclaimers or "generated by" notices
- Written as authoritative technical documentation

## Key Principles

1. **Autonomy After Approval** - Human approves plan once, then agents work independently
2. **Demo Before Build** - Always create quick interactive demo to validate before full implementation
3. **Everything Logged** - All actions recorded for learning
4. **Fail Gracefully** - Checkpoints enable recovery from any failure
5. **Cost Aware** - Hard limits prevent runaway spending
6. **Self-Improving** - RL evolves prompts based on outcomes
7. **Incremental Progress** - Commit and push changes frequently, not in large batches
8. **Verify Before Acting** - Always confirm prerequisites before starting work
9. **Parallel When Possible** - Spawn multiple agents simultaneously for faster delivery
10. **Professional Code Only** - All output matches senior architect quality standards

## Demo Delivery Rule

**After every demo completion (for Eklavya AND all projects Eklavya builds):**

1. **Clean restart** - Kill any existing services for this project
2. **Start services** - Bring up frontend/backend servers
3. **Run autonomous tester** - Verify demo actually works (see below)
4. **Provide URL** - Tell admin the URL to access the demo
5. **Wait for review** - Admin tests the demo after tester confirms it works

```bash
# Example for web projects:
pkill -f "project-name" 2>/dev/null  # Clean up
npm run dev                           # Start server
# Run tester agent to verify
# → "Demo verified and ready at http://localhost:3000"
```

This is MANDATORY - admin must be able to see and interact with every demo immediately after it's built.

## Autonomous Demo Tester (CRITICAL)

**Demo is a reputation risk. If system says "demo ready", it MUST work.**

Before declaring ANY demo ready, an autonomous tester agent MUST verify:

### Pre-Demo Verification Checklist
1. **Process Check**
   - Server process is running
   - Correct port is listening
   - No crash loops or errors in logs

2. **URL Accessibility**
   - Base URL responds (http://localhost:PORT)
   - Returns valid HTML (not error page)
   - Response time is acceptable (<3s)

3. **Page Verification** (for each page in demo)
   - Page loads without errors
   - No JavaScript console errors
   - Key elements are present
   - Interactive elements respond

4. **User Flow Testing**
   - Navigation works between pages
   - Forms submit (even if mock)
   - Buttons trigger expected actions
   - No broken links or images

5. **Responsive Check**
   - Desktop viewport works
   - Mobile viewport works
   - No layout breaks

### Tester Agent Implementation
```
Tester Agent spins up in separate terminal:
├── Checks process health
├── Hits all URLs with curl/fetch
├── Uses Playwright for browser testing
├── Captures screenshots of each page
├── Reports: PASS/FAIL with details
└── Only if ALL PASS → "Demo Ready"
```

### Failure Handling
- If ANY check fails → Demo NOT ready
- Fix issues automatically if possible
- Re-run full test suite
- Only declare ready after clean pass

This applies to:
- Eklavya's own demos (Demo₀, Demo₁, etc.)
- All client project demos Eklavya builds
- Full builds before declaring "complete"

## Fully Autonomous Operations

**All operations are pre-authorized** - no permission prompts for:
- All bash/terminal commands (npm, git, node, etc.)
- File read/write/edit operations
- Starting/stopping services
- Package installation
- Build commands
- Any tooling needed to complete the task

This applies to:
- Building Eklavya itself
- All projects Eklavya creates
- Demo builds and full builds
- Testing and deployment

## Autonomous Agent Scripts (Critical Pattern)

**Problem Solved**: Claude Code permission prompts interrupt autonomous workflows.

**Solution**: Standalone executable shell scripts that run independently in separate terminals.

### Script Location
```
eklavya/scripts/
├── run-dev-server.sh      # Start web frontend
├── run-demo-tester.sh     # Verify demo is ready
├── run-overnight.sh       # Full overnight autonomous build
└── agents/                # Individual agent scripts
    └── README.md
```

### Usage Pattern
```bash
# In Terminal 1 - Start server
./scripts/run-dev-server.sh

# In Terminal 2 - Run tester (after server is up)
./scripts/run-demo-tester.sh

# Or run everything overnight
nohup ./scripts/run-overnight.sh > logs/overnight.log 2>&1 &
```

### Why This Works
1. Scripts are pre-written and executable (`chmod +x`)
2. Run in their own process/terminal
3. No Claude Code permission prompts
4. Output goes to `logs/` directory
5. Results saved to `test-results/`
6. Scripts can spawn other scripts (orchestration)

### For Every Demo (Eklavya AND client projects)
1. Build creates/updates these scripts
2. Server script starts the app
3. Tester script verifies everything works
4. Only declare "demo ready" after tester passes
5. Admin runs scripts in their terminal - zero prompts

### Demo Verification Output
```
╔════════════════════════════════════════╗
║     ✓ DEMO₀ VERIFIED AND READY         ║
╚════════════════════════════════════════╝

URL: http://localhost:3000
Screenshots: test-results/screenshots/
```
