/**
 * API Endpoints for QA, Mentor, and Monitor Agents
 *
 * Provides REST API endpoints for interacting with the
 * specialized agent services.
 */

import { getDatabase } from '../lib/database.js';
import {
  createQAAgent,
  createMentorAgent,
  createMonitorAgent,
  type E2EConfig,
  type UserFlow,
  type BlockedIssue,
  type CodeContext,
  BlockedCategory,
  IssueSeverity,
} from '../core/index.js';

// Store active agent instances
const qaAgents = new Map<string, ReturnType<typeof createQAAgent>>();
const mentorAgents = new Map<string, ReturnType<typeof createMentorAgent>>();
const monitorAgents = new Map<string, ReturnType<typeof createMonitorAgent>>();

// ============================================================================
// QA Agent Endpoints
// ============================================================================

/**
 * Run E2E tests for a project
 */
export async function runE2ETests(
  projectId: string,
  projectDir: string,
  config?: Partial<E2EConfig>
): Promise<{
  testRunId: string;
  status: string;
  summary: object;
  issues: object[];
}> {
  let qa = qaAgents.get(projectId);

  if (!qa) {
    qa = createQAAgent({ projectId, projectDir });
    await qa.initialize();
    qaAgents.set(projectId, qa);
  }

  const results = await qa.runE2ETests(config);

  return {
    testRunId: results.id,
    status: results.status,
    summary: results.summary,
    issues: results.issues,
  };
}

/**
 * Run visual regression tests
 */
export async function runVisualRegression(
  projectId: string,
  projectDir: string,
  baselineId: string
): Promise<{
  resultId: string;
  status: string;
  summary: object;
  diffs: object[];
}> {
  let qa = qaAgents.get(projectId);

  if (!qa) {
    qa = createQAAgent({ projectId, projectDir });
    await qa.initialize();
    qaAgents.set(projectId, qa);
  }

  const results = await qa.runVisualRegression(baselineId);

  return {
    resultId: results.id,
    status: results.status,
    summary: results.summary,
    diffs: results.diffs,
  };
}

/**
 * Test a specific user flow
 */
export async function testUserFlow(
  projectId: string,
  projectDir: string,
  flow: UserFlow
): Promise<{
  resultId: string;
  flowId: string;
  status: string;
  stepsCompleted: number;
  totalSteps: number;
  issues: object[];
}> {
  let qa = qaAgents.get(projectId);

  if (!qa) {
    qa = createQAAgent({ projectId, projectDir });
    await qa.initialize();
    qaAgents.set(projectId, qa);
  }

  const result = await qa.testUserFlow(flow);

  return {
    resultId: result.id,
    flowId: result.flowId,
    status: result.status,
    stepsCompleted: result.stepsCompleted,
    totalSteps: result.totalSteps,
    issues: result.issues,
  };
}

/**
 * Generate QA report
 */
export async function generateQAReport(
  projectId: string,
  projectDir: string,
  testRunId?: string
): Promise<{
  reportId: string;
  summary: object;
  coverage: object;
  issues: object;
  recommendations: string[];
}> {
  let qa = qaAgents.get(projectId);

  if (!qa) {
    qa = createQAAgent({ projectId, projectDir });
    await qa.initialize();
    qaAgents.set(projectId, qa);
  }

  // Get test results to generate report from
  let testResults;
  if (testRunId) {
    testResults = qa.getTestRun(testRunId);
  }

  if (!testResults) {
    // Run new tests if no results available
    testResults = await qa.runE2ETests();
  }

  const report = await qa.generateReport(testResults);

  return {
    reportId: report.id,
    summary: report.summary,
    coverage: report.coverage,
    issues: report.issues,
    recommendations: report.recommendations,
  };
}

/**
 * Get QA test runs for a project
 */
export async function getQATestRuns(projectId: string): Promise<object[]> {
  const db = getDatabase();
  const result = await db.query(
    `SELECT id, test_type, status, summary, created_at
     FROM qa_test_runs
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [projectId]
  );
  return result.rows;
}

/**
 * Get QA issues for a project
 */
export async function getQAIssues(
  projectId: string,
  filters?: { severity?: string; resolved?: boolean }
): Promise<object[]> {
  const db = getDatabase();
  let query = `SELECT * FROM qa_test_results WHERE project_id = $1`;
  const params: unknown[] = [projectId];

  if (filters?.severity) {
    query += ` AND severity = $${params.length + 1}`;
    params.push(filters.severity);
  }

  if (filters?.resolved !== undefined) {
    query += ` AND resolved = $${params.length + 1}`;
    params.push(filters.resolved);
  }

  query += ` ORDER BY created_at DESC LIMIT 100`;

  const result = await db.query(query, params);
  return result.rows;
}

// ============================================================================
// Mentor Agent Endpoints
// ============================================================================

/**
 * Request guidance for a blocked agent
 */
export async function requestGuidance(
  projectId: string,
  projectDir: string,
  agentId: string,
  issue: Omit<BlockedIssue, 'id' | 'agentId' | 'createdAt'>
): Promise<{
  guidanceId: string;
  type: string;
  title: string;
  content: string;
  confidence: number;
  codeExample?: string;
  steps?: string[];
  warnings?: string[];
}> {
  let mentor = mentorAgents.get(projectId);

  if (!mentor) {
    mentor = createMentorAgent({ projectId, projectDir });
    await mentor.initialize();
    mentorAgents.set(projectId, mentor);
  }

  const fullIssue: BlockedIssue = {
    ...issue,
    id: crypto.randomUUID(),
    agentId,
    createdAt: new Date(),
  };

  const guidance = await mentor.provideGuidance(agentId, fullIssue);

  return {
    guidanceId: guidance.id,
    type: guidance.type,
    title: guidance.title,
    content: guidance.content,
    confidence: guidance.confidence,
    codeExample: guidance.codeExample,
    steps: guidance.steps,
    warnings: guidance.warnings,
  };
}

/**
 * Query knowledge base
 */
export async function queryKnowledge(
  projectId: string,
  projectDir: string,
  query: string
): Promise<Array<{
  id: string;
  category: string;
  topic: string;
  title: string;
  content: string;
  relevanceScore: number;
}>> {
  let mentor = mentorAgents.get(projectId);

  if (!mentor) {
    mentor = createMentorAgent({ projectId, projectDir });
    await mentor.initialize();
    mentorAgents.set(projectId, mentor);
  }

  const results = await mentor.queryKnowledgeBase(query);

  return results.map(r => ({
    id: r.entry.id,
    category: r.entry.category,
    topic: r.entry.topic,
    title: r.entry.title,
    content: r.entry.content,
    relevanceScore: r.relevanceScore,
  }));
}

/**
 * Get best practice suggestions for code
 */
export async function getSuggestions(
  projectId: string,
  projectDir: string,
  context: CodeContext
): Promise<Array<{
  id: string;
  category: string;
  title: string;
  description: string;
  priority: string;
  codeExample?: string;
}>> {
  let mentor = mentorAgents.get(projectId);

  if (!mentor) {
    mentor = createMentorAgent({ projectId, projectDir });
    await mentor.initialize();
    mentorAgents.set(projectId, mentor);
  }

  const suggestions = await mentor.suggestBestPractices(context);

  return suggestions.map(s => ({
    id: s.id,
    category: s.category,
    title: s.title,
    description: s.description,
    priority: s.priority,
    codeExample: s.codeExample,
  }));
}

/**
 * Record guidance outcome
 */
export async function recordGuidanceOutcome(
  projectId: string,
  guidanceId: string,
  helpful: boolean
): Promise<{ success: boolean }> {
  const mentor = mentorAgents.get(projectId);

  if (!mentor) {
    throw new Error('Mentor agent not initialized for this project');
  }

  await mentor.recordGuidanceOutcome(guidanceId, helpful);

  return { success: true };
}

/**
 * Get mentor guidance history
 */
export async function getMentorHistory(projectId: string): Promise<object[]> {
  const db = getDatabase();
  const result = await db.query(
    `SELECT mg.*, a.type as agent_type
     FROM mentor_guidance mg
     LEFT JOIN agents a ON mg.agent_id = a.id
     WHERE a.project_id = $1
     ORDER BY mg.created_at DESC
     LIMIT 50`,
    [projectId]
  );
  return result.rows;
}

/**
 * Get escalations for a project
 */
export async function getEscalations(projectId: string): Promise<object[]> {
  const db = getDatabase();
  const result = await db.query(
    `SELECT * FROM alerts
     WHERE project_id = $1 AND type = 'mentor_escalation'
     ORDER BY created_at DESC
     LIMIT 20`,
    [projectId]
  );
  return result.rows;
}

// ============================================================================
// Monitor Agent Endpoints
// ============================================================================

/**
 * Get agent health status
 */
export async function getAgentHealthStatus(
  projectId: string,
  agentId: string
): Promise<{
  agentId: string;
  agentType: string;
  status: string;
  health: string;
  uptime: number;
  metrics: object;
  issues: string[];
}> {
  let monitor = monitorAgents.get(projectId);

  if (!monitor) {
    monitor = createMonitorAgent({ projectId });
    await monitor.initialize();
    monitorAgents.set(projectId, monitor);
  }

  const status = await monitor.checkAgentHealth(agentId);

  return {
    agentId: status.agentId,
    agentType: status.agentType,
    status: status.status,
    health: status.health,
    uptime: status.uptime,
    metrics: status.metrics,
    issues: status.issues,
  };
}

/**
 * Get resource metrics for a project
 */
export async function getResourceMetrics(
  projectId: string
): Promise<{
  agents: object;
  tokens: object;
  cost: object;
  time: object;
  tasks: object;
  performance: object;
}> {
  let monitor = monitorAgents.get(projectId);

  if (!monitor) {
    monitor = createMonitorAgent({ projectId });
    await monitor.initialize();
    monitorAgents.set(projectId, monitor);
  }

  const metrics = await monitor.monitorResources();

  return {
    agents: metrics.agents,
    tokens: metrics.tokens,
    cost: metrics.cost,
    time: metrics.time,
    tasks: metrics.tasks,
    performance: metrics.performance,
  };
}

/**
 * Detect anomalies in project
 */
export async function detectAnomalies(
  projectId: string
): Promise<Array<{
  id: string;
  type: string;
  severity: string;
  metric: string;
  description: string;
  detectedAt: Date;
}>> {
  let monitor = monitorAgents.get(projectId);

  if (!monitor) {
    monitor = createMonitorAgent({ projectId });
    await monitor.initialize();
    monitorAgents.set(projectId, monitor);
  }

  const anomalies = await monitor.detectAnomalies();

  return anomalies.map(a => ({
    id: a.id,
    type: a.type,
    severity: a.severity,
    metric: a.metric,
    description: a.description,
    detectedAt: a.detectedAt,
  }));
}

/**
 * Send an alert
 */
export async function sendAlert(
  projectId: string,
  alert: {
    level: string;
    type: string;
    title: string;
    message: string;
    agentId?: string;
    context?: object;
  }
): Promise<{ alertId: string }> {
  let monitor = monitorAgents.get(projectId);

  if (!monitor) {
    monitor = createMonitorAgent({ projectId });
    await monitor.initialize();
    monitorAgents.set(projectId, monitor);
  }

  await monitor.sendAlert({
    projectId,
    level: alert.level as unknown as import('../core/index.js').AlertLevel,
    type: alert.type as unknown as import('../core/index.js').AlertType,
    title: alert.title,
    message: alert.message,
    agentId: alert.agentId,
    context: alert.context as Record<string, unknown>,
  });

  // Get the most recent alert for this project
  const db = getDatabase();
  const result = await db.query(
    `SELECT id FROM alerts WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [projectId]
  );

  return { alertId: result.rows[0]?.id };
}

/**
 * Generate health report
 */
export async function generateHealthReport(
  projectId: string
): Promise<{
  reportId: string;
  summary: object;
  agents: object[];
  alerts: object[];
  anomalies: object[];
  trends: object;
  recommendations: string[];
}> {
  let monitor = monitorAgents.get(projectId);

  if (!monitor) {
    monitor = createMonitorAgent({ projectId });
    await monitor.initialize();
    monitorAgents.set(projectId, monitor);
  }

  const report = await monitor.generateHealthReport();

  return {
    reportId: report.id,
    summary: report.summary,
    agents: report.agents,
    alerts: report.alerts,
    anomalies: report.anomalies,
    trends: report.trends,
    recommendations: report.recommendations,
  };
}

/**
 * Get active alerts for a project
 */
export async function getActiveAlerts(
  projectId: string
): Promise<object[]> {
  const db = getDatabase();
  const result = await db.query(
    `SELECT * FROM alerts
     WHERE project_id = $1 AND resolved = false
     ORDER BY
       CASE level
         WHEN 'critical' THEN 1
         WHEN 'warning' THEN 2
         WHEN 'info' THEN 3
         WHEN 'debug' THEN 4
       END,
       created_at DESC
     LIMIT 50`,
    [projectId]
  );
  return result.rows;
}

/**
 * Acknowledge an alert
 */
export async function acknowledgeAlert(
  projectId: string,
  alertId: string,
  acknowledgedBy: string
): Promise<{ success: boolean }> {
  const monitor = monitorAgents.get(projectId);

  if (monitor) {
    await monitor.acknowledgeAlert(alertId, acknowledgedBy);
  } else {
    const db = getDatabase();
    await db.query(
      `UPDATE alerts SET acknowledged = true, acknowledged_by = $1, acknowledged_at = NOW()
       WHERE id = $2`,
      [acknowledgedBy, alertId]
    );
  }

  return { success: true };
}

/**
 * Resolve an alert
 */
export async function resolveAlert(
  projectId: string,
  alertId: string
): Promise<{ success: boolean }> {
  const monitor = monitorAgents.get(projectId);

  if (monitor) {
    await monitor.resolveAlert(alertId);
  } else {
    const db = getDatabase();
    await db.query(
      `UPDATE alerts SET resolved = true, resolved_at = NOW() WHERE id = $1`,
      [alertId]
    );
  }

  return { success: true };
}

/**
 * Get health check history
 */
export async function getHealthHistory(
  projectId: string,
  hours: number = 24
): Promise<object[]> {
  const db = getDatabase();
  const result = await db.query(
    `SELECT created_at, health_level, score
     FROM health_checks
     WHERE project_id = $1 AND created_at > NOW() - INTERVAL '${hours} hours'
     ORDER BY created_at DESC`,
    [projectId]
  );
  return result.rows;
}

/**
 * Start monitoring for a project
 */
export async function startMonitoring(
  projectId: string,
  intervalMs?: number
): Promise<{ agentId: string }> {
  let monitor = monitorAgents.get(projectId);

  if (!monitor) {
    monitor = createMonitorAgent({ projectId, checkIntervalMs: intervalMs });
    await monitor.initialize();
    monitorAgents.set(projectId, monitor);
  }

  monitor.start();

  return { agentId: monitor.getAgentId() };
}

/**
 * Stop monitoring for a project
 */
export async function stopMonitoring(
  projectId: string
): Promise<{ success: boolean }> {
  const monitor = monitorAgents.get(projectId);

  if (monitor) {
    monitor.stop();
    monitorAgents.delete(projectId);
  }

  return { success: true };
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Cleanup agent instances for a project
 */
export function cleanupAgents(projectId: string): void {
  qaAgents.delete(projectId);

  const mentor = mentorAgents.get(projectId);
  if (mentor) {
    mentorAgents.delete(projectId);
  }

  const monitor = monitorAgents.get(projectId);
  if (monitor) {
    monitor.stop();
    monitorAgents.delete(projectId);
  }
}

/**
 * Cleanup all agent instances
 */
export function cleanupAllAgents(): void {
  qaAgents.clear();
  mentorAgents.clear();

  monitorAgents.forEach((monitor) => {
    monitor.stop();
  });
  monitorAgents.clear();
}
