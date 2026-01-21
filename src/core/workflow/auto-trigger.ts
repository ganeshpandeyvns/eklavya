/**
 * Auto-Trigger Hook
 * Automatically triggers workflow phases when projects are created or updated.
 *
 * This module provides hooks that can be called from:
 * - CLI (when creating a new project)
 * - API (when project is created via REST)
 * - Database triggers (PostgreSQL LISTEN/NOTIFY)
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';
import { getWorkflowEngine, WorkflowEngine, WorkflowEngineOptions } from './engine.js';
import { getNotificationService, NotificationLevel } from '../notifications/index.js';
import { getActivityService } from '../activity/index.js';
import type { Project, EklavyaConfig } from '../../types/index.js';

export interface AutoTriggerConfig {
  enabled: boolean;
  autoStartBuild: boolean;
  notifyOnTrigger: boolean;
  delayMs?: number;
}

const DEFAULT_CONFIG: AutoTriggerConfig = {
  enabled: true,
  autoStartBuild: false,  // Default to manual build start
  notifyOnTrigger: true,
  delayMs: 1000,
};

/**
 * AutoTriggerService manages automatic workflow triggers
 */
export class AutoTriggerService extends EventEmitter {
  private config: AutoTriggerConfig;
  private workflowConfig?: EklavyaConfig;
  private pendingTriggers: Map<string, NodeJS.Timeout> = new Map();
  private isListening: boolean = false;

  constructor(config: Partial<AutoTriggerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set workflow engine configuration
   */
  setWorkflowConfig(config: EklavyaConfig): void {
    this.workflowConfig = config;
  }

  /**
   * Start listening for database events
   */
  async startListening(): Promise<void> {
    if (this.isListening) {
      return;
    }

    const db = getDatabase();

    // Subscribe to project changes
    db.on('projects:insert', async (data) => {
      if (this.config.enabled) {
        await this.onProjectCreated(data.new_data);
      }
    });

    db.on('projects:update', async (data) => {
      if (this.config.enabled) {
        await this.onProjectUpdated(data.old_data, data.new_data);
      }
    });

    // Start PostgreSQL LISTEN
    await db.startListening();
    this.isListening = true;

    this.emit('listening:started');
  }

  /**
   * Stop listening for database events
   */
  async stopListening(): Promise<void> {
    if (!this.isListening) {
      return;
    }

    const db = getDatabase();
    await db.stopListening();
    this.isListening = false;

    // Clear pending triggers
    for (const timeout of this.pendingTriggers.values()) {
      clearTimeout(timeout);
    }
    this.pendingTriggers.clear();

    this.emit('listening:stopped');
  }

  /**
   * Handle project creation event
   */
  async onProjectCreated(project: Partial<Project>): Promise<void> {
    if (!project.id) {
      return;
    }

    const projectId = project.id;

    this.emit('project:created', { projectId, project });

    // Log activity
    const activityService = getActivityService();
    await activityService.logMilestone(
      projectId,
      'Project Created',
      `Project "${project.name}" created. Auto-build: ${this.config.autoStartBuild}`
    );

    // Send notification if enabled
    if (this.config.notifyOnTrigger) {
      const notificationService = getNotificationService();
      await notificationService.createNotification(
        projectId,
        'info' as NotificationLevel,
        'project_created',
        'Project Created',
        {
          message: `Project "${project.name}" has been created.`,
          metadata: { projectId },
        }
      );
    }

    // Update project status to planning
    const db = getDatabase();
    await db.query(
      'UPDATE projects SET status = $1, updated_at = NOW() WHERE id = $2 AND status IS DISTINCT FROM $1',
      ['planning', projectId]
    );

    // Auto-start build if configured
    if (this.config.autoStartBuild && this.workflowConfig) {
      await this.queueBuildTrigger(projectId);
    }
  }

  /**
   * Handle project update event
   */
  async onProjectUpdated(oldProject: Partial<Project>, newProject: Partial<Project>): Promise<void> {
    if (!newProject.id) {
      return;
    }

    const projectId = newProject.id;
    const oldStatus = oldProject.status;
    const newStatus = newProject.status;

    // Status changed
    if (oldStatus !== newStatus) {
      this.emit('project:status_changed', {
        projectId,
        oldStatus,
        newStatus,
      });

      // Trigger specific actions based on status changes
      await this.handleStatusChange(projectId, oldStatus as string, newStatus as string);
    }
  }

  /**
   * Handle status change transitions
   */
  private async handleStatusChange(
    projectId: string,
    oldStatus: string,
    newStatus: string
  ): Promise<void> {
    // Log the status change
    const activityService = getActivityService();
    await activityService.logMilestone(
      projectId,
      `Status: ${newStatus}`,
      `Status changed from ${oldStatus} to ${newStatus}`
    );

    // Handle specific transitions
    switch (newStatus) {
      case 'planning':
        // Project is ready for architect phase
        if (this.config.autoStartBuild && this.workflowConfig) {
          await this.queueBuildTrigger(projectId);
        }
        break;

      case 'demo_approved':
        // Demo was approved, continue to next phase
        this.emit('demo:approved', { projectId });
        break;

      case 'completed':
        // Project completed
        await this.onProjectCompleted(projectId);
        break;

      case 'failed':
        // Project failed
        await this.onProjectFailed(projectId);
        break;
    }
  }

  /**
   * Queue a build trigger with optional delay
   */
  async queueBuildTrigger(projectId: string): Promise<void> {
    // Cancel any pending trigger
    if (this.pendingTriggers.has(projectId)) {
      clearTimeout(this.pendingTriggers.get(projectId)!);
    }

    const delay = this.config.delayMs || 0;

    if (delay > 0) {
      // Schedule trigger after delay
      const timeout = setTimeout(async () => {
        this.pendingTriggers.delete(projectId);
        await this.triggerBuild(projectId);
      }, delay);

      this.pendingTriggers.set(projectId, timeout);
      this.emit('build:queued', { projectId, delay });
    } else {
      // Trigger immediately
      await this.triggerBuild(projectId);
    }
  }

  /**
   * Trigger build for a project
   */
  async triggerBuild(projectId: string): Promise<void> {
    if (!this.workflowConfig) {
      console.warn('Cannot trigger build: workflow config not set');
      return;
    }

    try {
      const engine = getWorkflowEngine({
        config: this.workflowConfig,
      });

      this.emit('build:starting', { projectId });

      await engine.startProjectBuild(projectId);

      this.emit('build:started', { projectId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to trigger build for project ${projectId}:`, errorMessage);
      this.emit('build:failed', { projectId, error: errorMessage });
    }
  }

  /**
   * Manually trigger workflow for a project
   */
  async triggerWorkflow(projectId: string, options?: { skipDelay?: boolean }): Promise<void> {
    if (options?.skipDelay) {
      await this.triggerBuild(projectId);
    } else {
      await this.queueBuildTrigger(projectId);
    }
  }

  /**
   * Handle project completion
   */
  private async onProjectCompleted(projectId: string): Promise<void> {
    const notificationService = getNotificationService();
    await notificationService.createNotification(
      projectId,
      'info' as NotificationLevel,
      'build_success',
      'Project Completed',
      {
        message: 'Your project has been built successfully.',
        metadata: { projectId },
      }
    );

    this.emit('project:completed', { projectId });
  }

  /**
   * Handle project failure
   */
  private async onProjectFailed(projectId: string): Promise<void> {
    const notificationService = getNotificationService();
    await notificationService.createNotification(
      projectId,
      'critical' as NotificationLevel,
      'build_failed',
      'Project Build Failed',
      {
        message: 'Your project build has failed. Please check the logs for details.',
        metadata: { projectId },
      }
    );

    this.emit('project:failed', { projectId });
  }

  /**
   * Enable or disable auto-trigger
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.emit('config:changed', { enabled });
  }

  /**
   * Enable or disable auto-start build
   */
  setAutoStartBuild(autoStart: boolean): void {
    this.config.autoStartBuild = autoStart;
    this.emit('config:changed', { autoStartBuild: autoStart });
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoTriggerConfig {
    return { ...this.config };
  }

  /**
   * Check if service is listening
   */
  isActive(): boolean {
    return this.isListening;
  }
}

// Singleton instance
let autoTriggerService: AutoTriggerService | null = null;

export function getAutoTriggerService(config?: Partial<AutoTriggerConfig>): AutoTriggerService {
  if (!autoTriggerService) {
    autoTriggerService = new AutoTriggerService(config);
  }
  return autoTriggerService;
}

/**
 * Helper function to trigger build from CLI/API
 */
export async function triggerProjectBuild(
  projectId: string,
  workflowConfig: EklavyaConfig,
  options?: { autoApprove?: boolean }
): Promise<void> {
  const engine = getWorkflowEngine({
    config: workflowConfig,
    autoApprove: options?.autoApprove,
  });

  await engine.startProjectBuild(projectId);
}

/**
 * Hook to be called after project creation
 */
export async function onProjectCreatedHook(
  projectId: string,
  projectName: string,
  workflowConfig?: EklavyaConfig
): Promise<void> {
  const service = getAutoTriggerService();

  if (workflowConfig) {
    service.setWorkflowConfig(workflowConfig);
  }

  await service.onProjectCreated({
    id: projectId,
    name: projectName,
    status: 'planning',
  });
}
