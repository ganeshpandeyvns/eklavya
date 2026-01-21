const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  tokens_used: number;
  cost_used: number;
  created_at: string;
}

export interface Agent {
  id: string;
  project_id: string;
  type: string;
  status: string;
  current_task_id?: string;
  last_heartbeat?: string;
  metrics: {
    tasks_completed: number;
    tasks_failed: number;
    tokens_used: number;
  };
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  status: string;
  assigned_agent_id?: string;
  created_at: string;
}

export interface Message {
  id: string;
  project_id: string;
  type: string;
  from_agent_id?: string;
  to_agent_id?: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface DashboardStats {
  activeProjects: number;
  activeAgents: number;
  demosWaitingReview: number;
  todaySpend: number;
  totalTasks: number;
  completedTasks: number;
  totalBugs: number;
  openBugs: number;
}

export interface ActivityItem {
  id: string;
  projectId: string;
  agentType: string;
  agentId?: string;
  action: string;
  details?: string;
  timestamp: string;
}

export interface AgentStats {
  id: string;
  type: string;
  status: string;
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed: number;
  avgReward: number;
  totalOutcomes: number;
  successRate: number;
  thompsonScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveAgent {
  id: string;
  type: string;
  status: string;
  currentTask: string | null;
  progress: number;
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed: number;
  isHealthy: boolean;
  lastActivity: string;
}

export interface PromptVersion {
  id: string;
  version: number;
  status: string;
  alpha: number;
  beta: number;
  thompsonScore: number;
  totalUses: number;
  successfulUses: number;
  successRate: number;
  createdAt: string;
}

export interface PromptStats {
  agentType: string;
  totalVersions: number;
  totalUses: number;
  avgThompsonScore: number;
  productionVersion: number | null;
  versions: PromptVersion[];
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }

    return res.json();
  }

  // Projects
  async getProjects(): Promise<Project[]> {
    return this.fetch('/api/projects');
  }

  async getProject(id: string): Promise<Project> {
    return this.fetch(`/api/projects/${id}`);
  }

  async createProject(data: { name: string; description?: string }): Promise<Project> {
    return this.fetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Agents
  async getAgents(projectId: string): Promise<Agent[]> {
    return this.fetch(`/api/projects/${projectId}/agents`);
  }

  async getAgent(id: string): Promise<Agent> {
    return this.fetch(`/api/agents/${id}`);
  }

  async spawnAgent(projectId: string, type: string): Promise<Agent> {
    return this.fetch(`/api/projects/${projectId}/agents`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    });
  }

  async terminateAgent(id: string): Promise<void> {
    await this.fetch(`/api/agents/${id}`, { method: 'DELETE' });
  }

  // Tasks
  async getTasks(projectId: string): Promise<Task[]> {
    return this.fetch(`/api/projects/${projectId}/tasks`);
  }

  async createTask(projectId: string, data: { title: string; description?: string }): Promise<Task> {
    return this.fetch(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Messages
  async getMessages(projectId: string): Promise<Message[]> {
    return this.fetch(`/api/projects/${projectId}/messages`);
  }

  // Health
  async health(): Promise<{ status: string }> {
    return this.fetch('/api/health');
  }

  // Dashboard
  async getDashboardStats(): Promise<DashboardStats> {
    return this.fetch('/api/dashboard/stats');
  }

  async getProjectActivity(projectId: string): Promise<ActivityItem[]> {
    return this.fetch(`/api/projects/${projectId}/activity`);
  }

  async getAgentStats(agentId: string): Promise<AgentStats> {
    return this.fetch(`/api/agents/${agentId}/stats`);
  }

  async getLiveAgents(projectId: string): Promise<LiveAgent[]> {
    return this.fetch(`/api/projects/${projectId}/agents/live`);
  }

  async getPromptStats(agentType: string): Promise<PromptStats> {
    return this.fetch(`/api/prompts/${agentType}/stats`);
  }

  async getProjectTimeline(projectId: string): Promise<{
    project: { id: string; name: string; status: string; startedAt: string; lastActivity: string };
    tasks: Array<{ id: string; title: string; status: string; createdAt: string; startedAt?: string; completedAt?: string; duration?: number }>;
    agents: Array<{ id: string; type: string; status: string; spawnedAt: string; lastActivity: string }>;
    stats: { totalTasks: number; completedTasks: number; totalAgents: number; activeAgents: number };
  }> {
    return this.fetch(`/api/projects/${projectId}/timeline`);
  }
}

export const api = new ApiClient();
