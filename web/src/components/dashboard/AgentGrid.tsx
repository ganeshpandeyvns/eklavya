"use client";

import { cn } from "@/lib/utils";
import type { Agent, AgentType } from "@/types";
import {
  Cog,
  Code,
  FileSearch,
  TestTube,
  Microscope,
  FileText,
  UserCheck,
  Server,
  Activity,
  Lightbulb,
} from "lucide-react";

interface AgentGridProps {
  agents: Agent[];
  projectName?: string;
}

const agentIcons: Record<AgentType, typeof Cog> = {
  orchestrator: Cog,
  architect: FileSearch,
  developer: Code,
  tester: TestTube,
  qa: Microscope,
  pm: FileText,
  uat: UserCheck,
  sre: Server,
  monitor: Activity,
  mentor: Lightbulb,
};

const agentLabels: Record<AgentType, string> = {
  orchestrator: "Orchestrator",
  architect: "Architect",
  developer: "Developer",
  tester: "Tester",
  qa: "QA",
  pm: "PM",
  uat: "UAT",
  sre: "SRE",
  monitor: "Monitor",
  mentor: "Mentor",
};

const statusConfig = {
  idle: { color: "bg-gray-200", pulse: false, label: "Idle" },
  working: { color: "bg-green-500", pulse: true, label: "Working" },
  blocked: { color: "bg-red-500", pulse: true, label: "Blocked" },
  completed: { color: "bg-blue-500", pulse: false, label: "Done" },
};

export function AgentGrid({ agents, projectName }: AgentGridProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">
            Active Agents
          </h2>
          {projectName && (
            <p className="text-sm text-gray-500">{projectName}</p>
          )}
        </div>
        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
          {agents.filter((a) => a.status === "working").length} working
        </span>
      </div>
      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {agents.map((agent) => {
            const Icon = agentIcons[agent.type];
            const status = statusConfig[agent.status];

            return (
              <div
                key={agent.id}
                className={cn(
                  "relative rounded-lg border p-3 transition-all",
                  agent.status === "working"
                    ? "border-green-200 bg-green-50"
                    : agent.status === "blocked"
                    ? "border-red-200 bg-red-50"
                    : "border-gray-200 bg-gray-50"
                )}
              >
                {/* Status indicator */}
                <div
                  className={cn(
                    "absolute -right-1 -top-1 h-3 w-3 rounded-full",
                    status.color,
                    status.pulse && "animate-pulse"
                  )}
                />

                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-900">
                    {agentLabels[agent.type]}
                  </span>
                </div>

                {agent.currentTask && (
                  <p className="text-xs text-gray-600 line-clamp-2">
                    {agent.currentTask}
                  </p>
                )}

                {agent.progress !== undefined && agent.status === "working" && (
                  <div className="mt-2">
                    <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-green-500 transition-all duration-300"
                        style={{ width: `${agent.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 text-right">
                      {agent.progress}%
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
