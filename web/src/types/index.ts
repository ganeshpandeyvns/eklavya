export type ProjectStatus =
  | "planning"
  | "demo_building"
  | "demo_ready"
  | "building"
  | "completed"
  | "paused";

export type NotificationLevel = "critical" | "needs_input" | "info" | "silent";

export type AgentType =
  | "orchestrator"
  | "architect"
  | "developer"
  | "tester"
  | "qa"
  | "pm"
  | "uat"
  | "sre"
  | "monitor"
  | "mentor";

export type AgentStatus = "idle" | "working" | "blocked" | "completed";

export interface Project {
  id: string;
  name: string;
  clientName: string;
  description: string;
  status: ProjectStatus;
  progress: number;
  currentPhase: string;
  budgetLimit: number;
  budgetSpent: number;
  createdAt: Date;
  updatedAt: Date;
  demoNumber: number;
  estimatedCompletion?: string;
}

export interface Agent {
  id: string;
  projectId: string;
  type: AgentType;
  status: AgentStatus;
  currentTask?: string;
  progress?: number;
  lastActivity: Date;
}

export interface Notification {
  id: string;
  projectId?: string;
  level: NotificationLevel;
  title: string;
  message: string;
  createdAt: Date;
  read: boolean;
}

export interface ActivityItem {
  id: string;
  projectId: string;
  agentType: AgentType;
  action: string;
  details?: string;
  timestamp: Date;
}

export interface DashboardStats {
  activeProjects: number;
  activeAgents: number;
  demosWaitingReview: number;
  todaySpend: number;
}
