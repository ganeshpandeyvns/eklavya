/**
 * Unit Tests for Test Coverage Analyzer
 *
 * Tests test coverage analysis functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import { TestCoverageAnalyzer } from '../core/architect-agent/test-coverage-analyzer.js';

describe('Test Coverage Analyzer', () => {
  let analyzer: TestCoverageAnalyzer;
  const projectPath = path.resolve(__dirname, '..');

  beforeEach(() => {
    analyzer = new TestCoverageAnalyzer(projectPath);
  });

  describe('Initialization', () => {
    it('should create analyzer instance', () => {
      expect(analyzer).toBeDefined();
      expect(analyzer).toBeInstanceOf(TestCoverageAnalyzer);
    });
  });

  describe('analyze()', () => {
    it('should return a coverage report', async () => {
      const report = await analyzer.analyze();

      expect(report).toBeDefined();
      expect(report.timestamp).toBeInstanceOf(Date);
      expect(report.projectPath).toBe(projectPath);
    });

    it('should detect test framework', async () => {
      const report = await analyzer.analyze();

      expect(typeof report.hasTestFramework).toBe('boolean');

      if (report.hasTestFramework) {
        expect(report.testFramework).toBeDefined();
        expect(['vitest', 'jest', 'mocha', 'playwright', 'cypress']).toContain(report.testFramework);
      }
    });

    it('should find test files', async () => {
      const report = await analyzer.analyze();

      expect(Array.isArray(report.testFiles)).toBe(true);
    });

    it('should count source files', async () => {
      const report = await analyzer.analyze();

      expect(report.sourceFiles).toBeGreaterThan(0);
    });
  });

  describe('Test Files', () => {
    it('should have proper test file structure', async () => {
      const report = await analyzer.analyze();

      for (const testFile of report.testFiles) {
        expect(testFile.path).toBeDefined();
        expect(testFile.testCount).toBeGreaterThanOrEqual(0);
        expect(testFile.describeBlocks).toBeGreaterThanOrEqual(0);
        expect(testFile.assertions).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(testFile.testTypes)).toBe(true);
        expect(Array.isArray(testFile.coveredModules)).toBe(true);
      }
    });

    it('should categorize test types', async () => {
      const report = await analyzer.analyze();

      for (const testFile of report.testFiles) {
        for (const testType of testFile.testTypes) {
          expect(['unit', 'integration', 'e2e']).toContain(testType);
        }
      }
    });
  });

  describe('Test Quality', () => {
    it('should calculate test quality metrics', async () => {
      const report = await analyzer.analyze();

      expect(report.testQuality).toBeDefined();
      expect(typeof report.testQuality.avgAssertionsPerTest).toBe('number');
      expect(typeof report.testQuality.hasUnitTests).toBe('boolean');
      expect(typeof report.testQuality.hasIntegrationTests).toBe('boolean');
      expect(typeof report.testQuality.hasE2ETests).toBe('boolean');
      expect(typeof report.testQuality.mockUsage).toBe('number');
    });

    it('should calculate average assertions', async () => {
      const report = await analyzer.analyze();

      if (report.totalTests > 0) {
        expect(report.testQuality.avgAssertionsPerTest).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Uncovered Modules', () => {
    it('should identify uncovered modules', async () => {
      const report = await analyzer.analyze();

      expect(Array.isArray(report.uncoveredModules)).toBe(true);
    });

    it('should have proper uncovered module structure', async () => {
      const report = await analyzer.analyze();

      for (const module of report.uncoveredModules) {
        expect(module.path).toBeDefined();
        expect(Array.isArray(module.functions)).toBe(true);
        expect(Array.isArray(module.classes)).toBe(true);
        expect(module.complexity).toBeGreaterThanOrEqual(1);
        expect(['critical', 'high', 'medium', 'low']).toContain(module.priority);
        expect(module.reason).toBeDefined();
      }
    });

    it('should prioritize critical uncovered modules', async () => {
      const report = await analyzer.analyze();

      const criticalModules = report.uncoveredModules.filter(m => m.priority === 'critical');

      if (criticalModules.length > 0) {
        // Critical should come first (sorted by priority)
        const firstCriticalIndex = report.uncoveredModules.findIndex(m => m.priority === 'critical');
        const firstLowIndex = report.uncoveredModules.findIndex(m => m.priority === 'low');

        if (firstLowIndex >= 0) {
          expect(firstCriticalIndex).toBeLessThan(firstLowIndex);
        }
      }
    });
  });

  describe('Coverage Metrics', () => {
    it('should calculate test coverage percentage', async () => {
      const report = await analyzer.analyze();

      expect(report.testCoverage).toBeGreaterThanOrEqual(0);
      expect(report.testCoverage).toBeLessThanOrEqual(100);
    });

    it('should count tested vs total files', async () => {
      const report = await analyzer.analyze();

      expect(report.testedFiles).toBeGreaterThanOrEqual(0);
      expect(report.testedFiles).toBeLessThanOrEqual(report.sourceFiles);
    });
  });

  describe('Recommendations', () => {
    it('should generate recommendations', async () => {
      const report = await analyzer.analyze();

      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should recommend tests for critical uncovered modules', async () => {
      const report = await analyzer.analyze();

      const criticalModules = report.uncoveredModules.filter(m => m.priority === 'critical');

      if (criticalModules.length > 0) {
        // Should have recommendation about critical modules
        const hasCriticalRec = report.recommendations.some(
          r => r.toLowerCase().includes('critical')
        );
        expect(hasCriticalRec).toBe(true);
      }
    });
  });

  describe('Totals', () => {
    it('should calculate total tests and assertions', async () => {
      const report = await analyzer.analyze();

      expect(report.totalTests).toBeGreaterThanOrEqual(0);
      expect(report.totalAssertions).toBeGreaterThanOrEqual(0);

      // Total should match sum of test files
      const sumTests = report.testFiles.reduce((sum, f) => sum + f.testCount, 0);
      const sumAssertions = report.testFiles.reduce((sum, f) => sum + f.assertions, 0);

      expect(report.totalTests).toBe(sumTests);
      expect(report.totalAssertions).toBe(sumAssertions);
    });
  });
});
