/**
 * Senior Software Architect Agent
 *
 * Quality gate agent that runs at the end of each milestone to:
 * - Validate requirements alignment
 * - Review code quality against senior architect standards
 * - Verify comprehensive test coverage
 * - Apply RL rewards/penalties based on quality metrics
 * - Ensure foundation is rock solid before next phase
 *
 * This agent is MANDATORY for:
 * - Each Eklavya demo milestone (Demo₀, Demo₁, Demo₂, etc.)
 * - All products Eklavya builds for clients
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../lib/database.js';
import { getLearningSystem } from '../learning/index.js';
import { QualityAnalyzer, type QualityReport } from './quality-analyzer.js';
import { RequirementsMapper, type RequirementsReport } from './requirements-mapper.js';
import { TestCoverageAnalyzer, type CoverageReport } from './test-coverage-analyzer.js';
import type { AgentType } from '../../types/index.js';

// Helper functions to extract metrics from reports
function getCriticalIssueCount(report: QualityReport): number {
  return report.issues.filter(i => i.severity === 'critical').length;
}

function getHighIssueCount(report: QualityReport): number {
  return report.issues.filter(i => i.severity === 'high').length;
}

function getSecurityIssueCount(report: QualityReport): number {
  return report.issues.filter(i => i.category === 'security').length;
}

function getLineCoverage(report: CoverageReport): number {
  return report.coverageMetrics?.lines ?? report.testCoverage;
}

function getUncoveredFiles(report: CoverageReport): string[] {
  return report.uncoveredModules.map(m => m.path);
}

function getMissingRequirements(report: RequirementsReport): string[] {
  return report.criticalMissing.map(r => r.description);
}

export interface ArchitectReviewConfig {
  projectId: string;
  projectDir: string;
  milestone: string;
  requirementsSource: string;  // Path to requirements doc
  strictMode?: boolean;        // Fail on any critical issue
}

export interface ArchitectSuccessCriteria {
  requirementsCoverage: number;      // Minimum 90%
  codeQualityScore: number;          // Minimum 80/100
  testCoverage: number;              // Minimum 70%
  criticalIssues: number;            // Maximum 0
  highIssues: number;                // Maximum 3
  securityVulnerabilities: number;   // Maximum 0
  typeScriptStrict: boolean;         // Must be true
  errorHandlingCoverage: number;     // Minimum 90%
  apiDocumentation: number;          // Minimum 80%
}

export interface ArchitectReviewResult {
  id: string;
  projectId: string;
  milestone: string;
  timestamp: Date;
  duration: number;

  // Success criteria results
  criteria: {
    requirementsCoverage: { value: number; threshold: number; pass: boolean };
    codeQualityScore: { value: number; threshold: number; pass: boolean };
    testCoverage: { value: number; threshold: number; pass: boolean };
    criticalIssues: { value: number; threshold: number; pass: boolean };
    highIssues: { value: number; threshold: number; pass: boolean };
    securityVulnerabilities: { value: number; threshold: number; pass: boolean };
    typeScriptStrict: { value: boolean; threshold: boolean; pass: boolean };
    errorHandlingCoverage: { value: number; threshold: number; pass: boolean };
    apiDocumentation: { value: number; threshold: number; pass: boolean };
  };

  // Detailed reports
  qualityReport: QualityReport;
  requirementsReport: RequirementsReport;
  coverageReport: CoverageReport;

  // Overall verdict
  overallPass: boolean;
  score: number;  // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';

  // Issues to fix
  criticalFixes: string[];
  recommendedFixes: string[];

  // RL feedback applied
  rewardsApplied: Array<{
    agentType: AgentType;
    promptId: string;
    reward: number;
    reason: string;
  }>;
}

export interface AgentContribution {
  agentId: string;
  agentType: AgentType;
  promptId: string;
  filesModified: string[];
  linesAdded: number;
  linesRemoved: number;
  tasksCompleted: number;
  bugsIntroduced: number;
  testsWritten: number;
}

/**
 * Default success criteria - can be adjusted per project
 */
export const DEFAULT_SUCCESS_CRITERIA: ArchitectSuccessCriteria = {
  requirementsCoverage: 90,
  codeQualityScore: 80,
  testCoverage: 70,
  criticalIssues: 0,
  highIssues: 3,
  securityVulnerabilities: 0,
  typeScriptStrict: true,
  errorHandlingCoverage: 90,
  apiDocumentation: 80,
};

/**
 * Senior Software Architect Agent
 */
export class ArchitectAgent extends EventEmitter {
  private config: ArchitectReviewConfig;
  private criteria: ArchitectSuccessCriteria;
  private agentId: string;
  private promptId?: string;
  private startTime: number = 0;

  private qualityAnalyzer: QualityAnalyzer;
  private requirementsMapper: RequirementsMapper;
  private coverageAnalyzer: TestCoverageAnalyzer;

  constructor(
    config: ArchitectReviewConfig,
    criteria: ArchitectSuccessCriteria = DEFAULT_SUCCESS_CRITERIA
  ) {
    super();
    this.config = config;
    this.criteria = criteria;
    this.agentId = uuidv4();

    this.qualityAnalyzer = new QualityAnalyzer(config.projectDir);
    this.requirementsMapper = new RequirementsMapper(config.projectDir);
    this.coverageAnalyzer = new TestCoverageAnalyzer(config.projectDir);
  }

  /**
   * Initialize the architect agent and select prompt via Thompson Sampling
   */
  async initialize(): Promise<void> {
    const db = getDatabase();
    const learningSystem = getLearningSystem();

    // Select architect prompt using Thompson Sampling
    const selectedPrompt = await learningSystem.selectPrompt('architect');
    this.promptId = selectedPrompt?.id;

    // Create architect agent record
    await db.query(
      `INSERT INTO agents (id, project_id, type, status, prompt_id, created_at, updated_at)
       VALUES ($1, $2, 'architect', 'working', $3, NOW(), NOW())`,
      [this.agentId, this.config.projectId, this.promptId]
    );

    this.startTime = Date.now();

    this.emit('initialized', {
      agentId: this.agentId,
      promptId: this.promptId,
      milestone: this.config.milestone,
    });
  }

  /**
   * Run comprehensive architecture review
   */
  async runReview(): Promise<ArchitectReviewResult> {
    this.emit('review:started', { milestone: this.config.milestone });

    console.log('\n' + '═'.repeat(70));
    console.log('  SENIOR ARCHITECT REVIEW');
    console.log('  Milestone: ' + this.config.milestone);
    console.log('═'.repeat(70));

    // Phase 1: Requirements Analysis
    console.log('\n📋 Phase 1: Requirements Analysis...');
    this.emit('phase:started', { phase: 'requirements' });
    const requirementsReport = await this.requirementsMapper.analyze();
    this.emit('phase:completed', { phase: 'requirements', report: requirementsReport });

    // Phase 2: Code Quality Analysis
    console.log('\n🔍 Phase 2: Code Quality Analysis...');
    this.emit('phase:started', { phase: 'quality' });
    const qualityReport = await this.qualityAnalyzer.analyze();
    this.emit('phase:completed', { phase: 'quality', report: qualityReport });

    // Phase 3: Test Coverage Analysis
    console.log('\n🧪 Phase 3: Test Coverage Analysis...');
    this.emit('phase:started', { phase: 'coverage' });
    const coverageReport = await this.coverageAnalyzer.analyze();
    this.emit('phase:completed', { phase: 'coverage', report: coverageReport });

    // Phase 4: Evaluate against success criteria
    console.log('\n📊 Phase 4: Evaluating Success Criteria...');
    const criteriaResults = this.evaluateCriteria(
      requirementsReport,
      qualityReport,
      coverageReport
    );

    // Phase 5: Calculate overall score and grade
    const { score, grade, overallPass } = this.calculateOverallScore(criteriaResults);

    // Phase 6: Generate fix recommendations
    const { criticalFixes, recommendedFixes } = this.generateFixes(
      requirementsReport,
      qualityReport,
      coverageReport
    );

    // Phase 7: Apply RL rewards/penalties
    console.log('\n🎯 Phase 5: Applying RL Feedback...');
    const rewardsApplied = await this.applyRLFeedback(
      qualityReport,
      requirementsReport,
      coverageReport,
      score
    );

    const duration = Date.now() - this.startTime;

    const result: ArchitectReviewResult = {
      id: uuidv4(),
      projectId: this.config.projectId,
      milestone: this.config.milestone,
      timestamp: new Date(),
      duration,
      criteria: criteriaResults,
      qualityReport,
      requirementsReport,
      coverageReport,
      overallPass,
      score,
      grade,
      criticalFixes,
      recommendedFixes,
      rewardsApplied,
    };

    // Record architect outcome
    await this.recordOutcome(result);

    // Print summary
    this.printSummary(result);

    this.emit('review:completed', result);

    return result;
  }

  /**
   * Evaluate all success criteria
   */
  private evaluateCriteria(
    requirements: RequirementsReport,
    quality: QualityReport,
    coverage: CoverageReport
  ): ArchitectReviewResult['criteria'] {
    const criticalIssues = getCriticalIssueCount(quality);
    const highIssues = getHighIssueCount(quality);
    const securityIssues = getSecurityIssueCount(quality);
    const lineCoverage = getLineCoverage(coverage);

    // API documentation approximation based on quality metrics
    const apiDocumentation = Math.min(quality.metrics.maintainabilityIndex, 100);

    return {
      requirementsCoverage: {
        value: requirements.overallCoverage,
        threshold: this.criteria.requirementsCoverage,
        pass: requirements.overallCoverage >= this.criteria.requirementsCoverage,
      },
      codeQualityScore: {
        value: quality.overallScore,
        threshold: this.criteria.codeQualityScore,
        pass: quality.overallScore >= this.criteria.codeQualityScore,
      },
      testCoverage: {
        value: lineCoverage,
        threshold: this.criteria.testCoverage,
        pass: lineCoverage >= this.criteria.testCoverage,
      },
      criticalIssues: {
        value: criticalIssues,
        threshold: this.criteria.criticalIssues,
        pass: criticalIssues <= this.criteria.criticalIssues,
      },
      highIssues: {
        value: highIssues,
        threshold: this.criteria.highIssues,
        pass: highIssues <= this.criteria.highIssues,
      },
      securityVulnerabilities: {
        value: securityIssues,
        threshold: this.criteria.securityVulnerabilities,
        pass: securityIssues <= this.criteria.securityVulnerabilities,
      },
      typeScriptStrict: {
        value: quality.metrics.typeScriptStrict,
        threshold: this.criteria.typeScriptStrict,
        pass: quality.metrics.typeScriptStrict === this.criteria.typeScriptStrict,
      },
      errorHandlingCoverage: {
        value: quality.metrics.errorHandlingCoverage,
        threshold: this.criteria.errorHandlingCoverage,
        pass: quality.metrics.errorHandlingCoverage >= this.criteria.errorHandlingCoverage,
      },
      apiDocumentation: {
        value: apiDocumentation,
        threshold: this.criteria.apiDocumentation,
        pass: apiDocumentation >= this.criteria.apiDocumentation,
      },
    };
  }

  /**
   * Calculate overall score and grade
   */
  private calculateOverallScore(criteria: ArchitectReviewResult['criteria']): {
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    overallPass: boolean;
  } {
    const weights = {
      requirementsCoverage: 0.20,
      codeQualityScore: 0.20,
      testCoverage: 0.15,
      criticalIssues: 0.15,
      highIssues: 0.05,
      securityVulnerabilities: 0.10,
      typeScriptStrict: 0.05,
      errorHandlingCoverage: 0.05,
      apiDocumentation: 0.05,
    };

    let score = 0;

    // Requirements coverage (0-20 points)
    score += (criteria.requirementsCoverage.value / 100) * weights.requirementsCoverage * 100;

    // Code quality (0-20 points)
    score += (criteria.codeQualityScore.value / 100) * weights.codeQualityScore * 100;

    // Test coverage (0-15 points)
    score += (criteria.testCoverage.value / 100) * weights.testCoverage * 100;

    // Critical issues (15 points if 0, -5 per issue)
    const criticalPenalty = Math.min(criteria.criticalIssues.value * 5, 15);
    score += (15 - criticalPenalty);

    // High issues (5 points if ≤ threshold)
    score += criteria.highIssues.pass ? 5 : Math.max(0, 5 - criteria.highIssues.value);

    // Security (10 points if 0)
    score += criteria.securityVulnerabilities.pass ? 10 : 0;

    // TypeScript strict (5 points)
    score += criteria.typeScriptStrict.pass ? 5 : 0;

    // Error handling (5 points)
    score += (criteria.errorHandlingCoverage.value / 100) * 5;

    // API docs (5 points)
    score += (criteria.apiDocumentation.value / 100) * 5;

    score = Math.round(Math.max(0, Math.min(100, score)));

    let grade: 'A' | 'B' | 'C' | 'D' | 'F';
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B';
    else if (score >= 70) grade = 'C';
    else if (score >= 60) grade = 'D';
    else grade = 'F';

    // Must pass all critical criteria
    const overallPass = criteria.criticalIssues.pass &&
      criteria.securityVulnerabilities.pass &&
      score >= 70;

    return { score, grade, overallPass };
  }

  /**
   * Generate fix recommendations
   */
  private generateFixes(
    requirements: RequirementsReport,
    quality: QualityReport,
    coverage: CoverageReport
  ): { criticalFixes: string[]; recommendedFixes: string[] } {
    const criticalFixes: string[] = [];
    const recommendedFixes: string[] = [];

    // Critical: Security issues
    for (const issue of quality.issues.filter(i => i.severity === 'critical' || i.category === 'security')) {
      const lineInfo = issue.line ? `:${issue.line}` : '';
      criticalFixes.push(`[CRITICAL] ${issue.file}${lineInfo} - ${issue.message}`);
    }

    // Critical: Missing requirements
    const missingReqs = getMissingRequirements(requirements);
    for (const req of missingReqs) {
      criticalFixes.push(`[CRITICAL] Missing requirement: ${req}`);
    }

    // High: Quality issues
    for (const issue of quality.issues.filter(i => i.severity === 'high')) {
      const lineInfo = issue.line ? `:${issue.line}` : '';
      recommendedFixes.push(`[HIGH] ${issue.file}${lineInfo} - ${issue.message}`);
    }

    // Medium: Test coverage gaps
    const uncoveredFiles = getUncoveredFiles(coverage);
    for (const file of uncoveredFiles.slice(0, 10)) {
      recommendedFixes.push(`[MEDIUM] Add tests for: ${file}`);
    }

    // Low: Quality recommendations
    for (const rec of quality.recommendations.slice(0, 5)) {
      recommendedFixes.push(`[LOW] ${rec}`);
    }

    return { criticalFixes, recommendedFixes };
  }

  /**
   * Apply RL rewards/penalties based on review results
   */
  private async applyRLFeedback(
    quality: QualityReport,
    requirements: RequirementsReport,
    coverage: CoverageReport,
    overallScore: number
  ): Promise<ArchitectReviewResult['rewardsApplied']> {
    const learningSystem = getLearningSystem();
    const db = getDatabase();
    const rewardsApplied: ArchitectReviewResult['rewardsApplied'] = [];

    const criticalIssueCount = getCriticalIssueCount(quality);
    const lineCoverage = getLineCoverage(coverage);

    // Get all agents that contributed to this milestone
    const agentsResult = await db.query<{
      id: string;
      type: AgentType;
      prompt_id: string;
      tasks_completed: number;
      tasks_failed: number;
    }>(
      `SELECT a.id, a.type, a.prompt_id, a.tasks_completed, a.tasks_failed
       FROM agents a
       WHERE a.project_id = $1 AND a.prompt_id IS NOT NULL`,
      [this.config.projectId]
    );

    // Calculate rewards for each agent type based on their contribution
    const _agentTypeScores = new Map<AgentType, { total: number; count: number }>();

    for (const agent of agentsResult.rows) {
      const agentType = agent.type;
      let reward = 0;
      let reason = '';

      // Base reward from overall score
      const baseReward = (overallScore - 70) / 100;  // -0.3 to +0.3

      switch (agentType) {
        case 'developer':
          // Developers are rewarded/penalized based on code quality
          const qualityBonus = (quality.overallScore - 70) / 100;  // -0.3 to +0.3
          const bugPenalty = -0.1 * criticalIssueCount;
          reward = baseReward + qualityBonus + bugPenalty;
          reason = `Quality: ${quality.overallScore}%, Critical issues: ${criticalIssueCount}`;
          break;

        case 'tester':
          // Testers are rewarded based on test coverage
          const coverageBonus = (lineCoverage - 50) / 100;  // -0.2 to +0.5
          reward = baseReward + coverageBonus;
          reason = `Test coverage: ${lineCoverage}%`;
          break;

        case 'architect':
          // Architects are rewarded based on requirements coverage
          const reqBonus = (requirements.overallCoverage - 70) / 100;
          reward = baseReward + reqBonus;
          reason = `Requirements coverage: ${requirements.overallCoverage}%`;
          break;

        case 'qa':
          // QA is rewarded based on bug detection
          reward = baseReward + (criticalIssueCount > 0 ? 0.1 : 0);  // Bonus for finding issues
          reason = `Overall score: ${overallScore}%`;
          break;

        default:
          reward = baseReward;
          reason = `Overall score: ${overallScore}%`;
      }

      // Clamp reward
      reward = Math.max(-1, Math.min(1, reward));

      // Apply reward if we have a prompt ID
      if (agent.prompt_id) {
        await learningSystem.recordOutcome({
          promptId: agent.prompt_id,
          projectId: this.config.projectId,
          agentId: agent.id,
          outcome: reward >= 0 ? 'success' : 'failure',
          reward,
          context: {
            type: 'architect_review',
            milestone: this.config.milestone,
            overallScore,
            agentType,
            reason,
          },
        });

        rewardsApplied.push({
          agentType,
          promptId: agent.prompt_id,
          reward,
          reason,
        });

        const color = reward >= 0 ? '\x1b[32m' : '\x1b[31m';
        console.log(`  ${color}${reward >= 0 ? '+' : ''}${reward.toFixed(3)}\x1b[0m ${agentType.padEnd(12)} - ${reason}`);
      }
    }

    return rewardsApplied;
  }

  /**
   * Record architect's own outcome
   */
  private async recordOutcome(result: ArchitectReviewResult): Promise<void> {
    if (!this.promptId) return;

    const learningSystem = getLearningSystem();
    const db = getDatabase();

    // Architect is rewarded based on accuracy of review
    const reward = result.overallPass ? 0.5 : -0.2;

    await learningSystem.recordOutcome({
      promptId: this.promptId,
      projectId: this.config.projectId,
      agentId: this.agentId,
      outcome: result.overallPass ? 'success' : 'failure',
      reward,
      context: {
        type: 'architect_self_review',
        milestone: this.config.milestone,
        score: result.score,
        grade: result.grade,
        criteriaPassCount: Object.values(result.criteria).filter(c => c.pass).length,
        criticalFixesCount: result.criticalFixes.length,
      },
    });

    // Update architect agent status
    await db.query(
      `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2`,
      [result.overallPass ? 'completed' : 'failed', this.agentId]
    );
  }

  /**
   * Print review summary
   */
  private printSummary(result: ArchitectReviewResult): void {
    const colors = {
      reset: '\x1b[0m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
    };

    console.log('\n' + '═'.repeat(70));
    console.log('  ARCHITECT REVIEW SUMMARY');
    console.log('═'.repeat(70));

    // Success Criteria Table
    console.log('\n┌────────────────────────────┬──────────┬───────────┬────────┐');
    console.log('│ Criteria                   │ Value    │ Threshold │ Status │');
    console.log('├────────────────────────────┼──────────┼───────────┼────────┤');

    const criteriaNames: Record<string, string> = {
      requirementsCoverage: 'Requirements Coverage',
      codeQualityScore: 'Code Quality Score',
      testCoverage: 'Test Coverage',
      criticalIssues: 'Critical Issues',
      highIssues: 'High Issues',
      securityVulnerabilities: 'Security Issues',
      typeScriptStrict: 'TypeScript Strict',
      errorHandlingCoverage: 'Error Handling',
      apiDocumentation: 'API Documentation',
    };

    for (const [key, criteria] of Object.entries(result.criteria)) {
      const name = criteriaNames[key] || key;
      const value = typeof criteria.value === 'boolean' ? (criteria.value ? 'Yes' : 'No') : `${criteria.value}%`;
      const threshold = typeof criteria.threshold === 'boolean' ? (criteria.threshold ? 'Yes' : 'No') :
        (key.includes('Issues') ? `≤ ${criteria.threshold}` : `≥ ${criteria.threshold}%`);
      const status = criteria.pass ? `${colors.green}✓ PASS${colors.reset}` : `${colors.red}✗ FAIL${colors.reset}`;

      console.log(`│ ${name.padEnd(26)} │ ${String(value).padEnd(8)} │ ${threshold.padEnd(9)} │ ${status} │`);
    }

    console.log('└────────────────────────────┴──────────┴───────────┴────────┘');

    // Overall Result
    const gradeColor = result.grade === 'A' ? colors.green :
      result.grade === 'B' ? colors.blue :
        result.grade === 'C' ? colors.yellow : colors.red;

    console.log(`\n  Overall Score: ${gradeColor}${result.score}/100 (Grade: ${result.grade})${colors.reset}`);
    console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);

    // Critical Fixes
    if (result.criticalFixes.length > 0) {
      console.log(`\n${colors.red}  CRITICAL FIXES REQUIRED (${result.criticalFixes.length}):${colors.reset}`);
      for (const fix of result.criticalFixes.slice(0, 10)) {
        console.log(`    • ${fix}`);
      }
    }

    // Final Verdict
    console.log('\n' + '═'.repeat(70));
    if (result.overallPass) {
      console.log(`${colors.green}  ✓ MILESTONE ${this.config.milestone} APPROVED${colors.reset}`);
      console.log('  Foundation is solid. Proceed to next phase.');
    } else {
      console.log(`${colors.red}  ✗ MILESTONE ${this.config.milestone} NEEDS WORK${colors.reset}`);
      console.log('  Fix critical issues before proceeding.');
    }
    console.log('═'.repeat(70) + '\n');
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }
}

/**
 * Factory function
 */
export function createArchitectAgent(
  config: ArchitectReviewConfig,
  criteria?: ArchitectSuccessCriteria
): ArchitectAgent {
  return new ArchitectAgent(config, criteria);
}

/**
 * Run architect review for a milestone
 */
export async function runArchitectReview(
  projectId: string,
  projectDir: string,
  milestone: string,
  requirementsSource: string,
  criteria?: Partial<ArchitectSuccessCriteria>
): Promise<ArchitectReviewResult> {
  const fullCriteria = { ...DEFAULT_SUCCESS_CRITERIA, ...criteria };

  const architect = createArchitectAgent(
    { projectId, projectDir, milestone, requirementsSource },
    fullCriteria
  );

  await architect.initialize();
  return architect.runReview();
}
