#!/usr/bin/env tsx
/**
 * Architect Review Runner
 *
 * Runs the Senior Architect Agent to review the current codebase
 * against quality standards and success criteria.
 *
 * Usage:
 *   npx tsx src/scripts/run-architect-review.ts [milestone]
 *
 * Example:
 *   npx tsx src/scripts/run-architect-review.ts Demo2
 */

import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../lib/database.js';
import { getLearningSystem } from '../core/learning/index.js';
import { QualityAnalyzer } from '../core/architect-agent/quality-analyzer.js';
import { RequirementsMapper } from '../core/architect-agent/requirements-mapper.js';
import { TestCoverageAnalyzer } from '../core/architect-agent/test-coverage-analyzer.js';

// Configuration
const CONFIG = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'eklavya',
    user: process.env.DB_USER || 'eklavya',
    password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
  },
};

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(msg: string, color = colors.reset): void {
  console.log(`${color}${msg}${colors.reset}`);
}

interface ReviewCriteria {
  requirementsCoverage: { value: number; threshold: number; pass: boolean };
  codeQualityScore: { value: number; threshold: number; pass: boolean };
  testCoverage: { value: number; threshold: number; pass: boolean };
  criticalIssues: { value: number; threshold: number; pass: boolean };
  highIssues: { value: number; threshold: number; pass: boolean };
  securityVulnerabilities: { value: number; threshold: number; pass: boolean };
  typeScriptStrict: { value: boolean; threshold: boolean; pass: boolean };
  errorHandlingCoverage: { value: number; threshold: number; pass: boolean };
}

async function main(): Promise<void> {
  const milestone = process.argv[2] || 'Demo2';
  const projectDir = path.resolve(process.cwd());

  log('\n' + '╔' + '═'.repeat(68) + '╗', colors.magenta);
  log('║' + '  EKLAVYA SENIOR ARCHITECT REVIEW'.padEnd(68) + '║', colors.magenta);
  log('╚' + '═'.repeat(68) + '╝', colors.magenta);

  log(`\nStarted: ${new Date().toISOString()}`);
  log(`Milestone: ${milestone}`);
  log(`Project: ${projectDir}\n`);

  const startTime = Date.now();

  // Initialize database connection
  const db = getDatabase(CONFIG.database);
  await db.connect();
  log('✓ Database connected', colors.green);

  // Initialize learning system
  getLearningSystem({ explorationRate: 0.1, candidateRate: 0.3 });
  log('✓ Learning system initialized', colors.green);

  // Create a temporary project ID for the review
  const projectId = uuidv4();

  // Phase 1: Requirements Analysis
  log('\n' + '─'.repeat(70), colors.cyan);
  log('  PHASE 1: Requirements Analysis', colors.cyan);
  log('─'.repeat(70), colors.cyan);

  const requirementsMapper = new RequirementsMapper(projectDir);
  const requirementsReport = await requirementsMapper.analyze();

  log(`\n  Total Requirements: ${requirementsReport.totalRequirements}`);
  log(`  Implemented: ${colors.green}${requirementsReport.implementedRequirements}${colors.reset}`);
  log(`  Partial: ${colors.yellow}${requirementsReport.partialRequirements}${colors.reset}`);
  log(`  Missing: ${colors.red}${requirementsReport.missingRequirements}${colors.reset}`);
  log(`  Coverage: ${requirementsReport.overallCoverage}%`);

  if (requirementsReport.criticalMissing.length > 0) {
    log(`\n  ${colors.red}Critical Missing:${colors.reset}`);
    for (const req of requirementsReport.criticalMissing.slice(0, 5)) {
      log(`    • [${req.id}] ${req.description}`);
    }
  }

  // Phase 2: Code Quality Analysis
  log('\n' + '─'.repeat(70), colors.cyan);
  log('  PHASE 2: Code Quality Analysis', colors.cyan);
  log('─'.repeat(70), colors.cyan);

  const qualityAnalyzer = new QualityAnalyzer(projectDir);
  const qualityReport = await qualityAnalyzer.analyze();

  const criticalIssues = qualityReport.issues.filter(i => i.severity === 'critical').length;
  const highIssues = qualityReport.issues.filter(i => i.severity === 'high').length;
  const mediumIssues = qualityReport.issues.filter(i => i.severity === 'medium').length;
  const securityIssues = qualityReport.issues.filter(i => i.category === 'security').length;

  log(`\n  Files Analyzed: ${qualityReport.totalFiles}`);
  log(`  Lines of Code: ${qualityReport.totalLinesOfCode}`);
  log(`  Avg Complexity: ${qualityReport.avgComplexity.toFixed(1)}`);
  log(`  Overall Score: ${qualityReport.overallScore}/100`);
  log(`\n  TypeScript Strict: ${qualityReport.metrics.typeScriptStrict ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
  log(`  Error Handling Coverage: ${qualityReport.metrics.errorHandlingCoverage.toFixed(1)}%`);
  log(`  Security Score: ${qualityReport.metrics.securityScore}/100`);
  log(`  Maintainability Index: ${qualityReport.metrics.maintainabilityIndex.toFixed(1)}`);

  log(`\n  Issues Found:`);
  log(`    Critical: ${criticalIssues > 0 ? colors.red : colors.green}${criticalIssues}${colors.reset}`);
  log(`    High: ${highIssues > 0 ? colors.yellow : colors.green}${highIssues}${colors.reset}`);
  log(`    Medium: ${mediumIssues}`);
  log(`    Security: ${securityIssues > 0 ? colors.red : colors.green}${securityIssues}${colors.reset}`);

  if (criticalIssues > 0) {
    log(`\n  ${colors.red}Critical Issues:${colors.reset}`);
    for (const issue of qualityReport.issues.filter(i => i.severity === 'critical').slice(0, 5)) {
      const lineInfo = issue.line ? `:${issue.line}` : '';
      log(`    • ${issue.file}${lineInfo} - ${issue.message}`);
    }
  }

  // Phase 3: Test Coverage Analysis
  log('\n' + '─'.repeat(70), colors.cyan);
  log('  PHASE 3: Test Coverage Analysis', colors.cyan);
  log('─'.repeat(70), colors.cyan);

  const coverageAnalyzer = new TestCoverageAnalyzer(projectDir);
  const coverageReport = await coverageAnalyzer.analyze();

  log(`\n  Test Framework: ${coverageReport.testFramework || 'Not detected'}`);
  log(`  Test Files: ${coverageReport.testFiles.length}`);
  log(`  Total Tests: ${coverageReport.totalTests}`);
  log(`  Total Assertions: ${coverageReport.totalAssertions}`);
  log(`  Source Files: ${coverageReport.sourceFiles}`);
  log(`  Tested Files: ${coverageReport.testedFiles}`);
  log(`  File Coverage: ${coverageReport.testCoverage.toFixed(1)}%`);

  log(`\n  Test Quality:`);
  log(`    Avg Assertions/Test: ${coverageReport.testQuality.avgAssertionsPerTest}`);
  log(`    Has Unit Tests: ${coverageReport.testQuality.hasUnitTests ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
  log(`    Has Integration Tests: ${coverageReport.testQuality.hasIntegrationTests ? colors.green + 'Yes' : colors.yellow + 'No'}${colors.reset}`);
  log(`    Has E2E Tests: ${coverageReport.testQuality.hasE2ETests ? colors.green + 'Yes' : colors.yellow + 'No'}${colors.reset}`);

  const criticalUncovered = coverageReport.uncoveredModules.filter(m => m.priority === 'critical');
  if (criticalUncovered.length > 0) {
    log(`\n  ${colors.red}Critical Untested Modules (${criticalUncovered.length}):${colors.reset}`);
    for (const module of criticalUncovered.slice(0, 5)) {
      log(`    • ${module.path} - ${module.reason}`);
    }
  }

  // Phase 4: Evaluate Success Criteria
  log('\n' + '─'.repeat(70), colors.cyan);
  log('  PHASE 4: Success Criteria Evaluation', colors.cyan);
  log('─'.repeat(70), colors.cyan);

  const lineCoverage = coverageReport.coverageMetrics?.lines ?? coverageReport.testCoverage;

  const criteria: ReviewCriteria = {
    requirementsCoverage: {
      value: requirementsReport.overallCoverage,
      threshold: 90,
      pass: requirementsReport.overallCoverage >= 90,
    },
    codeQualityScore: {
      value: qualityReport.overallScore,
      threshold: 80,
      pass: qualityReport.overallScore >= 80,
    },
    testCoverage: {
      value: lineCoverage,
      threshold: 70,
      pass: lineCoverage >= 70,
    },
    criticalIssues: {
      value: criticalIssues,
      threshold: 0,
      pass: criticalIssues <= 0,
    },
    highIssues: {
      value: highIssues,
      threshold: 3,
      pass: highIssues <= 3,
    },
    securityVulnerabilities: {
      value: securityIssues,
      threshold: 0,
      pass: securityIssues <= 0,
    },
    typeScriptStrict: {
      value: qualityReport.metrics.typeScriptStrict,
      threshold: true,
      pass: qualityReport.metrics.typeScriptStrict === true,
    },
    errorHandlingCoverage: {
      value: qualityReport.metrics.errorHandlingCoverage,
      threshold: 90,
      pass: qualityReport.metrics.errorHandlingCoverage >= 90,
    },
  };

  log('\n┌────────────────────────────┬──────────┬───────────┬────────┐');
  log('│ Criteria                   │ Value    │ Threshold │ Status │');
  log('├────────────────────────────┼──────────┼───────────┼────────┤');

  const criteriaNames: Record<string, string> = {
    requirementsCoverage: 'Requirements Coverage',
    codeQualityScore: 'Code Quality Score',
    testCoverage: 'Test Coverage',
    criticalIssues: 'Critical Issues',
    highIssues: 'High Issues',
    securityVulnerabilities: 'Security Issues',
    typeScriptStrict: 'TypeScript Strict',
    errorHandlingCoverage: 'Error Handling',
  };

  for (const [key, c] of Object.entries(criteria)) {
    const name = criteriaNames[key] || key;
    const value = typeof c.value === 'boolean' ? (c.value ? 'Yes' : 'No') : `${c.value.toFixed ? c.value.toFixed(1) : c.value}%`;
    const threshold = typeof c.threshold === 'boolean' ? (c.threshold ? 'Yes' : 'No') :
      (key.includes('Issues') ? `<= ${c.threshold}` : `>= ${c.threshold}%`);
    const status = c.pass ? `${colors.green}PASS${colors.reset}` : `${colors.red}FAIL${colors.reset}`;

    log(`│ ${name.padEnd(26)} │ ${String(value).padEnd(8)} │ ${threshold.padEnd(9)} │ ${status.padStart(14)} │`);
  }

  log('└────────────────────────────┴──────────┴───────────┴────────┘');

  // Calculate overall score
  let score = 0;
  score += (criteria.requirementsCoverage.value / 100) * 20;
  score += (criteria.codeQualityScore.value / 100) * 20;
  score += (criteria.testCoverage.value / 100) * 15;
  score += criteria.criticalIssues.pass ? 15 : Math.max(0, 15 - criticalIssues * 5);
  score += criteria.highIssues.pass ? 5 : Math.max(0, 5 - highIssues);
  score += criteria.securityVulnerabilities.pass ? 10 : 0;
  score += criteria.typeScriptStrict.pass ? 5 : 0;
  score += (criteria.errorHandlingCoverage.value / 100) * 10;

  score = Math.round(Math.max(0, Math.min(100, score)));

  let grade: string;
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else grade = 'F';

  const overallPass = criteria.criticalIssues.pass &&
    criteria.securityVulnerabilities.pass &&
    score >= 70;

  const gradeColor = grade === 'A' ? colors.green :
    grade === 'B' ? colors.blue :
      grade === 'C' ? colors.yellow : colors.red;

  log(`\n  Overall Score: ${gradeColor}${score}/100 (Grade: ${grade})${colors.reset}`);

  // Phase 5: Apply RL Feedback
  log('\n' + '─'.repeat(70), colors.cyan);
  log('  PHASE 5: RL Feedback Application', colors.cyan);
  log('─'.repeat(70), colors.cyan);

  try {
    const learningSystem = getLearningSystem();

    // Get agents for this project
    const agentsResult = await db.query<{
      id: string;
      type: string;
      prompt_id: string;
    }>(
      `SELECT id, type, prompt_id FROM agents WHERE prompt_id IS NOT NULL ORDER BY created_at DESC LIMIT 20`
    );

    if (agentsResult.rows.length > 0) {
      log('\n  Applying rewards/penalties to agents:');

      for (const agent of agentsResult.rows) {
        const baseReward = (score - 70) / 100;
        let reward = baseReward;
        let reason = `Overall: ${score}%`;

        switch (agent.type) {
          case 'developer':
            reward += (qualityReport.overallScore - 70) / 100;
            reason = `Quality: ${qualityReport.overallScore}%`;
            break;
          case 'tester':
            reward += (lineCoverage - 50) / 100;
            reason = `Coverage: ${lineCoverage.toFixed(1)}%`;
            break;
          case 'architect':
            reward += (requirementsReport.overallCoverage - 70) / 100;
            reason = `Requirements: ${requirementsReport.overallCoverage.toFixed(1)}%`;
            break;
        }

        reward = Math.max(-1, Math.min(1, reward));

        await learningSystem.recordOutcome({
          promptId: agent.prompt_id,
          projectId,
          agentId: agent.id,
          outcome: reward >= 0 ? 'success' : 'failure',
          reward,
          context: {
            type: 'architect_review',
            milestone,
            score,
            reason,
          },
        });

        const rewardColor = reward >= 0 ? colors.green : colors.red;
        log(`    ${rewardColor}${reward >= 0 ? '+' : ''}${reward.toFixed(3)}${colors.reset} ${agent.type.padEnd(12)} - ${reason}`);
      }
    } else {
      log('\n  No agents with prompt IDs found for RL feedback');
    }
  } catch (error) {
    log(`\n  ${colors.yellow}Could not apply RL feedback: ${error instanceof Error ? error.message : 'Unknown error'}${colors.reset}`);
  }

  // Phase 6: Recommendations
  log('\n' + '─'.repeat(70), colors.cyan);
  log('  PHASE 6: Recommendations', colors.cyan);
  log('─'.repeat(70), colors.cyan);

  const allRecommendations = [
    ...qualityReport.recommendations,
    ...requirementsReport.recommendations,
    ...coverageReport.recommendations,
  ];

  if (allRecommendations.length > 0) {
    log('');
    for (const rec of allRecommendations.slice(0, 10)) {
      log(`  • ${rec}`);
    }
  } else {
    log('\n  No critical recommendations at this time.');
  }

  // Final Verdict
  const duration = Date.now() - startTime;

  log('\n' + '═'.repeat(70), colors.cyan);
  if (overallPass) {
    log(`${colors.green}${colors.bold}  ✓ MILESTONE ${milestone} APPROVED${colors.reset}`, colors.green);
    log('  Foundation is solid. Proceed to next phase.');
  } else {
    log(`${colors.red}${colors.bold}  ✗ MILESTONE ${milestone} NEEDS WORK${colors.reset}`, colors.red);
    log('  Fix critical issues before proceeding.');
  }
  log('═'.repeat(70), colors.cyan);

  log(`\nCompleted: ${new Date().toISOString()}`);
  log(`Duration: ${(duration / 1000).toFixed(1)}s`);

  await db.close();
  process.exit(overallPass ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
