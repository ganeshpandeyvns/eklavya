/**
 * Logs Command
 * Stream project and agent logs
 */

import { parseArgs } from 'util';
import { createSpinner } from '../utils/spinner.js';
import {
  error, info, header, newline, colorize, timestamp, dim,
} from '../utils/output.js';
import { initializeDatabase, getDb } from '../utils/config.js';

export async function logsCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      follow: { type: 'boolean', short: 'f' },
      agent: { type: 'string', short: 'a' },
      level: { type: 'string', short: 'l' },
      limit: { type: 'string', short: 'n' },
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
    console.log(info('Usage: eklavya logs <project-id> [options]'));
    process.exit(1);
  }

  const projectId = positionals[0];

  await streamLogs(projectId, {
    follow: values.follow as boolean,
    agentType: values.agent as string | undefined,
    level: values.level as string | undefined,
    limit: values.limit ? parseInt(values.limit as string, 10) : 50,
  });
}

const LOG_COLORS: Record<string, keyof typeof import('../utils/output.js').colors> = {
  critical: 'red',
  important: 'yellow',
  info: 'blue',
  silent: 'gray',
};

const AGENT_ICONS: Record<string, string> = {
  orchestrator: '🎯',
  architect: '📐',
  developer: '💻',
  tester: '🧪',
  qa: '🔍',
  pm: '📋',
  uat: '👤',
  sre: '🔧',
  monitor: '📊',
  mentor: '🎓',
};

async function streamLogs(
  projectId: string,
  options: {
    follow?: boolean;
    agentType?: string;
    level?: string;
    limit: number;
  }
): Promise<void> {
  const spinner = createSpinner(`Loading logs for ${projectId}...`);
  spinner.start();

  try {
    await initializeDatabase();
    const db = getDb();

    // Verify project exists
    const projectResult = await db.query(
      `SELECT id, name FROM projects WHERE id = $1`,
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      spinner.fail('Project not found');
      console.log(error(`No project with ID "${projectId}"`));
      process.exit(1);
    }

    const project = projectResult.rows[0];

    // Build query using activity_stream table
    let query = `
      SELECT a.id, a.project_id, a.agent_id, a.agent_type,
             a.event_type, a.action as message, a.details,
             a.notification_level as level, a.created_at
      FROM activity_stream a
      WHERE a.project_id = $1
    `;

    const params: (string | number)[] = [projectId];
    let paramIndex = 2;

    if (options.agentType) {
      query += ` AND a.agent_type = $${paramIndex}`;
      params.push(options.agentType);
      paramIndex++;
    }

    if (options.level) {
      const levels = getLevelsForFilter(options.level);
      query += ` AND a.notification_level = ANY($${paramIndex}::notification_level[])`;
      params.push(`{${levels.join(',')}}`);
      paramIndex++;
    }

    query += ` ORDER BY a.created_at DESC LIMIT $${paramIndex}`;
    params.push(options.limit);

    const result = await db.query(query, params);

    spinner.succeed(`Loaded ${result.rows.length} log entries`);
    newline();

    header(`Logs: ${project.name}`);
    if (options.agentType) {
      console.log(dim(`Filtered by agent: ${options.agentType}`));
    }
    if (options.level) {
      console.log(dim(`Filtered by level: ${options.level}+`));
    }
    newline();

    // Display logs in reverse order (oldest first)
    const logs = result.rows.reverse();
    for (const log of logs) {
      printLogEntry(log);
    }

    if (result.rows.length === 0) {
      console.log(info('No log entries found'));
    }

    // Follow mode
    if (options.follow) {
      newline();
      console.log(dim('─ Following logs (Ctrl+C to stop) ─'));
      newline();

      let lastId = logs.length > 0 ? logs[logs.length - 1].id : 0;

      const pollInterval = setInterval(async () => {
        try {
          let followQuery = `
            SELECT a.id, a.project_id, a.agent_id, a.agent_type,
                   a.event_type, a.action as message, a.details,
                   a.notification_level as level, a.created_at
            FROM activity_stream a
            WHERE a.project_id = $1 AND a.id > $2
          `;
          const followParams: (string | number)[] = [projectId, lastId];

          if (options.agentType) {
            followQuery += ` AND a.agent_type = $3`;
            followParams.push(options.agentType);
          }

          followQuery += ` ORDER BY a.created_at ASC`;

          const newLogs = await db.query(followQuery, followParams);

          for (const log of newLogs.rows) {
            printLogEntry(log);
            lastId = log.id;
          }
        } catch (err) {
          clearInterval(pollInterval);
          console.log(error('Lost connection to database'));
        }
      }, 1000);

      // Handle Ctrl+C
      process.on('SIGINT', () => {
        clearInterval(pollInterval);
        newline();
        console.log(info('Stopped following logs'));
        process.exit(0);
      });

      // Keep process alive
      await new Promise(() => {});
    }

  } catch (err) {
    spinner.fail('Failed to load logs');
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }
}

function printLogEntry(log: Record<string, unknown>): void {
  const level = (log.level as string) || 'info';
  const agentType = log.agent_type as string | undefined;
  const message = log.message as string;
  const createdAt = log.created_at as string;

  const levelColor = LOG_COLORS[level] || 'white';
  const icon = agentType ? (AGENT_ICONS[agentType] || '📝') : '📝';
  const agentLabel = agentType ? `[${agentType}]` : '';

  const time = new Date(createdAt).toLocaleTimeString();
  const levelBadge = colorize(level.toUpperCase().padEnd(5), levelColor);

  console.log(
    `${dim(time)} ${levelBadge} ${icon} ${colorize(agentLabel, 'cyan')} ${message}`
  );

  // Show details if present
  if (log.details) {
    try {
      const details = typeof log.details === 'string'
        ? JSON.parse(log.details)
        : log.details;
      if (Object.keys(details).length > 0) {
        console.log(dim(`         ${JSON.stringify(details)}`));
      }
    } catch {
      // Ignore parse errors
    }
  }
}

function getLevelsForFilter(level: string): string[] {
  // notification_level enum: critical, important, info, silent
  const allLevels = ['critical', 'important', 'info', 'silent'];
  const index = allLevels.indexOf(level.toLowerCase());
  if (index === -1) return allLevels;
  return allLevels.slice(0, index + 1);
}

function showHelp(): void {
  console.log('Usage: eklavya logs <project-id> [options]');
  newline();
  console.log('Stream project and agent logs');
  newline();
  console.log('Options:');
  console.log('  -f, --follow         Follow logs in real-time');
  console.log('  -a, --agent <type>   Filter by agent type');
  console.log('  -l, --level <level>  Minimum log level (error, warn, info, debug)');
  console.log('  -n, --limit <n>      Number of entries to show (default: 50)');
  console.log('  -h, --help           Show this help');
  newline();
  console.log('Agent types: orchestrator, architect, developer, tester, qa, pm, uat, sre, monitor, mentor');
  newline();
  console.log('Examples:');
  console.log('  eklavya logs my-app              # Show recent logs');
  console.log('  eklavya logs my-app -f           # Follow logs');
  console.log('  eklavya logs my-app -a developer # Developer logs only');
  console.log('  eklavya logs my-app -l error     # Errors only');
}
