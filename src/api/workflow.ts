/**
 * Workflow API Handlers
 * REST endpoints for workflow engine operations
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDatabase } from '../lib/database.js';
import {
  WorkflowEngine,
  getWorkflowEngine,
  createWorkflowEngine,
  WorkflowState,
  WorkflowPhase,
} from '../core/workflow/index.js';
import {
  getAutoTriggerService,
  triggerProjectBuild,
} from '../core/workflow/auto-trigger.js';
import type { Project, EklavyaConfig } from '../types/index.js';

// Helper to parse JSON body
async function parseBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}') as T);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Helper to send JSON response
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Get default workflow config from environment
function getDefaultWorkflowConfig(): EklavyaConfig {
  return {
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'eklavya',
      user: process.env.DB_USER || 'eklavya',
      password: process.env.DB_PASSWORD || '',
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
    defaultModel: 'claude-sonnet-4-20250514',
    maxConcurrentAgents: parseInt(process.env.MAX_CONCURRENT_AGENTS || '5', 10),
    checkpointIntervalMs: 15 * 60 * 1000,
    heartbeatIntervalMs: 30000,
    heartbeatTimeoutMs: 60000,
  };
}

/**
 * POST /api/projects/:id/build
 * Trigger build for a project
 */
export async function startBuild(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const db = getDatabase();

    // Verify project exists
    const projectResult = await db.query<Project>(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      sendJson(res, 404, { error: 'Project not found' });
      return;
    }

    const project = projectResult.rows[0];

    // Parse request body for options
    const body = await parseBody<{
      autoApprove?: boolean;
      demoOnly?: boolean;
      demoType?: 'wow' | 'trust' | 'milestone';
    }>(req);

    // Check if project is already building
    const activeStatuses = ['planning', 'architect', 'building', 'demo_building', 'approval_pending'];
    if (activeStatuses.includes(project.status)) {
      sendJson(res, 409, {
        error: 'Project is already being built',
        currentStatus: project.status,
      });
      return;
    }

    // Create workflow engine
    const config = getDefaultWorkflowConfig();
    const engine = createWorkflowEngine({
      config,
      autoApprove: body.autoApprove || false,
    });

    // Start build asynchronously (don't wait for completion)
    engine.startProjectBuild(projectId).catch((error) => {
      console.error(`Build failed for project ${projectId}:`, error.message);
    });

    sendJson(res, 202, {
      success: true,
      message: 'Build started',
      projectId,
      status: 'planning',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to start build for project ${projectId}:`, message);
    sendJson(res, 500, { error: 'Failed to start build', details: message });
  }
}

/**
 * GET /api/projects/:id/workflow
 * Get workflow state for a project
 */
export async function getWorkflowState(
  _req: IncomingMessage,
  res: ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const db = getDatabase();

    // Get project status
    const projectResult = await db.query<Project>(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      sendJson(res, 404, { error: 'Project not found' });
      return;
    }

    const project = projectResult.rows[0];

    // Get latest architect output if exists
    const architectResult = await db.query<{
      id: string;
      architecture: string;
      task_breakdown: string;
      estimated_effort: string;
      created_at: Date;
    }>(
      'SELECT * FROM architect_outputs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
      [projectId]
    );

    // Get active demos
    const demosResult = await db.query<{
      id: string;
      type: string;
      status: string;
      version: number;
      created_at: Date;
    }>(
      "SELECT id, type, status, version, created_at FROM demos WHERE project_id = $1 AND status != 'archived' ORDER BY version DESC",
      [projectId]
    );

    // Get active agents
    const agentsResult = await db.query<{
      id: string;
      type: string;
      status: string;
    }>(
      "SELECT id, type, status FROM agents WHERE project_id = $1 AND status IN ('idle', 'working', 'blocked')",
      [projectId]
    );

    // Get task stats
    const taskStatsResult = await db.query<{
      status: string;
      count: string;
    }>(
      'SELECT status, COUNT(*) as count FROM tasks WHERE project_id = $1 GROUP BY status',
      [projectId]
    );

    const taskStats: Record<string, number> = {};
    for (const row of taskStatsResult.rows) {
      taskStats[row.status] = parseInt(row.count, 10);
    }

    const workflowState = {
      projectId,
      projectName: project.name,
      phase: project.status as WorkflowPhase,
      startedAt: project.createdAt,
      lastUpdatedAt: project.updatedAt,
      architect: architectResult.rows.length > 0 ? {
        id: architectResult.rows[0].id,
        createdAt: architectResult.rows[0].created_at,
        hasArchitecture: true,
        taskCount: JSON.parse(architectResult.rows[0].task_breakdown || '[]').length,
      } : null,
      demos: demosResult.rows.map(d => ({
        id: d.id,
        type: d.type,
        status: d.status,
        version: d.version,
      })),
      agents: {
        active: agentsResult.rows.length,
        types: agentsResult.rows.map(a => a.type),
      },
      tasks: taskStats,
      budget: {
        limit: project.budgetCostUsd,
        used: project.costUsed,
      },
    };

    sendJson(res, 200, workflowState);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to get workflow state for project ${projectId}:`, message);
    sendJson(res, 500, { error: 'Failed to get workflow state', details: message });
  }
}

/**
 * POST /api/projects/:id/workflow/cancel
 * Cancel a running workflow
 */
export async function cancelWorkflow(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const body = await parseBody<{ reason?: string }>(req);

    // Try to get existing engine
    let engine: WorkflowEngine;
    try {
      engine = getWorkflowEngine();
    } catch {
      // Engine not initialized - just update project status
      const db = getDatabase();
      await db.query(
        "UPDATE projects SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
        [projectId]
      );

      sendJson(res, 200, {
        success: true,
        message: 'Project status updated to cancelled',
        projectId,
      });
      return;
    }

    await engine.cancelWorkflow(projectId, body.reason);

    sendJson(res, 200, {
      success: true,
      message: 'Workflow cancelled',
      projectId,
      reason: body.reason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to cancel workflow for project ${projectId}:`, message);
    sendJson(res, 500, { error: 'Failed to cancel workflow', details: message });
  }
}

/**
 * POST /api/projects/:id/workflow/resume
 * Resume a paused or failed workflow
 */
export async function resumeWorkflow(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const db = getDatabase();

    // Verify project exists and is in a resumable state
    const projectResult = await db.query<Project>(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      sendJson(res, 404, { error: 'Project not found' });
      return;
    }

    const project = projectResult.rows[0];
    const resumableStatuses = ['failed', 'cancelled', 'approval_pending'];

    if (!resumableStatuses.includes(project.status)) {
      sendJson(res, 400, {
        error: 'Project cannot be resumed',
        currentStatus: project.status,
        resumableStatuses,
      });
      return;
    }

    // Parse options
    const body = await parseBody<{
      autoApprove?: boolean;
      skipToPhase?: WorkflowPhase;
    }>(req);

    // Create new workflow engine and restart
    const config = getDefaultWorkflowConfig();
    const engine = createWorkflowEngine({
      config,
      autoApprove: body.autoApprove || false,
    });

    // Reset project status to planning
    await db.query(
      "UPDATE projects SET status = 'planning', updated_at = NOW() WHERE id = $1",
      [projectId]
    );

    // Start build asynchronously
    engine.startProjectBuild(projectId).catch((error) => {
      console.error(`Resume failed for project ${projectId}:`, error.message);
    });

    sendJson(res, 202, {
      success: true,
      message: 'Workflow resumed',
      projectId,
      status: 'planning',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to resume workflow for project ${projectId}:`, message);
    sendJson(res, 500, { error: 'Failed to resume workflow', details: message });
  }
}

/**
 * GET /api/workflow/active
 * Get all active workflows
 */
export async function getActiveWorkflows(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const db = getDatabase();

    const activeStatuses = [
      'planning',
      'architect',
      'building',
      'demo_building',
      'demo_ready',
      'approval_pending',
      'testing',
    ];

    const result = await db.query<{
      id: string;
      name: string;
      status: string;
      created_at: Date;
      updated_at: Date;
      budget_cost_usd: number;
      cost_used: number;
    }>(
      `SELECT id, name, status, created_at, updated_at, budget_cost_usd, cost_used
       FROM projects
       WHERE status = ANY($1)
       ORDER BY updated_at DESC`,
      [activeStatuses]
    );

    const workflows = result.rows.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      phase: p.status,
      startedAt: p.created_at,
      lastUpdatedAt: p.updated_at,
      budget: {
        limit: p.budget_cost_usd,
        used: p.cost_used,
      },
    }));

    sendJson(res, 200, {
      count: workflows.length,
      workflows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to get active workflows:', message);
    sendJson(res, 500, { error: 'Failed to get active workflows', details: message });
  }
}

/**
 * GET /api/workflow/stats
 * Get workflow statistics
 */
export async function getWorkflowStats(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const db = getDatabase();

    // Get project counts by status
    const statusResult = await db.query<{
      status: string;
      count: string;
    }>(
      'SELECT status, COUNT(*) as count FROM projects GROUP BY status'
    );

    const statusCounts: Record<string, number> = {};
    for (const row of statusResult.rows) {
      statusCounts[row.status] = parseInt(row.count, 10);
    }

    // Get completion rate
    const completedCount = statusCounts['completed'] || 0;
    const failedCount = statusCounts['failed'] || 0;
    const totalFinished = completedCount + failedCount;
    const completionRate = totalFinished > 0 ? completedCount / totalFinished : 0;

    // Get average build time for completed projects
    const avgTimeResult = await db.query<{
      avg_hours: string;
    }>(
      `SELECT EXTRACT(EPOCH FROM AVG(updated_at - created_at)) / 3600 as avg_hours
       FROM projects
       WHERE status = 'completed'`
    );

    const avgBuildTimeHours = avgTimeResult.rows[0]?.avg_hours
      ? parseFloat(avgTimeResult.rows[0].avg_hours)
      : null;

    // Get agent stats
    const agentResult = await db.query<{
      type: string;
      total: string;
      active: string;
    }>(
      `SELECT type,
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE status IN ('idle', 'working')) as active
       FROM agents
       GROUP BY type`
    );

    const agentStats: Record<string, { total: number; active: number }> = {};
    for (const row of agentResult.rows) {
      agentStats[row.type] = {
        total: parseInt(row.total, 10),
        active: parseInt(row.active, 10),
      };
    }

    sendJson(res, 200, {
      projects: statusCounts,
      completionRate,
      avgBuildTimeHours,
      agents: agentStats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to get workflow stats:', message);
    sendJson(res, 500, { error: 'Failed to get workflow stats', details: message });
  }
}

/**
 * POST /api/workflow/auto-trigger/enable
 * Enable auto-trigger for project creation
 */
export async function enableAutoTrigger(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await parseBody<{
      autoStartBuild?: boolean;
      notifyOnTrigger?: boolean;
    }>(req);

    const service = getAutoTriggerService();

    service.setEnabled(true);
    if (body.autoStartBuild !== undefined) {
      service.setAutoStartBuild(body.autoStartBuild);
    }

    // Start listening if not already
    if (!service.isActive()) {
      const config = getDefaultWorkflowConfig();
      service.setWorkflowConfig(config);
      await service.startListening();
    }

    sendJson(res, 200, {
      success: true,
      message: 'Auto-trigger enabled',
      config: service.getConfig(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to enable auto-trigger:', message);
    sendJson(res, 500, { error: 'Failed to enable auto-trigger', details: message });
  }
}

/**
 * POST /api/workflow/auto-trigger/disable
 * Disable auto-trigger
 */
export async function disableAutoTrigger(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const service = getAutoTriggerService();

    service.setEnabled(false);
    await service.stopListening();

    sendJson(res, 200, {
      success: true,
      message: 'Auto-trigger disabled',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to disable auto-trigger:', message);
    sendJson(res, 500, { error: 'Failed to disable auto-trigger', details: message });
  }
}

/**
 * GET /api/workflow/auto-trigger/status
 * Get auto-trigger status
 */
export async function getAutoTriggerStatus(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const service = getAutoTriggerService();

    sendJson(res, 200, {
      active: service.isActive(),
      config: service.getConfig(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to get auto-trigger status:', message);
    sendJson(res, 500, { error: 'Failed to get auto-trigger status', details: message });
  }
}
