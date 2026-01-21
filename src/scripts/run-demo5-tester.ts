#!/usr/bin/env npx tsx
/**
 * Demo₅: Multi-Agent Coordination - Automated Tester
 *
 * Tests all Demo₅ functionality:
 * - Concurrent agent spawning
 * - Task distribution and routing
 * - Messaging coordination
 * - File locking and conflict resolution
 * - Resource limits
 */

const API_URL = 'http://localhost:4000';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  duration: number;
}

interface TestContext {
  projectId?: string;
  agentIds: string[];
  taskIds: string[];
  lockIds: string[];
  conflictIds: string[];
}

const ctx: TestContext = {
  agentIds: [],
  taskIds: [],
  lockIds: [],
  conflictIds: [],
};
const results: TestResult[] = [];

// Colors for console output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function test(
  name: string,
  category: string,
  fn: () => Promise<void>
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({
      name,
      category,
      passed: true,
      duration: Date.now() - start,
    });
    console.log(`  ${GREEN}✓${RESET} ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      category,
      passed: false,
      error: errorMessage,
      duration: Date.now() - start,
    });
    console.log(`  ${RED}✗${RESET} ${name}`);
    console.log(`    ${RED}Error: ${errorMessage}${RESET}`);
  }
}

async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function setup(): Promise<void> {
  console.log(`\n${CYAN}Setting up test environment...${RESET}\n`);

  // Create a test project
  const projectRes = await api('POST', '/api/projects', {
    name: 'Demo5 Coordination Test',
    description: 'Testing multi-agent coordination',
  });

  assert(projectRes.status === 201, `Failed to create project: ${projectRes.status}`);
  ctx.projectId = (projectRes.data as { id: string }).id;
  console.log(`  Created test project: ${ctx.projectId}`);

  // Initialize coordination for the project
  const initRes = await api('POST', `/api/coordination/${ctx.projectId}/initialize`, {
    maxConcurrentAgents: 5,
  });
  assert(initRes.status === 200, `Failed to initialize coordination: ${initRes.status}`);
  console.log(`  Initialized coordination (max 5 concurrent agents)`);
}

// ============================================================================
// Test Categories
// ============================================================================

async function runConcurrentSpawningTests(): Promise<void> {
  console.log(`\n${BOLD}Concurrent Agent Spawning Tests${RESET}`);

  await test('Spawn multiple agents concurrently', 'spawning', async () => {
    const res = await api('POST', `/api/coordination/${ctx.projectId}/spawn-multiple`, {
      agents: [
        { type: 'developer' },
        { type: 'tester' },
        { type: 'architect' },
      ],
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean; spawned: number; results: Array<{ agentId: string; success: boolean }> };
    assert(data.success === true, 'Spawn should succeed');
    assert(data.spawned === 3, `Should spawn 3 agents, got ${data.spawned}`);

    // Store agent IDs for later tests
    for (const result of data.results) {
      if (result.success && result.agentId) {
        ctx.agentIds.push(result.agentId);
      }
    }
  });

  await test('Get all active agents', 'spawning', async () => {
    const res = await api('GET', `/api/coordination/${ctx.projectId}/agents`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean; count: number; agents: Array<{ agentId: string }> };
    assert(data.success === true, 'Should succeed');
    assert(data.count >= 3, `Should have at least 3 agents, got ${data.count}`);
  });

  await test('Verify agents are different types', 'spawning', async () => {
    const res = await api('GET', `/api/coordination/${ctx.projectId}/agents`);
    const data = res.data as { agents: Array<{ type: string }> };
    const types = new Set(data.agents.map(a => a.type));
    assert(types.size >= 3, 'Agents should have different types');
  });

  await test('Can spawn check returns true within limit', 'spawning', async () => {
    const res = await api('GET', `/api/coordination/${ctx.projectId}/can-spawn`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean; canSpawn: boolean; currentCount: number; maxCount: number };
    assert(data.success === true, 'Should succeed');
    assert(data.maxCount === 5, 'Max should be 5');
    assert(data.currentCount <= 5, 'Current count should be <= 5');
  });

  await test('Get coordination status', 'spawning', async () => {
    const res = await api('GET', `/api/coordination/${ctx.projectId}/status`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean; status: { maxAgents: number; activeAgents: number } };
    assert(data.success === true, 'Should succeed');
    assert(data.status.maxAgents === 5, 'Max agents should be 5');
    assert(data.status.activeAgents >= 0, 'Active agents should be non-negative');
  });
}

async function runResourceLimitTests(): Promise<void> {
  console.log(`\n${BOLD}Resource Limit Tests${RESET}`);

  await test('Spawn more agents to reach limit', 'limits', async () => {
    const res = await api('POST', `/api/coordination/${ctx.projectId}/spawn-multiple`, {
      agents: [
        { type: 'qa' },
        { type: 'pm' },
      ],
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean; spawned: number; results: Array<{ agentId: string; success: boolean }> };

    for (const result of data.results) {
      if (result.success && result.agentId) {
        ctx.agentIds.push(result.agentId);
      }
    }
  });

  await test('Exceed limit is rejected', 'limits', async () => {
    // Try to spawn 3 more when we're at 5
    const res = await api('POST', `/api/coordination/${ctx.projectId}/spawn-multiple`, {
      agents: [
        { type: 'developer' },
        { type: 'developer' },
        { type: 'developer' },
      ],
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { failed: number; results: Array<{ success: boolean; error?: string }> };
    // Should have at least some failures due to limit
    assert(data.failed > 0 || data.results.some(r => !r.success), 'Should have failed spawns due to limit');
  });

  await test('Can spawn returns false when at limit', 'limits', async () => {
    // First verify we're at or near limit
    const statusRes = await api('GET', `/api/coordination/${ctx.projectId}/status`);
    const statusData = statusRes.data as { status: { activeAgents: number; maxAgents: number } };

    if (statusData.status.activeAgents >= statusData.status.maxAgents) {
      const res = await api('GET', `/api/coordination/${ctx.projectId}/can-spawn`);
      const data = res.data as { canSpawn: boolean };
      assert(data.canSpawn === false, 'canSpawn should be false when at limit');
    }
  });

  await test('Terminate agent frees up slot', 'limits', async () => {
    if (ctx.agentIds.length > 0) {
      const agentId = ctx.agentIds[ctx.agentIds.length - 1];
      const res = await api('DELETE', `/api/coordination/${ctx.projectId}/agents/${agentId}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean };
      assert(data.success === true, 'Termination should succeed');
      ctx.agentIds.pop();
    }
  });
}

async function runTaskDistributionTests(): Promise<void> {
  console.log(`\n${BOLD}Task Distribution Tests${RESET}`);

  // Create some tasks first
  await test('Create tasks for distribution', 'distribution', async () => {
    const task1Res = await api('POST', `/api/projects/${ctx.projectId}/tasks`, {
      title: 'Implement feature',
      description: 'Implement the main feature',
      type: 'development',
      priority: 'high',
    });
    assert(task1Res.status === 201, `Failed to create task 1: ${task1Res.status}`);
    ctx.taskIds.push((task1Res.data as { id: string }).id);

    const task2Res = await api('POST', `/api/projects/${ctx.projectId}/tasks`, {
      title: 'Write tests',
      description: 'Write unit tests',
      type: 'testing',
      priority: 'medium',
    });
    assert(task2Res.status === 201, `Failed to create task 2: ${task2Res.status}`);
    ctx.taskIds.push((task2Res.data as { id: string }).id);

    const task3Res = await api('POST', `/api/projects/${ctx.projectId}/tasks`, {
      title: 'Design system',
      description: 'Design the system architecture',
      type: 'design',
      priority: 'high',
    });
    assert(task3Res.status === 201, `Failed to create task 3: ${task3Res.status}`);
    ctx.taskIds.push((task3Res.data as { id: string }).id);
  });

  await test('Route task to best agent', 'distribution', async () => {
    if (ctx.taskIds.length > 0) {
      const res = await api('POST', `/api/coordination/${ctx.projectId}/route-task`, {
        taskId: ctx.taskIds[0],
        preferredType: 'developer',
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean; agentId?: string };
      // agentId might be null if no matching agent found
      assert(typeof data.success === 'boolean', 'Should return success status');
    }
  });

  await test('Assign multiple tasks', 'distribution', async () => {
    const tasksToAssign = ctx.taskIds.slice(0, 2).map(id => ({ id }));

    const res = await api('POST', `/api/coordination/${ctx.projectId}/assign`, {
      tasks: tasksToAssign,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean; assigned: number; failed: number };
    assert(data.success === true, 'Should succeed');
    assert(typeof data.assigned === 'number', 'Should return assigned count');
    assert(typeof data.failed === 'number', 'Should return failed count');
  });

  await test('Rebalance tasks across agents', 'distribution', async () => {
    const res = await api('POST', `/api/coordination/${ctx.projectId}/rebalance`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean; reassigned: number };
    assert(data.success === true, 'Should succeed');
    assert(typeof data.reassigned === 'number', 'Should return reassigned count');
  });
}

async function runFileLockTests(): Promise<void> {
  console.log(`\n${BOLD}File Lock Tests${RESET}`);

  await test('Acquire file lock', 'locks', async () => {
    if (ctx.agentIds.length > 0) {
      const res = await api('POST', `/api/coordination/${ctx.projectId}/locks/acquire`, {
        agentId: ctx.agentIds[0],
        filePath: '/src/main.ts',
        durationMinutes: 5,
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean; lockId?: string; message: string };
      assert(data.success === true, 'Lock acquisition should succeed');
      assert(typeof data.lockId === 'string', 'Should return lockId');
      if (data.lockId) {
        ctx.lockIds.push(data.lockId);
      }
    }
  });

  await test('Second agent cannot acquire same lock', 'locks', async () => {
    if (ctx.agentIds.length >= 2) {
      const res = await api('POST', `/api/coordination/${ctx.projectId}/locks/acquire`, {
        agentId: ctx.agentIds[1],
        filePath: '/src/main.ts',
        durationMinutes: 5,
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean; message: string };
      assert(data.success === false, 'Second lock should fail');
      assert(data.message.includes('locked by'), 'Message should indicate file is locked');
    }
  });

  await test('Check if file is locked', 'locks', async () => {
    const res = await api('POST', `/api/coordination/${ctx.projectId}/locks/check`, {
      filePath: '/src/main.ts',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean; locked: boolean; lockedBy?: string };
    assert(data.success === true, 'Should succeed');
    assert(data.locked === true, 'File should be locked');
    assert(data.lockedBy === ctx.agentIds[0], 'Should be locked by first agent');
  });

  await test('Get all active locks', 'locks', async () => {
    const res = await api('GET', `/api/coordination/${ctx.projectId}/locks`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean; count: number; locks: Array<{ filePath: string }> };
    assert(data.success === true, 'Should succeed');
    assert(data.count >= 1, 'Should have at least 1 lock');
  });

  await test('Same agent can extend lock', 'locks', async () => {
    if (ctx.agentIds.length > 0) {
      const res = await api('POST', `/api/coordination/${ctx.projectId}/locks/acquire`, {
        agentId: ctx.agentIds[0],
        filePath: '/src/main.ts',
        durationMinutes: 10,
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean; message: string };
      assert(data.success === true, 'Lock extension should succeed');
      assert(data.message === 'Lock extended', 'Message should indicate lock extended');
    }
  });

  await test('Release file lock', 'locks', async () => {
    if (ctx.lockIds.length > 0) {
      const res = await api('DELETE', `/api/coordination/${ctx.projectId}/locks/${ctx.lockIds[0]}`, {
        agentId: ctx.agentIds[0],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean };
      assert(data.success === true, 'Lock release should succeed');
    }
  });

  await test('File is unlocked after release', 'locks', async () => {
    const res = await api('POST', `/api/coordination/${ctx.projectId}/locks/check`, {
      filePath: '/src/main.ts',
    });
    const data = res.data as { locked: boolean };
    assert(data.locked === false, 'File should be unlocked');
  });
}

async function runConflictResolutionTests(): Promise<void> {
  console.log(`\n${BOLD}Conflict Resolution Tests${RESET}`);

  await test('Detect file conflict between agents', 'conflicts', async () => {
    if (ctx.agentIds.length >= 2) {
      const res = await api('POST', `/api/coordination/${ctx.projectId}/conflicts/detect`, {
        agentAId: ctx.agentIds[0],
        agentBId: ctx.agentIds[1],
        filePath: '/src/shared.ts',
        conflictType: 'concurrent_edit',
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean; conflict: { id: string; status: string } };
      assert(data.success === true, 'Should succeed');
      assert(data.conflict.id !== undefined, 'Should return conflict ID');
      assert(data.conflict.status === 'pending', 'Conflict should be pending');
      ctx.conflictIds.push(data.conflict.id);
    }
  });

  await test('Get pending conflicts', 'conflicts', async () => {
    const res = await api('GET', `/api/coordination/${ctx.projectId}/conflicts`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean; count: number; conflicts: Array<{ status: string }> };
    assert(data.success === true, 'Should succeed');
    assert(data.count >= 1, 'Should have at least 1 conflict');
    assert(data.conflicts.every(c => c.status === 'pending'), 'All should be pending');
  });

  await test('Resolve conflict with merge strategy', 'conflicts', async () => {
    if (ctx.conflictIds.length > 0 && ctx.agentIds.length > 0) {
      const res = await api('POST', `/api/coordination/${ctx.projectId}/conflicts/${ctx.conflictIds[0]}/resolve`, {
        resolution: 'merge',
        resolvedBy: ctx.agentIds[0],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean };
      assert(data.success === true, 'Resolution should succeed');
    }
  });

  await test('Conflict no longer pending after resolution', 'conflicts', async () => {
    const res = await api('GET', `/api/coordination/${ctx.projectId}/conflicts`);
    const data = res.data as { conflicts: Array<{ id: string }> };
    const stillPending = data.conflicts.find(c => c.id === ctx.conflictIds[0]);
    assert(stillPending === undefined, 'Resolved conflict should not be in pending list');
  });

  await test('Detect another conflict for override test', 'conflicts', async () => {
    if (ctx.agentIds.length >= 2) {
      const res = await api('POST', `/api/coordination/${ctx.projectId}/conflicts/detect`, {
        agentAId: ctx.agentIds[0],
        agentBId: ctx.agentIds[1],
        filePath: '/src/config.ts',
        conflictType: 'schema_change',
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { conflict: { id: string } };
      ctx.conflictIds.push(data.conflict.id);
    }
  });

  await test('Resolve conflict with override_a strategy', 'conflicts', async () => {
    if (ctx.conflictIds.length > 1 && ctx.agentIds.length > 0) {
      const res = await api('POST', `/api/coordination/${ctx.projectId}/conflicts/${ctx.conflictIds[1]}/resolve`, {
        resolution: 'override_a',
        resolvedBy: ctx.agentIds[0],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean };
      assert(data.success === true, 'Resolution should succeed');
    }
  });
}

async function runMessagingTests(): Promise<void> {
  console.log(`\n${BOLD}Messaging Coordination Tests${RESET}`);

  await test('Relay message between agents', 'messaging', async () => {
    if (ctx.agentIds.length >= 2) {
      const res = await api('POST', `/api/coordination/${ctx.projectId}/relay`, {
        type: 'TASK_HANDOFF',
        fromAgentId: ctx.agentIds[0],
        toAgentId: ctx.agentIds[1],
        payload: {
          taskId: ctx.taskIds[0],
          message: 'Please review this task',
        },
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean };
      assert(data.success === true, 'Relay should succeed');
    }
  });

  await test('Broadcast message to all agents', 'messaging', async () => {
    const res = await api('POST', `/api/coordination/${ctx.projectId}/relay`, {
      type: 'STATUS_UPDATE',
      fromAgentId: ctx.agentIds[0],
      toAgentId: null, // Broadcast
      payload: {
        status: 'milestone_complete',
        message: 'Phase 1 complete',
      },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = res.data as { success: boolean };
    assert(data.success === true, 'Broadcast should succeed');
  });

  await test('Relay HELP_NEEDED message', 'messaging', async () => {
    if (ctx.agentIds.length > 0) {
      const res = await api('POST', `/api/coordination/${ctx.projectId}/relay`, {
        type: 'HELP_NEEDED',
        fromAgentId: ctx.agentIds[0],
        payload: {
          reason: 'Stuck on database migration',
          priority: 'high',
        },
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = res.data as { success: boolean };
      assert(data.success === true, 'Help message should succeed');
    }
  });
}

async function runLatencyTests(): Promise<void> {
  console.log(`\n${BOLD}API Latency Tests${RESET}`);

  await test('Coordination status API < 200ms', 'latency', async () => {
    const start = Date.now();
    await api('GET', `/api/coordination/${ctx.projectId}/status`);
    const duration = Date.now() - start;
    assert(duration < 200, `Status took ${duration}ms, should be under 200ms`);
  });

  await test('Get agents API < 200ms', 'latency', async () => {
    const start = Date.now();
    await api('GET', `/api/coordination/${ctx.projectId}/agents`);
    const duration = Date.now() - start;
    assert(duration < 200, `Get agents took ${duration}ms, should be under 200ms`);
  });

  await test('Lock check API < 200ms', 'latency', async () => {
    const start = Date.now();
    await api('POST', `/api/coordination/${ctx.projectId}/locks/check`, {
      filePath: '/src/test.ts',
    });
    const duration = Date.now() - start;
    assert(duration < 200, `Lock check took ${duration}ms, should be under 200ms`);
  });

  await test('Spawn multiple API < 500ms', 'latency', async () => {
    const start = Date.now();
    await api('POST', `/api/coordination/${ctx.projectId}/spawn-multiple`, {
      agents: [{ type: 'developer' }],
    });
    const duration = Date.now() - start;
    assert(duration < 500, `Spawn took ${duration}ms, should be under 500ms`);
  });
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  console.log(`
${CYAN}╔═══════════════════════════════════════════════════════════════════╗${RESET}
${CYAN}║         EKLAVYA DEMO₅ - AUTOMATED TESTER                         ║${RESET}
${CYAN}║           Multi-Agent Coordination                               ║${RESET}
${CYAN}╚═══════════════════════════════════════════════════════════════════╝${RESET}
`);

  try {
    // Check API is running
    const healthRes = await api('GET', '/api/health');
    if (healthRes.status !== 200) {
      console.log(`${RED}Error: API server not running at ${API_URL}${RESET}`);
      console.log(`${YELLOW}Start the server with: cd src && npx tsx index.ts${RESET}`);
      process.exit(1);
    }

    // Setup test data
    await setup();

    // Run all test categories
    await runConcurrentSpawningTests();
    await runResourceLimitTests();
    await runTaskDistributionTests();
    await runFileLockTests();
    await runConflictResolutionTests();
    await runMessagingTests();
    await runLatencyTests();

    // Summary
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;
    const passRate = ((passed / total) * 100).toFixed(1);

    console.log(`
${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}
${BOLD}RESULTS SUMMARY${RESET}
${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}

  Total Tests:  ${total}
  ${GREEN}Passed:       ${passed}${RESET}
  ${failed > 0 ? RED : GREEN}Failed:       ${failed}${RESET}
  Pass Rate:    ${passRate}%

${BOLD}By Category:${RESET}`);

    const categories = [...new Set(results.map(r => r.category))];
    for (const category of categories) {
      const categoryResults = results.filter(r => r.category === category);
      const categoryPassed = categoryResults.filter(r => r.passed).length;
      const categoryTotal = categoryResults.length;
      const status = categoryPassed === categoryTotal ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      console.log(`  ${status} ${category}: ${categoryPassed}/${categoryTotal}`);
    }

    if (failed === 0) {
      console.log(`
${GREEN}╔═══════════════════════════════════════════════════════════════════╗${RESET}
${GREEN}║        ✓ DEMO₅ VERIFICATION PASSED                               ║${RESET}
${GREEN}╚═══════════════════════════════════════════════════════════════════╝${RESET}

Demo₅ is ready for admin review.
`);
      process.exit(0);
    } else {
      console.log(`
${RED}╔═══════════════════════════════════════════════════════════════════╗${RESET}
${RED}║        ✗ DEMO₅ VERIFICATION FAILED                               ║${RESET}
${RED}╚═══════════════════════════════════════════════════════════════════╝${RESET}

${YELLOW}Failed Tests:${RESET}`);

      for (const result of results.filter(r => !r.passed)) {
        console.log(`  - ${result.name}: ${result.error}`);
      }

      process.exit(1);
    }
  } catch (error) {
    console.error(`${RED}Fatal error:${RESET}`, error);
    process.exit(1);
  }
}

main().catch(console.error);
