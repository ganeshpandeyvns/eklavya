#!/usr/bin/env tsx
/**
 * Demo₃ Autonomous Task Execution Tester
 *
 * This script verifies all Demo₃ success criteria:
 * 1. Task queue operations work correctly
 * 2. Orchestrator can start/stop and manage state
 * 3. Tasks can be assigned to agents
 * 4. Checkpoint system works for recovery
 * 5. Real-time updates via WebSocket
 * 6. Error recovery with retry mechanism
 */

import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { getDatabase } from '../lib/database.js';
import { getLearningSystem } from '../core/learning/index.js';

// Configuration
const CONFIG = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'eklavya',
    user: process.env.DB_USER || 'eklavya',
    password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
  },
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  wsUrl: process.env.WS_URL || 'ws://localhost:4001',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(msg: string, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

interface TestResult {
  name: string;
  category: string;
  pass: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  category: string,
  testFn: () => Promise<boolean>
): Promise<boolean> {
  const start = Date.now();
  try {
    const pass = await testFn();
    const duration = Date.now() - start;
    results.push({ name, category, pass, duration });
    log(`  ${pass ? '✓' : '✗'} ${name} (${duration}ms)`, pass ? colors.green : colors.red);
    return pass;
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({ name, category, pass: false, duration, error: errorMsg });
    log(`  ✗ ${name} (${duration}ms) - ${errorMsg}`, colors.red);
    return false;
  }
}

// Store test data for cleanup
let testProjectId: string | null = null;
let testTaskId: string | null = null;
let testAgentId: string | null = null;

async function testTaskQueueOperations(): Promise<number> {
  log('\n📋 Task Queue Operations', colors.cyan);
  let passed = 0;

  // First create a project for testing
  const projectRes = await fetch(`${CONFIG.apiUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Demo3 Test ${Date.now()}`,
      description: 'Demo3 task execution test',
    }),
  });
  const project = await projectRes.json() as { id: string };
  testProjectId = project.id;

  // Test 1: Create task via enhanced endpoint
  if (await runTest('Create task with full specification', 'task_queue', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: testProjectId,
        title: 'Test Task - Write Hello World',
        description: 'Write a simple hello world function',
        type: 'developer_task',
        specification: {
          agentType: 'developer',
          files: ['src/hello.ts'],
          requirements: ['Write TypeScript function'],
        },
        priority: 8,
        maxRetries: 3,
        estimatedDurationMinutes: 5,
      }),
    });
    const task = await res.json() as { id: string; title: string; priority: number };
    testTaskId = task.id;
    return res.status === 201 && task.id && task.priority === 8;
  })) passed++;

  // Test 2: Get task by ID
  if (await runTest('Get task by ID with details', 'task_queue', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/tasks/${testTaskId}`);
    const task = await res.json() as { id: string; specification: unknown };
    return res.ok && task.id === testTaskId && task.specification;
  })) passed++;

  // Test 3: List tasks with filters
  if (await runTest('List tasks with status filter', 'task_queue', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/tasks?projectId=${testProjectId}&status=pending`);
    const tasks = await res.json() as Array<{ id: string }>;
    return res.ok && Array.isArray(tasks);
  })) passed++;

  // Test 4: Get task queue stats
  if (await runTest('Get task queue statistics', 'task_queue', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/tasks/queue/stats?projectId=${testProjectId}`);
    const stats = await res.json() as { statusBreakdown: Record<string, number>; metrics: unknown };
    return res.ok && typeof stats.statusBreakdown === 'object' && stats.metrics;
  })) passed++;

  // Test 5: Get next available task
  if (await runTest('Get next available task for agent type', 'task_queue', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/tasks/queue/next?projectId=${testProjectId}&agentType=developer`);
    const result = await res.json() as { task: { id: string } | null };
    return res.ok && (result.task === null || result.task.id);
  })) passed++;

  return passed;
}

async function testOrchestratorOperations(): Promise<number> {
  log('\n🎭 Orchestrator Operations', colors.cyan);
  let passed = 0;

  // Test 1: Get orchestrator status
  if (await runTest('Get orchestrator status', 'orchestrator', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/orchestrator/status?projectId=${testProjectId}`);
    const status = await res.json() as { projectId: string; status: string };
    return res.ok && status.projectId === testProjectId;
  })) passed++;

  // Test 2: Start orchestrator
  if (await runTest('Start orchestrator', 'orchestrator', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/orchestrator/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: testProjectId }),
    });
    const result = await res.json() as { success: boolean; status: string };
    return res.ok && result.success && result.status === 'running';
  })) passed++;

  // Test 3: Verify orchestrator state persisted
  if (await runTest('Orchestrator state persisted', 'orchestrator', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/orchestrator/status?projectId=${testProjectId}`);
    const status = await res.json() as { status: string };
    return res.ok && status.status === 'running';
  })) passed++;

  // Test 4: Submit execution plan
  if (await runTest('Submit execution plan', 'orchestrator', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/orchestrator/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: testProjectId,
        plan: {
          phases: [
            {
              phaseNumber: 1,
              tasks: [
                {
                  title: 'Create project structure',
                  description: 'Set up initial files and folders',
                  type: 'setup',
                  agentType: 'developer',
                  priority: 9,
                },
              ],
            },
            {
              phaseNumber: 2,
              tasks: [
                {
                  title: 'Implement core logic',
                  description: 'Write main application code',
                  type: 'implementation',
                  agentType: 'developer',
                  priority: 8,
                },
                {
                  title: 'Write tests',
                  description: 'Create unit tests',
                  type: 'testing',
                  agentType: 'tester',
                  priority: 7,
                },
              ],
            },
          ],
        },
      }),
    });
    const result = await res.json() as { success: boolean; tasks: Array<{ id: string }> };
    return res.status === 201 && result.success && result.tasks.length === 3;
  })) passed++;

  // Test 5: Stop orchestrator
  if (await runTest('Stop orchestrator', 'orchestrator', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/orchestrator/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: testProjectId }),
    });
    const result = await res.json() as { success: boolean; status: string };
    return res.ok && result.success && result.status === 'stopped';
  })) passed++;

  return passed;
}

async function testTaskAssignment(): Promise<number> {
  log('\n🔗 Task Assignment & Execution', colors.cyan);
  let passed = 0;

  // Create an agent for testing
  const db = getDatabase(CONFIG.database);
  const agentResult = await db.query<{ id: string }>(
    `INSERT INTO agents (project_id, type, status)
     VALUES ($1, 'developer', 'idle')
     RETURNING id`,
    [testProjectId]
  );
  testAgentId = agentResult.rows[0].id;

  // Test 1: Assign task to agent
  if (await runTest('Assign task to agent', 'assignment', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/tasks/${testTaskId}/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: testAgentId }),
    });
    const result = await res.json() as { success: boolean; task: { status: string } };
    return res.ok && result.success && result.task.status === 'in_progress';
  })) passed++;

  // Test 2: Get task shows assigned agent
  if (await runTest('Task shows assigned agent', 'assignment', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/tasks/${testTaskId}`);
    const task = await res.json() as { assignedAgentId: string };
    return res.ok && task.assignedAgentId === testAgentId;
  })) passed++;

  // Test 3: Complete task with result
  if (await runTest('Complete task with result', 'assignment', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/tasks/${testTaskId}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        result: {
          filesCreated: ['src/hello.ts'],
          linesOfCode: 25,
          success: true,
        },
        metrics: {
          executionTimeMs: 5000,
          tokensUsed: 1500,
          filesWritten: 1,
        },
      }),
    });
    const result = await res.json() as { success: boolean; task: { status: string } };
    return res.ok && result.success && result.task.status === 'completed';
  })) passed++;

  // Create another task for failure testing
  const failTaskRes = await fetch(`${CONFIG.apiUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: testProjectId,
      title: 'Task that will fail',
      description: 'This task will be marked as failed for testing',
      type: 'test',
      maxRetries: 2,
    }),
  });
  const failTask = await failTaskRes.json() as { id: string };

  // Assign it first
  await fetch(`${CONFIG.apiUrl}/api/tasks/${failTask.id}/assign`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: testAgentId }),
  });

  // Test 4: Fail task with retry
  if (await runTest('Fail task triggers retry', 'assignment', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/tasks/${failTask.id}/fail`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        errorMessage: 'Test failure - compilation error',
        shouldRetry: true,
      }),
    });
    const result = await res.json() as { status: string; retryCount: number };
    return res.ok && result.status === 'retrying' && result.retryCount === 1;
  })) passed++;

  // Test 5: Cancel task
  const cancelTaskRes = await fetch(`${CONFIG.apiUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: testProjectId,
      title: 'Task to cancel',
      description: 'This task will be cancelled',
      type: 'test',
    }),
  });
  const cancelTask = await cancelTaskRes.json() as { id: string };

  if (await runTest('Cancel pending task', 'assignment', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/tasks/${cancelTask.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'No longer needed' }),
    });
    const result = await res.json() as { success: boolean };
    return res.ok && result.success;
  })) passed++;

  return passed;
}

async function testCheckpointSystem(): Promise<number> {
  log('\n💾 Checkpoint System', colors.cyan);
  let passed = 0;

  // Test 1: Force checkpoint for agent
  if (await runTest('Force checkpoint for agent', 'checkpoint', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/agents/${testAgentId}/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          currentStep: 'writing_code',
          progress: 50,
          workingMemory: { currentFile: 'src/hello.ts' },
          pendingActions: ['write_test', 'run_lint'],
        },
        recoveryInstructions: 'Resume from checkpoint: continue writing hello.ts',
      }),
    });
    const result = await res.json() as { success: boolean; checkpointId: string };
    return res.ok && result.success && result.checkpointId;
  })) passed++;

  // Test 2: Get checkpoint stats
  if (await runTest('Get checkpoint statistics', 'checkpoint', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/checkpoints?projectId=${testProjectId}`);
    const stats = await res.json() as { totalCheckpoints: number };
    return res.ok && typeof stats.totalCheckpoints === 'number';
  })) passed++;

  // Test 3: Get agent checkpoints
  if (await runTest('Get agent checkpoint history', 'checkpoint', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/checkpoints/${testAgentId}?limit=5`);
    const checkpoints = await res.json() as Array<{ id: string }>;
    return res.ok && Array.isArray(checkpoints) && checkpoints.length > 0;
  })) passed++;

  // Test 4: Resume from checkpoint
  if (await runTest('Resume agent from checkpoint', 'checkpoint', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/agents/${testAgentId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // Will use latest checkpoint
    });
    const result = await res.json() as { success: boolean; restoredState: unknown };
    return res.ok && result.success && result.restoredState;
  })) passed++;

  return passed;
}

async function testAgentMessaging(): Promise<number> {
  log('\n📨 Agent Messaging', colors.cyan);
  let passed = 0;

  // Test 1: Send message to agent
  if (await runTest('Send message to agent', 'messaging', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/agents/${testAgentId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'task_assign',
        payload: {
          taskId: testTaskId,
          priority: 'high',
          deadline: new Date(Date.now() + 3600000).toISOString(),
        },
      }),
    });
    const result = await res.json() as { success: boolean; messageId: string };
    return res.ok && result.success && result.messageId;
  })) passed++;

  // Test 2: Get agent messages
  if (await runTest('Get agent message queue', 'messaging', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/agents/${testAgentId}/messages?limit=10`);
    const messages = await res.json() as Array<{ id: string; type: string }>;
    return res.ok && Array.isArray(messages) && messages.length > 0;
  })) passed++;

  // Test 3: Get unprocessed messages only
  if (await runTest('Filter unprocessed messages', 'messaging', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/agents/${testAgentId}/messages?unprocessedOnly=true`);
    const messages = await res.json();
    return res.ok && Array.isArray(messages);
  })) passed++;

  return passed;
}

async function testExecutionLogs(): Promise<number> {
  log('\n📝 Execution Logs', colors.cyan);
  let passed = 0;

  // Test 1: Get execution logs
  if (await runTest('Get execution logs', 'logs', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/execution-logs?projectId=${testProjectId}&limit=50`);
    const logs = await res.json();
    return res.ok && Array.isArray(logs);
  })) passed++;

  // Test 2: Filter logs by agent
  if (await runTest('Filter logs by agent', 'logs', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/execution-logs?agentId=${testAgentId}`);
    const logs = await res.json();
    return res.ok && Array.isArray(logs);
  })) passed++;

  // Test 3: Filter logs by level
  if (await runTest('Filter logs by level', 'logs', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/execution-logs?level=info&limit=20`);
    const logs = await res.json();
    return res.ok && Array.isArray(logs);
  })) passed++;

  return passed;
}

async function testWebSocketUpdates(): Promise<number> {
  log('\n🔌 WebSocket Real-Time Updates', colors.cyan);
  let passed = 0;

  // Test 1: WebSocket connects
  if (await runTest('WebSocket server connects', 'websocket', async () => {
    return new Promise((resolve) => {
      const ws = new WebSocket(CONFIG.wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  })) passed++;

  // Test 2: Subscribe to task updates
  if (await runTest('Subscribe to task channel', 'websocket', async () => {
    return new Promise((resolve) => {
      const ws = new WebSocket(CONFIG.wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          payload: { channels: ['tasks', 'agents'] },
        }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string };
          if (msg.type === 'subscribed') {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  })) passed++;

  return passed;
}

async function testLatency(): Promise<number> {
  log('\n⚡ Performance & Latency', colors.cyan);
  let passed = 0;

  // Test 1: Task creation latency
  if (await runTest('Task creation < 200ms', 'latency', async () => {
    const start = Date.now();
    await fetch(`${CONFIG.apiUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: testProjectId,
        title: 'Latency test task',
        type: 'test',
      }),
    });
    return (Date.now() - start) < 200;
  })) passed++;

  // Test 2: Queue stats latency
  if (await runTest('Queue stats query < 100ms', 'latency', async () => {
    const start = Date.now();
    await fetch(`${CONFIG.apiUrl}/api/tasks/queue/stats?projectId=${testProjectId}`);
    return (Date.now() - start) < 100;
  })) passed++;

  // Test 3: Checkpoint creation latency
  if (await runTest('Checkpoint creation < 150ms', 'latency', async () => {
    const start = Date.now();
    await fetch(`${CONFIG.apiUrl}/api/agents/${testAgentId}/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: { test: true },
      }),
    });
    return (Date.now() - start) < 150;
  })) passed++;

  return passed;
}

async function main() {
  log('\n╔═══════════════════════════════════════════════════════════════╗', colors.magenta);
  log('║     EKLAVYA DEMO₃ - AUTONOMOUS TASK EXECUTION VERIFICATION   ║', colors.magenta);
  log('╚═══════════════════════════════════════════════════════════════╝', colors.magenta);
  log(`\nStarted: ${new Date().toISOString()}`);
  log(`API URL: ${CONFIG.apiUrl}`);
  log(`WebSocket URL: ${CONFIG.wsUrl}`);
  log(`Frontend URL: ${CONFIG.frontendUrl}\n`);

  // Initialize database connection
  const db = getDatabase(CONFIG.database);
  await db.connect();
  log('✓ Database connected', colors.green);

  // Initialize learning system
  getLearningSystem({ explorationRate: 0.1, candidateRate: 0.3 });
  log('✓ Learning system initialized', colors.green);

  // Run all test categories
  const taskQueuePassed = await testTaskQueueOperations();
  const orchestratorPassed = await testOrchestratorOperations();
  const assignmentPassed = await testTaskAssignment();
  const checkpointPassed = await testCheckpointSystem();
  const messagingPassed = await testAgentMessaging();
  const logsPassed = await testExecutionLogs();
  const wsPassed = await testWebSocketUpdates();
  const latencyPassed = await testLatency();

  // Calculate totals
  const totalTests = results.length;
  const totalPassed = results.filter(r => r.pass).length;
  const passRate = ((totalPassed / totalTests) * 100).toFixed(1);

  // Summary by category
  log('\n' + '═'.repeat(65), colors.cyan);
  log('  RESULTS BY CATEGORY', colors.cyan);
  log('═'.repeat(65), colors.cyan);

  const categories = ['task_queue', 'orchestrator', 'assignment', 'checkpoint', 'messaging', 'logs', 'websocket', 'latency'];
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const catPassed = catResults.filter(r => r.pass).length;
    const color = catPassed === catResults.length ? colors.green : colors.yellow;
    log(`  ${cat.toUpperCase().replace('_', ' ').padEnd(14)}: ${catPassed}/${catResults.length} passed`, color);
  }

  // Final summary
  log('\n' + '═'.repeat(65), colors.cyan);
  log('  FINAL RESULTS', colors.cyan);
  log('═'.repeat(65), colors.cyan);

  log(`\n  Total Tests: ${totalTests}`);
  log(`  Passed: ${totalPassed}`);
  log(`  Failed: ${totalTests - totalPassed}`);
  log(`  Pass Rate: ${passRate}%`);

  // Demo₃ Success Criteria Check
  log('\n' + '═'.repeat(65), colors.cyan);
  log('  DEMO₃ SUCCESS CRITERIA', colors.cyan);
  log('═'.repeat(65), colors.cyan);

  const criteriaResults = [
    { name: 'Task queue creates/manages tasks', pass: taskQueuePassed >= 4 },
    { name: 'Orchestrator starts/stops correctly', pass: orchestratorPassed >= 4 },
    { name: 'Tasks assigned to agents successfully', pass: assignmentPassed >= 4 },
    { name: 'Checkpoint system saves/restores state', pass: checkpointPassed >= 3 },
    { name: 'Agent messaging works', pass: messagingPassed >= 2 },
    { name: 'WebSocket real-time updates', pass: wsPassed >= 2 },
    { name: 'API response latency acceptable', pass: latencyPassed >= 2 },
    { name: 'Error recovery with retry works', pass: results.find(r => r.name.includes('retry'))?.pass || false },
  ];

  for (const c of criteriaResults) {
    log(`  ${c.pass ? '✓' : '✗'} ${c.name}`, c.pass ? colors.green : colors.red);
  }

  const allCriteriaMet = criteriaResults.every(c => c.pass);
  const passThreshold = (totalPassed / totalTests) >= 0.85; // 85% threshold

  log('\n');
  if (allCriteriaMet && passThreshold) {
    log('╔═══════════════════════════════════════════════════════════════╗', colors.green);
    log('║        ✓ DEMO₃ VERIFICATION PASSED                           ║', colors.green);
    log('╚═══════════════════════════════════════════════════════════════╝', colors.green);
    log('\nDemo₃ is ready for admin review.');
    log(`Frontend: ${CONFIG.frontendUrl}`);
    log(`API: ${CONFIG.apiUrl}`);
    log(`WebSocket: ${CONFIG.wsUrl}`);
  } else {
    log('╔═══════════════════════════════════════════════════════════════╗', colors.red);
    log('║        ✗ DEMO₃ VERIFICATION FAILED                           ║', colors.red);
    log('╚═══════════════════════════════════════════════════════════════╝', colors.red);
    log('\nSome criteria were not met. Review failed tests above.');
    if (!passThreshold) {
      log(`Pass rate ${passRate}% is below 85% threshold.`, colors.yellow);
    }
  }

  log(`\nCompleted: ${new Date().toISOString()}`);

  await db.close();
  process.exit(allCriteriaMet && passThreshold ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
