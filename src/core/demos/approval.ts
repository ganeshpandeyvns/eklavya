/**
 * Approval Workflow Module
 * Demo₇: Demo System
 *
 * Provides approval workflow for demos:
 * - Request approval
 * - Process decisions (approve, reject, request changes)
 * - Track approval history
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';
import { getDemoService } from './index.js';

export type ApprovalDecision = 'approve' | 'request_changes' | 'skip_to_build' | 'reject';
export type NextAction = 'build_next_demo' | 'revise_demo' | 'proceed_to_build' | 'cancel';

export interface ApprovalRequest {
  id: string;
  demoId: string;
  projectId: string;
  requestedAt: Date;
  requestedBy: string;
  decision?: ApprovalDecision;
  decidedAt?: Date;
  decidedBy?: string;
  comments?: string;
  changeRequests: string[];
  nextAction?: NextAction;
}

export interface PendingApproval {
  requestId: string;
  demoId: string;
  projectId: string;
  demoName: string;
  demoType: string;
  requestedAt: Date;
  requestedBy: string;
}

export interface ApprovalDecisionOptions {
  comments?: string;
  changeRequests?: string[];
}

/**
 * ApprovalService manages the demo approval workflow.
 */
export class ApprovalService extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Request approval for a demo.
   */
  async requestApproval(demoId: string, requestedBy: string = 'system'): Promise<ApprovalRequest> {
    const db = getDatabase();

    const result = await db.query<{ request_demo_approval: string }>(
      `SELECT request_demo_approval($1, $2)`,
      [demoId, requestedBy]
    );

    const requestId = result.rows[0].request_demo_approval;
    const request = await this.getApprovalRequest(requestId);

    this.emit('approval:requested', request);
    return request;
  }

  /**
   * Get an approval request by ID.
   */
  async getApprovalRequest(requestId: string): Promise<ApprovalRequest> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      demo_id: string;
      project_id: string;
      requested_at: Date;
      requested_by: string;
      decision: string;
      decided_at: Date;
      decided_by: string;
      comments: string;
      change_requests: string[];
      next_action: string;
    }>(
      `SELECT * FROM approval_requests WHERE id = $1`,
      [requestId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Approval request not found: ${requestId}`);
    }

    return this.mapRowToRequest(result.rows[0]);
  }

  /**
   * Get the latest approval request for a demo.
   */
  async getLatestApprovalForDemo(demoId: string): Promise<ApprovalRequest | null> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      demo_id: string;
      project_id: string;
      requested_at: Date;
      requested_by: string;
      decision: string;
      decided_at: Date;
      decided_by: string;
      comments: string;
      change_requests: string[];
      next_action: string;
    }>(
      `SELECT * FROM approval_requests WHERE demo_id = $1 ORDER BY requested_at DESC LIMIT 1`,
      [demoId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToRequest(result.rows[0]);
  }

  /**
   * Get all pending approvals.
   */
  async getPendingApprovals(): Promise<PendingApproval[]> {
    const db = getDatabase();
    const result = await db.query<{
      request_id: string;
      demo_id: string;
      project_id: string;
      demo_name: string;
      demo_type: string;
      requested_at: Date;
      requested_by: string;
    }>(
      `SELECT * FROM get_pending_approvals()`
    );

    return result.rows.map(row => ({
      requestId: row.request_id,
      demoId: row.demo_id,
      projectId: row.project_id,
      demoName: row.demo_name,
      demoType: row.demo_type,
      requestedAt: row.requested_at,
      requestedBy: row.requested_by,
    }));
  }

  /**
   * Approve a demo.
   */
  async approve(
    requestId: string,
    decidedBy: string,
    options: ApprovalDecisionOptions = {}
  ): Promise<boolean> {
    return this.processDecision(requestId, 'approve', decidedBy, options);
  }

  /**
   * Request changes for a demo.
   */
  async requestChanges(
    requestId: string,
    decidedBy: string,
    options: ApprovalDecisionOptions = {}
  ): Promise<boolean> {
    if (!options.changeRequests || options.changeRequests.length === 0) {
      throw new Error('Change requests are required when requesting changes');
    }
    return this.processDecision(requestId, 'request_changes', decidedBy, options);
  }

  /**
   * Skip remaining demos and proceed to build.
   */
  async skipToBuild(
    requestId: string,
    decidedBy: string,
    options: ApprovalDecisionOptions = {}
  ): Promise<boolean> {
    return this.processDecision(requestId, 'skip_to_build', decidedBy, options);
  }

  /**
   * Reject a demo.
   */
  async reject(
    requestId: string,
    decidedBy: string,
    options: ApprovalDecisionOptions = {}
  ): Promise<boolean> {
    return this.processDecision(requestId, 'reject', decidedBy, options);
  }

  /**
   * Process an approval decision.
   */
  private async processDecision(
    requestId: string,
    decision: ApprovalDecision,
    decidedBy: string,
    options: ApprovalDecisionOptions
  ): Promise<boolean> {
    const db = getDatabase();

    const result = await db.query<{ process_approval_decision: boolean }>(
      `SELECT process_approval_decision($1, $2::approval_decision, $3, $4, $5)`,
      [
        requestId,
        decision,
        decidedBy,
        options.comments || null,
        JSON.stringify(options.changeRequests || []),
      ]
    );

    const success = result.rows[0].process_approval_decision;

    if (success) {
      const request = await this.getApprovalRequest(requestId);
      this.emit('approval:decided', { request, decision });

      // Emit specific events based on decision
      if (decision === 'approve' || decision === 'skip_to_build') {
        this.emit('approval:approved', request);
      } else if (decision === 'request_changes') {
        this.emit('approval:changes_requested', request);
      } else if (decision === 'reject') {
        this.emit('approval:rejected', request);
      }
    }

    return success;
  }

  /**
   * Get approval history for a demo.
   */
  async getApprovalHistory(demoId: string): Promise<ApprovalRequest[]> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      demo_id: string;
      project_id: string;
      requested_at: Date;
      requested_by: string;
      decision: string;
      decided_at: Date;
      decided_by: string;
      comments: string;
      change_requests: string[];
      next_action: string;
    }>(
      `SELECT * FROM approval_requests WHERE demo_id = $1 ORDER BY requested_at DESC`,
      [demoId]
    );

    return result.rows.map(row => this.mapRowToRequest(row));
  }

  /**
   * Get approval history for a project.
   */
  async getProjectApprovalHistory(projectId: string): Promise<ApprovalRequest[]> {
    const db = getDatabase();
    const result = await db.query<{
      id: string;
      demo_id: string;
      project_id: string;
      requested_at: Date;
      requested_by: string;
      decision: string;
      decided_at: Date;
      decided_by: string;
      comments: string;
      change_requests: string[];
      next_action: string;
    }>(
      `SELECT * FROM approval_requests WHERE project_id = $1 ORDER BY requested_at DESC`,
      [projectId]
    );

    return result.rows.map(row => this.mapRowToRequest(row));
  }

  /**
   * Check if a demo is pending approval.
   */
  async isPendingApproval(demoId: string): Promise<boolean> {
    const latest = await this.getLatestApprovalForDemo(demoId);
    return latest !== null && latest.decision === undefined;
  }

  /**
   * Map database row to ApprovalRequest interface.
   */
  private mapRowToRequest(row: {
    id: string;
    demo_id: string;
    project_id: string;
    requested_at: Date;
    requested_by: string;
    decision: string | null;
    decided_at: Date | null;
    decided_by: string | null;
    comments: string | null;
    change_requests: string[] | null;
    next_action: string | null;
  }): ApprovalRequest {
    return {
      id: row.id,
      demoId: row.demo_id,
      projectId: row.project_id,
      requestedAt: row.requested_at,
      requestedBy: row.requested_by,
      decision: row.decision ? (row.decision as ApprovalDecision) : undefined,
      decidedAt: row.decided_at || undefined,
      decidedBy: row.decided_by || undefined,
      comments: row.comments || undefined,
      changeRequests: row.change_requests || [],
      nextAction: row.next_action ? (row.next_action as NextAction) : undefined,
    };
  }
}

// Factory functions
export function createApprovalService(): ApprovalService {
  return new ApprovalService();
}

let defaultService: ApprovalService | null = null;

export function getApprovalService(): ApprovalService {
  if (!defaultService) {
    defaultService = new ApprovalService();
  }
  return defaultService;
}
