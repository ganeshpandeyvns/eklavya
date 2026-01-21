import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { getDatabase } from '../lib/database.js';
import type { Agent, Task, Message, Project } from '../types/index.js';
import {
  authenticate,
  optionalAuthenticate,
  applySecurityHeaders,
  cors,
  rateLimit,
  smartRateLimit,
  checkBodySize,
  parseBodyWithLimit,
  validateContentType,
  sanitizeObject,
  getRateLimiterForMethod,
  isHeavyEndpoint,
  isAuthEndpoint,
  authorizeEndpoint,
  getAuthorizationAuditLog,
  RATE_LIMIT_CONFIGS,
  type AuthenticatedRequest
} from '../middleware/index.js';
import {
  login,
  refresh,
  logout,
  getCurrentUser,
  changePassword
} from './auth.js';
import {
  getDashboardStats,
  getProjectActivity,
  getAgentStats,
  getProjectAgentsLive,
  getPromptStats,
  getProjectTimeline,
} from './dashboard.js';
import {
  listAllTasks,
  getTaskById,
  assignTaskToAgent,
  completeTask,
  failTask,
  retryTask,
  getTaskQueueStats,
  getNextTask,
  createTaskEnhanced,
  cancelTask,
} from './tasks.js';
import {
  getOrchestratorStatus,
  startOrchestrator,
  stopOrchestrator,
  submitPlan,
  forceAgentCheckpoint,
  resumeAgentFromCheckpoint,
  getAgentMessages,
  sendMessageToAgent,
  getCheckpointStats,
  getAgentCheckpoints,
  getExecutionLogs,
} from './orchestrator.js';
import {
  spawnAgent as spawnAgentLifecycle,
  terminateAgent as terminateAgentLifecycle,
  killAgent,
  restartAgent,
  getAgentProcess,
  getAgentHealth,
  getAgentResources,
  recordAgentResources,
  getManagerStatus,
  spawnAllAgents,
  terminateAllAgents,
  getAggregateResources as getAggregateResourcesLifecycle,
  garbageCollect,
  startManager,
  stopManager,
  getAgentHealthHistory,
  getAgentResourceHistory,
} from './lifecycle.js';
import { createCoordinator, AgentCoordinator } from '../core/coordination/index.js';
import { getNotificationService, NotificationLevel } from '../core/notifications/index.js';
import { getActivityService, ActivityEventType } from '../core/activity/index.js';
import { getProgressService } from '../core/progress/index.js';
import { getDemoService, DemoType, DemoStatus } from '../core/demos/index.js';
import { getApprovalService, ApprovalDecision } from '../core/demos/approval.js';
import { getVerificationService } from '../core/demos/verification.js';
import { getFeedbackService, FeedbackSentiment, FeedbackCategory } from '../core/demos/feedback.js';
import {
  getProjectCosts,
  getProjectBudget,
  updateProjectBudget,
  getCostEvents,
  getDailyCosts,
  getCostByAgentType,
  getCostOverview,
  getBudgetAlerts,
  acknowledgeBudgetAlert,
  recordCostEvent,
  getModelPricing,
} from './costs.js';
import {
  getAggregateLearningMetrics,
  getPromptPerformance,
  getPromptComparison,
  getPromptTrend,
  listExperiments,
  createExperiment,
  getExperimentResults,
  stopExperiment,
  getAllPromptComparisons,
} from './learning-metrics.js';
import { getSelfBuildManager, SelfBuildConfig, SelfBuildStatus } from '../core/self-build/index.js';
import { getAllSampleProjects, getSampleProject, createSimulatedConfig } from '../core/self-build/sample-projects.js';
import {
  startBuild,
  getWorkflowState,
  cancelWorkflow,
  resumeWorkflow,
  getActiveWorkflows,
  getWorkflowStats,
  enableAutoTrigger,
  disableAutoTrigger,
  getAutoTriggerStatus,
} from './workflow.js';

export interface ApiServerOptions {
  port: number;
  host?: string;
}

type RouteHandler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>;

export class ApiServer {
  private server: ReturnType<typeof createServer>;
  private routes: Map<string, Map<string, RouteHandler>> = new Map();

  constructor(options: ApiServerOptions) {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Authentication routes (no auth required)
    this.route('POST', '/api/auth/login', this.loginHandler);
    this.route('POST', '/api/auth/refresh', this.refreshHandler);
    this.route('POST', '/api/auth/logout', this.logoutHandler);
    this.route('GET', '/api/auth/me', this.getCurrentUserHandler);
    this.route('POST', '/api/auth/change-password', this.changePasswordHandler);

    // Authorization audit (admin only)
    this.route('GET', '/api/auth/audit', this.getAuthAuditHandler);

    // Projects
    this.route('GET', '/api/projects', this.listProjects);
    this.route('GET', '/api/projects/:id', this.getProject);
    this.route('POST', '/api/projects', this.createProject);

    // Agents
    this.route('GET', '/api/projects/:projectId/agents', this.listAgents);
    this.route('GET', '/api/agents/:id', this.getAgent);
    this.route('POST', '/api/projects/:projectId/agents', this.spawnAgent);
    this.route('DELETE', '/api/agents/:id', this.terminateAgent);

    // Tasks - using new enhanced handlers
    this.route('GET', '/api/projects/:projectId/tasks', this.listTasks);
    // Note: /api/tasks/:id replaced by /api/tasks/:taskId in Demo₃ routes below
    this.route('POST', '/api/projects/:projectId/tasks', this.createTask);
    this.route('PATCH', '/api/tasks/:id', this.updateTask);

    // Messages
    this.route('GET', '/api/projects/:projectId/messages', this.listMessages);
    this.route('POST', '/api/projects/:projectId/messages', this.sendMessage);

    // Health
    this.route('GET', '/api/health', this.healthCheck);

    // Dashboard endpoints
    this.route('GET', '/api/dashboard/stats', this.getDashboardStats);
    this.route('GET', '/api/projects/:projectId/activity', this.getProjectActivity);
    this.route('GET', '/api/agents/:agentId/stats', this.getAgentStats);
    this.route('GET', '/api/projects/:projectId/agents/live', this.getProjectAgentsLive);
    this.route('GET', '/api/prompts/:agentType/stats', this.getPromptStats);
    this.route('GET', '/api/projects/:projectId/timeline', this.getProjectTimeline);

    // Demo₃: Task execution endpoints
    this.route('GET', '/api/tasks', this.listAllTasksHandler);
    this.route('GET', '/api/tasks/queue/stats', this.getTaskQueueStatsHandler);
    this.route('GET', '/api/tasks/queue/next', this.getNextTaskHandler);
    this.route('POST', '/api/tasks', this.createTaskEnhancedHandler);
    this.route('GET', '/api/tasks/:taskId', this.getTaskByIdHandler);
    this.route('PUT', '/api/tasks/:taskId/assign', this.assignTaskHandler);
    this.route('PUT', '/api/tasks/:taskId/complete', this.completeTaskHandler);
    this.route('PUT', '/api/tasks/:taskId/fail', this.failTaskHandler);
    this.route('POST', '/api/tasks/:taskId/retry', this.retryTaskHandler);
    this.route('DELETE', '/api/tasks/:taskId', this.cancelTaskHandler);

    // Demo₃: Orchestrator endpoints
    this.route('GET', '/api/orchestrator/status', this.getOrchestratorStatusHandler);
    this.route('POST', '/api/orchestrator/start', this.startOrchestratorHandler);
    this.route('POST', '/api/orchestrator/stop', this.stopOrchestratorHandler);
    this.route('POST', '/api/orchestrator/plan', this.submitPlanHandler);

    // Demo₃: Agent checkpoint/message endpoints
    this.route('POST', '/api/agents/:agentId/checkpoint', this.forceAgentCheckpointHandler);
    this.route('POST', '/api/agents/:agentId/resume', this.resumeAgentHandler);
    this.route('GET', '/api/agents/:agentId/messages', this.getAgentMessagesHandler);
    this.route('POST', '/api/agents/:agentId/message', this.sendMessageToAgentHandler);

    // Demo₃: Checkpoint endpoints
    this.route('GET', '/api/checkpoints', this.getCheckpointStatsHandler);
    this.route('GET', '/api/checkpoints/:agentId', this.getAgentCheckpointsHandler);

    // Demo₃: Execution logs
    this.route('GET', '/api/execution-logs', this.getExecutionLogsHandler);

    // Demo₄: Agent Lifecycle Management
    this.route('POST', '/api/agents/:agentId/spawn', this.spawnAgentLifecycleHandler);
    this.route('POST', '/api/agents/:agentId/terminate', this.terminateAgentLifecycleHandler);
    this.route('POST', '/api/agents/:agentId/kill', this.killAgentHandler);
    this.route('POST', '/api/agents/:agentId/restart', this.restartAgentHandler);
    this.route('GET', '/api/agents/:agentId/process', this.getAgentProcessHandler);
    this.route('GET', '/api/agents/:agentId/health', this.getAgentHealthHandler);
    this.route('GET', '/api/agents/:agentId/resources', this.getAgentResourcesHandler);
    this.route('POST', '/api/agents/:agentId/resources', this.recordAgentResourcesHandler);
    this.route('GET', '/api/agents/:agentId/health-history', this.getAgentHealthHistoryHandler);
    this.route('GET', '/api/agents/:agentId/resource-history', this.getAgentResourceHistoryHandler);

    // Demo₄: Agent Manager endpoints
    this.route('GET', '/api/agent-manager/status', this.getManagerStatusHandler);
    this.route('POST', '/api/agent-manager/spawn-all', this.spawnAllAgentsHandler);
    this.route('POST', '/api/agent-manager/terminate-all', this.terminateAllAgentsHandler);
    this.route('GET', '/api/agent-manager/resources', this.getAggregateResourcesHandler);
    this.route('POST', '/api/agent-manager/gc', this.garbageCollectHandler);
    this.route('POST', '/api/agent-manager/start', this.startManagerHandler);
    this.route('POST', '/api/agent-manager/stop', this.stopManagerHandler);

    // Demo₅: Multi-Agent Coordination
    this.route('POST', '/api/coordination/:projectId/initialize', this.initializeCoordinationHandler);
    this.route('POST', '/api/coordination/:projectId/spawn-multiple', this.spawnMultipleAgentsHandler);
    this.route('GET', '/api/coordination/:projectId/agents', this.getCoordinatedAgentsHandler);
    this.route('GET', '/api/coordination/:projectId/status', this.getCoordinationStatusHandler);
    this.route('GET', '/api/coordination/:projectId/can-spawn', this.canSpawnAgentHandler);
    this.route('POST', '/api/coordination/:projectId/assign', this.assignTasksHandler);
    this.route('POST', '/api/coordination/:projectId/route-task', this.routeTaskHandler);
    this.route('POST', '/api/coordination/:projectId/rebalance', this.rebalanceTasksHandler);
    this.route('DELETE', '/api/coordination/:projectId/agents/:agentId', this.terminateCoordinatedAgentHandler);

    // Demo₅: File Locks
    this.route('POST', '/api/coordination/:projectId/locks/acquire', this.acquireLockHandler);
    this.route('DELETE', '/api/coordination/:projectId/locks/:lockId', this.releaseLockHandler);
    this.route('GET', '/api/coordination/:projectId/locks', this.getLocksHandler);
    this.route('POST', '/api/coordination/:projectId/locks/check', this.checkLockHandler);

    // Demo₅: Conflicts
    this.route('GET', '/api/coordination/:projectId/conflicts', this.getConflictsHandler);
    this.route('POST', '/api/coordination/:projectId/conflicts/detect', this.detectConflictHandler);
    this.route('POST', '/api/coordination/:projectId/conflicts/:conflictId/resolve', this.resolveConflictHandler);

    // Demo₅: Messaging
    this.route('POST', '/api/coordination/:projectId/relay', this.relayMessageHandler);

    // Demo₆: Notifications
    this.route('GET', '/api/notifications', this.getNotificationsHandler);
    this.route('GET', '/api/notifications/unread', this.getUnreadCountHandler);
    this.route('POST', '/api/notifications/:notificationId/read', this.markNotificationReadHandler);
    this.route('POST', '/api/notifications/:notificationId/acknowledge', this.acknowledgeNotificationHandler);
    this.route('DELETE', '/api/notifications/:notificationId', this.deleteNotificationHandler);
    this.route('POST', '/api/notifications', this.createNotificationHandler);

    // Demo₆: Activity Stream
    this.route('GET', '/api/activity/recent', this.getRecentActivityHandler);
    this.route('GET', '/api/projects/:projectId/activity-stream', this.getProjectActivityStreamHandler);
    this.route('GET', '/api/activity/stats', this.getActivityStatsHandler);
    this.route('POST', '/api/activity', this.logActivityHandler);

    // Demo₆: Progress Tracking
    this.route('GET', '/api/projects/:projectId/progress', this.getProjectProgressHandler);
    this.route('GET', '/api/progress/all', this.getAllProgressHandler);
    this.route('POST', '/api/projects/:projectId/progress/snapshot', this.saveProgressSnapshotHandler);
    this.route('GET', '/api/projects/:projectId/progress/history', this.getProgressHistoryHandler);

    // Demo₆: Notification Settings
    this.route('GET', '/api/settings/notifications', this.getNotificationSettingsHandler);
    this.route('PUT', '/api/settings/notifications', this.updateNotificationSettingsHandler);
    this.route('PUT', '/api/settings/availability', this.updateAvailabilityHandler);

    // Demo₇: Demo Management
    this.route('GET', '/api/projects/:projectId/demos', this.listDemosHandler);
    this.route('GET', '/api/demos/:demoId', this.getDemoHandler);
    this.route('POST', '/api/projects/:projectId/demos', this.createDemoHandler);
    this.route('PUT', '/api/demos/:demoId', this.updateDemoHandler);
    this.route('DELETE', '/api/demos/:demoId', this.deleteDemoHandler);
    this.route('POST', '/api/demos/:demoId/build', this.startDemoBuildHandler);
    this.route('POST', '/api/demos/:demoId/ready', this.markReadyHandler);
    this.route('POST', '/api/demos/:demoId/archive', this.archiveDemoHandler);
    this.route('POST', '/api/demos/:demoId/preview', this.setPreviewHandler);
    this.route('DELETE', '/api/demos/:demoId/preview', this.clearPreviewHandler);
    this.route('GET', '/api/demos/stats', this.getDemoStatsHandler);

    // Demo₇: Approval Workflow
    this.route('GET', '/api/approvals/pending', this.getPendingApprovalsHandler);
    this.route('GET', '/api/demos/:demoId/approval', this.getDemoApprovalHandler);
    this.route('POST', '/api/demos/:demoId/request-approval', this.requestApprovalHandler);
    this.route('POST', '/api/approvals/:requestId/approve', this.approveDemoHandler);
    this.route('POST', '/api/approvals/:requestId/request-changes', this.requestChangesHandler);
    this.route('POST', '/api/approvals/:requestId/skip-to-build', this.skipToBuildHandler);
    this.route('POST', '/api/approvals/:requestId/reject', this.rejectDemoHandler);
    this.route('GET', '/api/demos/:demoId/approval-history', this.getApprovalHistoryHandler);

    // Demo₇: Demo Verification
    this.route('POST', '/api/demos/:demoId/verify', this.verifyDemoHandler);
    this.route('GET', '/api/demos/:demoId/verification', this.getLatestVerificationHandler);
    this.route('GET', '/api/demos/:demoId/verification-history', this.getVerificationHistoryHandler);

    // Demo₇: Client Feedback
    this.route('GET', '/api/demos/:demoId/feedback', this.listFeedbackHandler);
    this.route('POST', '/api/demos/:demoId/feedback', this.addFeedbackHandler);
    this.route('GET', '/api/feedback/:feedbackId', this.getFeedbackHandler);
    this.route('PUT', '/api/feedback/:feedbackId', this.updateFeedbackHandler);
    this.route('POST', '/api/feedback/:feedbackId/process', this.processFeedbackHandler);
    this.route('POST', '/api/feedback/:feedbackId/resolve', this.resolveFeedbackHandler);
    this.route('DELETE', '/api/feedback/:feedbackId', this.deleteFeedbackHandler);
    this.route('GET', '/api/demos/:demoId/feedback-summary', this.getFeedbackSummaryHandler);

    // Demo₇: Scaffolding
    this.route('GET', '/api/projects/:projectId/scaffolding', this.getProjectScaffoldingHandler);
    this.route('GET', '/api/demos/:demoId/scaffolding', this.getDemoScaffoldingHandler);

    // Demo₈: Self-Build Test
    this.route('POST', '/api/projects/:projectId/self-build', this.startSelfBuildHandler);
    this.route('GET', '/api/self-build/:runId', this.getSelfBuildRunHandler);
    this.route('GET', '/api/self-build/:runId/plan', this.getSelfBuildPlanHandler);
    this.route('POST', '/api/self-build/:runId/plan', this.createSelfBuildPlanHandler);
    this.route('POST', '/api/self-build/:runId/execute', this.executeSelfBuildHandler);
    this.route('GET', '/api/self-build/:runId/progress', this.getSelfBuildProgressHandler);
    this.route('GET', '/api/self-build/:runId/phases', this.getSelfBuildPhasesHandler);
    this.route('DELETE', '/api/self-build/:runId', this.cancelSelfBuildHandler);
    this.route('GET', '/api/projects/:projectId/self-builds', this.listSelfBuildRunsHandler);
    this.route('POST', '/api/self-build/run-full', this.runFullSelfBuildHandler);

    // Demo₈: Sample Projects
    this.route('GET', '/api/sample-projects', this.listSampleProjectsHandler);
    this.route('GET', '/api/sample-projects/:name', this.getSampleProjectHandler);

    // Workflow Engine
    this.route('POST', '/api/projects/:projectId/build', this.startBuildHandler);
    this.route('GET', '/api/projects/:projectId/workflow', this.getWorkflowStateHandler);
    this.route('POST', '/api/projects/:projectId/workflow/cancel', this.cancelWorkflowHandler);
    this.route('POST', '/api/projects/:projectId/workflow/resume', this.resumeWorkflowHandler);
    this.route('GET', '/api/workflow/active', this.getActiveWorkflowsHandler);
    this.route('GET', '/api/workflow/stats', this.getWorkflowStatsHandler);
    this.route('POST', '/api/workflow/auto-trigger/enable', this.enableAutoTriggerHandler);
    this.route('POST', '/api/workflow/auto-trigger/disable', this.disableAutoTriggerHandler);
    this.route('GET', '/api/workflow/auto-trigger/status', this.getAutoTriggerStatusHandler);

    // Production: Cost Tracking
    this.route('GET', '/api/projects/:projectId/costs', this.getProjectCostsHandler);
    this.route('GET', '/api/projects/:projectId/budget', this.getProjectBudgetHandler);
    this.route('PUT', '/api/projects/:projectId/budget', this.updateProjectBudgetHandler);
    this.route('GET', '/api/projects/:projectId/cost-events', this.getCostEventsHandler);
    this.route('GET', '/api/projects/:projectId/cost-daily', this.getDailyCostsHandler);
    this.route('GET', '/api/projects/:projectId/cost-by-agent', this.getCostByAgentTypeHandler);
    this.route('POST', '/api/projects/:projectId/cost-event', this.recordCostEventHandler);
    this.route('GET', '/api/costs/overview', this.getCostOverviewHandler);
    this.route('GET', '/api/costs/alerts', this.getBudgetAlertsHandler);
    this.route('POST', '/api/costs/alerts/:alertId/acknowledge', this.acknowledgeBudgetAlertHandler);
    this.route('GET', '/api/costs/pricing', this.getModelPricingHandler);

    // Production: Learning Metrics
    this.route('GET', '/api/learning/metrics', this.getLearningMetricsHandler);
    this.route('GET', '/api/learning/prompts/:promptId', this.getPromptPerformanceHandler);
    this.route('GET', '/api/learning/prompts/:promptId/trend', this.getPromptTrendHandler);
    this.route('GET', '/api/learning/comparison/:agentType', this.getPromptComparisonHandler);
    this.route('GET', '/api/learning/comparisons', this.getAllPromptComparisonsHandler);
    this.route('GET', '/api/learning/experiments', this.listExperimentsHandler);
    this.route('POST', '/api/learning/experiments', this.createExperimentHandler);
    this.route('GET', '/api/learning/experiments/:experimentId', this.getExperimentResultsHandler);
    this.route('POST', '/api/learning/experiments/:experimentId/stop', this.stopExperimentHandler);
  }

  private route(method: string, path: string, handler: RouteHandler): void {
    if (!this.routes.has(method)) {
      this.routes.set(method, new Map());
    }
    this.routes.get(method)!.set(path, handler.bind(this));
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Apply security headers to all responses
    applySecurityHeaders(res);

    // Handle CORS with configurable whitelist
    const corsResult = await cors(req, res);
    if (!corsResult) {
      // CORS handled the response (preflight or denied)
      return;
    }

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);

      // Check request body size for POST/PUT/PATCH requests
      if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
        if (!checkBodySize(req, res)) {
          return;
        }
      }

      // Apply smart rate limiting based on endpoint type
      const rateLimitPassed = await smartRateLimit(req, res);
      if (!rateLimitPassed) {
        return;
      }

      const authReq = req as AuthenticatedRequest;

      // Check if this is a public endpoint (no auth required)
      const publicEndpoints = [
        '/api/health',
        '/api/auth/login',
        '/api/auth/refresh'
      ];

      const isPublicEndpoint = publicEndpoints.some(ep => url.pathname === ep);

      if (isPublicEndpoint) {
        // Use optional authentication for public endpoints
        await optionalAuthenticate(authReq);
      } else {
        // Authenticate request for protected endpoints
        const authPassed = await authenticate(authReq, res);
        if (!authPassed) {
          return;
        }

        // Check endpoint-level authorization
        const authzPassed = await authorizeEndpoint(authReq, res);
        if (!authzPassed) {
          return;
        }
      }

      const methodRoutes = this.routes.get(req.method || 'GET');

      if (!methodRoutes) {
        this.sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      // Match route with params
      for (const [pattern, handler] of methodRoutes) {
        const params = this.matchRoute(pattern, url.pathname);
        if (params !== null) {
          await handler(authReq, res, params);
          return;
        }
      }

      this.sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      console.error('API Error:', error);
      this.sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  private matchRoute(pattern: string, pathname: string): Record<string, string> | null {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');

    if (patternParts.length !== pathParts.length) return null;

    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }

    return params;
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private async parseBody<T>(req: IncomingMessage, res?: ServerResponse): Promise<T> {
    const maxSize = parseInt(process.env.MAX_BODY_SIZE || '1048576', 10);

    return new Promise((resolve, reject) => {
      let body = '';
      let totalSize = 0;
      let limitExceeded = false;

      req.on('data', (chunk: Buffer) => {
        if (limitExceeded) return;

        totalSize += chunk.length;
        if (totalSize > maxSize) {
          limitExceeded = true;
          if (res) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Request body too large',
              code: 'PAYLOAD_TOO_LARGE',
              maxSize
            }));
          }
          reject(new Error('Payload too large'));
          return;
        }

        body += chunk.toString();
      });

      req.on('end', () => {
        if (limitExceeded) return;

        try {
          resolve(JSON.parse(body || '{}') as T);
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });

      req.on('error', reject);
    });
  }

  // Route handlers
  private async healthCheck(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }

  private async listProjects(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const db = getDatabase();
    const result = await db.query<Project>('SELECT * FROM projects ORDER BY created_at DESC');
    this.sendJson(res, 200, result.rows);
  }

  private async getProject(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const db = getDatabase();
    const result = await db.query<Project>('SELECT * FROM projects WHERE id = $1', [params.id]);
    if (result.rows.length === 0) {
      this.sendJson(res, 404, { error: 'Project not found' });
      return;
    }
    this.sendJson(res, 200, result.rows[0]);
  }

  private async createProject(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.parseBody<{ name: string; description?: string }>(req);
    const db = getDatabase();
    const result = await db.query<Project>(
      `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING *`,
      [body.name, body.description || null]
    );
    this.sendJson(res, 201, result.rows[0]);
  }

  private async listAgents(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const db = getDatabase();
    const result = await db.query<Agent>(
      'SELECT * FROM agents WHERE project_id = $1 ORDER BY created_at DESC',
      [params.projectId]
    );
    this.sendJson(res, 200, result.rows);
  }

  private async getAgent(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const db = getDatabase();
    const result = await db.query<Agent>('SELECT * FROM agents WHERE id = $1', [params.id]);
    if (result.rows.length === 0) {
      this.sendJson(res, 404, { error: 'Agent not found' });
      return;
    }
    this.sendJson(res, 200, result.rows[0]);
  }

  private async spawnAgent(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const body = await this.parseBody<{ type: string }>(req);
    // This would integrate with AgentManager in production
    const db = getDatabase();
    const result = await db.query<Agent>(
      `INSERT INTO agents (project_id, type, status) VALUES ($1, $2, 'initializing') RETURNING *`,
      [params.projectId, body.type]
    );
    this.sendJson(res, 201, result.rows[0]);
  }

  private async terminateAgent(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const db = getDatabase();
    await db.query(`UPDATE agents SET status = 'terminated' WHERE id = $1`, [params.id]);
    this.sendJson(res, 200, { success: true });
  }

  private async listTasks(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const db = getDatabase();
    const result = await db.query<Task>(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY created_at DESC',
      [params.projectId]
    );
    this.sendJson(res, 200, result.rows);
  }

  private async getTask(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const db = getDatabase();
    const result = await db.query<Task>('SELECT * FROM tasks WHERE id = $1', [params.id]);
    if (result.rows.length === 0) {
      this.sendJson(res, 404, { error: 'Task not found' });
      return;
    }
    this.sendJson(res, 200, result.rows[0]);
  }

  private async createTask(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const body = await this.parseBody<{ title: string; description?: string; type?: string }>(req);
    const db = getDatabase();
    const result = await db.query<Task>(
      `INSERT INTO tasks (project_id, title, description, type) VALUES ($1, $2, $3, $4) RETURNING *`,
      [params.projectId, body.title, body.description || null, body.type || null]
    );
    this.sendJson(res, 201, result.rows[0]);
  }

  private async updateTask(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const body = await this.parseBody<{ status?: string; result?: unknown }>(req);
    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.status) {
      updates.push(`status = $${paramIndex++}`);
      values.push(body.status);
    }
    if (body.result) {
      updates.push(`result = $${paramIndex++}`);
      values.push(JSON.stringify(body.result));
    }

    if (updates.length === 0) {
      this.sendJson(res, 400, { error: 'No fields to update' });
      return;
    }

    values.push(params.id);
    const result = await db.query<Task>(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    this.sendJson(res, 200, result.rows[0]);
  }

  private async listMessages(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const db = getDatabase();
    const result = await db.query<Message>(
      'SELECT * FROM messages WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100',
      [params.projectId]
    );
    this.sendJson(res, 200, result.rows);
  }

  private async sendMessage(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const body = await this.parseBody<{ type: string; toAgentId?: string; payload: unknown }>(req);
    const db = getDatabase();
    const result = await db.query<Message>(
      `INSERT INTO messages (project_id, type, to_agent_id, payload) VALUES ($1, $2, $3, $4) RETURNING *`,
      [params.projectId, body.type, body.toAgentId || null, JSON.stringify(body.payload)]
    );
    this.sendJson(res, 201, result.rows[0]);
  }

  // Dashboard route handlers
  private async getDashboardStats(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getDashboardStats(req, res);
  }

  private async getProjectActivity(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getProjectActivity(req, res, params.projectId);
  }

  private async getAgentStats(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getAgentStats(req, res, params.agentId);
  }

  private async getProjectAgentsLive(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getProjectAgentsLive(req, res, params.projectId);
  }

  private async getPromptStats(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getPromptStats(req, res, params.agentType);
  }

  private async getProjectTimeline(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getProjectTimeline(req, res, params.projectId);
  }

  // Demo₃: Task execution handlers
  private async listAllTasksHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await listAllTasks(req, res);
  }

  private async getTaskQueueStatsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getTaskQueueStats(req, res);
  }

  private async getNextTaskHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getNextTask(req, res);
  }

  private async createTaskEnhancedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await createTaskEnhanced(req, res);
  }

  private async getTaskByIdHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getTaskById(_req, res, params.taskId);
  }

  private async assignTaskHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await assignTaskToAgent(req, res, params.taskId);
  }

  private async completeTaskHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await completeTask(req, res, params.taskId);
  }

  private async failTaskHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await failTask(req, res, params.taskId);
  }

  private async retryTaskHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await retryTask(req, res, params.taskId);
  }

  private async cancelTaskHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await cancelTask(req, res, params.taskId);
  }

  // Demo₃: Orchestrator handlers
  private async getOrchestratorStatusHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getOrchestratorStatus(req, res);
  }

  private async startOrchestratorHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await startOrchestrator(req, res);
  }

  private async stopOrchestratorHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await stopOrchestrator(req, res);
  }

  private async submitPlanHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await submitPlan(req, res);
  }

  // Demo₃: Agent checkpoint/message handlers
  private async forceAgentCheckpointHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await forceAgentCheckpoint(req, res, params.agentId);
  }

  private async resumeAgentHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await resumeAgentFromCheckpoint(req, res, params.agentId);
  }

  private async getAgentMessagesHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getAgentMessages(req, res, params.agentId);
  }

  private async sendMessageToAgentHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await sendMessageToAgent(req, res, params.agentId);
  }

  // Demo₃: Checkpoint handlers
  private async getCheckpointStatsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getCheckpointStats(req, res);
  }

  private async getAgentCheckpointsHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getAgentCheckpoints(req, res, params.agentId);
  }

  // Demo₃: Execution logs handler
  private async getExecutionLogsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getExecutionLogs(req, res);
  }

  // Demo₄: Agent Lifecycle handlers
  private async spawnAgentLifecycleHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await spawnAgentLifecycle(req, res, params.agentId);
  }

  private async terminateAgentLifecycleHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await terminateAgentLifecycle(req, res, params.agentId);
  }

  private async killAgentHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await killAgent(req, res, params.agentId);
  }

  private async restartAgentHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await restartAgent(req, res, params.agentId);
  }

  private async getAgentProcessHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getAgentProcess(req, res, params.agentId);
  }

  private async getAgentHealthHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getAgentHealth(req, res, params.agentId);
  }

  private async getAgentResourcesHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getAgentResources(req, res, params.agentId);
  }

  private async recordAgentResourcesHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await recordAgentResources(req, res, params.agentId);
  }

  private async getAgentHealthHistoryHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getAgentHealthHistory(req, res, params.agentId);
  }

  private async getAgentResourceHistoryHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getAgentResourceHistory(req, res, params.agentId);
  }

  // Demo₄: Agent Manager handlers
  private async getManagerStatusHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getManagerStatus(req, res);
  }

  private async spawnAllAgentsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await spawnAllAgents(req, res);
  }

  private async terminateAllAgentsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await terminateAllAgents(req, res);
  }

  private async getAggregateResourcesHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getAggregateResources(req, res);
  }

  private async garbageCollectHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await garbageCollect(req, res);
  }

  private async startManagerHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await startManager(req, res);
  }

  private async stopManagerHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await stopManager(req, res);
  }

  // Demo₅: Multi-Agent Coordination handlers
  private coordinators: Map<string, AgentCoordinator> = new Map();

  private getOrCreateCoordinator(projectId: string): AgentCoordinator {
    if (!this.coordinators.has(projectId)) {
      const coordinator = createCoordinator({ projectId });
      this.coordinators.set(projectId, coordinator);
    }
    return this.coordinators.get(projectId)!;
  }

  private async initializeCoordinationHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const body = await this.parseBody<{ maxConcurrentAgents?: number }>(req);

      const coordinator = createCoordinator({
        projectId,
        maxConcurrentAgents: body.maxConcurrentAgents || 10,
      });

      await coordinator.initialize();
      this.coordinators.set(projectId, coordinator);

      this.sendJson(res, 200, { success: true, projectId, maxConcurrentAgents: body.maxConcurrentAgents || 10 });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async spawnMultipleAgentsHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const body = await this.parseBody<{ agents: Array<{ type: string }> }>(req);

      if (!body.agents || !Array.isArray(body.agents)) {
        return this.sendJson(res, 400, { success: false, error: 'agents array is required' });
      }

      const coordinator = this.getOrCreateCoordinator(projectId);
      const results = await coordinator.spawnAgents(body.agents as any);

      this.sendJson(res, 200, {
        success: true,
        results,
        spawned: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getCoordinatedAgentsHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const coordinator = this.getOrCreateCoordinator(projectId);
      const agents = await coordinator.getActiveAgents();

      this.sendJson(res, 200, { success: true, agents, count: agents.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getCoordinationStatusHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const coordinator = this.getOrCreateCoordinator(projectId);
      const status = await coordinator.getStatus();

      this.sendJson(res, 200, { success: true, status });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async canSpawnAgentHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const coordinator = this.getOrCreateCoordinator(projectId);
      const result = await coordinator.canSpawnAgent();

      this.sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async assignTasksHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const body = await this.parseBody<{ tasks: Array<{ id: string }> }>(req);

      if (!body.tasks || !Array.isArray(body.tasks)) {
        return this.sendJson(res, 400, { success: false, error: 'tasks array is required' });
      }

      const coordinator = this.getOrCreateCoordinator(projectId);
      const results = await coordinator.assignTasks(body.tasks as any);

      this.sendJson(res, 200, {
        success: true,
        results,
        assigned: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async routeTaskHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const body = await this.parseBody<{ taskId: string; preferredType?: string }>(req);

      if (!body.taskId) {
        return this.sendJson(res, 400, { success: false, error: 'taskId is required' });
      }

      const coordinator = this.getOrCreateCoordinator(projectId);
      const agentId = await coordinator.routeTask(body.taskId, body.preferredType as any);

      this.sendJson(res, 200, { success: !!agentId, agentId });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async rebalanceTasksHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const coordinator = this.getOrCreateCoordinator(projectId);
      const result = await coordinator.rebalance();

      this.sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async terminateCoordinatedAgentHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId, agentId } = params;
      const coordinator = this.getOrCreateCoordinator(projectId);
      const success = await coordinator.terminateAgent(agentId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₅: File Lock handlers
  private async acquireLockHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const body = await this.parseBody<{ agentId: string; filePath: string; durationMinutes?: number }>(req);

      if (!body.agentId || !body.filePath) {
        return this.sendJson(res, 400, { success: false, error: 'agentId and filePath are required' });
      }

      const coordinator = this.getOrCreateCoordinator(projectId);
      const result = await coordinator.acquireLock(body.agentId, body.filePath, body.durationMinutes);

      this.sendJson(res, 200, result);
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async releaseLockHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId, lockId } = params;
      const body = await this.parseBody<{ agentId: string }>(req);

      if (!body.agentId) {
        return this.sendJson(res, 400, { success: false, error: 'agentId is required' });
      }

      const coordinator = this.getOrCreateCoordinator(projectId);
      const success = await coordinator.releaseLock(lockId, body.agentId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getLocksHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const coordinator = this.getOrCreateCoordinator(projectId);
      const locks = await coordinator.getActiveLocks();

      this.sendJson(res, 200, { success: true, locks, count: locks.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async checkLockHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const body = await this.parseBody<{ filePath: string }>(req);

      if (!body.filePath) {
        return this.sendJson(res, 400, { success: false, error: 'filePath is required' });
      }

      const coordinator = this.getOrCreateCoordinator(projectId);
      const result = await coordinator.isFileLocked(body.filePath);

      this.sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₅: Conflict handlers
  private async getConflictsHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const coordinator = this.getOrCreateCoordinator(projectId);
      const conflicts = await coordinator.getPendingConflicts();

      this.sendJson(res, 200, { success: true, conflicts, count: conflicts.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async detectConflictHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const body = await this.parseBody<{ agentAId: string; agentBId: string; filePath: string; conflictType: string }>(req);

      if (!body.agentAId || !body.agentBId || !body.filePath || !body.conflictType) {
        return this.sendJson(res, 400, { success: false, error: 'agentAId, agentBId, filePath, and conflictType are required' });
      }

      const coordinator = this.getOrCreateCoordinator(projectId);
      const conflict = await coordinator.detectConflict(body.agentAId, body.agentBId, body.filePath, body.conflictType);

      this.sendJson(res, 200, { success: true, conflict });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async resolveConflictHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId, conflictId } = params;
      const body = await this.parseBody<{ resolution: string; resolvedBy: string }>(req);

      if (!body.resolution || !body.resolvedBy) {
        return this.sendJson(res, 400, { success: false, error: 'resolution and resolvedBy are required' });
      }

      if (!['merge', 'override_a', 'override_b', 'reject'].includes(body.resolution)) {
        return this.sendJson(res, 400, { success: false, error: 'Invalid resolution' });
      }

      const coordinator = this.getOrCreateCoordinator(projectId);
      const success = await coordinator.resolveConflict(conflictId, body.resolution as any, body.resolvedBy);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₅: Messaging handler
  private async relayMessageHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const message = await this.parseBody<{ type: string; fromAgentId?: string; toAgentId?: string; payload?: Record<string, unknown> }>(req);

      if (!message || !message.type) {
        return this.sendJson(res, 400, { success: false, error: 'message with type is required' });
      }

      const coordinator = this.getOrCreateCoordinator(projectId);
      await coordinator.relay({ ...message, projectId } as any);

      this.sendJson(res, 200, { success: true });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₆: Notification handlers
  private async getNotificationsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const projectId = url.searchParams.get('projectId') || undefined;
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
      const level = url.searchParams.get('level') as NotificationLevel | undefined;

      const notificationService = getNotificationService();
      const notifications = await notificationService.getNotifications(projectId, {
        limit,
        offset,
        unreadOnly,
        level,
      });

      this.sendJson(res, 200, { success: true, notifications, count: notifications.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getUnreadCountHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const projectId = url.searchParams.get('projectId') || undefined;

      const notificationService = getNotificationService();
      const count = await notificationService.getUnreadCount(projectId);

      this.sendJson(res, 200, { success: true, ...count });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async markNotificationReadHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { notificationId } = params;

      const notificationService = getNotificationService();
      const success = await notificationService.markAsRead(notificationId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async acknowledgeNotificationHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { notificationId } = params;

      const notificationService = getNotificationService();
      const success = await notificationService.acknowledge(notificationId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async deleteNotificationHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { notificationId } = params;

      const notificationService = getNotificationService();
      const success = await notificationService.deleteNotification(notificationId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async createNotificationHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.parseBody<{
        projectId: string;
        level: NotificationLevel;
        eventType: string;
        title: string;
        message?: string;
        agentId?: string;
        taskId?: string;
        metadata?: Record<string, unknown>;
      }>(req);

      if (!body.projectId || !body.level || !body.eventType || !body.title) {
        return this.sendJson(res, 400, { success: false, error: 'projectId, level, eventType, and title are required' });
      }

      const notificationService = getNotificationService();
      const notification = await notificationService.createNotification(
        body.projectId,
        body.level,
        body.eventType,
        body.title,
        {
          message: body.message,
          agentId: body.agentId,
          taskId: body.taskId,
          metadata: body.metadata,
        }
      );

      this.sendJson(res, 201, { success: true, notification });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₆: Activity Stream handlers
  private async getRecentActivityHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);

      const activityService = getActivityService();
      const activities = await activityService.getRecentActivity(limit);

      this.sendJson(res, 200, { success: true, activities, count: activities.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getProjectActivityStreamHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const since = url.searchParams.get('since');
      const eventType = url.searchParams.get('eventType') as ActivityEventType | undefined;

      const activityService = getActivityService();
      const activities = await activityService.getActivityStream({
        projectId,
        limit,
        offset,
        since: since ? new Date(since) : undefined,
        eventType,
      });

      this.sendJson(res, 200, { success: true, activities, count: activities.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getActivityStatsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const projectId = url.searchParams.get('projectId') || undefined;

      const activityService = getActivityService();
      const stats = await activityService.getActivityStats(projectId);

      this.sendJson(res, 200, { success: true, stats });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async logActivityHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.parseBody<{
        projectId: string;
        eventType: ActivityEventType;
        action: string;
        details?: string;
        agentId?: string;
        agentType?: string;
        taskId?: string;
        filePath?: string;
        notificationLevel?: NotificationLevel;
      }>(req);

      if (!body.projectId || !body.eventType || !body.action) {
        return this.sendJson(res, 400, { success: false, error: 'projectId, eventType, and action are required' });
      }

      const activityService = getActivityService();
      const activity = await activityService.logActivity(
        body.projectId,
        body.eventType,
        body.action,
        {
          details: body.details,
          agentId: body.agentId,
          agentType: body.agentType,
          taskId: body.taskId,
          filePath: body.filePath,
          notificationLevel: body.notificationLevel,
        }
      );

      this.sendJson(res, 201, { success: true, activity });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₆: Progress handlers
  private async getProjectProgressHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;

      const progressService = getProgressService();
      const progress = await progressService.getProjectProgress(projectId);

      this.sendJson(res, 200, { success: true, progress });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getAllProgressHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const progressService = getProgressService();
      const projects = await progressService.getAllProjectsProgress();

      this.sendJson(res, 200, { success: true, projects, count: projects.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async saveProgressSnapshotHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;

      const progressService = getProgressService();
      const snapshot = await progressService.saveProgressSnapshot(projectId);

      this.sendJson(res, 201, { success: true, snapshot });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getProgressHistoryHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const since = url.searchParams.get('since');

      const progressService = getProgressService();
      const history = await progressService.getProgressHistory(projectId, {
        limit,
        since: since ? new Date(since) : undefined,
      });

      this.sendJson(res, 200, { success: true, history, count: history.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₆: Settings handlers
  private async getNotificationSettingsHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const notificationService = getNotificationService();
      const settings = await notificationService.getSettings();

      this.sendJson(res, 200, { success: true, settings });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async updateNotificationSettingsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.parseBody<{
        availabilityMode?: 'active' | 'busy' | 'away' | 'dnd';
        emailEnabled?: boolean;
        pushEnabled?: boolean;
        smsEnabled?: boolean;
        quietHoursStart?: string;
        quietHoursEnd?: string;
        quietHoursMode?: 'active' | 'busy' | 'away' | 'dnd';
        levelOverrides?: Record<string, string[]>;
      }>(req);

      const notificationService = getNotificationService();
      const settings = await notificationService.updateSettings(body);

      this.sendJson(res, 200, { success: true, settings });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async updateAvailabilityHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.parseBody<{ mode: 'active' | 'busy' | 'away' | 'dnd' }>(req);

      if (!body.mode) {
        return this.sendJson(res, 400, { success: false, error: 'mode is required' });
      }

      if (!['active', 'busy', 'away', 'dnd'].includes(body.mode)) {
        return this.sendJson(res, 400, { success: false, error: 'Invalid availability mode' });
      }

      const notificationService = getNotificationService();
      await notificationService.setAvailabilityMode(body.mode);

      this.sendJson(res, 200, { success: true, mode: body.mode });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₇: Demo Management handlers
  private async listDemosHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const status = url.searchParams.get('status') as DemoStatus | undefined;
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);

      const demoService = getDemoService();
      const demos = await demoService.listDemos(projectId, { status, limit });

      this.sendJson(res, 200, { success: true, demos, count: demos.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getDemoHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const demoService = getDemoService();
      const demo = await demoService.getDemo(demoId);

      this.sendJson(res, 200, { success: true, demo });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return this.sendJson(res, 404, { success: false, error: error.message });
      }
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async createDemoHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const body = await this.parseBody<{
        name: string;
        type?: DemoType;
        description?: string;
        config?: {
          features?: string[];
          excludedFeatures?: string[];
          scaffoldingPercent?: number;
          estimatedTime?: number;
          estimatedCost?: number;
        };
      }>(req);

      if (!body.name) {
        return this.sendJson(res, 400, { success: false, error: 'name is required' });
      }

      const demoService = getDemoService();
      const demo = await demoService.createDemo(projectId, body);

      this.sendJson(res, 201, { success: true, demo });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async updateDemoHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;
      const body = await this.parseBody<{
        config?: {
          features?: string[];
          excludedFeatures?: string[];
          scaffoldingPercent?: number;
          estimatedTime?: number;
          estimatedCost?: number;
        };
        scaffolding?: {
          totalFiles?: number;
          reusableFiles?: number;
          components?: string[];
          routes?: string[];
          styles?: string[];
        };
      }>(req);

      const demoService = getDemoService();
      let demo = await demoService.getDemo(demoId);

      if (body.config) {
        demo = await demoService.updateConfig(demoId, body.config);
      }
      if (body.scaffolding) {
        demo = await demoService.updateScaffolding(demoId, body.scaffolding);
      }

      this.sendJson(res, 200, { success: true, demo });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async deleteDemoHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const demoService = getDemoService();
      const success = await demoService.deleteDemo(demoId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Only draft')) {
        return this.sendJson(res, 400, { success: false, error: error.message });
      }
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async startDemoBuildHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const demoService = getDemoService();
      const success = await demoService.startBuild(demoId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async markReadyHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const demoService = getDemoService();
      const success = await demoService.markReady(demoId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async archiveDemoHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const demoService = getDemoService();
      const success = await demoService.archiveDemo(demoId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async setPreviewHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;
      const body = await this.parseBody<{ url: string; port?: number; pid?: number }>(req);

      if (!body.url) {
        return this.sendJson(res, 400, { success: false, error: 'url is required' });
      }

      const demoService = getDemoService();
      const demo = await demoService.setPreviewUrl(demoId, body.url, body.port, body.pid);

      this.sendJson(res, 200, { success: true, demo });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async clearPreviewHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const demoService = getDemoService();
      const demo = await demoService.clearPreview(demoId);

      this.sendJson(res, 200, { success: true, demo });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getDemoStatsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const projectId = url.searchParams.get('projectId') || undefined;

      const demoService = getDemoService();
      const stats = await demoService.getStats(projectId);

      this.sendJson(res, 200, { success: true, stats });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₇: Approval Workflow handlers
  private async getPendingApprovalsHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const approvalService = getApprovalService();
      const approvals = await approvalService.getPendingApprovals();

      this.sendJson(res, 200, { success: true, approvals, count: approvals.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getDemoApprovalHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const approvalService = getApprovalService();
      const approval = await approvalService.getLatestApprovalForDemo(demoId);

      this.sendJson(res, 200, { success: true, approval });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async requestApprovalHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;
      const body = await this.parseBody<{ requestedBy?: string }>(req);

      const approvalService = getApprovalService();
      const request = await approvalService.requestApproval(demoId, body.requestedBy);

      this.sendJson(res, 201, { success: true, request });
    } catch (error) {
      if (error instanceof Error && error.message.includes('must be in ready')) {
        return this.sendJson(res, 400, { success: false, error: error.message });
      }
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async approveDemoHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { requestId } = params;
      const body = await this.parseBody<{ decidedBy: string; comments?: string }>(req);

      if (!body.decidedBy) {
        return this.sendJson(res, 400, { success: false, error: 'decidedBy is required' });
      }

      const approvalService = getApprovalService();
      const success = await approvalService.approve(requestId, body.decidedBy, { comments: body.comments });

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async requestChangesHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { requestId } = params;
      const body = await this.parseBody<{ decidedBy: string; comments?: string; changeRequests: string[] }>(req);

      if (!body.decidedBy) {
        return this.sendJson(res, 400, { success: false, error: 'decidedBy is required' });
      }
      if (!body.changeRequests || body.changeRequests.length === 0) {
        return this.sendJson(res, 400, { success: false, error: 'changeRequests are required' });
      }

      const approvalService = getApprovalService();
      const success = await approvalService.requestChanges(requestId, body.decidedBy, {
        comments: body.comments,
        changeRequests: body.changeRequests,
      });

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async skipToBuildHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { requestId } = params;
      const body = await this.parseBody<{ decidedBy: string; comments?: string }>(req);

      if (!body.decidedBy) {
        return this.sendJson(res, 400, { success: false, error: 'decidedBy is required' });
      }

      const approvalService = getApprovalService();
      const success = await approvalService.skipToBuild(requestId, body.decidedBy, { comments: body.comments });

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async rejectDemoHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { requestId } = params;
      const body = await this.parseBody<{ decidedBy: string; comments?: string }>(req);

      if (!body.decidedBy) {
        return this.sendJson(res, 400, { success: false, error: 'decidedBy is required' });
      }

      const approvalService = getApprovalService();
      const success = await approvalService.reject(requestId, body.decidedBy, { comments: body.comments });

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getApprovalHistoryHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const approvalService = getApprovalService();
      const history = await approvalService.getApprovalHistory(demoId);

      this.sendJson(res, 200, { success: true, history, count: history.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₇: Verification handlers
  private async verifyDemoHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;
      const body = await this.parseBody<{
        previewUrl?: string;
        skipProcess?: boolean;
        skipUrl?: boolean;
        skipPage?: boolean;
        skipFlow?: boolean;
        skipResponsive?: boolean;
        timeout?: number;
      }>(req);

      const demoService = getDemoService();
      const demo = await demoService.getDemo(demoId);

      const previewUrl = body.previewUrl || demo.previewUrl;
      if (!previewUrl) {
        return this.sendJson(res, 400, { success: false, error: 'previewUrl is required (either in body or set on demo)' });
      }

      const verificationService = getVerificationService();
      const result = await verificationService.verifyDemo(demoId, previewUrl, {
        skipProcess: body.skipProcess,
        skipUrl: body.skipUrl,
        skipPage: body.skipPage,
        skipFlow: body.skipFlow,
        skipResponsive: body.skipResponsive,
        timeout: body.timeout,
      });

      this.sendJson(res, 200, { success: true, result });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getLatestVerificationHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const verificationService = getVerificationService();
      const verification = await verificationService.getLatestVerification(demoId);

      this.sendJson(res, 200, { success: true, verification });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getVerificationHistoryHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const verificationService = getVerificationService();
      const history = await verificationService.getVerificationHistory(demoId);

      this.sendJson(res, 200, { success: true, history, count: history.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₇: Feedback handlers
  private async listFeedbackHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const unresolved = url.searchParams.get('unresolved') === 'true';
      const sentiment = url.searchParams.get('sentiment') as FeedbackSentiment | undefined;
      const category = url.searchParams.get('category') as FeedbackCategory | undefined;
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);

      const feedbackService = getFeedbackService();
      const feedback = await feedbackService.listFeedback(demoId, { unresolved, sentiment, category, limit });

      this.sendJson(res, 200, { success: true, feedback, count: feedback.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async addFeedbackHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;
      const body = await this.parseBody<{
        content: string;
        sentiment?: FeedbackSentiment;
        category?: FeedbackCategory;
        pageUrl?: string;
        elementId?: string;
        screenshot?: string;
      }>(req);

      if (!body.content) {
        return this.sendJson(res, 400, { success: false, error: 'content is required' });
      }

      const feedbackService = getFeedbackService();
      const feedback = await feedbackService.addFeedback(demoId, body);

      this.sendJson(res, 201, { success: true, feedback });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getFeedbackHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { feedbackId } = params;

      const feedbackService = getFeedbackService();
      const feedback = await feedbackService.getFeedback(feedbackId);

      this.sendJson(res, 200, { success: true, feedback });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return this.sendJson(res, 404, { success: false, error: error.message });
      }
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async updateFeedbackHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { feedbackId } = params;
      const body = await this.parseBody<{
        sentiment?: FeedbackSentiment;
        category?: FeedbackCategory;
        content?: string;
        pageUrl?: string;
        elementId?: string;
        screenshot?: string;
      }>(req);

      const feedbackService = getFeedbackService();
      const feedback = await feedbackService.updateFeedback(feedbackId, body);

      this.sendJson(res, 200, { success: true, feedback });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async processFeedbackHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { feedbackId } = params;
      const body = await this.parseBody<{ actionTaken: string }>(req);

      if (!body.actionTaken) {
        return this.sendJson(res, 400, { success: false, error: 'actionTaken is required' });
      }

      const feedbackService = getFeedbackService();
      const feedback = await feedbackService.processFeedback(feedbackId, body.actionTaken);

      this.sendJson(res, 200, { success: true, feedback });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async resolveFeedbackHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { feedbackId } = params;
      const body = await this.parseBody<{ actionTaken?: string }>(req);

      const feedbackService = getFeedbackService();
      const feedback = await feedbackService.resolveFeedback(feedbackId, body.actionTaken);

      this.sendJson(res, 200, { success: true, feedback });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async deleteFeedbackHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { feedbackId } = params;

      const feedbackService = getFeedbackService();
      const success = await feedbackService.deleteFeedback(feedbackId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getFeedbackSummaryHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const feedbackService = getFeedbackService();
      const summary = await feedbackService.getFeedbackSummary(demoId);

      this.sendJson(res, 200, { success: true, summary });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₇: Scaffolding handlers
  private async getProjectScaffoldingHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const db = getDatabase();

      const result = await db.query<{
        total_demos: number;
        total_files: number;
        reusable_files: number;
        overall_reuse_percent: string;
        all_components: string[];
        all_routes: string[];
      }>(
        `SELECT * FROM get_project_scaffolding($1)`,
        [projectId]
      );

      if (result.rows.length === 0 || result.rows[0].total_demos === null) {
        return this.sendJson(res, 200, {
          success: true,
          scaffolding: {
            totalDemos: 0,
            totalFiles: 0,
            reusableFiles: 0,
            overallReusePercent: 0,
            allComponents: [],
            allRoutes: [],
          },
        });
      }

      const row = result.rows[0];
      this.sendJson(res, 200, {
        success: true,
        scaffolding: {
          totalDemos: row.total_demos,
          totalFiles: row.total_files,
          reusableFiles: row.reusable_files,
          overallReusePercent: parseFloat(row.overall_reuse_percent || '0'),
          allComponents: row.all_components || [],
          allRoutes: row.all_routes || [],
        },
      });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getDemoScaffoldingHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { demoId } = params;

      const demoService = getDemoService();
      const demo = await demoService.getDemo(demoId);

      this.sendJson(res, 200, { success: true, scaffolding: demo.scaffolding });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return this.sendJson(res, 404, { success: false, error: error.message });
      }
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₈: Self-Build handlers
  private async startSelfBuildHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const body = await this.parseBody<SelfBuildConfig>(req);

      if (!body.projectName) {
        return this.sendJson(res, 400, { success: false, error: 'projectName is required' });
      }

      const manager = getSelfBuildManager();
      const run = await manager.startBuild(projectId, body);

      this.sendJson(res, 201, { success: true, run });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getSelfBuildRunHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { runId } = params;

      const manager = getSelfBuildManager();
      const run = await manager.getRun(runId);

      this.sendJson(res, 200, { success: true, run });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return this.sendJson(res, 404, { success: false, error: error.message });
      }
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getSelfBuildPlanHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { runId } = params;

      const manager = getSelfBuildManager();
      const run = await manager.getRun(runId);

      if (!run.executionPlan) {
        return this.sendJson(res, 404, { success: false, error: 'No execution plan found' });
      }

      this.sendJson(res, 200, { success: true, plan: run.executionPlan });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async createSelfBuildPlanHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { runId } = params;

      const manager = getSelfBuildManager();
      const plan = await manager.createPlan(runId);

      this.sendJson(res, 201, { success: true, plan });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async executeSelfBuildHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { runId } = params;

      const manager = getSelfBuildManager();
      const result = await manager.execute(runId);

      this.sendJson(res, 200, { success: result.success, result });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getSelfBuildProgressHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { runId } = params;

      const manager = getSelfBuildManager();
      const progress = await manager.getProgress(runId);

      this.sendJson(res, 200, { success: true, progress });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getSelfBuildPhasesHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { runId } = params;

      const manager = getSelfBuildManager();
      const phases = await manager.getPhases(runId);

      this.sendJson(res, 200, { success: true, phases, count: phases.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async cancelSelfBuildHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { runId } = params;

      const manager = getSelfBuildManager();
      const success = await manager.cancel(runId);

      this.sendJson(res, 200, { success });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async listSelfBuildRunsHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { projectId } = params;
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const status = url.searchParams.get('status') as SelfBuildStatus | undefined;
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);

      const manager = getSelfBuildManager();
      const runs = await manager.listRuns(projectId, { status, limit });

      this.sendJson(res, 200, { success: true, runs, count: runs.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async runFullSelfBuildHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.parseBody<{ projectId: string; config: SelfBuildConfig }>(req);

      if (!body.projectId) {
        return this.sendJson(res, 400, { success: false, error: 'projectId is required' });
      }
      if (!body.config || !body.config.projectName) {
        return this.sendJson(res, 400, { success: false, error: 'config with projectName is required' });
      }

      const manager = getSelfBuildManager();
      const result = await manager.runSelfBuild(body.projectId, body.config);

      this.sendJson(res, 200, { success: result.success, result });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Demo₈: Sample Projects handlers
  private async listSampleProjectsHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const projects = getAllSampleProjects();
      const projectList = Object.entries(projects).map(([name, config]) => ({
        name,
        description: config.projectDescription,
        features: config.features.length,
        techStack: config.techStack,
        maxExecutionTime: config.maxExecutionTime,
        maxBudget: config.maxBudget,
      }));

      this.sendJson(res, 200, { success: true, projects: projectList, count: projectList.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async getSampleProjectHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    try {
      const { name } = params;
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const simulated = url.searchParams.get('simulated') === 'true';
      const duration = parseInt(url.searchParams.get('duration') || '5000', 10);
      const successRate = parseFloat(url.searchParams.get('successRate') || '1.0');

      let project: SelfBuildConfig | undefined;

      if (simulated) {
        try {
          project = createSimulatedConfig(name, duration, successRate);
        } catch {
          return this.sendJson(res, 404, { success: false, error: `Sample project not found: ${name}` });
        }
      } else {
        project = getSampleProject(name);
      }

      if (!project) {
        return this.sendJson(res, 404, { success: false, error: `Sample project not found: ${name}` });
      }

      this.sendJson(res, 200, { success: true, project });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Workflow Engine handlers
  private async startBuildHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await startBuild(req, res, params.projectId);
  }

  private async getWorkflowStateHandler(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getWorkflowState(_req, res, params.projectId);
  }

  private async cancelWorkflowHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await cancelWorkflow(req, res, params.projectId);
  }

  private async resumeWorkflowHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await resumeWorkflow(req, res, params.projectId);
  }

  private async getActiveWorkflowsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getActiveWorkflows(req, res);
  }

  private async getWorkflowStatsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getWorkflowStats(req, res);
  }

  private async enableAutoTriggerHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await enableAutoTrigger(req, res);
  }

  private async disableAutoTriggerHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await disableAutoTrigger(req, res);
  }

  private async getAutoTriggerStatusHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getAutoTriggerStatus(req, res);
  }

  // Authentication handlers
  private async loginHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await login(req, res);
  }

  private async refreshHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await refresh(req, res);
  }

  private async logoutHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await logout(req as AuthenticatedRequest, res);
  }

  private async getCurrentUserHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getCurrentUser(req as AuthenticatedRequest, res);
  }

  private async changePasswordHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await changePassword(req as AuthenticatedRequest, res);
  }

  private async getAuthAuditHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;

      // Only admins can view audit log
      if (!authReq.user || authReq.user.role !== 'admin') {
        this.sendJson(res, 403, { success: false, error: 'Admin access required' });
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const userId = url.searchParams.get('userId') || undefined;
      const resource = url.searchParams.get('resource') || undefined;
      const allowed = url.searchParams.get('allowed');
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);

      const auditLog = getAuthorizationAuditLog({
        userId,
        resource,
        allowed: allowed !== null ? allowed === 'true' : undefined,
        limit,
      });

      this.sendJson(res, 200, { success: true, entries: auditLog, count: auditLog.length });
    } catch (error) {
      this.sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Cost Tracking handlers
  private async getProjectCostsHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getProjectCosts(req, res, params);
  }

  private async getProjectBudgetHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getProjectBudget(req, res, params);
  }

  private async updateProjectBudgetHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await updateProjectBudget(req, res, params);
  }

  private async getCostEventsHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getCostEvents(req, res, params);
  }

  private async getDailyCostsHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getDailyCosts(req, res, params);
  }

  private async getCostByAgentTypeHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getCostByAgentType(req, res, params);
  }

  private async recordCostEventHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await recordCostEvent(req, res, params);
  }

  private async getCostOverviewHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getCostOverview(req, res);
  }

  private async getBudgetAlertsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getBudgetAlerts(req, res);
  }

  private async acknowledgeBudgetAlertHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await acknowledgeBudgetAlert(req, res, params);
  }

  private async getModelPricingHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getModelPricing(req, res);
  }

  // Learning Metrics handlers
  private async getLearningMetricsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getAggregateLearningMetrics(req, res);
  }

  private async getPromptPerformanceHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getPromptPerformance(req, res, params);
  }

  private async getPromptTrendHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getPromptTrend(req, res, params);
  }

  private async getPromptComparisonHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getPromptComparison(req, res, params);
  }

  private async getAllPromptComparisonsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await getAllPromptComparisons(req, res);
  }

  private async listExperimentsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await listExperiments(req, res);
  }

  private async createExperimentHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await createExperiment(req, res);
  }

  private async getExperimentResultsHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await getExperimentResults(req, res, params);
  }

  private async stopExperimentHandler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    await stopExperiment(req, res, params);
  }

  start(port: number, host = '0.0.0.0'): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, host, () => {
        console.log(`API server listening on http://${host}:${port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  return new ApiServer(options);
}
