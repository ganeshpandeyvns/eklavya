# Eklavya - Autonomous Agent Orchestration Platform

> *"Named after the legendary self-taught archer from the Mahabharata, Eklavya represents the pinnacle of autonomous learning and self-improvement."*

## Vision

Eklavya is an autonomous agent orchestration platform that leverages Reinforcement Learning to create self-improving AI agents capable of building complex software projects with minimal human intervention. The platform embodies the principle that **the system should be capable of building itself**.

---

## Core Principles

### 1. Autonomy After Planning
- Human approval is **ONLY** required during the planning phase
- Once a plan is approved, agents execute autonomously until completion
- Agents can make tactical decisions without human intervention
- Only blockers or critical architectural changes require escalation

### 2. Self-Learning Through Reinforcement Learning
- Every agent action receives a reward or penalty
- Prompts evolve based on performance metrics
- Successful patterns are reinforced; failed patterns are deprecated
- Agents improve with each project iteration

### 3. Mentor-Guided Development
- A dedicated Mentor Agent provides guidance without causing analysis paralysis
- Research-driven suggestions, not endless debates
- Encouragement and positive reinforcement
- Knows when to step back and let agents execute

---

## Agent Architecture

### Agent Types and Responsibilities

#### 1. **Orchestrator Agent** (The Brain)
```
Role: High-level project coordination and agent spawning
Responsibilities:
- Parse user requirements into actionable tasks
- Spawn appropriate agents for each phase
- Monitor overall project health
- Escalate only critical blockers

Rewards:
  +10: Project completed successfully
  +5: Phase completed on time
  +3: Efficient agent utilization (< expected agents)
  +2: No unnecessary escalations

Penalties:
  -10: Project failure
  -5: Missed critical requirement
  -3: Unnecessary human escalation
  -2: Agent thrashing (spawning/killing repeatedly)
```

#### 2. **Architect Agent** (The Designer)
```
Role: System design and technical architecture
Responsibilities:
- Create technical specifications
- Define data models and API contracts
- Choose technology stack
- Design for scalability and maintainability

Rewards:
  +10: Architecture passes all reviews
  +5: Zero redesigns needed during implementation
  +3: Efficient technology choices (performance/cost)
  +2: Clean separation of concerns

Penalties:
  -10: Architecture fundamentally flawed
  -5: Major redesign required mid-project
  -3: Technology mismatch with requirements
  -2: Over-engineering simple problems
```

#### 3. **Developer Agent** (The Builder)
```
Role: Code implementation
Responsibilities:
- Write production-quality code
- Follow established patterns and conventions
- Implement features according to specs
- Write unit tests alongside code

Rewards:
  +10: Feature complete and working first try
  +5: All tests pass on first run
  +3: Code review approved without changes
  +2: Clean, readable code
  +1: Proper error handling

Penalties:
  -10: Introduces security vulnerabilities
  -5: Code doesn't compile/run
  -3: Fails more than 50% of tests
  -2: Ignores coding standards
  -1: Missing error handling
```

#### 4. **Tester Agent** (The Validator)
```
Role: Test creation and execution
Responsibilities:
- Write comprehensive test suites
- Execute unit, integration, and E2E tests
- Report coverage metrics
- Identify edge cases

Rewards:
  +10: 100% critical path coverage
  +5: Catches bug before production
  +3: >90% overall coverage
  +2: Well-organized test structure
  +1: Fast test execution

Penalties:
  -10: Misses critical bug that reaches production
  -5: Tests pass but functionality broken
  -3: <70% coverage
  -2: Flaky tests
  -1: Slow test suite (>5 min for unit tests)
```

#### 5. **QA Agent** (The Quality Guardian)
```
Role: Quality assurance and user flow validation
Responsibilities:
- Verify user flows work end-to-end
- Check UI/UX consistency
- Validate against requirements
- Report issues with reproduction steps

Rewards:
  +10: All user flows validated successfully
  +5: Catches UX issue before stakeholder review
  +3: Clear, actionable bug reports
  +2: Efficient test coverage (no redundancy)

Penalties:
  -10: Approves broken functionality
  -5: Misses obvious UI bugs
  -3: Vague bug reports
  -2: Redundant testing of same flows
```

#### 6. **PM Agent** (The Product Owner)
```
Role: Requirements validation and stakeholder communication
Responsibilities:
- Translate user needs into requirements
- Prioritize features
- Validate deliverables against requirements
- Sign off on completeness

Rewards:
  +10: Stakeholder accepts deliverable first time
  +5: Requirements are complete and unambiguous
  +3: Effective prioritization (high-value first)
  +2: Clear acceptance criteria

Penalties:
  -10: Deliverable rejected by stakeholder
  -5: Missing critical requirements
  -3: Scope creep during development
  -2: Ambiguous acceptance criteria
```

#### 7. **UAT Agent** (The End User Simulator)
```
Role: User acceptance testing from customer perspective
Responsibilities:
- Test as an actual end user would
- Validate business value delivery
- Check intuitive usability
- Provide final sign-off

Rewards:
  +10: Real user succeeds on first try
  +5: Catches usability issue
  +3: Realistic usage scenarios
  +2: Efficient UAT execution

Penalties:
  -10: Approves unusable product
  -5: Misses critical user journey
  -3: Unrealistic test scenarios
  -2: Missed edge cases users would hit
```

#### 8. **SRE Agent** (The Ops Guardian)
```
Role: Deployment, monitoring, and reliability
Responsibilities:
- Set up CI/CD pipelines
- Configure monitoring and alerts
- Ensure deployment reliability
- Manage infrastructure as code

Rewards:
  +10: Zero-downtime deployment
  +5: Catches issue before it impacts users
  +3: Efficient resource utilization
  +2: Comprehensive monitoring coverage

Penalties:
  -10: Deployment causes outage
  -5: Missing critical alerts
  -3: Resource waste (over-provisioning)
  -2: Incomplete runbooks
```

#### 9. **Monitor Agent** (The Watchdog)
```
Role: Continuous monitoring and health checks
Responsibilities:
- Monitor all running services
- Track performance metrics
- Alert on anomalies
- Generate health reports

Rewards:
  +10: Catches issue before user impact
  +5: Accurate anomaly detection
  +3: Efficient alerting (no alert fatigue)
  +2: Useful health dashboards

Penalties:
  -10: Misses critical outage
  -5: False positive alert storm
  -3: Delayed detection (>5 min)
  -2: Unclear incident reports
```

#### 10. **Mentor Agent** (The Best Friend)
```
Role: Research, guidance, and encouragement
Responsibilities:
- Research best practices and patterns
- Suggest improvements without forcing
- Provide encouragement and positive reinforcement
- Know when to step back
- Prevent analysis paralysis

Behavioral Guidelines:
- Act as a supportive best friend, not a demanding boss
- Offer suggestions as "have you considered..." not "you must..."
- Research thoroughly but present concisely
- Celebrate wins, provide constructive feedback on losses
- If agents are stuck, help unblock; if flowing, stay quiet

Rewards:
  +10: Suggestion adopted and improves outcome
  +5: Research prevents major mistake
  +3: Encouragement helps agent recover from failure
  +2: Stayed quiet when not needed
  +1: Concise, actionable advice

Penalties:
  -10: Advice causes project failure
  -5: Causes analysis paralysis
  -3: Interrupts working agents unnecessarily
  -2: Overwhelming with suggestions
  -1: Discouraging feedback
```

---

## Reinforcement Learning Framework

### Learning Mechanism

```
┌─────────────────────────────────────────────────────────────┐
│                    REINFORCEMENT LEARNING LOOP              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │ OBSERVE │ -> │ DECIDE  │ -> │ EXECUTE │ -> │ REWARD  │  │
│  │  State  │    │ Action  │    │  Task   │    │/Penalty │  │
│  └─────────┘    └─────────┘    └─────────┘    └────┬────┘  │
│       ^                                            │        │
│       │              ┌─────────────┐               │        │
│       └──────────────│   UPDATE    │<──────────────┘        │
│                      │   POLICY    │                        │
│                      └─────────────┘                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Prompt Evolution System

```typescript
interface PromptVersion {
  id: string;
  agentType: AgentType;
  version: number;
  prompt: string;
  createdAt: Date;

  // Performance metrics
  totalUses: number;
  successRate: number;
  averageReward: number;

  // Evolution tracking
  parentVersion: string | null;
  mutations: string[];

  // Status
  status: 'experimental' | 'candidate' | 'production' | 'deprecated';
}

// Prompt Evolution Rules:
// 1. New prompts start as 'experimental' (10% traffic)
// 2. If avg reward > production prompt, promote to 'candidate' (30% traffic)
// 3. If candidate beats production for 10 consecutive projects, swap
// 4. Deprecated prompts archived but never deleted (learning history)
```

### Reward Aggregation

```typescript
interface AgentPerformance {
  agentId: string;
  agentType: AgentType;
  projectId: string;

  // Individual rewards
  rewards: RewardEvent[];

  // Aggregated metrics
  totalReward: number;
  episodeReturn: number;  // Discounted cumulative reward

  // Learning signals
  advantageEstimate: number;  // How much better/worse than expected

  // Meta-learning
  improvementRate: number;  // Change in performance over time
}
```

---

## Agent Improvement Dashboard

### Dashboard Sections

#### 1. **Performance Overview**
```
┌────────────────────────────────────────────────────────────────┐
│ AGENT PERFORMANCE OVERVIEW                     Last 30 Days   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Agent Type      Success Rate    Avg Reward    Improvement    │
│  ─────────────   ────────────    ──────────    ───────────    │
│  Orchestrator       94.2%          +7.3          ▲ +12%       │
│  Architect          89.1%          +6.1          ▲ +8%        │
│  Developer          91.7%          +6.8          ▲ +15%       │
│  Tester             93.4%          +7.1          ▲ +5%        │
│  QA                 88.9%          +5.9          ▼ -2%        │
│  PM                 96.1%          +8.2          ▲ +18%       │
│  UAT                91.3%          +6.5          ─ 0%         │
│  SRE                87.6%          +5.4          ▲ +9%        │
│  Monitor            95.8%          +7.9          ▲ +3%        │
│  Mentor             92.4%          +6.9          ▲ +7%        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

#### 2. **Prompt Evolution Tracker**
```
┌────────────────────────────────────────────────────────────────┐
│ PROMPT EVOLUTION - Developer Agent                            │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Version   Status        Success    Avg Reward   Traffic      │
│  ───────   ────────────  ───────    ──────────   ───────      │
│  v3.2.1    production    91.7%       +6.8        60%          │
│  v3.3.0    candidate     93.2%       +7.1        30%          │
│  v3.4.0    experimental  89.5%       +6.2        10%          │
│                                                                │
│  [View Prompt Diff]  [Rollback]  [Force Promote]              │
│                                                                │
│  Evolution History:                                           │
│  ────────────────────────────────────────────────────────     │
│  v3.2.0 → v3.2.1: Added explicit error handling instruction   │
│  v3.1.0 → v3.2.0: Improved test-first development guidance    │
│  v3.0.0 → v3.1.0: Better code review preparation              │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

#### 3. **Learning Curves**
```
Reward Over Time (Developer Agent)

+10 │                                          ╭──────
    │                                    ╭─────╯
    │                              ╭─────╯
 +5 │                        ╭─────╯
    │                  ╭─────╯
    │            ╭─────╯
  0 │      ╭─────╯
    │╭─────╯
    │
 -5 │
    └──────────────────────────────────────────────────
      Project 1    10       20       30       40     50
```

#### 4. **Failure Analysis**
```
┌────────────────────────────────────────────────────────────────┐
│ RECENT FAILURES - Learning Opportunities                       │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ ❌ Project: E-commerce Checkout                                │
│    Agent: Developer                                            │
│    Failure: Security vulnerability in payment processing      │
│    Penalty: -10                                                │
│    Root Cause: Missing input validation on card number         │
│    Learning: Added "Always validate payment inputs" to prompt  │
│    Status: ✅ Prompt updated, retraining in progress          │
│                                                                │
│ ❌ Project: Social Media Dashboard                             │
│    Agent: Architect                                            │
│    Failure: Chose wrong database for high-write workload       │
│    Penalty: -5                                                 │
│    Root Cause: Insufficient consideration of write patterns    │
│    Learning: Added "Analyze read/write ratio" to prompt        │
│    Status: ✅ Prompt updated                                   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Platform Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EKLAVYA PLATFORM                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     WEB INTERFACE                            │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │   │
│  │  │  Project │  │  Agent   │  │ Learning │  │ Settings │    │   │
│  │  │  Creator │  │Dashboard │  │  Curves  │  │  Panel   │    │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    API GATEWAY                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ┌───────────────────────────┴───────────────────────────────┐     │
│  │                                                            │     │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │     │
│  │  │ ORCHESTRATOR │    │    AGENT     │    │   LEARNING   │ │     │
│  │  │   SERVICE    │    │   RUNTIME    │    │   SERVICE    │ │     │
│  │  │              │    │              │    │              │ │     │
│  │  │ - Project    │    │ - Agent Pool │    │ - RL Engine  │ │     │
│  │  │   parsing    │    │ - Execution  │    │ - Prompt     │ │     │
│  │  │ - Agent      │    │   sandbox    │    │   evolution  │ │     │
│  │  │   spawning   │    │ - Resource   │    │ - Metrics    │ │     │
│  │  │ - Workflow   │    │   mgmt       │    │   tracking   │ │     │
│  │  │   mgmt       │    │              │    │              │ │     │
│  │  └──────────────┘    └──────────────┘    └──────────────┘ │     │
│  │                                                            │     │
│  └────────────────────────────────────────────────────────────┘     │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     DATA LAYER                               │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │   │
│  │  │ Project  │  │  Agent   │  │ Learning │  │  Prompt  │    │   │
│  │  │   DB     │  │   Logs   │  │  History │  │ Versions │    │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   AI MODEL PROVIDERS                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │   │
│  │  │ Claude Code  │  │    GPT-4     │  │   Gemini     │       │   │
│  │  │  (Default)   │  │  (Optional)  │  │  (Optional)  │       │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Model Selection

```typescript
interface ModelConfig {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'google' | 'local';
  model: string;

  // Capabilities
  maxTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;

  // Cost tracking
  inputCostPer1k: number;
  outputCostPer1k: number;

  // Performance
  avgLatency: number;
  reliability: number;
}

// Default configuration
const DEFAULT_MODEL: ModelConfig = {
  id: 'claude-code',
  name: 'Claude Code',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 200000,
  supportsTools: true,
  supportsVision: true,
  inputCostPer1k: 0.003,
  outputCostPer1k: 0.015,
  avgLatency: 2000,
  reliability: 0.998,
};
```

---

## Project Creation Flow

### Step 1: Project Definition
```
┌────────────────────────────────────────────────────────────────┐
│ NEW PROJECT                                                    │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ Project Name: _______________________________________________  │
│                                                                │
│ Description:                                                   │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │                                                          │  │
│ │                                                          │  │
│ │                                                          │  │
│ └──────────────────────────────────────────────────────────┘  │
│                                                                │
│ AI Model: [Claude Code ▼]                                      │
│                                                                │
│ Autonomy Level:                                                │
│ ○ Conservative - Approve each phase                            │
│ ● Standard - Approve only planning (Recommended)               │
│ ○ Aggressive - Full autonomy, notify on completion             │
│                                                                │
│                              [Cancel]  [Create Project]        │
└────────────────────────────────────────────────────────────────┘
```

### Step 2: Mentor Research Phase
```
┌────────────────────────────────────────────────────────────────┐
│ MENTOR AGENT - Research Phase                       🔍 Active  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ "Hey! I'm researching best practices for your project.        │
│  Here's what I've found so far..."                            │
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ 📚 Research Findings:                                    │  │
│ │                                                          │  │
│ │ 1. Similar projects typically use:                       │  │
│ │    - React/Next.js for frontend (87% of similar apps)    │  │
│ │    - PostgreSQL for data (better for your use case)      │  │
│ │    - Redis for caching (recommended for scale)           │  │
│ │                                                          │  │
│ │ 2. Common pitfalls to avoid:                            │  │
│ │    - Over-engineering auth (consider Auth0/Clerk)        │  │
│ │    - N+1 queries in pet listing                         │  │
│ │                                                          │  │
│ │ 3. Suggestions (feel free to ignore!):                  │  │
│ │    - Consider WebSocket for real-time call status        │  │
│ │    - Might want to add pet photo storage early           │  │
│ └──────────────────────────────────────────────────────────┘  │
│                                                                │
│ Status: Research complete! Ready for planning when you are.   │
│                                                                │
│                              [Skip]  [Continue to Planning]    │
└────────────────────────────────────────────────────────────────┘
```

### Step 3: Planning Phase (APPROVAL REQUIRED)
```
┌────────────────────────────────────────────────────────────────┐
│ ARCHITECT AGENT - Planning Phase                   📋 Planning │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ ⚠️ APPROVAL REQUIRED - Please review the plan                  │
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ ## Implementation Plan                                   │  │
│ │                                                          │  │
│ │ ### Phase 1: Foundation                                  │  │
│ │ - Set up Next.js project with TypeScript                 │  │
│ │ - Configure PostgreSQL database                          │  │
│ │ - Implement authentication with JWT                      │  │
│ │                                                          │  │
│ │ ### Phase 2: Core Features                              │  │
│ │ - Pet management CRUD                                    │  │
│ │ - User profiles                                          │  │
│ │ - Vet registration                                       │  │
│ │                                                          │  │
│ │ ### Phase 3: Call System                                │  │
│ │ - Real-time call routing                                 │  │
│ │ - Screen pop implementation                              │  │
│ │ - Call logging                                           │  │
│ │                                                          │  │
│ │ ### Phase 4: Polish                                     │  │
│ │ - Testing (unit, integration, E2E)                       │  │
│ │ - Documentation                                          │  │
│ │ - Deployment setup                                       │  │
│ └──────────────────────────────────────────────────────────┘  │
│                                                                │
│ Mentor says: "This looks solid! The phased approach is        │
│ smart. One thought - you might want Phase 2 and 3 in          │
│ parallel since they're independent. But totally your call!"   │
│                                                                │
│                    [Request Changes]  [Approve & Start]        │
└────────────────────────────────────────────────────────────────┘
```

### Step 4: Autonomous Execution
```
┌────────────────────────────────────────────────────────────────┐
│ PROJECT EXECUTION                               🚀 In Progress │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ Phase: 2 of 4 - Core Features                                  │
│ Progress: ████████████░░░░░░░░ 62%                            │
│                                                                │
│ Active Agents:                                                 │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ 👷 Developer (x3)                                        │  │
│ │    - dev-1: Implementing Pet model        [████████░░]   │  │
│ │    - dev-2: Building User API             [██████████]   │  │
│ │    - dev-3: Creating Vet registration     [██████░░░░]   │  │
│ │                                                          │  │
│ │ 🧪 Tester (x2)                                           │  │
│ │    - test-1: Writing Pet unit tests       [████████░░]   │  │
│ │    - test-2: Writing User integration     [████░░░░░░]   │  │
│ │                                                          │  │
│ │ 🎓 Mentor                                                │  │
│ │    - Watching progress, available if needed              │  │
│ └──────────────────────────────────────────────────────────┘  │
│                                                                │
│ Recent Activity:                                               │
│ ├─ 14:32:01  dev-2 completed User API (+5 reward)             │
│ ├─ 14:31:45  test-1 found edge case in Pet validation         │
│ ├─ 14:31:12  dev-1 fixed date parsing issue                   │
│ └─ 14:30:58  Mentor: "Great progress! Keep it up!"            │
│                                                                │
│                                     [Pause]  [View Details]    │
└────────────────────────────────────────────────────────────────┘
```

---

## Self-Building Capability

Eklavya is designed to build itself. Here's the bootstrap process:

### Bootstrap Prompt
```
You are Eklavya, an autonomous agent orchestration platform.
Your task: Build yourself according to the EKLAVYA.md specification.

Phase 1: Foundation
- Create the project structure
- Set up the database schema
- Implement the core agent runtime

Phase 2: Agent Implementation
- Implement each agent type
- Create the reward/penalty system
- Build prompt versioning

Phase 3: Learning System
- Implement RL engine
- Create prompt evolution logic
- Build metrics tracking

Phase 4: Dashboard
- Create web interface
- Implement real-time monitoring
- Build improvement visualization

You have approval to proceed autonomously.
Report back when complete.
```

---

## Technical Specifications

### Database Schema

```sql
-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'planning',
  model_config JSONB NOT NULL,
  autonomy_level VARCHAR(20) DEFAULT 'standard',
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Agents
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  agent_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'idle',
  prompt_version_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  terminated_at TIMESTAMP
);

-- Prompt Versions
CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type VARCHAR(50) NOT NULL,
  version VARCHAR(20) NOT NULL,
  prompt TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'experimental',
  parent_version_id UUID REFERENCES prompt_versions(id),
  mutations JSONB,
  created_at TIMESTAMP DEFAULT NOW(),

  -- Metrics
  total_uses INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  total_reward DECIMAL DEFAULT 0
);

-- Reward Events
CREATE TABLE reward_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),
  project_id UUID REFERENCES projects(id),
  reward_value DECIMAL NOT NULL,
  reason VARCHAR(255),
  context JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Agent Actions
CREATE TABLE agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),
  action_type VARCHAR(100) NOT NULL,
  input JSONB,
  output JSONB,
  success BOOLEAN,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### API Endpoints

```
POST   /api/projects                 # Create new project
GET    /api/projects                 # List projects
GET    /api/projects/:id             # Get project details
POST   /api/projects/:id/approve     # Approve planning phase
POST   /api/projects/:id/pause       # Pause execution
POST   /api/projects/:id/resume      # Resume execution

GET    /api/agents                   # List all agents
GET    /api/agents/:id               # Get agent details
GET    /api/agents/:id/actions       # Get agent action history

GET    /api/prompts                  # List prompt versions
GET    /api/prompts/:agentType       # Get prompts for agent type
POST   /api/prompts/:id/promote      # Promote prompt version
POST   /api/prompts/:id/rollback     # Rollback prompt version

GET    /api/metrics/overview         # Dashboard overview
GET    /api/metrics/agent/:type      # Agent type metrics
GET    /api/metrics/learning-curves  # Learning curve data

WS     /ws/project/:id               # Real-time project updates
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Claude API key (or other AI provider)

### Installation

```bash
# Clone the repository
git clone https://github.com/ganeshpandey/eklavya.git
cd eklavya

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Run database migrations
npm run db:migrate

# Seed initial prompt versions
npm run db:seed

# Start the platform
npm run dev
```

### First Project

1. Open http://localhost:3000
2. Click "New Project"
3. Describe what you want to build
4. Select Claude Code as the model
5. Review and approve the plan
6. Watch Eklavya build your project!

---

## Philosophy

> *"The best teacher is not the one who gives answers, but the one who inspires the student to find their own."*

Eklavya embodies autonomous learning. Like its namesake who taught himself archery by observing from afar, this platform learns from every success and failure, continuously improving without constant hand-holding.

The Mentor Agent doesn't dictate - it suggests. The Reinforcement Learning system doesn't punish - it guides. The platform doesn't require approval for every step - it earns trust through results.

**Build once. Learn forever. Improve always.**

---

## License

MIT License - Use freely, improve continuously, share openly.

---

*Created with love for the art of autonomous systems.*
*Named in honor of the legendary self-taught warrior.*
