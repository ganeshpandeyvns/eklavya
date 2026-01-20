# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Eklavya is an autonomous agent orchestration platform using Reinforcement Learning to create self-improving AI agents. The platform follows the principle that **the system should be capable of building itself**.

## Documentation Structure

| Document | Purpose |
|----------|---------|
| `EKLAVYA_COMPLETE_SPEC.md` | Complete technical specification for building Eklavya |
| `AGENT_PROMPTS.md` | Full system prompts for all 10 agent types |
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

## Technology Stack

- **Runtime**: Node.js 20+ with TypeScript
- **Database**: PostgreSQL 16 (main storage, LISTEN/NOTIFY for events)
- **Cache/Queue**: Redis 7 (pub/sub, rate limiting)
- **AI Provider**: Anthropic Claude (claude-sonnet-4-20250514 default)
- **Web Framework**: Next.js 14
- **Testing**: Vitest (unit), Playwright (E2E)

## Key Commands (Once Built)

```bash
npm install              # Install dependencies
npm run dev              # Start development server
npm run build            # Build for production
npm run db:migrate       # Run database migrations
npm run db:seed          # Seed initial prompt versions
npm run test             # Run tests
npm run test:e2e         # Run E2E tests
```

## Project Structure (Target)

```
eklavya/
├── src/
│   ├── core/
│   │   ├── agent-manager/     # Agent lifecycle management
│   │   ├── message-bus/       # Inter-agent communication
│   │   ├── learning/          # RL and prompt evolution
│   │   └── checkpoint/        # State persistence
│   ├── services/              # Business logic
│   ├── api/                   # REST and internal APIs
│   └── lib/                   # Shared utilities
├── web/                       # Next.js dashboard
├── prompts/                   # Agent prompt templates
├── projects/                  # User projects (isolated)
└── tests/
```

## Communication Protocol

Agents communicate via Redis pub/sub with PostgreSQL persistence:
- `eklavya:{projectId}:orchestrator` - Orchestrator inbox
- `eklavya:{projectId}:{agentId}` - Specific agent inbox
- `eklavya:{projectId}:broadcast` - All project agents

Key message types: `TASK_ASSIGN`, `TASK_COMPLETE`, `TASK_FAILED`, `TASK_BLOCKED`, `MENTOR_SUGGESTION`

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
