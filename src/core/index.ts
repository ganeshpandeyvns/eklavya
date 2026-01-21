/**
 * Eklavya Core Module Exports
 *
 * Central export point for all core services and agents.
 * This provides a clean API for consumers to import from.
 */

// Agent Manager
export {
  AgentManager,
  createAgentManager,
  type AgentManagerOptions,
  type SpawnAgentOptions,
  type AgentOutcome,
  type RLAgent,
} from './agent-manager/index.js';

// Message Bus
export {
  MessageBus,
  createMessageBus,
  type MessageBusOptions,
} from './message-bus/index.js';

// Learning System (RL)
export {
  LearningSystem,
  getLearningSystem,
  type LearningSystemOptions,
} from './learning/index.js';

// Task Queue
export {
  TaskQueue,
  createTaskQueue,
  type TaskQueueOptions,
  type TaskCreateParams,
  type QueuedTask,
} from './task-queue/index.js';

// Checkpoint System
export {
  CheckpointManager,
  getCheckpointManager,
  type CheckpointOptions,
  type AgentState,
  type FileState,
} from './checkpoint/index.js';

// Orchestrator
export {
  Orchestrator,
  createOrchestrator,
  type OrchestratorOptions,
  type ParallelExecutionPlan,
} from './orchestrator/index.js';

// Coordination
export {
  AgentCoordinator,
  createCoordinator,
  type CoordinatorOptions,
} from './coordination/index.js';

// Notifications
export {
  NotificationService,
  getNotificationService,
  NotificationLevel,
  type NotificationSettings,
} from './notifications/index.js';

// Activity Tracking
export {
  ActivityService,
  getActivityService,
  ActivityEventType,
  type ActivityEvent,
} from './activity/index.js';

// Progress Tracking
export {
  ProgressService,
  getProgressService,
  createProgressService,
} from './progress/index.js';

// Demos
export {
  DemoService,
  getDemoService,
  DemoType,
  DemoStatus,
} from './demos/index.js';

export {
  ApprovalService,
  getApprovalService,
  ApprovalDecision,
} from './demos/approval.js';

export {
  VerificationService,
  getVerificationService,
  type VerificationResult,
} from './demos/verification.js';

export {
  FeedbackService,
  getFeedbackService,
  FeedbackSentiment,
  FeedbackCategory,
} from './demos/feedback.js';

// Self-Build
export {
  ExecutionPlanGenerator,
  createPlanGenerator,
} from './self-build/planner.js';

// Architect Agent
export {
  ArchitectAgent,
  createArchitectAgent,
  runArchitectReview,
  DEFAULT_SUCCESS_CRITERIA,
  type ArchitectReviewConfig,
  type ArchitectSuccessCriteria,
  type ArchitectReviewResult,
} from './architect-agent/index.js';

// Tester Agent
export {
  TesterAgent,
  createTesterAgent,
  BugSeverity,
  type Bug,
  type TestResult,
  type TestSuite,
  type TesterAgentOptions,
} from './tester-agent/index.js';

// QA Agent
export {
  QAAgent,
  createQAAgent,
  runQuickQA,
  QAIssueSeverity,
  QAIssueType,
  type QAAgentOptions,
  type E2EConfig,
  type UserFlow,
  type UserFlowStep,
  type QAIssue,
  type E2ETestResult,
  type TestResults,
  type VisualResults,
  type VisualDiff,
  type FlowResult,
  type QAReport,
} from './qa-agent/index.js';

// Mentor Agent
export {
  MentorAgent,
  createMentorAgent,
  getMentorGuidance,
  BlockedCategory,
  IssueSeverity,
  GuidanceType,
  type MentorAgentOptions,
  type BlockedIssue,
  type Guidance,
  type KnowledgeEntry,
  type KnowledgeResult,
  type CodeContext,
  type Suggestion,
  type CriticalIssue,
} from './mentor-agent/index.js';

// Monitor Agent
export {
  MonitorAgent,
  createMonitorAgent,
  quickHealthCheck,
  HealthLevel,
  AlertLevel,
  AlertType,
  type MonitorAgentOptions,
  type AgentHealthStatus,
  type ResourceMetrics,
  type Anomaly,
  type Alert,
  type HealthReport,
  type AlertThresholds,
} from './monitor-agent/index.js';
