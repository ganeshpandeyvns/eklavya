/**
 * Dashboard API Endpoints
 *
 * Provides aggregated data for the admin dashboard:
 * - Overall stats (projects, agents, demos, spend)
 * - Project activity feeds
 * - Agent performance metrics
 * - RL learning statistics
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getDatabase } from '../lib/database.js';

/**
 * GET /api/dashboard/stats
 * Returns aggregated dashboard statistics
 */
export async function getDashboardStats(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const db = getDatabase();

  try {
    // Get active projects count
    const projectsResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM projects WHERE status NOT IN ('completed', 'archived')`
    );

    // Get active agents count
    const agentsResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agents WHERE status IN ('working', 'idle', 'initializing')`
    );

    // Get demos waiting for review
    const demosResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM projects WHERE status = 'demo_ready'`
    );

    // Get today's spend (from project usage)
    const spendResult = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(cost_used), 0) as total FROM projects
       WHERE updated_at >= CURRENT_DATE`
    );

    // Get additional stats for richer dashboard
    const additionalStats = await db.query<{
      total_tasks: string;
      completed_tasks: string;
      total_bugs: string;
      open_bugs: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM tasks) as total_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as completed_tasks,
        (SELECT COUNT(*) FROM bugs) as total_bugs,
        (SELECT COUNT(*) FROM bugs WHERE fixed = false) as open_bugs
    `);

    const stats = {
      activeProjects: parseInt(projectsResult.rows[0]?.count || '0'),
      activeAgents: parseInt(agentsResult.rows[0]?.count || '0'),
      demosWaitingReview: parseInt(demosResult.rows[0]?.count || '0'),
      todaySpend: parseFloat(spendResult.rows[0]?.total || '0'),
      totalTasks: parseInt(additionalStats.rows[0]?.total_tasks || '0'),
      completedTasks: parseInt(additionalStats.rows[0]?.completed_tasks || '0'),
      totalBugs: parseInt(additionalStats.rows[0]?.total_bugs || '0'),
      openBugs: parseInt(additionalStats.rows[0]?.open_bugs || '0'),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch dashboard stats' }));
  }
}

/**
 * GET /api/projects/:projectId/activity
 * Returns activity feed for a project
 */
export async function getProjectActivity(
  _req: IncomingMessage,
  res: ServerResponse,
  projectId: string
): Promise<void> {
  const db = getDatabase();

  try {
    // Get recent messages as activity
    const messagesResult = await db.query<{
      id: string;
      type: string;
      from_agent_id: string;
      payload: string;
      created_at: Date;
    }>(
      `SELECT m.id, m.type, m.from_agent_id, m.payload, m.created_at
       FROM messages m
       WHERE m.project_id = $1
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [projectId]
    );

    // Get agent info for activity items
    const agentIds = [...new Set(messagesResult.rows.map(m => m.from_agent_id).filter(Boolean))];
    const agentsMap = new Map<string, { type: string }>();

    if (agentIds.length > 0) {
      const agentsResult = await db.query<{ id: string; type: string }>(
        `SELECT id, type FROM agents WHERE id = ANY($1)`,
        [agentIds]
      );
      for (const agent of agentsResult.rows) {
        agentsMap.set(agent.id, { type: agent.type });
      }
    }

    // Transform to activity items
    const activities = messagesResult.rows.map((msg) => {
      const agent = msg.from_agent_id ? agentsMap.get(msg.from_agent_id) : null;
      const payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload;

      return {
        id: msg.id,
        projectId,
        agentType: agent?.type || 'system',
        agentId: msg.from_agent_id,
        action: formatMessageType(msg.type),
        details: payload.message || payload.status || null,
        timestamp: msg.created_at,
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(activities));
  } catch (error) {
    console.error('Error fetching project activity:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch project activity' }));
  }
}

/**
 * GET /api/agents/:agentId/stats
 * Returns performance stats for an agent
 */
export async function getAgentStats(
  _req: IncomingMessage,
  res: ServerResponse,
  agentId: string
): Promise<void> {
  const db = getDatabase();

  try {
    // Get agent basic info and metrics
    const agentResult = await db.query<{
      id: string;
      type: string;
      status: string;
      tasks_completed: number;
      tasks_failed: number;
      tokens_used: number;
      prompt_id: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, type, status, tasks_completed, tasks_failed, tokens_used, prompt_id, created_at, updated_at
       FROM agents WHERE id = $1`,
      [agentId]
    );

    if (agentResult.rows.length === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent not found' }));
      return;
    }

    const agent = agentResult.rows[0];

    // Get RL outcomes for this agent
    const outcomesResult = await db.query<{
      avg_reward: string;
      total_outcomes: string;
      successes: string;
      failures: string;
    }>(
      `SELECT
        AVG(reward) as avg_reward,
        COUNT(*) as total_outcomes,
        COUNT(*) FILTER (WHERE outcome = 'success') as successes,
        COUNT(*) FILTER (WHERE outcome = 'failure') as failures
       FROM rl_outcomes WHERE agent_id = $1`,
      [agentId]
    );

    const outcomes = outcomesResult.rows[0];

    // Get prompt Thompson score if available
    let thompsonScore = null;
    if (agent.prompt_id) {
      const promptResult = await db.query<{ alpha: string; beta: string }>(
        `SELECT alpha, beta FROM prompts WHERE id = $1`,
        [agent.prompt_id]
      );
      if (promptResult.rows.length > 0) {
        const alpha = parseFloat(promptResult.rows[0].alpha);
        const beta = parseFloat(promptResult.rows[0].beta);
        thompsonScore = alpha / (alpha + beta);
      }
    }

    const stats = {
      id: agent.id,
      type: agent.type,
      status: agent.status,
      tasksCompleted: agent.tasks_completed || 0,
      tasksFailed: agent.tasks_failed || 0,
      tokensUsed: agent.tokens_used || 0,
      avgReward: parseFloat(outcomes?.avg_reward || '0'),
      totalOutcomes: parseInt(outcomes?.total_outcomes || '0'),
      successRate: outcomes?.total_outcomes
        ? (parseInt(outcomes.successes) / parseInt(outcomes.total_outcomes)) * 100
        : 0,
      thompsonScore,
      createdAt: agent.created_at,
      updatedAt: agent.updated_at,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } catch (error) {
    console.error('Error fetching agent stats:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch agent stats' }));
  }
}

/**
 * GET /api/projects/:projectId/agents/live
 * Returns real-time agent list with current status
 */
export async function getProjectAgentsLive(
  _req: IncomingMessage,
  res: ServerResponse,
  projectId: string
): Promise<void> {
  const db = getDatabase();

  try {
    const agentsResult = await db.query<{
      id: string;
      type: string;
      status: string;
      current_task_id: string | null;
      tasks_completed: number;
      tasks_failed: number;
      tokens_used: number;
      last_heartbeat: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, type, status, current_task_id, tasks_completed, tasks_failed,
              tokens_used, last_heartbeat, created_at, updated_at
       FROM agents
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [projectId]
    );

    // Get current task details for working agents
    const workingAgentTaskIds = agentsResult.rows
      .filter(a => a.current_task_id)
      .map(a => a.current_task_id);

    const tasksMap = new Map<string, { title: string; progress: number }>();
    if (workingAgentTaskIds.length > 0) {
      const tasksResult = await db.query<{ id: string; title: string }>(
        `SELECT id, title FROM tasks WHERE id = ANY($1)`,
        [workingAgentTaskIds]
      );
      for (const task of tasksResult.rows) {
        tasksMap.set(task.id, { title: task.title, progress: 0 });
      }
    }

    const agents = agentsResult.rows.map((agent) => {
      const task = agent.current_task_id ? tasksMap.get(agent.current_task_id) : null;

      // Calculate progress (simplified: based on completed vs total)
      const totalTasks = agent.tasks_completed + agent.tasks_failed + (agent.status === 'working' ? 1 : 0);
      const progress = totalTasks > 0 ? (agent.tasks_completed / totalTasks) * 100 : 0;

      return {
        id: agent.id,
        type: agent.type,
        status: agent.status,
        currentTask: task?.title || null,
        progress: Math.round(progress),
        tasksCompleted: agent.tasks_completed || 0,
        tasksFailed: agent.tasks_failed || 0,
        tokensUsed: agent.tokens_used || 0,
        isHealthy: agent.last_heartbeat
          ? Date.now() - new Date(agent.last_heartbeat).getTime() < 60000
          : true,
        lastActivity: agent.updated_at,
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agents));
  } catch (error) {
    console.error('Error fetching live agents:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch live agents' }));
  }
}

/**
 * GET /api/prompts/:agentType/stats
 * Returns RL learning stats for a prompt type
 */
export async function getPromptStats(
  _req: IncomingMessage,
  res: ServerResponse,
  agentType: string
): Promise<void> {
  const db = getDatabase();

  // Valid agent types
  const validAgentTypes = [
    'orchestrator', 'architect', 'developer', 'tester',
    'qa', 'pm', 'uat', 'sre', 'monitor', 'mentor'
  ];

  // Return empty stats for invalid agent types
  if (!validAgentTypes.includes(agentType)) {
    const emptyStats = {
      agentType,
      totalVersions: 0,
      totalUses: 0,
      avgThompsonScore: 0,
      productionVersion: null,
      versions: [],
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(emptyStats));
    return;
  }

  try {
    const promptsResult = await db.query<{
      id: string;
      version: number;
      status: string;
      alpha: string;
      beta: string;
      total_uses: number;
      successful_uses: number;
      created_at: Date;
    }>(
      `SELECT id, version, status, alpha, beta, total_uses, successful_uses, created_at
       FROM prompts
       WHERE agent_type = $1
       ORDER BY version DESC`,
      [agentType]
    );

    const versions = promptsResult.rows.map((prompt) => {
      const alpha = parseFloat(prompt.alpha);
      const beta = parseFloat(prompt.beta);
      const thompsonScore = alpha / (alpha + beta);
      const successRate = prompt.total_uses > 0
        ? (prompt.successful_uses / prompt.total_uses) * 100
        : 0;

      return {
        id: prompt.id,
        version: prompt.version,
        status: prompt.status,
        alpha,
        beta,
        thompsonScore,
        totalUses: prompt.total_uses,
        successfulUses: prompt.successful_uses,
        successRate,
        createdAt: prompt.created_at,
      };
    });

    // Calculate overall stats
    const totalUses = versions.reduce((sum, v) => sum + v.totalUses, 0);
    const avgThompsonScore = versions.length > 0
      ? versions.reduce((sum, v) => sum + v.thompsonScore, 0) / versions.length
      : 0;
    const productionVersion = versions.find(v => v.status === 'production');

    const stats = {
      agentType,
      totalVersions: versions.length,
      totalUses,
      avgThompsonScore,
      productionVersion: productionVersion?.version || null,
      versions,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } catch (error) {
    console.error('Error fetching prompt stats:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch prompt stats' }));
  }
}

/**
 * GET /api/projects/:projectId/timeline
 * Returns project execution timeline
 */
export async function getProjectTimeline(
  _req: IncomingMessage,
  res: ServerResponse,
  projectId: string
): Promise<void> {
  const db = getDatabase();

  try {
    // Get project info
    const projectResult = await db.query<{
      id: string;
      name: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, status, created_at, updated_at FROM projects WHERE id = $1`,
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }

    const project = projectResult.rows[0];

    // Get task timeline
    const tasksResult = await db.query<{
      id: string;
      title: string;
      status: string;
      created_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
    }>(
      `SELECT id, title, status, created_at, started_at, completed_at
       FROM tasks
       WHERE project_id = $1
       ORDER BY created_at ASC`,
      [projectId]
    );

    // Get agent spawn/complete timeline
    const agentsResult = await db.query<{
      id: string;
      type: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, type, status, created_at, updated_at
       FROM agents
       WHERE project_id = $1
       ORDER BY created_at ASC`,
      [projectId]
    );

    const timeline = {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        startedAt: project.created_at,
        lastActivity: project.updated_at,
      },
      tasks: tasksResult.rows.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        createdAt: t.created_at,
        startedAt: t.started_at,
        completedAt: t.completed_at,
        duration: t.started_at && t.completed_at
          ? new Date(t.completed_at).getTime() - new Date(t.started_at).getTime()
          : null,
      })),
      agents: agentsResult.rows.map(a => ({
        id: a.id,
        type: a.type,
        status: a.status,
        spawnedAt: a.created_at,
        lastActivity: a.updated_at,
      })),
      stats: {
        totalTasks: tasksResult.rows.length,
        completedTasks: tasksResult.rows.filter(t => t.status === 'completed').length,
        totalAgents: agentsResult.rows.length,
        activeAgents: agentsResult.rows.filter(a => ['working', 'idle'].includes(a.status)).length,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(timeline));
  } catch (error) {
    console.error('Error fetching project timeline:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch project timeline' }));
  }
}

/**
 * Helper: Format message type to human-readable action
 */
function formatMessageType(type: string): string {
  const typeMap: Record<string, string> = {
    task_assign: 'Task assigned',
    task_complete: 'Task completed',
    task_failed: 'Task failed',
    task_blocked: 'Task blocked',
    status_update: 'Status update',
    checkpoint: 'Checkpoint saved',
    mentor_suggestion: 'Mentor suggestion',
    broadcast: 'Broadcast message',
  };
  return typeMap[type] || type;
}
