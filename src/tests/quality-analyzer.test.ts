/**
 * Unit Tests for Quality Analyzer
 *
 * Tests code quality analysis functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import { QualityAnalyzer } from '../core/architect-agent/quality-analyzer.js';

describe('Quality Analyzer', () => {
  let analyzer: QualityAnalyzer;
  const projectPath = path.resolve(__dirname, '..');

  beforeEach(() => {
    analyzer = new QualityAnalyzer(projectPath);
  });

  describe('Initialization', () => {
    it('should create analyzer instance', () => {
      expect(analyzer).toBeDefined();
      expect(analyzer).toBeInstanceOf(QualityAnalyzer);
    });
  });

  describe('analyze()', () => {
    it('should return a quality report', async () => {
      const report = await analyzer.analyze();

      expect(report).toBeDefined();
      expect(report.timestamp).toBeInstanceOf(Date);
      expect(report.projectPath).toBe(projectPath);
      expect(typeof report.overallScore).toBe('number');
      expect(report.overallScore).toBeGreaterThanOrEqual(0);
      expect(report.overallScore).toBeLessThanOrEqual(100);
    });

    it('should count files and lines', async () => {
      const report = await analyzer.analyze();

      expect(report.totalFiles).toBeGreaterThan(0);
      expect(report.totalLines).toBeGreaterThan(0);
      expect(report.totalLinesOfCode).toBeGreaterThan(0);
      expect(report.totalLinesOfCode).toBeLessThanOrEqual(report.totalLines);
    });

    it('should calculate complexity metrics', async () => {
      const report = await analyzer.analyze();

      expect(report.avgComplexity).toBeGreaterThan(0);
      expect(report.fileMetrics.length).toBeGreaterThan(0);

      for (const fileMetric of report.fileMetrics) {
        expect(fileMetric.complexity).toBeGreaterThanOrEqual(1);
        expect(fileMetric.lines).toBeGreaterThan(0);
      }
    });

    it('should check TypeScript strict mode', async () => {
      const report = await analyzer.analyze();

      expect(typeof report.metrics.typeScriptStrict).toBe('boolean');
    });

    it('should identify issues', async () => {
      const report = await analyzer.analyze();

      expect(Array.isArray(report.issues)).toBe(true);

      for (const issue of report.issues) {
        expect(issue.id).toBeDefined();
        expect(['critical', 'high', 'medium', 'low', 'info']).toContain(issue.severity);
        expect(['security', 'quality', 'performance', 'maintainability', 'style']).toContain(issue.category);
        expect(issue.file).toBeDefined();
        expect(issue.message).toBeDefined();
      }
    });

    it('should generate recommendations', async () => {
      const report = await analyzer.analyze();

      expect(Array.isArray(report.recommendations)).toBe(true);
    });
  });

  describe('Security Checks', () => {
    it('should not flag security analyzer itself', async () => {
      const report = await analyzer.analyze();

      const selfFlags = report.issues.filter(
        i => i.file.includes('quality-analyzer') && i.category === 'security'
      );

      // Should not have false positives from the analyzer's own patterns
      expect(selfFlags.length).toBe(0);
    });

    it('should identify security issues by category', async () => {
      const report = await analyzer.analyze();

      const securityIssues = report.issues.filter(i => i.category === 'security');

      // Each security issue should have proper structure
      for (const issue of securityIssues) {
        expect(issue.severity).toMatch(/critical|high|medium/);
        expect(issue.suggestion).toBeDefined();
      }
    });
  });

  describe('File Metrics', () => {
    it('should analyze individual file metrics', async () => {
      const report = await analyzer.analyze();

      expect(report.fileMetrics.length).toBeGreaterThan(0);

      for (const metric of report.fileMetrics) {
        expect(metric.file).toBeDefined();
        expect(metric.lines).toBeGreaterThan(0);
        expect(metric.linesOfCode).toBeGreaterThanOrEqual(0);
        expect(metric.complexity).toBeGreaterThanOrEqual(1);
        expect(typeof metric.hasErrorHandling).toBe('boolean');
        expect(typeof metric.hasTypeAnnotations).toBe('boolean');
      }
    });

    it('should count functions and classes', async () => {
      const report = await analyzer.analyze();

      // At least some files should have functions
      const filesWithFunctions = report.fileMetrics.filter(f => f.functions > 0);
      expect(filesWithFunctions.length).toBeGreaterThan(0);
    });
  });

  describe('Score Calculation', () => {
    it('should calculate overall score within bounds', async () => {
      const report = await analyzer.analyze();

      expect(report.overallScore).toBeGreaterThanOrEqual(0);
      expect(report.overallScore).toBeLessThanOrEqual(100);
    });

    it('should calculate error handling coverage', async () => {
      const report = await analyzer.analyze();

      expect(report.metrics.errorHandlingCoverage).toBeGreaterThanOrEqual(0);
      expect(report.metrics.errorHandlingCoverage).toBeLessThanOrEqual(100);
    });

    it('should calculate security score', async () => {
      const report = await analyzer.analyze();

      expect(report.metrics.securityScore).toBeGreaterThanOrEqual(0);
      expect(report.metrics.securityScore).toBeLessThanOrEqual(100);
    });

    it('should calculate maintainability index', async () => {
      const report = await analyzer.analyze();

      expect(report.metrics.maintainabilityIndex).toBeGreaterThanOrEqual(0);
      expect(report.metrics.maintainabilityIndex).toBeLessThanOrEqual(100);
    });
  });
});
