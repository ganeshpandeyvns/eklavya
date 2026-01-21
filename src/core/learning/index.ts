import { v4 as uuidv4 } from 'uuid';
import type { AgentType, Prompt, LearningEvent, PromptStatus } from '../../types/index.js';
import { getDatabase } from '../../lib/database.js';
import { getCache, CacheKeys } from '../../lib/cache.js';

export interface LearningSystemOptions {
  explorationRate: number;  // Percentage of traffic for experimental prompts
  candidateRate: number;    // Percentage for candidate prompts
  promptCacheTtlMs?: number; // TTL for prompt cache in milliseconds
}

// Default cache TTL for prompts (30 seconds)
const DEFAULT_PROMPT_CACHE_TTL_MS = 30000;

export class LearningSystem {
  private explorationRate: number;
  private candidateRate: number;
  private promptCacheTtlMs: number;

  constructor(options: LearningSystemOptions = { explorationRate: 0.1, candidateRate: 0.3 }) {
    this.explorationRate = options.explorationRate;
    this.candidateRate = options.candidateRate;
    this.promptCacheTtlMs = options.promptCacheTtlMs || DEFAULT_PROMPT_CACHE_TTL_MS;
  }

  /**
   * Thompson Sampling: Select prompt based on Beta distribution sampling
   */
  async selectPrompt(agentType: AgentType): Promise<Prompt | null> {
    try {
      const db = getDatabase();
      const cache = getCache();

      // Try to get prompts from cache first
      const cacheKey = CacheKeys.promptList(agentType);
      let prompts = cache.get<Prompt[]>(cacheKey);

      if (!prompts) {
        // Query with LIMIT to prevent unbounded results
        const result = await db.query<Prompt>(
          `SELECT * FROM prompts WHERE agent_type = $1 AND status != 'deprecated' LIMIT 100`,
          [agentType]
        );
        prompts = result.rows;
        // Cache the prompt list
        cache.set(cacheKey, prompts, this.promptCacheTtlMs);
      }

      if (prompts.length === 0) return null;

    // Group by status
    const production = prompts.filter(p => p.status === 'production');
    const candidate = prompts.filter(p => p.status === 'candidate');
    const experimental = prompts.filter(p => p.status === 'experimental');

    // Decide which pool to sample from
    const rand = Math.random();
    let pool: Prompt[];

    if (rand < this.explorationRate && experimental.length > 0) {
      pool = experimental;
    } else if (rand < this.explorationRate + this.candidateRate && candidate.length > 0) {
      pool = candidate;
    } else if (production.length > 0) {
      pool = production;
    } else {
      pool = prompts;
    }

    // Thompson Sampling within the pool
    let bestPrompt: Prompt | null = null;
    let bestSample = -1;

    for (const prompt of pool) {
      // Sample from Beta(alpha, beta) distribution
      const sample = this.sampleBeta(prompt.alpha, prompt.beta);
      if (sample > bestSample) {
        bestSample = sample;
        bestPrompt = prompt;
      }
    }

    // Record the selection
    if (bestPrompt) {
      await db.query(
        `UPDATE prompts SET total_uses = total_uses + 1 WHERE id = $1`,
        [bestPrompt.id]
      );
    }

    return bestPrompt;
    } catch (error) {
      console.error(`Failed to select prompt for agent type ${agentType}:`, error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  /**
   * Sample from Beta distribution using the Jöhnk algorithm
   */
  private sampleBeta(alpha: number, beta: number): number {
    if (alpha <= 0 || beta <= 0) return 0.5;

    // Use gamma sampling for better numerical stability
    const gammaAlpha = this.sampleGamma(alpha);
    const gammaBeta = this.sampleGamma(beta);

    return gammaAlpha / (gammaAlpha + gammaBeta);
  }

  /**
   * Sample from Gamma distribution using Marsaglia and Tsang's method
   */
  private sampleGamma(shape: number): number {
    if (shape < 1) {
      return this.sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }

    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    while (true) {
      let x: number, v: number;
      do {
        x = this.sampleNormal();
        v = 1 + c * x;
      } while (v <= 0);

      v = v * v * v;
      const u = Math.random();

      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /**
   * Sample from standard normal distribution using Box-Muller
   */
  private sampleNormal(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Record task outcome and update prompt statistics (legacy interface)
   */
  async recordTaskOutcome(
    promptId: string,
    taskId: string,
    success: boolean,
    completionTimeMs?: number,
    context?: Record<string, unknown>
  ): Promise<void> {
    await this.recordOutcome({
      promptId,
      taskId,
      outcome: success ? 'success' : 'failure',
      reward: success ? 1 : -1,
      context: { ...context, completionTimeMs },
    });
  }

  /**
   * Record outcome with granular reward - used by Tester Agent
   * Supports partial rewards (-1.0 to 1.0) for nuanced learning
   */
  async recordOutcome(options: {
    promptId: string;
    projectId?: string;
    taskId?: string;
    agentId?: string;
    outcome: 'success' | 'failure' | 'partial';
    reward: number;  // -1.0 to 1.0
    context?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const { promptId, projectId, taskId, agentId, outcome, reward, context } = options;
      const db = getDatabase();

      // Clamp reward to valid range
      const clampedReward = Math.max(-1, Math.min(1, reward));

      // Record to rl_outcomes table for detailed tracking
      await db.query(
        `INSERT INTO rl_outcomes (id, prompt_id, project_id, task_id, agent_id, outcome, reward, context, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          uuidv4(),
          promptId,
          projectId || null,
          taskId || null,
          agentId || null,
          outcome,
          clampedReward,
          JSON.stringify(context || {}),
        ]
      );

      // Note: The database trigger (trigger_update_prompt_stats) will automatically
      // update the prompt's alpha/beta values based on the reward

      // Also record to learning_events for backwards compatibility
      await db.query(
        `INSERT INTO learning_events (id, prompt_id, task_id, event_type, reward, context, outcome, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          uuidv4(),
          promptId,
          taskId || null,
          context?.type as string || (reward >= 0 ? 'positive_reward' : 'negative_reward'),
          clampedReward,
          JSON.stringify(context || {}),
          JSON.stringify({ outcome, reward: clampedReward }),
        ]
      );

      // Check if prompt should be promoted/demoted
      await this.evaluatePromptStatus(promptId);
    } catch (error) {
      console.error(`Failed to record outcome for prompt ${options.promptId}:`, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Apply penalty to a developer's prompt when a bug is found
   * This is called by the Tester Agent
   */
  async penalizeDeveloper(
    promptId: string,
    bugSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info',
    bugContext: {
      bugId: string;
      bugType: string;
      file?: string;
      description?: string;
    }
  ): Promise<void> {
    const severityRewards: Record<string, number> = {
      critical: -1.0,
      high: -0.7,
      medium: -0.4,
      low: -0.2,
      info: -0.1,
    };

    await this.recordOutcome({
      promptId,
      outcome: 'failure',
      reward: severityRewards[bugSeverity] || -0.4,
      context: {
        type: 'bug_found',
        severity: bugSeverity,
        ...bugContext,
      },
    });
  }

  /**
   * Reward a developer's prompt when they fix a bug
   */
  async rewardBugFix(
    promptId: string,
    bugContext: {
      bugId: string;
      originalSeverity: string;
    }
  ): Promise<void> {
    await this.recordOutcome({
      promptId,
      outcome: 'success',
      reward: 0.5,  // Fixing bugs is valuable
      context: {
        type: 'bug_fixed',
        ...bugContext,
      },
    });
  }

  /**
   * Get developer accountability report
   */
  async getDeveloperAccountability(agentId: string): Promise<{
    totalBugsCreated: number;
    criticalBugs: number;
    bugsFixed: number;
    avgReward: number;
    promptVersion?: number;
  }> {
    const db = getDatabase();

    const result = await db.query<{
      bugs_created: string;
      critical_bugs: string;
      bugs_fixed: string;
      avg_reward: string;
      prompt_version: number;
    }>(
      `SELECT
        COUNT(DISTINCT b.id) as bugs_created,
        COUNT(DISTINCT CASE WHEN b.severity = 'critical' THEN b.id END) as critical_bugs,
        COUNT(DISTINCT CASE WHEN b.fixed THEN b.id END) as bugs_fixed,
        COALESCE(AVG(r.reward), 0) as avg_reward,
        p.version as prompt_version
       FROM agents a
       LEFT JOIN prompts p ON a.prompt_id = p.id
       LEFT JOIN bugs b ON b.developer_id = a.id
       LEFT JOIN rl_outcomes r ON r.agent_id = a.id
       WHERE a.id = $1
       GROUP BY a.id, p.version`,
      [agentId]
    );

    if (result.rows.length === 0) {
      return {
        totalBugsCreated: 0,
        criticalBugs: 0,
        bugsFixed: 0,
        avgReward: 0,
      };
    }

    const row = result.rows[0];
    return {
      totalBugsCreated: parseInt(row.bugs_created, 10),
      criticalBugs: parseInt(row.critical_bugs, 10),
      bugsFixed: parseInt(row.bugs_fixed, 10),
      avgReward: parseFloat(row.avg_reward),
      promptVersion: row.prompt_version,
    };
  }

  /**
   * Evaluate if a prompt should be promoted or demoted based on performance
   */
  private async evaluatePromptStatus(promptId: string): Promise<void> {
    const db = getDatabase();
    const result = await db.query<Prompt>(
      `SELECT * FROM prompts WHERE id = $1`,
      [promptId]
    );

    if (result.rows.length === 0) return;

    const prompt = result.rows[0];
    const successRate = prompt.totalUses > 0
      ? prompt.successfulUses / prompt.totalUses
      : 0;

    let newStatus: PromptStatus | null = null;

    // Promotion rules
    if (prompt.status === 'experimental' && prompt.totalUses >= 10 && successRate >= 0.7) {
      newStatus = 'candidate';
    } else if (prompt.status === 'candidate' && prompt.totalUses >= 50 && successRate >= 0.8) {
      newStatus = 'production';
    }

    // Demotion rules
    if (prompt.status === 'production' && prompt.totalUses >= 20 && successRate < 0.6) {
      newStatus = 'candidate';
    } else if (prompt.status === 'candidate' && prompt.totalUses >= 20 && successRate < 0.5) {
      newStatus = 'deprecated';
    }

    if (newStatus) {
      await db.query(
        `UPDATE prompts SET status = $1 WHERE id = $2`,
        [newStatus, promptId]
      );
    }
  }

  /**
   * Create a new prompt variant (mutation)
   */
  async createPromptVariant(
    basePromptId: string,
    newContent: string,
    variables?: string[]
  ): Promise<Prompt> {
    const db = getDatabase();

    // Get base prompt
    const baseResult = await db.query<Prompt>(
      `SELECT * FROM prompts WHERE id = $1`,
      [basePromptId]
    );

    if (baseResult.rows.length === 0) {
      throw new Error(`Base prompt ${basePromptId} not found`);
    }

    const base = baseResult.rows[0];

    // Get next version number
    const versionResult = await db.query<{ max: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 as max FROM prompts WHERE agent_type = $1`,
      [base.agentType]
    );

    const newVersion = versionResult.rows[0].max;
    const newId = uuidv4();

    await db.query(
      `INSERT INTO prompts (id, agent_type, version, status, content, variables, alpha, beta, created_at, updated_at)
       VALUES ($1, $2, $3, 'experimental', $4, $5, 1, 1, NOW(), NOW())`,
      [newId, base.agentType, newVersion, newContent, JSON.stringify(variables || base.variables)]
    );

    const result = await db.query<Prompt>(
      `SELECT * FROM prompts WHERE id = $1`,
      [newId]
    );

    return result.rows[0];
  }

  /**
   * Get performance statistics for all prompts of a type
   */
  async getPromptStats(agentType: AgentType): Promise<Array<{
    prompt: Prompt;
    successRate: number;
    expectedValue: number;
    confidenceInterval: [number, number];
  }>> {
    const db = getDatabase();
    const result = await db.query<Prompt>(
      `SELECT * FROM prompts WHERE agent_type = $1 ORDER BY status, version DESC`,
      [agentType]
    );

    return result.rows.map(prompt => {
      const successRate = prompt.totalUses > 0
        ? prompt.successfulUses / prompt.totalUses
        : 0;

      // Expected value from Beta distribution
      const expectedValue = prompt.alpha / (prompt.alpha + prompt.beta);

      // 95% confidence interval (approximate)
      const n = prompt.totalUses || 1;
      const stderr = Math.sqrt((successRate * (1 - successRate)) / n);
      const confidenceInterval: [number, number] = [
        Math.max(0, successRate - 1.96 * stderr),
        Math.min(1, successRate + 1.96 * stderr),
      ];

      return { prompt, successRate, expectedValue, confidenceInterval };
    });
  }
}

// Singleton
let learningSystem: LearningSystem | null = null;

export function getLearningSystem(options?: LearningSystemOptions): LearningSystem {
  if (!learningSystem) {
    learningSystem = new LearningSystem(options);
  }
  return learningSystem;
}
