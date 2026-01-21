/**
 * Workflow Engine
 * Connects all Eklavya components into an end-to-end autonomous system.
 *
 * Responsibilities:
 * - Triggers architect phase on project creation
 * - Generates tasks from architect output
 * - Spawns agents via orchestrator
 * - Handles approval gates
 * - Progresses through phases automatically
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { getDatabase } from '../../lib/database.js';
import { AgentManager, createAgentManager } from '../agent-manager/index.js';
import { MessageBus, createMessageBus } from '../message-bus/index.js';
import { Orchestrator, createOrchestrator, TaskDefinition } from '../orchestrator/index.js';
import { ArchitectAgent, createArchitectAgent, ArchitectReviewResult, ArchitectSuccessCriteria, DEFAULT_SUCCESS_CRITERIA } from '../architect-agent/index.js';
import { getDemoService, DemoType, Demo } from '../demos/index.js';
import { getApprovalService, ApprovalDecision, NextAction, ApprovalRequest } from '../demos/approval.js';
import { getLearningSystem } from '../learning/index.js';
import { getNotificationService, NotificationLevel } from '../notifications/index.js';
import { getActivityService } from '../activity/index.js';
import { getProgressService } from '../progress/index.js';
import type { Project, AgentType, EklavyaConfig, Task } from '../../types/index.js';

export type WorkflowPhase =
  | 'planning'
  | 'architect'
  | 'approval_pending'
  | 'demo_building'
  | 'demo_ready'
  | 'demo_approved'
  | 'building'
  | 'testing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DemoPhase = 'wow' | 'trust' | 'milestone' | 'final';

export interface ArchitectOutput {
  id: string;
  projectId: string;
  architecture: {
    overview: string;
    techStack: string[];
    components: Array<{
      name: string;
      description: string;
      files: string[];
      dependencies: string[];
    }>;
    dataFlow: string;
    securityConsiderations: string[];
  };
  taskBreakdown: TaskDefinition[];
  estimatedEffort: {
    totalHours: number;
    phases: Array<{
      name: string;
      hours: number;
      tasks: number;
    }>;
  };
  risks: Array<{
    description: string;
    severity: 'low' | 'medium' | 'high';
    mitigation: string;
  }>;
  reviewResult?: ArchitectReviewResult;
  createdAt: Date;
}

export interface BuildResult {
  success: boolean;
  tasksCompleted: number;
  tasksFailed: number;
  duration: number;
  artifacts: string[];
  errors: string[];
}

export interface WorkflowEngineOptions {
  config: EklavyaConfig;
  projectsDir?: string;
  maxRetries?: number;
  autoApprove?: boolean;
}

export interface WorkflowState {
  projectId: string;
  phase: WorkflowPhase;
  demoPhase?: DemoPhase;
  currentDemoId?: string;
  architectOutput?: ArchitectOutput;
  buildResult?: BuildResult;
  error?: string;
  startedAt: Date;
  lastUpdatedAt: Date;
}

/**
 * WorkflowEngine orchestrates the entire project lifecycle from
 * planning through completion.
 */
export class WorkflowEngine extends EventEmitter {
  private config: EklavyaConfig;
  private projectsDir: string;
  private maxRetries: number;
  private autoApprove: boolean;

  private activeWorkflows: Map<string, WorkflowState> = new Map();
  private agentManagers: Map<string, AgentManager> = new Map();
  private messageBuses: Map<string, MessageBus> = new Map();
  private orchestrators: Map<string, Orchestrator> = new Map();

  private cancellationTokens: Map<string, boolean> = new Map();

  constructor(options: WorkflowEngineOptions) {
    super();
    this.config = options.config;
    this.projectsDir = options.projectsDir || path.join(process.cwd(), 'projects');
    this.maxRetries = options.maxRetries || 3;
    this.autoApprove = options.autoApprove || false;
  }

  /**
   * Start the build process for a project
   */
  async startProjectBuild(projectId: string): Promise<void> {
    const db = getDatabase();

    // Verify project exists
    const projectResult = await db.query<Project>(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const project = projectResult.rows[0];

    // Check if workflow already active
    if (this.activeWorkflows.has(projectId)) {
      const state = this.activeWorkflows.get(projectId)!;
      if (!['completed', 'failed', 'cancelled'].includes(state.phase)) {
        throw new Error(`Workflow already active for project ${projectId} in phase: ${state.phase}`);
      }
    }

    // Initialize workflow state
    const state: WorkflowState = {
      projectId,
      phase: 'planning',
      startedAt: new Date(),
      lastUpdatedAt: new Date(),
    };
    this.activeWorkflows.set(projectId, state);
    this.cancellationTokens.set(projectId, false);

    // Create project directory
    const projectDir = path.join(this.projectsDir, projectId);
    await fs.mkdir(projectDir, { recursive: true });

    // Initialize services
    await this.initializeProjectServices(projectId, projectDir);

    // Update project status
    await db.query(
      'UPDATE projects SET status = $1, updated_at = NOW() WHERE id = $2',
      ['planning', projectId]
    );

    // Log activity
    const activityService = getActivityService();
    await activityService.logBuildEvent(projectId, 'started', `Project ${project.name} build started`);

    this.emit('workflow:started', { projectId, phase: 'planning' });

    // Start the workflow pipeline
    try {
      await this.runWorkflowPipeline(projectId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.handleWorkflowError(projectId, errorMessage);
    }
  }

  /**
   * Run the architect phase
   */
  async runArchitectPhase(projectId: string): Promise<ArchitectOutput> {
    const db = getDatabase();
    const state = this.getWorkflowState(projectId);

    if (this.isCancelled(projectId)) {
      throw new Error('Workflow cancelled');
    }

    await this.updatePhase(projectId, 'architect');

    // Get project details
    const projectResult = await db.query<Project>(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    );
    const project = projectResult.rows[0];
    const projectDir = path.join(this.projectsDir, projectId);

    // Create requirements file from project description
    const requirementsPath = path.join(projectDir, 'REQUIREMENTS.md');
    await fs.writeFile(requirementsPath, `# ${project.name}\n\n${project.description || ''}\n`);

    // Initialize architect agent
    const architect = createArchitectAgent({
      projectId,
      projectDir,
      milestone: 'initial_planning',
      requirementsSource: requirementsPath,
    });

    await architect.initialize();
    this.emit('architect:started', { projectId });

    // Run architect review to generate architecture
    const reviewResult = await architect.runReview();

    // Generate task breakdown from review
    const taskBreakdown = this.generateTasksFromReview(reviewResult, project);

    // Create architect output
    const architectOutput: ArchitectOutput = {
      id: uuidv4(),
      projectId,
      architecture: {
        overview: `Architecture for ${project.name}`,
        techStack: this.inferTechStack(project),
        components: this.generateComponentsFromTasks(taskBreakdown),
        dataFlow: 'Client -> API -> Database',
        securityConsiderations: ['Input validation', 'Authentication', 'Authorization'],
      },
      taskBreakdown,
      estimatedEffort: this.estimateEffort(taskBreakdown),
      risks: [
        { description: 'Scope creep', severity: 'medium', mitigation: 'Clear requirements' },
        { description: 'Technical complexity', severity: 'low', mitigation: 'Incremental development' },
      ],
      reviewResult,
      createdAt: new Date(),
    };

    // Store architect output
    await db.query(
      `INSERT INTO architect_outputs (id, project_id, architecture, task_breakdown, estimated_effort, risks, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (project_id) DO UPDATE SET
         architecture = $3, task_breakdown = $4, estimated_effort = $5, risks = $6, created_at = NOW()`,
      [
        architectOutput.id,
        projectId,
        JSON.stringify(architectOutput.architecture),
        JSON.stringify(architectOutput.taskBreakdown),
        JSON.stringify(architectOutput.estimatedEffort),
        JSON.stringify(architectOutput.risks),
      ]
    );

    // Update workflow state
    state.architectOutput = architectOutput;
    state.lastUpdatedAt = new Date();

    this.emit('architect:completed', { projectId, output: architectOutput });

    return architectOutput;
  }

  /**
   * Generate tasks from architect review
   */
  generateTasks(projectId: string, architecture: ArchitectOutput): Task[] {
    const tasks: Task[] = [];

    for (const taskDef of architecture.taskBreakdown) {
      const task: Task = {
        id: taskDef.id || uuidv4(),
        projectId,
        title: taskDef.title,
        description: taskDef.description,
        type: taskDef.type,
        status: 'pending',
        priority: taskDef.priority || 5,
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Run the build phase with parallel agents
   */
  async runBuildPhase(projectId: string, tasks: Task[]): Promise<BuildResult> {
    const state = this.getWorkflowState(projectId);

    if (this.isCancelled(projectId)) {
      throw new Error('Workflow cancelled');
    }

    await this.updatePhase(projectId, 'building');

    const projectDir = path.join(this.projectsDir, projectId);
    const agentManager = this.agentManagers.get(projectId)!;
    const messageBus = this.messageBuses.get(projectId)!;

    // Create orchestrator
    const orchestrator = createOrchestrator({
      projectId,
      projectDir,
      agentManager,
      messageBus,
      maxParallelAgents: this.config.maxConcurrentAgents,
    });

    this.orchestrators.set(projectId, orchestrator);

    await orchestrator.initialize();

    // Convert tasks to task definitions
    const taskDefinitions: TaskDefinition[] = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description || '',
      type: task.type || 'development',
      agentType: this.getAgentTypeForTask(task.type || 'development'),
      priority: task.priority,
      estimatedTokens: 10000,
    }));

    // Create execution plan
    const plan = orchestrator.createExecutionPlan(taskDefinitions);

    this.emit('build:started', { projectId, plan });

    // Execute plan
    const result = await orchestrator.executePlan(plan);

    // Cleanup orchestrator
    await orchestrator.shutdown();
    this.orchestrators.delete(projectId);

    const buildResult: BuildResult = {
      success: result.success,
      tasksCompleted: result.completed,
      tasksFailed: result.failed,
      duration: result.duration,
      artifacts: [],
      errors: result.failed > 0 ? [`${result.failed} tasks failed`] : [],
    };

    state.buildResult = buildResult;
    state.lastUpdatedAt = new Date();

    this.emit('build:completed', { projectId, result: buildResult });

    return buildResult;
  }

  /**
   * Build a demo for the project
   */
  async buildDemo(projectId: string, demoType: DemoPhase): Promise<Demo> {
    const db = getDatabase();
    const state = this.getWorkflowState(projectId);

    if (this.isCancelled(projectId)) {
      throw new Error('Workflow cancelled');
    }

    await this.updatePhase(projectId, 'demo_building');
    state.demoPhase = demoType;

    const demoService = getDemoService();

    // Get project info
    const projectResult = await db.query<Project>(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    );
    const project = projectResult.rows[0];

    // Determine demo config based on type
    const demoConfig = this.getDemoConfig(demoType, state.architectOutput);

    // Create demo record
    const demo = await demoService.createDemo(projectId, {
      type: demoType === 'wow' || demoType === 'trust' ? demoType : 'milestone',
      name: `Demo ${demoType.charAt(0).toUpperCase() + demoType.slice(1)} - ${project.name}`,
      description: `${demoType} demo for ${project.name}`,
      config: demoConfig,
    });

    state.currentDemoId = demo.id;

    // Start building
    await demoService.startBuild(demo.id);

    this.emit('demo:build_started', { projectId, demoId: demo.id, demoType });

    // Filter tasks for this demo phase
    const demoTasks = this.getTasksForDemo(state.architectOutput, demoType);

    // Run build for demo tasks
    const tasks = this.generateTasks(projectId, {
      ...state.architectOutput!,
      taskBreakdown: demoTasks,
    });

    if (tasks.length > 0) {
      await this.runBuildPhase(projectId, tasks);
    }

    // Mark demo as ready
    await demoService.markReady(demo.id);
    await this.updatePhase(projectId, 'demo_ready');

    // Send notification
    const notificationService = getNotificationService();
    await notificationService.createNotification(
      projectId,
      'warning' as NotificationLevel,
      'demo_ready',
      'Demo Ready for Review',
      {
        message: `${demoType} demo is ready for your review.`,
        metadata: { demoId: demo.id, demoType },
      }
    );

    this.emit('demo:ready', { projectId, demoId: demo.id, demoType });

    // Get updated demo
    return demoService.getDemo(demo.id);
  }

  /**
   * Wait for approval decision
   */
  async waitForApproval(projectId: string, demoId: string): Promise<ApprovalRequest> {
    const state = this.getWorkflowState(projectId);
    await this.updatePhase(projectId, 'approval_pending');

    const approvalService = getApprovalService();

    // Request approval
    const request = await approvalService.requestApproval(demoId, 'workflow_engine');

    this.emit('approval:requested', { projectId, demoId, requestId: request.id });

    // If auto-approve is enabled, approve immediately
    if (this.autoApprove) {
      await approvalService.approve(request.id, 'auto_approve', {
        comments: 'Auto-approved by workflow engine',
      });
      return approvalService.getApprovalRequest(request.id);
    }

    // Poll for decision
    const pollInterval = 5000; // 5 seconds
    const maxWaitTime = 24 * 60 * 60 * 1000; // 24 hours
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      if (this.isCancelled(projectId)) {
        throw new Error('Workflow cancelled');
      }

      const currentRequest = await approvalService.getApprovalRequest(request.id);

      if (currentRequest.decision) {
        return currentRequest;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Approval timeout exceeded');
  }

  /**
   * Handle approval decision
   */
  async handleApprovalDecision(projectId: string, decision: ApprovalRequest): Promise<void> {
    const state = this.getWorkflowState(projectId);
    const demoService = getDemoService();

    if (!decision.decision) {
      throw new Error('No decision provided');
    }

    this.emit('approval:decided', { projectId, decision });

    switch (decision.nextAction) {
      case 'proceed_to_build':
        // Skip remaining demos, go to full build
        await this.updatePhase(projectId, 'building');
        break;

      case 'build_next_demo':
        // Continue to next demo phase
        const nextPhase = this.getNextDemoPhase(state.demoPhase);
        if (nextPhase) {
          state.demoPhase = nextPhase;
          await this.buildDemo(projectId, nextPhase);
        } else {
          await this.updatePhase(projectId, 'building');
        }
        break;

      case 'revise_demo':
        // Rebuild current demo with changes
        if (state.currentDemoId) {
          await demoService.updateStatus(state.currentDemoId, 'revision_requested');
        }
        if (state.demoPhase) {
          await this.buildDemo(projectId, state.demoPhase);
        }
        break;

      case 'cancel':
        await this.cancelWorkflow(projectId, 'Cancelled by admin');
        break;

      default:
        // Default to continuing build
        await this.updatePhase(projectId, 'building');
    }
  }

  /**
   * Run the complete workflow pipeline
   */
  private async runWorkflowPipeline(projectId: string): Promise<void> {
    const state = this.getWorkflowState(projectId);

    try {
      // Phase 1: Architect
      const architectOutput = await this.runArchitectPhase(projectId);

      // Phase 2: Demo 0 (Wow Demo)
      const wowDemo = await this.buildDemo(projectId, 'wow');

      // Phase 3: Wait for approval
      const wowApproval = await this.waitForApproval(projectId, wowDemo.id);
      await this.handleApprovalDecision(projectId, wowApproval);

      // Check if we should continue
      if (this.isCancelled(projectId) || state.phase === 'cancelled') {
        return;
      }

      // If not skipping to build, do trust demo
      if (wowApproval.nextAction === 'build_next_demo' && state.phase !== 'building') {
        const trustDemo = await this.buildDemo(projectId, 'trust');
        const trustApproval = await this.waitForApproval(projectId, trustDemo.id);
        await this.handleApprovalDecision(projectId, trustApproval);
      }

      // Check again (state.phase can change externally via cancelWorkflow)
      if (this.isCancelled(projectId) || (state.phase as WorkflowPhase) === 'cancelled') {
        return;
      }

      // Phase 4: Full build (if not already built via demos)
      if (state.phase === 'building' || state.phase === 'demo_approved') {
        const allTasks = this.generateTasks(projectId, architectOutput);
        const buildResult = await this.runBuildPhase(projectId, allTasks);

        if (!buildResult.success) {
          throw new Error(`Build failed: ${buildResult.errors.join(', ')}`);
        }
      }

      // Phase 5: Testing
      await this.updatePhase(projectId, 'testing');
      // Testing would run here

      // Phase 6: Complete
      await this.updatePhase(projectId, 'completed');
      await this.updateProjectStatus(projectId, 'completed');

      // Send completion notification
      const notificationService = getNotificationService();
      await notificationService.createNotification(
        projectId,
        'info' as NotificationLevel,
        'build_success',
        'Project Build Completed',
        {
          message: 'Your project has been successfully built.',
        }
      );

      this.emit('workflow:completed', { projectId, state });

    } catch (error) {
      throw error;
    }
  }

  /**
   * Cancel a running workflow
   */
  async cancelWorkflow(projectId: string, reason?: string): Promise<void> {
    this.cancellationTokens.set(projectId, true);

    const state = this.activeWorkflows.get(projectId);
    if (state) {
      state.phase = 'cancelled';
      state.error = reason || 'Cancelled by user';
      state.lastUpdatedAt = new Date();
    }

    // Cleanup resources
    await this.cleanupProjectResources(projectId);

    await this.updateProjectStatus(projectId, 'cancelled');

    this.emit('workflow:cancelled', { projectId, reason });
  }

  /**
   * Get current workflow state
   */
  getWorkflowState(projectId: string): WorkflowState {
    const state = this.activeWorkflows.get(projectId);
    if (!state) {
      throw new Error(`No active workflow for project: ${projectId}`);
    }
    return state;
  }

  /**
   * Check if workflow is cancelled
   */
  private isCancelled(projectId: string): boolean {
    return this.cancellationTokens.get(projectId) === true;
  }

  /**
   * Initialize project services
   */
  private async initializeProjectServices(projectId: string, projectDir: string): Promise<void> {
    // Create message bus
    const messageBus = createMessageBus({
      redis: this.config.redis,
      projectId,
    });
    await messageBus.connect();
    this.messageBuses.set(projectId, messageBus);

    // Create agent manager
    const agentManager = createAgentManager({
      config: this.config,
      projectId,
      projectDir,
      messageBus,
    });
    await agentManager.start();
    this.agentManagers.set(projectId, agentManager);
  }

  /**
   * Cleanup project resources
   */
  private async cleanupProjectResources(projectId: string): Promise<void> {
    // Stop orchestrator
    const orchestrator = this.orchestrators.get(projectId);
    if (orchestrator) {
      await orchestrator.shutdown();
      this.orchestrators.delete(projectId);
    }

    // Stop agent manager
    const agentManager = this.agentManagers.get(projectId);
    if (agentManager) {
      await agentManager.stop();
      this.agentManagers.delete(projectId);
    }

    // Close message bus
    const messageBus = this.messageBuses.get(projectId);
    if (messageBus) {
      await messageBus.close();
      this.messageBuses.delete(projectId);
    }
  }

  /**
   * Update workflow phase
   */
  private async updatePhase(projectId: string, phase: WorkflowPhase): Promise<void> {
    const state = this.activeWorkflows.get(projectId);
    if (state) {
      state.phase = phase;
      state.lastUpdatedAt = new Date();
    }

    await this.updateProjectStatus(projectId, phase);

    const activityService = getActivityService();
    await activityService.logMilestone(projectId, `Phase: ${phase}`, `Workflow transitioned to ${phase} phase`);

    this.emit('phase:changed', { projectId, phase });
  }

  /**
   * Update project status in database
   */
  private async updateProjectStatus(projectId: string, status: string): Promise<void> {
    const db = getDatabase();
    await db.query(
      'UPDATE projects SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, projectId]
    );
  }

  /**
   * Handle workflow errors
   */
  private async handleWorkflowError(projectId: string, errorMessage: string): Promise<void> {
    const state = this.activeWorkflows.get(projectId);
    if (state) {
      state.phase = 'failed';
      state.error = errorMessage;
      state.lastUpdatedAt = new Date();
    }

    await this.updateProjectStatus(projectId, 'failed');

    // Send error notification
    const notificationService = getNotificationService();
    await notificationService.createNotification(
      projectId,
      'critical' as NotificationLevel,
      'build_failed',
      'Build Failed',
      {
        message: errorMessage,
      }
    );

    await this.cleanupProjectResources(projectId);

    this.emit('workflow:failed', { projectId, error: errorMessage });
  }

  // Helper methods

  private generateTasksFromReview(review: ArchitectReviewResult, project: Project): TaskDefinition[] {
    const tasks: TaskDefinition[] = [];

    // Generate foundation tasks
    tasks.push({
      id: uuidv4(),
      title: 'Set up project structure',
      description: 'Initialize project with necessary configurations and dependencies',
      type: 'setup',
      agentType: 'developer',
      priority: 10,
    });

    // Generate development tasks based on quality recommendations
    for (const rec of review.recommendedFixes.slice(0, 10)) {
      tasks.push({
        id: uuidv4(),
        title: `Fix: ${rec.substring(0, 50)}...`,
        description: rec,
        type: 'development',
        agentType: 'developer',
        priority: 7,
      });
    }

    // Generate testing tasks
    tasks.push({
      id: uuidv4(),
      title: 'Write unit tests',
      description: 'Create comprehensive unit tests for all components',
      type: 'testing',
      agentType: 'tester',
      priority: 8,
      dependencies: [tasks[0].id!],
    });

    // Generate QA tasks
    tasks.push({
      id: uuidv4(),
      title: 'End-to-end testing',
      description: 'Run E2E tests for all user flows',
      type: 'qa',
      agentType: 'qa',
      priority: 6,
      dependencies: [tasks[tasks.length - 1].id!],
    });

    return tasks;
  }

  private inferTechStack(project: Project): string[] {
    // Infer tech stack from project config or use defaults
    const config = project.config as { techStack?: string[] } || {};
    return config.techStack || ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis'];
  }

  private generateComponentsFromTasks(tasks: TaskDefinition[]): ArchitectOutput['architecture']['components'] {
    const componentMap = new Map<string, { files: string[]; deps: string[] }>();

    for (const task of tasks) {
      const componentName = task.type || 'core';
      if (!componentMap.has(componentName)) {
        componentMap.set(componentName, { files: [], deps: [] });
      }
      componentMap.get(componentName)!.files.push(...(task.files || []));
    }

    return Array.from(componentMap.entries()).map(([name, { files, deps }]) => ({
      name,
      description: `${name} component`,
      files,
      dependencies: deps,
    }));
  }

  private estimateEffort(tasks: TaskDefinition[]): ArchitectOutput['estimatedEffort'] {
    const phaseMap = new Map<string, number>();

    for (const task of tasks) {
      const phase = task.type || 'development';
      phaseMap.set(phase, (phaseMap.get(phase) || 0) + 1);
    }

    const hoursPerTask = 2;
    const phases = Array.from(phaseMap.entries()).map(([name, taskCount]) => ({
      name,
      hours: taskCount * hoursPerTask,
      tasks: taskCount,
    }));

    return {
      totalHours: tasks.length * hoursPerTask,
      phases,
    };
  }

  private getAgentTypeForTask(taskType: string): AgentType {
    const typeMap: Record<string, AgentType> = {
      setup: 'developer',
      development: 'developer',
      testing: 'tester',
      qa: 'qa',
      documentation: 'pm',
      deployment: 'sre',
      monitoring: 'monitor',
    };
    return typeMap[taskType] || 'developer';
  }

  private getDemoConfig(demoType: DemoPhase, architecture?: ArchitectOutput) {
    const configs: Record<DemoPhase, { features: string[]; excludedFeatures: string[]; scaffoldingPercent: number; estimatedTime: number; estimatedCost: number }> = {
      wow: {
        features: ['UI mockup', 'Navigation', 'Design system'],
        excludedFeatures: ['Backend', 'Auth', 'Database'],
        scaffoldingPercent: 40,
        estimatedTime: 30,
        estimatedCost: 15,
      },
      trust: {
        features: ['Core feature', 'Data flow', 'Happy path'],
        excludedFeatures: ['Full auth', 'All features', 'Production backend'],
        scaffoldingPercent: 60,
        estimatedTime: 45,
        estimatedCost: 25,
      },
      milestone: {
        features: ['Milestone features'],
        excludedFeatures: ['Remaining features'],
        scaffoldingPercent: 75,
        estimatedTime: 60,
        estimatedCost: 40,
      },
      final: {
        features: ['All features'],
        excludedFeatures: [],
        scaffoldingPercent: 100,
        estimatedTime: 120,
        estimatedCost: 80,
      },
    };
    return configs[demoType];
  }

  private getTasksForDemo(architecture: ArchitectOutput | undefined, demoType: DemoPhase): TaskDefinition[] {
    if (!architecture) return [];

    const tasks = architecture.taskBreakdown;
    const percentage = demoType === 'wow' ? 0.3 : demoType === 'trust' ? 0.5 : demoType === 'milestone' ? 0.75 : 1;

    return tasks.slice(0, Math.ceil(tasks.length * percentage));
  }

  private getNextDemoPhase(currentPhase?: DemoPhase): DemoPhase | null {
    const phases: DemoPhase[] = ['wow', 'trust', 'milestone', 'final'];
    if (!currentPhase) return 'wow';

    const currentIndex = phases.indexOf(currentPhase);
    if (currentIndex === -1 || currentIndex >= phases.length - 1) {
      return null;
    }
    return phases[currentIndex + 1];
  }

  /**
   * Shutdown the workflow engine
   */
  async shutdown(): Promise<void> {
    // Cancel all active workflows
    for (const projectId of this.activeWorkflows.keys()) {
      await this.cancelWorkflow(projectId, 'Engine shutdown');
    }

    this.activeWorkflows.clear();
    this.cancellationTokens.clear();

    this.emit('shutdown');
  }
}

// Factory function
export function createWorkflowEngine(options: WorkflowEngineOptions): WorkflowEngine {
  return new WorkflowEngine(options);
}

// Singleton instance
let workflowEngine: WorkflowEngine | null = null;

export function getWorkflowEngine(options?: WorkflowEngineOptions): WorkflowEngine {
  if (!workflowEngine && options) {
    workflowEngine = new WorkflowEngine(options);
  }
  if (!workflowEngine) {
    throw new Error('Workflow engine not initialized. Call with options first.');
  }
  return workflowEngine;
}
