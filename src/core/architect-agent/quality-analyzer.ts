/**
 * Quality Analyzer Module
 *
 * Performs comprehensive code quality analysis:
 * - TypeScript strict mode compliance
 * - Code complexity metrics
 * - Error handling patterns
 * - Security vulnerabilities
 * - Best practices adherence
 * - Code duplication detection
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface CodeIssue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: 'security' | 'quality' | 'performance' | 'maintainability' | 'style';
  file: string;
  line?: number;
  column?: number;
  message: string;
  rule?: string;
  suggestion?: string;
}

export interface FileMetrics {
  file: string;
  lines: number;
  linesOfCode: number;
  complexity: number;
  functions: number;
  classes: number;
  imports: number;
  exports: number;
  hasErrorHandling: boolean;
  hasTypeAnnotations: boolean;
  duplicateBlocks: number;
}

export interface QualityReport {
  timestamp: Date;
  projectPath: string;
  overallScore: number;
  totalFiles: number;
  totalLines: number;
  totalLinesOfCode: number;
  avgComplexity: number;
  issues: CodeIssue[];
  metrics: {
    typeScriptStrict: boolean;
    errorHandlingCoverage: number;
    securityScore: number;
    maintainabilityIndex: number;
    duplicateCodePercent: number;
  };
  fileMetrics: FileMetrics[];
  recommendations: string[];
}

export class QualityAnalyzer {
  private projectPath: string;
  private issues: CodeIssue[] = [];
  private fileMetrics: FileMetrics[] = [];

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async analyze(): Promise<QualityReport> {
    console.log('Starting quality analysis...');

    // Run all analyses in parallel where possible
    const [
      tsStrictResult,
      typeScriptFiles,
    ] = await Promise.all([
      this.checkTypeScriptStrict(),
      this.findTypeScriptFiles(),
    ]);

    // Analyze each file
    for (const file of typeScriptFiles) {
      const metrics = await this.analyzeFile(file);
      this.fileMetrics.push(metrics);
    }

    // Run additional checks
    await this.runESLintAnalysis();
    await this.checkSecurityPatterns();
    await this.checkErrorHandling();
    await this.detectDuplicateCode();

    // Calculate metrics
    const totalLines = this.fileMetrics.reduce((sum, f) => sum + f.lines, 0);
    const totalLinesOfCode = this.fileMetrics.reduce((sum, f) => sum + f.linesOfCode, 0);
    const avgComplexity = this.fileMetrics.length > 0
      ? this.fileMetrics.reduce((sum, f) => sum + f.complexity, 0) / this.fileMetrics.length
      : 0;

    const errorHandlingCoverage = this.calculateErrorHandlingCoverage();
    const securityScore = this.calculateSecurityScore();
    const maintainabilityIndex = this.calculateMaintainabilityIndex(avgComplexity, totalLinesOfCode);
    const duplicateCodePercent = this.calculateDuplicatePercent();

    // Generate recommendations
    const recommendations = this.generateRecommendations();

    // Calculate overall score
    const overallScore = this.calculateOverallScore(
      tsStrictResult,
      errorHandlingCoverage,
      securityScore,
      maintainabilityIndex,
      duplicateCodePercent
    );

    return {
      timestamp: new Date(),
      projectPath: this.projectPath,
      overallScore,
      totalFiles: typeScriptFiles.length,
      totalLines,
      totalLinesOfCode,
      avgComplexity,
      issues: this.issues,
      metrics: {
        typeScriptStrict: tsStrictResult,
        errorHandlingCoverage,
        securityScore,
        maintainabilityIndex,
        duplicateCodePercent,
      },
      fileMetrics: this.fileMetrics,
      recommendations,
    };
  }

  private async checkTypeScriptStrict(): Promise<boolean> {
    try {
      const tsconfigPath = path.join(this.projectPath, 'tsconfig.json');
      const content = await fs.readFile(tsconfigPath, 'utf-8');
      const tsconfig = JSON.parse(content);

      const strict = tsconfig.compilerOptions?.strict === true;

      if (!strict) {
        this.issues.push({
          id: `ts-strict-${Date.now()}`,
          severity: 'high',
          category: 'quality',
          file: 'tsconfig.json',
          message: 'TypeScript strict mode is not enabled',
          suggestion: 'Enable "strict": true in compilerOptions',
        });
      }

      return strict;
    } catch {
      this.issues.push({
        id: `ts-config-${Date.now()}`,
        severity: 'critical',
        category: 'quality',
        file: 'tsconfig.json',
        message: 'Could not read or parse tsconfig.json',
      });
      return false;
    }
  }

  private async findTypeScriptFiles(): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Skip node_modules, dist, and hidden directories
          if (entry.isDirectory()) {
            if (!['node_modules', 'dist', '.git', '.next', 'coverage'].includes(entry.name)) {
              await walk(fullPath);
            }
          } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
            files.push(fullPath);
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    await walk(this.projectPath);
    return files;
  }

  private async analyzeFile(filePath: string): Promise<FileMetrics> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const linesOfCode = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*');
    }).length;

    // Count functions and classes
    const functionMatches = content.match(/(?:function\s+\w+|(?:async\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{)/g) || [];
    const classMatches = content.match(/class\s+\w+/g) || [];
    const importMatches = content.match(/import\s+/g) || [];
    const exportMatches = content.match(/export\s+/g) || [];

    // Check for error handling
    const hasErrorHandling = content.includes('try {') || content.includes('catch (') || content.includes('.catch(');

    // Check for type annotations
    const hasTypeAnnotations = content.includes(': string') ||
                               content.includes(': number') ||
                               content.includes(': boolean') ||
                               content.includes(': void') ||
                               content.includes('interface ') ||
                               content.includes('type ');

    // Simple complexity calculation (cyclomatic complexity approximation)
    const complexity = this.calculateComplexity(content);

    // Check for code quality issues in this file
    await this.checkFileQuality(filePath, content);

    return {
      file: path.relative(this.projectPath, filePath),
      lines: lines.length,
      linesOfCode,
      complexity,
      functions: functionMatches.length,
      classes: classMatches.length,
      imports: importMatches.length,
      exports: exportMatches.length,
      hasErrorHandling,
      hasTypeAnnotations,
      duplicateBlocks: 0, // Will be updated by duplicate detection
    };
  }

  private calculateComplexity(content: string): number {
    // Count decision points for cyclomatic complexity
    const patterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bswitch\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\?\./g,  // Optional chaining
      /\?\?/g,  // Nullish coalescing
      /&&/g,
      /\|\|/g,
    ];

    let complexity = 1; // Base complexity
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  private async checkFileQuality(filePath: string, content: string): Promise<void> {
    const relativePath = path.relative(this.projectPath, filePath);

    // Check for console.log (should use proper logging)
    const consoleMatches = content.match(/console\.(log|debug|info)\(/g);
    if (consoleMatches && consoleMatches.length > 3) {
      this.issues.push({
        id: `console-${Date.now()}-${Math.random()}`,
        severity: 'low',
        category: 'quality',
        file: relativePath,
        message: `Found ${consoleMatches.length} console statements - consider using a proper logger`,
        suggestion: 'Replace console.log with a structured logging library',
      });
    }

    // Check for any type usage
    const anyMatches = content.match(/:\s*any\b/g);
    if (anyMatches && anyMatches.length > 0) {
      this.issues.push({
        id: `any-type-${Date.now()}-${Math.random()}`,
        severity: 'medium',
        category: 'quality',
        file: relativePath,
        message: `Found ${anyMatches.length} usages of 'any' type - reduces type safety`,
        suggestion: 'Replace any with specific types or unknown',
      });
    }

    // Check for TODO/FIXME comments
    const todoMatches = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi);
    if (todoMatches && todoMatches.length > 0) {
      this.issues.push({
        id: `todo-${Date.now()}-${Math.random()}`,
        severity: 'info',
        category: 'maintainability',
        file: relativePath,
        message: `Found ${todoMatches.length} TODO/FIXME comments`,
      });
    }

    // Check for very long files
    const lineCount = content.split('\n').length;
    if (lineCount > 500) {
      this.issues.push({
        id: `long-file-${Date.now()}-${Math.random()}`,
        severity: 'medium',
        category: 'maintainability',
        file: relativePath,
        message: `File has ${lineCount} lines - consider splitting into smaller modules`,
        suggestion: 'Break down into smaller, focused modules',
      });
    }

    // Check for very long functions (simple heuristic)
    const functionBodies = content.match(/(?:function\s+\w+|=>\s*)\s*\{[^}]{2000,}\}/g);
    if (functionBodies) {
      this.issues.push({
        id: `long-function-${Date.now()}-${Math.random()}`,
        severity: 'medium',
        category: 'maintainability',
        file: relativePath,
        message: 'Found very long function(s) - consider refactoring',
        suggestion: 'Extract logic into smaller, focused functions',
      });
    }
  }

  private async runESLintAnalysis(): Promise<void> {
    try {
      // Try to run eslint if available
      const { stdout } = await execAsync(
        `cd "${this.projectPath}" && npx eslint . --ext .ts,.tsx --format json 2>/dev/null || true`,
        { maxBuffer: 10 * 1024 * 1024 }
      );

      if (stdout.trim()) {
        try {
          const results = JSON.parse(stdout);
          for (const file of results) {
            for (const msg of file.messages || []) {
              this.issues.push({
                id: `eslint-${Date.now()}-${Math.random()}`,
                severity: msg.severity === 2 ? 'high' : 'medium',
                category: 'quality',
                file: path.relative(this.projectPath, file.filePath),
                line: msg.line,
                column: msg.column,
                message: msg.message,
                rule: msg.ruleId,
              });
            }
          }
        } catch {
          // ESLint output wasn't valid JSON
        }
      }
    } catch {
      // ESLint not available or failed
    }
  }

  private async checkSecurityPatterns(): Promise<void> {
    for (const fm of this.fileMetrics) {
      const filePath = path.join(this.projectPath, fm.file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');

        // Check for hardcoded secrets
        if (content.match(/(?:password|secret|api_key|apikey|token)\s*[:=]\s*['"][^'"]+['"]/i)) {
          this.issues.push({
            id: `secret-${Date.now()}-${Math.random()}`,
            severity: 'critical',
            category: 'security',
            file: fm.file,
            message: 'Possible hardcoded secret or credential detected',
            suggestion: 'Use environment variables for sensitive data',
          });
        }

        // Check for SQL injection vulnerabilities
        // Match template strings in query() calls that interpolate variables
        // Exclude safe patterns:
        //   - $${paramIndex} - building parameter placeholders
        //   - ${setClauses} - joining pre-built column assignments
        //   - ${updates} - joining pre-built updates
        const sqlInjectionPattern = /query\s*\(\s*`[^`]*\$\{(?!paramIndex|index|\$|setClauses|updates)/;
        if (content.match(sqlInjectionPattern)) {
          this.issues.push({
            id: `sql-injection-${Date.now()}-${Math.random()}`,
            severity: 'critical',
            category: 'security',
            file: fm.file,
            message: 'Possible SQL injection vulnerability - string interpolation in query',
            suggestion: 'Use parameterized queries with $1, $2, etc.',
          });
        }

        // Check for dangerous code execution patterns
        // Skip security analysis files to avoid false positives on pattern definitions
        const isSecurityAnalyzer = fm.file.includes('quality-analyzer') ||
                                   fm.file.includes('security-check');

        if (!isSecurityAnalyzer) {
          // Check for dangerous dynamic code execution patterns
          // Only flag actual usage, not regex patterns or string literals
          this.checkDangerousCodeExecution(fm.file, content);
        }

        // Check for innerHTML (XSS risk) - skip security analyzer files
        if (!isSecurityAnalyzer && content.includes('.innerHTML')) {
          this.issues.push({
            id: `xss-${Date.now()}-${Math.random()}`,
            severity: 'high',
            category: 'security',
            file: fm.file,
            message: 'Usage of innerHTML can lead to XSS vulnerabilities',
            suggestion: 'Use textContent or sanitize HTML input',
          });
        }
      } catch {
        // File not readable
      }
    }
  }

  private async checkErrorHandling(): Promise<void> {
    for (const fm of this.fileMetrics) {
      // Skip test files - they use assertions for error checking
      const isTestFile = fm.file.includes('.test.') ||
                         fm.file.includes('.spec.') ||
                         fm.file.includes('/tests/') ||
                         fm.file.includes('/__tests__/');

      if (!isTestFile && !fm.hasErrorHandling && fm.functions > 3) {
        this.issues.push({
          id: `no-error-handling-${Date.now()}-${Math.random()}`,
          severity: 'medium',
          category: 'quality',
          file: fm.file,
          message: 'File has multiple functions but no error handling',
          suggestion: 'Add try-catch blocks for error-prone operations',
        });
      }
    }
  }

  private async detectDuplicateCode(): Promise<void> {
    // Simple duplicate detection - check for repeated code blocks
    const codeBlocks = new Map<string, string[]>();

    for (const fm of this.fileMetrics) {
      const filePath = path.join(this.projectPath, fm.file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        // Extract 5-line blocks
        for (let i = 0; i < lines.length - 5; i++) {
          const block = lines.slice(i, i + 5)
            .map(l => l.trim())
            .filter(l => l.length > 10)
            .join('\n');

          if (block.length > 50) {
            const files = codeBlocks.get(block) || [];
            files.push(fm.file);
            codeBlocks.set(block, files);
          }
        }
      } catch {
        // File not readable
      }
    }

    // Find duplicates
    let duplicateCount = 0;
    for (const [_block, files] of codeBlocks) {
      if (files.length > 1) {
        duplicateCount++;
        if (duplicateCount <= 5) { // Only report first 5
          this.issues.push({
            id: `duplicate-${Date.now()}-${Math.random()}`,
            severity: 'low',
            category: 'maintainability',
            file: files[0],
            message: `Duplicate code block found in ${files.length} files`,
            suggestion: 'Extract common code into a shared utility',
          });
        }
      }
    }
  }

  private calculateErrorHandlingCoverage(): number {
    // Exclude test files from error handling coverage calculation
    const nonTestFiles = this.fileMetrics.filter(f => {
      const isTestFile = f.file.includes('.test.') ||
                         f.file.includes('.spec.') ||
                         f.file.includes('/tests/') ||
                         f.file.includes('/__tests__/');
      return !isTestFile;
    });

    if (nonTestFiles.length === 0) return 100;
    const filesWithErrorHandling = nonTestFiles.filter(f => f.hasErrorHandling).length;
    return (filesWithErrorHandling / nonTestFiles.length) * 100;
  }

  private calculateSecurityScore(): number {
    const securityIssues = this.issues.filter(i => i.category === 'security');
    const criticalCount = securityIssues.filter(i => i.severity === 'critical').length;
    const highCount = securityIssues.filter(i => i.severity === 'high').length;

    // Start at 100 and deduct based on issues
    let score = 100;
    score -= criticalCount * 25;
    score -= highCount * 10;

    return Math.max(0, score);
  }

  private calculateMaintainabilityIndex(avgComplexity: number, totalLinesOfCode: number): number {
    // Simplified maintainability index
    // Based on: https://docs.microsoft.com/en-us/visualstudio/code-quality/code-metrics-values

    const volumeMetric = Math.log(totalLinesOfCode + 1);
    const complexityPenalty = Math.min(avgComplexity / 10, 1);

    let index = 100;
    index -= volumeMetric * 5;
    index -= complexityPenalty * 20;

    // Deduct for maintainability issues
    const maintainabilityIssues = this.issues.filter(i => i.category === 'maintainability');
    index -= maintainabilityIssues.length * 2;

    return Math.max(0, Math.min(100, index));
  }

  private calculateDuplicatePercent(): number {
    const duplicateIssues = this.issues.filter(i => i.message.includes('Duplicate'));
    // Rough estimate - each duplicate affects ~1% of codebase
    return Math.min(duplicateIssues.length * 1, 30);
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const issueCounts = {
      critical: this.issues.filter(i => i.severity === 'critical').length,
      high: this.issues.filter(i => i.severity === 'high').length,
      medium: this.issues.filter(i => i.severity === 'medium').length,
      security: this.issues.filter(i => i.category === 'security').length,
      quality: this.issues.filter(i => i.category === 'quality').length,
    };

    if (issueCounts.critical > 0) {
      recommendations.push(`CRITICAL: Address ${issueCounts.critical} critical issues immediately`);
    }

    if (issueCounts.security > 0) {
      recommendations.push(`SECURITY: Fix ${issueCounts.security} security vulnerabilities before deployment`);
    }

    if (issueCounts.high > 0) {
      recommendations.push(`HIGH PRIORITY: Resolve ${issueCounts.high} high-severity issues`);
    }

    const anyTypeIssues = this.issues.filter(i => i.message.includes("'any' type"));
    if (anyTypeIssues.length > 0) {
      recommendations.push('Improve type safety by replacing `any` types with specific types');
    }

    const filesWithoutErrorHandling = this.fileMetrics.filter(f => !f.hasErrorHandling && f.functions > 3);
    if (filesWithoutErrorHandling.length > 0) {
      recommendations.push(`Add error handling to ${filesWithoutErrorHandling.length} files with multiple functions`);
    }

    const highComplexityFiles = this.fileMetrics.filter(f => f.complexity > 30);
    if (highComplexityFiles.length > 0) {
      recommendations.push(`Refactor ${highComplexityFiles.length} high-complexity files to improve maintainability`);
    }

    if (this.fileMetrics.some(f => f.lines > 500)) {
      recommendations.push('Consider splitting large files into smaller, focused modules');
    }

    return recommendations;
  }

  /**
   * Check for dangerous dynamic code execution patterns
   */
  private checkDangerousCodeExecution(file: string, content: string): void {
    // Split content into lines to check context
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Skip lines that are comments or within regex/string definitions
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
        continue;
      }

      // Check for eval() - but not in regex patterns (/eval/) or strings ('eval', "eval")
      // Use word boundary to avoid false positives on "Retrieval", "evaluate", etc.
      if (/(?<![a-zA-Z])eval\s*\(/.test(line) || /^eval\s*\(/.test(trimmedLine)) {
        // Double-check it's not in a string or regex
        const evalMatch = line.match(/eval\s*\(/);
        if (evalMatch) {
          const beforeMatch = line.substring(0, evalMatch.index);
          // Count quotes to see if we're inside a string
          const singleQuotes = (beforeMatch.match(/'/g) || []).length;
          const doubleQuotes = (beforeMatch.match(/"/g) || []).length;
          const backticks = (beforeMatch.match(/`/g) || []).length;

          // If odd number of any quotes, we're inside a string
          if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0 && backticks % 2 === 0) {
            // Not in a string - this is actual eval usage
            if (!beforeMatch.includes('/')) {  // Not a regex
              this.issues.push({
                id: `dangerous-eval-${Date.now()}-${Math.random()}`,
                severity: 'critical',
                category: 'security',
                file,
                line: lineNum,
                message: 'Dangerous dynamic code execution detected',
                suggestion: 'Avoid dynamic code execution - use JSON.parse() for data or safer alternatives',
              });
            }
          }
        }
      }
    }
  }

  private calculateOverallScore(
    tsStrict: boolean,
    errorHandlingCoverage: number,
    securityScore: number,
    maintainabilityIndex: number,
    duplicatePercent: number
  ): number {
    // Weighted average of all metrics
    let score = 0;

    // TypeScript strict (15% weight)
    score += tsStrict ? 15 : 0;

    // Error handling coverage (20% weight)
    score += (errorHandlingCoverage / 100) * 20;

    // Security score (30% weight) - most important
    score += (securityScore / 100) * 30;

    // Maintainability (20% weight)
    score += (maintainabilityIndex / 100) * 20;

    // Duplicate code penalty (15% weight)
    score += ((100 - duplicatePercent) / 100) * 15;

    return Math.round(score);
  }
}
