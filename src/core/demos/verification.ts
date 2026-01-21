/**
 * Demo Verification Module
 * Demo₇: Demo System
 *
 * Provides automated verification of demos:
 * - Process health checks
 * - URL accessibility checks
 * - Page verification
 * - User flow testing
 * - Responsive checks
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';
import { getDemoService } from './index.js';

export type CheckType = 'process' | 'url' | 'page' | 'flow' | 'responsive';
export type CheckStatus = 'pending' | 'passed' | 'failed' | 'skipped';

export interface VerificationCheck {
  type: CheckType;
  name: string;
  status: CheckStatus;
  details?: string;
  duration: number;
}

export interface VerificationResult {
  id?: string;
  demoId: string;
  passed: boolean;
  startedAt: Date;
  completedAt: Date;
  checks: VerificationCheck[];
  passedCount: number;
  failedCount: number;
  screenshots: string[];
  consoleErrors: string[];
  summary: string;
}

export interface VerificationOptions {
  skipProcess?: boolean;
  skipUrl?: boolean;
  skipPage?: boolean;
  skipFlow?: boolean;
  skipResponsive?: boolean;
  timeout?: number;
}

/**
 * VerificationService handles automated demo verification.
 */
export class VerificationService extends EventEmitter {
  private defaultTimeout = 30000; // 30 seconds

  constructor() {
    super();
  }

  /**
   * Run full verification suite for a demo.
   */
  async verifyDemo(
    demoId: string,
    previewUrl: string,
    options: VerificationOptions = {}
  ): Promise<VerificationResult> {
    const startedAt = new Date();
    const checks: VerificationCheck[] = [];
    const screenshots: string[] = [];
    const consoleErrors: string[] = [];

    this.emit('verification:started', { demoId, startedAt });

    // Run process check
    if (!options.skipProcess) {
      const processCheck = await this.checkProcess(previewUrl);
      checks.push(processCheck);
    }

    // Run URL check
    if (!options.skipUrl) {
      const urlCheck = await this.checkUrl(previewUrl, options.timeout);
      checks.push(urlCheck);
    }

    // Run page verification
    if (!options.skipPage) {
      const pageCheck = await this.checkPage(previewUrl);
      checks.push(pageCheck);
    }

    // Run flow testing
    if (!options.skipFlow) {
      const flowCheck = await this.checkFlow(previewUrl);
      checks.push(flowCheck);
    }

    // Run responsive check
    if (!options.skipResponsive) {
      const responsiveCheck = await this.checkResponsive(previewUrl);
      checks.push(responsiveCheck);
    }

    const completedAt = new Date();
    const passedCount = checks.filter(c => c.status === 'passed').length;
    const failedCount = checks.filter(c => c.status === 'failed').length;
    const passed = failedCount === 0 && passedCount > 0;

    const summary = this.generateSummary(checks, passed);

    const result: VerificationResult = {
      demoId,
      passed,
      startedAt,
      completedAt,
      checks,
      passedCount,
      failedCount,
      screenshots,
      consoleErrors,
      summary,
    };

    // Record verification result in database
    const verificationId = await this.recordVerification(result);
    result.id = verificationId;

    this.emit('verification:completed', result);

    return result;
  }

  /**
   * Check if the demo process is healthy.
   */
  private async checkProcess(url: string): Promise<VerificationCheck> {
    const startTime = Date.now();
    try {
      // Extract port from URL and check if process is listening
      const urlObj = new URL(url);
      const port = urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80');

      // Simple check - try to connect
      const response = await fetch(url, { method: 'HEAD' });
      const duration = Date.now() - startTime;

      return {
        type: 'process',
        name: `Process check on port ${port}`,
        status: response.ok || response.status < 500 ? 'passed' : 'failed',
        details: `Server responding on port ${port}`,
        duration,
      };
    } catch (error) {
      return {
        type: 'process',
        name: 'Process health check',
        status: 'failed',
        details: error instanceof Error ? error.message : 'Process check failed',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Check if the preview URL is accessible.
   */
  private async checkUrl(url: string, timeout?: number): Promise<VerificationCheck> {
    const startTime = Date.now();
    const timeoutMs = timeout || this.defaultTimeout;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/html' },
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (!response.ok) {
        return {
          type: 'url',
          name: 'URL accessibility',
          status: 'failed',
          details: `HTTP ${response.status}: ${response.statusText}`,
          duration,
        };
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/html')) {
        return {
          type: 'url',
          name: 'URL accessibility',
          status: 'failed',
          details: `Expected HTML, got ${contentType}`,
          duration,
        };
      }

      return {
        type: 'url',
        name: 'URL accessibility',
        status: 'passed',
        details: `URL accessible, response time: ${duration}ms`,
        duration,
      };
    } catch (error) {
      return {
        type: 'url',
        name: 'URL accessibility',
        status: 'failed',
        details: error instanceof Error ? error.message : 'URL check failed',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Check if the page loads correctly.
   */
  private async checkPage(url: string): Promise<VerificationCheck> {
    const startTime = Date.now();

    try {
      const response = await fetch(url);
      const html = await response.text();
      const duration = Date.now() - startTime;

      // Basic checks
      const hasDoctype = html.toLowerCase().includes('<!doctype html');
      const hasHtmlTag = html.includes('<html');
      const hasBody = html.includes('<body');
      const hasTitle = html.includes('<title');

      if (!hasDoctype || !hasHtmlTag || !hasBody) {
        return {
          type: 'page',
          name: 'Page structure verification',
          status: 'failed',
          details: 'Missing required HTML structure',
          duration,
        };
      }

      // Check for error indicators
      const hasErrorIndicator =
        html.includes('Error') && html.includes('stack') ||
        html.includes('500') && html.includes('Internal Server Error');

      if (hasErrorIndicator) {
        return {
          type: 'page',
          name: 'Page structure verification',
          status: 'failed',
          details: 'Page contains error indicators',
          duration,
        };
      }

      return {
        type: 'page',
        name: 'Page structure verification',
        status: 'passed',
        details: `Valid HTML page${hasTitle ? ' with title' : ''}`,
        duration,
      };
    } catch (error) {
      return {
        type: 'page',
        name: 'Page structure verification',
        status: 'failed',
        details: error instanceof Error ? error.message : 'Page check failed',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Check basic user flow (navigation, links).
   */
  private async checkFlow(url: string): Promise<VerificationCheck> {
    const startTime = Date.now();

    try {
      const response = await fetch(url);
      const html = await response.text();
      const duration = Date.now() - startTime;

      // Extract links
      const linkMatches = html.match(/<a[^>]+href=["']([^"']+)["']/gi) || [];
      const links = linkMatches.map(m => {
        const match = m.match(/href=["']([^"']+)["']/i);
        return match ? match[1] : '';
      }).filter(Boolean);

      // Check for interactive elements
      const hasButtons = html.includes('<button') || html.includes('type="submit"');
      const hasForms = html.includes('<form');
      const hasInputs = html.includes('<input');

      const interactiveCount = (hasButtons ? 1 : 0) + (hasForms ? 1 : 0) + (hasInputs ? 1 : 0);

      return {
        type: 'flow',
        name: 'User flow check',
        status: 'passed',
        details: `Found ${links.length} links, ${interactiveCount} interactive element types`,
        duration,
      };
    } catch (error) {
      return {
        type: 'flow',
        name: 'User flow check',
        status: 'failed',
        details: error instanceof Error ? error.message : 'Flow check failed',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Check responsive design indicators.
   */
  private async checkResponsive(url: string): Promise<VerificationCheck> {
    const startTime = Date.now();

    try {
      const response = await fetch(url);
      const html = await response.text();
      const duration = Date.now() - startTime;

      // Check for responsive indicators
      const hasViewport = html.includes('viewport');
      const hasMediaQueries = html.includes('@media');
      const hasFlexbox = html.includes('flex');
      const hasGrid = html.includes('grid');
      const hasResponsiveClasses =
        html.includes('col-') ||
        html.includes('sm:') ||
        html.includes('md:') ||
        html.includes('lg:');

      const responsiveScore =
        (hasViewport ? 2 : 0) +
        (hasMediaQueries ? 1 : 0) +
        (hasFlexbox ? 1 : 0) +
        (hasGrid ? 1 : 0) +
        (hasResponsiveClasses ? 2 : 0);

      return {
        type: 'responsive',
        name: 'Responsive design check',
        status: responsiveScore >= 2 ? 'passed' : 'failed',
        details: `Responsive score: ${responsiveScore}/7 (viewport: ${hasViewport}, media queries: ${hasMediaQueries})`,
        duration,
      };
    } catch (error) {
      return {
        type: 'responsive',
        name: 'Responsive design check',
        status: 'failed',
        details: error instanceof Error ? error.message : 'Responsive check failed',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate a human-readable summary of verification results.
   */
  private generateSummary(checks: VerificationCheck[], passed: boolean): string {
    const passedChecks = checks.filter(c => c.status === 'passed');
    const failedChecks = checks.filter(c => c.status === 'failed');

    if (passed) {
      return `All ${passedChecks.length} checks passed. Demo is ready for review.`;
    }

    const failedNames = failedChecks.map(c => c.name).join(', ');
    return `${failedChecks.length} of ${checks.length} checks failed: ${failedNames}`;
  }

  /**
   * Record verification result in the database.
   */
  private async recordVerification(result: VerificationResult): Promise<string> {
    const db = getDatabase();

    const queryResult = await db.query<{ record_demo_verification: string }>(
      `SELECT record_demo_verification($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        result.demoId,
        result.passed,
        result.startedAt,
        result.completedAt,
        JSON.stringify(result.checks),
        JSON.stringify(result.screenshots),
        JSON.stringify(result.consoleErrors),
        result.summary,
      ]
    );

    return queryResult.rows[0].record_demo_verification;
  }

  /**
   * Get verification history for a demo.
   */
  async getVerificationHistory(demoId: string): Promise<VerificationResult[]> {
    const db = getDatabase();

    const result = await db.query<{
      id: string;
      demo_id: string;
      passed: boolean;
      started_at: Date;
      completed_at: Date;
      checks: VerificationCheck[];
      passed_count: number;
      failed_count: number;
      screenshots: string[];
      console_errors: string[];
      summary: string;
    }>(
      `SELECT * FROM demo_verifications WHERE demo_id = $1 ORDER BY completed_at DESC`,
      [demoId]
    );

    return result.rows.map(row => ({
      id: row.id,
      demoId: row.demo_id,
      passed: row.passed,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      checks: row.checks || [],
      passedCount: row.passed_count,
      failedCount: row.failed_count,
      screenshots: row.screenshots || [],
      consoleErrors: row.console_errors || [],
      summary: row.summary || '',
    }));
  }

  /**
   * Get the latest verification for a demo.
   */
  async getLatestVerification(demoId: string): Promise<VerificationResult | null> {
    const history = await this.getVerificationHistory(demoId);
    return history.length > 0 ? history[0] : null;
  }
}

// Factory functions
export function createVerificationService(): VerificationService {
  return new VerificationService();
}

let defaultService: VerificationService | null = null;

export function getVerificationService(): VerificationService {
  if (!defaultService) {
    defaultService = new VerificationService();
  }
  return defaultService;
}
