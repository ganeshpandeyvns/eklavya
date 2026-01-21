/**
 * Build Command
 * Triggers the workflow engine to build a project
 */

import { parseArgs } from 'util';
import { createSpinner } from '../utils/spinner.js';
import {
  success,
  error,
  info,
  warning,
  header,
  subheader,
  keyValue,
  newline,
  colorize,
  progressBar,
  statusBadge,
  duration,
  cost,
} from '../utils/output.js';
import { loadConfig, initializeDatabase, getDb } from '../utils/config.js';
import {
  WorkflowEngine,
  createWorkflowEngine,
  getWorkflowEngine,
  WorkflowPhase,
} from '../../core/workflow/engine.js';
import type { EklavyaConfig } from '../../types/index.js';

interface BuildOptions {
  projectId: string;
  demoOnly: boolean;
  demoType?: 'wow' | 'trust' | 'milestone';
  autoApprove: boolean;
  watch: boolean;
  timeout?: number;
}

export async function buildCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      'demo-only': { type: 'boolean', short: 'd' },
      'demo-type': { type: 'string', short: 't' },
      'auto-approve': { type: 'boolean', short: 'a' },
      watch: { type: 'boolean', short: 'w' },
      timeout: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    return;
  }

  if (positionals.length === 0) {
    console.log(error('Project ID is required'));
    console.log(info('Usage: eklavya build <project-id> [options]'));
    process.exit(1);
  }

  const options: BuildOptions = {
    projectId: positionals[0],
    demoOnly: values['demo-only'] as boolean || false,
    demoType: values['demo-type'] as 'wow' | 'trust' | 'milestone' | undefined,
    autoApprove: values['auto-approve'] as boolean || false,
    watch: values.watch as boolean || false,
    timeout: values.timeout ? parseInt(values.timeout as string, 10) : undefined,
  };

  await runBuild(options);
}

async function runBuild(options: BuildOptions): Promise<void> {
  header('Eklavya Build');
  newline();

  const spinner = createSpinner('Initializing...');
  spinner.start();

  // Initialize database
  try {
    await initializeDatabase();
    spinner.succeed('Database connected');
  } catch (err) {
    spinner.fail('Database connection failed');
    console.log(error('Make sure PostgreSQL is running and configured'));
    process.exit(1);
  }

  // Verify project exists
  spinner.start('Verifying project...');
  const db = getDb();

  let project;
  try {
    // Try to find by ID first
    let result = await db.query(
      'SELECT * FROM projects WHERE id = $1',
      [options.projectId]
    );

    // If not found, try by name
    if (result.rows.length === 0) {
      result = await db.query(
        'SELECT * FROM projects WHERE name = $1',
        [options.projectId]
      );
    }

    if (result.rows.length === 0) {
      spinner.fail('Project not found');
      console.log(error(`No project found with ID or name: ${options.projectId}`));
      console.log(info('Run "eklavya list" to see available projects'));
      process.exit(1);
    }

    project = result.rows[0];
    spinner.succeed(`Project found: ${project.name}`);
  } catch (err) {
    spinner.fail('Failed to verify project');
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }

  newline();
  console.log(colorize('Project Details:', 'bold'));
  keyValue({
    ID: project.id,
    Name: project.name,
    Status: project.status,
    Budget: `$${project.budget_cost_usd || 100}`,
  });
  newline();

  // Check if project is already building
  if (['planning', 'architect', 'building', 'demo_building'].includes(project.status)) {
    console.log(warning('This project is already being built.'));
    console.log(info(`Current status: ${project.status}`));

    if (!options.watch) {
      console.log(info('Use --watch to monitor progress'));
      process.exit(0);
    }
  }

  // Create workflow engine
  spinner.start('Initializing workflow engine...');

  const cliConfig = loadConfig();
  const config: EklavyaConfig = {
    database: cliConfig.database,
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
    defaultModel: 'claude-sonnet-4-20250514',
    maxConcurrentAgents: cliConfig.defaults.maxConcurrentAgents,
    checkpointIntervalMs: 15 * 60 * 1000,
    heartbeatIntervalMs: 30000,
    heartbeatTimeoutMs: 60000,
  };

  let engine: WorkflowEngine;
  try {
    engine = createWorkflowEngine({
      config,
      autoApprove: options.autoApprove,
    });
    spinner.succeed('Workflow engine initialized');
  } catch (err) {
    spinner.fail('Failed to initialize workflow engine');
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }

  // Set up event listeners for progress display
  const phaseStartTimes: Record<string, number> = {};

  engine.on('workflow:started', ({ projectId, phase }) => {
    phaseStartTimes[phase] = Date.now();
    newline();
    console.log(colorize('Build started', 'green'));
    console.log(info(`Phase: ${phase}`));
  });

  engine.on('phase:changed', ({ projectId, phase }) => {
    const icon = getPhaseIcon(phase as WorkflowPhase);
    console.log(`${icon} Phase: ${colorize(phase, 'cyan')}`);
    phaseStartTimes[phase] = Date.now();
  });

  engine.on('architect:started', () => {
    spinner.start('Running architect analysis...');
  });

  engine.on('architect:completed', ({ output }) => {
    spinner.succeed('Architecture analysis complete');
    newline();
    subheader('Architecture Summary');
    keyValue({
      'Components': output.architecture.components.length,
      'Total Tasks': output.taskBreakdown.length,
      'Estimated Hours': output.estimatedEffort.totalHours,
      'Risks Identified': output.risks.length,
    });
    newline();
  });

  engine.on('demo:build_started', ({ demoType }) => {
    spinner.start(`Building ${demoType} demo...`);
  });

  engine.on('demo:ready', ({ demoId, demoType }) => {
    spinner.succeed(`${demoType} demo ready`);
    newline();
    console.log(success(`Demo ready for review: ${demoId}`));

    if (!options.autoApprove) {
      console.log(warning('Waiting for approval...'));
      console.log(info('Run "eklavya approve ' + options.projectId + '" to approve'));
    }
  });

  engine.on('approval:requested', ({ demoId }) => {
    if (!options.autoApprove) {
      spinner.start('Waiting for approval decision...');
    }
  });

  engine.on('approval:decided', ({ decision }) => {
    if (!options.autoApprove) {
      spinner.succeed(`Approval decision: ${decision.decision}`);
    }
  });

  engine.on('build:started', ({ plan }) => {
    spinner.start('Building project...');
    newline();
    subheader('Execution Plan');
    keyValue({
      'Total Phases': plan.phases.length,
      'Total Tasks': plan.totalTasks,
      'Parallelism': `${plan.estimatedParallelism.toFixed(1)}x`,
    });
  });

  engine.on('build:completed', ({ result }) => {
    if (result.success) {
      spinner.succeed('Build completed successfully');
    } else {
      spinner.fail('Build completed with errors');
    }
    newline();
    subheader('Build Results');
    keyValue({
      'Status': result.success ? 'Success' : 'Failed',
      'Tasks Completed': result.tasksCompleted,
      'Tasks Failed': result.tasksFailed,
      'Duration': duration(result.duration),
    });
  });

  engine.on('workflow:completed', ({ state }) => {
    newline();
    console.log('='.repeat(50));
    console.log(success('BUILD COMPLETED SUCCESSFULLY'));
    console.log('='.repeat(50));
    newline();

    const totalDuration = Date.now() - state.startedAt.getTime();
    keyValue({
      'Total Duration': duration(totalDuration),
      'Final Phase': state.phase,
    });
    newline();
  });

  engine.on('workflow:failed', ({ error: errorMsg }) => {
    newline();
    console.log('='.repeat(50));
    console.log(error('BUILD FAILED'));
    console.log('='.repeat(50));
    newline();
    console.log(error(errorMsg));
    newline();
  });

  engine.on('workflow:cancelled', ({ reason }) => {
    newline();
    console.log(warning('Build cancelled'));
    if (reason) {
      console.log(info(`Reason: ${reason}`));
    }
  });

  // Set up timeout if specified
  let timeoutHandle: NodeJS.Timeout | undefined;
  if (options.timeout) {
    timeoutHandle = setTimeout(async () => {
      console.log(warning(`Build timeout reached (${options.timeout}s)`));
      await engine.cancelWorkflow(project.id, 'Timeout');
      process.exit(1);
    }, options.timeout * 1000);
  }

  // Handle Ctrl+C gracefully
  process.on('SIGINT', async () => {
    newline();
    console.log(warning('Received interrupt signal...'));
    await engine.cancelWorkflow(project.id, 'User interrupt');
    process.exit(0);
  });

  // Start the build
  newline();
  console.log(colorize('Starting build...', 'bold'));
  newline();

  try {
    if (options.demoOnly) {
      // Build demo only
      const demoType = options.demoType || 'wow';
      spinner.start(`Building ${demoType} demo...`);

      await engine.startProjectBuild(project.id);

      // The workflow will stop after demo is ready and approved
      // For demo-only mode, we wait for the demo phase to complete

    } else {
      // Full build
      await engine.startProjectBuild(project.id);
    }

    // Clear timeout if build completes
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

  } catch (err) {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    const message = err instanceof Error ? err.message : 'Unknown error';

    if (message.includes('cancelled')) {
      // Already handled by event
      process.exit(0);
    }

    console.log(error(`Build failed: ${message}`));
    process.exit(1);
  }
}

function getPhaseIcon(phase: WorkflowPhase): string {
  const icons: Record<WorkflowPhase, string> = {
    planning: '\x1b[34m[Planning]\x1b[0m',
    architect: '\x1b[35m[Architect]\x1b[0m',
    approval_pending: '\x1b[33m[Awaiting Approval]\x1b[0m',
    demo_building: '\x1b[36m[Building Demo]\x1b[0m',
    demo_ready: '\x1b[32m[Demo Ready]\x1b[0m',
    demo_approved: '\x1b[32m[Demo Approved]\x1b[0m',
    building: '\x1b[34m[Building]\x1b[0m',
    testing: '\x1b[33m[Testing]\x1b[0m',
    completed: '\x1b[32m[Completed]\x1b[0m',
    failed: '\x1b[31m[Failed]\x1b[0m',
    cancelled: '\x1b[31m[Cancelled]\x1b[0m',
  };
  return icons[phase] || `[${phase}]`;
}

function showHelp(): void {
  console.log('Usage: eklavya build <project-id> [options]');
  newline();
  console.log('Trigger the workflow engine to build a project');
  newline();
  console.log('Options:');
  console.log('  -d, --demo-only         Build demo only (no full build)');
  console.log('  -t, --demo-type <type>  Demo type: wow, trust, milestone');
  console.log('  -a, --auto-approve      Auto-approve demos (skip approval wait)');
  console.log('  -w, --watch             Watch build progress (for ongoing builds)');
  console.log('      --timeout <seconds> Build timeout in seconds');
  console.log('  -h, --help              Show this help');
  newline();
  console.log('Examples:');
  console.log('  eklavya build my-project');
  console.log('  eklavya build my-project --demo-only');
  console.log('  eklavya build my-project --auto-approve');
  console.log('  eklavya build my-project --timeout 3600');
  newline();
  console.log('Workflow Phases:');
  console.log('  1. Planning    - Initialize project structure');
  console.log('  2. Architect   - Analyze requirements, generate task plan');
  console.log('  3. Demo (Wow)  - Build visual prototype');
  console.log('  4. Approval    - Wait for admin approval');
  console.log('  5. Demo (Trust)- Build working prototype');
  console.log('  6. Build       - Full implementation');
  console.log('  7. Testing     - Run all tests');
  console.log('  8. Completed   - Build finished');
  newline();
}
