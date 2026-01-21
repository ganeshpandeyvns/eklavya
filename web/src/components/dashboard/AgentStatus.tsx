'use client';

import { useState, useEffect } from 'react';
import { api, Agent } from '@/lib/api';

interface AgentStatusProps {
  projectId?: string;
}

const statusColors: Record<string, string> = {
  initializing: 'bg-yellow-500',
  idle: 'bg-blue-500',
  working: 'bg-green-500 animate-pulse',
  blocked: 'bg-orange-500',
  completed: 'bg-gray-500',
  failed: 'bg-red-500',
  terminated: 'bg-gray-400',
};

const agentTypeIcons: Record<string, string> = {
  orchestrator: '🎯',
  architect: '📐',
  developer: '💻',
  tester: '🧪',
  qa: '✅',
  pm: '📋',
  uat: '👤',
  sre: '🔧',
  monitor: '📊',
  mentor: '🎓',
};

export default function AgentStatus({ projectId }: AgentStatusProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    const fetchAgents = async () => {
      try {
        const data = await api.getAgents(projectId);
        setAgents(data);
        setError(null);
      } catch {
        setError('Failed to fetch agents');
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
    const interval = setInterval(fetchAgents, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [projectId]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Agent Status</h3>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Agent Status</h3>
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Agent Status</h3>
        <p className="text-gray-500">No agents running</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Agent Status</h3>
      <div className="space-y-3">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{agentTypeIcons[agent.type] || '🤖'}</span>
              <div>
                <p className="font-medium capitalize">{agent.type}</p>
                <p className="text-sm text-gray-500">
                  Tasks: {agent.metrics.tasks_completed} completed, {agent.metrics.tasks_failed} failed
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`w-3 h-3 rounded-full ${statusColors[agent.status] || 'bg-gray-500'}`}
              ></span>
              <span className="text-sm capitalize">{agent.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
