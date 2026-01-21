#!/usr/bin/env npx tsx
/**
 * Post-Demo Architect Review
 *
 * This script runs automatically after each demo passes to:
 * 1. Run the Senior Architect Review
 * 2. Verify quality standards are met
 * 3. Gate the next demo on review approval
 *
 * Usage:
 *   npx tsx src/scripts/post-demo-review.ts [demo-number]
 *
 * Example:
 *   npx tsx src/scripts/post-demo-review.ts 4
 */

import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

// Demo specifications and success criteria
const DEMO_SPECS: Record<number, {
  name: string;
  description: string;
  successCriteria: string[];
  architectThresholds: {
    codeQuality: number;
    testCoverage: number;
    requirementsCoverage: number;
    maxCriticalIssues: number;
  };
}> = {
  0: {
    name: 'UI Foundation',
    description: 'Dashboard, project cards, responsive design',
    successCriteria: [
      'Dashboard renders correctly',
      'Project cards display mock data',
      'Mobile responsive layout',
      'Navigation works',
    ],
    architectThresholds: {
      codeQuality: 60,
      testCoverage: 20,
      requirementsCoverage: 50,
      maxCriticalIssues: 2,
    },
  },
  1: {
    name: 'Agent Lifecycle',
    description: 'Agent spawn, terminate, status tracking',
    successCriteria: [
      'Agents can be created',
      'Agent status updates',
      'Agents can be terminated',
      'Heartbeat monitoring',
    ],
    architectThresholds: {
      codeQuality: 65,
      testCoverage: 25,
      requirementsCoverage: 60,
      maxCriticalIssues: 1,
    },
  },
  2: {
    name: 'Learning System',
    description: 'Thompson Sampling, prompt evolution, RL feedback',
    successCriteria: [
      'Prompts stored with versions',
      'Thompson Sampling selection',
      'Outcome recording',
      'Reward calculation',
    ],
    architectThresholds: {
      codeQuality: 70,
      testCoverage: 30,
      requirementsCoverage: 70,
      maxCriticalIssues: 1,
    },
  },
  3: {
    name: 'Autonomous Task Execution',
    description: 'Task queue, orchestrator, checkpoints, messaging',
    successCriteria: [
      'Task queue operations',
      'Orchestrator start/stop',
      'Checkpoint save/restore',
      'Agent messaging',
    ],
    architectThresholds: {
      codeQuality: 75,
      testCoverage: 35,
      requirementsCoverage: 75,
      maxCriticalIssues: 0,
    },
  },
  4: {
    name: 'Agent Lifecycle Management',
    description: 'Process tracking, health monitoring, resources',
    successCriteria: [
      'Agent spawning with process tracking',
      'Health monitoring < 5s detection',
      'Resource tracking (CPU, memory, tokens)',
      'Crash recovery',
    ],
    architectThresholds: {
      codeQuality: 75,
      testCoverage: 40,
      requirementsCoverage: 80,
      maxCriticalIssues: 0,
    },
  },
  5: {
    name: 'Multi-Agent Coordination',
    description: 'Multiple agents working on same project',
    successCriteria: [
      'Multiple agents spawn concurrently',
      'Task distribution to agents',
      'Agent coordination via messaging',
      'Conflict resolution',
    ],
    architectThresholds: {
      codeQuality: 80,
      testCoverage: 45,
      requirementsCoverage: 85,
      maxCriticalIssues: 0,
    },
  },
  6: {
    name: 'Real-Time Portal',
    description: 'WebSocket updates, notifications, live dashboard',
    successCriteria: [
      'Real-time status updates',
      'Smart notifications',
      'Live agent activity',
      'Project progress streaming',
    ],
    architectThresholds: {
      codeQuality: 80,
      testCoverage: 50,
      requirementsCoverage: 85,
      maxCriticalIssues: 0,
    },
  },
  7: {
    name: 'Demo System',
    description: 'Preview URLs, approval gates, scaffolding reuse',
    successCriteria: [
      'Demo preview URLs generated',
      'Admin approval workflow',
      'Client feedback recording',
      'Scaffolding reuse logic',
    ],
    architectThresholds: {
      codeQuality: 85,
      testCoverage: 55,
      requirementsCoverage: 90,
      maxCriticalIssues: 0,
    },
  },
  8: {
    name: 'Self-Build Test',
    description: 'Eklavya builds a simple project end-to-end',
    successCriteria: [
      'Create project from description',
      'Orchestrator creates plan',
      'Agents execute tasks',
      'Project completes successfully',
    ],
    architectThresholds: {
      codeQuality: 85,
      testCoverage: 60,
      requirementsCoverage: 90,
      maxCriticalIssues: 0,
    },
  },
};

interface ReviewResult {
  demoNumber: number;
  demoName: string;
  passed: boolean;
  scores: {
    codeQuality: number;
    testCoverage: number;
    requirementsCoverage: number;
    criticalIssues: number;
    overallScore: number;
    grade: string;
  };
  issues: string[];
  recommendations: string[];
  readyForNextDemo: boolean;
}

async function runArchitectReview(demoNumber: number): Promise<ReviewResult> {
  const spec = DEMO_SPECS[demoNumber];
  if (!spec) {
    throw new Error(`Unknown demo number: ${demoNumber}`);
  }

  log(`\n${colors.cyan}Running Architect Review for Demo${demoNumber}: ${spec.name}${colors.reset}`);
  log(`Thresholds: Quality=${spec.architectThresholds.codeQuality}%, Coverage=${spec.architectThresholds.testCoverage}%, Requirements=${spec.architectThresholds.requirementsCoverage}%`);

  // Run the architect review script
  try {
    const { stdout, stderr } = await execAsync(
      `cd ${path.resolve(process.cwd())} && npx tsx src/scripts/run-architect-review.ts Demo${demoNumber}`,
      { timeout: 120000 }
    );

    // Parse the output to extract scores
    const scores = parseArchitectOutput(stdout);

    // Evaluate against demo-specific thresholds
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (scores.codeQuality < spec.architectThresholds.codeQuality) {
      issues.push(`Code quality ${scores.codeQuality}% below threshold ${spec.architectThresholds.codeQuality}%`);
      recommendations.push('Improve code quality: reduce complexity, add error handling');
    }

    if (scores.testCoverage < spec.architectThresholds.testCoverage) {
      issues.push(`Test coverage ${scores.testCoverage}% below threshold ${spec.architectThresholds.testCoverage}%`);
      recommendations.push('Add more tests for critical paths');
    }

    if (scores.requirementsCoverage < spec.architectThresholds.requirementsCoverage) {
      issues.push(`Requirements coverage ${scores.requirementsCoverage}% below threshold ${spec.architectThresholds.requirementsCoverage}%`);
      recommendations.push('Implement missing requirements');
    }

    if (scores.criticalIssues > spec.architectThresholds.maxCriticalIssues) {
      issues.push(`${scores.criticalIssues} critical issues found (max allowed: ${spec.architectThresholds.maxCriticalIssues})`);
      recommendations.push('Fix all critical issues before proceeding');
    }

    const passed = issues.length === 0;
    const readyForNextDemo = passed && scores.overallScore >= 70;

    return {
      demoNumber,
      demoName: spec.name,
      passed,
      scores,
      issues,
      recommendations,
      readyForNextDemo,
    };
  } catch (error) {
    // If the architect review fails to run, return a failed result
    return {
      demoNumber,
      demoName: spec.name,
      passed: false,
      scores: {
        codeQuality: 0,
        testCoverage: 0,
        requirementsCoverage: 0,
        criticalIssues: 99,
        overallScore: 0,
        grade: 'F',
      },
      issues: ['Architect review failed to execute: ' + (error instanceof Error ? error.message : String(error))],
      recommendations: ['Fix the architect review script or underlying issues'],
      readyForNextDemo: false,
    };
  }
}

function parseArchitectOutput(output: string): ReviewResult['scores'] {
  // Default scores if parsing fails
  let codeQuality = 0;
  let testCoverage = 0;
  let requirementsCoverage = 0;
  let criticalIssues = 0;
  let overallScore = 0;
  let grade = 'F';

  // Parse code quality score
  const qualityMatch = output.match(/Overall Score:\s*(\d+)/);
  if (qualityMatch) codeQuality = parseInt(qualityMatch[1], 10);

  // Parse test coverage
  const coverageMatch = output.match(/(?:File Coverage|Test Coverage):\s*([\d.]+)%/);
  if (coverageMatch) testCoverage = parseFloat(coverageMatch[1]);

  // Parse requirements coverage
  const reqMatch = output.match(/Coverage:\s*([\d.]+)%/);
  if (reqMatch) requirementsCoverage = parseFloat(reqMatch[1]);

  // Parse critical issues
  const criticalMatch = output.match(/Critical:\s*(\d+)/);
  if (criticalMatch) criticalIssues = parseInt(criticalMatch[1], 10);

  // Parse overall score and grade
  const overallMatch = output.match(/Overall Score:\s*(\d+)\/100\s*\(Grade:\s*([A-F])\)/);
  if (overallMatch) {
    overallScore = parseInt(overallMatch[1], 10);
    grade = overallMatch[2];
  }

  return {
    codeQuality,
    testCoverage,
    requirementsCoverage,
    criticalIssues,
    overallScore,
    grade,
  };
}

function displayResult(result: ReviewResult): void {
  const passColor = result.passed ? colors.green : colors.red;
  const passStatus = result.passed ? '✓ PASSED' : '✗ FAILED';

  log('\n' + '═'.repeat(70), colors.cyan);
  log(`  ARCHITECT REVIEW: Demo${result.demoNumber} - ${result.demoName}`, colors.bold);
  log('═'.repeat(70), colors.cyan);

  log(`\n  Status: ${passColor}${passStatus}${colors.reset}`);

  log('\n  Scores:');
  log(`    Code Quality:      ${result.scores.codeQuality}%`);
  log(`    Test Coverage:     ${result.scores.testCoverage}%`);
  log(`    Requirements:      ${result.scores.requirementsCoverage}%`);
  log(`    Critical Issues:   ${result.scores.criticalIssues}`);
  log(`    Overall Score:     ${result.scores.overallScore}/100 (Grade: ${result.scores.grade})`);

  if (result.issues.length > 0) {
    log(`\n  ${colors.red}Issues:${colors.reset}`);
    for (const issue of result.issues) {
      log(`    • ${issue}`);
    }
  }

  if (result.recommendations.length > 0) {
    log(`\n  ${colors.yellow}Recommendations:${colors.reset}`);
    for (const rec of result.recommendations) {
      log(`    • ${rec}`);
    }
  }

  log('\n' + '─'.repeat(70), colors.cyan);

  if (result.readyForNextDemo) {
    const nextDemo = result.demoNumber + 1;
    if (DEMO_SPECS[nextDemo]) {
      log(`${colors.green}✓ Ready to proceed to Demo${nextDemo}: ${DEMO_SPECS[nextDemo].name}${colors.reset}`);
    } else {
      log(`${colors.green}✓ All demos complete! Ready for Full Build.${colors.reset}`);
    }
  } else {
    log(`${colors.red}✗ Fix issues before proceeding to next demo.${colors.reset}`);
  }

  log('─'.repeat(70), colors.cyan);
}

async function main(): Promise<void> {
  const demoNumber = parseInt(process.argv[2] || '4', 10);

  log('\n' + '╔' + '═'.repeat(68) + '╗', colors.magenta);
  log('║' + '  POST-DEMO ARCHITECT REVIEW'.padEnd(68) + '║', colors.magenta);
  log('╚' + '═'.repeat(68) + '╝', colors.magenta);

  // First, verify the demo tests pass
  const spec = DEMO_SPECS[demoNumber];
  if (!spec) {
    log(`${colors.red}Error: Unknown demo number ${demoNumber}${colors.reset}`);
    log(`Valid demos: ${Object.keys(DEMO_SPECS).join(', ')}`);
    process.exit(1);
  }

  log(`\nDemo${demoNumber}: ${spec.name}`);
  log(`Description: ${spec.description}`);
  log(`\nSuccess Criteria:`);
  for (const criteria of spec.successCriteria) {
    log(`  • ${criteria}`);
  }

  // Run the architect review
  const result = await runArchitectReview(demoNumber);

  // Display the result
  displayResult(result);

  // Exit with appropriate code
  process.exit(result.readyForNextDemo ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
