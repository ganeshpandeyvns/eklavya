/**
 * List Command
 * List all projects with filtering
 */

import { parseArgs } from 'util';
import { createSpinner } from '../utils/spinner.js';
import {
  error, info, header, table, newline, colorize, statusBadge, cost,
} from '../utils/output.js';
import { initializeDatabase, getDb } from '../utils/config.js';

export async function listCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      status: { type: 'string', short: 's' },
      limit: { type: 'string', short: 'l' },
      all: { type: 'boolean', short: 'a' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (values.help) {
    showHelp();
    return;
  }

  const spinner = createSpinner('Loading projects...');
  spinner.start();

  try {
    await initializeDatabase();
    const db = getDb();

    let query = `
      SELECT
        p.id, p.name, p.status, p.budget_cost_usd, p.cost_used,
        p.created_at, p.updated_at,
        COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'working') as active_agents,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'ready') as ready_demos
      FROM projects p
      LEFT JOIN agents a ON a.project_id = p.id
      LEFT JOIN demos d ON d.project_id = p.id
    `;

    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (values.status) {
      query += ` WHERE p.status = $${paramIndex}`;
      params.push(values.status as string);
      paramIndex++;
    } else if (!values.all) {
      // By default, hide completed projects
      query += ` WHERE p.status != 'completed' AND p.status != 'failed'`;
    }

    query += ` GROUP BY p.id ORDER BY p.updated_at DESC`;

    const limit = values.limit ? parseInt(values.limit as string, 10) : 20;
    query += ` LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.query(query, params);

    spinner.succeed(`Found ${result.rows.length} project(s)`);
    newline();

    if (result.rows.length === 0) {
      if (values.status) {
        console.log(info(`No projects with status "${values.status}"`));
      } else {
        console.log(info('No active projects. Create one with: eklavya new <name>'));
      }
      return;
    }

    header('Projects');
    newline();

    const rows = result.rows.map((p: Record<string, unknown>) => {
      let indicators = '';
      if ((p.ready_demos as number) > 0) indicators += ' 📦';
      if ((p.active_agents as number) > 0) indicators += ' 🤖';

      return [
        p.id as string,
        ((p.name as string).substring(0, 25) + indicators),
        statusBadge(p.status as string),
        cost((p.cost_used as number) || 0),
        `${p.active_agents} agents`,
        timeAgo(p.updated_at as string),
      ];
    });

    table(rows, ['ID', 'Name', 'Status', 'Spent', 'Active', 'Updated']);
    newline();

    console.log(colorize('Legend:', 'dim') + ' 📦 Demo ready  🤖 Agents working');
    newline();

    if (!values.all && !values.status) {
      console.log(info('Showing active projects. Use --all to include completed.'));
    }

  } catch (err) {
    spinner.fail('Failed to load projects');
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function showHelp(): void {
  console.log('Usage: eklavya list [options]');
  newline();
  console.log('List all projects');
  newline();
  console.log('Options:');
  console.log('  -s, --status <status>  Filter by status (active, planning, paused, completed, failed)');
  console.log('  -l, --limit <n>        Maximum number of projects to show (default: 20)');
  console.log('  -a, --all              Include completed and failed projects');
  console.log('  -h, --help             Show this help');
  newline();
  console.log('Examples:');
  console.log('  eklavya list                    # List active projects');
  console.log('  eklavya list --status planning  # List planning projects');
  console.log('  eklavya list --all              # List all including completed');
}
