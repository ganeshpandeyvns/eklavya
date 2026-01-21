import { v4 as uuidv4 } from 'uuid';
import type { AgentType, PromptStatus } from '../../types/index.js';
import { getDatabase } from '../../lib/database.js';

/**
 * Prompt performance metrics
 */
export interface PromptMetrics {
  promptId: string;
  agentType: AgentType;
  version: number;
  status: PromptStatus;
  totalUses: number;
  successfulUses: number;
  successRate: number;
  averageReward: number;
  confidenceInterval: [number, number];
  thompsonScore: number;
  recentTrend: 'improving' | 'stable' | 'declining';
  lastUsed?: Date;
  avgCompletionTimeMs?: number;
}

/**
 * Comparison report for prompts
 */
export interface ComparisonReport {
  agentType: AgentType;
  totalPrompts: number;
  productionPrompt?: PromptMetrics;
  candidatePrompts: PromptMetrics[];
  experimentalPrompts: PromptMetrics[];
  bestPerformer: PromptMetrics | null;
  recommendations: string[];
}

/**
 * Trend data for a prompt
 */
export interface TrendData {
  promptId: string;
  agentType: AgentType;
  points: Array<{
    date: string;
    successRate: number;
    avgReward: number;
    uses: number;
  }>;
  overallTrend: 'improving' | 'stable' | 'declining';
  volatility: number;
}

/**
 * Experiment configuration
 */
export interface ExperimentConfig {
  name: string;
  description?: string;
  agentType: AgentType;
  controlPromptId: string;
  treatmentPromptId: string;
  trafficSplit: number; // 0.0 to 1.0, portion going to treatment
  minSampleSize: number;
  maxDurationDays?: number;
  successMetric: 'success_rate' | 'avg_reward' | 'completion_time';
}

/**
 * Experiment status
 */
export type ExperimentStatus = 'running' | 'completed' | 'stopped' | 'inconclusive';

/**
 * Experiment model
 */
export interface Experiment {
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
  status: ExperimentStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Experiment results
 */
export interface ExperimentResults {
  experiment: Experiment;
  control: {
    promptId: string;
    samples: number;
    successRate: number;
    avgReward: number;
    avgCompletionTimeMs?: number;
  };
  treatment: {
    promptId: string;
    samples: number;
    successRate: number;
    avgReward: number;
    avgCompletionTimeMs?: number;
  };
  analysis: {
    winner: 'control' | 'treatment' | 'none';
    confidence: number;
    improvement: number;
    statSignificant: boolean;
    recommendation: string;
  };
}

/**
 * Learning metrics service
 * Provides comprehensive metrics and A/B testing for prompt evolution
 */
export class LearningMetrics {

  /**
   * Get comprehensive metrics for a prompt
   */
  async getPromptPerformance(promptId: string): Promise<PromptMetrics | null> {
    const db = getDatabase();

    // Get prompt base info
    const promptResult = await db.query<{
      id: string;
      agent_type: AgentType;
      version: number;
      status: PromptStatus;
      total_uses: number;
      successful_uses: number;
      alpha: number;
      beta: number;
      avg_task_completion_time: number | null;
      updated_at: Date;
    }>(
      `SELECT id, agent_type, version, status, total_uses, successful_uses,
              alpha, beta, avg_task_completion_time, updated_at
       FROM prompts WHERE id = $1`,
      [promptId]
    );

    if (promptResult.rows.length === 0) {
      return null;
    }

    const prompt = promptResult.rows[0];

    // Get reward stats
    const rewardResult = await db.query<{
      avg_reward: string;
      outcome_count: string;
    }>(
      `SELECT AVG(reward) as avg_reward, COUNT(*) as outcome_count
       FROM rl_outcomes WHERE prompt_id = $1`,
      [promptId]
    );

    const avgReward = parseFloat(rewardResult.rows[0]?.avg_reward || '0');

    // Calculate success rate
    const successRate = prompt.total_uses > 0
      ? prompt.successful_uses / prompt.total_uses
      : 0;

    // Calculate Thompson score (expected value from Beta distribution)
    const thompsonScore = prompt.alpha / (prompt.alpha + prompt.beta);

    // Calculate 95% confidence interval
    const n = prompt.total_uses || 1;
    const stderr = Math.sqrt((successRate * (1 - successRate)) / n);
    const confidenceInterval: [number, number] = [
      Math.max(0, successRate - 1.96 * stderr),
      Math.min(1, successRate + 1.96 * stderr),
    ];

    // Determine recent trend
    const trend = await this.calculateRecentTrend(promptId);

    return {
      promptId: prompt.id,
      agentType: prompt.agent_type,
      version: prompt.version,
      status: prompt.status,
      totalUses: prompt.total_uses,
      successfulUses: prompt.successful_uses,
      successRate,
      averageReward: avgReward,
      confidenceInterval,
      thompsonScore,
      recentTrend: trend,
      lastUsed: prompt.updated_at,
      avgCompletionTimeMs: prompt.avg_task_completion_time || undefined,
    };
  }

  /**
   * Calculate recent trend for a prompt
   */
  private async calculateRecentTrend(promptId: string): Promise<'improving' | 'stable' | 'declining'> {
    const db = getDatabase();

    // Get outcomes from last 7 days vs previous 7 days
    const result = await db.query<{
      period: string;
      avg_reward: string;
      count: string;
    }>(
      `SELECT
        CASE WHEN created_at >= CURRENT_DATE - 7 THEN 'recent' ELSE 'previous' END as period,
        AVG(reward) as avg_reward,
        COUNT(*) as count
       FROM rl_outcomes
       WHERE prompt_id = $1 AND created_at >= CURRENT_DATE - 14
       GROUP BY period`,
      [promptId]
    );

    const periods: Record<string, { avgReward: number; count: number }> = {};
    for (const row of result.rows) {
      periods[row.period] = {
        avgReward: parseFloat(row.avg_reward),
        count: parseInt(row.count, 10),
      };
    }

    const recent = periods['recent'];
    const previous = periods['previous'];

    if (!recent || recent.count < 3) {
      return 'stable';
    }

    if (!previous || previous.count < 3) {
      return 'stable';
    }

    const diff = recent.avgReward - previous.avgReward;
    const threshold = 0.1; // 10% change threshold

    if (diff > threshold) {
      return 'improving';
    } else if (diff < -threshold) {
      return 'declining';
    }
    return 'stable';
  }

  /**
   * Get comparison report for all prompts of an agent type
   */
  async getPromptComparison(agentType: AgentType): Promise<ComparisonReport> {
    const db = getDatabase();

    const result = await db.query<{
      id: string;
      version: number;
      status: PromptStatus;
      total_uses: number;
      successful_uses: number;
      alpha: number;
      beta: number;
    }>(
      `SELECT id, version, status, total_uses, successful_uses, alpha, beta
       FROM prompts WHERE agent_type = $1 AND status != 'deprecated'
       ORDER BY status, version DESC`,
      [agentType]
    );

    const metrics: PromptMetrics[] = [];
    for (const row of result.rows) {
      const promptMetrics = await this.getPromptPerformance(row.id);
      if (promptMetrics) {
        metrics.push(promptMetrics);
      }
    }

    const production = metrics.filter(m => m.status === 'production');
    const candidates = metrics.filter(m => m.status === 'candidate');
    const experimental = metrics.filter(m => m.status === 'experimental');

    // Find best performer based on Thompson score with sufficient data
    const qualifiedPrompts = metrics.filter(m => m.totalUses >= 10);
    const bestPerformer = qualifiedPrompts.length > 0
      ? qualifiedPrompts.reduce((best, current) =>
          current.thompsonScore > best.thompsonScore ? current : best
        )
      : null;

    // Generate recommendations
    const recommendations: string[] = [];

    if (production.length === 0) {
      recommendations.push('No production prompt exists. Consider promoting a candidate.');
    }

    if (candidates.length > 0) {
      const readyForPromotion = candidates.filter(c =>
        c.totalUses >= 50 && c.successRate >= 0.8
      );
      if (readyForPromotion.length > 0) {
        recommendations.push(
          `${readyForPromotion.length} candidate prompt(s) ready for promotion to production.`
        );
      }
    }

    if (bestPerformer && production.length > 0 && production[0].promptId !== bestPerformer.promptId) {
      if (bestPerformer.thompsonScore > production[0].thompsonScore * 1.1) {
        recommendations.push(
          `Prompt v${bestPerformer.version} is outperforming current production by ${((bestPerformer.thompsonScore / production[0].thompsonScore - 1) * 100).toFixed(1)}%.`
        );
      }
    }

    if (experimental.length === 0) {
      recommendations.push('No experimental prompts. Consider creating variants for testing.');
    }

    const decliningPrompts = metrics.filter(m => m.recentTrend === 'declining' && m.status === 'production');
    if (decliningPrompts.length > 0) {
      recommendations.push('Production prompt performance is declining. Monitor closely.');
    }

    return {
      agentType,
      totalPrompts: metrics.length,
      productionPrompt: production[0],
      candidatePrompts: candidates,
      experimentalPrompts: experimental,
      bestPerformer,
      recommendations,
    };
  }

  /**
   * Get performance trend data for a prompt
   */
  async getPerformanceTrend(promptId: string, days: number = 30): Promise<TrendData | null> {
    const db = getDatabase();

    // Get prompt info
    const promptResult = await db.query<{
      agent_type: AgentType;
    }>(
      'SELECT agent_type FROM prompts WHERE id = $1',
      [promptId]
    );

    if (promptResult.rows.length === 0) {
      return null;
    }

    // Get daily aggregated outcomes
    const result = await db.query<{
      day: Date;
      success_count: string;
      total_count: string;
      avg_reward: string;
    }>(
      `SELECT
        DATE(created_at) as day,
        COUNT(*) FILTER (WHERE outcome = 'success') as success_count,
        COUNT(*) as total_count,
        AVG(reward) as avg_reward
       FROM rl_outcomes
       WHERE prompt_id = $1 AND created_at >= CURRENT_DATE - $2
       GROUP BY DATE(created_at)
       ORDER BY day`,
      [promptId, days]
    );

    const points = result.rows.map(row => ({
      date: row.day.toISOString().split('T')[0],
      successRate: parseInt(row.total_count, 10) > 0
        ? parseInt(row.success_count, 10) / parseInt(row.total_count, 10)
        : 0,
      avgReward: parseFloat(row.avg_reward),
      uses: parseInt(row.total_count, 10),
    }));

    // Calculate overall trend using linear regression
    let overallTrend: 'improving' | 'stable' | 'declining' = 'stable';
    let volatility = 0;

    if (points.length >= 3) {
      const rewards = points.map(p => p.avgReward);
      const slope = this.calculateSlope(rewards);
      const avgReward = rewards.reduce((a, b) => a + b, 0) / rewards.length;

      // Calculate volatility (standard deviation)
      const variance = rewards.reduce((sum, r) => sum + Math.pow(r - avgReward, 2), 0) / rewards.length;
      volatility = Math.sqrt(variance);

      // Determine trend based on slope relative to volatility
      if (slope > volatility * 0.1) {
        overallTrend = 'improving';
      } else if (slope < -volatility * 0.1) {
        overallTrend = 'declining';
      }
    }

    return {
      promptId,
      agentType: promptResult.rows[0].agent_type,
      points,
      overallTrend,
      volatility,
    };
  }

  /**
   * Calculate linear regression slope
   */
  private calculateSlope(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  /**
   * Create a new A/B testing experiment
   */
  async createExperiment(config: ExperimentConfig): Promise<Experiment> {
    const db = getDatabase();

    const id = uuidv4();

    await db.query(
      `INSERT INTO experiments (id, name, description, agent_type, control_prompt_id,
                                treatment_prompt_id, traffic_split, min_sample_size,
                                max_duration_days, success_metric, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'running', NOW())`,
      [
        id,
        config.name,
        config.description || null,
        config.agentType,
        config.controlPromptId,
        config.treatmentPromptId,
        config.trafficSplit,
        config.minSampleSize,
        config.maxDurationDays || null,
        config.successMetric,
      ]
    );

    return {
      id,
      name: config.name,
      description: config.description,
      agentType: config.agentType,
      controlPromptId: config.controlPromptId,
      treatmentPromptId: config.treatmentPromptId,
      trafficSplit: config.trafficSplit,
      minSampleSize: config.minSampleSize,
      maxDurationDays: config.maxDurationDays,
      successMetric: config.successMetric,
      status: 'running',
      createdAt: new Date(),
    };
  }

  /**
   * Get experiment results
   */
  async getExperimentResults(experimentId: string): Promise<ExperimentResults | null> {
    const db = getDatabase();

    // Get experiment
    const expResult = await db.query<{
      id: string;
      name: string;
      description: string | null;
      agent_type: AgentType;
      control_prompt_id: string;
      treatment_prompt_id: string;
      traffic_split: string;
      min_sample_size: number;
      max_duration_days: number | null;
      success_metric: string;
      status: ExperimentStatus;
      created_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
    }>(
      'SELECT * FROM experiments WHERE id = $1',
      [experimentId]
    );

    if (expResult.rows.length === 0) {
      return null;
    }

    const exp = expResult.rows[0];

    // Get control stats
    const controlStats = await this.getPromptExperimentStats(exp.control_prompt_id, exp.created_at);

    // Get treatment stats
    const treatmentStats = await this.getPromptExperimentStats(exp.treatment_prompt_id, exp.created_at);

    // Perform statistical analysis
    const analysis = this.analyzeExperiment(
      controlStats,
      treatmentStats,
      exp.success_metric,
      exp.min_sample_size
    );

    // Update experiment status if complete
    if (
      controlStats.samples >= exp.min_sample_size &&
      treatmentStats.samples >= exp.min_sample_size &&
      exp.status === 'running'
    ) {
      await db.query(
        `UPDATE experiments SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [experimentId]
      );
    }

    return {
      experiment: {
        id: exp.id,
        name: exp.name,
        description: exp.description || undefined,
        agentType: exp.agent_type,
        controlPromptId: exp.control_prompt_id,
        treatmentPromptId: exp.treatment_prompt_id,
        trafficSplit: parseFloat(exp.traffic_split),
        minSampleSize: exp.min_sample_size,
        maxDurationDays: exp.max_duration_days || undefined,
        successMetric: exp.success_metric,
        status: exp.status,
        createdAt: exp.created_at,
        startedAt: exp.started_at || undefined,
        completedAt: exp.completed_at || undefined,
      },
      control: {
        promptId: exp.control_prompt_id,
        ...controlStats,
      },
      treatment: {
        promptId: exp.treatment_prompt_id,
        ...treatmentStats,
      },
      analysis,
    };
  }

  /**
   * Get stats for a prompt during an experiment
   */
  private async getPromptExperimentStats(
    promptId: string,
    startDate: Date
  ): Promise<{
    samples: number;
    successRate: number;
    avgReward: number;
    avgCompletionTimeMs?: number;
  }> {
    const db = getDatabase();

    const result = await db.query<{
      samples: string;
      success_count: string;
      avg_reward: string;
      avg_completion_time: string | null;
    }>(
      `SELECT
        COUNT(*) as samples,
        COUNT(*) FILTER (WHERE outcome = 'success') as success_count,
        AVG(reward) as avg_reward,
        AVG((context->>'completionTimeMs')::NUMERIC) as avg_completion_time
       FROM rl_outcomes
       WHERE prompt_id = $1 AND created_at >= $2`,
      [promptId, startDate]
    );

    const row = result.rows[0];
    const samples = parseInt(row.samples, 10);

    return {
      samples,
      successRate: samples > 0 ? parseInt(row.success_count, 10) / samples : 0,
      avgReward: parseFloat(row.avg_reward || '0'),
      avgCompletionTimeMs: row.avg_completion_time ? parseFloat(row.avg_completion_time) : undefined,
    };
  }

  /**
   * Analyze experiment results using statistical tests
   */
  private analyzeExperiment(
    control: { samples: number; successRate: number; avgReward: number },
    treatment: { samples: number; successRate: number; avgReward: number },
    metric: string,
    minSampleSize: number
  ): {
    winner: 'control' | 'treatment' | 'none';
    confidence: number;
    improvement: number;
    statSignificant: boolean;
    recommendation: string;
  } {
    // Check if we have enough data
    if (control.samples < minSampleSize || treatment.samples < minSampleSize) {
      return {
        winner: 'none',
        confidence: 0,
        improvement: 0,
        statSignificant: false,
        recommendation: `Need more data. Control: ${control.samples}/${minSampleSize}, Treatment: ${treatment.samples}/${minSampleSize} samples.`,
      };
    }

    // Get metric values
    let controlValue: number, treatmentValue: number;
    switch (metric) {
      case 'success_rate':
        controlValue = control.successRate;
        treatmentValue = treatment.successRate;
        break;
      case 'avg_reward':
        controlValue = control.avgReward;
        treatmentValue = treatment.avgReward;
        break;
      default:
        controlValue = control.successRate;
        treatmentValue = treatment.successRate;
    }

    // Calculate improvement
    const improvement = controlValue > 0
      ? ((treatmentValue - controlValue) / controlValue) * 100
      : 0;

    // Perform two-sample z-test for proportions (simplified)
    const pooledRate = (control.successRate * control.samples + treatment.successRate * treatment.samples) /
                       (control.samples + treatment.samples);
    const se = Math.sqrt(pooledRate * (1 - pooledRate) * (1 / control.samples + 1 / treatment.samples));
    const zScore = se > 0 ? Math.abs(treatment.successRate - control.successRate) / se : 0;

    // Calculate confidence (two-tailed)
    const confidence = this.zScoreToConfidence(zScore);
    const statSignificant = confidence >= 0.95;

    // Determine winner
    let winner: 'control' | 'treatment' | 'none' = 'none';
    if (statSignificant) {
      winner = treatmentValue > controlValue ? 'treatment' : 'control';
    }

    // Generate recommendation
    let recommendation: string;
    if (!statSignificant) {
      recommendation = `Results not yet statistically significant (${(confidence * 100).toFixed(1)}% confidence). Continue experiment.`;
    } else if (winner === 'treatment') {
      recommendation = `Treatment outperforms control by ${improvement.toFixed(1)}%. Consider promoting treatment to production.`;
    } else {
      recommendation = `Control outperforms treatment. Consider stopping experiment and keeping current production.`;
    }

    return {
      winner,
      confidence,
      improvement,
      statSignificant,
      recommendation,
    };
  }

  /**
   * Convert z-score to confidence level
   */
  private zScoreToConfidence(z: number): number {
    // Approximate normal CDF
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = z < 0 ? -1 : 1;
    z = Math.abs(z) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * z);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

    return 0.5 * (1.0 + sign * y);
  }

  /**
   * List all experiments
   */
  async listExperiments(status?: ExperimentStatus): Promise<Experiment[]> {
    const db = getDatabase();

    let query = `
      SELECT id, name, description, agent_type, control_prompt_id, treatment_prompt_id,
             traffic_split, min_sample_size, max_duration_days, success_metric,
             status, created_at, started_at, completed_at
      FROM experiments
    `;
    const params: unknown[] = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.query<{
      id: string;
      name: string;
      description: string | null;
      agent_type: AgentType;
      control_prompt_id: string;
      treatment_prompt_id: string;
      traffic_split: string;
      min_sample_size: number;
      max_duration_days: number | null;
      success_metric: string;
      status: ExperimentStatus;
      created_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      agentType: row.agent_type,
      controlPromptId: row.control_prompt_id,
      treatmentPromptId: row.treatment_prompt_id,
      trafficSplit: parseFloat(row.traffic_split),
      minSampleSize: row.min_sample_size,
      maxDurationDays: row.max_duration_days || undefined,
      successMetric: row.success_metric,
      status: row.status,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
    }));
  }

  /**
   * Stop an experiment
   */
  async stopExperiment(experimentId: string): Promise<void> {
    const db = getDatabase();

    await db.query(
      `UPDATE experiments SET status = 'stopped', completed_at = NOW() WHERE id = $1`,
      [experimentId]
    );
  }

  /**
   * Get aggregate metrics across all agent types
   */
  async getAggregateLearningMetrics(): Promise<{
    totalPrompts: number;
    totalExperiments: number;
    activeExperiments: number;
    avgSuccessRate: number;
    avgThompsonScore: number;
    byAgentType: Record<AgentType, {
      promptCount: number;
      avgSuccessRate: number;
      productionVersion?: number;
    }>;
  }> {
    const db = getDatabase();

    // Get aggregate stats
    const statsResult = await db.query<{
      total_prompts: string;
      avg_success_rate: string;
      avg_thompson_score: string;
    }>(
      `SELECT
        COUNT(*) as total_prompts,
        AVG(CASE WHEN total_uses > 0 THEN successful_uses::FLOAT / total_uses ELSE 0 END) as avg_success_rate,
        AVG(alpha::FLOAT / (alpha + beta)) as avg_thompson_score
       FROM prompts WHERE status != 'deprecated'`
    );

    // Get experiment counts
    const expResult = await db.query<{
      total: string;
      active: string;
    }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'running') as active
       FROM experiments`
    );

    // Get by agent type
    const typeResult = await db.query<{
      agent_type: AgentType;
      prompt_count: string;
      avg_success_rate: string;
      production_version: number | null;
    }>(
      `SELECT
        agent_type,
        COUNT(*) as prompt_count,
        AVG(CASE WHEN total_uses > 0 THEN successful_uses::FLOAT / total_uses ELSE 0 END) as avg_success_rate,
        MAX(CASE WHEN status = 'production' THEN version END) as production_version
       FROM prompts WHERE status != 'deprecated'
       GROUP BY agent_type`
    );

    const byAgentType: Record<string, {
      promptCount: number;
      avgSuccessRate: number;
      productionVersion?: number;
    }> = {};

    for (const row of typeResult.rows) {
      byAgentType[row.agent_type] = {
        promptCount: parseInt(row.prompt_count, 10),
        avgSuccessRate: parseFloat(row.avg_success_rate || '0'),
        productionVersion: row.production_version || undefined,
      };
    }

    return {
      totalPrompts: parseInt(statsResult.rows[0]?.total_prompts || '0', 10),
      totalExperiments: parseInt(expResult.rows[0]?.total || '0', 10),
      activeExperiments: parseInt(expResult.rows[0]?.active || '0', 10),
      avgSuccessRate: parseFloat(statsResult.rows[0]?.avg_success_rate || '0'),
      avgThompsonScore: parseFloat(statsResult.rows[0]?.avg_thompson_score || '0'),
      byAgentType: byAgentType as Record<AgentType, {
        promptCount: number;
        avgSuccessRate: number;
        productionVersion?: number;
      }>,
    };
  }
}

// Singleton instance
let learningMetrics: LearningMetrics | null = null;

export function getLearningMetrics(): LearningMetrics {
  if (!learningMetrics) {
    learningMetrics = new LearningMetrics();
  }
  return learningMetrics;
}

export default LearningMetrics;
