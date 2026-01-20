"use client";

import { formatRelativeTime } from "@/lib/utils";
import type { ActivityItem, AgentType } from "@/types";
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

interface ActivityFeedProps {
  activities: ActivityItem[];
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

const agentColors: Record<AgentType, string> = {
  orchestrator: "text-purple-600 bg-purple-100",
  architect: "text-blue-600 bg-blue-100",
  developer: "text-green-600 bg-green-100",
  tester: "text-orange-600 bg-orange-100",
  qa: "text-red-600 bg-red-100",
  pm: "text-cyan-600 bg-cyan-100",
  uat: "text-pink-600 bg-pink-100",
  sre: "text-gray-600 bg-gray-100",
  monitor: "text-yellow-600 bg-yellow-100",
  mentor: "text-indigo-600 bg-indigo-100",
};

export function ActivityFeed({ activities }: ActivityFeedProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-5">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">
          Live Activity
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-green-600">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          Live
        </span>
      </div>
      <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
        {activities.map((activity) => {
          const Icon = agentIcons[activity.agentType];
          const colors = agentColors[activity.agentType];

          return (
            <div
              key={activity.id}
              className="flex items-start gap-3 px-4 py-3 sm:px-5 hover:bg-gray-50 transition-colors"
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors} flex-shrink-0`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-gray-900 capitalize">
                    {activity.agentType}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatRelativeTime(activity.timestamp)}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{activity.action}</p>
                {activity.details && (
                  <p className="text-xs text-gray-400 truncate mt-0.5">
                    {activity.details}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
