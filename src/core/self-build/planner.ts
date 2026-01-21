/**
 * Execution Plan Generator
 * Demo₈: Self-Build Test
 *
 * Generates execution plans for self-build runs:
 * - Task breakdown based on project requirements
 * - Phase organization with dependencies
 * - Agent type mapping
 * - Duration estimation
 */

import { EventEmitter } from 'events';
import { SelfBuildConfig } from './index.js';

export type TaskType = 'architecture' | 'development' | 'testing' | 'qa' | 'documentation';
export type AgentType = 'orchestrator' | 'architect' | 'developer' | 'tester' | 'qa' | 'pm' | 'uat' | 'sre' | 'monitor' | 'mentor';

export interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  agentType: AgentType;
  priority: number;
  dependencies: string[];
  estimatedDurationMs: number;
  specification?: string;
}

export interface ExecutionPhase {
  phaseNumber: number;
  tasks: TaskDefinition[];
  parallelizable: boolean;
  estimatedDurationMs: number;
}

export interface ExecutionPlan {
  id: string;
  projectId: string;
  phases: ExecutionPhase[];
  totalTasks: number;
  estimatedDurationMs: number;
  createdAt: Date;
}

/**
 * ExecutionPlanGenerator creates execution plans from project configurations.
 */
export class ExecutionPlanGenerator extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Generate an execution plan for a project.
   */
  async generatePlan(projectId: string, config: SelfBuildConfig): Promise<ExecutionPlan> {
    if (!projectId) {
      throw new Error('projectId is required');
    }
    if (!config.projectName) {
      throw new Error('projectName is required in config');
    }

    const planId = this.generateId();
    const phases: ExecutionPhase[] = [];

    // Phase 1: Architecture (sequential)
    const phase1Tasks: TaskDefinition[] = [
      {
        id: this.generateUUID(),
        title: 'Design system architecture',
        description: `Design the overall system architecture for ${config.projectName}`,
        type: 'architecture',
        agentType: 'architect',
        priority: 1,
        dependencies: [],
        estimatedDurationMs: 5 * 60 * 1000, // 5 minutes
        specification: this.generateArchitectureSpec(config),
      },
    ];

    phases.push({
      phaseNumber: 1,
      tasks: phase1Tasks,
      parallelizable: false,
      estimatedDurationMs: this.sumDurations(phase1Tasks),
    });

    // Phase 2: Development (parallel where possible)
    const scaffoldingTaskId = this.generateUUID();
    const phase2Tasks: TaskDefinition[] = [
      {
        id: scaffoldingTaskId,
        title: 'Create project scaffolding',
        description: `Set up project structure and configuration for ${config.projectName}`,
        type: 'development',
        agentType: 'developer',
        priority: 1,
        dependencies: [phase1Tasks[0].id],
        estimatedDurationMs: 5 * 60 * 1000,
      },
    ];

    // Add feature implementation tasks
    for (const feature of config.features) {
      phase2Tasks.push({
        id: this.generateUUID(),
        title: `Implement: ${feature}`,
        description: `Implement the feature: ${feature}`,
        type: 'development',
        agentType: 'developer',
        priority: 2,
        dependencies: [scaffoldingTaskId],
        estimatedDurationMs: this.estimateFeatureDuration(feature),
        specification: this.generateFeatureSpec(feature, config),
      });
    }

    // Add integration task that depends on all features
    const featureTaskIds = phase2Tasks.slice(1).map(t => t.id);
    phase2Tasks.push({
      id: this.generateUUID(),
      title: 'Integrate features',
      description: 'Integrate all implemented features together',
      type: 'development',
      agentType: 'developer',
      priority: 3,
      dependencies: featureTaskIds,
      estimatedDurationMs: 10 * 60 * 1000, // 10 minutes
    });

    phases.push({
      phaseNumber: 2,
      tasks: phase2Tasks,
      parallelizable: true,
      estimatedDurationMs: this.sumDurations(phase2Tasks),
    });

    // Phase 3: Testing (sequential with parallel unit tests)
    const integrationTaskId = phase2Tasks[phase2Tasks.length - 1].id;
    const phase3Tasks: TaskDefinition[] = [
      {
        id: this.generateUUID(),
        title: 'Write unit tests',
        description: 'Create unit tests for all components',
        type: 'testing',
        agentType: 'tester',
        priority: 1,
        dependencies: [integrationTaskId],
        estimatedDurationMs: 10 * 60 * 1000,
      },
      {
        id: this.generateUUID(),
        title: 'Run test suite',
        description: 'Execute all unit tests',
        type: 'testing',
        agentType: 'tester',
        priority: 2,
        dependencies: [], // Will be set after unit tests task
        estimatedDurationMs: 5 * 60 * 1000,
      },
    ];

    // Set dependency for running tests
    phase3Tasks[1].dependencies = [phase3Tasks[0].id];

    phases.push({
      phaseNumber: 3,
      tasks: phase3Tasks,
      parallelizable: false,
      estimatedDurationMs: this.sumDurations(phase3Tasks),
    });

    // Phase 4: QA (sequential)
    const testRunTaskId = phase3Tasks[phase3Tasks.length - 1].id;
    const phase4Tasks: TaskDefinition[] = [
      {
        id: this.generateUUID(),
        title: 'Run E2E tests',
        description: 'Execute end-to-end tests to validate user flows',
        type: 'qa',
        agentType: 'qa',
        priority: 1,
        dependencies: [testRunTaskId],
        estimatedDurationMs: 5 * 60 * 1000,
      },
      {
        id: this.generateUUID(),
        title: 'Final verification',
        description: 'Perform final verification and quality check',
        type: 'qa',
        agentType: 'qa',
        priority: 2,
        dependencies: [], // Will be set
        estimatedDurationMs: 5 * 60 * 1000,
      },
    ];

    phase4Tasks[1].dependencies = [phase4Tasks[0].id];

    phases.push({
      phaseNumber: 4,
      tasks: phase4Tasks,
      parallelizable: false,
      estimatedDurationMs: this.sumDurations(phase4Tasks),
    });

    const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);
    const totalDuration = phases.reduce((sum, p) => sum + p.estimatedDurationMs, 0);

    const plan: ExecutionPlan = {
      id: planId,
      projectId,
      phases,
      totalTasks,
      estimatedDurationMs: totalDuration,
      createdAt: new Date(),
    };

    this.emit('plan:created', plan);
    return plan;
  }

  /**
   * Validate an execution plan.
   */
  validatePlan(plan: ExecutionPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const taskIds = new Set<string>();

    // Collect all task IDs
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if (taskIds.has(task.id)) {
          errors.push(`Duplicate task ID: ${task.id}`);
        }
        taskIds.add(task.id);
      }
    }

    // Validate dependencies
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        for (const depId of task.dependencies) {
          if (!taskIds.has(depId)) {
            errors.push(`Task ${task.id} has invalid dependency: ${depId}`);
          }
          // Check for circular dependencies (simple check)
          if (depId === task.id) {
            errors.push(`Task ${task.id} has circular dependency on itself`);
          }
        }
      }
    }

    // Validate phase ordering
    for (let i = 0; i < plan.phases.length; i++) {
      if (plan.phases[i].phaseNumber !== i + 1) {
        errors.push(`Phase ${i + 1} has incorrect phase number: ${plan.phases[i].phaseNumber}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Estimate the topological order for task execution.
   */
  getExecutionOrder(tasks: TaskDefinition[]): TaskDefinition[] {
    const taskMap = new Map<string, TaskDefinition>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // Initialize
    for (const task of tasks) {
      taskMap.set(task.id, task);
      inDegree.set(task.id, 0);
      adjacency.set(task.id, []);
    }

    // Build dependency graph
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (taskMap.has(depId)) {
          adjacency.get(depId)!.push(task.id);
          inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
        }
      }
    }

    // Topological sort using Kahn's algorithm
    const queue: string[] = [];
    for (const [taskId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    const result: TaskDefinition[] = [];
    while (queue.length > 0) {
      // Sort by priority (higher priority first)
      queue.sort((a, b) => {
        const taskA = taskMap.get(a)!;
        const taskB = taskMap.get(b)!;
        return taskA.priority - taskB.priority;
      });

      const taskId = queue.shift()!;
      result.push(taskMap.get(taskId)!);

      for (const neighbor of adjacency.get(taskId) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    return result;
  }

  /**
   * Get tasks that can be executed in parallel.
   */
  getParallelizableTasks(tasks: TaskDefinition[], completedTaskIds: Set<string>): TaskDefinition[] {
    return tasks.filter(task => {
      // Task must not be completed
      if (completedTaskIds.has(task.id)) {
        return false;
      }
      // All dependencies must be completed
      return task.dependencies.every(depId => completedTaskIds.has(depId));
    });
  }

  /**
   * Generate a unique ID (UUID v4 format).
   */
  private generateId(): string {
    return this.generateUUID();
  }

  /**
   * Generate a UUID v4.
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Sum durations of tasks.
   */
  private sumDurations(tasks: TaskDefinition[]): number {
    return tasks.reduce((sum, task) => sum + task.estimatedDurationMs, 0);
  }

  /**
   * Estimate duration for a feature based on complexity.
   */
  private estimateFeatureDuration(feature: string): number {
    const lowerFeature = feature.toLowerCase();

    // Complex features take longer
    if (lowerFeature.includes('auth') || lowerFeature.includes('payment') || lowerFeature.includes('database')) {
      return 15 * 60 * 1000; // 15 minutes
    }

    // Medium complexity
    if (lowerFeature.includes('api') || lowerFeature.includes('persist') || lowerFeature.includes('export')) {
      return 10 * 60 * 1000; // 10 minutes
    }

    // Simple features
    return 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Generate architecture specification.
   */
  private generateArchitectureSpec(config: SelfBuildConfig): string {
    return `
# Architecture Specification for ${config.projectName}

## Overview
${config.projectDescription}

## Technology Stack
${config.techStack.map(t => `- ${t}`).join('\n')}

## Features to Implement
${config.features.map(f => `- ${f}`).join('\n')}

## Design Requirements
1. Clean, modular architecture
2. Clear separation of concerns
3. Well-defined interfaces between components
4. Comprehensive error handling
5. Logging and observability

## Deliverables
1. High-level architecture diagram
2. Component breakdown
3. Interface definitions
4. Data flow description
`.trim();
  }

  /**
   * Generate feature specification.
   */
  private generateFeatureSpec(feature: string, config: SelfBuildConfig): string {
    return `
# Feature Specification: ${feature}

## Project Context
${config.projectName}: ${config.projectDescription}

## Feature Description
Implement: ${feature}

## Technology Stack
${config.techStack.map(t => `- ${t}`).join('\n')}

## Requirements
1. Implement the core functionality
2. Add appropriate error handling
3. Include input validation
4. Write clean, documented code
5. Follow project coding standards

## Acceptance Criteria
1. Feature works as described
2. No regressions in existing functionality
3. Code passes linting
4. Basic tests included
`.trim();
  }
}

// Factory function
export function createPlanGenerator(): ExecutionPlanGenerator {
  return new ExecutionPlanGenerator();
}
