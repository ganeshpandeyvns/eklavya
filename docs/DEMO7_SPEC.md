# Demo₇: Demo System

## Overview

Demo₇ implements the demo management system that enables Eklavya to create, deploy, and manage interactive demos for client projects. This includes preview URL generation, admin approval workflows, client feedback recording, and scaffolding reuse tracking.

## Success Criteria

| Criteria | Description | Verification |
|----------|-------------|--------------|
| Demo Creation | Create demo instances for projects | API creates demo records |
| Preview URLs | Generate accessible preview URLs | URLs return valid content |
| Approval Workflow | Admin can approve/reject/request changes | State transitions work |
| Client Feedback | Record and track client feedback | Feedback persisted |
| Scaffolding Tracking | Track reusable code from demos | Reuse percentage calculated |
| Demo Verification | Automated verification before "ready" | Tester validates demos |

## Quality Thresholds

| Metric | Threshold |
|--------|-----------|
| Code Quality | ≥ 85% |
| Test Coverage | ≥ 55% |
| Requirements Coverage | ≥ 90% |
| Critical Issues | 0 |

## Technical Design

### 1. Demo Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   DRAFT     │ --> │  BUILDING   │ --> │   READY     │ --> │  APPROVED   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                              │                    │
                                              v                    v
                                        ┌─────────────┐     ┌─────────────┐
                                        │  REVISION   │     │  ARCHIVED   │
                                        │  REQUESTED  │     │             │
                                        └─────────────┘     └─────────────┘
```

### 2. Demo Types

```typescript
type DemoType = 'wow' | 'trust' | 'milestone' | 'final';

// Demo₀: "The Wow Demo" - Beautiful UI, clickable prototype
// Demo₁: "The Trust Demo" - Core feature works with real-ish data
// Demo₂+: Milestone demos - Progress checkpoints
// Final: Complete build demo

interface DemoConfig {
  type: DemoType;
  features: string[];           // What's included
  excludedFeatures: string[];   // What's NOT included (for later)
  scaffoldingPercent: number;   // Reusable code percentage
  estimatedTime: number;        // Minutes to build
  estimatedCost: number;        // USD cost estimate
}
```

### 3. Demo Instance

```typescript
type DemoStatus = 'draft' | 'building' | 'ready' | 'approved' | 'revision_requested' | 'archived';

interface Demo {
  id: string;
  projectId: string;

  // Demo info
  type: DemoType;
  version: number;              // Demo version (1, 2, 3...)
  name: string;                 // "Demo₀: The Wow Demo"
  description?: string;

  // Status
  status: DemoStatus;

  // Preview
  previewUrl?: string;          // http://localhost:3001/preview/abc123
  previewPort?: number;
  previewPid?: number;          // Process ID if running

  // Verification
  verifiedAt?: Date;
  verificationResult?: {
    passed: boolean;
    checks: VerificationCheck[];
    screenshots: string[];
  };

  // Content tracking
  config: DemoConfig;
  scaffolding: ScaffoldingInfo;

  // Timestamps
  createdAt: Date;
  builtAt?: Date;
  readyAt?: Date;
  approvedAt?: Date;
  archivedAt?: Date;
}

interface ScaffoldingInfo {
  totalFiles: number;
  reusableFiles: number;
  reusablePercent: number;
  components: string[];         // Reusable components created
  routes: string[];             // Routes that will persist
  styles: string[];             // Styles that will persist
}
```

### 4. Approval Workflow

```typescript
type ApprovalDecision = 'approve' | 'request_changes' | 'skip_to_build' | 'reject';

interface ApprovalRequest {
  id: string;
  demoId: string;
  projectId: string;

  // Request
  requestedAt: Date;
  requestedBy: string;          // 'system' or agent ID

  // Decision
  decision?: ApprovalDecision;
  decidedAt?: Date;
  decidedBy?: string;           // Admin identifier

  // Feedback
  comments?: string;
  changeRequests?: string[];

  // Next steps
  nextAction?: 'build_next_demo' | 'revise_demo' | 'proceed_to_build' | 'cancel';
}
```

### 5. Client Feedback

```typescript
type FeedbackSentiment = 'positive' | 'neutral' | 'negative';
type FeedbackCategory = 'feature' | 'design' | 'performance' | 'bug' | 'general';

interface ClientFeedback {
  id: string;
  demoId: string;
  projectId: string;

  // Feedback content
  sentiment: FeedbackSentiment;
  category: FeedbackCategory;
  content: string;

  // Context
  pageUrl?: string;             // Which page/screen
  elementId?: string;           // Specific element
  screenshot?: string;          // Screenshot if provided

  // Processing
  processedAt?: Date;
  actionTaken?: string;
  resolvedAt?: Date;

  createdAt: Date;
}
```

### 6. Verification System

```typescript
type CheckType = 'process' | 'url' | 'page' | 'flow' | 'responsive';
type CheckStatus = 'pending' | 'passed' | 'failed' | 'skipped';

interface VerificationCheck {
  type: CheckType;
  name: string;
  status: CheckStatus;
  details?: string;
  duration: number;             // ms
}

interface VerificationResult {
  demoId: string;
  passed: boolean;
  startedAt: Date;
  completedAt: Date;

  // Checks
  checks: VerificationCheck[];
  passedCount: number;
  failedCount: number;

  // Artifacts
  screenshots: string[];
  consoleErrors: string[];

  // Summary
  summary: string;
}
```

## Database Schema

### demos table

```sql
CREATE TABLE demos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Demo info
  type VARCHAR(20) NOT NULL DEFAULT 'milestone',
  version INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(200) NOT NULL,
  description TEXT,

  -- Status
  status VARCHAR(30) NOT NULL DEFAULT 'draft',

  -- Preview
  preview_url VARCHAR(500),
  preview_port INTEGER,
  preview_pid INTEGER,

  -- Verification
  verified_at TIMESTAMPTZ,
  verification_result JSONB,

  -- Config
  config JSONB DEFAULT '{}',
  scaffolding JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  built_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,

  UNIQUE(project_id, version)
);
```

### approval_requests table

```sql
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  demo_id UUID NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Request
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  requested_by VARCHAR(100) DEFAULT 'system',

  -- Decision
  decision VARCHAR(30),
  decided_at TIMESTAMPTZ,
  decided_by VARCHAR(100),

  -- Feedback
  comments TEXT,
  change_requests JSONB DEFAULT '[]',

  -- Next steps
  next_action VARCHAR(50)
);
```

### client_feedback table

```sql
CREATE TABLE client_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  demo_id UUID NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Feedback
  sentiment VARCHAR(20) NOT NULL DEFAULT 'neutral',
  category VARCHAR(30) NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,

  -- Context
  page_url VARCHAR(500),
  element_id VARCHAR(100),
  screenshot VARCHAR(500),

  -- Processing
  processed_at TIMESTAMPTZ,
  action_taken TEXT,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### demo_verifications table

```sql
CREATE TABLE demo_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  demo_id UUID NOT NULL REFERENCES demos(id) ON DELETE CASCADE,

  -- Result
  passed BOOLEAN NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,

  -- Details
  checks JSONB DEFAULT '[]',
  passed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,

  -- Artifacts
  screenshots JSONB DEFAULT '[]',
  console_errors JSONB DEFAULT '[]',

  summary TEXT
);
```

## API Endpoints

### Demo Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:projectId/demos` | List demos for project |
| GET | `/api/demos/:demoId` | Get demo details |
| POST | `/api/projects/:projectId/demos` | Create new demo |
| PUT | `/api/demos/:demoId` | Update demo |
| DELETE | `/api/demos/:demoId` | Delete demo |
| POST | `/api/demos/:demoId/build` | Start building demo |
| POST | `/api/demos/:demoId/verify` | Run verification |
| POST | `/api/demos/:demoId/start-preview` | Start preview server |
| POST | `/api/demos/:demoId/stop-preview` | Stop preview server |

### Approval Workflow

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/approvals/pending` | List pending approvals |
| GET | `/api/demos/:demoId/approval` | Get approval status |
| POST | `/api/demos/:demoId/request-approval` | Request admin approval |
| POST | `/api/demos/:demoId/approve` | Approve demo |
| POST | `/api/demos/:demoId/request-changes` | Request changes |
| POST | `/api/demos/:demoId/reject` | Reject demo |

### Client Feedback

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/demos/:demoId/feedback` | Get feedback for demo |
| POST | `/api/demos/:demoId/feedback` | Add feedback |
| PUT | `/api/feedback/:feedbackId` | Update feedback |
| POST | `/api/feedback/:feedbackId/resolve` | Mark resolved |

### Scaffolding

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:projectId/scaffolding` | Get scaffolding summary |
| GET | `/api/demos/:demoId/scaffolding` | Get demo scaffolding |

## Implementation Plan

### Phase 1: Demo Management (35% of effort)

1. Create database migration
2. Create `src/core/demos/index.ts` - Demo service
3. Implement demo CRUD operations
4. Implement demo status transitions
5. Preview URL generation

### Phase 2: Approval Workflow (25% of effort)

1. Create `src/core/demos/approval.ts` - Approval service
2. Implement approval request/decision flow
3. Status transition enforcement
4. Notification integration

### Phase 3: Verification System (20% of effort)

1. Create `src/core/demos/verification.ts` - Verification service
2. Implement verification checks
3. Screenshot capture
4. Result persistence

### Phase 4: Client Feedback & API (20% of effort)

1. Implement feedback recording
2. Create API endpoints
3. Integration with notifications
4. Scaffolding tracking

## Test Plan

### Unit Tests (14 tests)

1. Demo creation
2. Demo status transitions
3. Preview URL generation
4. Approval request creation
5. Approval decision processing
6. Feedback recording
7. Feedback resolution
8. Verification check execution
9. Verification result calculation
10. Scaffolding calculation
11. Demo archiving
12. Demo versioning
13. Change request tracking
14. Demo configuration

### Integration Tests (8 tests)

1. Full demo lifecycle
2. Approval workflow end-to-end
3. Verification pipeline
4. Feedback processing
5. Multi-demo project
6. Scaffolding accumulation
7. Preview server management
8. Notification integration

### E2E Tests (4 tests)

1. Create and approve demo
2. Request changes and revise
3. Client feedback flow
4. Demo to build transition

## Files to Create/Modify

### New Files

- `migrations/007_demo7_demos.sql` - Database schema
- `src/core/demos/index.ts` - Demo management service
- `src/core/demos/approval.ts` - Approval workflow
- `src/core/demos/verification.ts` - Verification system
- `src/core/demos/feedback.ts` - Client feedback
- `src/scripts/run-demo7-tester.ts` - Demo tester

### Modified Files

- `src/api/index.ts` - Add demo routes
- `src/core/notifications/index.ts` - Add demo notifications

## Demo Verification

```bash
# Run Demo₇ tests
npx tsx src/scripts/run-demo7-tester.ts

# Run architect review
npx tsx src/scripts/run-architect-review.ts 7
```

## Estimated Scope

| Component | Lines of Code |
|-----------|--------------|
| Demo Service | ~400 |
| Approval Workflow | ~250 |
| Verification | ~300 |
| Feedback | ~150 |
| API | ~350 |
| Migration | ~100 |
| Tests | ~500 |
| **Total** | **~2050** |
