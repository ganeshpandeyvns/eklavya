/**
 * Unit Tests for Requirements Mapper
 *
 * Tests requirements mapping and coverage analysis
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import { RequirementsMapper } from '../core/architect-agent/requirements-mapper.js';

describe('Requirements Mapper', () => {
  let mapper: RequirementsMapper;
  const projectPath = path.resolve(__dirname, '..');

  beforeEach(() => {
    mapper = new RequirementsMapper(projectPath);
  });

  describe('Initialization', () => {
    it('should create mapper instance', () => {
      expect(mapper).toBeDefined();
      expect(mapper).toBeInstanceOf(RequirementsMapper);
    });
  });

  describe('analyze()', () => {
    it('should return a requirements report', async () => {
      const report = await mapper.analyze();

      expect(report).toBeDefined();
      expect(report.timestamp).toBeInstanceOf(Date);
      expect(report.projectPath).toBe(projectPath);
    });

    it('should count total requirements', async () => {
      const report = await mapper.analyze();

      expect(report.totalRequirements).toBeGreaterThan(0);
    });

    it('should categorize requirements', async () => {
      const report = await mapper.analyze();

      expect(report.implementedRequirements).toBeGreaterThanOrEqual(0);
      expect(report.partialRequirements).toBeGreaterThanOrEqual(0);
      expect(report.missingRequirements).toBeGreaterThanOrEqual(0);

      // Sum should equal total
      expect(
        report.implementedRequirements +
        report.partialRequirements +
        report.missingRequirements
      ).toBe(report.totalRequirements);
    });

    it('should calculate overall coverage', async () => {
      const report = await mapper.analyze();

      expect(report.overallCoverage).toBeGreaterThanOrEqual(0);
      expect(report.overallCoverage).toBeLessThanOrEqual(100);
    });

    it('should find spec files', async () => {
      const report = await mapper.analyze();

      expect(Array.isArray(report.specFiles)).toBe(true);
    });
  });

  describe('Categories', () => {
    it('should group requirements by category', async () => {
      const report = await mapper.analyze();

      expect(Array.isArray(report.categories)).toBe(true);
      expect(report.categories.length).toBeGreaterThan(0);

      for (const category of report.categories) {
        expect(category.name).toBeDefined();
        expect(Array.isArray(category.requirements)).toBe(true);
        expect(category.coverage).toBeGreaterThanOrEqual(0);
        expect(category.coverage).toBeLessThanOrEqual(100);
      }
    });

    it('should include expected categories', async () => {
      const report = await mapper.analyze();

      const categoryNames = report.categories.map(c => c.name);

      // Should have some standard categories
      const expectedCategories = ['Core Architecture', 'Database', 'API'];
      for (const expected of expectedCategories) {
        expect(categoryNames).toContain(expected);
      }
    });
  });

  describe('Requirements', () => {
    it('should have proper requirement structure', async () => {
      const report = await mapper.analyze();

      for (const category of report.categories) {
        for (const req of category.requirements) {
          expect(req.id).toBeDefined();
          expect(req.category).toBe(category.name);
          expect(req.description).toBeDefined();
          expect(['critical', 'high', 'medium', 'low']).toContain(req.priority);
          expect(['implemented', 'partial', 'missing', 'unknown']).toContain(req.status);
          expect(Array.isArray(req.implementedIn)).toBe(true);
          expect(req.coverage).toBeGreaterThanOrEqual(0);
          expect(req.coverage).toBeLessThanOrEqual(100);
        }
      }
    });

    it('should identify critical missing requirements', async () => {
      const report = await mapper.analyze();

      expect(Array.isArray(report.criticalMissing)).toBe(true);

      for (const req of report.criticalMissing) {
        expect(req.priority).toBe('critical');
        expect(['missing', 'partial']).toContain(req.status);
      }
    });
  });

  describe('Recommendations', () => {
    it('should generate recommendations', async () => {
      const report = await mapper.analyze();

      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should prioritize critical missing in recommendations', async () => {
      const report = await mapper.analyze();

      if (report.criticalMissing.length > 0) {
        // Should have critical recommendations at the start
        const hasCriticalRec = report.recommendations.some(
          r => r.includes('CRITICAL') || r.includes('critical')
        );
        expect(hasCriticalRec).toBe(true);
      }
    });
  });

  describe('File Mapping', () => {
    it('should map requirements to implementation files', async () => {
      const report = await mapper.analyze();

      // At least some requirements should have implementation files
      const reqsWithFiles = report.categories
        .flatMap(c => c.requirements)
        .filter(r => r.implementedIn.length > 0);

      expect(reqsWithFiles.length).toBeGreaterThan(0);
    });
  });
});
