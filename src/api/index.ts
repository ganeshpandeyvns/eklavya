import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { getDatabase } from '../lib/database.js';
import type { Agent, Task, Message, Project } from '../types/index.js';
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
  getAggregateResources,
  garbageCollect,
  startManager,
  stopManager,
  getAgentHealthHistory,
  getAgentResourceHistory,
} from './lifecycle.js';

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
  }

  private route(method: string, path: string, handler: RouteHandler): void {
    if (!this.routes.has(method)) {
      this.routes.set(method, new Map());
    }
    this.routes.get(method)!.set(path, handler.bind(this));
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const methodRoutes = this.routes.get(req.method || 'GET');

      if (!methodRoutes) {
        this.sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      // Match route with params
      for (const [pattern, handler] of methodRoutes) {
        const params = this.matchRoute(pattern, url.pathname);
        if (params !== null) {
          await handler(req, res, params);
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

  private async parseBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
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
