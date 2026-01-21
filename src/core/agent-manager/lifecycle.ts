/**
 * Agent Lifecycle Manager
 *
 * Demo₄: Manages the complete lifecycle of agent processes:
 * - Process spawning and tracking
 * - Health monitoring
 * - Resource tracking
 * - Graceful termination
 * - Crash recovery
 *
 * This module works alongside the existing AgentManager to provide
 * enhanced lifecycle management capabilities.
 */

import { EventEmitter } from 'events';
import { getDatabase } from '../../lib/database.js';
import { getCheckpointManager } from '../checkpoint/index.js';
import type { AgentType } from '../../types/index.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type ProcessStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'failed'
  | 'terminated'
  | 'recovering';

export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface AgentProcess {
  id: string;
  agentId: string;
  pid: number | null;
  status: ProcessStatus;
  startedAt: Date | null;
  stoppedAt: Date | null;
  exitCode: number | null;
  errorMessage: string | null;
  workingDirectory: string | null;
  environment: Record<string, string>;
  restartCount: number;
  maxRestarts: number;
}

export interface AgentHealth {
  agentId: string;
  status: HealthStatus;
  latencyMs: number;
  lastActivity: Date | null;
  errorMessage: string | null;
}

export interface ResourceUsage {
  agentId: string;
  cpuPercent: number;
  memoryMb: number;
  tokensUsed: number;
  apiCalls: number;
  filesModified: number;
  timestamp: Date;
}

export interface SpawnOptions {
  agentId: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  timeout?: number;
}

export interface SpawnResult {
  success: boolean;
  processId?: string;
  pid?: number;
  error?: string;
}

export interface TerminateOptions {
  agentId: string;
  graceful?: boolean;
  timeoutMs?: number;
  saveCheckpoint?: boolean;
}

export interface TerminateResult {
  success: boolean;
  checkpointSaved: boolean;
  exitCode?: number;
  error?: string;
}

export interface AgentProcessStatus {
  agentId: string;
  agentType: AgentType;
  agentStatus: string;
  healthStatus: HealthStatus;
  projectId: string;
  processId: string | null;
  pid: number | null;
  processStatus: ProcessStatus | null;
  startedAt: Date | null;
  stoppedAt: Date | null;
  exitCode: number | null;
  restartCount: number;
  workingDirectory: string | null;
  uptimeSeconds: number | null;
}

export interface LifecycleManagerStatus {
  running: boolean;
  totalAgents: number;
  runningAgents: number;
  stoppedAgents: number;
  crashedAgents: number;
  agents: AgentProcessStatus[];
}

// ============================================================================
// Agent Spawner
// ============================================================================

class AgentSpawner {
  private nextPid = 10000; // Simulated PIDs start at 10000

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const db = getDatabase();

    try {
      // Verify agent exists
      const agentResult = await db.query<{ id: string; type: string; project_id: string }>(
        `SELECT id, type, project_id FROM agents WHERE id = $1`,
        [options.agentId]
      );

      if (agentResult.rows.length === 0) {
        return { success: false, error: 'Agent not found' };
      }

      const agent = agentResult.rows[0];

      // Check project agent limit
      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM agent_processes
         WHERE agent_id IN (SELECT id FROM agents WHERE project_id = $1)
         AND status IN ('pending', 'starting', 'running')`,
        [agent.project_id]
      );

      const runningCount = parseInt(countResult.rows[0].count, 10);
      if (runningCount >= 10) {
        return { success: false, error: 'Project agent limit reached (max 10 concurrent agents)' };
      }

      // Prepare working directory (simulated)
      const workingDir = options.workingDirectory || `/tmp/eklavya/agents/${options.agentId}`;

      // Generate simulated PID
      const pid = this.nextPid++;

      // Create process record using database function
      const processResult = await db.query<{ spawn_agent_process: string }>(
        `SELECT spawn_agent_process($1, $2, $3, $4)`,
        [options.agentId, pid, workingDir, JSON.stringify(options.environment || {})]
      );

      const processId = processResult.rows[0].spawn_agent_process;

      // Simulate startup delay
      await new Promise(resolve => setTimeout(resolve, 50));

      // Update to running status
      await db.query(
        `SELECT update_agent_process($1, 'running', $2)`,
        [processId, pid]
      );

      return {
        success: true,
        processId,
        pid,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown spawn error';
      return { success: false, error: message };
    }
  }

  async prepareEnvironment(agentId: string, agentType: AgentType): Promise<Record<string, string>> {
    return {
      AGENT_ID: agentId,
      AGENT_TYPE: agentType,
      EKLAVYA_MODE: 'agent',
      NODE_ENV: 'development',
    };
  }
}

// ============================================================================
// Agent Monitor
// ============================================================================

class AgentMonitor extends EventEmitter {
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastActivity: Map<string, Date> = new Map();

  async checkHealth(agentId: string): Promise<AgentHealth> {
    const db = getDatabase();
    const startTime = Date.now();

    try {
      // Check if agent has a running process
      const processResult = await db.query<{ status: string; started_at: Date }>(
        `SELECT status, started_at FROM agent_processes
         WHERE agent_id = $1 AND status IN ('running', 'starting')
         ORDER BY created_at DESC LIMIT 1`,
        [agentId]
      );

      const latencyMs = Date.now() - startTime;

      if (processResult.rows.length === 0) {
        const health: AgentHealth = {
          agentId,
          status: 'unknown',
          latencyMs,
          lastActivity: this.lastActivity.get(agentId) || null,
          errorMessage: 'No running process',
        };

        await this.recordHealthCheck(health);
        return health;
      }

      const process = processResult.rows[0];
      const lastAct = this.lastActivity.get(agentId) || process.started_at;

      // Simulate health check (in real implementation, would ping the process)
      const isHealthy = process.status === 'running';

      const health: AgentHealth = {
        agentId,
        status: isHealthy ? 'healthy' : 'unhealthy',
        latencyMs,
        lastActivity: lastAct,
        errorMessage: isHealthy ? null : 'Process not responding',
      };

      await this.recordHealthCheck(health);

      if (!isHealthy) {
        this.emit('unhealthy', { agentId, health });
      }

      return health;
    } catch (error) {
      const health: AgentHealth = {
        agentId,
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        lastActivity: this.lastActivity.get(agentId) || null,
        errorMessage: error instanceof Error ? error.message : 'Health check failed',
      };

      await this.recordHealthCheck(health);
      this.emit('unhealthy', { agentId, health });
      return health;
    }
  }

  private async recordHealthCheck(health: AgentHealth): Promise<void> {
    const db = getDatabase();
    await db.query(
      `SELECT record_health_check($1, $2, $3, $4)`,
      [health.agentId, health.status, health.latencyMs, health.errorMessage]
    );
  }

  async startMonitoring(agentId: string, intervalMs = 5000): Promise<void> {
    // Stop existing monitoring if any
    this.stopMonitoring(agentId);

    // Initial health check
    await this.checkHealth(agentId);

    // Set up interval
    const interval = setInterval(async () => {
      await this.checkHealth(agentId);
    }, intervalMs);

    this.monitoringIntervals.set(agentId, interval);
    this.emit('monitoring-started', { agentId, intervalMs });
  }

  stopMonitoring(agentId: string): void {
    const interval = this.monitoringIntervals.get(agentId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(agentId);
      this.emit('monitoring-stopped', { agentId });
    }
  }

  recordActivity(agentId: string): void {
    this.lastActivity.set(agentId, new Date());
  }

  async getResourceUsage(agentId: string): Promise<ResourceUsage> {
    const db = getDatabase();

    // Get latest resource record
    const result = await db.query<{
      cpu_percent: number;
      memory_mb: number;
      tokens_used: number;
      api_calls: number;
      files_modified: number;
      timestamp: Date;
    }>(
      `SELECT cpu_percent, memory_mb, tokens_used, api_calls, files_modified, timestamp
       FROM agent_resources
       WHERE agent_id = $1
       ORDER BY timestamp DESC LIMIT 1`,
      [agentId]
    );

    if (result.rows.length === 0) {
      return {
        agentId,
        cpuPercent: 0,
        memoryMb: 0,
        tokensUsed: 0,
        apiCalls: 0,
        filesModified: 0,
        timestamp: new Date(),
      };
    }

    const row = result.rows[0];
    return {
      agentId,
      cpuPercent: parseFloat(String(row.cpu_percent)) || 0,
      memoryMb: parseFloat(String(row.memory_mb)) || 0,
      tokensUsed: parseInt(String(row.tokens_used), 10) || 0,
      apiCalls: parseInt(String(row.api_calls), 10) || 0,
      filesModified: parseInt(String(row.files_modified), 10) || 0,
      timestamp: row.timestamp,
    };
  }

  async recordResourceUsage(
    agentId: string,
    cpuPercent: number,
    memoryMb: number,
    tokensUsed = 0,
    apiCalls = 0,
    filesModified = 0
  ): Promise<void> {
    const db = getDatabase();
    await db.query(
      `SELECT record_resource_usage($1, $2, $3, $4, $5, $6)`,
      [agentId, cpuPercent, memoryMb, tokensUsed, apiCalls, filesModified]
    );
  }
}

// ============================================================================
// Agent Terminator
// ============================================================================

class AgentTerminator {
  async terminate(options: TerminateOptions): Promise<TerminateResult> {
    const db = getDatabase();
    let checkpointSaved = false;

    try {
      // Get current process
      const processResult = await db.query<{ id: string; status: string }>(
        `SELECT id, status FROM agent_processes
         WHERE agent_id = $1 AND status IN ('pending', 'starting', 'running')
         ORDER BY created_at DESC LIMIT 1`,
        [options.agentId]
      );

      if (processResult.rows.length === 0) {
        return {
          success: true,
          checkpointSaved: false,
          error: 'No running process to terminate',
        };
      }

      // Save checkpoint if requested
      if (options.saveCheckpoint !== false) {
        try {
          const checkpointManager = getCheckpointManager();
          await checkpointManager.createCheckpoint(
            options.agentId,
            { terminationRequested: true, timestamp: new Date().toISOString() },
            undefined,
            undefined,
            undefined,
            'Agent terminated gracefully - checkpoint before shutdown'
          );
          checkpointSaved = true;
        } catch {
          // Checkpoint failure shouldn't prevent termination
          console.warn('Failed to save checkpoint before termination');
        }
      }

      // Graceful termination (simulated)
      if (options.graceful !== false) {
        // Give agent time to clean up (simulated)
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Update process status
      await db.query(`SELECT terminate_agent_process($1, 0, NULL)`, [options.agentId]);

      return {
        success: true,
        checkpointSaved,
        exitCode: 0,
      };
    } catch (error) {
      return {
        success: false,
        checkpointSaved,
        error: error instanceof Error ? error.message : 'Termination failed',
      };
    }
  }

  async forceKill(agentId: string): Promise<boolean> {
    const db = getDatabase();

    try {
      // Force update all active processes to terminated
      await db.query(
        `UPDATE agent_processes
         SET status = 'terminated', stopped_at = NOW(), exit_code = -9, error_message = 'Force killed'
         WHERE agent_id = $1 AND status IN ('pending', 'starting', 'running', 'stopping')`,
        [agentId]
      );

      // Update agent status
      await db.query(`UPDATE agents SET status = 'idle', updated_at = NOW() WHERE id = $1`, [agentId]);

      return true;
    } catch {
      return false;
    }
  }

  async cleanup(agentId: string): Promise<void> {
    // Clean up any resources associated with the agent
    // In real implementation, would clean up working directory, temp files, etc.
    console.log(`Cleaned up resources for agent ${agentId}`);
  }
}

// ============================================================================
// Agent Lifecycle Manager (Main Orchestrator)
// ============================================================================

export class AgentLifecycleManager extends EventEmitter {
  private spawner: AgentSpawner;
  private monitor: AgentMonitor;
  private terminator: AgentTerminator;
  private running = false;

  constructor() {
    super();
    this.spawner = new AgentSpawner();
    this.monitor = new AgentMonitor();
    this.terminator = new AgentTerminator();

    // Forward monitor events
    this.monitor.on('unhealthy', data => this.emit('agent-unhealthy', data));
    this.monitor.on('monitoring-started', data => this.emit('monitoring-started', data));
    this.monitor.on('monitoring-stopped', data => this.emit('monitoring-stopped', data));
  }

  async start(): Promise<void> {
    this.running = true;
    this.emit('manager-started');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.emit('manager-stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  // ========== Lifecycle Methods ==========

  async spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
    const db = getDatabase();

    // Get agent type for environment setup
    const agentResult = await db.query<{ type: AgentType }>(
      `SELECT type FROM agents WHERE id = $1`,
      [options.agentId]
    );

    if (agentResult.rows.length === 0) {
      return { success: false, error: 'Agent not found' };
    }

    const agentType = agentResult.rows[0].type;

    // Prepare environment
    const baseEnv = await this.spawner.prepareEnvironment(options.agentId, agentType);
    const environment = { ...baseEnv, ...options.environment };

    const result = await this.spawner.spawn({ ...options, environment });

    if (result.success) {
      // Start health monitoring
      await this.monitor.startMonitoring(options.agentId);
      this.emit('agent-spawned', { agentId: options.agentId, ...result });
    } else {
      this.emit('agent-spawn-failed', { agentId: options.agentId, error: result.error });
    }

    return result;
  }

  async terminateAgent(agentId: string, graceful = true): Promise<TerminateResult> {
    // Stop monitoring
    this.monitor.stopMonitoring(agentId);

    const result = await this.terminator.terminate({
      agentId,
      graceful,
      saveCheckpoint: true,
    });

    if (result.success) {
      await this.terminator.cleanup(agentId);
      this.emit('agent-terminated', { agentId, ...result });
    } else {
      this.emit('agent-terminate-failed', { agentId, error: result.error });
    }

    return result;
  }

  async forceKillAgent(agentId: string): Promise<boolean> {
    this.monitor.stopMonitoring(agentId);
    const success = await this.terminator.forceKill(agentId);

    if (success) {
      await this.terminator.cleanup(agentId);
      this.emit('agent-killed', { agentId });
    }

    return success;
  }

  async restartAgent(agentId: string): Promise<SpawnResult> {
    // Terminate first
    await this.terminateAgent(agentId, true);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    // Increment restart count
    const db = getDatabase();
    const countResult = await db.query<{ increment_restart_count: number }>(
      `SELECT increment_restart_count($1)`,
      [agentId]
    );

    const restartCount = countResult.rows[0]?.increment_restart_count || 0;

    // Check max restarts
    if (restartCount >= 5) {
      return { success: false, error: 'Maximum restart limit reached' };
    }

    // Spawn again
    const result = await this.spawnAgent({ agentId });

    if (result.success) {
      this.emit('agent-restarted', { agentId, restartCount, ...result });
    }

    return result;
  }

  // ========== Status Methods ==========

  async getAgentStatus(agentId: string): Promise<AgentProcessStatus | null> {
    const db = getDatabase();

    const result = await db.query<{
      agent_id: string;
      agent_type: AgentType;
      agent_status: string;
      health_status: HealthStatus;
      project_id: string;
      process_id: string | null;
      pid: number | null;
      process_status: ProcessStatus | null;
      started_at: Date | null;
      stopped_at: Date | null;
      exit_code: number | null;
      restart_count: number;
      working_directory: string | null;
      uptime_seconds: number | null;
    }>(
      `SELECT * FROM agent_process_status WHERE agent_id = $1`,
      [agentId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      agentId: row.agent_id,
      agentType: row.agent_type,
      agentStatus: row.agent_status,
      healthStatus: row.health_status || 'unknown',
      projectId: row.project_id,
      processId: row.process_id,
      pid: row.pid,
      processStatus: row.process_status,
      startedAt: row.started_at,
      stoppedAt: row.stopped_at,
      exitCode: row.exit_code,
      restartCount: row.restart_count || 0,
      workingDirectory: row.working_directory,
      uptimeSeconds: row.uptime_seconds,
    };
  }

  async getAllAgents(projectId?: string): Promise<AgentProcessStatus[]> {
    const db = getDatabase();

    const query = projectId
      ? `SELECT * FROM agent_process_status WHERE project_id = $1`
      : `SELECT * FROM agent_process_status`;

    const params = projectId ? [projectId] : [];
    const result = await db.query<{
      agent_id: string;
      agent_type: AgentType;
      agent_status: string;
      health_status: HealthStatus;
      project_id: string;
      process_id: string | null;
      pid: number | null;
      process_status: ProcessStatus | null;
      started_at: Date | null;
      stopped_at: Date | null;
      exit_code: number | null;
      restart_count: number;
      working_directory: string | null;
      uptime_seconds: number | null;
    }>(query, params);

    return result.rows.map(row => ({
      agentId: row.agent_id,
      agentType: row.agent_type,
      agentStatus: row.agent_status,
      healthStatus: row.health_status || 'unknown',
      projectId: row.project_id,
      processId: row.process_id,
      pid: row.pid,
      processStatus: row.process_status,
      startedAt: row.started_at,
      stoppedAt: row.stopped_at,
      exitCode: row.exit_code,
      restartCount: row.restart_count || 0,
      workingDirectory: row.working_directory,
      uptimeSeconds: row.uptime_seconds,
    }));
  }

  async getManagerStatus(projectId?: string): Promise<LifecycleManagerStatus> {
    const agents = await this.getAllAgents(projectId);

    const runningAgents = agents.filter(a => a.processStatus === 'running').length;
    const stoppedAgents = agents.filter(a => ['stopped', 'terminated'].includes(a.processStatus || '')).length;
    const crashedAgents = agents.filter(a => a.processStatus === 'crashed').length;

    return {
      running: this.running,
      totalAgents: agents.length,
      runningAgents,
      stoppedAgents,
      crashedAgents,
      agents,
    };
  }

  // ========== Health Methods ==========

  async checkAgentHealth(agentId: string): Promise<AgentHealth> {
    return this.monitor.checkHealth(agentId);
  }

  async getAgentResources(agentId: string): Promise<ResourceUsage> {
    return this.monitor.getResourceUsage(agentId);
  }

  async recordAgentResources(
    agentId: string,
    cpuPercent: number,
    memoryMb: number,
    tokensUsed = 0,
    apiCalls = 0,
    filesModified = 0
  ): Promise<void> {
    await this.monitor.recordResourceUsage(agentId, cpuPercent, memoryMb, tokensUsed, apiCalls, filesModified);
  }

  // ========== Bulk Operations ==========

  async spawnAllIdle(projectId: string): Promise<SpawnResult[]> {
    const db = getDatabase();

    const result = await db.query<{ id: string }>(
      `SELECT id FROM agents WHERE project_id = $1 AND status = 'idle'`,
      [projectId]
    );

    const results: SpawnResult[] = [];
    for (const row of result.rows) {
      const spawnResult = await this.spawnAgent({ agentId: row.id });
      results.push(spawnResult);
    }

    this.emit('bulk-spawn-complete', { projectId, count: results.length });
    return results;
  }

  async terminateAll(projectId: string): Promise<TerminateResult[]> {
    const db = getDatabase();

    const result = await db.query<{ id: string }>(
      `SELECT DISTINCT a.id FROM agents a
       JOIN agent_processes ap ON a.id = ap.agent_id
       WHERE a.project_id = $1 AND ap.status IN ('pending', 'starting', 'running')`,
      [projectId]
    );

    const results: TerminateResult[] = [];
    for (const row of result.rows) {
      const termResult = await this.terminateAgent(row.id, true);
      results.push(termResult);
    }

    this.emit('bulk-terminate-complete', { projectId, count: results.length });
    return results;
  }

  async garbageCollect(): Promise<number> {
    const db = getDatabase();

    // Find and clean up processes that have been stopped/crashed for more than 1 hour
    const result = await db.query<{ id: string; agent_id: string }>(
      `SELECT id, agent_id FROM agent_processes
       WHERE status IN ('stopped', 'crashed', 'failed', 'terminated')
       AND stopped_at < NOW() - INTERVAL '1 hour'`
    );

    for (const row of result.rows) {
      await this.terminator.cleanup(row.agent_id);
    }

    // Delete old records
    await db.query(
      `DELETE FROM agent_processes
       WHERE status IN ('stopped', 'crashed', 'failed', 'terminated')
       AND stopped_at < NOW() - INTERVAL '24 hours'`
    );

    this.emit('garbage-collected', { cleanedCount: result.rows.length });
    return result.rows.length;
  }

  // ========== Aggregate Resources ==========

  async getAggregateResources(projectId?: string): Promise<{
    totalTokens: number;
    totalApiCalls: number;
    avgCpu: number;
    totalMemoryMb: number;
    agentCount: number;
  }> {
    const db = getDatabase();

    const query = projectId
      ? `SELECT * FROM project_resource_usage WHERE project_id = $1`
      : `SELECT
           COUNT(DISTINCT agent_id) as agent_count,
           COALESCE(SUM(total_tokens), 0) as total_tokens,
           COALESCE(SUM(total_api_calls), 0) as total_api_calls,
           COALESCE(AVG(avg_cpu), 0) as avg_cpu,
           COALESCE(SUM(avg_memory_mb), 0) as total_memory_mb
         FROM project_resource_usage`;

    const params = projectId ? [projectId] : [];
    const result = await db.query<{
      agent_count: string;
      total_tokens: string;
      total_api_calls: string;
      avg_cpu: string;
      total_memory_mb: string;
    }>(query, params);

    const row = result.rows[0] || {};
    return {
      agentCount: parseInt(row.agent_count || '0', 10),
      totalTokens: parseInt(row.total_tokens || '0', 10),
      totalApiCalls: parseInt(row.total_api_calls || '0', 10),
      avgCpu: parseFloat(row.avg_cpu || '0'),
      totalMemoryMb: parseFloat(row.total_memory_mb || '0'),
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let lifecycleManagerInstance: AgentLifecycleManager | null = null;

export function getLifecycleManager(): AgentLifecycleManager {
  if (!lifecycleManagerInstance) {
    lifecycleManagerInstance = new AgentLifecycleManager();
  }
  return lifecycleManagerInstance;
}

export function initializeLifecycleManager(): AgentLifecycleManager {
  lifecycleManagerInstance = new AgentLifecycleManager();
  return lifecycleManagerInstance;
}
