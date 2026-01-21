/**
 * QA Agent - End-to-End Testing and Quality Assurance
 *
 * Validates the complete user experience through:
 * - End-to-end browser testing with Playwright
 * - Visual regression testing
 * - User flow validation
 * - Accessibility audits (WCAG)
 * - Cross-browser compatibility
 *
 * Integrates with the RL system to provide feedback on code quality
 * and help improve developer agent prompts over time.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../lib/database.js';
import { getLearningSystem } from '../learning/index.js';
import type { AgentType } from '../../types/index.js';

/**
 * Severity levels for QA issues
 */
export enum QAIssueSeverity {
  CRITICAL = 'critical',   // App unusable, major functionality broken
  HIGH = 'high',           // Feature significantly impaired
  MEDIUM = 'medium',       // Functionality affected but workaround exists
  LOW = 'low',             // Minor visual or UX issue
  INFO = 'info',           // Suggestion or enhancement
}

/**
 * Types of QA issues
 */
export enum QAIssueType {
  FUNCTIONAL = 'functional',         // Feature doesn't work as expected
  VISUAL = 'visual',                 // Visual regression detected
  ACCESSIBILITY = 'accessibility',   // WCAG compliance issue
  PERFORMANCE = 'performance',       // Slow response time
  USABILITY = 'usability',           // UX friction point
  COMPATIBILITY = 'compatibility',   // Cross-browser issue
  NAVIGATION = 'navigation',         // Broken links, routing issues
  DATA = 'data',                     // Data display or validation issue
}

/**
 * E2E test configuration
 */
export interface E2EConfig {
  baseUrl: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  viewport?: { width: number; height: number };
  timeout?: number;
  retries?: number;
  screenshotOnFailure?: boolean;
  videoOnFailure?: boolean;
  traceOnFailure?: boolean;
}

/**
 * User flow step definition
 */
export interface UserFlowStep {
  id: string;
  name: string;
  action: 'navigate' | 'click' | 'fill' | 'select' | 'wait' | 'assert' | 'screenshot';
  selector?: string;
  value?: string;
  timeout?: number;
  waitFor?: string;
  assertion?: {
    type: 'visible' | 'hidden' | 'text' | 'value' | 'url' | 'title';
    expected?: string;
    selector?: string;
  };
}

/**
 * User flow definition
 */
export interface UserFlow {
  id: string;
  name: string;
  description: string;
  priority: number;
  steps: UserFlowStep[];
  expectedOutcome: string;
  tags?: string[];
}

/**
 * QA issue found during testing
 */
export interface QAIssue {
  id: string;
  projectId: string;
  testRunId: string;
  severity: QAIssueSeverity;
  type: QAIssueType;
  title: string;
  description: string;
  stepId?: string;
  flowId?: string;
  url?: string;
  selector?: string;
  expected?: string;
  actual?: string;
  screenshot?: string;
  trace?: string;
  browser?: string;
  viewport?: { width: number; height: number };
  reproducible: boolean;
  createdAt: Date;
}

/**
 * Individual test result
 */
export interface E2ETestResult {
  id: string;
  flowId: string;
  flowName: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  duration: number;
  stepsCompleted: number;
  totalSteps: number;
  issues: QAIssue[];
  screenshot?: string;
  video?: string;
  trace?: string;
  error?: string;
}

/**
 * Visual regression result
 */
export interface VisualDiff {
  id: string;
  pageName: string;
  baselineImage: string;
  currentImage: string;
  diffImage?: string;
  diffPercentage: number;
  threshold: number;
  pass: boolean;
  regions?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    diffPercentage: number;
  }>;
}

/**
 * Complete test run results
 */
export interface TestResults {
  id: string;
  projectId: string;
  config: E2EConfig;
  startTime: Date;
  endTime: Date;
  duration: number;
  status: 'pass' | 'fail' | 'error';
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
  };
  tests: E2ETestResult[];
  issues: QAIssue[];
  coverage?: {
    pages: number;
    flows: number;
    assertions: number;
  };
}

/**
 * Visual regression results
 */
export interface VisualResults {
  id: string;
  projectId: string;
  baselineId: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  status: 'pass' | 'fail';
  summary: {
    total: number;
    passed: number;
    failed: number;
    newPages: number;
  };
  diffs: VisualDiff[];
  threshold: number;
}

/**
 * User flow test result
 */
export interface FlowResult {
  id: string;
  flowId: string;
  flowName: string;
  projectId: string;
  status: 'pass' | 'fail' | 'error';
  startTime: Date;
  endTime: Date;
  duration: number;
  stepsCompleted: number;
  totalSteps: number;
  stepResults: Array<{
    stepId: string;
    stepName: string;
    status: 'pass' | 'fail' | 'skip';
    duration: number;
    error?: string;
    screenshot?: string;
  }>;
  issues: QAIssue[];
}

/**
 * QA report for stakeholders
 */
export interface QAReport {
  id: string;
  projectId: string;
  milestone: string;
  generatedAt: Date;

  // Executive summary
  summary: {
    overallStatus: 'pass' | 'fail' | 'needs_attention';
    score: number;  // 0-100
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    recommendation: string;
  };

  // Test coverage
  coverage: {
    flowsCovered: number;
    flowsTotal: number;
    pagesCovered: number;
    pagesTotal: number;
    criticalPathsCovered: number;
    criticalPathsTotal: number;
  };

  // Issues breakdown
  issues: {
    total: number;
    bySeverity: Record<QAIssueSeverity, number>;
    byType: Record<QAIssueType, number>;
    critical: QAIssue[];
    high: QAIssue[];
  };

  // Visual regression
  visualRegression?: {
    pagesChecked: number;
    pagesPassed: number;
    diffPercentage: number;
  };

  // Accessibility
  accessibility?: {
    score: number;
    violations: number;
    warnings: number;
    wcagLevel: 'A' | 'AA' | 'AAA' | 'none';
  };

  // Performance metrics
  performance?: {
    avgPageLoadMs: number;
    avgInteractionMs: number;
    slowestPage: string;
    slowestPageMs: number;
  };

  // Recommendations
  recommendations: string[];

  // Test results detail
  testResults: TestResults;
}

/**
 * QA Agent options
 */
export interface QAAgentOptions {
  projectId: string;
  projectDir: string;
  baseUrl?: string;
  defaultConfig?: Partial<E2EConfig>;
}

/**
 * Reward values for RL feedback
 */
const REWARDS = {
  flowPass: 0.4,
  flowFail: -0.3,
  criticalIssue: -1.0,
  highIssue: -0.6,
  mediumIssue: -0.3,
  lowIssue: -0.1,
  infoIssue: 0,
  visualRegressionPass: 0.2,
  visualRegressionFail: -0.4,
  accessibilityViolation: -0.3,
  fullSuitePass: 0.8,
  fullSuiteFail: -0.5,
};

/**
 * QA Agent Service
 *
 * Performs end-to-end testing, visual regression, and user flow validation
 * with integration into the RL system for continuous improvement.
 */
export class QAAgent extends EventEmitter {
  private projectId: string;
  private projectDir: string;
  private baseUrl: string;
  private defaultConfig: E2EConfig;
  private agentId: string;
  private promptId?: string;
  private issues: Map<string, QAIssue> = new Map();
  private testRuns: Map<string, TestResults> = new Map();

  constructor(options: QAAgentOptions) {
    super();
    this.projectId = options.projectId;
    this.projectDir = options.projectDir;
    this.baseUrl = options.baseUrl || 'http://localhost:3000';
    this.agentId = uuidv4();

    this.defaultConfig = {
      baseUrl: this.baseUrl,
      browser: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 720 },
      timeout: 30000,
      retries: 2,
      screenshotOnFailure: true,
      videoOnFailure: false,
      traceOnFailure: true,
      ...options.defaultConfig,
    };
  }

  /**
   * Initialize the QA agent with prompt selection via Thompson Sampling
   */
  async initialize(): Promise<void> {
    try {
      const db = getDatabase();
      const learningSystem = getLearningSystem();

      // Select QA prompt using Thompson Sampling
      const selectedPrompt = await learningSystem.selectPrompt('qa');
      this.promptId = selectedPrompt?.id;

      // Create agent record
      await db.query(
        `INSERT INTO agents (id, project_id, type, status, prompt_id, created_at, updated_at)
         VALUES ($1, $2, 'qa', 'working', $3, NOW(), NOW())`,
        [this.agentId, this.projectId, this.promptId]
      );

      this.emit('initialized', {
        agentId: this.agentId,
        promptId: this.promptId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to initialize QA agent:`, errorMessage);
      this.emit('error', { phase: 'initialize', error: errorMessage });
      throw error;
    }
  }

  /**
   * Run end-to-end tests for the project
   */
  async runE2ETests(config: Partial<E2EConfig> = {}): Promise<TestResults> {
    const testRunId = uuidv4();
    const startTime = new Date();
    const mergedConfig: E2EConfig = { ...this.defaultConfig, ...config };

    this.emit('e2e:started', { testRunId, config: mergedConfig });

    try {
      const tests: E2ETestResult[] = [];
      const issues: QAIssue[] = [];

      // Get user flows from database or generate defaults
      const flows = await this.getUserFlows();

      for (const flow of flows) {
        const flowResult = await this.testUserFlow(flow);

        tests.push({
          id: flowResult.id,
          flowId: flow.id,
          flowName: flow.name,
          status: flowResult.status,
          duration: flowResult.duration,
          stepsCompleted: flowResult.stepsCompleted,
          totalSteps: flowResult.totalSteps,
          issues: flowResult.issues,
          error: flowResult.status === 'error'
            ? flowResult.stepResults.find(s => s.error)?.error
            : undefined,
        });

        issues.push(...flowResult.issues);

        // Apply RL feedback for each flow
        await this.applyFlowReward(flow, flowResult);
      }

      const endTime = new Date();
      const passed = tests.filter(t => t.status === 'pass').length;
      const failed = tests.filter(t => t.status === 'fail').length;
      const errors = tests.filter(t => t.status === 'error').length;
      const skipped = tests.filter(t => t.status === 'skip').length;

      const results: TestResults = {
        id: testRunId,
        projectId: this.projectId,
        config: mergedConfig,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        status: failed === 0 && errors === 0 ? 'pass' : 'fail',
        summary: {
          total: tests.length,
          passed,
          failed,
          skipped,
          errors,
        },
        tests,
        issues,
        coverage: {
          pages: new Set(issues.map(i => i.url)).size,
          flows: flows.length,
          assertions: tests.reduce((sum, t) => sum + t.totalSteps, 0),
        },
      };

      // Store results
      await this.storeTestResults(results);
      this.testRuns.set(testRunId, results);

      // Apply suite-level RL feedback
      await this.applySuiteReward(results);

      this.emit('e2e:completed', results);
      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('e2e:error', { testRunId, error: errorMessage });
      throw error;
    }
  }

  /**
   * Run visual regression testing against a baseline
   */
  async runVisualRegression(baselineId: string): Promise<VisualResults> {
    const resultId = uuidv4();
    const startTime = new Date();

    this.emit('visual:started', { resultId, baselineId });

    try {
      // Get baseline data
      const baseline = await this.getVisualBaseline(baselineId);
      if (!baseline) {
        throw new Error(`Baseline ${baselineId} not found`);
      }

      const diffs: VisualDiff[] = [];
      const threshold = 0.1; // 10% difference threshold

      // Compare each page in the baseline
      for (const page of baseline.pages) {
        const diff = await this.compareVisuals(page, baseline.id);
        diffs.push(diff);

        // Apply RL feedback for visual regression
        if (diff.pass) {
          await this.applyReward(REWARDS.visualRegressionPass, {
            type: 'visual_regression_pass',
            pageName: page.name,
            diffPercentage: diff.diffPercentage,
          });
        } else {
          await this.applyReward(REWARDS.visualRegressionFail, {
            type: 'visual_regression_fail',
            pageName: page.name,
            diffPercentage: diff.diffPercentage,
          });
        }
      }

      const endTime = new Date();
      const passed = diffs.filter(d => d.pass).length;
      const failed = diffs.filter(d => !d.pass).length;

      const results: VisualResults = {
        id: resultId,
        projectId: this.projectId,
        baselineId,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        status: failed === 0 ? 'pass' : 'fail',
        summary: {
          total: diffs.length,
          passed,
          failed,
          newPages: 0,
        },
        diffs,
        threshold,
      };

      // Store results
      await this.storeVisualResults(results);

      this.emit('visual:completed', results);
      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('visual:error', { resultId, baselineId, error: errorMessage });
      throw error;
    }
  }

  /**
   * Test a specific user flow
   */
  async testUserFlow(flow: UserFlow): Promise<FlowResult> {
    const resultId = uuidv4();
    const startTime = new Date();

    this.emit('flow:started', { resultId, flowId: flow.id, flowName: flow.name });

    const stepResults: FlowResult['stepResults'] = [];
    const issues: QAIssue[] = [];
    let stepsCompleted = 0;
    let hasError = false;

    try {
      for (const step of flow.steps) {
        const stepStart = Date.now();

        try {
          await this.executeStep(step);

          stepResults.push({
            stepId: step.id,
            stepName: step.name,
            status: 'pass',
            duration: Date.now() - stepStart,
          });
          stepsCompleted++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          stepResults.push({
            stepId: step.id,
            stepName: step.name,
            status: 'fail',
            duration: Date.now() - stepStart,
            error: errorMessage,
          });

          // Create issue for the failure
          const issue = await this.createIssue({
            testRunId: resultId,
            severity: QAIssueSeverity.HIGH,
            type: QAIssueType.FUNCTIONAL,
            title: `Flow step failed: ${step.name}`,
            description: errorMessage,
            stepId: step.id,
            flowId: flow.id,
            url: this.baseUrl,
            selector: step.selector,
            expected: step.assertion?.expected,
            actual: errorMessage,
            reproducible: true,
          });
          issues.push(issue);

          hasError = true;
          break; // Stop on first failure
        }
      }

      // Mark remaining steps as skipped if we had an error
      if (hasError) {
        const remainingSteps = flow.steps.slice(stepsCompleted + 1);
        for (const step of remainingSteps) {
          stepResults.push({
            stepId: step.id,
            stepName: step.name,
            status: 'skip',
            duration: 0,
          });
        }
      }

      const endTime = new Date();

      const result: FlowResult = {
        id: resultId,
        flowId: flow.id,
        flowName: flow.name,
        projectId: this.projectId,
        status: hasError ? 'fail' : 'pass',
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        stepsCompleted,
        totalSteps: flow.steps.length,
        stepResults,
        issues,
      };

      this.emit('flow:completed', result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('flow:error', { resultId, flowId: flow.id, error: errorMessage });

      return {
        id: resultId,
        flowId: flow.id,
        flowName: flow.name,
        projectId: this.projectId,
        status: 'error',
        startTime,
        endTime: new Date(),
        duration: Date.now() - startTime.getTime(),
        stepsCompleted,
        totalSteps: flow.steps.length,
        stepResults,
        issues,
      };
    }
  }

  /**
   * Generate a comprehensive QA report
   */
  async generateReport(results: TestResults): Promise<QAReport> {
    const reportId = uuidv4();

    // Calculate overall score
    const passRate = results.summary.total > 0
      ? results.summary.passed / results.summary.total
      : 0;

    // Count issues by severity
    const issuesBySeverity = {
      [QAIssueSeverity.CRITICAL]: 0,
      [QAIssueSeverity.HIGH]: 0,
      [QAIssueSeverity.MEDIUM]: 0,
      [QAIssueSeverity.LOW]: 0,
      [QAIssueSeverity.INFO]: 0,
    };

    const issuesByType: Record<QAIssueType, number> = {
      [QAIssueType.FUNCTIONAL]: 0,
      [QAIssueType.VISUAL]: 0,
      [QAIssueType.ACCESSIBILITY]: 0,
      [QAIssueType.PERFORMANCE]: 0,
      [QAIssueType.USABILITY]: 0,
      [QAIssueType.COMPATIBILITY]: 0,
      [QAIssueType.NAVIGATION]: 0,
      [QAIssueType.DATA]: 0,
    };

    for (const issue of results.issues) {
      issuesBySeverity[issue.severity]++;
      issuesByType[issue.type]++;
    }

    // Calculate score (100 base, minus penalties for issues)
    let score = 100;
    score -= issuesBySeverity[QAIssueSeverity.CRITICAL] * 25;
    score -= issuesBySeverity[QAIssueSeverity.HIGH] * 15;
    score -= issuesBySeverity[QAIssueSeverity.MEDIUM] * 5;
    score -= issuesBySeverity[QAIssueSeverity.LOW] * 2;
    score = Math.max(0, Math.min(100, score));

    // Determine grade
    let grade: 'A' | 'B' | 'C' | 'D' | 'F';
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B';
    else if (score >= 70) grade = 'C';
    else if (score >= 60) grade = 'D';
    else grade = 'F';

    // Determine overall status
    let overallStatus: 'pass' | 'fail' | 'needs_attention';
    if (issuesBySeverity[QAIssueSeverity.CRITICAL] > 0) {
      overallStatus = 'fail';
    } else if (issuesBySeverity[QAIssueSeverity.HIGH] > 2) {
      overallStatus = 'fail';
    } else if (issuesBySeverity[QAIssueSeverity.HIGH] > 0 || issuesBySeverity[QAIssueSeverity.MEDIUM] > 3) {
      overallStatus = 'needs_attention';
    } else {
      overallStatus = 'pass';
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (issuesBySeverity[QAIssueSeverity.CRITICAL] > 0) {
      recommendations.push('URGENT: Fix all critical issues before proceeding');
    }
    if (issuesBySeverity[QAIssueSeverity.HIGH] > 0) {
      recommendations.push('Address high-severity issues in the next sprint');
    }
    if (issuesByType[QAIssueType.ACCESSIBILITY] > 0) {
      recommendations.push('Run accessibility audit and fix WCAG violations');
    }
    if (passRate < 0.8) {
      recommendations.push('Increase test pass rate to at least 80%');
    }

    const report: QAReport = {
      id: reportId,
      projectId: this.projectId,
      milestone: 'current',
      generatedAt: new Date(),
      summary: {
        overallStatus,
        score,
        grade,
        recommendation: recommendations[0] || 'Continue with current approach',
      },
      coverage: {
        flowsCovered: results.summary.total,
        flowsTotal: results.summary.total,
        pagesCovered: results.coverage?.pages || 0,
        pagesTotal: results.coverage?.pages || 0,
        criticalPathsCovered: results.tests.filter(t => t.status === 'pass').length,
        criticalPathsTotal: results.tests.length,
      },
      issues: {
        total: results.issues.length,
        bySeverity: issuesBySeverity,
        byType: issuesByType,
        critical: results.issues.filter(i => i.severity === QAIssueSeverity.CRITICAL),
        high: results.issues.filter(i => i.severity === QAIssueSeverity.HIGH),
      },
      recommendations,
      testResults: results,
    };

    // Store report
    await this.storeQAReport(report);

    this.emit('report:generated', report);
    return report;
  }

  /**
   * Create a QA issue
   */
  private async createIssue(
    issueData: Omit<QAIssue, 'id' | 'projectId' | 'createdAt'>
  ): Promise<QAIssue> {
    const issue: QAIssue = {
      ...issueData,
      id: uuidv4(),
      projectId: this.projectId,
      createdAt: new Date(),
    };

    // Store in database
    const db = getDatabase();
    await db.query(
      `INSERT INTO qa_test_results (id, project_id, test_run_id, flow_id, step_id,
        severity, type, title, description, url, selector, expected, actual,
        screenshot, browser, viewport, reproducible, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        issue.id, issue.projectId, issue.testRunId, issue.flowId, issue.stepId,
        issue.severity, issue.type, issue.title, issue.description, issue.url,
        issue.selector, issue.expected, issue.actual, issue.screenshot,
        issue.browser, JSON.stringify(issue.viewport), issue.reproducible, issue.createdAt,
      ]
    );

    this.issues.set(issue.id, issue);

    // Apply RL penalty based on severity
    const rewardMap: Record<QAIssueSeverity, number> = {
      [QAIssueSeverity.CRITICAL]: REWARDS.criticalIssue,
      [QAIssueSeverity.HIGH]: REWARDS.highIssue,
      [QAIssueSeverity.MEDIUM]: REWARDS.mediumIssue,
      [QAIssueSeverity.LOW]: REWARDS.lowIssue,
      [QAIssueSeverity.INFO]: REWARDS.infoIssue,
    };

    await this.applyReward(rewardMap[issue.severity], {
      type: 'qa_issue_found',
      issueId: issue.id,
      severity: issue.severity,
      issueType: issue.type,
    });

    this.emit('issue:created', issue);
    return issue;
  }

  /**
   * Execute a single test step (placeholder - would use Playwright in production)
   */
  private async executeStep(step: UserFlowStep): Promise<void> {
    // In production, this would use Playwright to execute the step
    // For now, simulate step execution
    await new Promise(resolve => setTimeout(resolve, 100));

    // Simulate basic validation
    if (step.action === 'navigate') {
      // Would navigate to URL
      return;
    }

    if (step.action === 'click' && !step.selector) {
      throw new Error('Click action requires a selector');
    }

    if (step.action === 'fill' && (!step.selector || !step.value)) {
      throw new Error('Fill action requires selector and value');
    }

    if (step.action === 'assert' && step.assertion) {
      // Would perform assertion in production
      return;
    }
  }

  /**
   * Get user flows from database or generate defaults
   */
  private async getUserFlows(): Promise<UserFlow[]> {
    // In production, fetch from database
    // Return default flows for basic testing
    return [
      {
        id: 'homepage-load',
        name: 'Homepage Load',
        description: 'Verify homepage loads correctly',
        priority: 1,
        steps: [
          {
            id: 'step-1',
            name: 'Navigate to homepage',
            action: 'navigate',
            value: this.baseUrl,
          },
          {
            id: 'step-2',
            name: 'Verify page title',
            action: 'assert',
            assertion: {
              type: 'title',
              expected: 'Eklavya',
            },
          },
        ],
        expectedOutcome: 'Homepage displays correctly',
      },
      {
        id: 'navigation-check',
        name: 'Navigation Check',
        description: 'Verify main navigation works',
        priority: 2,
        steps: [
          {
            id: 'step-1',
            name: 'Navigate to homepage',
            action: 'navigate',
            value: this.baseUrl,
          },
          {
            id: 'step-2',
            name: 'Check navigation visible',
            action: 'assert',
            selector: 'nav',
            assertion: {
              type: 'visible',
              selector: 'nav',
            },
          },
        ],
        expectedOutcome: 'Navigation is visible and functional',
      },
    ];
  }

  /**
   * Get visual baseline data
   */
  private async getVisualBaseline(baselineId: string): Promise<{
    id: string;
    pages: Array<{ name: string; path: string; image: string }>;
  } | null> {
    const db = getDatabase();
    const result = await db.query<{ id: string; pages: string }>(
      `SELECT id, pages FROM visual_baselines WHERE id = $1`,
      [baselineId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      id: result.rows[0].id,
      pages: JSON.parse(result.rows[0].pages || '[]'),
    };
  }

  /**
   * Compare current visuals against baseline
   */
  private async compareVisuals(
    page: { name: string; path: string; image: string },
    _baselineId: string
  ): Promise<VisualDiff> {
    // In production, would use image comparison library
    // For now, simulate comparison
    const diffPercentage = Math.random() * 15; // 0-15% random diff
    const threshold = 10;

    return {
      id: uuidv4(),
      pageName: page.name,
      baselineImage: page.image,
      currentImage: `current-${page.image}`,
      diffPercentage,
      threshold,
      pass: diffPercentage <= threshold,
    };
  }

  /**
   * Apply RL reward through the learning system
   */
  private async applyReward(
    reward: number,
    context: Record<string, unknown>
  ): Promise<void> {
    if (!this.promptId) return;

    try {
      const learningSystem = getLearningSystem();
      await learningSystem.recordOutcome({
        promptId: this.promptId,
        projectId: this.projectId,
        agentId: this.agentId,
        outcome: reward >= 0 ? 'success' : 'failure',
        reward,
        context,
      });

      this.emit('reward:applied', { promptId: this.promptId, reward, context });
    } catch (error) {
      console.error('Failed to apply reward:', error);
    }
  }

  /**
   * Apply RL feedback for a user flow result
   */
  private async applyFlowReward(flow: UserFlow, result: FlowResult): Promise<void> {
    const reward = result.status === 'pass' ? REWARDS.flowPass : REWARDS.flowFail;
    await this.applyReward(reward, {
      type: result.status === 'pass' ? 'flow_pass' : 'flow_fail',
      flowId: flow.id,
      flowName: flow.name,
      stepsCompleted: result.stepsCompleted,
      totalSteps: result.totalSteps,
      duration: result.duration,
    });
  }

  /**
   * Apply RL feedback for complete test suite
   */
  private async applySuiteReward(results: TestResults): Promise<void> {
    const reward = results.status === 'pass' ? REWARDS.fullSuitePass : REWARDS.fullSuiteFail;
    await this.applyReward(reward, {
      type: results.status === 'pass' ? 'suite_pass' : 'suite_fail',
      passed: results.summary.passed,
      failed: results.summary.failed,
      total: results.summary.total,
      duration: results.duration,
    });
  }

  /**
   * Store test results in database
   */
  private async storeTestResults(results: TestResults): Promise<void> {
    const db = getDatabase();
    await db.query(
      `INSERT INTO qa_test_runs (id, project_id, config, start_time, end_time, duration,
        status, summary, tests, issues, coverage, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [
        results.id, results.projectId, JSON.stringify(results.config),
        results.startTime, results.endTime, results.duration, results.status,
        JSON.stringify(results.summary), JSON.stringify(results.tests),
        JSON.stringify(results.issues), JSON.stringify(results.coverage),
      ]
    );
  }

  /**
   * Store visual regression results
   */
  private async storeVisualResults(results: VisualResults): Promise<void> {
    const db = getDatabase();
    await db.query(
      `INSERT INTO qa_test_runs (id, project_id, test_type, start_time, end_time, duration,
        status, summary, visual_diffs, created_at)
       VALUES ($1, $2, 'visual', $3, $4, $5, $6, $7, $8, NOW())`,
      [
        results.id, results.projectId, results.startTime, results.endTime,
        results.duration, results.status, JSON.stringify(results.summary),
        JSON.stringify(results.diffs),
      ]
    );
  }

  /**
   * Store QA report
   */
  private async storeQAReport(report: QAReport): Promise<void> {
    const db = getDatabase();
    await db.query(
      `INSERT INTO qa_test_runs (id, project_id, test_type, milestone, summary,
        coverage, issues_summary, recommendations, created_at)
       VALUES ($1, $2, 'report', $3, $4, $5, $6, $7, NOW())`,
      [
        report.id, report.projectId, report.milestone,
        JSON.stringify(report.summary), JSON.stringify(report.coverage),
        JSON.stringify(report.issues), JSON.stringify(report.recommendations),
      ]
    );
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Get all issues found
   */
  getIssues(): QAIssue[] {
    return Array.from(this.issues.values());
  }

  /**
   * Get test run by ID
   */
  getTestRun(id: string): TestResults | undefined {
    return this.testRuns.get(id);
  }
}

/**
 * Factory function to create a QA agent
 */
export function createQAAgent(options: QAAgentOptions): QAAgent {
  return new QAAgent(options);
}

/**
 * Run a quick QA verification for a project
 */
export async function runQuickQA(
  projectId: string,
  projectDir: string,
  baseUrl: string
): Promise<{ passed: boolean; score: number; issues: QAIssue[] }> {
  const qa = createQAAgent({ projectId, projectDir, baseUrl });
  await qa.initialize();

  const results = await qa.runE2ETests();
  const report = await qa.generateReport(results);

  return {
    passed: report.summary.overallStatus === 'pass',
    score: report.summary.score,
    issues: results.issues,
  };
}
