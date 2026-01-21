import { IncomingMessage, ServerResponse } from 'http';
import { getCostTracker } from '../core/cost/index.js';

/**
 * Parse JSON body from request
 */
async function parseBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, data: unknown, status: number = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 */
function sendError(res: ServerResponse, message: string, status: number = 400): void {
  sendJson(res, { error: message }, status);
}

/**
 * Get project cost summary
 * GET /api/projects/:projectId/costs
 */
export async function getProjectCosts(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { projectId } = params;

    if (!projectId) {
      sendError(res, 'Project ID is required', 400);
      return;
    }

    const costTracker = getCostTracker();
    const summary = await costTracker.getProjectCost(projectId);

    sendJson(res, summary);
  } catch (error) {
    console.error('Error getting project costs:', error);
    sendError(res, 'Failed to get project costs', 500);
  }
}

/**
 * Get project budget status
 * GET /api/projects/:projectId/budget
 */
export async function getProjectBudget(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { projectId } = params;

    if (!projectId) {
      sendError(res, 'Project ID is required', 400);
      return;
    }

    const costTracker = getCostTracker();
    const status = await costTracker.checkBudget(projectId);

    sendJson(res, status);
  } catch (error) {
    console.error('Error getting project budget:', error);
    sendError(res, 'Failed to get project budget', 500);
  }
}

/**
 * Update project budget
 * PUT /api/projects/:projectId/budget
 */
export async function updateProjectBudget(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { projectId } = params;

    if (!projectId) {
      sendError(res, 'Project ID is required', 400);
      return;
    }

    const body = await parseBody<{ budget: number }>(req);

    if (typeof body.budget !== 'number' || body.budget < 0) {
      sendError(res, 'Valid budget amount is required', 400);
      return;
    }

    const costTracker = getCostTracker();
    await costTracker.updateBudget(projectId, body.budget);

    const status = await costTracker.checkBudget(projectId);
    sendJson(res, status);
  } catch (error) {
    console.error('Error updating project budget:', error);
    sendError(res, 'Failed to update project budget', 500);
  }
}

/**
 * Get cost events for a project
 * GET /api/projects/:projectId/cost-events
 */
export async function getCostEvents(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { projectId } = params;

    if (!projectId) {
      sendError(res, 'Project ID is required', 400);
      return;
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const agentId = url.searchParams.get('agentId') || undefined;
    const model = url.searchParams.get('model') || undefined;
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    const costTracker = getCostTracker();
    const events = await costTracker.getCostEvents(projectId, {
      limit,
      offset,
      agentId,
      model,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    sendJson(res, { events, limit, offset, count: events.length });
  } catch (error) {
    console.error('Error getting cost events:', error);
    sendError(res, 'Failed to get cost events', 500);
  }
}

/**
 * Get daily cost summaries
 * GET /api/projects/:projectId/cost-daily
 */
export async function getDailyCosts(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { projectId } = params;

    if (!projectId) {
      sendError(res, 'Project ID is required', 400);
      return;
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const days = parseInt(url.searchParams.get('days') || '30', 10);

    const costTracker = getCostTracker();
    const summaries = await costTracker.getDailySummaries(projectId, days);

    sendJson(res, { summaries, days });
  } catch (error) {
    console.error('Error getting daily costs:', error);
    sendError(res, 'Failed to get daily costs', 500);
  }
}

/**
 * Get cost by agent type
 * GET /api/projects/:projectId/cost-by-agent
 */
export async function getCostByAgentType(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { projectId } = params;

    if (!projectId) {
      sendError(res, 'Project ID is required', 400);
      return;
    }

    const costTracker = getCostTracker();
    const costByType = await costTracker.getCostByAgentType(projectId);

    sendJson(res, costByType);
  } catch (error) {
    console.error('Error getting cost by agent type:', error);
    sendError(res, 'Failed to get cost by agent type', 500);
  }
}

/**
 * Get cost overview for all projects
 * GET /api/costs/overview
 */
export async function getCostOverview(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const costTracker = getCostTracker();
    const overview = await costTracker.getCostOverview();

    sendJson(res, { projects: overview });
  } catch (error) {
    console.error('Error getting cost overview:', error);
    sendError(res, 'Failed to get cost overview', 500);
  }
}

/**
 * Get unacknowledged budget alerts
 * GET /api/costs/alerts
 */
export async function getBudgetAlerts(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId') || undefined;

    const costTracker = getCostTracker();
    const alerts = await costTracker.getUnacknowledgedAlerts(projectId);

    sendJson(res, { alerts });
  } catch (error) {
    console.error('Error getting budget alerts:', error);
    sendError(res, 'Failed to get budget alerts', 500);
  }
}

/**
 * Acknowledge a budget alert
 * POST /api/costs/alerts/:alertId/acknowledge
 */
export async function acknowledgeBudgetAlert(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { alertId } = params;

    if (!alertId) {
      sendError(res, 'Alert ID is required', 400);
      return;
    }

    const body = await parseBody<{ acknowledgedBy?: string }>(req);

    const costTracker = getCostTracker();
    await costTracker.acknowledgeBudgetAlert(alertId, body.acknowledgedBy);

    sendJson(res, { success: true });
  } catch (error) {
    console.error('Error acknowledging budget alert:', error);
    sendError(res, 'Failed to acknowledge budget alert', 500);
  }
}

/**
 * Record an API call (internal use)
 * POST /api/projects/:projectId/cost-event
 */
export async function recordCostEvent(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { projectId } = params;

    if (!projectId) {
      sendError(res, 'Project ID is required', 400);
      return;
    }

    const body = await parseBody<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      agentId?: string;
      taskId?: string;
      requestType?: string;
      durationMs?: number;
      cached?: boolean;
    }>(req);

    if (!body.model || typeof body.inputTokens !== 'number' || typeof body.outputTokens !== 'number') {
      sendError(res, 'model, inputTokens, and outputTokens are required', 400);
      return;
    }

    const costTracker = getCostTracker();
    const event = await costTracker.recordApiCall(projectId, {
      model: body.model,
      inputTokens: body.inputTokens,
      outputTokens: body.outputTokens,
      agentId: body.agentId,
      taskId: body.taskId,
      requestType: body.requestType as 'completion' | 'embedding' | 'vision' | 'other',
      durationMs: body.durationMs,
      cached: body.cached,
    });

    sendJson(res, event, 201);
  } catch (error) {
    console.error('Error recording cost event:', error);
    sendError(res, 'Failed to record cost event', 500);
  }
}

/**
 * Get model pricing
 * GET /api/costs/pricing
 */
export async function getModelPricing(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const costTracker = getCostTracker();
    const pricing = costTracker.getAllModelPricing();

    sendJson(res, { models: pricing });
  } catch (error) {
    console.error('Error getting model pricing:', error);
    sendError(res, 'Failed to get model pricing', 500);
  }
}
