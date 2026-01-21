/**
 * Demo Command
 * View and manage project demos
 */

import { parseArgs } from 'util';
import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { createSpinner } from '../utils/spinner.js';
import {
  success, error, info, header, subheader, keyValue, table,
  newline, colorize, statusBadge, dim,
} from '../utils/output.js';
import { initializeDatabase, getDb } from '../utils/config.js';

export async function demoCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      open: { type: 'boolean', short: 'o' },
      screenshots: { type: 'boolean', short: 's' },
      number: { type: 'string', short: 'n' },
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
    console.log(info('Usage: eklavya demo <project-id> [options]'));
    process.exit(1);
  }

  const projectId = positionals[0];
  const demoNumber = values.number ? parseInt(values.number as string, 10) : undefined;

  await showDemos(projectId, {
    open: values.open as boolean,
    showScreenshots: values.screenshots as boolean,
    demoNumber,
  });
}

function openUrl(url: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

async function showDemos(
  projectId: string,
  options: {
    open?: boolean;
    showScreenshots?: boolean;
    demoNumber?: number;
  }
): Promise<void> {
  const spinner = createSpinner(`Loading demos for ${projectId}...`);
  spinner.start();

  try {
    await initializeDatabase();
    const db = getDb();

    // Get project
    const projectResult = await db.query(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      spinner.fail('Project not found');
      console.log(error(`No project with ID "${projectId}"`));
      process.exit(1);
    }

    const project = projectResult.rows[0];

    // Get demos
    let demosQuery = `
      SELECT * FROM demos WHERE project_id = $1
    `;
    const params: (string | number)[] = [projectId];

    if (options.demoNumber !== undefined) {
      demosQuery += ` AND demo_number = $2`;
      params.push(options.demoNumber);
    }

    demosQuery += ` ORDER BY demo_number ASC`;

    const demosResult = await db.query(demosQuery, params);

    spinner.succeed(`Found ${demosResult.rows.length} demo(s)`);
    newline();

    if (demosResult.rows.length === 0) {
      console.log(info('No demos found for this project'));
      if (options.demoNumber !== undefined) {
        console.log(info(`Demo ${options.demoNumber} does not exist`));
      }
      return;
    }

    header(`Demos: ${project.name}`);
    newline();

    for (const demo of demosResult.rows) {
      subheader(`Demo ${demo.demo_number} ${statusBadge(demo.status)}`);

      keyValue({
        'Description': demo.description || '-',
        'URL': demo.url || '-',
        'Created': new Date(demo.created_at).toLocaleString(),
        'Status': demo.status,
      });

      if (demo.feedback) {
        newline();
        console.log(colorize('Feedback:', 'yellow'));
        console.log(`  "${demo.feedback}"`);
      }

      if (demo.features) {
        try {
          const features = JSON.parse(demo.features);
          if (features.length > 0) {
            newline();
            console.log(colorize('Features:', 'cyan'));
            features.forEach((f: string) => {
              console.log(`  • ${f}`);
            });
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Screenshots section
      if (options.showScreenshots && demo.screenshots_path) {
        newline();
        console.log(colorize('Screenshots:', 'magenta'));
        const screenshotsPath = demo.screenshots_path as string;

        if (existsSync(screenshotsPath)) {
          try {
            const files = readdirSync(screenshotsPath)
              .filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
            files.forEach(f => {
              console.log(`  📷 ${join(screenshotsPath, f)}`);
            });
            if (files.length === 0) {
              console.log(dim('  No screenshots found'));
            }
          } catch {
            console.log(dim('  Could not read screenshots directory'));
          }
        } else {
          console.log(dim('  Screenshots directory not found'));
        }
      }

      newline();

      // Open demo if requested
      if (options.open && demo.url && demo.status === 'ready') {
        console.log(info(`Opening ${demo.url}...`));
        openUrl(demo.url);
      }
    }

    // Summary table
    if (demosResult.rows.length > 1) {
      subheader('Summary');
      const rows = demosResult.rows.map((d: Record<string, unknown>) => [
        `Demo ${d.demo_number}`,
        statusBadge(d.status as string),
        (d.url as string) || '-',
        new Date(d.created_at as string).toLocaleDateString(),
      ]);
      table(rows, ['Demo', 'Status', 'URL', 'Created']);
    }

    // Next steps
    const readyDemos = demosResult.rows.filter(
      (d: Record<string, unknown>) => d.status === 'ready'
    );
    if (readyDemos.length > 0 && !options.open) {
      newline();
      console.log(colorize('Actions:', 'bold'));
      console.log(`  • View demo: eklavya demo ${projectId} --open`);
      console.log(`  • Approve: eklavya approve ${projectId}`);
    }

  } catch (err) {
    spinner.fail('Failed to load demos');
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }
}

function showHelp(): void {
  console.log('Usage: eklavya demo <project-id> [options]');
  newline();
  console.log('View and manage project demos');
  newline();
  console.log('Options:');
  console.log('  -o, --open           Open demo in browser');
  console.log('  -s, --screenshots    Show screenshot paths');
  console.log('  -n, --number <n>     Show specific demo number');
  console.log('  -h, --help           Show this help');
  newline();
  console.log('Examples:');
  console.log('  eklavya demo my-app            # List all demos');
  console.log('  eklavya demo my-app --open     # Open ready demo');
  console.log('  eklavya demo my-app -n 0       # Show Demo 0 details');
  console.log('  eklavya demo my-app -s         # Include screenshots');
}
