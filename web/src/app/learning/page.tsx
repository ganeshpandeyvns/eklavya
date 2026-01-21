"use client";

import { useState, useEffect } from "react";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  FlaskConical,
  ChevronDown,
  ChevronUp,
  Award,
  AlertCircle,
  CheckCircle,
  Loader2,
  Play,
  Square,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentType } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Types matching the API
interface PromptMetrics {
  promptId: string;
  agentType: AgentType;
  version: number;
  status: string;
  totalUses: number;
  successfulUses: number;
  successRate: number;
  averageReward: number;
  confidenceInterval: [number, number];
  thompsonScore: number;
  recentTrend: "improving" | "stable" | "declining";
  lastUsed?: string;
  avgCompletionTimeMs?: number;
}

interface ComparisonReport {
  agentType: AgentType;
  totalPrompts: number;
  productionPrompt?: PromptMetrics;
  candidatePrompts: PromptMetrics[];
  experimentalPrompts: PromptMetrics[];
  bestPerformer: PromptMetrics | null;
  recommendations: string[];
}

interface Experiment {
  id: string;
  name: string;
  description?: string;
  agentType: AgentType;
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

interface ExperimentResults {
  experiment: Experiment;
  control: {
    promptId: string;
    samples: number;
    successRate: number;
    avgReward: number;
  };
  treatment: {
    promptId: string;
    samples: number;
    successRate: number;
    avgReward: number;
  };
  analysis: {
    winner: "control" | "treatment" | "none";
    confidence: number;
    improvement: number;
    statSignificant: boolean;
    recommendation: string;
  };
}

interface AggregateMetrics {
  totalPrompts: number;
  totalExperiments: number;
  activeExperiments: number;
  avgSuccessRate: number;
  avgThompsonScore: number;
  byAgentType: Record<
    AgentType,
    {
      promptCount: number;
      avgSuccessRate: number;
      productionVersion?: number;
    }
  >;
}

const agentTypeColors: Record<string, { bg: string; text: string; border: string }> = {
  orchestrator: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  architect: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  developer: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
  tester: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  qa: { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  pm: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200" },
  uat: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
  sre: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  monitor: { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200" },
  mentor: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
};

const statusColors: Record<string, { bg: string; text: string }> = {
  production: { bg: "bg-green-100", text: "text-green-700" },
  candidate: { bg: "bg-blue-100", text: "text-blue-700" },
  experimental: { bg: "bg-purple-100", text: "text-purple-700" },
  deprecated: { bg: "bg-gray-100", text: "text-gray-500" },
};

function TrendIcon({ trend }: { trend: "improving" | "stable" | "declining" }) {
  switch (trend) {
    case "improving":
      return <TrendingUp className="h-4 w-4 text-green-500" />;
    case "declining":
      return <TrendingDown className="h-4 w-4 text-red-500" />;
    default:
      return <Minus className="h-4 w-4 text-gray-400" />;
  }
}

function PromptCard({ prompt }: { prompt: PromptMetrics }) {
  const statusColor = statusColors[prompt.status] || statusColors.experimental;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">v{prompt.version}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              statusColor.bg,
              statusColor.text
            )}
          >
            {prompt.status}
          </span>
        </div>
        <TrendIcon trend={prompt.recentTrend} />
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-gray-500">Success Rate</p>
          <p className="text-lg font-semibold text-gray-900">
            {(prompt.successRate * 100).toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-gray-500">Thompson Score</p>
          <p className="text-lg font-semibold text-gray-900">
            {(prompt.thompsonScore * 100).toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-gray-500">Uses</p>
          <p className="text-lg font-semibold text-gray-900">{prompt.totalUses}</p>
        </div>
        <div>
          <p className="text-gray-500">Avg Reward</p>
          <p
            className={cn(
              "text-lg font-semibold",
              prompt.averageReward >= 0 ? "text-green-600" : "text-red-600"
            )}
          >
            {prompt.averageReward >= 0 ? "+" : ""}
            {prompt.averageReward.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          95% CI: [{(prompt.confidenceInterval[0] * 100).toFixed(1)}% -{" "}
          {(prompt.confidenceInterval[1] * 100).toFixed(1)}%]
        </p>
      </div>
    </div>
  );
}

function AgentTypeSection({
  comparison,
  expanded,
  onToggle,
}: {
  comparison: ComparisonReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  const typeColor = agentTypeColors[comparison.agentType] || agentTypeColors.developer;

  return (
    <div
      className={cn(
        "rounded-xl border bg-white shadow-sm overflow-hidden",
        typeColor.border
      )}
    >
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors",
          typeColor.bg
        )}
      >
        <div className="flex items-center gap-3">
          <span className={cn("text-lg font-semibold capitalize", typeColor.text)}>
            {comparison.agentType}
          </span>
          <span className="text-sm text-gray-500">
            {comparison.totalPrompts} prompt{comparison.totalPrompts !== 1 && "s"}
          </span>
          {comparison.productionPrompt && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              v{comparison.productionPrompt.version} in prod
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Recommendations */}
          {comparison.recommendations.length > 0 && (
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-4">
              <h4 className="text-sm font-medium text-blue-800 mb-2">
                Recommendations
              </h4>
              <ul className="space-y-1">
                {comparison.recommendations.map((rec, i) => (
                  <li key={i} className="text-sm text-blue-700 flex items-start gap-2">
                    <span>-</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Best Performer */}
          {comparison.bestPerformer && (
            <div className="rounded-lg bg-yellow-50 border border-yellow-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Award className="h-5 w-5 text-yellow-600" />
                <h4 className="text-sm font-medium text-yellow-800">Best Performer</h4>
              </div>
              <p className="text-sm text-yellow-700">
                Version {comparison.bestPerformer.version} with{" "}
                {(comparison.bestPerformer.thompsonScore * 100).toFixed(1)}% Thompson
                score
              </p>
            </div>
          )}

          {/* Production Prompt */}
          {comparison.productionPrompt && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Production</h4>
              <PromptCard prompt={comparison.productionPrompt} />
            </div>
          )}

          {/* Candidate Prompts */}
          {comparison.candidatePrompts.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Candidates</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {comparison.candidatePrompts.map((prompt) => (
                  <PromptCard key={prompt.promptId} prompt={prompt} />
                ))}
              </div>
            </div>
          )}

          {/* Experimental Prompts */}
          {comparison.experimentalPrompts.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Experimental</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {comparison.experimentalPrompts.map((prompt) => (
                  <PromptCard key={prompt.promptId} prompt={prompt} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExperimentCard({
  experiment,
  results,
}: {
  experiment: Experiment;
  results?: ExperimentResults;
}) {
  const typeColor = agentTypeColors[experiment.agentType] || agentTypeColors.developer;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{experiment.name}</h3>
          <p className="text-sm text-gray-500">{experiment.description}</p>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium",
            experiment.status === "running"
              ? "bg-blue-100 text-blue-700"
              : experiment.status === "completed"
              ? "bg-green-100 text-green-700"
              : "bg-gray-100 text-gray-600"
          )}
        >
          {experiment.status}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", typeColor.bg, typeColor.text)}>
          {experiment.agentType}
        </span>
        <span className="text-xs text-gray-500">
          Traffic split: {(experiment.trafficSplit * 100).toFixed(0)}% treatment
        </span>
      </div>

      {results && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Control</p>
              <p className="text-2xl font-bold text-gray-900">
                {(results.control.successRate * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-gray-500">{results.control.samples} samples</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-4">
              <p className="text-xs font-medium text-blue-600 mb-2">Treatment</p>
              <p className="text-2xl font-bold text-blue-900">
                {(results.treatment.successRate * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-blue-600">{results.treatment.samples} samples</p>
            </div>
          </div>

          <div
            className={cn(
              "rounded-lg p-4",
              results.analysis.statSignificant
                ? results.analysis.winner === "treatment"
                  ? "bg-green-50 border border-green-100"
                  : results.analysis.winner === "control"
                  ? "bg-yellow-50 border border-yellow-100"
                  : "bg-gray-50"
                : "bg-gray-50"
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              {results.analysis.statSignificant ? (
                results.analysis.winner === "treatment" ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-yellow-600" />
                )
              ) : (
                <BarChart3 className="h-5 w-5 text-gray-400" />
              )}
              <span
                className={cn(
                  "text-sm font-medium",
                  results.analysis.statSignificant
                    ? results.analysis.winner === "treatment"
                      ? "text-green-700"
                      : "text-yellow-700"
                    : "text-gray-700"
                )}
              >
                {results.analysis.statSignificant
                  ? `${results.analysis.winner === "treatment" ? "Treatment" : "Control"} wins!`
                  : "Not yet significant"}
              </span>
            </div>
            <p className="text-sm text-gray-600">{results.analysis.recommendation}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
              <span>{(results.analysis.confidence * 100).toFixed(1)}% confidence</span>
              <span>
                {results.analysis.improvement >= 0 ? "+" : ""}
                {results.analysis.improvement.toFixed(1)}% improvement
              </span>
            </div>
          </div>
        </div>
      )}

      {experiment.status === "running" && (
        <div className="mt-4 flex justify-end">
          <button className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-100 transition-colors">
            <Square className="h-4 w-4" />
            Stop
          </button>
        </div>
      )}
    </div>
  );
}

export default function LearningDashboard() {
  const [metrics, setMetrics] = useState<AggregateMetrics | null>(null);
  const [comparisons, setComparisons] = useState<Record<string, ComparisonReport>>({});
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [experimentResults, setExperimentResults] = useState<
    Record<string, ExperimentResults>
  >({});
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [activeTab, setActiveTab] = useState<"prompts" | "experiments">("prompts");

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);

        const [metricsRes, comparisonsRes, experimentsRes] = await Promise.all([
          fetch(`${API_BASE}/api/learning/metrics`),
          fetch(`${API_BASE}/api/learning/comparisons`),
          fetch(`${API_BASE}/api/learning/experiments`),
        ]);

        if (metricsRes.ok) {
          setMetrics(await metricsRes.json());
        }

        if (comparisonsRes.ok) {
          const data = await comparisonsRes.json();
          setComparisons(data.comparisons || {});
        }

        if (experimentsRes.ok) {
          const data = await experimentsRes.json();
          setExperiments(data.experiments || []);

          // Fetch results for each experiment
          const resultsPromises = (data.experiments || []).map(
            async (exp: Experiment) => {
              const res = await fetch(
                `${API_BASE}/api/learning/experiments/${exp.id}`
              );
              if (res.ok) {
                return { id: exp.id, results: await res.json() };
              }
              return null;
            }
          );

          const resultsArray = await Promise.all(resultsPromises);
          const resultsMap: Record<string, ExperimentResults> = {};
          resultsArray.forEach((item) => {
            if (item) {
              resultsMap[item.id] = item.results;
            }
          });
          setExperimentResults(resultsMap);
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to load data"));
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const toggleAgent = (agentType: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentType)) {
        next.delete(agentType);
      } else {
        next.add(agentType);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-red-700 mb-2">
            {error.message}
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100">
            <Brain className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              Learning Dashboard
            </h1>
            <p className="text-sm text-gray-500">
              Thompson Sampling & Prompt Evolution
            </p>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">Total Prompts</p>
            <p className="text-2xl font-bold text-gray-900">{metrics.totalPrompts}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">Avg Success Rate</p>
            <p className="text-2xl font-bold text-green-600">
              {(metrics.avgSuccessRate * 100).toFixed(1)}%
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">Avg Thompson Score</p>
            <p className="text-2xl font-bold text-blue-600">
              {(metrics.avgThompsonScore * 100).toFixed(1)}%
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">Total Experiments</p>
            <p className="text-2xl font-bold text-purple-600">
              {metrics.totalExperiments}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">Active Experiments</p>
            <p className="text-2xl font-bold text-orange-600">
              {metrics.activeExperiments}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab("prompts")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "prompts"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          Prompt Performance
        </button>
        <button
          onClick={() => setActiveTab("experiments")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "experiments"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          <FlaskConical className="h-4 w-4" />
          A/B Tests
          {metrics && metrics.activeExperiments > 0 && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-600">
              {metrics.activeExperiments}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === "prompts" ? (
        <div className="space-y-4">
          {Object.keys(comparisons).length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <Brain className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No prompt data available yet</p>
              <p className="text-sm text-gray-400 mt-1">
                Prompts will appear here after agents start using them
              </p>
            </div>
          ) : (
            Object.entries(comparisons).map(([agentType, comparison]) => (
              <AgentTypeSection
                key={agentType}
                comparison={comparison}
                expanded={expandedAgents.has(agentType)}
                onToggle={() => toggleAgent(agentType)}
              />
            ))
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {experiments.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <FlaskConical className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No experiments running</p>
              <p className="text-sm text-gray-400 mt-1">
                Create an A/B test to compare prompt variants
              </p>
              <button className="mt-4 flex items-center gap-2 mx-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
                <Play className="h-4 w-4" />
                Create Experiment
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {experiments.map((exp) => (
                <ExperimentCard
                  key={exp.id}
                  experiment={exp}
                  results={experimentResults[exp.id]}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
