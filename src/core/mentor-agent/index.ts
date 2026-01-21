/**
 * Mentor Agent - Guidance, Research, and Support
 *
 * Provides assistance to other agents when they are blocked or need help:
 * - Research solutions to technical problems
 * - Query knowledge base for best practices
 * - Suggest alternative approaches
 * - Help debug complex issues
 * - Escalate critical issues to admin
 * - Track guidance effectiveness for RL improvement
 *
 * The Mentor Agent acts as a wise counselor that helps other agents
 * succeed in their tasks while learning what guidance works best.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../lib/database.js';
import { getLearningSystem } from '../learning/index.js';
import { getCache, CacheKeys } from '../../lib/cache.js';
import type { AgentType } from '../../types/index.js';

/**
 * Blocked issue categories
 */
export enum BlockedCategory {
  TECHNICAL = 'technical',           // Code/implementation issue
  DEPENDENCY = 'dependency',         // Missing dependency or version conflict
  PERMISSION = 'permission',         // Access or authorization issue
  RESOURCE = 'resource',             // Resource unavailable
  KNOWLEDGE = 'knowledge',           // Lack of information
  DECISION = 'decision',             // Need architectural/design decision
  EXTERNAL = 'external',             // External service/API issue
  TOOLING = 'tooling',               // Tool or environment issue
}

/**
 * Issue severity affecting escalation
 */
export enum IssueSeverity {
  CRITICAL = 'critical',   // Must be resolved immediately
  HIGH = 'high',           // Important, needs attention soon
  MEDIUM = 'medium',       // Standard priority
  LOW = 'low',             // Can wait
}

/**
 * Guidance types
 */
export enum GuidanceType {
  CODE_EXAMPLE = 'code_example',       // Code snippet or example
  EXPLANATION = 'explanation',         // Conceptual explanation
  DOCUMENTATION = 'documentation',     // Link to docs
  WORKAROUND = 'workaround',           // Temporary solution
  BEST_PRACTICE = 'best_practice',     // Recommended approach
  DEBUGGING = 'debugging',             // Debug steps
  ARCHITECTURE = 'architecture',       // Design guidance
  ESCALATION = 'escalation',           // Escalate to admin
}

/**
 * Blocked issue reported by an agent
 */
export interface BlockedIssue {
  id: string;
  agentId: string;
  agentType: AgentType;
  taskId?: string;
  category: BlockedCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  context: {
    file?: string;
    line?: number;
    code?: string;
    error?: string;
    stackTrace?: string;
    attemptedSolutions?: string[];
    relatedFiles?: string[];
  };
  createdAt: Date;
}

/**
 * Guidance provided by the Mentor Agent
 */
export interface Guidance {
  id: string;
  issueId: string;
  agentId: string;
  type: GuidanceType;
  title: string;
  content: string;
  codeExample?: string;
  links?: Array<{ title: string; url: string }>;
  steps?: string[];
  confidence: number;  // 0-1, how confident the mentor is
  alternativeApproaches?: string[];
  warnings?: string[];
  createdAt: Date;
}

/**
 * Knowledge base entry
 */
export interface KnowledgeEntry {
  id: string;
  category: string;
  topic: string;
  title: string;
  content: string;
  codeExamples?: Array<{
    language: string;
    code: string;
    description: string;
  }>;
  links?: Array<{ title: string; url: string }>;
  tags: string[];
  usageCount: number;
  helpfulnessScore: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Knowledge query result
 */
export interface KnowledgeResult {
  entry: KnowledgeEntry;
  relevanceScore: number;
  matchedTerms: string[];
}

/**
 * Code context for suggestions
 */
export interface CodeContext {
  file: string;
  language: string;
  code: string;
  imports?: string[];
  functions?: string[];
  classes?: string[];
  dependencies?: string[];
}

/**
 * Best practice suggestion
 */
export interface Suggestion {
  id: string;
  category: string;
  title: string;
  description: string;
  rationale: string;
  codeExample?: string;
  priority: 'high' | 'medium' | 'low';
  impact: string;
}

/**
 * Critical issue requiring admin attention
 */
export interface CriticalIssue {
  id: string;
  projectId: string;
  agentId: string;
  originalIssueId: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  impact: string;
  recommendedAction: string;
  deadline?: Date;
  createdAt: Date;
}

/**
 * Mentor agent options
 */
export interface MentorAgentOptions {
  projectId: string;
  projectDir: string;
  knowledgeBasePath?: string;
}

/**
 * Reward values for RL feedback
 */
const REWARDS = {
  guidanceHelpful: 0.5,
  guidancePartiallyHelpful: 0.2,
  guidanceNotHelpful: -0.3,
  issueResolved: 0.6,
  issueNotResolved: -0.2,
  escalationApproved: 0.4,
  escalationRejected: -0.2,
  knowledgeUsed: 0.1,
};

/**
 * Mentor Agent Service
 *
 * Provides guidance and support to other agents, with RL-based
 * improvement of guidance quality over time.
 */
export class MentorAgent extends EventEmitter {
  private projectId: string;
  private projectDir: string;
  private agentId: string;
  private promptId?: string;
  private knowledgeBase: Map<string, KnowledgeEntry> = new Map();
  private pendingGuidance: Map<string, Guidance> = new Map();
  private escalations: Map<string, CriticalIssue> = new Map();

  constructor(options: MentorAgentOptions) {
    super();
    this.projectId = options.projectId;
    this.projectDir = options.projectDir;
    this.agentId = uuidv4();
  }

  /**
   * Initialize the Mentor agent with prompt selection via Thompson Sampling
   */
  async initialize(): Promise<void> {
    try {
      const db = getDatabase();
      const learningSystem = getLearningSystem();

      // Select mentor prompt using Thompson Sampling
      const selectedPrompt = await learningSystem.selectPrompt('mentor');
      this.promptId = selectedPrompt?.id;

      // Create agent record
      await db.query(
        `INSERT INTO agents (id, project_id, type, status, prompt_id, created_at, updated_at)
         VALUES ($1, $2, 'mentor', 'working', $3, NOW(), NOW())`,
        [this.agentId, this.projectId, this.promptId]
      );

      // Load knowledge base
      await this.loadKnowledgeBase();

      this.emit('initialized', {
        agentId: this.agentId,
        promptId: this.promptId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to initialize Mentor agent:`, errorMessage);
      this.emit('error', { phase: 'initialize', error: errorMessage });
      throw error;
    }
  }

  /**
   * Provide guidance for a blocked issue
   */
  async provideGuidance(agentId: string, issue: BlockedIssue): Promise<Guidance> {
    this.emit('guidance:started', { agentId, issueId: issue.id });

    try {
      // Search knowledge base for relevant information
      const knowledgeResults = await this.queryKnowledgeBase(
        `${issue.title} ${issue.description} ${issue.category}`
      );

      // Determine guidance type based on issue category
      const guidanceType = this.determineGuidanceType(issue);

      // Generate guidance content
      const guidance = await this.generateGuidance(issue, knowledgeResults, guidanceType);

      // Store guidance
      await this.storeGuidance(guidance);
      this.pendingGuidance.set(guidance.id, guidance);

      // Check if escalation is needed
      if (this.shouldEscalate(issue, guidance)) {
        await this.escalateToAdmin(this.projectId, {
          ...issue,
          id: uuidv4(),
          projectId: this.projectId,
          originalIssueId: issue.id,
          impact: this.assessImpact(issue),
          recommendedAction: 'Review and provide human guidance',
          createdAt: new Date(),
        });
      }

      this.emit('guidance:provided', guidance);
      return guidance;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('guidance:error', { agentId, issueId: issue.id, error: errorMessage });
      throw error;
    }
  }

  /**
   * Query the knowledge base for relevant entries
   */
  async queryKnowledgeBase(query: string): Promise<KnowledgeResult[]> {
    const cache = getCache();
    const cacheKey = `mentor:kb:${query.slice(0, 50)}`;

    // Check cache first
    const cached = cache.get<KnowledgeResult[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Tokenize query
    const queryTerms = this.tokenize(query);

    // Score all entries
    const results: KnowledgeResult[] = [];

    this.knowledgeBase.forEach((entry) => {
      const { score, matchedTerms } = this.scoreEntry(entry, queryTerms);

      if (score > 0.1) {
        results.push({
          entry,
          relevanceScore: score,
          matchedTerms,
        });

        // Update usage count
        entry.usageCount++;
      }
    });

    // Sort by relevance
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Cache and return top results
    const topResults = results.slice(0, 10);
    cache.set(cacheKey, topResults, 60000); // 1 minute cache

    // Record knowledge usage for RL
    if (topResults.length > 0 && this.promptId) {
      await this.applyReward(REWARDS.knowledgeUsed, {
        type: 'knowledge_used',
        query,
        resultsCount: topResults.length,
        topScore: topResults[0].relevanceScore,
      });
    }

    return topResults;
  }

  /**
   * Suggest best practices for given code context
   */
  async suggestBestPractices(context: CodeContext): Promise<Suggestion[]> {
    this.emit('suggestions:started', { file: context.file });

    const suggestions: Suggestion[] = [];

    // Analyze code patterns
    const patterns = this.analyzeCodePatterns(context);

    // Generate suggestions based on patterns
    for (const pattern of patterns) {
      const suggestion = await this.generateSuggestionForPattern(pattern, context);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    this.emit('suggestions:completed', { file: context.file, count: suggestions.length });
    return suggestions;
  }

  /**
   * Escalate a critical issue to admin
   */
  async escalateToAdmin(projectId: string, issue: CriticalIssue): Promise<void> {
    this.emit('escalation:started', { projectId, issueId: issue.id });

    try {
      const db = getDatabase();

      // Store escalation
      await db.query(
        `INSERT INTO alerts (id, project_id, agent_id, level, type, title, message,
          context, status, created_at)
         VALUES ($1, $2, $3, $4, 'mentor_escalation', $5, $6, $7, 'pending', NOW())`,
        [
          issue.id, projectId, issue.agentId, this.mapSeverityToAlertLevel(issue.severity),
          issue.title, issue.description, JSON.stringify({
            originalIssueId: issue.originalIssueId,
            impact: issue.impact,
            recommendedAction: issue.recommendedAction,
          }),
        ]
      );

      this.escalations.set(issue.id, issue);

      // Apply RL reward for escalation
      await this.applyReward(REWARDS.escalationApproved * 0.5, {
        type: 'escalation_created',
        issueId: issue.id,
        severity: issue.severity,
      });

      this.emit('escalation:created', issue);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('escalation:error', { projectId, issueId: issue.id, error: errorMessage });
      throw error;
    }
  }

  /**
   * Record whether guidance was helpful
   */
  async recordGuidanceOutcome(guidanceId: string, helpful: boolean): Promise<void> {
    const guidance = this.pendingGuidance.get(guidanceId);
    if (!guidance) {
      console.warn(`Guidance ${guidanceId} not found`);
      return;
    }

    try {
      const db = getDatabase();

      // Update guidance record
      await db.query(
        `UPDATE mentor_guidance SET helpful = $1, resolved_at = NOW() WHERE id = $2`,
        [helpful, guidanceId]
      );

      // Apply RL reward
      const reward = helpful ? REWARDS.guidanceHelpful : REWARDS.guidanceNotHelpful;
      await this.applyReward(reward, {
        type: helpful ? 'guidance_helpful' : 'guidance_not_helpful',
        guidanceId,
        guidanceType: guidance.type,
      });

      // Update knowledge base entry helpfulness if we used it
      await this.updateKnowledgeHelpfulness(guidance, helpful);

      this.pendingGuidance.delete(guidanceId);
      this.emit('guidance:outcome', { guidanceId, helpful });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to record guidance outcome:`, errorMessage);
    }
  }

  /**
   * Determine the appropriate guidance type for an issue
   */
  private determineGuidanceType(issue: BlockedIssue): GuidanceType {
    switch (issue.category) {
      case BlockedCategory.TECHNICAL:
        return issue.context.code ? GuidanceType.CODE_EXAMPLE : GuidanceType.DEBUGGING;

      case BlockedCategory.KNOWLEDGE:
        return GuidanceType.EXPLANATION;

      case BlockedCategory.DECISION:
        return GuidanceType.ARCHITECTURE;

      case BlockedCategory.DEPENDENCY:
      case BlockedCategory.TOOLING:
        return GuidanceType.WORKAROUND;

      case BlockedCategory.EXTERNAL:
      case BlockedCategory.RESOURCE:
        return GuidanceType.DOCUMENTATION;

      case BlockedCategory.PERMISSION:
        if (issue.severity === IssueSeverity.CRITICAL) {
          return GuidanceType.ESCALATION;
        }
        return GuidanceType.WORKAROUND;

      default:
        return GuidanceType.EXPLANATION;
    }
  }

  /**
   * Generate guidance content
   */
  private async generateGuidance(
    issue: BlockedIssue,
    knowledgeResults: KnowledgeResult[],
    type: GuidanceType
  ): Promise<Guidance> {
    const guidanceId = uuidv4();

    // Build guidance content based on type and knowledge
    let content = '';
    let codeExample: string | undefined;
    const links: Array<{ title: string; url: string }> = [];
    const steps: string[] = [];
    const alternativeApproaches: string[] = [];
    const warnings: string[] = [];

    // Use knowledge base results
    if (knowledgeResults.length > 0) {
      const topResult = knowledgeResults[0];
      content = `Based on similar issues, here's guidance:\n\n${topResult.entry.content}`;

      if (topResult.entry.codeExamples && topResult.entry.codeExamples.length > 0) {
        codeExample = topResult.entry.codeExamples[0].code;
      }

      if (topResult.entry.links) {
        links.push(...topResult.entry.links);
      }
    }

    // Add type-specific guidance
    switch (type) {
      case GuidanceType.CODE_EXAMPLE:
        content += '\n\nHere is a code example that may help:';
        if (!codeExample && issue.context.code) {
          codeExample = this.generateCodeSuggestion(issue);
        }
        break;

      case GuidanceType.DEBUGGING:
        steps.push('1. Check the error message and stack trace');
        steps.push('2. Verify input values and types');
        steps.push('3. Add logging to trace execution flow');
        steps.push('4. Isolate the problematic code section');
        steps.push('5. Test with simplified inputs');
        break;

      case GuidanceType.EXPLANATION:
        if (!content) {
          content = this.generateExplanation(issue);
        }
        break;

      case GuidanceType.WORKAROUND:
        content += '\n\nPossible workarounds:';
        alternativeApproaches.push(...this.generateWorkarounds(issue));
        break;

      case GuidanceType.BEST_PRACTICE:
        content += '\n\nRecommended best practices:';
        steps.push(...this.generateBestPracticeSteps(issue));
        break;

      case GuidanceType.ARCHITECTURE:
        content += '\n\nArchitectural considerations:';
        warnings.push('This may require broader design review');
        break;

      case GuidanceType.ESCALATION:
        content = 'This issue requires admin attention. Escalating...';
        warnings.push('Escalated to admin for review');
        break;
    }

    // Calculate confidence based on knowledge match
    const confidence = knowledgeResults.length > 0
      ? Math.min(0.9, knowledgeResults[0].relevanceScore + 0.3)
      : 0.4;

    return {
      id: guidanceId,
      issueId: issue.id,
      agentId: issue.agentId,
      type,
      title: `Guidance for: ${issue.title}`,
      content,
      codeExample,
      links: links.length > 0 ? links : undefined,
      steps: steps.length > 0 ? steps : undefined,
      confidence,
      alternativeApproaches: alternativeApproaches.length > 0 ? alternativeApproaches : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      createdAt: new Date(),
    };
  }

  /**
   * Check if issue should be escalated
   */
  private shouldEscalate(issue: BlockedIssue, guidance: Guidance): boolean {
    // Always escalate critical issues
    if (issue.severity === IssueSeverity.CRITICAL) {
      return true;
    }

    // Escalate if confidence is very low
    if (guidance.confidence < 0.3) {
      return true;
    }

    // Escalate permission issues
    if (issue.category === BlockedCategory.PERMISSION) {
      return true;
    }

    // Escalate if multiple attempted solutions failed
    if (issue.context.attemptedSolutions && issue.context.attemptedSolutions.length >= 3) {
      return true;
    }

    return false;
  }

  /**
   * Assess the impact of an issue
   */
  private assessImpact(issue: BlockedIssue): string {
    switch (issue.severity) {
      case IssueSeverity.CRITICAL:
        return 'Project progress blocked. Immediate attention required.';
      case IssueSeverity.HIGH:
        return 'Significant delay possible. Needs resolution within hours.';
      case IssueSeverity.MEDIUM:
        return 'Moderate impact. Can wait for normal review cycle.';
      case IssueSeverity.LOW:
        return 'Minor impact. Can be addressed in next planning session.';
    }
  }

  /**
   * Map severity to alert level
   */
  private mapSeverityToAlertLevel(severity: IssueSeverity): string {
    switch (severity) {
      case IssueSeverity.CRITICAL: return 'critical';
      case IssueSeverity.HIGH: return 'warning';
      case IssueSeverity.MEDIUM: return 'info';
      case IssueSeverity.LOW: return 'info';
    }
  }

  /**
   * Load knowledge base from database
   */
  private async loadKnowledgeBase(): Promise<void> {
    try {
      const db = getDatabase();
      const result = await db.query<KnowledgeEntry>(
        `SELECT * FROM knowledge_base WHERE project_id IS NULL OR project_id = $1
         ORDER BY helpfulness_score DESC LIMIT 1000`,
        [this.projectId]
      );

      for (const row of result.rows) {
        this.knowledgeBase.set(row.id, row);
      }

      this.emit('knowledge:loaded', { count: this.knowledgeBase.size });
    } catch {
      // Table may not exist yet
      console.log('Knowledge base table not found, using defaults');
      this.loadDefaultKnowledge();
    }
  }

  /**
   * Load default knowledge entries
   */
  private loadDefaultKnowledge(): void {
    const defaultEntries: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>[] = [
      {
        category: 'typescript',
        topic: 'error-handling',
        title: 'TypeScript Error Handling Best Practices',
        content: 'Always use try-catch blocks for async operations. Type narrow errors before accessing properties. Use custom error classes for domain-specific errors.',
        codeExamples: [{
          language: 'typescript',
          code: `try {
  const result = await operation();
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  }
}`,
          description: 'Basic error handling pattern',
        }],
        tags: ['typescript', 'error-handling', 'best-practice'],
        usageCount: 0,
        helpfulnessScore: 0.8,
      },
      {
        category: 'nodejs',
        topic: 'database',
        title: 'Database Connection Pooling',
        content: 'Use connection pooling to efficiently manage database connections. Set appropriate pool sizes based on expected load. Always release connections back to the pool.',
        tags: ['nodejs', 'database', 'postgresql', 'performance'],
        usageCount: 0,
        helpfulnessScore: 0.7,
      },
      {
        category: 'testing',
        topic: 'mocking',
        title: 'Mocking External Dependencies',
        content: 'Mock external dependencies in unit tests to isolate the code under test. Use dependency injection to make code more testable.',
        codeExamples: [{
          language: 'typescript',
          code: `jest.mock('./database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] })
}));`,
          description: 'Mocking a database module',
        }],
        tags: ['testing', 'jest', 'mocking'],
        usageCount: 0,
        helpfulnessScore: 0.75,
      },
    ];

    for (const entry of defaultEntries) {
      const id = uuidv4();
      this.knowledgeBase.set(id, {
        ...entry,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  /**
   * Tokenize a query string
   */
  private tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2);
  }

  /**
   * Score a knowledge entry against query terms
   */
  private scoreEntry(
    entry: KnowledgeEntry,
    queryTerms: string[]
  ): { score: number; matchedTerms: string[] } {
    const entryText = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase();
    const matchedTerms: string[] = [];
    let score = 0;

    for (const term of queryTerms) {
      if (entryText.includes(term)) {
        matchedTerms.push(term);
        score += 0.2;

        // Bonus for title match
        if (entry.title.toLowerCase().includes(term)) {
          score += 0.1;
        }

        // Bonus for tag match
        if (entry.tags.some(tag => tag.toLowerCase().includes(term))) {
          score += 0.1;
        }
      }
    }

    // Factor in helpfulness score
    score *= (0.5 + 0.5 * entry.helpfulnessScore);

    return { score: Math.min(1, score), matchedTerms };
  }

  /**
   * Analyze code patterns that might need improvement
   */
  private analyzeCodePatterns(context: CodeContext): string[] {
    const patterns: string[] = [];

    // Check for common issues
    if (context.code.includes('any')) {
      patterns.push('implicit-any');
    }

    if (context.code.includes('console.log')) {
      patterns.push('console-log');
    }

    if (!context.code.includes('try') && context.code.includes('await')) {
      patterns.push('unhandled-async');
    }

    if (context.code.includes('TODO') || context.code.includes('FIXME')) {
      patterns.push('todo-fixme');
    }

    if (context.code.length > 500 && !context.code.includes('/**')) {
      patterns.push('missing-jsdoc');
    }

    return patterns;
  }

  /**
   * Generate suggestion for a code pattern
   */
  private async generateSuggestionForPattern(
    pattern: string,
    context: CodeContext
  ): Promise<Suggestion | null> {
    const suggestions: Record<string, Omit<Suggestion, 'id'>> = {
      'implicit-any': {
        category: 'type-safety',
        title: 'Avoid using `any` type',
        description: 'Replace `any` types with proper TypeScript types for better type safety.',
        rationale: 'Using `any` defeats the purpose of TypeScript and can lead to runtime errors.',
        codeExample: '// Instead of: function process(data: any)\n// Use: function process(data: ProcessedData)',
        priority: 'high',
        impact: 'Improves type safety and catches errors at compile time',
      },
      'console-log': {
        category: 'logging',
        title: 'Use structured logging instead of console.log',
        description: 'Replace console.log statements with a proper logging library.',
        rationale: 'Console.log is not suitable for production. Use structured logging for better observability.',
        priority: 'medium',
        impact: 'Better log management and debugging in production',
      },
      'unhandled-async': {
        category: 'error-handling',
        title: 'Add error handling for async operations',
        description: 'Wrap async/await operations in try-catch blocks.',
        rationale: 'Unhandled promise rejections can crash the application.',
        codeExample: 'try {\n  const result = await operation();\n} catch (error) {\n  handleError(error);\n}',
        priority: 'high',
        impact: 'Prevents unhandled promise rejections and improves reliability',
      },
      'todo-fixme': {
        category: 'maintenance',
        title: 'Address TODO/FIXME comments',
        description: 'TODO and FIXME comments indicate incomplete work that should be addressed.',
        rationale: 'Accumulating TODOs leads to technical debt.',
        priority: 'low',
        impact: 'Reduces technical debt and improves code quality',
      },
      'missing-jsdoc': {
        category: 'documentation',
        title: 'Add JSDoc comments',
        description: 'Add JSDoc comments to document functions and their parameters.',
        rationale: 'Documentation helps other developers understand the code.',
        codeExample: '/**\n * Description of function\n * @param param1 - Description\n * @returns Description of return value\n */',
        priority: 'low',
        impact: 'Improves code maintainability and IDE support',
      },
    };

    const suggestion = suggestions[pattern];
    if (!suggestion) {
      return null;
    }

    return {
      id: uuidv4(),
      ...suggestion,
    };
  }

  /**
   * Generate a code suggestion for an issue
   */
  private generateCodeSuggestion(issue: BlockedIssue): string {
    // Placeholder - in production would use AI to generate contextual suggestions
    return `// Suggested fix for: ${issue.title}\n// Review and adapt as needed`;
  }

  /**
   * Generate explanation for an issue
   */
  private generateExplanation(issue: BlockedIssue): string {
    return `Understanding the issue:\n\n` +
      `Category: ${issue.category}\n` +
      `This type of issue typically occurs when ${this.getCategoryExplanation(issue.category)}.\n\n` +
      `To resolve this, consider reviewing the relevant documentation and verifying your implementation.`;
  }

  /**
   * Get explanation for issue category
   */
  private getCategoryExplanation(category: BlockedCategory): string {
    const explanations: Record<BlockedCategory, string> = {
      [BlockedCategory.TECHNICAL]: 'there is a logical error or incorrect implementation',
      [BlockedCategory.DEPENDENCY]: 'a required package is missing or has version conflicts',
      [BlockedCategory.PERMISSION]: 'access rights are insufficient for the operation',
      [BlockedCategory.RESOURCE]: 'a required resource is unavailable or misconfigured',
      [BlockedCategory.KNOWLEDGE]: 'additional information is needed about a concept or API',
      [BlockedCategory.DECISION]: 'an architectural or design decision needs to be made',
      [BlockedCategory.EXTERNAL]: 'an external service or API is not responding as expected',
      [BlockedCategory.TOOLING]: 'development tools or environment are not configured correctly',
    };
    return explanations[category];
  }

  /**
   * Generate workarounds for an issue
   */
  private generateWorkarounds(issue: BlockedIssue): string[] {
    const workarounds: string[] = [];

    switch (issue.category) {
      case BlockedCategory.DEPENDENCY:
        workarounds.push('Try clearing node_modules and reinstalling: rm -rf node_modules && npm install');
        workarounds.push('Check for conflicting versions in package-lock.json');
        workarounds.push('Consider using a different version of the dependency');
        break;

      case BlockedCategory.EXTERNAL:
        workarounds.push('Implement a fallback mechanism for when the service is unavailable');
        workarounds.push('Use mock data for development while the service is down');
        workarounds.push('Check if there is an alternative API endpoint');
        break;

      case BlockedCategory.RESOURCE:
        workarounds.push('Verify the resource exists and is accessible');
        workarounds.push('Check network connectivity and firewall rules');
        workarounds.push('Try accessing the resource from a different environment');
        break;

      default:
        workarounds.push('Review recent changes that might have caused the issue');
        workarounds.push('Check logs for additional error information');
        workarounds.push('Try reproducing the issue in isolation');
    }

    return workarounds;
  }

  /**
   * Generate best practice steps for an issue
   */
  private generateBestPracticeSteps(issue: BlockedIssue): string[] {
    return [
      'Document the issue and attempted solutions',
      'Isolate the problem to a specific component',
      'Write a failing test that demonstrates the issue',
      'Implement the fix incrementally',
      'Verify the fix with tests',
      'Review for potential side effects',
    ];
  }

  /**
   * Store guidance in database
   */
  private async storeGuidance(guidance: Guidance): Promise<void> {
    const db = getDatabase();
    await db.query(
      `INSERT INTO mentor_guidance (id, issue_id, agent_id, type, title, content,
        code_example, links, steps, confidence, alternatives, warnings, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        guidance.id, guidance.issueId, guidance.agentId, guidance.type,
        guidance.title, guidance.content, guidance.codeExample,
        JSON.stringify(guidance.links), JSON.stringify(guidance.steps),
        guidance.confidence, JSON.stringify(guidance.alternativeApproaches),
        JSON.stringify(guidance.warnings), guidance.createdAt,
      ]
    );
  }

  /**
   * Update knowledge entry helpfulness based on guidance outcome
   */
  private async updateKnowledgeHelpfulness(
    _guidance: Guidance,
    helpful: boolean
  ): Promise<void> {
    // In production, would track which knowledge entries were used
    // and update their helpfulness scores
    const adjustment = helpful ? 0.05 : -0.02;

    this.knowledgeBase.forEach((entry) => {
      if (entry.usageCount > 0) {
        entry.helpfulnessScore = Math.max(0, Math.min(1, entry.helpfulnessScore + adjustment));
        entry.updatedAt = new Date();
      }
    });
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
   * Get agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Get pending guidance count
   */
  getPendingGuidanceCount(): number {
    return this.pendingGuidance.size;
  }

  /**
   * Get active escalations
   */
  getEscalations(): CriticalIssue[] {
    return Array.from(this.escalations.values());
  }
}

/**
 * Factory function to create a Mentor agent
 */
export function createMentorAgent(options: MentorAgentOptions): MentorAgent {
  return new MentorAgent(options);
}

/**
 * Get guidance for a blocked agent
 */
export async function getMentorGuidance(
  projectId: string,
  projectDir: string,
  agentId: string,
  issue: Omit<BlockedIssue, 'id' | 'createdAt'>
): Promise<Guidance> {
  const mentor = createMentorAgent({ projectId, projectDir });
  await mentor.initialize();

  const fullIssue: BlockedIssue = {
    ...issue,
    id: uuidv4(),
    createdAt: new Date(),
  };

  return mentor.provideGuidance(agentId, fullIssue);
}
