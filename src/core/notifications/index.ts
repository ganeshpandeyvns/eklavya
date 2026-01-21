/**
 * Notifications Module
 * Demo₆: Real-Time Portal
 *
 * Provides smart notification system with 4 levels:
 * - critical: Build failures, budget exceeded, security alerts
 * - warning: Demo ready, approval needed, test failures
 * - info: Milestones, task completions, agent spawns
 * - silent: Progress updates, file changes, checkpoints
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';

export type NotificationLevel = 'critical' | 'warning' | 'info' | 'silent';
export type AvailabilityMode = 'active' | 'busy' | 'away' | 'dnd';
export type NotificationChannel = 'sms' | 'push' | 'email' | 'websocket';

export interface Notification {
  id: string;
  projectId: string;
  level: NotificationLevel;
  eventType: string;
  title: string;
  message?: string;
  agentId?: string;
  taskId?: string;
  channelsSent: string[];
  deliveredAt?: Date;
  readAt?: Date;
  acknowledgedAt?: Date;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface NotificationSettings {
  id: string;
  availabilityMode: AvailabilityMode;
  emailEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursMode: AvailabilityMode;
  levelOverrides: Record<string, NotificationChannel[]>;
}

export interface UnreadCount {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface NotificationServiceOptions {
  defaultAvailability?: AvailabilityMode;
}

/**
 * Notification event triggers by level
 */
export const NotificationTriggers: Record<NotificationLevel, string[]> = {
  critical: [
    'build_failed',
    'budget_exceeded',
    'agent_crash',
    'security_alert',
    'system_error',
  ],
  warning: [
    'demo_ready',
    'approval_needed',
    'budget_threshold_75',
    'test_failures',
    'agent_blocked',
  ],
  info: [
    'milestone_complete',
    'task_complete',
    'agent_spawned',
    'build_success',
    'tests_passed',
  ],
  silent: [
    'agent_progress',
    'file_change',
    'checkpoint_created',
    'task_started',
    'agent_heartbeat',
  ],
};

/**
 * Default delivery channels by notification level
 */
export const DefaultChannels: Record<NotificationLevel, NotificationChannel[]> = {
  critical: ['sms', 'push', 'email', 'websocket'],
  warning: ['push', 'email', 'websocket'],
  info: ['push', 'websocket'],
  silent: ['websocket'],
};

/**
 * NotificationService manages notification creation, routing, and delivery.
 */
export class NotificationService extends EventEmitter {
  private availabilityMode: AvailabilityMode;

  constructor(options: NotificationServiceOptions = {}) {
    super();
    this.availabilityMode = options.defaultAvailability || 'active';
  }

  /**
   * Create and send a notification.
   *
   * @param projectId - The project this notification belongs to
   * @param level - Notification severity level
   * @param eventType - Type of event triggering the notification
   * @param title - Notification title
   * @param options - Additional notification options
   * @returns The created notification
   */
  async createNotification(
    projectId: string,
    level: NotificationLevel,
    eventType: string,
    title: string,
    options: {
      message?: string;
      agentId?: string;
      taskId?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<Notification> {
    const db = getDatabase();

    // Get the channels to use for this notification
    const channels = await this.getChannelsForNotification(level);

    // Create the notification via database function
    const result = await db.query<{ create_notification: string }>(
      `SELECT create_notification($1, $2::notification_level, $3, $4, $5, $6, $7, $8)`,
      [
        projectId,
        level,
        eventType,
        title,
        options.message || null,
        options.agentId || null,
        options.taskId || null,
        JSON.stringify(options.metadata || {}),
      ]
    );

    const notificationId = result.rows[0].create_notification;

    // Update channels sent
    await db.query(
      `UPDATE notifications SET channels_sent = $1, delivered_at = NOW() WHERE id = $2`,
      [channels, notificationId]
    );

    // Fetch the full notification
    const notification = await this.getNotification(notificationId);

    // Emit event for real-time delivery
    this.emit('notification:created', notification);

    // Emit level-specific events
    if (level === 'critical') {
      this.emit('notification:critical', notification);
    } else if (level === 'warning') {
      this.emit('notification:warning', notification);
    }

    return notification;
  }

  /**
   * Get a notification by ID.
   */
  async getNotification(notificationId: string): Promise<Notification> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      project_id: string;
      level: string;
      event_type: string;
      title: string;
      message: string;
      agent_id: string;
      task_id: string;
      channels_sent: string[];
      delivered_at: Date;
      read_at: Date;
      acknowledged_at: Date;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT * FROM notifications WHERE id = $1`,
      [notificationId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Notification not found: ${notificationId}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      projectId: row.project_id,
      level: row.level as NotificationLevel,
      eventType: row.event_type,
      title: row.title,
      message: row.message,
      agentId: row.agent_id,
      taskId: row.task_id,
      channelsSent: row.channels_sent || [],
      deliveredAt: row.delivered_at,
      readAt: row.read_at,
      acknowledgedAt: row.acknowledged_at,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    };
  }

  /**
   * Get notifications for a project.
   */
  async getNotifications(
    projectId?: string,
    options: {
      limit?: number;
      offset?: number;
      unreadOnly?: boolean;
      level?: NotificationLevel;
    } = {}
  ): Promise<Notification[]> {
    const db = getDatabase();
    const { limit = 50, offset = 0, unreadOnly = false, level } = options;

    let query = `SELECT * FROM notifications WHERE 1=1`;
    const params: unknown[] = [];
    let paramIndex = 1;

    if (projectId) {
      query += ` AND project_id = $${paramIndex++}`;
      params.push(projectId);
    }

    if (unreadOnly) {
      query += ` AND read_at IS NULL`;
    }

    if (level) {
      query += ` AND level = $${paramIndex++}::notification_level`;
      params.push(level);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await db.query<{
      id: string;
      project_id: string;
      level: string;
      event_type: string;
      title: string;
      message: string;
      agent_id: string;
      task_id: string;
      channels_sent: string[];
      delivered_at: Date;
      read_at: Date;
      acknowledged_at: Date;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      level: row.level as NotificationLevel,
      eventType: row.event_type,
      title: row.title,
      message: row.message,
      agentId: row.agent_id,
      taskId: row.task_id,
      channelsSent: row.channels_sent || [],
      deliveredAt: row.delivered_at,
      readAt: row.read_at,
      acknowledgedAt: row.acknowledged_at,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
  }

  /**
   * Get unread notification count.
   */
  async getUnreadCount(projectId?: string): Promise<UnreadCount> {
    const db = getDatabase();
    const result = await db.query<{
      total: number;
      critical: number;
      warning: number;
      info: number;
    }>(
      `SELECT * FROM get_unread_notification_count($1)`,
      [projectId || null]
    );

    const row = result.rows[0];
    return {
      total: row.total,
      critical: row.critical,
      warning: row.warning,
      info: row.info,
    };
  }

  /**
   * Mark a notification as read.
   */
  async markAsRead(notificationId: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db.query<{ mark_notification_read: boolean }>(
      `SELECT mark_notification_read($1)`,
      [notificationId]
    );

    const success = result.rows[0].mark_notification_read;
    if (success) {
      this.emit('notification:read', { notificationId });
    }
    return success;
  }

  /**
   * Acknowledge a notification.
   */
  async acknowledge(notificationId: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db.query<{ acknowledge_notification: boolean }>(
      `SELECT acknowledge_notification($1)`,
      [notificationId]
    );

    const success = result.rows[0].acknowledge_notification;
    if (success) {
      this.emit('notification:acknowledged', { notificationId });
    }
    return success;
  }

  /**
   * Delete a notification.
   */
  async deleteNotification(notificationId: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db.query(
      `DELETE FROM notifications WHERE id = $1 RETURNING id`,
      [notificationId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get notification settings.
   */
  async getSettings(): Promise<NotificationSettings> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      availability_mode: string;
      email_enabled: boolean;
      push_enabled: boolean;
      sms_enabled: boolean;
      quiet_hours_start: string;
      quiet_hours_end: string;
      quiet_hours_mode: string;
      level_overrides: Record<string, NotificationChannel[]>;
    }>(
      `SELECT * FROM notification_settings LIMIT 1`
    );

    if (result.rows.length === 0) {
      // Return defaults
      return {
        id: '',
        availabilityMode: 'active',
        emailEnabled: true,
        pushEnabled: true,
        smsEnabled: false,
        quietHoursMode: 'away',
        levelOverrides: {},
      };
    }

    const row = result.rows[0];
    return {
      id: row.id,
      availabilityMode: row.availability_mode as AvailabilityMode,
      emailEnabled: row.email_enabled,
      pushEnabled: row.push_enabled,
      smsEnabled: row.sms_enabled,
      quietHoursStart: row.quiet_hours_start,
      quietHoursEnd: row.quiet_hours_end,
      quietHoursMode: row.quiet_hours_mode as AvailabilityMode,
      levelOverrides: row.level_overrides || {},
    };
  }

  /**
   * Update notification settings.
   */
  async updateSettings(
    settings: Partial<Omit<NotificationSettings, 'id'>>
  ): Promise<NotificationSettings> {
    const db = getDatabase();
    const current = await this.getSettings();

    // Format quiet hours properly for TIME columns
    const quietStart = settings.quietHoursStart ?? current.quietHoursStart ?? null;
    const quietEnd = settings.quietHoursEnd ?? current.quietHoursEnd ?? null;

    await db.query(
      `UPDATE notification_settings SET
        availability_mode = $1::availability_mode,
        email_enabled = $2,
        push_enabled = $3,
        sms_enabled = $4,
        quiet_hours_start = $5::TIME,
        quiet_hours_end = $6::TIME,
        quiet_hours_mode = $7::availability_mode,
        level_overrides = $8,
        updated_at = NOW()
        WHERE user_id IS NULL`,
      [
        settings.availabilityMode ?? current.availabilityMode,
        settings.emailEnabled ?? current.emailEnabled,
        settings.pushEnabled ?? current.pushEnabled,
        settings.smsEnabled ?? current.smsEnabled,
        quietStart,
        quietEnd,
        settings.quietHoursMode ?? current.quietHoursMode,
        JSON.stringify(settings.levelOverrides ?? current.levelOverrides),
      ]
    );

    // Update local availability mode
    if (settings.availabilityMode) {
      this.availabilityMode = settings.availabilityMode;
    }

    this.emit('settings:updated', await this.getSettings());
    return this.getSettings();
  }

  /**
   * Set availability mode.
   */
  async setAvailabilityMode(mode: AvailabilityMode): Promise<void> {
    await this.updateSettings({ availabilityMode: mode });
    this.availabilityMode = mode;
    this.emit('availability:changed', { mode });
  }

  /**
   * Get the current availability mode.
   */
  getAvailabilityMode(): AvailabilityMode {
    return this.availabilityMode;
  }

  /**
   * Determine which channels to use for a notification.
   */
  async getChannelsForNotification(level: NotificationLevel): Promise<NotificationChannel[]> {
    const db = getDatabase();
    const result = await db.query<{ get_notification_channels: string[] }>(
      `SELECT get_notification_channels($1::notification_level, $2::availability_mode)`,
      [level, this.availabilityMode]
    );

    return result.rows[0].get_notification_channels as NotificationChannel[];
  }

  /**
   * Check if we're currently in quiet hours.
   */
  async isInQuietHours(): Promise<boolean> {
    const settings = await this.getSettings();

    if (!settings.quietHoursStart || !settings.quietHoursEnd) {
      return false;
    }

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const start = settings.quietHoursStart;
    const end = settings.quietHoursEnd;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (start > end) {
      return currentTime >= start || currentTime <= end;
    }

    return currentTime >= start && currentTime <= end;
  }

  /**
   * Get the notification level for an event type.
   */
  getLevelForEventType(eventType: string): NotificationLevel {
    for (const [level, events] of Object.entries(NotificationTriggers)) {
      if (events.includes(eventType)) {
        return level as NotificationLevel;
      }
    }
    return 'silent';
  }

  /**
   * Quick helper to create notifications for common events.
   */
  async notifyBuildFailed(projectId: string, details: string, agentId?: string): Promise<Notification> {
    return this.createNotification(projectId, 'critical', 'build_failed', 'Build Failed', {
      message: details,
      agentId,
    });
  }

  async notifyDemoReady(projectId: string, demoUrl?: string): Promise<Notification> {
    return this.createNotification(projectId, 'warning', 'demo_ready', 'Demo Ready for Review', {
      message: demoUrl ? `Demo available at: ${demoUrl}` : 'Demo is ready for your review',
      metadata: { demoUrl },
    });
  }

  async notifyMilestoneComplete(projectId: string, milestone: string): Promise<Notification> {
    return this.createNotification(projectId, 'info', 'milestone_complete', `Milestone Complete: ${milestone}`, {
      metadata: { milestone },
    });
  }

  async notifyTaskComplete(projectId: string, taskTitle: string, taskId: string): Promise<Notification> {
    return this.createNotification(projectId, 'info', 'task_complete', `Task Complete: ${taskTitle}`, {
      taskId,
    });
  }
}

// Factory functions
export function createNotificationService(options?: NotificationServiceOptions): NotificationService {
  return new NotificationService(options);
}

let defaultService: NotificationService | null = null;

export function getNotificationService(options?: NotificationServiceOptions): NotificationService {
  if (!defaultService) {
    defaultService = new NotificationService(options);
  }
  return defaultService;
}
