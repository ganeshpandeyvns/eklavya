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

  // Cost Tracking
  async getProjectCosts(projectId: string): Promise<CostSummary> {
    return this.fetch(`/api/projects/${projectId}/costs`);
  }

  async getProjectBudget(projectId: string): Promise<BudgetStatus> {
    return this.fetch(`/api/projects/${projectId}/budget`);
  }

  async updateProjectBudget(projectId: string, budget: number): Promise<BudgetStatus> {
    return this.fetch(`/api/projects/${projectId}/budget`, {
      method: 'PUT',
      body: JSON.stringify({ budget }),
    });
  }

  async getCostOverview(): Promise<{ projects: CostOverviewItem[] }> {
    return this.fetch('/api/costs/overview');
  }

  async getBudgetAlerts(projectId?: string): Promise<{ alerts: BudgetAlert[] }> {
    const params = projectId ? `?projectId=${projectId}` : '';
    return this.fetch(`/api/costs/alerts${params}`);
  }

  async getModelPricing(): Promise<{ models: ModelPricing[] }> {
    return this.fetch('/api/costs/pricing');
  }

  // Learning Metrics
  async getLearningMetrics(): Promise<AggregateLearningMetrics> {
    return this.fetch('/api/learning/metrics');
  }

  async getPromptPerformance(promptId: string): Promise<PromptPerformance> {
    return this.fetch(`/api/learning/prompts/${promptId}`);
  }

  async getPromptComparison(agentType: string): Promise<ComparisonReport> {
    return this.fetch(`/api/learning/comparison/${agentType}`);
  }

  async getAllPromptComparisons(): Promise<{ comparisons: Record<string, ComparisonReport> }> {
    return this.fetch('/api/learning/comparisons');
  }

  async listExperiments(status?: string): Promise<{ experiments: Experiment[] }> {
    const params = status ? `?status=${status}` : '';
    return this.fetch(`/api/learning/experiments${params}`);
  }

  async createExperiment(config: ExperimentConfig): Promise<Experiment> {
    return this.fetch('/api/learning/experiments', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async getExperimentResults(experimentId: string): Promise<ExperimentResults> {
    return this.fetch(`/api/learning/experiments/${experimentId}`);
  }

  async stopExperiment(experimentId: string): Promise<{ success: boolean }> {
    return this.fetch(`/api/learning/experiments/${experimentId}/stop`, {
      method: 'POST',
    });
  }
}

// Cost Tracking Types
export interface CostSummary {
  totalCost: number;
  tokenCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  apiCalls: number;
  budgetLimit: number;
  budgetRemaining: number;
  budgetPercent: number;
  byModel: Record<string, number>;
  byDay: Record<string, number>;
  byAgent: Record<string, number>;
}

export interface BudgetStatus {
  withinBudget: boolean;
  currentSpend: number;
  budgetLimit: number;
  percentUsed: number;
  remaining: number;
  status: 'healthy' | 'caution' | 'warning' | 'critical' | 'exceeded';
}

export interface CostOverviewItem {
  projectId: string;
  projectName: string;
  totalCost: number;
  totalTokens: number;
  budgetLimit: number;
  budgetPercent: number;
  apiCalls: number;
  todayCost: number;
}

export interface BudgetAlert {
  id: string;
  projectId: string;
  projectName: string;
  thresholdPercent: number;
  currentSpend: number;
  budgetLimit: number;
  createdAt: string;
}

export interface ModelPricing {
  model: string;
  provider: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  cachedInputPricePer1k?: number;
  cachedOutputPricePer1k?: number;
}

// Learning Metrics Types
export interface AggregateLearningMetrics {
  totalPrompts: number;
  totalExperiments: number;
  activeExperiments: number;
  avgSuccessRate: number;
  avgThompsonScore: number;
  byAgentType: Record<string, {
    promptCount: number;
    avgSuccessRate: number;
    productionVersion?: number;
  }>;
}

export interface PromptPerformance {
  promptId: string;
  agentType: string;
  version: number;
  status: string;
  totalUses: number;
  successfulUses: number;
  successRate: number;
  averageReward: number;
  confidenceInterval: [number, number];
  thompsonScore: number;
  recentTrend: 'improving' | 'stable' | 'declining';
  lastUsed?: string;
  avgCompletionTimeMs?: number;
}

export interface ComparisonReport {
  agentType: string;
  totalPrompts: number;
  productionPrompt?: PromptPerformance;
  candidatePrompts: PromptPerformance[];
  experimentalPrompts: PromptPerformance[];
  bestPerformer: PromptPerformance | null;
  recommendations: string[];
}

export interface Experiment {
  id: string;
  name: string;
  description?: string;
  agentType: string;
  controlPromptId: string;
  treatmentPromptId: string;
  trafficSplit: number;
  minSampleSize: number;
  maxDurationDays?: number;
  successMetric: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ExperimentConfig {
  name: string;
  description?: string;
  agentType: string;
  controlPromptId: string;
  treatmentPromptId: string;
  trafficSplit?: number;
  minSampleSize?: number;
  maxDurationDays?: number;
  successMetric?: 'success_rate' | 'avg_reward' | 'completion_time';
}

export interface ExperimentResults {
  experiment: Experiment;
  control: {
    promptId: string;
    samples: number;
    successRate: number;
    avgReward: number;
    avgCompletionTimeMs?: number;
  };
  treatment: {
    promptId: string;
    samples: number;
    successRate: number;
    avgReward: number;
    avgCompletionTimeMs?: number;
  };
  analysis: {
    winner: 'control' | 'treatment' | 'none';
    confidence: number;
    improvement: number;
    statSignificant: boolean;
    recommendation: string;
  };
}

export const api = new ApiClient();
