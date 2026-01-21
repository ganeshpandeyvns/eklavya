"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Upload, ArrowRight, Wifi, WifiOff, Loader2 } from "lucide-react";
import { WelcomeMessage } from "@/components/dashboard/WelcomeMessage";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { ProjectCard } from "@/components/dashboard/ProjectCard";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { AgentGrid } from "@/components/dashboard/AgentGrid";
import { useDashboardStats, useProjects, useProjectActivity, useLiveAgents, ActivityItem as ApiActivityItem, LiveAgent } from "@/hooks/useApi";
import { useWebSocket, useAgentUpdates, useActivityUpdates } from "@/hooks/useWebSocket";
import type { Project, Agent, ActivityItem, DashboardStats } from "@/types";

// API project response type
interface ApiProject {
  id: string;
  name: string;
  description?: string;
  status: string;
  tokens_used?: number;
  cost_used?: number;
  created_at: string;
  updated_at?: string;
}

// Transform API project to frontend Project type
function transformProject(apiProject: ApiProject): Project {
  return {
    id: apiProject.id,
    name: apiProject.name,
    clientName: "Client",
    description: apiProject.description || "",
    status: (apiProject.status as Project["status"]) || "planning",
    progress: 0,
    currentPhase: "development",
    budgetLimit: 100,
    budgetSpent: apiProject.cost_used || 0,
    createdAt: new Date(apiProject.created_at),
    updatedAt: apiProject.updated_at ? new Date(apiProject.updated_at) : new Date(apiProject.created_at),
    demoNumber: 0,
  };
}

// Transform LiveAgent to frontend Agent type
function transformLiveAgent(liveAgent: LiveAgent): Agent {
  return {
    id: liveAgent.id,
    projectId: "",
    type: liveAgent.type as Agent["type"],
    status: (liveAgent.status as Agent["status"]) || "idle",
    currentTask: liveAgent.currentTask || undefined,
    progress: liveAgent.progress || 0,
    lastActivity: liveAgent.lastActivity ? new Date(liveAgent.lastActivity) : new Date(),
  };
}

// Transform API agent update to frontend Agent type
function transformAgentUpdate(update: {
  id: string;
  projectId: string;
  type: string;
  status: string;
  currentTask?: string;
  progress?: number;
}): Agent {
  return {
    id: update.id,
    projectId: update.projectId || "",
    type: update.type as Agent["type"],
    status: (update.status as Agent["status"]) || "idle",
    currentTask: update.currentTask || undefined,
    progress: update.progress || 0,
    lastActivity: new Date(),
  };
}

// Transform API activity to frontend ActivityItem type
function transformApiActivity(apiActivity: ApiActivityItem): ActivityItem {
  return {
    id: apiActivity.id,
    projectId: apiActivity.projectId,
    agentType: apiActivity.agentType as ActivityItem["agentType"],
    action: apiActivity.action,
    details: apiActivity.details,
    timestamp: new Date(apiActivity.timestamp),
  };
}

// Transform activity update to frontend ActivityItem type
function transformActivityUpdate(activity: {
  id: string;
  projectId: string;
  agentType: string;
  action: string;
  details?: string;
}): ActivityItem {
  return {
    id: activity.id,
    projectId: activity.projectId,
    agentType: activity.agentType as ActivityItem["agentType"],
    action: activity.action,
    details: activity.details,
    timestamp: new Date(),
  };
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<"all" | "attention" | "progress" | "completed">("all");
  const [localAgents, setLocalAgents] = useState<Agent[]>([]);
  const [localActivities, setLocalActivities] = useState<ActivityItem[]>([]);

  // WebSocket connection
  const { status: wsStatus, isConnected } = useWebSocket({
    autoConnect: true,
    channels: ["agents", "tasks", "activity", "learning"],
  });

  // API data fetching
  const { stats, loading: statsLoading, error: statsError } = useDashboardStats();
  const { projects: apiProjects, loading: projectsLoading, error: projectsError } = useProjects();

  // Get first project ID for activity and agents (in real app, this would be selected project)
  const firstProjectId = apiProjects && apiProjects.length > 0 ? apiProjects[0].id : null;

  const { activities: apiActivities } = useProjectActivity(firstProjectId);
  const { agents: apiAgents } = useLiveAgents(firstProjectId);

  // Transform API data
  const projects: Project[] = apiProjects?.map(transformProject) || [];
  const agents: Agent[] = apiAgents?.map(transformLiveAgent) || localAgents;
  const activities: ActivityItem[] = apiActivities?.map(transformApiActivity) || localActivities;

  // Real-time agent updates
  useAgentUpdates(firstProjectId, useCallback((update) => {
    setLocalAgents((prev) => {
      const existing = prev.findIndex((a) => a.id === update.id);
      const newAgent = transformAgentUpdate(update);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = newAgent;
        return updated;
      }
      return [...prev, newAgent];
    });
  }, []));

  // Real-time activity updates
  useActivityUpdates(firstProjectId, useCallback((activity) => {
    setLocalActivities((prev) => [
      transformActivityUpdate(activity),
      ...prev.slice(0, 49), // Keep last 50
    ]);
  }, []));

  // Filter projects by status
  const needsAttention = projects.filter((p) => p.status === "demo_ready");
  const inProgress = projects.filter(
    (p) => p.status === "demo_building" || p.status === "building" || p.status === "planning"
  );
  const completed = projects.filter((p) => p.status === "completed");

  const filteredProjects = {
    all: projects,
    attention: needsAttention,
    progress: inProgress,
    completed: completed,
  };

  const workingAgents = agents.filter((a) => a.status === "working" || a.status === "idle");

  // Default stats when loading
  const displayStats: DashboardStats = stats || {
    activeProjects: projects.length,
    activeAgents: workingAgents.length,
    demosWaitingReview: needsAttention.length,
    todaySpend: 0,
  };

  const isLoading = statsLoading || projectsLoading;
  const hasError = statsError || projectsError;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-in">
      {/* Connection status indicator */}
      <div className="flex items-center justify-end gap-2 text-sm">
        {isConnected ? (
          <span className="flex items-center gap-1 text-green-600">
            <Wifi className="h-4 w-4" />
            Live
          </span>
        ) : (
          <span className="flex items-center gap-1 text-gray-400">
            <WifiOff className="h-4 w-4" />
            {wsStatus === "connecting" || wsStatus === "reconnecting" ? "Connecting..." : "Offline"}
          </span>
        )}
      </div>

      {/* Error banner */}
      {hasError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">
          <p className="font-medium">Failed to load dashboard data</p>
          <p className="text-sm">{(statsError || projectsError)?.message}</p>
        </div>
      )}

      {/* Welcome message */}
      <WelcomeMessage
        name="Ganesh"
        summary={{
          demosReady: needsAttention.length,
          buildsComplete: completed.filter(
            (p) => p.updatedAt > new Date(Date.now() - 24 * 60 * 60 * 1000)
          ).length,
          totalSpent: displayStats.todaySpend,
        }}
      />

      {/* Stats */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        </div>
      ) : (
        <StatsCards stats={displayStats} />
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/new"
          className="group flex items-center gap-4 rounded-xl border-2 border-dashed border-gray-300 bg-white p-4 sm:p-6 hover:border-blue-500 hover:bg-blue-50/50 transition-all"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
            <Plus className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 group-hover:text-blue-700">
              New Project
            </h3>
            <p className="text-sm text-gray-500">Start from scratch</p>
          </div>
          <ArrowRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
        </Link>

        <Link
          href="/import"
          className="group flex items-center gap-4 rounded-xl border-2 border-dashed border-gray-300 bg-white p-4 sm:p-6 hover:border-purple-500 hover:bg-purple-50/50 transition-all"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors">
            <Upload className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 group-hover:text-purple-700">
              Import Project
            </h3>
            <p className="text-sm text-gray-500">Continue existing work</p>
          </div>
          <ArrowRight className="h-5 w-5 text-gray-400 group-hover:text-purple-600 group-hover:translate-x-1 transition-all" />
        </Link>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Projects section */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {[
              { key: "all", label: "All Projects", count: projects.length },
              {
                key: "attention",
                label: "Needs Attention",
                count: needsAttention.length,
                highlight: true,
              },
              { key: "progress", label: "In Progress", count: inProgress.length },
              { key: "completed", label: "Completed", count: completed.length },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.key
                    ? "bg-blue-100 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {tab.label}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    activeTab === tab.key
                      ? "bg-blue-600 text-white"
                      : tab.highlight && tab.count > 0
                      ? "bg-yellow-500 text-white"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Project cards */}
          {projectsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredProjects[activeTab].map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>

              {filteredProjects[activeTab].length === 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                  <p className="text-gray-500">
                    {projects.length === 0
                      ? "No projects yet. Create your first project!"
                      : "No projects in this category"}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Agent grid */}
          <AgentGrid agents={workingAgents} />

          {/* Activity feed */}
          <ActivityFeed activities={activities} />
        </div>
      </div>
    </div>
  );
}
