import { IncomingMessage, ServerResponse } from 'http';
import { getLearningMetrics } from '../core/learning/metrics.js';
import type { AgentType } from '../types/index.js';

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
 * Get aggregate learning metrics
 * GET /api/learning/metrics
 */
export async function getAggregateLearningMetrics(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const metrics = getLearningMetrics();
    const aggregate = await metrics.getAggregateLearningMetrics();

    sendJson(res, aggregate);
  } catch (error) {
    console.error('Error getting aggregate learning metrics:', error);
    sendError(res, 'Failed to get learning metrics', 500);
  }
}

/**
 * Get prompt performance
 * GET /api/learning/prompts/:promptId
 */
export async function getPromptPerformance(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { promptId } = params;

    if (!promptId) {
      sendError(res, 'Prompt ID is required', 400);
      return;
    }

    const metrics = getLearningMetrics();
    const performance = await metrics.getPromptPerformance(promptId);

    if (!performance) {
      sendError(res, 'Prompt not found', 404);
      return;
    }

    sendJson(res, performance);
  } catch (error) {
    console.error('Error getting prompt performance:', error);
    sendError(res, 'Failed to get prompt performance', 500);
  }
}

/**
 * Get prompt comparison for an agent type
 * GET /api/learning/comparison/:agentType
 */
export async function getPromptComparison(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { agentType } = params;

    if (!agentType) {
      sendError(res, 'Agent type is required', 400);
      return;
    }

    const metrics = getLearningMetrics();
    const comparison = await metrics.getPromptComparison(agentType as AgentType);

    sendJson(res, comparison);
  } catch (error) {
    console.error('Error getting prompt comparison:', error);
    sendError(res, 'Failed to get prompt comparison', 500);
  }
}

/**
 * Get performance trend for a prompt
 * GET /api/learning/prompts/:promptId/trend
 */
export async function getPromptTrend(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { promptId } = params;

    if (!promptId) {
      sendError(res, 'Prompt ID is required', 400);
      return;
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const days = parseInt(url.searchParams.get('days') || '30', 10);

    const metrics = getLearningMetrics();
    const trend = await metrics.getPerformanceTrend(promptId, days);

    if (!trend) {
      sendError(res, 'Prompt not found', 404);
      return;
    }

    sendJson(res, trend);
  } catch (error) {
    console.error('Error getting prompt trend:', error);
    sendError(res, 'Failed to get prompt trend', 500);
  }
}

/**
 * List experiments
 * GET /api/learning/experiments
 */
export async function listExperiments(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const status = url.searchParams.get('status') as 'running' | 'completed' | 'stopped' | 'inconclusive' | null;

    const metrics = getLearningMetrics();
    const experiments = await metrics.listExperiments(status || undefined);

    sendJson(res, { experiments });
  } catch (error) {
    console.error('Error listing experiments:', error);
    sendError(res, 'Failed to list experiments', 500);
  }
}

/**
 * Create a new experiment
 * POST /api/learning/experiments
 */
export async function createExperiment(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await parseBody<{
      name: string;
      description?: string;
      agentType: AgentType;
      controlPromptId: string;
      treatmentPromptId: string;
      trafficSplit?: number;
      minSampleSize?: number;
      maxDurationDays?: number;
      successMetric?: 'success_rate' | 'avg_reward' | 'completion_time';
    }>(req);

    if (!body.name || !body.agentType || !body.controlPromptId || !body.treatmentPromptId) {
      sendError(res, 'name, agentType, controlPromptId, and treatmentPromptId are required', 400);
      return;
    }

    const metrics = getLearningMetrics();
    const experiment = await metrics.createExperiment({
      name: body.name,
      description: body.description,
      agentType: body.agentType,
      controlPromptId: body.controlPromptId,
      treatmentPromptId: body.treatmentPromptId,
      trafficSplit: body.trafficSplit || 0.5,
      minSampleSize: body.minSampleSize || 100,
      maxDurationDays: body.maxDurationDays,
      successMetric: body.successMetric || 'success_rate',
    });

    sendJson(res, experiment, 201);
  } catch (error) {
    console.error('Error creating experiment:', error);
    sendError(res, 'Failed to create experiment', 500);
  }
}

/**
 * Get experiment results
 * GET /api/learning/experiments/:experimentId
 */
export async function getExperimentResults(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { experimentId } = params;

    if (!experimentId) {
      sendError(res, 'Experiment ID is required', 400);
      return;
    }

    const metrics = getLearningMetrics();
    const results = await metrics.getExperimentResults(experimentId);

    if (!results) {
      sendError(res, 'Experiment not found', 404);
      return;
    }

    sendJson(res, results);
  } catch (error) {
    console.error('Error getting experiment results:', error);
    sendError(res, 'Failed to get experiment results', 500);
  }
}

/**
 * Stop an experiment
 * POST /api/learning/experiments/:experimentId/stop
 */
export async function stopExperiment(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  try {
    const { experimentId } = params;

    if (!experimentId) {
      sendError(res, 'Experiment ID is required', 400);
      return;
    }

    const metrics = getLearningMetrics();
    await metrics.stopExperiment(experimentId);

    sendJson(res, { success: true });
  } catch (error) {
    console.error('Error stopping experiment:', error);
    sendError(res, 'Failed to stop experiment', 500);
  }
}

/**
 * Get all prompt comparisons (for dashboard)
 * GET /api/learning/comparisons
 */
export async function getAllPromptComparisons(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const agentTypes: AgentType[] = [
      'orchestrator', 'architect', 'developer', 'tester',
      'qa', 'pm', 'uat', 'sre', 'monitor', 'mentor'
    ];

    const metrics = getLearningMetrics();
    const comparisons: Record<string, unknown> = {};

    for (const agentType of agentTypes) {
      try {
        comparisons[agentType] = await metrics.getPromptComparison(agentType);
      } catch {
        // Skip agent types with no prompts
      }
    }

    sendJson(res, { comparisons });
  } catch (error) {
    console.error('Error getting all prompt comparisons:', error);
    sendError(res, 'Failed to get prompt comparisons', 500);
  }
}
