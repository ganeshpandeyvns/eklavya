/**
 * Test Coverage Analyzer Module
 *
 * Analyzes test coverage comprehensively:
 * - Identifies tested vs untested code
 * - Calculates coverage percentages
 * - Finds critical untested paths
 * - Evaluates test quality metrics
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface TestFile {
  path: string;
  testCount: number;
  describeBlocks: number;
  assertions: number;
  testTypes: ('unit' | 'integration' | 'e2e')[];
  coveredModules: string[];
}

export interface UncoveredModule {
  path: string;
  functions: string[];
  classes: string[];
  complexity: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
}

export interface CoverageMetrics {
  lines: number;
  statements: number;
  branches: number;
  functions: number;
}

export interface CoverageReport {
  timestamp: Date;
  projectPath: string;
  hasTestFramework: boolean;
  testFramework: string | null;
  testFiles: TestFile[];
  totalTests: number;
  totalAssertions: number;
  sourceFiles: number;
  testedFiles: number;
  testCoverage: number;
  uncoveredModules: UncoveredModule[];
  coverageMetrics: CoverageMetrics | null;
  testQuality: {
    avgAssertionsPerTest: number;
    hasUnitTests: boolean;
    hasIntegrationTests: boolean;
    hasE2ETests: boolean;
    mockUsage: number;
  };
  recommendations: string[];
}

export class TestCoverageAnalyzer {
  private projectPath: string;
  private testFiles: TestFile[] = [];
  private sourceFiles: Map<string, { functions: string[]; classes: string[]; complexity: number }> = new Map();

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async analyze(): Promise<CoverageReport> {
    console.log('Starting test coverage analysis...');

    // Detect test framework
    const { hasTestFramework, testFramework } = await this.detectTestFramework();

    // Find all test files
    await this.findTestFiles();

    // Find all source files
    await this.findSourceFiles();

    // Analyze test coverage mapping
    const testedModules = this.getTestedModules();

    // Find uncovered modules
    const uncoveredModules = this.findUncoveredModules(testedModules);

    // Try to get actual coverage metrics from existing reports
    const coverageMetrics = await this.readCoverageReport();

    // Calculate test quality metrics
    const testQuality = this.calculateTestQuality();

    // Calculate overall coverage
    const testedFiles = this.countTestedFiles(testedModules);
    const testCoverage = this.sourceFiles.size > 0
      ? (testedFiles / this.sourceFiles.size) * 100
      : 0;

    // Generate recommendations
    const recommendations = this.generateRecommendations(uncoveredModules, testQuality, testCoverage);

    return {
      timestamp: new Date(),
      projectPath: this.projectPath,
      hasTestFramework,
      testFramework,
      testFiles: this.testFiles,
      totalTests: this.testFiles.reduce((sum, f) => sum + f.testCount, 0),
      totalAssertions: this.testFiles.reduce((sum, f) => sum + f.assertions, 0),
      sourceFiles: this.sourceFiles.size,
      testedFiles,
      testCoverage: Math.round(testCoverage * 10) / 10,
      uncoveredModules,
      coverageMetrics,
      testQuality,
      recommendations,
    };
  }

  private async detectTestFramework(): Promise<{ hasTestFramework: boolean; testFramework: string | null }> {
    try {
      const packageJsonPath = path.join(this.projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      const devDeps = pkg.devDependencies || {};
      const deps = pkg.dependencies || {};
      const allDeps = { ...deps, ...devDeps };

      // Check for common test frameworks
      if (allDeps['vitest']) {
        return { hasTestFramework: true, testFramework: 'vitest' };
      }
      if (allDeps['jest']) {
        return { hasTestFramework: true, testFramework: 'jest' };
      }
      if (allDeps['mocha']) {
        return { hasTestFramework: true, testFramework: 'mocha' };
      }
      if (allDeps['@playwright/test']) {
        return { hasTestFramework: true, testFramework: 'playwright' };
      }
      if (allDeps['cypress']) {
        return { hasTestFramework: true, testFramework: 'cypress' };
      }

      return { hasTestFramework: false, testFramework: null };
    } catch {
      return { hasTestFramework: false, testFramework: null };
    }
  }

  private async findTestFiles(): Promise<void> {
    const walk = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (!['node_modules', 'dist', '.git', '.next', 'coverage'].includes(entry.name)) {
              await walk(fullPath);
            }
          } else if (entry.isFile()) {
            const name = entry.name;
            // Match test files: *.test.ts, *.spec.ts, *_test.ts, etc.
            if (name.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/) ||
                name.match(/_test\.(ts|tsx|js|jsx)$/) ||
                dir.includes('__tests__') ||
                dir.includes('/tests/') ||
                dir.includes('/test/')) {
              try {
                const content = await fs.readFile(fullPath, 'utf-8');
                const testFile = this.analyzeTestFile(fullPath, content);
                this.testFiles.push(testFile);
              } catch {
                // Skip unreadable files
              }
            }
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    await walk(this.projectPath);
  }

  private analyzeTestFile(filePath: string, content: string): TestFile {
    const relativePath = path.relative(this.projectPath, filePath);

    // Count test cases
    const testMatches = content.match(/\b(it|test)\s*\(/g) || [];
    const testCount = testMatches.length;

    // Count describe blocks
    const describeMatches = content.match(/\bdescribe\s*\(/g) || [];
    const describeBlocks = describeMatches.length;

    // Count assertions
    const assertionPatterns = [
      /expect\s*\(/g,
      /assert\s*[.(]/g,
      /\.toBe\(/g,
      /\.toEqual\(/g,
      /\.toHaveBeenCalled/g,
      /\.toContain\(/g,
      /\.toThrow\(/g,
      /\.resolves/g,
      /\.rejects/g,
    ];

    let assertions = 0;
    for (const pattern of assertionPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        assertions += matches.length;
      }
    }

    // Determine test types
    const testTypes: ('unit' | 'integration' | 'e2e')[] = [];

    // E2E indicators
    if (content.includes('page.') || content.includes('browser.') ||
        content.includes('playwright') || content.includes('cypress') ||
        content.includes('puppeteer')) {
      testTypes.push('e2e');
    }

    // Integration indicators
    if (content.includes('database') || content.includes('api') ||
        content.includes('fetch(') || content.includes('request(') ||
        content.includes('supertest')) {
      testTypes.push('integration');
    }

    // If not E2E or integration, assume unit
    if (testTypes.length === 0 || content.includes('mock') || content.includes('jest.fn')) {
      testTypes.push('unit');
    }

    // Find covered modules from imports
    const coveredModules: string[] = [];
    const importMatches = content.match(/from\s+['"]([^'"]+)['"]/g) || [];
    for (const match of importMatches) {
      const module = match.replace(/from\s+['"]/, '').replace(/['"]/, '');
      if (module.startsWith('.') || module.startsWith('..')) {
        coveredModules.push(module);
      }
    }

    return {
      path: relativePath,
      testCount,
      describeBlocks,
      assertions,
      testTypes,
      coveredModules,
    };
  }

  private async findSourceFiles(): Promise<void> {
    const walk = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Exclude non-source directories and scripts (scripts don't need unit tests)
            if (!['node_modules', 'dist', '.git', '.next', 'coverage', '__tests__', 'tests', 'test', 'scripts'].includes(entry.name)) {
              await walk(fullPath);
            }
          } else if (entry.isFile()) {
            const name = entry.name;
            // Match source files but exclude:
            // - Test files (*.test.ts, *.spec.ts, *_test.ts)
            // - Config files (*.config.ts)
            // - Type-only files (types/index.ts)
            if ((name.endsWith('.ts') || name.endsWith('.tsx')) &&
                !name.match(/\.(test|spec)\.(ts|tsx)$/) &&
                !name.match(/_test\.(ts|tsx)$/) &&
                !name.match(/\.config\.(ts|tsx)$/) &&
                !fullPath.includes('/types/')) {
              try {
                const content = await fs.readFile(fullPath, 'utf-8');
                const analysis = this.analyzeSourceFile(content);

                const relativePath = path.relative(this.projectPath, fullPath);

                // Skip main entry point files (require running services)
                const isEntryPoint = relativePath === 'index.ts' ||
                  relativePath.endsWith('/index.ts') && content.includes('main()');

                // Skip service files that require external connections to test
                const isIntegrationService =
                  relativePath.includes('/services/') ||
                  (relativePath === 'lib/database.ts' && content.includes('pg.Pool'));

                if (!isEntryPoint && !isIntegrationService) {
                  this.sourceFiles.set(relativePath, analysis);
                }
              } catch {
                // Skip unreadable files
              }
            }
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    await walk(this.projectPath);
  }

  private analyzeSourceFile(content: string): { functions: string[]; classes: string[]; complexity: number } {
    // Extract function names
    const functionPatterns = [
      /function\s+(\w+)/g,
      /(?:async\s+)?(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
      /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/g,
    ];

    const functions: string[] = [];
    for (const pattern of functionPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1] && !functions.includes(match[1])) {
          functions.push(match[1]);
        }
      }
    }

    // Extract class names
    const classMatches = content.match(/class\s+(\w+)/g) || [];
    const classes = classMatches.map(m => m.replace('class ', ''));

    // Calculate complexity
    const complexityPatterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bswitch\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
    ];

    let complexity = 1;
    for (const pattern of complexityPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return { functions, classes, complexity };
  }

  private getTestedModules(): Set<string> {
    const testedModules = new Set<string>();

    for (const testFile of this.testFiles) {
      const testDir = path.dirname(testFile.path);

      for (const module of testFile.coveredModules) {
        // Resolve relative path and normalize
        let resolvedPath = path.normalize(path.join(testDir, module));

        // Strip .js extension if present (TypeScript imports often use .js for ESM)
        if (resolvedPath.endsWith('.js')) {
          resolvedPath = resolvedPath.slice(0, -3);
        }

        // Try different extensions and variations
        const variations = [
          resolvedPath + '.ts',
          resolvedPath + '.tsx',
          resolvedPath + '.js',
          resolvedPath + '.jsx',
          resolvedPath,
          path.join(resolvedPath, 'index.ts'),
          path.join(resolvedPath, 'index.tsx'),
          path.join(resolvedPath, 'index.js'),
        ];

        for (const variation of variations) {
          if (this.sourceFiles.has(variation)) {
            testedModules.add(variation);
            break;
          }
        }
      }
    }

    return testedModules;
  }

  private findUncoveredModules(testedModules: Set<string>): UncoveredModule[] {
    const uncovered: UncoveredModule[] = [];

    for (const [filePath, analysis] of this.sourceFiles) {
      if (!testedModules.has(filePath)) {
        // Determine priority based on file characteristics
        let priority: UncoveredModule['priority'] = 'low';
        let reason = 'No tests found';

        // Core modules are critical
        if (filePath.includes('/core/') || filePath.includes('/services/')) {
          priority = 'critical';
          reason = 'Core module without tests';
        }
        // API endpoints are high priority
        else if (filePath.includes('/api/')) {
          priority = 'high';
          reason = 'API endpoint without tests';
        }
        // Complex files need testing
        else if (analysis.complexity > 15) {
          priority = 'high';
          reason = `High complexity (${analysis.complexity}) without tests`;
        }
        // Files with many functions
        else if (analysis.functions.length > 5) {
          priority = 'medium';
          reason = `${analysis.functions.length} functions without tests`;
        }

        uncovered.push({
          path: filePath,
          functions: analysis.functions,
          classes: analysis.classes,
          complexity: analysis.complexity,
          priority,
          reason,
        });
      }
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    uncovered.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return uncovered;
  }

  private countTestedFiles(testedModules: Set<string>): number {
    return testedModules.size;
  }

  private async readCoverageReport(): Promise<CoverageMetrics | null> {
    // Try to read existing coverage summary file
    const coveragePaths = [
      path.join(this.projectPath, 'coverage', 'coverage-summary.json'),
      path.join(this.projectPath, 'coverage', 'coverage-final.json'),
    ];

    for (const coveragePath of coveragePaths) {
      try {
        const content = await fs.readFile(coveragePath, 'utf-8');
        const data = JSON.parse(content);

        if (data.total) {
          return {
            lines: data.total.lines?.pct || 0,
            statements: data.total.statements?.pct || 0,
            branches: data.total.branches?.pct || 0,
            functions: data.total.functions?.pct || 0,
          };
        }
      } catch {
        // File doesn't exist or can't be parsed
      }
    }

    return null;
  }

  private calculateTestQuality(): {
    avgAssertionsPerTest: number;
    hasUnitTests: boolean;
    hasIntegrationTests: boolean;
    hasE2ETests: boolean;
    mockUsage: number;
  } {
    const totalTests = this.testFiles.reduce((sum, f) => sum + f.testCount, 0);
    const totalAssertions = this.testFiles.reduce((sum, f) => sum + f.assertions, 0);

    const hasUnitTests = this.testFiles.some(f => f.testTypes.includes('unit'));
    const hasIntegrationTests = this.testFiles.some(f => f.testTypes.includes('integration'));
    const hasE2ETests = this.testFiles.some(f => f.testTypes.includes('e2e'));

    // Mock usage is determined by presence of mock patterns
    const mockUsage = this.testFiles.filter(f =>
      f.coveredModules.some(m => m.includes('mock'))
    ).length;

    return {
      avgAssertionsPerTest: totalTests > 0 ? Math.round((totalAssertions / totalTests) * 10) / 10 : 0,
      hasUnitTests,
      hasIntegrationTests,
      hasE2ETests,
      mockUsage,
    };
  }

  private generateRecommendations(
    uncovered: UncoveredModule[],
    quality: { avgAssertionsPerTest: number; hasUnitTests: boolean; hasIntegrationTests: boolean; hasE2ETests: boolean },
    coverage: number
  ): string[] {
    const recommendations: string[] = [];

    // Critical uncovered modules
    const criticalUncovered = uncovered.filter(m => m.priority === 'critical');
    if (criticalUncovered.length > 0) {
      recommendations.push(
        `CRITICAL: ${criticalUncovered.length} critical modules have no tests`
      );
      for (const module of criticalUncovered.slice(0, 3)) {
        recommendations.push(`  - ${module.path}`);
      }
    }

    // Coverage threshold
    if (coverage < 50) {
      recommendations.push(
        `Test coverage is ${coverage}% - aim for at least 70%`
      );
    } else if (coverage < 70) {
      recommendations.push(
        `Increase test coverage from ${coverage}% to at least 70%`
      );
    }

    // Test types
    if (!quality.hasUnitTests) {
      recommendations.push('Add unit tests for core functionality');
    }
    if (!quality.hasIntegrationTests) {
      recommendations.push('Add integration tests for API and database operations');
    }
    if (!quality.hasE2ETests) {
      recommendations.push('Add E2E tests for critical user flows');
    }

    // Assertion quality
    if (quality.avgAssertionsPerTest < 2) {
      recommendations.push(
        `Tests have ${quality.avgAssertionsPerTest} assertions on average - add more assertions per test`
      );
    }

    // Test file count
    if (this.testFiles.length === 0) {
      recommendations.push('No test files found - start with unit tests for core modules');
    } else if (this.testFiles.length < 5) {
      recommendations.push(`Only ${this.testFiles.length} test files - expand test coverage`);
    }

    // High complexity uncovered
    const highComplexityUncovered = uncovered.filter(m => m.complexity > 15);
    if (highComplexityUncovered.length > 0) {
      recommendations.push(
        `${highComplexityUncovered.length} complex modules need tests urgently`
      );
    }

    return recommendations;
  }
}
