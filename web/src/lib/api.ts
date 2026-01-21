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
}

export const api = new ApiClient();
