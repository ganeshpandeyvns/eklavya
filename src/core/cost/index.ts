import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../lib/database.js';
import { getNotificationService, NotificationLevel } from '../notifications/index.js';

/**
 * API call record for cost tracking
 */
export interface ApiCallRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  agentId?: string;
  taskId?: string;
  requestType?: 'completion' | 'embedding' | 'vision' | 'other';
  durationMs?: number;
  cached?: boolean;
  timestamp?: Date;
}

/**
 * Cost summary for a project
 */
export interface CostSummary {
  totalCost: number;
  tokenCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  apiCalls: number;
  budgetLimit: number;
  budgetRemaining: number;
  budgetPercent: number;
  byModel: Record<string, number>;
  byDay: Record<string, number>;
  byAgent: Record<string, number>;
}

/**
 * Budget status information
 */
export interface BudgetStatus {
  withinBudget: boolean;
  currentSpend: number;
  budgetLimit: number;
  percentUsed: number;
  remaining: number;
  status: 'healthy' | 'caution' | 'warning' | 'critical' | 'exceeded';
}

/**
 * Cost event for detailed tracking
 */
export interface CostEvent {
  id: string;
  projectId: string;
  agentId?: string;
  taskId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  requestType?: string;
  durationMs?: number;
  cached: boolean;
  createdAt: Date;
}

/**
 * Daily cost summary
 */
export interface DailySummary {
  date: string;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  apiCalls: number;
  costByModel: Record<string, number>;
}

/**
 * Model pricing configuration
 */
export interface ModelPricing {
  model: string;
  provider: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  cachedInputPricePer1k?: number;
  cachedOutputPricePer1k?: number;
}

/**
 * Default model pricing (fallback when database not available)
 */
const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': {
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    cachedInputPricePer1k: 0.0003,
    cachedOutputPricePer1k: 0.015,
  },
  'claude-opus-4-5-20251101': {
    model: 'claude-opus-4-5-20251101',
    provider: 'anthropic',
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    cachedInputPricePer1k: 0.0015,
    cachedOutputPricePer1k: 0.075,
  },
  'claude-3-haiku-20240307': {
    model: 'claude-3-haiku-20240307',
    provider: 'anthropic',
    inputPricePer1k: 0.00025,
    outputPricePer1k: 0.00125,
    cachedInputPricePer1k: 0.000025,
    cachedOutputPricePer1k: 0.00125,
  },
  'claude-3-5-sonnet-20241022': {
    model: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    cachedInputPricePer1k: 0.0003,
    cachedOutputPricePer1k: 0.015,
  },
};

/**
 * Budget threshold configuration
 */
const BUDGET_THRESHOLDS = [
  { percent: 50, level: 'caution' as const, notification: 'info' as NotificationLevel },
  { percent: 75, level: 'warning' as const, notification: 'needs_input' as NotificationLevel },
  { percent: 90, level: 'critical' as const, notification: 'critical' as NotificationLevel },
  { percent: 100, level: 'exceeded' as const, notification: 'critical' as NotificationLevel },
];

/**
 * Cost Tracking Service
 * Provides comprehensive cost tracking, budget enforcement, and alerting
 */
export class CostTracker extends EventEmitter {
  private pricingCache: Map<string, ModelPricing> = new Map();
  private lastAlertThreshold: Map<string, number> = new Map();

  constructor() {
    super();
    this.initializePricingCache();
  }

  /**
   * Initialize pricing cache with default values
   */
  private initializePricingCache(): void {
    for (const [model, pricing] of Object.entries(DEFAULT_MODEL_PRICING)) {
      this.pricingCache.set(model, pricing);
    }
  }

  /**
   * Load pricing from database
   */
  async loadPricing(): Promise<void> {
    try {
      const db = getDatabase();
      const result = await db.query<{
        model: string;
        provider: string;
        input_price_per_1k: string;
        output_price_per_1k: string;
        cached_input_price_per_1k: string | null;
        cached_output_price_per_1k: string | null;
      }>(
        'SELECT model, provider, input_price_per_1k, output_price_per_1k, cached_input_price_per_1k, cached_output_price_per_1k FROM model_pricing WHERE active = true'
      );

      for (const row of result.rows) {
        this.pricingCache.set(row.model, {
          model: row.model,
          provider: row.provider,
          inputPricePer1k: parseFloat(row.input_price_per_1k),
          outputPricePer1k: parseFloat(row.output_price_per_1k),
          cachedInputPricePer1k: row.cached_input_price_per_1k ? parseFloat(row.cached_input_price_per_1k) : undefined,
          cachedOutputPricePer1k: row.cached_output_price_per_1k ? parseFloat(row.cached_output_price_per_1k) : undefined,
        });
      }
    } catch (error) {
      console.error('Failed to load pricing from database, using defaults:', error);
    }
  }

  /**
   * Calculate cost for an API call
   */
  calculateTokenCost(tokens: number, model: string, isOutput: boolean = false, cached: boolean = false): number {
    const pricing = this.pricingCache.get(model) || DEFAULT_MODEL_PRICING['claude-sonnet-4-20250514'];

    let pricePerK: number;
    if (isOutput) {
      pricePerK = cached && pricing.cachedOutputPricePer1k
        ? pricing.cachedOutputPricePer1k
        : pricing.outputPricePer1k;
    } else {
      pricePerK = cached && pricing.cachedInputPricePer1k
        ? pricing.cachedInputPricePer1k
        : pricing.inputPricePer1k;
    }

    return (tokens / 1000) * pricePerK;
  }

  /**
   * Calculate total cost for an API call
   */
  calculateApiCallCost(inputTokens: number, outputTokens: number, model: string, cached: boolean = false): number {
    const inputCost = this.calculateTokenCost(inputTokens, model, false, cached);
    const outputCost = this.calculateTokenCost(outputTokens, model, true, cached);
    return inputCost + outputCost;
  }

  /**
   * Record an API call and its costs
   */
  async recordApiCall(projectId: string, call: ApiCallRecord): Promise<CostEvent> {
    const db = getDatabase();
    const cost = this.calculateApiCallCost(call.inputTokens, call.outputTokens, call.model, call.cached);

    // Use database function for atomic operation
    const result = await db.query<{ id: string }>(
      `SELECT record_cost_event($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`,
      [
        projectId,
        call.agentId || null,
        call.taskId || null,
        call.model,
        call.inputTokens,
        call.outputTokens,
        call.requestType || 'completion',
        call.durationMs || null,
        call.cached || false,
      ]
    );

    const eventId = result.rows[0]?.id;

    const costEvent: CostEvent = {
      id: eventId || uuidv4(),
      projectId,
      agentId: call.agentId,
      taskId: call.taskId,
      model: call.model,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      totalTokens: call.inputTokens + call.outputTokens,
      costUsd: cost,
      requestType: call.requestType,
      durationMs: call.durationMs,
      cached: call.cached || false,
      createdAt: call.timestamp || new Date(),
    };

    // Emit event for real-time updates
    this.emit('cost:recorded', costEvent);

    // Check budget and send alerts if needed
    await this.checkAndAlertBudget(projectId);

    return costEvent;
  }

  /**
   * Get project cost summary
   */
  async getProjectCost(projectId: string): Promise<CostSummary> {
    const db = getDatabase();

    const result = await db.query<{
      total_cost: string;
      token_cost: string;
      total_tokens: string;
      input_tokens: string;
      output_tokens: string;
      api_calls: string;
      budget_limit: string;
      budget_remaining: string;
      budget_percent: string;
      cost_by_model: Record<string, number>;
      cost_by_day: Record<string, number>;
      cost_by_agent: Record<string, number>;
    }>(
      'SELECT * FROM get_project_cost_summary($1)',
      [projectId]
    );

    if (result.rows.length === 0) {
      return {
        totalCost: 0,
        tokenCost: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        apiCalls: 0,
        budgetLimit: 100,
        budgetRemaining: 100,
        budgetPercent: 0,
        byModel: {},
        byDay: {},
        byAgent: {},
      };
    }

    const row = result.rows[0];
    return {
      totalCost: parseFloat(row.total_cost),
      tokenCost: parseFloat(row.token_cost),
      totalTokens: parseInt(row.total_tokens, 10),
      inputTokens: parseInt(row.input_tokens, 10),
      outputTokens: parseInt(row.output_tokens, 10),
      apiCalls: parseInt(row.api_calls, 10),
      budgetLimit: parseFloat(row.budget_limit),
      budgetRemaining: parseFloat(row.budget_remaining),
      budgetPercent: parseFloat(row.budget_percent),
      byModel: row.cost_by_model || {},
      byDay: row.cost_by_day || {},
      byAgent: row.cost_by_agent || {},
    };
  }

  /**
   * Check budget status
   */
  async checkBudget(projectId: string): Promise<BudgetStatus> {
    const db = getDatabase();

    const result = await db.query<{
      within_budget: boolean;
      current_spend: string;
      budget_limit: string;
      percent_used: string;
      remaining: string;
      status: string;
    }>(
      'SELECT * FROM check_budget_status($1)',
      [projectId]
    );

    if (result.rows.length === 0) {
      return {
        withinBudget: true,
        currentSpend: 0,
        budgetLimit: 100,
        percentUsed: 0,
        remaining: 100,
        status: 'healthy',
      };
    }

    const row = result.rows[0];
    return {
      withinBudget: row.within_budget,
      currentSpend: parseFloat(row.current_spend),
      budgetLimit: parseFloat(row.budget_limit),
      percentUsed: parseFloat(row.percent_used),
      remaining: parseFloat(row.remaining),
      status: row.status as BudgetStatus['status'],
    };
  }

  /**
   * Enforce budget limit - returns true if spending allowed
   */
  async enforceBudgetLimit(projectId: string): Promise<boolean> {
    const status = await this.checkBudget(projectId);

    if (!status.withinBudget) {
      this.emit('budget:exceeded', { projectId, status });
      return false;
    }

    return true;
  }

  /**
   * Check budget and send alerts if thresholds crossed
   */
  private async checkAndAlertBudget(projectId: string): Promise<void> {
    const status = await this.checkBudget(projectId);
    const lastThreshold = this.lastAlertThreshold.get(projectId) || 0;

    for (const threshold of BUDGET_THRESHOLDS) {
      if (status.percentUsed >= threshold.percent && threshold.percent > lastThreshold) {
        await this.sendBudgetAlert(projectId, threshold.percent);
        this.lastAlertThreshold.set(projectId, threshold.percent);
        break;
      }
    }
  }

  /**
   * Send budget alert notification
   */
  async sendBudgetAlert(projectId: string, threshold: number): Promise<void> {
    try {
      const status = await this.checkBudget(projectId);
      const db = getDatabase();

      // Get project name
      const projectResult = await db.query<{ name: string }>(
        'SELECT name FROM projects WHERE id = $1',
        [projectId]
      );
      const projectName = projectResult.rows[0]?.name || 'Unknown Project';

      // Determine notification level
      const thresholdConfig = BUDGET_THRESHOLDS.find(t => t.percent === threshold);
      const level = thresholdConfig?.notification || 'info';

      // Create notification
      const notificationService = getNotificationService();
      await notificationService.createNotification(
        projectId,
        level,
        'budget_alert',
        `Budget Alert: ${threshold}% Used`,
        {
          message: `Project "${projectName}" has used ${status.percentUsed.toFixed(1)}% of its budget ($${status.currentSpend.toFixed(2)} of $${status.budgetLimit.toFixed(2)})`,
          metadata: {
            threshold,
            currentSpend: status.currentSpend,
            budgetLimit: status.budgetLimit,
            remaining: status.remaining,
          },
        }
      );

      // Emit event
      this.emit('budget:alert', {
        projectId,
        projectName,
        threshold,
        status,
      });
    } catch (error) {
      console.error('Failed to send budget alert:', error);
    }
  }

  /**
   * Get cost events for a project
   */
  async getCostEvents(
    projectId: string,
    options: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
      agentId?: string;
      model?: string;
    } = {}
  ): Promise<CostEvent[]> {
    const db = getDatabase();
    const { limit = 100, offset = 0, startDate, endDate, agentId, model } = options;

    let query = `
      SELECT id, project_id, agent_id, task_id, model,
             input_tokens, output_tokens, total_tokens, cost_usd,
             request_type, duration_ms, cached, created_at
      FROM cost_events
      WHERE project_id = $1
    `;
    const params: unknown[] = [projectId];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    if (agentId) {
      query += ` AND agent_id = $${paramIndex}`;
      params.push(agentId);
      paramIndex++;
    }

    if (model) {
      query += ` AND model = $${paramIndex}`;
      params.push(model);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query<{
      id: string;
      project_id: string;
      agent_id: string | null;
      task_id: string | null;
      model: string;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cost_usd: string;
      request_type: string | null;
      duration_ms: number | null;
      cached: boolean;
      created_at: Date;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      agentId: row.agent_id || undefined,
      taskId: row.task_id || undefined,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      costUsd: parseFloat(row.cost_usd),
      requestType: row.request_type || undefined,
      durationMs: row.duration_ms || undefined,
      cached: row.cached,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get daily cost summaries
   */
  async getDailySummaries(
    projectId: string,
    days: number = 30
  ): Promise<DailySummary[]> {
    const db = getDatabase();

    const result = await db.query<{
      summary_date: Date;
      total_cost: string;
      total_tokens: number;
      input_tokens: number;
      output_tokens: number;
      api_calls: number;
      cost_by_model: Record<string, number>;
    }>(
      `SELECT summary_date, total_cost, total_tokens, input_tokens, output_tokens, api_calls, cost_by_model
       FROM cost_daily_summary
       WHERE project_id = $1 AND summary_date >= CURRENT_DATE - $2::INTEGER
       ORDER BY summary_date DESC`,
      [projectId, days]
    );

    return result.rows.map(row => ({
      date: row.summary_date.toISOString().split('T')[0],
      totalCost: parseFloat(row.total_cost),
      totalTokens: row.total_tokens,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      apiCalls: row.api_calls,
      costByModel: row.cost_by_model || {},
    }));
  }

  /**
   * Get cost by agent type
   */
  async getCostByAgentType(projectId: string): Promise<Record<string, number>> {
    const db = getDatabase();

    const result = await db.query<{
      agent_type: string;
      total_cost: string;
    }>(
      `SELECT a.type as agent_type, SUM(ce.cost_usd) as total_cost
       FROM cost_events ce
       JOIN agents a ON ce.agent_id = a.id
       WHERE ce.project_id = $1
       GROUP BY a.type
       ORDER BY total_cost DESC`,
      [projectId]
    );

    const costByType: Record<string, number> = {};
    for (const row of result.rows) {
      costByType[row.agent_type] = parseFloat(row.total_cost);
    }
    return costByType;
  }

  /**
   * Update project budget
   */
  async updateBudget(projectId: string, newBudget: number): Promise<void> {
    const db = getDatabase();

    await db.query(
      'UPDATE projects SET budget_cost_usd = $1, updated_at = NOW() WHERE id = $2',
      [newBudget, projectId]
    );

    // Reset alert threshold tracking for this project
    this.lastAlertThreshold.delete(projectId);

    this.emit('budget:updated', { projectId, newBudget });
  }

  /**
   * Acknowledge a budget alert
   */
  async acknowledgeBudgetAlert(alertId: string, acknowledgedBy?: string): Promise<void> {
    const db = getDatabase();

    await db.query(
      `UPDATE budget_alerts
       SET acknowledged = true, acknowledged_at = NOW(), acknowledged_by = $1
       WHERE id = $2`,
      [acknowledgedBy || 'admin', alertId]
    );
  }

  /**
   * Get unacknowledged budget alerts
   */
  async getUnacknowledgedAlerts(projectId?: string): Promise<Array<{
    id: string;
    projectId: string;
    projectName: string;
    thresholdPercent: number;
    currentSpend: number;
    budgetLimit: number;
    createdAt: Date;
  }>> {
    const db = getDatabase();

    let query = `
      SELECT ba.id, ba.project_id, p.name as project_name,
             ba.threshold_percent, ba.current_spend, ba.budget_limit, ba.created_at
      FROM budget_alerts ba
      JOIN projects p ON ba.project_id = p.id
      WHERE ba.acknowledged = false
    `;
    const params: unknown[] = [];

    if (projectId) {
      query += ' AND ba.project_id = $1';
      params.push(projectId);
    }

    query += ' ORDER BY ba.created_at DESC';

    const result = await db.query<{
      id: string;
      project_id: string;
      project_name: string;
      threshold_percent: number;
      current_spend: string;
      budget_limit: string;
      created_at: Date;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      thresholdPercent: row.threshold_percent,
      currentSpend: parseFloat(row.current_spend),
      budgetLimit: parseFloat(row.budget_limit),
      createdAt: row.created_at,
    }));
  }

  /**
   * Get cost overview for all projects
   */
  async getCostOverview(): Promise<Array<{
    projectId: string;
    projectName: string;
    totalCost: number;
    totalTokens: number;
    budgetLimit: number;
    budgetPercent: number;
    apiCalls: number;
    todayCost: number;
  }>> {
    const db = getDatabase();

    const result = await db.query<{
      project_id: string;
      project_name: string;
      total_cost: string;
      total_tokens: string;
      budget_limit: string;
      budget_percent: string;
      api_calls: string;
      today_cost: string;
    }>(
      'SELECT * FROM cost_overview ORDER BY total_cost DESC'
    );

    return result.rows.map(row => ({
      projectId: row.project_id,
      projectName: row.project_name,
      totalCost: parseFloat(row.total_cost),
      totalTokens: parseInt(row.total_tokens, 10),
      budgetLimit: parseFloat(row.budget_limit),
      budgetPercent: parseFloat(row.budget_percent),
      apiCalls: parseInt(row.api_calls, 10),
      todayCost: parseFloat(row.today_cost),
    }));
  }

  /**
   * Get model pricing
   */
  getModelPricing(model: string): ModelPricing | undefined {
    return this.pricingCache.get(model);
  }

  /**
   * Get all model pricing
   */
  getAllModelPricing(): ModelPricing[] {
    return Array.from(this.pricingCache.values());
  }
}

// Singleton instance
let costTracker: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!costTracker) {
    costTracker = new CostTracker();
  }
  return costTracker;
}

export default CostTracker;
