import { z } from 'zod';

// Agent Types
export const AgentTypeEnum = z.enum([
  'orchestrator', 'architect', 'developer', 'tester',
  'qa', 'pm', 'uat', 'sre', 'monitor', 'mentor'
]);
export type AgentType = z.infer<typeof AgentTypeEnum>;

export const AgentStatusEnum = z.enum([
  'initializing', 'idle', 'working', 'blocked', 'completed', 'failed', 'terminated'
]);
export type AgentStatus = z.infer<typeof AgentStatusEnum>;

// Task Types
export const TaskStatusEnum = z.enum([
  'pending', 'assigned', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled'
]);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

// Message Types
export const MessageTypeEnum = z.enum([
  'task_assign', 'task_complete', 'task_failed', 'task_blocked',
  'status_update', 'checkpoint', 'mentor_suggestion', 'broadcast'
]);
export type MessageType = z.infer<typeof MessageTypeEnum>;

// Prompt Status
export const PromptStatusEnum = z.enum([
  'experimental', 'candidate', 'production', 'deprecated'
]);
export type PromptStatus = z.infer<typeof PromptStatusEnum>;

// Schemas
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.string().default('active'),
  config: z.record(z.unknown()).default({}),
  budgetTokens: z.number().default(1000000),
  budgetTimeHours: z.number().default(24),
  budgetCostUsd: z.number().default(100),
  tokensUsed: z.number().default(0),
  costUsed: z.number().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const AgentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: AgentTypeEnum,
  status: AgentStatusEnum,
  pid: z.number().optional(),
  workingDirectory: z.string().optional(),
  currentTaskId: z.string().uuid().optional(),
  lastHeartbeat: z.date().optional(),
  checkpointData: z.record(z.unknown()).optional(),
  metrics: z.object({
    tasksCompleted: z.number().default(0),
    tasksFailed: z.number().default(0),
    tokensUsed: z.number().default(0),
  }).default({ tasksCompleted: 0, tasksFailed: 0, tokensUsed: 0 }),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  parentTaskId: z.string().uuid().optional(),
  assignedAgentId: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  type: z.string().optional(),
  status: TaskStatusEnum,
  priority: z.number().min(1).max(10).default(5),
  acceptanceCriteria: z.array(z.string()).default([]),
  result: z.record(z.unknown()).optional(),
  errorMessage: z.string().optional(),
  retryCount: z.number().default(0),
  maxRetries: z.number().default(3),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Task = z.infer<typeof TaskSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  fromAgentId: z.string().uuid().optional(),
  toAgentId: z.string().uuid().optional(),
  type: MessageTypeEnum,
  channel: z.string().optional(),
  payload: z.record(z.unknown()),
  processed: z.boolean().default(false),
  processedAt: z.date().optional(),
  createdAt: z.date(),
});
export type Message = z.infer<typeof MessageSchema>;

export const PromptSchema = z.object({
  id: z.string().uuid(),
  agentType: AgentTypeEnum,
  version: z.number(),
  status: PromptStatusEnum,
  content: z.string(),
  variables: z.array(z.string()).default([]),
  alpha: z.number().default(1),
  beta: z.number().default(1),
  totalUses: z.number().default(0),
  successfulUses: z.number().default(0),
  avgTaskCompletionTime: z.number().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Prompt = z.infer<typeof PromptSchema>;

export const CheckpointSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  state: z.record(z.unknown()),
  fileState: z.record(z.unknown()).optional(),
  conversationSummary: z.string().optional(),
  recoveryInstructions: z.string().optional(),
  createdAt: z.date(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

// Learning Event for RL
export const LearningEventSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  promptId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  eventType: z.string(),
  reward: z.number().min(-1).max(1).optional(),
  context: z.record(z.unknown()).optional(),
  outcome: z.record(z.unknown()).optional(),
  createdAt: z.date(),
});
export type LearningEvent = z.infer<typeof LearningEventSchema>;

// Config types
export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

export interface EklavyaConfig {
  database: DatabaseConfig;
  redis: RedisConfig;
  defaultModel: string;
  maxConcurrentAgents: number;
  checkpointIntervalMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
}
