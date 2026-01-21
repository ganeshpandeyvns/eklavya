"use client";

import Link from "next/link";
import { Clock, DollarSign, ChevronRight } from "lucide-react";
import { cn, formatCurrency, formatRelativeTime } from "@/lib/utils";
import type { Project } from "@/types";

interface ProjectCardProps {
  project: Project;
}

const statusConfig: Record<
  string,
  { label: string; color: string; bgColor: string; dotColor: string }
> = {
  planning: {
    label: "Planning",
    color: "text-gray-700",
    bgColor: "bg-gray-100",
    dotColor: "bg-gray-500",
  },
  active: {
    label: "Active",
    color: "text-blue-700",
    bgColor: "bg-blue-100",
    dotColor: "bg-blue-500",
  },
  demo_building: {
    label: "Building Demo",
    color: "text-blue-700",
    bgColor: "bg-blue-100",
    dotColor: "bg-blue-500",
  },
  demo_ready: {
    label: "Demo Ready",
    color: "text-yellow-700",
    bgColor: "bg-yellow-100",
    dotColor: "bg-yellow-500",
  },
  building: {
    label: "Building",
    color: "text-purple-700",
    bgColor: "bg-purple-100",
    dotColor: "bg-purple-500",
  },
  completed: {
    label: "Complete",
    color: "text-green-700",
    bgColor: "bg-green-100",
    dotColor: "bg-green-500",
  },
  paused: {
    label: "Paused",
    color: "text-orange-700",
    bgColor: "bg-orange-100",
    dotColor: "bg-orange-500",
  },
};

// Default fallback for unknown statuses
const defaultStatus = {
  label: "Unknown",
  color: "text-gray-700",
  bgColor: "bg-gray-100",
  dotColor: "bg-gray-500",
};

export function ProjectCard({ project }: ProjectCardProps) {
  const status = statusConfig[project.status] || defaultStatus;
  const budgetPercent = Math.round(
    (project.budgetSpent / project.budgetLimit) * 100
  );

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group block rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-gray-300 transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                status.bgColor,
                status.color
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full animate-pulse",
                  status.dotColor,
                  project.status === "completed" && "animate-none"
                )}
              />
              {status.label}
            </span>
            {project.status === "demo_ready" && (
              <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                Needs Review
              </span>
            )}
          </div>
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors truncate">
            {project.name}
          </h3>
          <p className="text-sm text-gray-500 truncate">{project.clientName}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all flex-shrink-0" />
      </div>

      {/* Progress bar */}
      {project.status !== "completed" && project.status !== "paused" && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
            <span>{project.currentPhase}</span>
            <span className="font-medium">{project.progress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                project.progress < 30 && "bg-blue-500",
                project.progress >= 30 && project.progress < 70 && "bg-yellow-500",
                project.progress >= 70 && "bg-green-500"
              )}
              style={{ width: `${project.progress}%` }}
            />
          </div>
          {project.estimatedCompletion && (
            <p className="mt-1.5 text-xs text-gray-500 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {project.estimatedCompletion} remaining
            </p>
          )}
        </div>
      )}

      {/* Budget info */}
      <div className="mt-4 flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-gray-500">
          <DollarSign className="h-4 w-4" />
          <span>
            {formatCurrency(project.budgetSpent)}{" "}
            <span className="text-gray-400">/ {formatCurrency(project.budgetLimit)}</span>
          </span>
        </div>
        <span
          className={cn(
            "text-xs font-medium",
            budgetPercent < 50 && "text-green-600",
            budgetPercent >= 50 && budgetPercent < 80 && "text-yellow-600",
            budgetPercent >= 80 && "text-red-600"
          )}
        >
          {budgetPercent}% used
        </span>
      </div>

      {/* Updated time */}
      <p className="mt-3 text-xs text-gray-400">
        Updated {formatRelativeTime(project.updatedAt)}
      </p>
    </Link>
  );
}
