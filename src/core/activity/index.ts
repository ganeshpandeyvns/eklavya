/**
 * Activity Stream Module
 * Demo₆: Real-Time Portal
 *
 * Provides live activity streaming for project monitoring:
 * - Real-time activity event logging
 * - Filtering by project, agent, event type
 * - Activity feed with pagination
 * - Event emission for WebSocket broadcast
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';
import type { NotificationLevel } from '../notifications/index.js';

export type ActivityEventType =
  | 'agent_status'
  | 'task_progress'
  | 'file_change'
  | 'build_event'
  | 'test_result'
  | 'checkpoint'
  | 'error'
  | 'milestone';

export interface ActivityEvent {
  id: string;
  projectId: string;
  agentId?: string;
  agentType?: string;
  eventType: ActivityEventType;
  action: string;
  details?: string;
  taskId?: string;
  filePath?: string;
  notificationLevel: NotificationLevel;
  createdAt: Date;
}

export interface ActivityFilter {
  projectId?: string;
  agentId?: string;
  eventType?: ActivityEventType;
  notificationLevel?: NotificationLevel;
  since?: Date;
  limit?: number;
  offset?: number;
}

export interface ActivityStats {
  totalEvents: number;
  byEventType: Record<ActivityEventType, number>;
  byNotificationLevel: Record<NotificationLevel, number>;
  recentAgents: string[];
}

/**
 * ActivityService manages activity event logging and streaming.
 */
export class ActivityService extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Log a new activity event.
   *
   * @param projectId - The project this activity belongs to
   * @param eventType - Type of activity event
   * @param action - Description of the action
   * @param options - Additional event options
   * @returns The created activity event
   */
  async logActivity(
    projectId: string,
    eventType: ActivityEventType,
    action: string,
    options: {
      details?: string;
      agentId?: string;
      agentType?: string;
      taskId?: string;
      filePath?: string;
      notificationLevel?: NotificationLevel;
    } = {}
  ): Promise<ActivityEvent> {
    const db = getDatabase();

    // Use the database function to log activity
    const result = await db.query<{ log_activity: string }>(
      `SELECT log_activity($1, $2::activity_event_type, $3, $4, $5, $6, $7, $8, $9::notification_level)`,
      [
        projectId,
        eventType,
        action,
        options.details || null,
        options.agentId || null,
        options.agentType || null,
        options.taskId || null,
        options.filePath || null,
        options.notificationLevel || 'silent',
      ]
    );

    const activityId = result.rows[0].log_activity;

    // Fetch the full activity event
    const activity = await this.getActivityEvent(activityId);

    // Emit event for real-time streaming
    this.emit('activity:new', activity);

    return activity;
  }

  /**
   * Get a single activity event by ID.
   */
  async getActivityEvent(activityId: string): Promise<ActivityEvent> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      project_id: string;
      agent_id: string;
      agent_type: string;
      event_type: string;
      action: string;
      details: string;
      task_id: string;
      file_path: string;
      notification_level: string;
      created_at: Date;
    }>(
      `SELECT * FROM activity_stream WHERE id = $1`,
      [activityId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Activity event not found: ${activityId}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      projectId: row.project_id,
      agentId: row.agent_id,
      agentType: row.agent_type,
      eventType: row.event_type as ActivityEventType,
      action: row.action,
      details: row.details,
      taskId: row.task_id,
      filePath: row.file_path,
      notificationLevel: row.notification_level as NotificationLevel,
      createdAt: row.created_at,
    };
  }

  /**
   * Get activity stream with filtering.
   */
  async getActivityStream(filter: ActivityFilter = {}): Promise<ActivityEvent[]> {
    const db = getDatabase();
    const { limit = 50, offset = 0 } = filter;

    let query = `SELECT * FROM activity_stream WHERE 1=1`;
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filter.projectId) {
      query += ` AND project_id = $${paramIndex++}`;
      params.push(filter.projectId);
    }

    if (filter.agentId) {
      query += ` AND agent_id = $${paramIndex++}`;
      params.push(filter.agentId);
    }

    if (filter.eventType) {
      query += ` AND event_type = $${paramIndex++}::activity_event_type`;
      params.push(filter.eventType);
    }

    if (filter.notificationLevel) {
      query += ` AND notification_level = $${paramIndex++}::notification_level`;
      params.push(filter.notificationLevel);
    }

    if (filter.since) {
      query += ` AND created_at > $${paramIndex++}`;
      params.push(filter.since);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await db.query<{
      id: string;
      project_id: string;
      agent_id: string;
      agent_type: string;
      event_type: string;
      action: string;
      details: string;
      task_id: string;
      file_path: string;
      notification_level: string;
      created_at: Date;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      agentId: row.agent_id,
      agentType: row.agent_type,
      eventType: row.event_type as ActivityEventType,
      action: row.action,
      details: row.details,
      taskId: row.task_id,
      filePath: row.file_path,
      notificationLevel: row.notification_level as NotificationLevel,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get recent activity across all projects.
   */
  async getRecentActivity(limit: number = 50): Promise<ActivityEvent[]> {
    return this.getActivityStream({ limit });
  }

  /**
   * Get activity for a specific project.
   */
  async getProjectActivity(
    projectId: string,
    options: { limit?: number; offset?: number; since?: Date } = {}
  ): Promise<ActivityEvent[]> {
    return this.getActivityStream({
      projectId,
      ...options,
    });
  }

  /**
   * Get activity for a specific agent.
   */
  async getAgentActivity(
    agentId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ActivityEvent[]> {
    return this.getActivityStream({
      agentId,
      ...options,
    });
  }

  /**
   * Get activity statistics for a project.
   */
  async getActivityStats(projectId?: string): Promise<ActivityStats> {
    const db = getDatabase();

    let whereClause = '';
    const params: unknown[] = [];

    if (projectId) {
      whereClause = 'WHERE project_id = $1';
      params.push(projectId);
    }

    // Get counts by event type and notification level
    const statsQuery = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE event_type = 'agent_status') as agent_status,
        COUNT(*) FILTER (WHERE event_type = 'task_progress') as task_progress,
        COUNT(*) FILTER (WHERE event_type = 'file_change') as file_change,
        COUNT(*) FILTER (WHERE event_type = 'build_event') as build_event,
        COUNT(*) FILTER (WHERE event_type = 'test_result') as test_result,
        COUNT(*) FILTER (WHERE event_type = 'checkpoint') as checkpoint,
        COUNT(*) FILTER (WHERE event_type = 'error') as error,
        COUNT(*) FILTER (WHERE event_type = 'milestone') as milestone,
        COUNT(*) FILTER (WHERE notification_level = 'critical') as level_critical,
        COUNT(*) FILTER (WHERE notification_level = 'warning') as level_warning,
        COUNT(*) FILTER (WHERE notification_level = 'info') as level_info,
        COUNT(*) FILTER (WHERE notification_level = 'silent') as level_silent
      FROM activity_stream ${whereClause}
    `;

    const statsResult = await db.query<{
      total: string;
      agent_status: string;
      task_progress: string;
      file_change: string;
      build_event: string;
      test_result: string;
      checkpoint: string;
      error: string;
      milestone: string;
      level_critical: string;
      level_warning: string;
      level_info: string;
      level_silent: string;
    }>(statsQuery, params);

    // Get recent unique agents
    const agentsQuery = `
      SELECT DISTINCT agent_id
      FROM activity_stream
      ${whereClause ? whereClause + ' AND' : 'WHERE'} agent_id IS NOT NULL
      ORDER BY agent_id
      LIMIT 10
    `;

    const agentsResult = await db.query<{ agent_id: string }>(
      agentsQuery,
      params
    );

    const row = statsResult.rows[0];

    return {
      totalEvents: parseInt(row.total, 10),
      byEventType: {
        agent_status: parseInt(row.agent_status, 10),
        task_progress: parseInt(row.task_progress, 10),
        file_change: parseInt(row.file_change, 10),
        build_event: parseInt(row.build_event, 10),
        test_result: parseInt(row.test_result, 10),
        checkpoint: parseInt(row.checkpoint, 10),
        error: parseInt(row.error, 10),
        milestone: parseInt(row.milestone, 10),
      },
      byNotificationLevel: {
        critical: parseInt(row.level_critical, 10),
        warning: parseInt(row.level_warning, 10),
        info: parseInt(row.level_info, 10),
        silent: parseInt(row.level_silent, 10),
      },
      recentAgents: agentsResult.rows.map(r => r.agent_id),
    };
  }

  /**
   * Delete old activity events (cleanup).
   */
  async cleanupOldActivity(daysToKeep: number = 30): Promise<number> {
    const db = getDatabase();
    const result = await db.query(
      `DELETE FROM activity_stream WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
      [daysToKeep]
    );

    return result.rowCount ?? 0;
  }

  /**
   * Helper methods for common activity logging.
   */
  async logAgentStatusChange(
    projectId: string,
    agentId: string,
    agentType: string,
    newStatus: string,
    oldStatus?: string
  ): Promise<ActivityEvent> {
    const action = oldStatus
      ? `Agent status changed from ${oldStatus} to ${newStatus}`
      : `Agent status changed to ${newStatus}`;

    const level: NotificationLevel =
      newStatus === 'failed' ? 'warning' :
      newStatus === 'working' || newStatus === 'idle' ? 'info' :
      'silent';

    return this.logActivity(projectId, 'agent_status', action, {
      agentId,
      agentType,
      notificationLevel: level,
    });
  }

  async logTaskProgress(
    projectId: string,
    taskId: string,
    taskTitle: string,
    newStatus: string,
    agentId?: string
  ): Promise<ActivityEvent> {
    const action = `Task "${taskTitle}" status changed to ${newStatus}`;

    const level: NotificationLevel =
      newStatus === 'completed' ? 'info' :
      newStatus === 'failed' ? 'warning' :
      'silent';

    return this.logActivity(projectId, 'task_progress', action, {
      taskId,
      agentId,
      notificationLevel: level,
    });
  }

  async logFileChange(
    projectId: string,
    filePath: string,
    changeType: 'created' | 'modified' | 'deleted',
    agentId?: string
  ): Promise<ActivityEvent> {
    const action = `File ${changeType}: ${filePath}`;

    return this.logActivity(projectId, 'file_change', action, {
      filePath,
      agentId,
      notificationLevel: 'silent',
    });
  }

  async logBuildEvent(
    projectId: string,
    outcome: 'started' | 'success' | 'failed',
    details?: string,
    agentId?: string
  ): Promise<ActivityEvent> {
    const action = `Build ${outcome}`;

    const level: NotificationLevel =
      outcome === 'failed' ? 'critical' :
      outcome === 'success' ? 'info' :
      'silent';

    return this.logActivity(projectId, 'build_event', action, {
      details,
      agentId,
      notificationLevel: level,
    });
  }

  async logTestResult(
    projectId: string,
    passed: boolean,
    details?: string,
    agentId?: string
  ): Promise<ActivityEvent> {
    const action = passed ? 'Tests passed' : 'Tests failed';

    return this.logActivity(projectId, 'test_result', action, {
      details,
      agentId,
      notificationLevel: passed ? 'info' : 'warning',
    });
  }

  async logCheckpoint(
    projectId: string,
    checkpointId: string,
    description?: string,
    agentId?: string
  ): Promise<ActivityEvent> {
    const action = `Checkpoint created: ${checkpointId}`;

    return this.logActivity(projectId, 'checkpoint', action, {
      details: description,
      agentId,
      notificationLevel: 'silent',
    });
  }

  async logError(
    projectId: string,
    errorMessage: string,
    agentId?: string,
    taskId?: string
  ): Promise<ActivityEvent> {
    return this.logActivity(projectId, 'error', errorMessage, {
      agentId,
      taskId,
      notificationLevel: 'warning',
    });
  }

  async logMilestone(
    projectId: string,
    milestoneName: string,
    description?: string
  ): Promise<ActivityEvent> {
    const action = `Milestone reached: ${milestoneName}`;

    return this.logActivity(projectId, 'milestone', action, {
      details: description,
      notificationLevel: 'info',
    });
  }
}

// Factory functions
export function createActivityService(): ActivityService {
  return new ActivityService();
}

let defaultService: ActivityService | null = null;

export function getActivityService(): ActivityService {
  if (!defaultService) {
    defaultService = new ActivityService();
  }
  return defaultService;
}
