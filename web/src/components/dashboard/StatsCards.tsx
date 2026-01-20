"use client";

import { FolderKanban, Bot, Eye, DollarSign } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { DashboardStats } from "@/types";

interface StatsCardsProps {
  stats: DashboardStats;
}

const statConfigs = [
  {
    key: "activeProjects" as const,
    label: "Active Projects",
    icon: FolderKanban,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
  },
  {
    key: "activeAgents" as const,
    label: "Active Agents",
    icon: Bot,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
  },
  {
    key: "demosWaitingReview" as const,
    label: "Demos Waiting",
    icon: Eye,
    color: "text-yellow-600",
    bgColor: "bg-yellow-50",
  },
  {
    key: "todaySpend" as const,
    label: "Today's Spend",
    icon: DollarSign,
    color: "text-green-600",
    bgColor: "bg-green-50",
    format: (v: number) => formatCurrency(v),
  },
];

export function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {statConfigs.map((config) => {
        const value = stats[config.key];
        const displayValue = config.format ? config.format(value) : value;

        return (
          <div
            key={config.key}
            className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3 sm:gap-4">
              <div
                className={cn(
                  "flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl",
                  config.bgColor
                )}
              >
                <config.icon className={cn("h-5 w-5 sm:h-6 sm:w-6", config.color)} />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-gray-500">
                  {config.label}
                </p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900">
                  {displayValue}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
