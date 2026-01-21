/**
 * Client Feedback Module
 * Demo₇: Demo System
 *
 * Provides client feedback management:
 * - Record feedback
 * - Categorize and track sentiment
 * - Process and resolve feedback
 * - Feedback analytics
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';

export type FeedbackSentiment = 'positive' | 'neutral' | 'negative';
export type FeedbackCategory = 'feature' | 'design' | 'performance' | 'bug' | 'general';

export interface ClientFeedback {
  id: string;
  demoId: string;
  projectId: string;
  sentiment: FeedbackSentiment;
  category: FeedbackCategory;
  content: string;
  pageUrl?: string;
  elementId?: string;
  screenshot?: string;
  processedAt?: Date;
  actionTaken?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

export interface FeedbackSummary {
  demoId: string;
  totalFeedback: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  unresolvedCount: number;
  latestFeedbackAt?: Date;
}

export interface CreateFeedbackOptions {
  sentiment?: FeedbackSentiment;
  category?: FeedbackCategory;
  content: string;
  pageUrl?: string;
  elementId?: string;
  screenshot?: string;
}

/**
 * FeedbackService manages client feedback for demos.
 */
export class FeedbackService extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Add feedback for a demo.
   */
  async addFeedback(demoId: string, options: CreateFeedbackOptions): Promise<ClientFeedback> {
    const db = getDatabase();

    const result = await db.query<{ add_client_feedback: string }>(
      `SELECT add_client_feedback($1, $2::feedback_sentiment, $3::feedback_category, $4, $5, $6, $7)`,
      [
        demoId,
        options.sentiment || 'neutral',
        options.category || 'general',
        options.content,
        options.pageUrl || null,
        options.elementId || null,
        options.screenshot || null,
      ]
    );

    const feedbackId = result.rows[0].add_client_feedback;
    const feedback = await this.getFeedback(feedbackId);

    this.emit('feedback:added', feedback);
    return feedback;
  }

  /**
   * Get feedback by ID.
   */
  async getFeedback(feedbackId: string): Promise<ClientFeedback> {
    const db = getDatabase();

    const result = await db.query<{
      id: string;
      demo_id: string;
      project_id: string;
      sentiment: string;
      category: string;
      content: string;
      page_url: string;
      element_id: string;
      screenshot: string;
      processed_at: Date;
      action_taken: string;
      resolved_at: Date;
      created_at: Date;
    }>(
      `SELECT * FROM client_feedback WHERE id = $1`,
      [feedbackId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Feedback not found: ${feedbackId}`);
    }

    return this.mapRowToFeedback(result.rows[0]);
  }

  /**
   * List feedback for a demo.
   */
  async listFeedback(
    demoId: string,
    options: { unresolved?: boolean; sentiment?: FeedbackSentiment; category?: FeedbackCategory; limit?: number } = {}
  ): Promise<ClientFeedback[]> {
    const db = getDatabase();
    const { unresolved, sentiment, category, limit = 50 } = options;

    let query = `SELECT * FROM client_feedback WHERE demo_id = $1`;
    const params: unknown[] = [demoId];
    let paramIndex = 2;

    if (unresolved) {
      query += ` AND resolved_at IS NULL`;
    }

    if (sentiment) {
      query += ` AND sentiment = $${paramIndex++}::feedback_sentiment`;
      params.push(sentiment);
    }

    if (category) {
      query += ` AND category = $${paramIndex++}::feedback_category`;
      params.push(category);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.query<{
      id: string;
      demo_id: string;
      project_id: string;
      sentiment: string;
      category: string;
      content: string;
      page_url: string;
      element_id: string;
      screenshot: string;
      processed_at: Date;
      action_taken: string;
      resolved_at: Date;
      created_at: Date;
    }>(query, params);

    return result.rows.map(row => this.mapRowToFeedback(row));
  }

  /**
   * List all feedback for a project.
   */
  async listProjectFeedback(
    projectId: string,
    options: { unresolved?: boolean; limit?: number } = {}
  ): Promise<ClientFeedback[]> {
    const db = getDatabase();
    const { unresolved, limit = 100 } = options;

    let query = `SELECT * FROM client_feedback WHERE project_id = $1`;
    const params: unknown[] = [projectId];
    let paramIndex = 2;

    if (unresolved) {
      query += ` AND resolved_at IS NULL`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.query<{
      id: string;
      demo_id: string;
      project_id: string;
      sentiment: string;
      category: string;
      content: string;
      page_url: string;
      element_id: string;
      screenshot: string;
      processed_at: Date;
      action_taken: string;
      resolved_at: Date;
      created_at: Date;
    }>(query, params);

    return result.rows.map(row => this.mapRowToFeedback(row));
  }

  /**
   * Mark feedback as processed with action taken.
   */
  async processFeedback(feedbackId: string, actionTaken: string): Promise<ClientFeedback> {
    const db = getDatabase();

    await db.query(
      `UPDATE client_feedback SET processed_at = NOW(), action_taken = $1 WHERE id = $2`,
      [actionTaken, feedbackId]
    );

    const feedback = await this.getFeedback(feedbackId);
    this.emit('feedback:processed', feedback);
    return feedback;
  }

  /**
   * Mark feedback as resolved.
   */
  async resolveFeedback(feedbackId: string, actionTaken?: string): Promise<ClientFeedback> {
    const db = getDatabase();

    if (actionTaken) {
      await db.query(
        `UPDATE client_feedback SET resolved_at = NOW(), processed_at = COALESCE(processed_at, NOW()), action_taken = $1 WHERE id = $2`,
        [actionTaken, feedbackId]
      );
    } else {
      await db.query(
        `UPDATE client_feedback SET resolved_at = NOW() WHERE id = $1`,
        [feedbackId]
      );
    }

    const feedback = await this.getFeedback(feedbackId);
    this.emit('feedback:resolved', feedback);
    return feedback;
  }

  /**
   * Get feedback summary for a demo.
   */
  async getFeedbackSummary(demoId: string): Promise<FeedbackSummary> {
    const db = getDatabase();

    const result = await db.query<{
      demo_id: string;
      total_feedback: string;
      positive_count: string;
      neutral_count: string;
      negative_count: string;
      unresolved_count: string;
      latest_feedback_at: Date;
    }>(
      `SELECT * FROM feedback_summary WHERE demo_id = $1`,
      [demoId]
    );

    if (result.rows.length === 0) {
      return {
        demoId,
        totalFeedback: 0,
        positiveCount: 0,
        neutralCount: 0,
        negativeCount: 0,
        unresolvedCount: 0,
      };
    }

    const row = result.rows[0];
    return {
      demoId: row.demo_id,
      totalFeedback: parseInt(row.total_feedback, 10),
      positiveCount: parseInt(row.positive_count, 10),
      neutralCount: parseInt(row.neutral_count, 10),
      negativeCount: parseInt(row.negative_count, 10),
      unresolvedCount: parseInt(row.unresolved_count, 10),
      latestFeedbackAt: row.latest_feedback_at,
    };
  }

  /**
   * Get aggregated feedback stats for a project.
   */
  async getProjectFeedbackStats(projectId: string): Promise<{
    totalFeedback: number;
    bySentiment: Record<FeedbackSentiment, number>;
    byCategory: Record<FeedbackCategory, number>;
    unresolvedCount: number;
    resolvedCount: number;
  }> {
    const db = getDatabase();

    const result = await db.query<{
      total: string;
      positive: string;
      neutral: string;
      negative: string;
      feature: string;
      design: string;
      performance: string;
      bug: string;
      general: string;
      unresolved: string;
      resolved: string;
    }>(
      `SELECT
        COUNT(*)::TEXT as total,
        COUNT(*) FILTER (WHERE sentiment = 'positive')::TEXT as positive,
        COUNT(*) FILTER (WHERE sentiment = 'neutral')::TEXT as neutral,
        COUNT(*) FILTER (WHERE sentiment = 'negative')::TEXT as negative,
        COUNT(*) FILTER (WHERE category = 'feature')::TEXT as feature,
        COUNT(*) FILTER (WHERE category = 'design')::TEXT as design,
        COUNT(*) FILTER (WHERE category = 'performance')::TEXT as performance,
        COUNT(*) FILTER (WHERE category = 'bug')::TEXT as bug,
        COUNT(*) FILTER (WHERE category = 'general')::TEXT as general,
        COUNT(*) FILTER (WHERE resolved_at IS NULL)::TEXT as unresolved,
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::TEXT as resolved
      FROM client_feedback
      WHERE project_id = $1`,
      [projectId]
    );

    const row = result.rows[0];
    return {
      totalFeedback: parseInt(row.total, 10),
      bySentiment: {
        positive: parseInt(row.positive, 10),
        neutral: parseInt(row.neutral, 10),
        negative: parseInt(row.negative, 10),
      },
      byCategory: {
        feature: parseInt(row.feature, 10),
        design: parseInt(row.design, 10),
        performance: parseInt(row.performance, 10),
        bug: parseInt(row.bug, 10),
        general: parseInt(row.general, 10),
      },
      unresolvedCount: parseInt(row.unresolved, 10),
      resolvedCount: parseInt(row.resolved, 10),
    };
  }

  /**
   * Update feedback content or metadata.
   */
  async updateFeedback(
    feedbackId: string,
    updates: Partial<Pick<ClientFeedback, 'sentiment' | 'category' | 'content' | 'pageUrl' | 'elementId' | 'screenshot'>>
  ): Promise<ClientFeedback> {
    const db = getDatabase();
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.sentiment !== undefined) {
      setClauses.push(`sentiment = $${paramIndex++}::feedback_sentiment`);
      params.push(updates.sentiment);
    }
    if (updates.category !== undefined) {
      setClauses.push(`category = $${paramIndex++}::feedback_category`);
      params.push(updates.category);
    }
    if (updates.content !== undefined) {
      setClauses.push(`content = $${paramIndex++}`);
      params.push(updates.content);
    }
    if (updates.pageUrl !== undefined) {
      setClauses.push(`page_url = $${paramIndex++}`);
      params.push(updates.pageUrl);
    }
    if (updates.elementId !== undefined) {
      setClauses.push(`element_id = $${paramIndex++}`);
      params.push(updates.elementId);
    }
    if (updates.screenshot !== undefined) {
      setClauses.push(`screenshot = $${paramIndex++}`);
      params.push(updates.screenshot);
    }

    if (setClauses.length === 0) {
      return this.getFeedback(feedbackId);
    }

    params.push(feedbackId);
    await db.query(
      `UPDATE client_feedback SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    const feedback = await this.getFeedback(feedbackId);
    this.emit('feedback:updated', feedback);
    return feedback;
  }

  /**
   * Delete feedback.
   */
  async deleteFeedback(feedbackId: string): Promise<boolean> {
    const db = getDatabase();

    const result = await db.query(
      `DELETE FROM client_feedback WHERE id = $1`,
      [feedbackId]
    );

    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
      this.emit('feedback:deleted', { feedbackId });
    }

    return deleted;
  }

  /**
   * Map database row to ClientFeedback interface.
   */
  private mapRowToFeedback(row: {
    id: string;
    demo_id: string;
    project_id: string;
    sentiment: string;
    category: string;
    content: string;
    page_url: string;
    element_id: string;
    screenshot: string;
    processed_at: Date;
    action_taken: string;
    resolved_at: Date;
    created_at: Date;
  }): ClientFeedback {
    return {
      id: row.id,
      demoId: row.demo_id,
      projectId: row.project_id,
      sentiment: row.sentiment as FeedbackSentiment,
      category: row.category as FeedbackCategory,
      content: row.content,
      pageUrl: row.page_url,
      elementId: row.element_id,
      screenshot: row.screenshot,
      processedAt: row.processed_at,
      actionTaken: row.action_taken,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    };
  }
}

// Factory functions
export function createFeedbackService(): FeedbackService {
  return new FeedbackService();
}

let defaultService: FeedbackService | null = null;

export function getFeedbackService(): FeedbackService {
  if (!defaultService) {
    defaultService = new FeedbackService();
  }
  return defaultService;
}
