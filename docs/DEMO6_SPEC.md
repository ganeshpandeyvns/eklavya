# Demo₆: Real-Time Portal

## Overview

Demo₆ enhances Eklavya's real-time capabilities with smart notifications, live activity streaming, and project progress monitoring. Building on the existing WebSocket infrastructure, this demo adds intelligent notification routing based on severity and user availability.

## Success Criteria

| Criteria | Description | Verification |
|----------|-------------|--------------|
| Real-time Status | Agent/task status updates via WebSocket | Subscribe and receive updates |
| Smart Notifications | 4-level notification system | Test each notification level |
| Live Activity Stream | Continuous activity feed | View activity in real-time |
| Project Progress | Real-time project progress | Monitor progress updates |
| Notification Preferences | User notification settings | Configure and verify routing |

## Quality Thresholds

| Metric | Threshold |
|--------|-----------|
| Code Quality | ≥ 80% |
| Test Coverage | ≥ 50% |
| Requirements Coverage | ≥ 85% |
| Critical Issues | 0 |

## Technical Design

### 1. Smart Notification System

```typescript
// Notification levels with escalation rules
type NotificationLevel = 'critical' | 'warning' | 'info' | 'silent';

interface NotificationConfig {
  level: NotificationLevel;
  channels: NotificationChannel[];
  conditions: NotificationCondition[];
}

// What triggers each level
const NotificationTriggers = {
  critical: [
    'build_failed',
    'budget_exceeded',
    'agent_crash',
    'security_alert',
  ],
  warning: [
    'demo_ready',
    'approval_needed',
    'budget_threshold_75',
    'test_failures',
  ],
  info: [
    'milestone_complete',
    'task_complete',
    'agent_spawned',
  ],
  silent: [
    'agent_progress',
    'file_change',
    'checkpoint_created',
  ],
};

// Delivery channels per level
const DeliveryChannels = {
  critical: ['sms', 'push', 'email', 'websocket'],
  warning: ['push', 'email', 'websocket'],
  info: ['push', 'websocket'],
  silent: ['websocket'], // Log only
};
```

### 2. User Availability Mode

```typescript
type AvailabilityMode = 'active' | 'busy' | 'away' | 'dnd';

interface AvailabilitySettings {
  mode: AvailabilityMode;
  escalationRules: {
    active: NotificationLevel[];   // All levels
    busy: NotificationLevel[];     // critical, warning
    away: NotificationLevel[];     // critical only
    dnd: NotificationLevel[];      // emergencies only
  };
  quietHours?: {
    start: string; // "22:00"
    end: string;   // "08:00"
    mode: AvailabilityMode;
  };
}
```

### 3. Live Activity Stream

```typescript
interface ActivityEvent {
  id: string;
  projectId: string;
  timestamp: Date;

  // Event source
  agentId?: string;
  agentType?: AgentType;

  // Event details
  eventType: ActivityEventType;
  action: string;
  details?: string;

  // Context
  taskId?: string;
  filePath?: string;

  // Notification
  notificationLevel: NotificationLevel;
}

type ActivityEventType =
  | 'agent_status'
  | 'task_progress'
  | 'file_change'
  | 'build_event'
  | 'test_result'
  | 'checkpoint'
  | 'error'
  | 'milestone';
```

### 4. Project Progress Streaming

```typescript
interface ProjectProgress {
  projectId: string;
  timestamp: Date;

  // Overall progress
  overallPercent: number;
  currentPhase: string;

  // Agent status summary
  agents: {
    total: number;
    active: number;
    idle: number;
    working: number;
  };

  // Task status summary
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  };

  // Budget tracking
  budget: {
    used: number;
    total: number;
    percentUsed: number;
  };

  // Time tracking
  elapsed: number; // ms
  estimatedRemaining?: number;
}
```

## Database Schema

### notifications table

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID, -- For future multi-user support

  -- Notification content
  level VARCHAR(20) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT,

  -- Context
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,

  -- Delivery tracking
  channels_sent TEXT[], -- ['websocket', 'push']
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### activity_stream table

```sql
CREATE TABLE activity_stream (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Event source
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  agent_type VARCHAR(50),

  -- Event details
  event_type VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  details TEXT,

  -- Context
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  file_path VARCHAR(500),

  -- Notification level
  notification_level VARCHAR(20) DEFAULT 'silent',

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### notification_settings table

```sql
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID, -- For future multi-user

  -- Availability
  availability_mode VARCHAR(20) DEFAULT 'active',

  -- Channel preferences
  email_enabled BOOLEAN DEFAULT true,
  push_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT false,

  -- Quiet hours
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  quiet_hours_mode VARCHAR(20) DEFAULT 'away',

  -- Level overrides
  level_overrides JSONB DEFAULT '{}',

  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## API Endpoints

### Notification Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | Get recent notifications |
| GET | `/api/notifications/unread` | Get unread count |
| POST | `/api/notifications/:id/read` | Mark as read |
| POST | `/api/notifications/:id/acknowledge` | Acknowledge notification |
| DELETE | `/api/notifications/:id` | Dismiss notification |

### Activity Stream Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:projectId/activity` | Get activity stream |
| GET | `/api/projects/:projectId/activity/live` | SSE activity stream |
| GET | `/api/activity/recent` | Get recent across all projects |

### Settings Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings/notifications` | Get notification settings |
| PUT | `/api/settings/notifications` | Update settings |
| PUT | `/api/settings/availability` | Update availability mode |

### Progress Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:projectId/progress` | Get current progress |
| GET | `/api/projects/:projectId/progress/live` | SSE progress stream |

## WebSocket Events

### Client → Server

```typescript
// Subscribe to project updates
{ type: 'subscribe', payload: { projectId: 'uuid', channels: ['activity', 'progress', 'notifications'] } }

// Update availability
{ type: 'set_availability', payload: { mode: 'busy' } }

// Acknowledge notification
{ type: 'ack_notification', payload: { notificationId: 'uuid' } }
```

### Server → Client

```typescript
// Activity event
{ type: 'activity:new', payload: { projectId, agentType, action, details, notificationLevel } }

// Progress update
{ type: 'progress:updated', payload: { projectId, overallPercent, agents, tasks, budget } }

// Notification
{ type: 'notification:new', payload: { id, level, title, message, eventType } }

// Agent status change
{ type: 'agent:updated', payload: { id, projectId, type, status, currentTask } }

// Task update
{ type: 'task:updated', payload: { id, projectId, title, status, progress } }
```

## Implementation Plan

### Phase 1: Notifications Module (35% of effort)

1. Create `src/core/notifications/index.ts` - Notification service
2. Implement notification level routing
3. Add notification persistence
4. Create notification triggers

### Phase 2: Activity Stream (25% of effort)

1. Create `src/core/activity/index.ts` - Activity service
2. Implement event tracking across agents
3. Add database triggers for automatic logging
4. Create SSE endpoint for live streaming

### Phase 3: Progress Tracking (20% of effort)

1. Create `src/core/progress/index.ts` - Progress service
2. Implement progress calculation
3. Add real-time progress broadcasting
4. Create progress API endpoints

### Phase 4: API & Integration (20% of effort)

1. Create `src/api/notifications.ts` - API endpoints
2. Enhance WebSocket service with new events
3. Add notification settings UI endpoints
4. Integration testing

## Test Plan

### Unit Tests (12 tests)

1. Notification level routing
2. Notification creation
3. Notification channel selection
4. Activity event creation
5. Activity stream filtering
6. Progress calculation
7. Availability mode filtering
8. Quiet hours detection
9. WebSocket notification broadcast
10. Notification acknowledgment
11. Activity event persistence
12. Progress aggregation

### Integration Tests (8 tests)

1. End-to-end notification flow
2. WebSocket notification delivery
3. Activity stream real-time updates
4. Progress calculation accuracy
5. Notification settings persistence
6. Multi-project activity isolation
7. Notification level escalation
8. Availability mode enforcement

### E2E Tests (4 tests)

1. Real-time dashboard updates
2. Notification delivery and acknowledgment
3. Activity stream streaming
4. Progress monitoring

## Files to Create/Modify

### New Files

- `migrations/006_demo6_realtime.sql` - Database schema
- `src/core/notifications/index.ts` - Notification service
- `src/core/activity/index.ts` - Activity stream service
- `src/core/progress/index.ts` - Progress tracking service
- `src/api/notifications.ts` - Notification API
- `src/scripts/run-demo6-tester.ts` - Demo tester

### Modified Files

- `src/services/websocket.ts` - Add new events
- `src/api/index.ts` - Add notification routes

## Demo Verification

```bash
# Run Demo₆ tests
npx tsx src/scripts/run-demo6-tester.ts

# Run architect review
npx tsx src/scripts/post-demo-review.ts 6
```

## Estimated Scope

| Component | Lines of Code |
|-----------|--------------|
| Notifications | ~350 |
| Activity Stream | ~250 |
| Progress Tracking | ~200 |
| API | ~300 |
| Migration | ~100 |
| Tests | ~400 |
| **Total** | **~1600** |
