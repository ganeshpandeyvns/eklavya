'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, DashboardStats, ActivityItem, PromptStats, LiveAgent } from '@/lib/api';

// API response types (snake_case from backend)
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
  created_at: string;
}

/**
 * Generic hook for API data fetching with loading and error states
 */
export function useApiData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Hook for fetching dashboard stats
 */
export function useDashboardStats(): {
  stats: DashboardStats | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const fetcher = useCallback(() => api.getDashboardStats(), []);
  const { data, loading, error, refetch } = useApiData<DashboardStats>(fetcher, []);
  return { stats: data, loading, error, refetch };
}

/**
 * Hook for fetching projects list (returns raw API response)
 */
export function useProjects(): {
  projects: ApiProject[] | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const fetcher = useCallback(() => api.getProjects() as Promise<ApiProject[]>, []);
  const { data, loading, error, refetch } = useApiData<ApiProject[]>(fetcher, []);
  return { projects: data, loading, error, refetch };
}

/**
 * Hook for fetching a single project
 */
export function useProject(projectId: string): {
  project: ApiProject | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const fetcher = useCallback(() => api.getProject(projectId) as Promise<ApiProject>, [projectId]);
  const { data, loading, error, refetch } = useApiData<ApiProject>(fetcher, [projectId]);
  return { project: data, loading, error, refetch };
}

/**
 * Hook for fetching agents for a project
 */
export function useProjectAgents(projectId: string | null): {
  agents: ApiAgent[] | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const fetcher = useCallback(
    () => (projectId ? api.getAgents(projectId) as Promise<ApiAgent[]> : Promise.resolve([])),
    [projectId]
  );
  const { data, loading, error, refetch } = useApiData<ApiAgent[]>(fetcher, [projectId]);
  return { agents: data, loading, error, refetch };
}

/**
 * Hook for fetching live agents with real-time status
 */
export function useLiveAgents(projectId: string | null): {
  agents: LiveAgent[] | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const fetcher = useCallback(
    () => (projectId ? api.getLiveAgents(projectId) : Promise.resolve([])),
    [projectId]
  );
  const { data, loading, error, refetch } = useApiData<LiveAgent[]>(fetcher, [projectId]);
  return { agents: data, loading, error, refetch };
}

/**
 * Hook for fetching project activity feed
 */
export function useProjectActivity(projectId: string | null): {
  activities: ActivityItem[] | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const fetcher = useCallback(
    () => (projectId ? api.getProjectActivity(projectId) : Promise.resolve([])),
    [projectId]
  );
  const { data, loading, error, refetch } = useApiData<ActivityItem[]>(fetcher, [projectId]);
  return { activities: data, loading, error, refetch };
}

/**
 * Hook for fetching prompt stats (RL learning)
 */
export function usePromptStats(agentType: string): {
  stats: PromptStats | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const fetcher = useCallback(() => api.getPromptStats(agentType), [agentType]);
  const { data, loading, error, refetch } = useApiData<PromptStats>(fetcher, [agentType]);
  return { stats: data, loading, error, refetch };
}

/**
 * Hook for polling data at an interval
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  enabled: boolean = true
): {
  data: T | null;
  loading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;

    const fetchData = async () => {
      try {
        const result = await fetcher();
        if (mounted) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    const interval = setInterval(fetchData, intervalMs);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fetcher, intervalMs, enabled]);

  return { data, loading, error };
}

// Re-export types for convenience
export type { ActivityItem, DashboardStats, PromptStats, LiveAgent };
