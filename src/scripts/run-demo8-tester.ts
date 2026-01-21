#!/usr/bin/env npx tsx
/**
 * Demo₈ Tester: Self-Build Test
 *
 * Validates the complete self-build functionality:
 * - Self-build manager operations
 * - Execution plan generation
 * - Phase execution (simulated)
 * - Task dependency resolution
 * - RL outcome recording
 * - Sample project configurations
 */

import { getDatabase } from '../lib/database.js';

// Database config - initialize early
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'eklavya',
  user: process.env.DB_USER || 'eklavya',
  password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
};

// Initialize database singleton
getDatabase(dbConfig);

import {
  getSelfBuildManager,
  SelfBuildConfig,
  SelfBuildStatus,
} from '../core/self-build/index.js';
import { ExecutionPlanGenerator } from '../core/self-build/planner.js';
import {
  getAllSampleProjects,
  getSampleProject,
  createSimulatedConfig,
  getDemo8SampleProject,
  createProjectConfig,
} from '../core/self-build/sample-projects.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
let testProjectId: string;
let testRunId: string;

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: errorMessage, duration: Date.now() - start });
    console.log(`  ✗ ${name}: ${errorMessage}`);
  }
}

async function setup(): Promise<void> {
  console.log('\n📦 Setting up test environment...\n');

  const db = getDatabase();

  // Run migration
  const fs = await import('fs');
  const path = await import('path');
  const migrationPath = path.join(process.cwd(), 'migrations', '008_demo8_self_build.sql');

  if (fs.existsSync(migrationPath)) {
    const migration = fs.readFileSync(migrationPath, 'utf-8');
    await db.query(migration);
    console.log('  ✓ Migration applied');
  }

  // Create test project
  const projectResult = await db.query<{ id: string }>(
    `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING id`,
    ['Demo8 Test Project', 'Test project for self-build validation']
  );
  testProjectId = projectResult.rows[0].id;
  console.log(`  ✓ Test project created: ${testProjectId}\n`);
}

async function cleanup(): Promise<void> {
  console.log('\n🧹 Cleaning up...\n');
  const db = getDatabase();

  // Clean up test data
  if (testProjectId) {
    await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
    console.log('  ✓ Test data cleaned up');
  }
}

// ============================================================
// Test Suites
// ============================================================

async function testSampleProjects(): Promise<void> {
  console.log('\n📋 Sample Projects Tests\n');

  await runTest('Get all sample projects', async () => {
    const projects = getAllSampleProjects();
    if (Object.keys(projects).length < 4) {
      throw new Error('Expected at least 4 sample projects');
    }
  });

  await runTest('Get specific sample project', async () => {
    const project = getSampleProject('todo-cli');
    if (!project) throw new Error('todo-cli project not found');
    if (project.projectName !== 'todo-cli') throw new Error('Wrong project name');
    if (project.features.length < 3) throw new Error('Expected at least 3 features');
  });

  await runTest('Get non-existent project returns undefined', async () => {
    const project = getSampleProject('non-existent');
    if (project !== undefined) throw new Error('Expected undefined');
  });

  await runTest('Create simulated config', async () => {
    const config = createSimulatedConfig('todo-cli', 100, 0.9);
    if (!config.simulatedMode) throw new Error('simulatedMode should be true');
    if (config.simulatedDuration !== 100) throw new Error('Wrong simulated duration');
    if (config.simulatedSuccessRate !== 0.9) throw new Error('Wrong success rate');
  });

  await runTest('Get Demo8 sample project', async () => {
    const project = getDemo8SampleProject();
    if (!project.simulatedMode) throw new Error('Demo8 sample should be simulated');
    if (project.simulatedSuccessRate !== 1.0) throw new Error('Demo8 should have 100% success rate');
  });

  await runTest('Create custom project config', async () => {
    const config = createProjectConfig(
      'test-project',
      'A test project',
      ['Feature 1', 'Feature 2'],
      ['TypeScript'],
      { maxExecutionTime: 30 }
    );
    if (config.projectName !== 'test-project') throw new Error('Wrong project name');
    if (config.features.length !== 2) throw new Error('Wrong feature count');
    if (config.maxExecutionTime !== 30) throw new Error('Wrong execution time');
  });
}

async function testExecutionPlanGenerator(): Promise<void> {
  console.log('\n📋 Execution Plan Generator Tests\n');

  const planner = new ExecutionPlanGenerator();
  const config = getDemo8SampleProject();

  await runTest('Generate execution plan', async () => {
    const plan = await planner.generatePlan(testProjectId, config);
    if (!plan.id) throw new Error('Plan should have ID');
    if (plan.projectId !== testProjectId) throw new Error('Wrong project ID');
    if (plan.phases.length < 3) throw new Error('Expected at least 3 phases');
    if (plan.totalTasks < 5) throw new Error('Expected at least 5 tasks');
  });

  await runTest('Plan has architecture phase first', async () => {
    const plan = await planner.generatePlan(testProjectId, config);
    const phase1 = plan.phases[0];
    if (phase1.phaseNumber !== 1) throw new Error('First phase should be phase 1');
    if (phase1.parallelizable) throw new Error('Architecture phase should not be parallelizable');
    const archTask = phase1.tasks.find(t => t.type === 'architecture');
    if (!archTask) throw new Error('Architecture task not found');
  });

  await runTest('Plan has development phase', async () => {
    const plan = await planner.generatePlan(testProjectId, config);
    const devPhase = plan.phases.find(p => p.tasks.some(t => t.type === 'development'));
    if (!devPhase) throw new Error('Development phase not found');
    if (!devPhase.parallelizable) throw new Error('Development phase should be parallelizable');
  });

  await runTest('Plan has testing phase', async () => {
    const plan = await planner.generatePlan(testProjectId, config);
    const testPhase = plan.phases.find(p => p.tasks.some(t => t.type === 'testing'));
    if (!testPhase) throw new Error('Testing phase not found');
  });

  await runTest('Plan has QA phase', async () => {
    const plan = await planner.generatePlan(testProjectId, config);
    const qaPhase = plan.phases.find(p => p.tasks.some(t => t.type === 'qa'));
    if (!qaPhase) throw new Error('QA phase not found');
  });

  await runTest('Validate plan structure', async () => {
    const plan = await planner.generatePlan(testProjectId, config);
    const validation = planner.validatePlan(plan);
    if (!validation.valid) throw new Error(`Plan validation failed: ${validation.errors.join(', ')}`);
  });

  await runTest('Task dependencies are valid', async () => {
    const plan = await planner.generatePlan(testProjectId, config);
    const taskIds = new Set<string>();
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        taskIds.add(task.id);
      }
    }
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        for (const depId of task.dependencies) {
          if (!taskIds.has(depId)) {
            throw new Error(`Task ${task.id} has invalid dependency: ${depId}`);
          }
        }
      }
    }
  });

  await runTest('Get execution order', async () => {
    const plan = await planner.generatePlan(testProjectId, config);
    const allTasks = plan.phases.flatMap(p => p.tasks);
    const order = planner.getExecutionOrder(allTasks);
    if (order.length !== allTasks.length) throw new Error('Execution order missing tasks');
  });

  await runTest('Get parallelizable tasks', async () => {
    const plan = await planner.generatePlan(testProjectId, config);
    const devPhase = plan.phases.find(p => p.parallelizable)!;
    const completedIds = new Set<string>();

    // Complete first task's dependencies
    for (const task of devPhase.tasks) {
      for (const depId of task.dependencies) {
        completedIds.add(depId);
      }
    }

    const ready = planner.getParallelizableTasks(devPhase.tasks, completedIds);
    if (ready.length === 0) throw new Error('Expected some parallelizable tasks');
  });
}

async function testSelfBuildManager(): Promise<void> {
  console.log('\n📋 Self-Build Manager Tests\n');

  const manager = getSelfBuildManager();
  const config = getDemo8SampleProject();

  await runTest('Start self-build run', async () => {
    const run = await manager.startBuild(testProjectId, config);
    testRunId = run.id;
    if (!run.id) throw new Error('Run should have ID');
    if (run.projectId !== testProjectId) throw new Error('Wrong project ID');
    if (run.status !== 'pending') throw new Error('Initial status should be pending');
  });

  await runTest('Get self-build run', async () => {
    const run = await manager.getRun(testRunId);
    if (run.id !== testRunId) throw new Error('Wrong run ID');
    if (run.config.projectName !== config.projectName) throw new Error('Wrong config');
  });

  await runTest('List self-build runs', async () => {
    const runs = await manager.listRuns(testProjectId);
    if (runs.length === 0) throw new Error('Expected at least one run');
    const found = runs.find(r => r.id === testRunId);
    if (!found) throw new Error('Test run not found in list');
  });

  await runTest('Create execution plan', async () => {
    const plan = await manager.createPlan(testRunId);
    if (!plan.id) throw new Error('Plan should have ID');
    if (plan.totalTasks < 5) throw new Error('Expected at least 5 tasks');

    // Verify run status updated
    const run = await manager.getRun(testRunId);
    if (run.status !== 'planning') throw new Error('Status should be planning');
  });

  await runTest('Get progress before execution', async () => {
    const progress = await manager.getProgress(testRunId);
    if (progress.runId !== testRunId) throw new Error('Wrong run ID');
    if (progress.progressPercent !== 0) throw new Error('Progress should be 0% before execution');
  });
}

async function testSelfBuildExecution(): Promise<void> {
  console.log('\n📋 Self-Build Execution Tests\n');

  const manager = getSelfBuildManager();

  await runTest('Execute self-build (simulated)', async () => {
    const result = await manager.execute(testRunId);
    if (!result.success) throw new Error(`Execution failed: ${result.errors.join(', ')}`);
    if (result.completedTasks === 0) throw new Error('Expected completed tasks');
    if (result.failedTasks > 0) throw new Error('Expected no failed tasks');
  });

  await runTest('Run status updated to completed', async () => {
    const run = await manager.getRun(testRunId);
    if (run.status !== 'completed') throw new Error(`Expected completed, got ${run.status}`);
  });

  await runTest('Get phases after execution', async () => {
    const phases = await manager.getPhases(testRunId);
    if (phases.length === 0) throw new Error('Expected phases');
    const allSuccess = phases.every(p => p.success);
    if (!allSuccess) throw new Error('Expected all phases to succeed');
  });

  await runTest('Get progress after execution', async () => {
    const progress = await manager.getProgress(testRunId);
    if (progress.progressPercent !== 100) throw new Error('Progress should be 100%');
  });
}

async function testFullSelfBuildFlow(): Promise<void> {
  console.log('\n📋 Full Self-Build Flow Tests\n');

  const manager = getSelfBuildManager();
  const db = getDatabase();

  // Create another test project for this flow
  const projectResult = await db.query<{ id: string }>(
    `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING id`,
    ['Full Flow Test', 'Test for full self-build flow']
  );
  const flowProjectId = projectResult.rows[0].id;

  await runTest('Run full self-build flow', async () => {
    const config = createSimulatedConfig('calculator-lib', 50, 1.0);
    const result = await manager.runSelfBuild(flowProjectId, config);

    if (!result.success) throw new Error(`Full flow failed: ${result.errors.join(', ')}`);
    if (!result.runId) throw new Error('Result should have runId');
    if (!result.executionPlan) throw new Error('Result should have executionPlan');
    if (result.totalTasks === 0) throw new Error('Expected tasks');
    if (result.completedTasks !== result.totalTasks) throw new Error('All tasks should complete');
  });

  await runTest('Cancel self-build run (terminal state)', async () => {
    // Start a new run
    const config = getDemo8SampleProject();
    const run = await manager.startBuild(flowProjectId, config);

    // Try to cancel after it's already in terminal state
    // First complete it
    await manager.createPlan(run.id);
    await manager.execute(run.id);

    // Now try to cancel - should return false for terminal state
    const cancelled = await manager.cancel(run.id);
    if (cancelled) throw new Error('Should not be able to cancel completed run');
  });

  // Cleanup
  await db.query('DELETE FROM projects WHERE id = $1', [flowProjectId]);
}

async function testErrorHandling(): Promise<void> {
  console.log('\n📋 Error Handling Tests\n');

  const manager = getSelfBuildManager();

  await runTest('Start build without projectId throws', async () => {
    try {
      await manager.startBuild('', getDemo8SampleProject());
      throw new Error('Should have thrown');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('projectId')) {
        throw error;
      }
    }
  });

  await runTest('Start build without projectName throws', async () => {
    try {
      await manager.startBuild(testProjectId, { projectName: '' } as SelfBuildConfig);
      throw new Error('Should have thrown');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('projectName')) {
        throw error;
      }
    }
  });

  await runTest('Get non-existent run throws', async () => {
    try {
      await manager.getRun('00000000-0000-0000-0000-000000000000');
      throw new Error('Should have thrown');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('not found')) {
        throw error;
      }
    }
  });

  await runTest('Execute without plan throws', async () => {
    // Start a new run but don't create plan
    const run = await manager.startBuild(testProjectId, getDemo8SampleProject());
    try {
      await manager.execute(run.id);
      throw new Error('Should have thrown');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('No execution plan')) {
        throw error;
      }
    }
  });
}

async function testDatabaseOperations(): Promise<void> {
  console.log('\n📋 Database Operations Tests\n');

  const db = getDatabase();
  const config = getDemo8SampleProject();

  await runTest('Start self-build creates record', async () => {
    const result = await db.query<{ start_self_build: string }>(
      `SELECT start_self_build($1, $2)`,
      [testProjectId, JSON.stringify(config)]
    );
    if (!result.rows[0].start_self_build) throw new Error('Expected run ID');
  });

  await runTest('Self-build summary view works', async () => {
    const result = await db.query(
      `SELECT * FROM self_build_summary WHERE project_id = $1`,
      [testProjectId]
    );
    if (result.rows.length === 0) throw new Error('Expected summary rows');
  });

  await runTest('Update self-build status works', async () => {
    // Get a run
    const runs = await db.query<{ id: string }>(
      `SELECT id FROM self_build_runs WHERE project_id = $1 AND status = 'pending' LIMIT 1`,
      [testProjectId]
    );
    if (runs.rows.length === 0) throw new Error('No pending run found');

    const result = await db.query<{ update_self_build_status: boolean }>(
      `SELECT update_self_build_status($1, 'planning'::self_build_status)`,
      [runs.rows[0].id]
    );
    if (!result.rows[0].update_self_build_status) throw new Error('Update should succeed');
  });
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     Demo₈: Self-Build Test Suite       ║');
  console.log('╚════════════════════════════════════════╝');

  try {
    await setup();

    // Run test suites
    await testSampleProjects();
    await testExecutionPlanGenerator();
    await testSelfBuildManager();
    await testSelfBuildExecution();
    await testFullSelfBuildFlow();
    await testErrorHandling();
    await testDatabaseOperations();

    // Summary
    console.log('\n════════════════════════════════════════');
    console.log('                SUMMARY                  ');
    console.log('════════════════════════════════════════\n');

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;
    const passRate = Math.round((passed / total) * 100);

    console.log(`  Total:  ${total}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Rate:   ${passRate}%`);

    // Grade calculation
    let grade: string;
    if (passRate >= 95) grade = 'A';
    else if (passRate >= 85) grade = 'B';
    else if (passRate >= 75) grade = 'C';
    else if (passRate >= 65) grade = 'D';
    else grade = 'F';

    console.log(`\n  Grade:  ${grade} (${passRate}%)`);

    if (failed > 0) {
      console.log('\n  Failed Tests:');
      results.filter(r => !r.passed).forEach(r => {
        console.log(`    - ${r.name}: ${r.error}`);
      });
    }

    console.log('\n════════════════════════════════════════\n');

    // Exit with appropriate code
    if (passRate >= 85) {
      console.log('✓ Demo₈ Self-Build Test: PASSED\n');
      process.exit(0);
    } else {
      console.log('✗ Demo₈ Self-Build Test: FAILED\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n✗ Fatal error:', error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

main();
