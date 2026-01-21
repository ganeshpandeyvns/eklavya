/**
 * Status Command
 * Check project status and agent activity
 */

import { parseArgs } from 'util';
import { createSpinner } from '../utils/spinner.js';
import {
  success, error, info, header, subheader, keyValue, table,
  newline, colorize, statusBadge, cost, duration, progressBar,
} from '../utils/output.js';
import { initializeDatabase, getDb } from '../utils/config.js';

export async function statusCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      verbose: { type: 'boolean', short: 'v' },
      agents: { type: 'boolean', short: 'a' },
      tasks: { type: 'boolean', short: 't' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    return;
  }

  const projectId = positionals[0];

  if (!projectId) {
    // Show summary of all projects
    await showAllProjects();
  } else {
    // Show detailed status for specific project
    await showProjectStatus(projectId, {
      verbose: values.verbose as boolean,
      showAgents: values.agents as boolean,
      showTasks: values.tasks as boolean,
    });
  }
}

async function showAllProjects(): Promise<void> {
  const spinner = createSpinner('Loading projects...');
  spinner.start();

  try {
    await initializeDatabase();
    const db = getDb();

    const result = await db.query(`
      SELECT
        p.id, p.name, p.status, p.budget_cost_usd, p.cost_used,
        p.created_at, p.updated_at,
        COUNT(DISTINCT a.id) as agent_count,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'in_progress') as active_tasks
      FROM projects p
      LEFT JOIN agents a ON a.project_id = p.id AND a.status = 'working'
      LEFT JOIN tasks t ON t.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      LIMIT 20
    `);

    spinner.succeed(`Found ${result.rows.length} project(s)`);
    newline();

    if (result.rows.length === 0) {
      console.log(info('No projects found. Create one with: eklavya new <name>'));
      return;
    }

    header('Projects Overview');
    newline();

    // Group by status
    const byStatus: Record<string, typeof result.rows> = {};
    for (const project of result.rows) {
      const status = project.status || 'unknown';
      if (!byStatus[status]) byStatus[status] = [];
      byStatus[status].push(project);
    }

    // Display order
    const statusOrder = ['needs_attention', 'active', 'planning', 'paused', 'completed', 'failed'];

    for (const status of statusOrder) {
      const projects = byStatus[status];
      if (!projects || projects.length === 0) continue;

      subheader(`${statusBadge(status)} ${status.toUpperCase()}`);

      const rows = projects.map((p: Record<string, unknown>) => [
        p.id as string,
        (p.name as string).substring(0, 30),
        cost((p.cost_used as number) || 0) + ' / ' + cost(p.budget_cost_usd as number),
        `${p.agent_count} agents`,
        `${p.active_tasks} tasks`,
      ]);

      table(rows, ['ID', 'Name', 'Budget', 'Agents', 'Active']);
      newline();
    }

  } catch (err) {
    spinner.fail('Failed to load projects');
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }
}

async function showProjectStatus(
  projectId: string,
  options: { verbose?: boolean; showAgents?: boolean; showTasks?: boolean }
): Promise<void> {
  const spinner = createSpinner(`Loading project ${projectId}...`);
  spinner.start();

  try {
    await initializeDatabase();
    const db = getDb();

    // Get project details
    const projectResult = await db.query(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      spinner.fail('Project not found');
      console.log(error(`No project with ID "${projectId}"`));
      console.log(info('Run "eklavya list" to see all projects'));
      process.exit(1);
    }

    const project = projectResult.rows[0];

    // Get agents with their current task info
    const agentsResult = await db.query(
      `SELECT a.id, a.type, a.status, t.title as current_task,
              (a.metrics->>'tokens_used')::int as tokens_used, a.created_at
       FROM agents a
       LEFT JOIN tasks t ON a.current_task_id = t.id
       WHERE a.project_id = $1
       ORDER BY a.created_at DESC`,
      [projectId]
    );

    // Get recent tasks
    const tasksResult = await db.query(
      `SELECT id, title, status, assigned_agent_id, priority, created_at
       FROM tasks WHERE project_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [projectId]
    );

    // Get demos
    const demosResult = await db.query(
      `SELECT version, name, status, preview_url, created_at
       FROM demos WHERE project_id = $1
       ORDER BY version DESC`,
      [projectId]
    );

    spinner.succeed('Project loaded');
    newline();

    // Project header
    header(project.name);
    newline();

    // Status and budget
    console.log(colorize('Status:', 'bold'), statusBadge(project.status));
    const budgetPct = project.budget_cost_usd > 0
      ? ((project.cost_used || 0) / project.budget_cost_usd)
      : 0;
    console.log(colorize('Budget:', 'bold'), progressBar((project.cost_used || 0), project.budget_cost_usd, 20),
      cost(project.cost_used || 0), '/', cost(project.budget_cost_usd));
    newline();

    // Project details
    subheader('Details');
    keyValue({
      'ID': project.id,
      'Description': project.description?.substring(0, 60) || '-',
      'Type': project.project_type || 'new',
      'Created': new Date(project.created_at).toLocaleString(),
      'Updated': project.updated_at ? new Date(project.updated_at).toLocaleString() : '-',
    });

    // Demos section
    if (demosResult.rows.length > 0) {
      subheader('Demos');
      const demoRows = demosResult.rows.map((d: Record<string, unknown>) => [
        (d.name as string) || `Demo v${d.version}`,
        statusBadge(d.status as string),
        (d.preview_url as string) || '-',
        new Date(d.created_at as string).toLocaleDateString(),
      ]);
      table(demoRows, ['Demo', 'Status', 'URL', 'Date']);
    }

    // Agents section
    if (options.showAgents || options.verbose || agentsResult.rows.length > 0) {
      subheader(`Agents (${agentsResult.rows.length})`);
      if (agentsResult.rows.length > 0) {
        const agentRows = agentsResult.rows.map((a: Record<string, unknown>) => [
          (a.id as string).substring(0, 8),
          a.type as string,
          statusBadge(a.status as string),
          (a.current_task as string)?.substring(0, 30) || '-',
        ]);
        table(agentRows, ['ID', 'Type', 'Status', 'Current Task']);
      } else {
        console.log(info('No agents spawned yet'));
      }
    }

    // Tasks section
    if (options.showTasks || options.verbose) {
      subheader(`Recent Tasks (${tasksResult.rows.length})`);
      if (tasksResult.rows.length > 0) {
        const taskRows = tasksResult.rows.map((t: Record<string, unknown>) => [
          (t.id as string).substring(0, 8),
          (t.title as string).substring(0, 40),
          statusBadge(t.status as string),
          t.assigned_agent_id ? (t.assigned_agent_id as string).substring(0, 8) : '-',
        ]);
        table(taskRows, ['ID', 'Title', 'Status', 'Agent']);
      } else {
        console.log(info('No tasks created yet'));
      }
    }

    newline();

    // Next action hint
    if (project.status === 'needs_attention') {
      console.log(colorize('⚠ Action Required:', 'yellow'));
      console.log(`  Run "eklavya approve ${projectId}" to review pending decisions`);
    } else if (demosResult.rows.some((d: Record<string, unknown>) => d.status === 'ready')) {
      console.log(colorize('✓ Demo Ready:', 'green'));
      console.log(`  Run "eklavya demo ${projectId} --open" to view`);
    }

  } catch (err) {
    spinner.fail('Failed to load project');
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }
}

function showHelp(): void {
  console.log('Usage: eklavya status [project-id] [options]');
  newline();
  console.log('Check project status and agent activity');
  newline();
  console.log('Options:');
  console.log('  -v, --verbose  Show all details (agents, tasks)');
  console.log('  -a, --agents   Show agent details');
  console.log('  -t, --tasks    Show task details');
  console.log('  -h, --help     Show this help');
  newline();
  console.log('Examples:');
  console.log('  eklavya status              # List all projects');
  console.log('  eklavya status my-app       # Show my-app status');
  console.log('  eklavya status my-app -v    # Verbose output');
}
