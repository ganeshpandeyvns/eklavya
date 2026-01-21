"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Clock,
  DollarSign,
  CheckCircle,
  AlertCircle,
  Play,
  Pause,
  RefreshCw,
  ChevronRight,
  Activity,
  Eye,
  ThumbsUp,
  Loader2,
} from "lucide-react";
import { cn, formatCurrency, formatRelativeTime } from "@/lib/utils";
import type { AgentType, AgentStatus } from "@/types";

// API response types
interface ApiProject {
  id: string;
  name: string;
  description?: string;
  status: string;
  tokens_used?: number;
  cost_used?: number;
  budget_cost_usd?: number;
  created_at: string;
  updated_at?: string;
}

interface ApiAgent {
  id: string;
  project_id: string;
  type: string;
  status: string;
  current_task_id?: string;
  last_heartbeat?: string;
  metrics?: {
    tasks_completed: number;
    tasks_failed: number;
    tokens_used: number;
  };
}

interface ApiTask {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  status: string;
  assigned_agent_id?: string;
  created_at: string;
  completed_at?: string;
}

interface CostSummary {
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

interface BudgetStatus {
  withinBudget: boolean;
  currentSpend: number;
  budgetLimit: number;
  percentUsed: number;
  remaining: number;
  status: "healthy" | "caution" | "warning" | "critical" | "exceeded";
}

interface ActivityItem {
  id: string;
  projectId: string;
  agentType: string;
  action: string;
  details?: string;
  timestamp: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const agentTypeColors: Record<string, { bg: string; text: string }> = {
  orchestrator: { bg: "bg-purple-100", text: "text-purple-700" },
  architect: { bg: "bg-blue-100", text: "text-blue-700" },
  developer: { bg: "bg-green-100", text: "text-green-700" },
  tester: { bg: "bg-orange-100", text: "text-orange-700" },
  qa: { bg: "bg-yellow-100", text: "text-yellow-700" },
  pm: { bg: "bg-pink-100", text: "text-pink-700" },
  uat: { bg: "bg-indigo-100", text: "text-indigo-700" },
  sre: { bg: "bg-red-100", text: "text-red-700" },
  monitor: { bg: "bg-cyan-100", text: "text-cyan-700" },
  mentor: { bg: "bg-emerald-100", text: "text-emerald-700" },
};

const statusColors: Record<string, { bg: string; text: string }> = {
  idle: { bg: "bg-gray-100", text: "text-gray-700" },
  working: { bg: "bg-blue-100", text: "text-blue-700" },
  blocked: { bg: "bg-yellow-100", text: "text-yellow-700" },
  completed: { bg: "bg-green-100", text: "text-green-700" },
  failed: { bg: "bg-red-100", text: "text-red-700" },
  terminated: { bg: "bg-gray-100", text: "text-gray-500" },
};

const budgetStatusColors: Record<string, string> = {
  healthy: "bg-green-500",
  caution: "bg-yellow-500",
  warning: "bg-orange-500",
  critical: "bg-red-500",
  exceeded: "bg-red-700",
};

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.id;

  const [project, setProject] = useState<ApiProject | null>(null);
  const [agents, setAgents] = useState<ApiAgent[]>([]);
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);

        const [projectRes, agentsRes, tasksRes, costsRes, budgetRes, activityRes] =
          await Promise.all([
            fetch(`${API_BASE}/api/projects/${projectId}`),
            fetch(`${API_BASE}/api/projects/${projectId}/agents`),
            fetch(`${API_BASE}/api/projects/${projectId}/tasks`),
            fetch(`${API_BASE}/api/projects/${projectId}/costs`),
            fetch(`${API_BASE}/api/projects/${projectId}/budget`),
            fetch(`${API_BASE}/api/projects/${projectId}/activity`),
          ]);

        if (!projectRes.ok) {
          throw new Error("Project not found");
        }

        const [projectData, agentsData, tasksData, costsData, budgetData, activityData] =
          await Promise.all([
            projectRes.json(),
            agentsRes.ok ? agentsRes.json() : [],
            tasksRes.ok ? tasksRes.json() : [],
            costsRes.ok ? costsRes.json() : null,
            budgetRes.ok ? budgetRes.json() : null,
            activityRes.ok ? activityRes.json() : [],
          ]);

        setProject(projectData);
        setAgents(agentsData);
        setTasks(tasksData);
        setCosts(costsData);
        setBudget(budgetData);
        setActivities(activityData);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to load project"));
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-8">
        <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-red-700 mb-2">
            {error?.message || "Project not found"}
          </h2>
          <Link href="/projects" className="text-blue-600 hover:underline">
            Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  const activeAgents = agents.filter(
    (a) => a.status === "working" || a.status === "idle"
  );
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const pendingTasks = tasks.filter(
    (t) => t.status === "pending" || t.status === "in_progress"
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/projects"
          className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="hidden sm:inline">Back</span>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              {project.name}
            </h1>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                project.status === "completed"
                  ? "bg-green-100 text-green-700"
                  : project.status === "demo_ready"
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-blue-100 text-blue-700"
              )}
            >
              {project.status.replace(/_/g, " ")}
            </span>
          </div>
          {project.description && (
            <p className="text-sm text-gray-500 mt-1">{project.description}</p>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50">
              <Bot className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Active Agents</p>
              <p className="text-xl font-bold text-gray-900">{activeAgents.length}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Tasks Done</p>
              <p className="text-xl font-bold text-gray-900">
                {completedTasks.length}/{tasks.length}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Activity className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Total Tokens</p>
              <p className="text-xl font-bold text-gray-900">
                {costs ? (costs.totalTokens / 1000).toFixed(1) + "k" : "0"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <DollarSign className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Total Cost</p>
              <p className="text-xl font-bold text-gray-900">
                {costs ? formatCurrency(costs.totalCost) : "$0.00"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Budget Progress */}
      {budget && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Budget</h2>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                budget.status === "healthy"
                  ? "bg-green-100 text-green-700"
                  : budget.status === "caution"
                  ? "bg-yellow-100 text-yellow-700"
                  : budget.status === "warning"
                  ? "bg-orange-100 text-orange-700"
                  : "bg-red-100 text-red-700"
              )}
            >
              {budget.status}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">
                {formatCurrency(budget.currentSpend)} spent
              </span>
              <span className="text-gray-500">
                {formatCurrency(budget.remaining)} remaining
              </span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  budgetStatusColors[budget.status]
                )}
                style={{ width: `${Math.min(100, budget.percentUsed)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>0%</span>
              <span>{budget.percentUsed.toFixed(1)}% used</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agents Section */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Agents</h2>
              <span className="text-sm text-gray-500">{agents.length} total</span>
            </div>

            {agents.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No agents spawned yet</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {agents.map((agent) => {
                  const typeColor = agentTypeColors[agent.type] || {
                    bg: "bg-gray-100",
                    text: "text-gray-700",
                  };
                  const statusColor = statusColors[agent.status] || {
                    bg: "bg-gray-100",
                    text: "text-gray-700",
                  };

                  return (
                    <div
                      key={agent.id}
                      className="rounded-lg border border-gray-100 bg-gray-50 p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-medium",
                            typeColor.bg,
                            typeColor.text
                          )}
                        >
                          {agent.type}
                        </span>
                        <span
                          className={cn(
                            "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            statusColor.bg,
                            statusColor.text
                          )}
                        >
                          {agent.status === "working" && (
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                          )}
                          {agent.status}
                        </span>
                      </div>
                      {agent.metrics && (
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>{agent.metrics.tasks_completed} completed</span>
                          <span>{(agent.metrics.tokens_used / 1000).toFixed(1)}k tokens</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tasks Section */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Tasks</h2>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-green-600">{completedTasks.length} done</span>
                <span className="text-gray-300">|</span>
                <span className="text-blue-600">{pendingTasks.length} pending</span>
              </div>
            </div>

            {tasks.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No tasks created yet</p>
            ) : (
              <div className="space-y-3">
                {tasks.slice(0, 10).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-4 p-3 rounded-lg border border-gray-100 bg-gray-50"
                  >
                    {task.status === "completed" ? (
                      <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    ) : task.status === "in_progress" ? (
                      <Loader2 className="h-5 w-5 text-blue-500 animate-spin flex-shrink-0" />
                    ) : task.status === "failed" ? (
                      <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                    ) : (
                      <Clock className="h-5 w-5 text-gray-400 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-xs text-gray-500 truncate">
                          {task.description}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        task.status === "completed"
                          ? "bg-green-100 text-green-700"
                          : task.status === "in_progress"
                          ? "bg-blue-100 text-blue-700"
                          : task.status === "failed"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-700"
                      )}
                    >
                      {task.status.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
                {tasks.length > 10 && (
                  <p className="text-sm text-gray-500 text-center pt-2">
                    + {tasks.length - 10} more tasks
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Demo Section */}
          {project.status === "demo_ready" && (
            <div className="rounded-xl border-2 border-yellow-200 bg-yellow-50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Eye className="h-5 w-5 text-yellow-600" />
                <h2 className="text-lg font-semibold text-yellow-800">
                  Demo Ready
                </h2>
              </div>
              <p className="text-sm text-yellow-700 mb-4">
                The demo is ready for your review. Check the preview and approve
                when satisfied.
              </p>
              <div className="flex flex-col gap-2">
                <button className="flex items-center justify-center gap-2 rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 transition-colors">
                  <Play className="h-4 w-4" />
                  Preview Demo
                </button>
                <button className="flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors">
                  <ThumbsUp className="h-4 w-4" />
                  Approve
                </button>
              </div>
            </div>
          )}

          {/* Activity Timeline */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Recent Activity
            </h2>

            {activities.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No activity yet</p>
            ) : (
              <div className="space-y-4">
                {activities.slice(0, 8).map((activity, index) => {
                  const typeColor = agentTypeColors[activity.agentType] || {
                    bg: "bg-gray-100",
                    text: "text-gray-700",
                  };

                  return (
                    <div key={activity.id} className="flex gap-3">
                      <div className="relative flex flex-col items-center">
                        <div
                          className={cn(
                            "h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium",
                            typeColor.bg,
                            typeColor.text
                          )}
                        >
                          {activity.agentType.charAt(0).toUpperCase()}
                        </div>
                        {index < activities.length - 1 && (
                          <div className="flex-1 w-px bg-gray-200 mt-2" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pb-4">
                        <p className="text-sm text-gray-900">{activity.action}</p>
                        {activity.details && (
                          <p className="text-xs text-gray-500 truncate">
                            {activity.details}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {formatRelativeTime(new Date(activity.timestamp))}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cost Breakdown */}
          {costs && costs.byModel && Object.keys(costs.byModel).length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Cost by Model
              </h2>
              <div className="space-y-3">
                {Object.entries(costs.byModel).map(([model, cost]) => (
                  <div
                    key={model}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-600 truncate">{model}</span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(cost)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
