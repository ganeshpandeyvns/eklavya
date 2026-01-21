/**
 * Demo Management Module
 * Demo₇: Demo System
 *
 * Provides demo lifecycle management:
 * - Demo creation and versioning
 * - Status transitions
 * - Preview URL management
 * - Scaffolding tracking
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';

export type DemoType = 'wow' | 'trust' | 'milestone' | 'final';
export type DemoStatus = 'draft' | 'building' | 'ready' | 'approved' | 'revision_requested' | 'archived';

export interface DemoConfig {
  features: string[];
  excludedFeatures: string[];
  scaffoldingPercent: number;
  estimatedTime: number;
  estimatedCost: number;
}

export interface ScaffoldingInfo {
  totalFiles: number;
  reusableFiles: number;
  reusablePercent: number;
  components: string[];
  routes: string[];
  styles: string[];
}

export interface VerificationResult {
  passed: boolean;
  passedCount: number;
  failedCount: number;
  summary?: string;
}

export interface Demo {
  id: string;
  projectId: string;
  type: DemoType;
  version: number;
  name: string;
  description?: string;
  status: DemoStatus;
  previewUrl?: string;
  previewPort?: number;
  previewPid?: number;
  verifiedAt?: Date;
  verificationResult?: VerificationResult;
  config: DemoConfig;
  scaffolding: ScaffoldingInfo;
  createdAt: Date;
  builtAt?: Date;
  readyAt?: Date;
  approvedAt?: Date;
  archivedAt?: Date;
}

export interface DemoStats {
  totalDemos: number;
  draftCount: number;
  buildingCount: number;
  readyCount: number;
  approvedCount: number;
  revisionRequestedCount: number;
  archivedCount: number;
  avgApprovalTimeHours?: number;
}

export interface CreateDemoOptions {
  type?: DemoType;
  name: string;
  description?: string;
  config?: Partial<DemoConfig>;
}

/**
 * DemoService manages demo lifecycle and operations.
 */
export class DemoService extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Create a new demo for a project.
   */
  async createDemo(projectId: string, options: CreateDemoOptions): Promise<Demo> {
    const db = getDatabase();

    const config: DemoConfig = {
      features: options.config?.features || [],
      excludedFeatures: options.config?.excludedFeatures || [],
      scaffoldingPercent: options.config?.scaffoldingPercent || 0,
      estimatedTime: options.config?.estimatedTime || 0,
      estimatedCost: options.config?.estimatedCost || 0,
    };

    const result = await db.query<{ create_demo: string }>(
      `SELECT create_demo($1, $2::demo_type, $3, $4, $5)`,
      [
        projectId,
        options.type || 'milestone',
        options.name,
        options.description || null,
        JSON.stringify(config),
      ]
    );

    const demoId = result.rows[0].create_demo;
    const demo = await this.getDemo(demoId);

    this.emit('demo:created', demo);
    return demo;
  }

  /**
   * Get a demo by ID.
   */
  async getDemo(demoId: string): Promise<Demo> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      project_id: string;
      type: string;
      version: number;
      name: string;
      description: string;
      status: string;
      preview_url: string;
      preview_port: number;
      preview_pid: number;
      verified_at: Date;
      verification_result: VerificationResult;
      config: DemoConfig;
      scaffolding: ScaffoldingInfo;
      created_at: Date;
      built_at: Date;
      ready_at: Date;
      approved_at: Date;
      archived_at: Date;
    }>(
      `SELECT * FROM demos WHERE id = $1`,
      [demoId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Demo not found: ${demoId}`);
    }

    return this.mapRowToDemo(result.rows[0]);
  }

  /**
   * List demos for a project.
   */
  async listDemos(projectId: string, options: { status?: DemoStatus; limit?: number } = {}): Promise<Demo[]> {
    const db = getDatabase();
    const { status, limit = 50 } = options;

    let query = `SELECT * FROM demos WHERE project_id = $1`;
    const params: unknown[] = [projectId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex++}::demo_status`;
      params.push(status);
    }

    query += ` ORDER BY version DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.query<{
      id: string;
      project_id: string;
      type: string;
      version: number;
      name: string;
      description: string;
      status: string;
      preview_url: string;
      preview_port: number;
      preview_pid: number;
      verified_at: Date;
      verification_result: VerificationResult;
      config: DemoConfig;
      scaffolding: ScaffoldingInfo;
      created_at: Date;
      built_at: Date;
      ready_at: Date;
      approved_at: Date;
      archived_at: Date;
    }>(query, params);

    return result.rows.map(row => this.mapRowToDemo(row));
  }

  /**
   * Update demo status with validation.
   */
  async updateStatus(demoId: string, newStatus: DemoStatus): Promise<boolean> {
    const db = getDatabase();

    const result = await db.query<{ update_demo_status: boolean }>(
      `SELECT update_demo_status($1, $2::demo_status)`,
      [demoId, newStatus]
    );

    const success = result.rows[0].update_demo_status;

    if (success) {
      const demo = await this.getDemo(demoId);
      this.emit('demo:status_changed', { demo, newStatus });
    }

    return success;
  }

  /**
   * Start building a demo.
   */
  async startBuild(demoId: string): Promise<boolean> {
    const success = await this.updateStatus(demoId, 'building');
    if (success) {
      this.emit('demo:build_started', { demoId });
    }
    return success;
  }

  /**
   * Mark demo as ready for review.
   */
  async markReady(demoId: string): Promise<boolean> {
    const success = await this.updateStatus(demoId, 'ready');
    if (success) {
      this.emit('demo:ready', { demoId });
    }
    return success;
  }

  /**
   * Archive a demo.
   */
  async archiveDemo(demoId: string): Promise<boolean> {
    const success = await this.updateStatus(demoId, 'archived');
    if (success) {
      this.emit('demo:archived', { demoId });
    }
    return success;
  }

  /**
   * Update demo configuration.
   */
  async updateConfig(demoId: string, config: Partial<DemoConfig>): Promise<Demo> {
    const db = getDatabase();
    const demo = await this.getDemo(demoId);

    const updatedConfig = { ...demo.config, ...config };

    await db.query(
      `UPDATE demos SET config = $1 WHERE id = $2`,
      [JSON.stringify(updatedConfig), demoId]
    );

    return this.getDemo(demoId);
  }

  /**
   * Update scaffolding info.
   */
  async updateScaffolding(demoId: string, scaffolding: Partial<ScaffoldingInfo>): Promise<Demo> {
    const db = getDatabase();
    const demo = await this.getDemo(demoId);

    const updatedScaffolding = { ...demo.scaffolding, ...scaffolding };

    // Recalculate reusable percent
    if (updatedScaffolding.totalFiles > 0) {
      updatedScaffolding.reusablePercent =
        Math.round((updatedScaffolding.reusableFiles / updatedScaffolding.totalFiles) * 100);
    }

    await db.query(
      `UPDATE demos SET scaffolding = $1 WHERE id = $2`,
      [JSON.stringify(updatedScaffolding), demoId]
    );

    return this.getDemo(demoId);
  }

  /**
   * Set preview URL for a demo.
   */
  async setPreviewUrl(demoId: string, url: string, port?: number, pid?: number): Promise<Demo> {
    const db = getDatabase();

    await db.query(
      `UPDATE demos SET preview_url = $1, preview_port = $2, preview_pid = $3 WHERE id = $4`,
      [url, port || null, pid || null, demoId]
    );

    const demo = await this.getDemo(demoId);
    this.emit('demo:preview_started', { demoId, url });
    return demo;
  }

  /**
   * Clear preview info (when preview is stopped).
   */
  async clearPreview(demoId: string): Promise<Demo> {
    const db = getDatabase();

    await db.query(
      `UPDATE demos SET preview_url = NULL, preview_port = NULL, preview_pid = NULL WHERE id = $1`,
      [demoId]
    );

    const demo = await this.getDemo(demoId);
    this.emit('demo:preview_stopped', { demoId });
    return demo;
  }

  /**
   * Get demo statistics.
   */
  async getStats(projectId?: string): Promise<DemoStats> {
    const db = getDatabase();

    const result = await db.query<{
      total_demos: number;
      draft_count: number;
      building_count: number;
      ready_count: number;
      approved_count: number;
      revision_requested_count: number;
      archived_count: number;
      avg_approval_time_hours: string;
    }>(
      `SELECT * FROM get_demo_stats($1)`,
      [projectId || null]
    );

    const row = result.rows[0];
    return {
      totalDemos: row.total_demos,
      draftCount: row.draft_count,
      buildingCount: row.building_count,
      readyCount: row.ready_count,
      approvedCount: row.approved_count,
      revisionRequestedCount: row.revision_requested_count,
      archivedCount: row.archived_count,
      avgApprovalTimeHours: row.avg_approval_time_hours
        ? parseFloat(row.avg_approval_time_hours)
        : undefined,
    };
  }

  /**
   * Get the latest demo for a project.
   */
  async getLatestDemo(projectId: string): Promise<Demo | null> {
    const db = getDatabase();

    const result = await db.query<{
      id: string;
      project_id: string;
      type: string;
      version: number;
      name: string;
      description: string;
      status: string;
      preview_url: string;
      preview_port: number;
      preview_pid: number;
      verified_at: Date;
      verification_result: VerificationResult;
      config: DemoConfig;
      scaffolding: ScaffoldingInfo;
      created_at: Date;
      built_at: Date;
      ready_at: Date;
      approved_at: Date;
      archived_at: Date;
    }>(
      `SELECT * FROM demos WHERE project_id = $1 ORDER BY version DESC LIMIT 1`,
      [projectId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToDemo(result.rows[0]);
  }

  /**
   * Delete a demo (only drafts can be deleted).
   */
  async deleteDemo(demoId: string): Promise<boolean> {
    const db = getDatabase();
    const demo = await this.getDemo(demoId);

    if (demo.status !== 'draft') {
      throw new Error('Only draft demos can be deleted');
    }

    const result = await db.query(
      `DELETE FROM demos WHERE id = $1 AND status = 'draft'`,
      [demoId]
    );

    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
      this.emit('demo:deleted', { demoId });
    }

    return deleted;
  }

  /**
   * Map database row to Demo interface.
   */
  private mapRowToDemo(row: {
    id: string;
    project_id: string;
    type: string;
    version: number;
    name: string;
    description: string;
    status: string;
    preview_url: string;
    preview_port: number;
    preview_pid: number;
    verified_at: Date;
    verification_result: VerificationResult;
    config: DemoConfig;
    scaffolding: ScaffoldingInfo;
    created_at: Date;
    built_at: Date;
    ready_at: Date;
    approved_at: Date;
    archived_at: Date;
  }): Demo {
    return {
      id: row.id,
      projectId: row.project_id,
      type: row.type as DemoType,
      version: row.version,
      name: row.name,
      description: row.description,
      status: row.status as DemoStatus,
      previewUrl: row.preview_url,
      previewPort: row.preview_port,
      previewPid: row.preview_pid,
      verifiedAt: row.verified_at,
      verificationResult: row.verification_result,
      config: row.config || {
        features: [],
        excludedFeatures: [],
        scaffoldingPercent: 0,
        estimatedTime: 0,
        estimatedCost: 0,
      },
      scaffolding: row.scaffolding || {
        totalFiles: 0,
        reusableFiles: 0,
        reusablePercent: 0,
        components: [],
        routes: [],
        styles: [],
      },
      createdAt: row.created_at,
      builtAt: row.built_at,
      readyAt: row.ready_at,
      approvedAt: row.approved_at,
      archivedAt: row.archived_at,
    };
  }
}

// Factory functions
export function createDemoService(): DemoService {
  return new DemoService();
}

let defaultService: DemoService | null = null;

export function getDemoService(): DemoService {
  if (!defaultService) {
    defaultService = new DemoService();
  }
  return defaultService;
}
