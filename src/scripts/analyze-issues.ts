#!/usr/bin/env tsx
/**
 * Analyze quality issues for fixing
 */

import { QualityAnalyzer } from '../core/architect-agent/quality-analyzer.js';
import { TestCoverageAnalyzer } from '../core/architect-agent/test-coverage-analyzer.js';

async function main() {
  const projectPath = '/Users/ganeshpandey/eklavya/src';

  console.log('Analyzing quality issues...\n');

  const qualityAnalyzer = new QualityAnalyzer(projectPath);
  const report = await qualityAnalyzer.analyze();

  console.log('=== FILES WITHOUT ERROR HANDLING (3+ functions) ===');
  const filesWithoutErrorHandling = report.fileMetrics
    .filter(f => !f.hasErrorHandling && f.functions > 3);

  for (const f of filesWithoutErrorHandling) {
    console.log(`  - ${f.file} (${f.functions} functions, complexity: ${f.complexity})`);
  }

  console.log(`\nTotal: ${filesWithoutErrorHandling.length} files need error handling\n`);

  console.log('=== MEDIUM SEVERITY ISSUES ===');
  const mediumIssues = report.issues.filter(i => i.severity === 'medium');
  for (const issue of mediumIssues.slice(0, 15)) {
    console.log(`  - ${issue.file}: ${issue.message}`);
  }
  console.log(`\nTotal: ${mediumIssues.length} medium issues\n`);

  console.log('=== HIGH COMPLEXITY FILES ===');
  const highComplexity = report.fileMetrics.filter(f => f.complexity > 30);
  for (const f of highComplexity) {
    console.log(`  - ${f.file} (complexity: ${f.complexity})`);
  }

  console.log('\n=== TEST COVERAGE ANALYSIS ===');
  const coverageAnalyzer = new TestCoverageAnalyzer(projectPath);
  const coverageReport = await coverageAnalyzer.analyze();

  console.log(`Test Files: ${coverageReport.testFiles.length}`);
  console.log(`Total Tests: ${coverageReport.totalTests}`);
  console.log(`Source Files: ${coverageReport.sourceFiles}`);
  console.log(`Tested Files: ${coverageReport.testedFiles}`);

  console.log('\nTest file imports (covered modules):');
  for (const tf of coverageReport.testFiles) {
    console.log(`  ${tf.path}:`);
    for (const m of tf.coveredModules) {
      console.log(`    - ${m}`);
    }
  }

  console.log('\n=== METRICS SUMMARY ===');
  console.log(`Error Handling Coverage: ${report.metrics.errorHandlingCoverage.toFixed(1)}%`);
  console.log(`Code Quality Score: ${report.overallScore}/100`);
  console.log(`Test Coverage: ${coverageReport.testCoverage.toFixed(1)}%`);
}

main().catch(console.error);
