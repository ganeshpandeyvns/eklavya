/**
 * Monitor Agent - Health Monitoring and Alerting
 *
 * Continuously watches system health and reports issues:
 * - Perform health checks on running agents
 * - Monitor resource usage (CPU, memory, tokens, costs)
 * - Detect stuck or failing agents
 * - Send alerts based on configurable thresholds
 * - Generate health reports
 *
 * The Monitor Agent is the watchful guardian that ensures
 * the system operates smoothly and alerts when issues arise.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../lib/database.js';
import { getLearningSystem } from '../learning/index.js';
import { getCache } from '../../lib/cache.js';
import type { AgentType, AgentStatus } from '../../types/index.js';

/**
 * Health status levels
 */
export enum HealthLevel {
  HEALTHY = 'healthy',       // All systems normal
  DEGRADED = 'degraded',     // Some issues but operational
  UNHEALTHY = 'unhealthy',   // Significant issues
  CRITICAL = 'critical',     // System failure or severe issues
}

/**
 * Alert levels matching notification system
 */
export enum AlertLevel {
  CRITICAL = 'critical',   // SMS + Push - immediate action needed
  WARNING = 'warning',     // Push + Email - needs attention soon
  INFO = 'info',           // Push only - informational
  DEBUG = 'debug',         // Log only - for debugging
}

/**
 * Alert types
 */
export enum AlertType {
  AGENT_STUCK = 'agent_stuck',
  AGENT_FAILED = 'agent_failed',
  AGENT_TIMEOUT = 'agent_timeout',
  RESOURCE_HIGH = 'resource_high',
  BUDGET_WARNING = 'budget_warning',
  BUDGET_EXCEEDED = 'budget_exceeded',
  BUILD_FAILED = 'build_failed',
  PERFORMANCE_DEGRADED = 'performance_degraded',
  HEALTH_CHECK_FAILED = 'health_check_failed',
  ANOMALY_DETECTED = 'anomaly_detected',
}

/**
 * Health status for an individual agent
 */
export interface AgentHealthStatus {
  agentId: string;
  agentType: AgentType;
  status: AgentStatus;
  health: HealthLevel;
  lastHeartbeat?: Date;
  lastActivity?: Date;
  uptime: number;
  metrics: {
    tasksCompleted: number;
    tasksFailed: number;
    avgTaskDuration: number;
    tokensUsed: number;
  };
  issues: string[];
  checkedAt: Date;
}

/**
 * Resource metrics for a project
 */
export interface ResourceMetrics {
  projectId: string;
  timestamp: Date;
  agents: {
    total: number;
    active: number;
    idle: number;
    failed: number;
    byType: Record<AgentType, number>;
  };
  tokens: {
    used: number;
    budget: number;
    percentUsed: number;
    estimatedRemaining: number;
  };
  cost: {
    used: number;
    budget: number;
    percentUsed: number;
    projectedTotal: number;
  };
  time: {
    elapsed: number;
    budget: number;
    percentUsed: number;
    estimatedRemaining: number;
  };
  tasks: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
    successRate: number;
  };
  performance: {
    avgTaskDuration: number;
    throughput: number;  // tasks per hour
    errorRate: number;
  };
}

/**
 * Detected anomaly
 */
export interface Anomaly {
  id: string;
  projectId: string;
  type: string;
  severity: AlertLevel;
  metric: string;
  expected: number;
  actual: number;
  deviation: number;
  description: string;
  detectedAt: Date;
}

/**
 * Alert definition
 */
export interface Alert {
  id: string;
  projectId: string;
  agentId?: string;
  level: AlertLevel;
  type: AlertType;
  title: string;
  message: string;
  context?: Record<string, unknown>;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolved: boolean;
  resolvedAt?: Date;
  createdAt: Date;
}

/**
 * Health report for a project
 */
export interface HealthReport {
  id: string;
  projectId: string;
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
    durationMs: number;
  };
  summary: {
    overallHealth: HealthLevel;
    score: number;  // 0-100
    activeAgents: number;
    alertsTriggered: number;
    anomaliesDetected: number;
  };
  agents: AgentHealthStatus[];
  resources: ResourceMetrics;
  alerts: Alert[];
  anomalies: Anomaly[];
  trends: {
    healthTrend: 'improving' | 'stable' | 'declining';
    performanceTrend: 'improving' | 'stable' | 'declining';
    costTrend: 'under_budget' | 'on_track' | 'over_budget';
  };
  recommendations: string[];
}

/**
 * Alert thresholds configuration
 */
export interface AlertThresholds {
  agentStuckMinutes: number;
  agentTimeoutMinutes: number;
  budgetWarningPercent: number;
  budgetCriticalPercent: number;
  errorRateWarning: number;
  errorRateCritical: number;
  taskDurationWarningMs: number;
  memoryWarningPercent: number;
}

/**
 * Monitor agent options
 */
export interface MonitorAgentOptions {
  projectId: string;
  checkIntervalMs?: number;
  alertThresholds?: Partial<AlertThresholds>;
}

/**
 * Default alert thresholds
 */
const DEFAULT_THRESHOLDS: AlertThresholds = {
  agentStuckMinutes: 15,
  agentTimeoutMinutes: 30,
  budgetWarningPercent: 75,
  budgetCriticalPercent: 90,
  errorRateWarning: 0.2,
  errorRateCritical: 0.4,
  taskDurationWarningMs: 300000,  // 5 minutes
  memoryWarningPercent: 80,
};

/**
 * Reward values for RL feedback
 */
const REWARDS = {
  issueDetectedEarly: 0.4,
  falsePositive: -0.3,
  missedIssue: -0.5,
  accuratePrediction: 0.3,
  healthySystem: 0.1,
};

/**
 * Monitor Agent Service
 *
 * Performs health monitoring and alerting with RL-based
 * improvement of detection accuracy over time.
 */
export class MonitorAgent extends EventEmitter {
  private projectId: string;
  private agentId: string;
  private promptId?: string;
  private thresholds: AlertThresholds;
  private checkInterval?: NodeJS.Timeout;
  private checkIntervalMs: number;
  private alerts: Map<string, Alert> = new Map();
  private anomalies: Map<string, Anomaly> = new Map();
  private healthHistory: Array<{ timestamp: Date; health: HealthLevel; score: number }> = [];
  private lastMetrics?: ResourceMetrics;

  constructor(options: MonitorAgentOptions) {
    super();
    this.projectId = options.projectId;
    this.agentId = uuidv4();
    this.checkIntervalMs = options.checkIntervalMs || 60000; // 1 minute default
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options.alertThresholds };
  }

  /**
   * Initialize the Monitor agent with prompt selection via Thompson Sampling
   */
  async initialize(): Promise<void> {
    try {
      const db = getDatabase();
      const learningSystem = getLearningSystem();

      // Select monitor prompt using Thompson Sampling
      const selectedPrompt = await learningSystem.selectPrompt('monitor');
      this.promptId = selectedPrompt?.id;

      // Create agent record
      await db.query(
        `INSERT INTO agents (id, project_id, type, status, prompt_id, created_at, updated_at)
         VALUES ($1, $2, 'monitor', 'working', $3, NOW(), NOW())`,
        [this.agentId, this.projectId, this.promptId]
      );

      this.emit('initialized', {
        agentId: this.agentId,
        promptId: this.promptId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to initialize Monitor agent:`, errorMessage);
      this.emit('error', { phase: 'initialize', error: errorMessage });
      throw error;
    }
  }

  /**
   * Start continuous monitoring
   */
  start(): void {
    this.checkInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.emit('check:error', { error: errorMessage });
      }
    }, this.checkIntervalMs);

    this.emit('monitoring:started', { intervalMs: this.checkIntervalMs });
  }

  /**
   * Stop continuous monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    this.emit('monitoring:stopped');
  }

  /**
   * Perform a complete health check
   */
  async performHealthCheck(): Promise<void> {
    this.emit('check:started');

    try {
      // Check all agents
      const agents = await this.getAllAgents();
      const healthStatuses: AgentHealthStatus[] = [];

      for (const agent of agents) {
        const status = await this.checkAgentHealth(agent.id);
        healthStatuses.push(status);
      }

      // Monitor resources
      const resources = await this.monitorResources();

      // Detect anomalies
      const anomalies = await this.detectAnomalies();

      // Calculate overall health
      const overallHealth = this.calculateOverallHealth(healthStatuses, resources, anomalies);

      // Record health history
      this.healthHistory.push({
        timestamp: new Date(),
        health: overallHealth.level,
        score: overallHealth.score,
      });

      // Keep only last 24 hours of history
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      this.healthHistory = this.healthHistory.filter(h => h.timestamp.getTime() > cutoff);

      // Apply RL reward based on health
      if (overallHealth.level === HealthLevel.HEALTHY) {
        await this.applyReward(REWARDS.healthySystem, {
          type: 'healthy_system',
          score: overallHealth.score,
        });
      }

      this.emit('check:completed', {
        health: overallHealth,
        agents: healthStatuses.length,
        alerts: this.alerts.size,
        anomalies: anomalies.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('check:error', { error: errorMessage });
    }
  }

  /**
   * Check health of a specific agent
   */
  async checkAgentHealth(agentId: string): Promise<AgentHealthStatus> {
    const db = getDatabase();
    const cache = getCache();

    // Try cache first
    const cacheKey = `monitor:agent:${agentId}`;
    const cached = cache.get<AgentHealthStatus>(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await db.query<{
      id: string;
      type: AgentType;
      status: AgentStatus;
      last_heartbeat: Date;
      created_at: Date;
      updated_at: Date;
      metrics: string;
    }>(
      `SELECT * FROM agents WHERE id = $1`,
      [agentId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const agent = result.rows[0];
    const metrics = JSON.parse(agent.metrics || '{}');
    const issues: string[] = [];
    let health = HealthLevel.HEALTHY;

    // Check heartbeat
    if (agent.last_heartbeat) {
      const minutesSinceHeartbeat = (Date.now() - new Date(agent.last_heartbeat).getTime()) / 60000;

      if (minutesSinceHeartbeat > this.thresholds.agentTimeoutMinutes) {
        health = HealthLevel.CRITICAL;
        issues.push(`No heartbeat for ${Math.round(minutesSinceHeartbeat)} minutes`);
        await this.createAlert({
          level: AlertLevel.CRITICAL,
          type: AlertType.AGENT_TIMEOUT,
          title: `Agent ${agent.type} timed out`,
          message: `Agent ${agentId} has not sent a heartbeat in ${Math.round(minutesSinceHeartbeat)} minutes`,
          agentId,
        });
      } else if (minutesSinceHeartbeat > this.thresholds.agentStuckMinutes) {
        health = HealthLevel.UNHEALTHY;
        issues.push(`Potentially stuck - no heartbeat for ${Math.round(minutesSinceHeartbeat)} minutes`);
        await this.createAlert({
          level: AlertLevel.WARNING,
          type: AlertType.AGENT_STUCK,
          title: `Agent ${agent.type} may be stuck`,
          message: `Agent ${agentId} may be stuck - no activity for ${Math.round(minutesSinceHeartbeat)} minutes`,
          agentId,
        });
      }
    }

    // Check status
    if (agent.status === 'failed') {
      health = HealthLevel.CRITICAL;
      issues.push('Agent has failed');
      await this.createAlert({
        level: AlertLevel.CRITICAL,
        type: AlertType.AGENT_FAILED,
        title: `Agent ${agent.type} failed`,
        message: `Agent ${agentId} is in failed state`,
        agentId,
      });
    } else if (agent.status === 'blocked') {
      if (health === HealthLevel.HEALTHY) {
        health = HealthLevel.DEGRADED;
      }
      issues.push('Agent is blocked');
    }

    // Check error rate
    if (metrics.tasksCompleted > 0) {
      const errorRate = metrics.tasksFailed / (metrics.tasksCompleted + metrics.tasksFailed);
      if (errorRate > this.thresholds.errorRateCritical) {
        health = HealthLevel.UNHEALTHY;
        issues.push(`High error rate: ${(errorRate * 100).toFixed(1)}%`);
      } else if (errorRate > this.thresholds.errorRateWarning) {
        if (health === HealthLevel.HEALTHY) {
          health = HealthLevel.DEGRADED;
        }
        issues.push(`Elevated error rate: ${(errorRate * 100).toFixed(1)}%`);
      }
    }

    const status: AgentHealthStatus = {
      agentId: agent.id,
      agentType: agent.type,
      status: agent.status,
      health,
      lastHeartbeat: agent.last_heartbeat ? new Date(agent.last_heartbeat) : undefined,
      lastActivity: new Date(agent.updated_at),
      uptime: Date.now() - new Date(agent.created_at).getTime(),
      metrics: {
        tasksCompleted: metrics.tasksCompleted || 0,
        tasksFailed: metrics.tasksFailed || 0,
        avgTaskDuration: metrics.avgTaskDuration || 0,
        tokensUsed: metrics.tokensUsed || 0,
      },
      issues,
      checkedAt: new Date(),
    };

    // Cache for 30 seconds
    cache.set(cacheKey, status, 30000);

    return status;
  }

  /**
   * Monitor resource usage for the project
   */
  async monitorResources(): Promise<ResourceMetrics> {
    const db = getDatabase();

    // Get project budget info
    const projectResult = await db.query<{
      budget_tokens: number;
      budget_time_hours: number;
      budget_cost_usd: string;
      tokens_used: number;
      cost_used: string;
      created_at: Date;
    }>(
      `SELECT * FROM projects WHERE id = $1`,
      [this.projectId]
    );

    if (projectResult.rows.length === 0) {
      throw new Error(`Project ${this.projectId} not found`);
    }

    const project = projectResult.rows[0];

    // Get agent counts
    const agentResult = await db.query<{
      type: AgentType;
      status: AgentStatus;
      count: string;
    }>(
      `SELECT type, status, COUNT(*) as count
       FROM agents WHERE project_id = $1
       GROUP BY type, status`,
      [this.projectId]
    );

    const agentsByType: Record<string, number> = {};
    let activeAgents = 0;
    let idleAgents = 0;
    let failedAgents = 0;
    let totalAgents = 0;

    for (const row of agentResult.rows) {
      const count = parseInt(row.count, 10);
      totalAgents += count;
      agentsByType[row.type] = (agentsByType[row.type] || 0) + count;

      if (['working', 'idle'].includes(row.status)) {
        activeAgents += count;
      }
      if (row.status === 'idle') {
        idleAgents += count;
      }
      if (row.status === 'failed') {
        failedAgents += count;
      }
    }

    // Get task counts
    const taskResult = await db.query<{
      status: string;
      count: string;
      avg_duration: string;
    }>(
      `SELECT status, COUNT(*) as count,
              AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_duration
       FROM tasks WHERE project_id = $1
       GROUP BY status`,
      [this.projectId]
    );

    let totalTasks = 0;
    let completedTasks = 0;
    let failedTasks = 0;
    let inProgressTasks = 0;
    let pendingTasks = 0;
    let avgTaskDuration = 0;

    for (const row of taskResult.rows) {
      const count = parseInt(row.count, 10);
      totalTasks += count;

      switch (row.status) {
        case 'completed':
          completedTasks += count;
          avgTaskDuration = parseFloat(row.avg_duration) || 0;
          break;
        case 'failed':
          failedTasks += count;
          break;
        case 'in_progress':
        case 'assigned':
          inProgressTasks += count;
          break;
        case 'pending':
          pendingTasks += count;
          break;
      }
    }

    // Calculate metrics
    const tokensUsed = project.tokens_used || 0;
    const tokensBudget = project.budget_tokens || 1000000;
    const costUsed = parseFloat(project.cost_used) || 0;
    const costBudget = parseFloat(project.budget_cost_usd) || 100;
    const timeElapsed = Date.now() - new Date(project.created_at).getTime();
    const timeBudget = (project.budget_time_hours || 24) * 60 * 60 * 1000;

    const successRate = totalTasks > 0
      ? completedTasks / (completedTasks + failedTasks) || 0
      : 1;

    const errorRate = totalTasks > 0
      ? failedTasks / totalTasks
      : 0;

    const throughput = timeElapsed > 0
      ? completedTasks / (timeElapsed / 3600000)  // tasks per hour
      : 0;

    const metrics: ResourceMetrics = {
      projectId: this.projectId,
      timestamp: new Date(),
      agents: {
        total: totalAgents,
        active: activeAgents,
        idle: idleAgents,
        failed: failedAgents,
        byType: agentsByType as Record<AgentType, number>,
      },
      tokens: {
        used: tokensUsed,
        budget: tokensBudget,
        percentUsed: (tokensUsed / tokensBudget) * 100,
        estimatedRemaining: tokensBudget - tokensUsed,
      },
      cost: {
        used: costUsed,
        budget: costBudget,
        percentUsed: (costUsed / costBudget) * 100,
        projectedTotal: timeElapsed > 0
          ? (costUsed / timeElapsed) * timeBudget
          : costUsed,
      },
      time: {
        elapsed: timeElapsed,
        budget: timeBudget,
        percentUsed: (timeElapsed / timeBudget) * 100,
        estimatedRemaining: timeBudget - timeElapsed,
      },
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        failed: failedTasks,
        inProgress: inProgressTasks,
        pending: pendingTasks,
        successRate,
      },
      performance: {
        avgTaskDuration,
        throughput,
        errorRate,
      },
    };

    // Check for budget warnings
    if (metrics.cost.percentUsed >= this.thresholds.budgetCriticalPercent) {
      await this.createAlert({
        level: AlertLevel.CRITICAL,
        type: AlertType.BUDGET_EXCEEDED,
        title: 'Budget nearly exhausted',
        message: `Cost usage at ${metrics.cost.percentUsed.toFixed(1)}% of budget`,
        context: { costUsed, costBudget },
      });
    } else if (metrics.cost.percentUsed >= this.thresholds.budgetWarningPercent) {
      await this.createAlert({
        level: AlertLevel.WARNING,
        type: AlertType.BUDGET_WARNING,
        title: 'Budget warning',
        message: `Cost usage at ${metrics.cost.percentUsed.toFixed(1)}% of budget`,
        context: { costUsed, costBudget },
      });
    }

    // Store metrics
    await this.storeResourceMetrics(metrics);
    this.lastMetrics = metrics;

    return metrics;
  }

  /**
   * Detect anomalies in system behavior
   */
  async detectAnomalies(): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    if (!this.lastMetrics) {
      return anomalies;
    }

    // Get historical metrics for comparison
    const db = getDatabase();
    const historyResult = await db.query<{
      avg_error_rate: string;
      avg_task_duration: string;
      avg_throughput: string;
      stddev_error_rate: string;
      stddev_task_duration: string;
    }>(
      `SELECT
         AVG((metrics->>'errorRate')::float) as avg_error_rate,
         AVG((metrics->>'avgTaskDuration')::float) as avg_task_duration,
         AVG((metrics->>'throughput')::float) as avg_throughput,
         STDDEV((metrics->>'errorRate')::float) as stddev_error_rate,
         STDDEV((metrics->>'avgTaskDuration')::float) as stddev_task_duration
       FROM resource_metrics
       WHERE project_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [this.projectId]
    );

    if (historyResult.rows.length > 0) {
      const history = historyResult.rows[0];
      const avgErrorRate = parseFloat(history.avg_error_rate) || 0;
      const stddevErrorRate = parseFloat(history.stddev_error_rate) || 0.1;
      const avgTaskDuration = parseFloat(history.avg_task_duration) || 0;
      const stddevTaskDuration = parseFloat(history.stddev_task_duration) || 1000;

      // Check for error rate anomaly (> 2 standard deviations)
      if (this.lastMetrics.performance.errorRate > avgErrorRate + 2 * stddevErrorRate) {
        const anomaly: Anomaly = {
          id: uuidv4(),
          projectId: this.projectId,
          type: 'error_rate_spike',
          severity: AlertLevel.WARNING,
          metric: 'error_rate',
          expected: avgErrorRate,
          actual: this.lastMetrics.performance.errorRate,
          deviation: (this.lastMetrics.performance.errorRate - avgErrorRate) / (stddevErrorRate || 0.1),
          description: `Error rate ${(this.lastMetrics.performance.errorRate * 100).toFixed(1)}% is significantly higher than average ${(avgErrorRate * 100).toFixed(1)}%`,
          detectedAt: new Date(),
        };

        anomalies.push(anomaly);
        await this.storeAnomaly(anomaly);
        await this.createAlert({
          level: AlertLevel.WARNING,
          type: AlertType.ANOMALY_DETECTED,
          title: 'Unusual error rate detected',
          message: anomaly.description,
          context: { anomalyId: anomaly.id },
        });

        // Apply RL reward for early detection
        await this.applyReward(REWARDS.issueDetectedEarly, {
          type: 'anomaly_detected',
          metric: 'error_rate',
          deviation: anomaly.deviation,
        });
      }

      // Check for task duration anomaly
      if (this.lastMetrics.performance.avgTaskDuration > avgTaskDuration + 2 * stddevTaskDuration) {
        const anomaly: Anomaly = {
          id: uuidv4(),
          projectId: this.projectId,
          type: 'slow_tasks',
          severity: AlertLevel.INFO,
          metric: 'task_duration',
          expected: avgTaskDuration,
          actual: this.lastMetrics.performance.avgTaskDuration,
          deviation: (this.lastMetrics.performance.avgTaskDuration - avgTaskDuration) / (stddevTaskDuration || 1000),
          description: `Average task duration ${Math.round(this.lastMetrics.performance.avgTaskDuration)}ms is significantly higher than average ${Math.round(avgTaskDuration)}ms`,
          detectedAt: new Date(),
        };

        anomalies.push(anomaly);
        await this.storeAnomaly(anomaly);
      }
    }

    // Store anomalies locally
    for (const anomaly of anomalies) {
      this.anomalies.set(anomaly.id, anomaly);
    }

    return anomalies;
  }

  /**
   * Create and send an alert
   */
  async sendAlert(alert: Omit<Alert, 'id' | 'acknowledged' | 'resolved' | 'createdAt'>): Promise<void> {
    await this.createAlert(alert);
  }

  /**
   * Create an alert
   */
  private async createAlert(
    alertData: Omit<Alert, 'id' | 'projectId' | 'acknowledged' | 'resolved' | 'createdAt'>
  ): Promise<Alert> {
    // Check for duplicate recent alerts
    const recentSimilar = Array.from(this.alerts.values()).find(
      a => a.type === alertData.type &&
           a.agentId === alertData.agentId &&
           !a.resolved &&
           Date.now() - a.createdAt.getTime() < 300000  // 5 minutes
    );

    if (recentSimilar) {
      return recentSimilar;  // Don't create duplicate
    }

    const alert: Alert = {
      ...alertData,
      id: uuidv4(),
      projectId: this.projectId,
      acknowledged: false,
      resolved: false,
      createdAt: new Date(),
    };

    // Store in database
    const db = getDatabase();
    await db.query(
      `INSERT INTO alerts (id, project_id, agent_id, level, type, title, message,
        context, acknowledged, resolved, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        alert.id, alert.projectId, alert.agentId, alert.level, alert.type,
        alert.title, alert.message, JSON.stringify(alert.context),
        alert.acknowledged, alert.resolved, alert.createdAt,
      ]
    );

    this.alerts.set(alert.id, alert);
    this.emit('alert:created', alert);

    return alert;
  }

  /**
   * Generate a comprehensive health report
   */
  async generateHealthReport(): Promise<HealthReport> {
    const reportId = uuidv4();
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);  // Last 24 hours

    // Get all agent health statuses
    const agents = await this.getAllAgents();
    const agentStatuses: AgentHealthStatus[] = [];
    for (const agent of agents) {
      const status = await this.checkAgentHealth(agent.id);
      agentStatuses.push(status);
    }

    // Get current resources
    const resources = await this.monitorResources();

    // Get recent alerts
    const recentAlerts = Array.from(this.alerts.values()).filter(
      a => a.createdAt >= startTime
    );

    // Get recent anomalies
    const recentAnomalies = Array.from(this.anomalies.values()).filter(
      a => a.detectedAt >= startTime
    );

    // Calculate overall health
    const overallHealth = this.calculateOverallHealth(agentStatuses, resources, recentAnomalies);

    // Determine trends
    const trends = this.calculateTrends(resources);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      agentStatuses,
      resources,
      recentAlerts,
      recentAnomalies
    );

    const report: HealthReport = {
      id: reportId,
      projectId: this.projectId,
      generatedAt: endTime,
      period: {
        start: startTime,
        end: endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
      },
      summary: {
        overallHealth: overallHealth.level,
        score: overallHealth.score,
        activeAgents: agentStatuses.filter(a => ['working', 'idle'].includes(a.status)).length,
        alertsTriggered: recentAlerts.length,
        anomaliesDetected: recentAnomalies.length,
      },
      agents: agentStatuses,
      resources,
      alerts: recentAlerts,
      anomalies: recentAnomalies,
      trends,
      recommendations,
    };

    // Store report
    await this.storeHealthReport(report);

    this.emit('report:generated', report);
    return report;
  }

  /**
   * Get all agents for the project
   */
  private async getAllAgents(): Promise<Array<{ id: string; type: AgentType; status: AgentStatus }>> {
    const db = getDatabase();
    const result = await db.query<{ id: string; type: AgentType; status: AgentStatus }>(
      `SELECT id, type, status FROM agents WHERE project_id = $1`,
      [this.projectId]
    );
    return result.rows;
  }

  /**
   * Calculate overall health from individual statuses
   */
  private calculateOverallHealth(
    agents: AgentHealthStatus[],
    resources: ResourceMetrics,
    anomalies: Anomaly[]
  ): { level: HealthLevel; score: number } {
    let score = 100;
    let worstLevel = HealthLevel.HEALTHY;

    // Agent health impacts
    for (const agent of agents) {
      switch (agent.health) {
        case HealthLevel.CRITICAL:
          score -= 20;
          worstLevel = HealthLevel.CRITICAL;
          break;
        case HealthLevel.UNHEALTHY:
          score -= 10;
          if (worstLevel === HealthLevel.HEALTHY) {
            worstLevel = HealthLevel.UNHEALTHY;
          }
          break;
        case HealthLevel.DEGRADED:
          score -= 5;
          if (worstLevel === HealthLevel.HEALTHY) {
            worstLevel = HealthLevel.DEGRADED;
          }
          break;
      }
    }

    // Resource impacts
    if (resources.cost.percentUsed > 90) {
      score -= 15;
      if (worstLevel !== HealthLevel.CRITICAL) {
        worstLevel = HealthLevel.UNHEALTHY;
      }
    } else if (resources.cost.percentUsed > 75) {
      score -= 5;
    }

    if (resources.tasks.successRate < 0.7) {
      score -= 10;
    }

    // Anomaly impacts
    for (const anomaly of anomalies) {
      if (anomaly.severity === AlertLevel.CRITICAL) {
        score -= 15;
      } else if (anomaly.severity === AlertLevel.WARNING) {
        score -= 5;
      }
    }

    score = Math.max(0, Math.min(100, score));

    // Determine final level based on score
    let level: HealthLevel;
    if (worstLevel === HealthLevel.CRITICAL || score < 40) {
      level = HealthLevel.CRITICAL;
    } else if (worstLevel === HealthLevel.UNHEALTHY || score < 60) {
      level = HealthLevel.UNHEALTHY;
    } else if (worstLevel === HealthLevel.DEGRADED || score < 80) {
      level = HealthLevel.DEGRADED;
    } else {
      level = HealthLevel.HEALTHY;
    }

    return { level, score };
  }

  /**
   * Calculate trends from historical data
   */
  private calculateTrends(resources: ResourceMetrics): HealthReport['trends'] {
    // Health trend from history
    let healthTrend: 'improving' | 'stable' | 'declining' = 'stable';
    if (this.healthHistory.length >= 2) {
      const recent = this.healthHistory.slice(-5);
      const avgRecent = recent.reduce((sum, h) => sum + h.score, 0) / recent.length;
      const older = this.healthHistory.slice(-10, -5);
      if (older.length > 0) {
        const avgOlder = older.reduce((sum, h) => sum + h.score, 0) / older.length;
        if (avgRecent > avgOlder + 5) {
          healthTrend = 'improving';
        } else if (avgRecent < avgOlder - 5) {
          healthTrend = 'declining';
        }
      }
    }

    // Performance trend
    const performanceTrend: 'improving' | 'stable' | 'declining' =
      resources.tasks.successRate > 0.9 ? 'improving' :
      resources.tasks.successRate < 0.7 ? 'declining' : 'stable';

    // Cost trend
    const costTrend: 'under_budget' | 'on_track' | 'over_budget' =
      resources.cost.percentUsed > resources.time.percentUsed + 10 ? 'over_budget' :
      resources.cost.percentUsed < resources.time.percentUsed - 10 ? 'under_budget' : 'on_track';

    return { healthTrend, performanceTrend, costTrend };
  }

  /**
   * Generate recommendations based on current state
   */
  private generateRecommendations(
    agents: AgentHealthStatus[],
    resources: ResourceMetrics,
    alerts: Alert[],
    anomalies: Anomaly[]
  ): string[] {
    const recommendations: string[] = [];

    // Agent-based recommendations
    const failedAgents = agents.filter(a => a.health === HealthLevel.CRITICAL);
    if (failedAgents.length > 0) {
      recommendations.push(`Restart or investigate ${failedAgents.length} failed agent(s)`);
    }

    const stuckAgents = agents.filter(a => a.issues.some(i => i.includes('stuck')));
    if (stuckAgents.length > 0) {
      recommendations.push(`Check ${stuckAgents.length} potentially stuck agent(s)`);
    }

    // Resource-based recommendations
    if (resources.cost.percentUsed > 80) {
      recommendations.push('Consider increasing budget or optimizing resource usage');
    }

    if (resources.tasks.successRate < 0.8) {
      recommendations.push('Investigate failing tasks and improve error handling');
    }

    if (resources.performance.errorRate > 0.1) {
      recommendations.push('High error rate detected - review logs and fix root causes');
    }

    // Alert-based recommendations
    const unresolvedAlerts = alerts.filter(a => !a.resolved);
    if (unresolvedAlerts.length > 5) {
      recommendations.push(`${unresolvedAlerts.length} unresolved alerts require attention`);
    }

    // Anomaly-based recommendations
    if (anomalies.length > 0) {
      recommendations.push('Anomalies detected - review system behavior patterns');
    }

    // Performance recommendations
    if (resources.performance.avgTaskDuration > this.thresholds.taskDurationWarningMs) {
      recommendations.push('Tasks taking longer than expected - optimize or parallelize');
    }

    return recommendations.slice(0, 5);  // Return top 5 recommendations
  }

  /**
   * Store resource metrics in database
   */
  private async storeResourceMetrics(metrics: ResourceMetrics): Promise<void> {
    const db = getDatabase();
    await db.query(
      `INSERT INTO resource_metrics (id, project_id, metrics, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [uuidv4(), metrics.projectId, JSON.stringify(metrics)]
    );
  }

  /**
   * Store anomaly in database
   */
  private async storeAnomaly(anomaly: Anomaly): Promise<void> {
    // Anomalies are stored in alerts table with type 'anomaly_detected'
    // Already handled by createAlert
  }

  /**
   * Store health report in database
   */
  private async storeHealthReport(report: HealthReport): Promise<void> {
    const db = getDatabase();
    await db.query(
      `INSERT INTO health_checks (id, project_id, health_level, score, summary,
        agents_data, resources_data, alerts_data, recommendations, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        report.id, report.projectId, report.summary.overallHealth, report.summary.score,
        JSON.stringify(report.summary), JSON.stringify(report.agents),
        JSON.stringify(report.resources), JSON.stringify(report.alerts),
        JSON.stringify(report.recommendations), report.generatedAt,
      ]
    );
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
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) return;

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    const db = getDatabase();
    await db.query(
      `UPDATE alerts SET acknowledged = true, acknowledged_by = $1, acknowledged_at = $2
       WHERE id = $3`,
      [acknowledgedBy, alert.acknowledgedAt, alertId]
    );

    this.emit('alert:acknowledged', alert);
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) return;

    alert.resolved = true;
    alert.resolvedAt = new Date();

    const db = getDatabase();
    await db.query(
      `UPDATE alerts SET resolved = true, resolved_at = $1 WHERE id = $2`,
      [alert.resolvedAt, alertId]
    );

    this.emit('alert:resolved', alert);
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter(a => !a.resolved);
  }

  /**
   * Get recent anomalies
   */
  getRecentAnomalies(): Anomaly[] {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return Array.from(this.anomalies.values()).filter(
      a => a.detectedAt.getTime() > cutoff
    );
  }

  /**
   * Get last metrics
   */
  getLastMetrics(): ResourceMetrics | undefined {
    return this.lastMetrics;
  }
}

/**
 * Factory function to create a Monitor agent
 */
export function createMonitorAgent(options: MonitorAgentOptions): MonitorAgent {
  return new MonitorAgent(options);
}

/**
 * Run a quick health check for a project
 */
export async function quickHealthCheck(projectId: string): Promise<{
  health: HealthLevel;
  score: number;
  alerts: Alert[];
}> {
  const monitor = createMonitorAgent({ projectId });
  await monitor.initialize();
  await monitor.performHealthCheck();

  const report = await monitor.generateHealthReport();

  return {
    health: report.summary.overallHealth,
    score: report.summary.score,
    alerts: report.alerts,
  };
}
