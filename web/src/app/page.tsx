"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Upload, ArrowRight } from "lucide-react";
import { WelcomeMessage } from "@/components/dashboard/WelcomeMessage";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { ProjectCard } from "@/components/dashboard/ProjectCard";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { AgentGrid } from "@/components/dashboard/AgentGrid";
import {
  mockProjects,
  mockStats,
  mockActivity,
  mockAgents,
} from "@/data/mock";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<"all" | "attention" | "progress" | "completed">("all");

  const needsAttention = mockProjects.filter((p) => p.status === "demo_ready");
  const inProgress = mockProjects.filter(
    (p) => p.status === "demo_building" || p.status === "building" || p.status === "planning"
  );
  const completed = mockProjects.filter((p) => p.status === "completed");

  const filteredProjects = {
    all: mockProjects,
    attention: needsAttention,
    progress: inProgress,
    completed: completed,
  };

  const workingAgents = mockAgents.filter((a) => a.status === "working" || a.status === "idle");

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-in">
      {/* Welcome message */}
      <WelcomeMessage
        name="Ganesh"
        summary={{
          demosReady: needsAttention.length,
          buildsComplete: completed.filter(
            (p) => p.updatedAt > new Date(Date.now() - 24 * 60 * 60 * 1000)
          ).length,
          totalSpent: mockStats.todaySpend,
        }}
      />

      {/* Stats */}
      <StatsCards stats={mockStats} />

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
              { key: "all", label: "All Projects", count: mockProjects.length },
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredProjects[activeTab].map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>

          {filteredProjects[activeTab].length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
              <p className="text-gray-500">No projects in this category</p>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Agent grid */}
          <AgentGrid agents={workingAgents} />

          {/* Activity feed */}
          <ActivityFeed activities={mockActivity} />
        </div>
      </div>
    </div>
  );
}
