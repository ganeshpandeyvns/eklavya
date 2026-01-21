/**
 * Requirements Mapper Module
 *
 * Maps project requirements to implementation:
 * - Parses specification documents
 * - Identifies implemented vs missing features
 * - Calculates requirements coverage
 * - Tracks feature completion status
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface Requirement {
  id: string;
  category: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'implemented' | 'partial' | 'missing' | 'unknown';
  implementedIn: string[];
  coverage: number;
  notes?: string;
}

export interface RequirementsCategory {
  name: string;
  requirements: Requirement[];
  coverage: number;
}

export interface RequirementsReport {
  timestamp: Date;
  projectPath: string;
  specFiles: string[];
  totalRequirements: number;
  implementedRequirements: number;
  partialRequirements: number;
  missingRequirements: number;
  overallCoverage: number;
  categories: RequirementsCategory[];
  criticalMissing: Requirement[];
  recommendations: string[];
}

// Known Eklavya requirements from the spec
const EKLAVYA_REQUIREMENTS: Array<{
  id: string;
  category: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  searchPatterns: string[];
}> = [
  // Core Architecture
  {
    id: 'CORE-001',
    category: 'Core Architecture',
    description: 'Agent Manager for lifecycle management',
    priority: 'critical',
    searchPatterns: ['agent-manager', 'AgentManager', 'spawnAgent', 'terminateAgent'],
  },
  {
    id: 'CORE-002',
    category: 'Core Architecture',
    description: 'Message Bus for inter-agent communication',
    priority: 'critical',
    searchPatterns: ['message-bus', 'MessageBus', 'sendMessage', 'pub/sub'],
  },
  {
    id: 'CORE-003',
    category: 'Core Architecture',
    description: 'Checkpoint system for state persistence',
    priority: 'critical',
    searchPatterns: ['checkpoint', 'CheckpointManager', 'saveCheckpoint', 'restoreCheckpoint'],
  },
  {
    id: 'CORE-004',
    category: 'Core Architecture',
    description: 'Learning system with Thompson Sampling',
    priority: 'critical',
    searchPatterns: ['learning', 'LearningSystem', 'ThompsonSampling', 'selectPrompt'],
  },

  // Database
  {
    id: 'DB-001',
    category: 'Database',
    description: 'PostgreSQL integration with connection pooling',
    priority: 'critical',
    searchPatterns: ['postgresql', 'pg', 'database', 'getDatabase', 'pool'],
  },
  {
    id: 'DB-002',
    category: 'Database',
    description: 'Database migrations system',
    priority: 'high',
    searchPatterns: ['migration', 'migrate', 'schema'],
  },
  {
    id: 'DB-003',
    category: 'Database',
    description: 'Projects table and CRUD operations',
    priority: 'critical',
    searchPatterns: ['projects', 'createProject', 'getProject'],
  },
  {
    id: 'DB-004',
    category: 'Database',
    description: 'Agents table with status tracking',
    priority: 'critical',
    searchPatterns: ['agents', 'agent_type', 'agent status'],
  },
  {
    id: 'DB-005',
    category: 'Database',
    description: 'Tasks table with assignment tracking',
    priority: 'critical',
    searchPatterns: ['tasks', 'task_assign', 'task_complete'],
  },
  {
    id: 'DB-006',
    category: 'Database',
    description: 'Messages table for agent communication',
    priority: 'high',
    searchPatterns: ['messages', 'message_type', 'from_agent_id'],
  },
  {
    id: 'DB-007',
    category: 'Database',
    description: 'Prompts table with RL parameters',
    priority: 'critical',
    searchPatterns: ['prompts', 'alpha', 'beta', 'thompson'],
  },
  {
    id: 'DB-008',
    category: 'Database',
    description: 'RL Outcomes table for learning',
    priority: 'high',
    searchPatterns: ['rl_outcomes', 'reward', 'outcome'],
  },

  // Agent Types
  {
    id: 'AGENT-001',
    category: 'Agent Types',
    description: 'Orchestrator agent for project coordination',
    priority: 'critical',
    searchPatterns: ['orchestrator', 'OrchestratorAgent', 'orchestrator-agent'],
  },
  {
    id: 'AGENT-002',
    category: 'Agent Types',
    description: 'Architect agent for technical design',
    priority: 'high',
    searchPatterns: ['architect', 'ArchitectAgent', 'architect-agent'],
  },
  {
    id: 'AGENT-003',
    category: 'Agent Types',
    description: 'Developer agent for code implementation',
    priority: 'critical',
    searchPatterns: ['developer', 'DeveloperAgent', 'developer-agent'],
  },
  {
    id: 'AGENT-004',
    category: 'Agent Types',
    description: 'Tester agent for test creation/execution',
    priority: 'high',
    searchPatterns: ['tester', 'TesterAgent', 'tester-agent'],
  },
  {
    id: 'AGENT-005',
    category: 'Agent Types',
    description: 'QA agent for E2E validation',
    priority: 'medium',
    searchPatterns: ['qa-agent', 'QAAgent', 'playwright'],
  },
  {
    id: 'AGENT-006',
    category: 'Agent Types',
    description: 'PM agent for requirements management',
    priority: 'medium',
    searchPatterns: ['pm-agent', 'PMAgent', 'requirements'],
  },
  {
    id: 'AGENT-007',
    category: 'Agent Types',
    description: 'Mentor agent for guidance',
    priority: 'medium',
    searchPatterns: ['mentor', 'MentorAgent', 'mentor-agent'],
  },

  // API Layer
  {
    id: 'API-001',
    category: 'API',
    description: 'REST API server',
    priority: 'critical',
    searchPatterns: ['api/index', 'ApiServer', 'http server', 'express'],
  },
  {
    id: 'API-002',
    category: 'API',
    description: 'Projects API endpoints',
    priority: 'critical',
    searchPatterns: ['/api/projects', 'getProjects', 'createProject'],
  },
  {
    id: 'API-003',
    category: 'API',
    description: 'Agents API endpoints',
    priority: 'high',
    searchPatterns: ['/api/agents', 'getAgents', 'agent endpoint'],
  },
  {
    id: 'API-004',
    category: 'API',
    description: 'Dashboard API endpoints',
    priority: 'high',
    searchPatterns: ['/api/dashboard', 'getDashboardStats', 'dashboard'],
  },
  {
    id: 'API-005',
    category: 'API',
    description: 'WebSocket server for real-time updates',
    priority: 'high',
    searchPatterns: ['websocket', 'WebSocketService', 'ws server'],
  },

  // Frontend
  {
    id: 'UI-001',
    category: 'Frontend',
    description: 'Next.js dashboard application',
    priority: 'high',
    searchPatterns: ['next.config', 'app/page', 'Next.js'],
  },
  {
    id: 'UI-002',
    category: 'Frontend',
    description: 'Project management UI',
    priority: 'high',
    searchPatterns: ['projects page', 'project list', 'ProjectCard'],
  },
  {
    id: 'UI-003',
    category: 'Frontend',
    description: 'Real-time agent status display',
    priority: 'high',
    searchPatterns: ['agent status', 'useWebSocket', 'real-time'],
  },
  {
    id: 'UI-004',
    category: 'Frontend',
    description: 'Dashboard with statistics',
    priority: 'high',
    searchPatterns: ['dashboard', 'stats', 'useDashboardStats'],
  },

  // RL Learning
  {
    id: 'RL-001',
    category: 'Reinforcement Learning',
    description: 'Thompson Sampling for prompt selection',
    priority: 'critical',
    searchPatterns: ['thompson', 'beta distribution', 'selectPrompt'],
  },
  {
    id: 'RL-002',
    category: 'Reinforcement Learning',
    description: 'Reward signal processing',
    priority: 'critical',
    searchPatterns: ['reward', 'recordOutcome', 'updatePrompt'],
  },
  {
    id: 'RL-003',
    category: 'Reinforcement Learning',
    description: 'Prompt version management',
    priority: 'high',
    searchPatterns: ['prompt version', 'experimental', 'candidate', 'production'],
  },
  {
    id: 'RL-004',
    category: 'Reinforcement Learning',
    description: 'Exploration vs exploitation balance',
    priority: 'medium',
    searchPatterns: ['exploration', 'explorationRate', 'candidateRate'],
  },

  // Testing
  {
    id: 'TEST-001',
    category: 'Testing',
    description: 'Unit test framework setup',
    priority: 'high',
    searchPatterns: ['vitest', 'jest', 'test(', 'describe('],
  },
  {
    id: 'TEST-002',
    category: 'Testing',
    description: 'E2E test framework setup',
    priority: 'medium',
    searchPatterns: ['playwright', 'e2e', 'browser test'],
  },
  {
    id: 'TEST-003',
    category: 'Testing',
    description: 'Demo verification tests',
    priority: 'high',
    searchPatterns: ['demo-tester', 'verification', 'success criteria'],
  },

  // Security
  {
    id: 'SEC-001',
    category: 'Security',
    description: 'Environment variable configuration',
    priority: 'critical',
    searchPatterns: ['process.env', 'dotenv', 'environment'],
  },
  {
    id: 'SEC-002',
    category: 'Security',
    description: 'Parameterized database queries',
    priority: 'critical',
    searchPatterns: ['$1', 'parameterized', 'query('],
  },
  {
    id: 'SEC-003',
    category: 'Security',
    description: 'Input validation',
    priority: 'high',
    searchPatterns: ['validate', 'sanitize', 'input check'],
  },

  // DevOps
  {
    id: 'OPS-001',
    category: 'DevOps',
    description: 'Docker configuration',
    priority: 'medium',
    searchPatterns: ['Dockerfile', 'docker-compose', 'container'],
  },
  {
    id: 'OPS-002',
    category: 'DevOps',
    description: 'Development scripts',
    priority: 'high',
    searchPatterns: ['npm run', 'package.json scripts', 'dev server'],
  },
];

export class RequirementsMapper {
  private projectPath: string;
  private codebaseContent: Map<string, string> = new Map();

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async analyze(): Promise<RequirementsReport> {
    console.log('Starting requirements mapping...');

    // Load all source files for searching
    await this.loadCodebase();

    // Find spec files
    const specFiles = await this.findSpecFiles();

    // Map each requirement to implementation
    const requirements: Requirement[] = [];

    for (const req of EKLAVYA_REQUIREMENTS) {
      const mappedReq = await this.mapRequirement(req);
      requirements.push(mappedReq);
    }

    // Group by category
    const categories = this.groupByCategory(requirements);

    // Calculate statistics
    const implemented = requirements.filter(r => r.status === 'implemented').length;
    const partial = requirements.filter(r => r.status === 'partial').length;
    const missing = requirements.filter(r => r.status === 'missing').length;

    const overallCoverage = requirements.length > 0
      ? ((implemented + (partial * 0.5)) / requirements.length) * 100
      : 0;

    // Find critical missing
    const criticalMissing = requirements.filter(
      r => r.priority === 'critical' && (r.status === 'missing' || r.status === 'partial')
    );

    // Generate recommendations
    const recommendations = this.generateRecommendations(requirements, criticalMissing);

    return {
      timestamp: new Date(),
      projectPath: this.projectPath,
      specFiles,
      totalRequirements: requirements.length,
      implementedRequirements: implemented,
      partialRequirements: partial,
      missingRequirements: missing,
      overallCoverage: Math.round(overallCoverage * 10) / 10,
      categories,
      criticalMissing,
      recommendations,
    };
  }

  private async loadCodebase(): Promise<void> {
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
            const ext = path.extname(entry.name);
            if (['.ts', '.tsx', '.js', '.jsx', '.json', '.sql', '.md'].includes(ext)) {
              try {
                const content = await fs.readFile(fullPath, 'utf-8');
                this.codebaseContent.set(path.relative(this.projectPath, fullPath), content);
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

  private async findSpecFiles(): Promise<string[]> {
    const specFiles: string[] = [];
    const specPatterns = [
      'EKLAVYA_COMPLETE_SPEC.md',
      'AGENT_PROMPTS.md',
      'eklavya.md',
      'CLAUDE.md',
      'README.md',
      'DEMO2_EXECUTION_PLAN.md',
      'MILESTONES.md',
    ];

    for (const [filePath] of this.codebaseContent) {
      for (const pattern of specPatterns) {
        if (filePath.endsWith(pattern)) {
          specFiles.push(filePath);
        }
      }
    }

    return specFiles;
  }

  private async mapRequirement(req: {
    id: string;
    category: string;
    description: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    searchPatterns: string[];
  }): Promise<Requirement> {
    const implementedIn: string[] = [];
    let totalMatches = 0;

    // Search for each pattern in the codebase
    for (const [filePath, content] of this.codebaseContent) {
      const lowerContent = content.toLowerCase();
      let fileMatches = 0;

      for (const pattern of req.searchPatterns) {
        if (lowerContent.includes(pattern.toLowerCase())) {
          fileMatches++;
        }
      }

      if (fileMatches > 0) {
        implementedIn.push(filePath);
        totalMatches += fileMatches;
      }
    }

    // Calculate coverage based on pattern matches
    const coverage = Math.min(
      (totalMatches / (req.searchPatterns.length * 2)) * 100,
      100
    );

    // Determine status
    let status: Requirement['status'];
    if (coverage >= 75 && implementedIn.length >= 1) {
      status = 'implemented';
    } else if (coverage >= 25 || implementedIn.length >= 1) {
      status = 'partial';
    } else {
      status = 'missing';
    }

    return {
      id: req.id,
      category: req.category,
      description: req.description,
      priority: req.priority,
      status,
      implementedIn,
      coverage: Math.round(coverage),
      notes: implementedIn.length > 0
        ? `Found in ${implementedIn.length} file(s)`
        : 'Not found in codebase',
    };
  }

  private groupByCategory(requirements: Requirement[]): RequirementsCategory[] {
    const categoryMap = new Map<string, Requirement[]>();

    for (const req of requirements) {
      const existing = categoryMap.get(req.category) || [];
      existing.push(req);
      categoryMap.set(req.category, existing);
    }

    const categories: RequirementsCategory[] = [];

    for (const [name, reqs] of categoryMap) {
      const implemented = reqs.filter(r => r.status === 'implemented').length;
      const partial = reqs.filter(r => r.status === 'partial').length;
      const coverage = ((implemented + (partial * 0.5)) / reqs.length) * 100;

      categories.push({
        name,
        requirements: reqs,
        coverage: Math.round(coverage * 10) / 10,
      });
    }

    // Sort by coverage (lowest first to highlight areas needing work)
    categories.sort((a, b) => a.coverage - b.coverage);

    return categories;
  }

  private generateRecommendations(
    requirements: Requirement[],
    criticalMissing: Requirement[]
  ): string[] {
    const recommendations: string[] = [];

    // Critical missing requirements
    if (criticalMissing.length > 0) {
      recommendations.push(
        `CRITICAL: ${criticalMissing.length} critical requirements need implementation`
      );
      for (const req of criticalMissing.slice(0, 3)) {
        recommendations.push(`  - ${req.id}: ${req.description}`);
      }
    }

    // Categories with low coverage
    const lowCoverageCategories = this.groupByCategory(requirements)
      .filter(c => c.coverage < 50);

    if (lowCoverageCategories.length > 0) {
      recommendations.push(
        `Focus on these categories with low coverage:`
      );
      for (const cat of lowCoverageCategories.slice(0, 3)) {
        recommendations.push(`  - ${cat.name}: ${cat.coverage}% coverage`);
      }
    }

    // High priority partial implementations
    const highPartial = requirements.filter(
      r => r.priority === 'high' && r.status === 'partial'
    );

    if (highPartial.length > 0) {
      recommendations.push(
        `Complete ${highPartial.length} high-priority partial implementations`
      );
    }

    // Overall progress
    const implemented = requirements.filter(r => r.status === 'implemented').length;
    const total = requirements.length;
    const progress = Math.round((implemented / total) * 100);

    if (progress < 60) {
      recommendations.push(
        `Overall progress at ${progress}% - accelerate implementation`
      );
    } else if (progress >= 80) {
      recommendations.push(
        `Good progress at ${progress}% - focus on completing remaining items`
      );
    }

    return recommendations;
  }
}
