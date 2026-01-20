"use client";

import { useState } from "react";
import {
  Upload,
  Github,
  FolderOpen,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ImportMethod = "github" | "upload" | "local";

interface AnalysisResult {
  projectType: string;
  framework: string;
  language: string;
  issues: string[];
  suggestions: string[];
  estimatedEffort: string;
}

export default function ImportProjectPage() {
  const [method, setMethod] = useState<ImportMethod | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    // Simulate analysis
    setTimeout(() => {
      setAnalysisResult({
        projectType: "Web Application",
        framework: "React with Next.js",
        language: "TypeScript",
        issues: [
          "Missing test coverage (0%)",
          "Outdated dependencies (12 packages)",
          "No error boundaries implemented",
          "Incomplete mobile responsiveness",
        ],
        suggestions: [
          "Add comprehensive test suite",
          "Update all dependencies to latest versions",
          "Implement proper error handling",
          "Complete responsive design implementation",
        ],
        estimatedEffort: "Demo₀ in ~45 min, Full recovery in ~4 hours",
      });
      setIsAnalyzing(false);
    }, 3000);
  };

  const methods = [
    {
      id: "github" as const,
      icon: Github,
      title: "GitHub Repository",
      description: "Import from a GitHub repo URL",
    },
    {
      id: "upload" as const,
      icon: Upload,
      title: "Upload ZIP",
      description: "Upload your project as a ZIP file",
    },
    {
      id: "local" as const,
      icon: FolderOpen,
      title: "Local Path",
      description: "Point to a local directory",
    },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto animate-in">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          Import Existing Project
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Eklavya will analyze your codebase, identify issues, and create a recovery plan.
        </p>
      </div>

      {!analysisResult ? (
        <>
          {/* Import method selection */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {methods.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={cn(
                  "flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all",
                  method === m.id
                    ? "border-purple-500 bg-purple-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                )}
              >
                <div
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-xl",
                    method === m.id
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 text-gray-600"
                  )}
                >
                  <m.icon className="h-6 w-6" />
                </div>
                <div className="text-center">
                  <h3 className="font-semibold text-gray-900">{m.title}</h3>
                  <p className="text-xs text-gray-500 mt-1">{m.description}</p>
                </div>
              </button>
            ))}
          </div>

          {/* GitHub input */}
          {method === "github" && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                GitHub Repository URL
              </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/username/repo"
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <button
                  onClick={handleAnalyze}
                  disabled={!githubUrl || isAnalyzing}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors",
                    githubUrl && !isAnalyzing
                      ? "bg-purple-600 text-white hover:bg-purple-700"
                      : "bg-gray-100 text-gray-400"
                  )}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      Analyze
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Upload input */}
          {method === "upload" && (
            <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 mb-6 text-center">
              <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-2">
                Drag and drop your ZIP file here, or click to browse
              </p>
              <p className="text-sm text-gray-400">Maximum file size: 100MB</p>
              <button className="mt-4 rounded-lg bg-purple-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-purple-700">
                Choose File
              </button>
            </div>
          )}

          {/* Local path input */}
          {method === "local" && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Local Directory Path
              </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="/path/to/your/project"
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <button className="flex items-center gap-2 rounded-lg bg-purple-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-purple-700">
                  Analyze
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Analysis in progress */}
          {isAnalyzing && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
              <Loader2 className="h-12 w-12 text-purple-600 mx-auto mb-4 animate-spin" />
              <h3 className="font-semibold text-gray-900 mb-2">
                Analyzing your codebase...
              </h3>
              <p className="text-sm text-gray-500">
                Examining structure, dependencies, and identifying potential issues
              </p>
            </div>
          )}
        </>
      ) : (
        /* Analysis results */
        <div className="space-y-6">
          {/* Project info */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Project Analysis</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500">Type</p>
                <p className="font-medium text-gray-900">
                  {analysisResult.projectType}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Framework</p>
                <p className="font-medium text-gray-900">
                  {analysisResult.framework}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Language</p>
                <p className="font-medium text-gray-900">
                  {analysisResult.language}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Estimated Effort</p>
                <p className="font-medium text-gray-900">
                  {analysisResult.estimatedEffort}
                </p>
              </div>
            </div>
          </div>

          {/* Issues found */}
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="h-5 w-5 text-red-600" />
              <h2 className="font-semibold text-red-900">
                Issues Found ({analysisResult.issues.length})
              </h2>
            </div>
            <ul className="space-y-2">
              {analysisResult.issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-red-800">
                  <span className="text-red-400 mt-1">•</span>
                  {issue}
                </li>
              ))}
            </ul>
          </div>

          {/* Suggestions */}
          <div className="rounded-xl border border-green-200 bg-green-50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <h2 className="font-semibold text-green-900">Recovery Plan</h2>
            </div>
            <ul className="space-y-2">
              {analysisResult.suggestions.map((suggestion, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-green-800"
                >
                  <span className="text-green-400 mt-1">•</span>
                  {suggestion}
                </li>
              ))}
            </ul>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={() => setAnalysisResult(null)}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Start Over
            </button>
            <button className="flex-1 rounded-lg bg-purple-600 px-6 py-3 text-sm font-medium text-white hover:bg-purple-700">
              Start Recovery Build
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
