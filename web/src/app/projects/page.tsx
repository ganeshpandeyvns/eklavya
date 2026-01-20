"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Filter, Plus, Grid, List } from "lucide-react";
import { ProjectCard } from "@/components/dashboard/ProjectCard";
import { mockProjects } from "@/data/mock";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/types";

export default function ProjectsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filteredProjects = mockProjects.filter((project) => {
    const matchesSearch =
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.clientName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || project.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusOptions: { value: ProjectStatus | "all"; label: string }[] = [
    { value: "all", label: "All Status" },
    { value: "planning", label: "Planning" },
    { value: "demo_building", label: "Building Demo" },
    { value: "demo_ready", label: "Demo Ready" },
    { value: "building", label: "Building" },
    { value: "completed", label: "Completed" },
    { value: "paused", label: "Paused" },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            All Projects
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {filteredProjects.length} project{filteredProjects.length !== 1 && "s"}
          </p>
        </div>
        <Link
          href="/new"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Project
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects or clients..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Status filter */}
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as ProjectStatus | "all")
            }
            className="appearance-none rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* View toggle */}
        <div className="flex rounded-lg border border-gray-200 bg-white p-1">
          <button
            onClick={() => setViewMode("grid")}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              viewMode === "grid"
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <Grid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              viewMode === "list"
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Project grid */}
      {filteredProjects.length > 0 ? (
        <div
          className={cn(
            "grid gap-4",
            viewMode === "grid"
              ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              : "grid-cols-1"
          )}
        >
          {filteredProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500 mb-4">No projects found</p>
          <Link
            href="/new"
            className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" />
            Create your first project
          </Link>
        </div>
      )}
    </div>
  );
}
