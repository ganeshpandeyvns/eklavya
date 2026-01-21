/**
 * Approve Command
 * Approve demos, decisions, and provide feedback
 */

import { parseArgs } from 'util';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { createSpinner } from '../utils/spinner.js';
import {
  success, error, info, header, subheader, keyValue, table,
  newline, colorize, statusBadge, divider,
} from '../utils/output.js';
import { initializeDatabase, getDb } from '../utils/config.js';

export async function approveCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      demo: { type: 'string', short: 'd' },
      feedback: { type: 'string', short: 'f' },
      skip: { type: 'boolean', short: 's' },
      reject: { type: 'boolean', short: 'r' },
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
    console.log(info('Usage: eklavya approve <project-id> [options]'));
    process.exit(1);
  }

  const projectId = positionals[0];
  const demoNumber = values.demo ? parseInt(values.demo as string, 10) : undefined;

  await handleApproval(projectId, {
    demoNumber,
    feedback: values.feedback as string | undefined,
    skip: values.skip as boolean,
    reject: values.reject as boolean,
  });
}

async function handleApproval(
  projectId: string,
  options: {
    demoNumber?: number;
    feedback?: string;
    skip?: boolean;
    reject?: boolean;
  }
): Promise<void> {
  const spinner = createSpinner(`Loading project ${projectId}...`);
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

    // Get pending decisions
    const decisionsResult = await db.query(
      `SELECT * FROM decisions
       WHERE project_id = $1 AND status = 'pending'
       ORDER BY created_at ASC`,
      [projectId]
    );

    // Get ready demos
    const demosResult = await db.query(
      `SELECT * FROM demos
       WHERE project_id = $1 AND status = 'ready'
       ORDER BY demo_number ASC`,
      [projectId]
    );

    spinner.succeed('Project loaded');
    newline();

    header(`Approval: ${project.name}`);
    newline();

    // If specific demo requested
    if (options.demoNumber !== undefined) {
      const demo = demosResult.rows.find(
        (d: Record<string, unknown>) => d.demo_number === options.demoNumber
      );
      if (!demo) {
        console.log(error(`Demo ${options.demoNumber} not found or not ready for review`));
        process.exit(1);
      }
      await approveDemo(db, project, demo, options);
      return;
    }

    // Show pending items
    const pendingDemos = demosResult.rows.filter(
      (d: Record<string, unknown>) => d.status === 'ready'
    );
    const pendingDecisions = decisionsResult.rows;

    if (pendingDemos.length === 0 && pendingDecisions.length === 0) {
      console.log(info('No pending approvals for this project'));
      console.log(`Project status: ${statusBadge(project.status)}`);
      return;
    }

    // List pending demos
    if (pendingDemos.length > 0) {
      subheader('Pending Demos');
      for (const demo of pendingDemos) {
        console.log(
          `  ${colorize(`Demo ${demo.demo_number}`, 'cyan')} - ` +
          `${demo.description || 'Ready for review'}`
        );
        if (demo.url) {
          console.log(`    URL: ${colorize(demo.url, 'blue')}`);
        }
        console.log(`    Created: ${new Date(demo.created_at).toLocaleString()}`);
        newline();
      }
    }

    // List pending decisions
    if (pendingDecisions.length > 0) {
      subheader('Pending Decisions');
      for (const decision of pendingDecisions) {
        console.log(`  ${colorize(decision.title, 'yellow')}`);
        console.log(`    ${decision.description}`);
        if (decision.options) {
          const opts = JSON.parse(decision.options);
          console.log('    Options:');
          opts.forEach((opt: string, i: number) => {
            console.log(`      ${i + 1}. ${opt}`);
          });
        }
        newline();
      }
    }

    divider();

    // Interactive approval if no flags provided
    if (!options.feedback && !options.skip && !options.reject) {
      await interactiveApproval(db, project, pendingDemos, pendingDecisions);
    }

  } catch (err) {
    spinner.fail('Failed to process approval');
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }
}

async function approveDemo(
  db: ReturnType<typeof getDb>,
  project: Record<string, unknown>,
  demo: Record<string, unknown>,
  options: { feedback?: string; skip?: boolean; reject?: boolean }
): Promise<void> {
  let newStatus: string;
  let action: string;

  if (options.reject) {
    newStatus = 'rejected';
    action = 'rejected';
  } else if (options.skip) {
    newStatus = 'skipped';
    action = 'skipped (proceeding to build)';
  } else {
    newStatus = 'approved';
    action = 'approved';
  }

  await db.query(
    `UPDATE demos SET status = $1, feedback = $2, approved_at = NOW()
     WHERE project_id = $3 AND demo_number = $4`,
    [newStatus, options.feedback || null, project.id, demo.demo_number]
  );

  // Update project status if needed
  if (newStatus === 'approved' || newStatus === 'skipped') {
    await db.query(
      `UPDATE projects SET status = 'active', updated_at = NOW()
       WHERE id = $1`,
      [project.id]
    );
  }

  // Log the decision
  await db.query(
    `INSERT INTO audit_log (project_id, action, details, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [project.id, 'demo_review', JSON.stringify({
      demo_number: demo.demo_number,
      action: newStatus,
      feedback: options.feedback,
    })]
  );

  console.log(success(`Demo ${demo.demo_number} ${action}`));

  if (options.feedback) {
    console.log(info(`Feedback: "${options.feedback}"`));
  }

  if (newStatus === 'approved') {
    console.log(info('Agents will proceed with next milestone'));
  } else if (newStatus === 'skipped') {
    console.log(info('Agents will proceed directly to full build'));
  } else if (newStatus === 'rejected') {
    console.log(info('Agents will revise based on feedback'));
  }
}

function openUrl(url: string): void {
  // Use spawn with 'open' command on macOS, avoiding shell injection
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

async function interactiveApproval(
  db: ReturnType<typeof getDb>,
  project: Record<string, unknown>,
  demos: Record<string, unknown>[],
  decisions: Record<string, unknown>[]
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  try {
    // Process demos
    for (const demo of demos) {
      newline();
      console.log(colorize(`Review Demo ${demo.demo_number}:`, 'bold'));
      console.log('  [a] Approve - Continue to next milestone');
      console.log('  [s] Skip - Proceed directly to full build');
      console.log('  [r] Reject - Request changes');
      console.log('  [v] View - Open demo in browser');
      console.log('  [q] Quit - Exit without action');
      newline();

      const answer = await question('Your choice: ');

      switch (answer.toLowerCase()) {
        case 'a':
          const approveFeedback = await question('Feedback (optional, press Enter to skip): ');
          await approveDemo(db, project, demo, { feedback: approveFeedback || undefined });
          break;
        case 's':
          await approveDemo(db, project, demo, { skip: true });
          break;
        case 'r':
          const rejectFeedback = await question('What needs to change? ');
          await approveDemo(db, project, demo, { feedback: rejectFeedback, reject: true });
          break;
        case 'v':
          if (demo.url) {
            openUrl(demo.url as string);
            console.log(info(`Opening ${demo.url}...`));
          } else {
            console.log(error('No URL available for this demo'));
          }
          break;
        case 'q':
          console.log(info('Exiting without action'));
          rl.close();
          return;
        default:
          console.log(error('Invalid choice'));
      }
    }

    // Process decisions
    for (const decision of decisions) {
      newline();
      console.log(colorize(`Decision Required: ${decision.title}`, 'bold'));
      console.log(`  ${decision.description}`);

      if (decision.options) {
        const opts = JSON.parse(decision.options as string);
        opts.forEach((opt: string, i: number) => {
          console.log(`  [${i + 1}] ${opt}`);
        });
      }
      console.log('  [q] Quit');
      newline();

      const answer = await question('Your choice: ');

      if (answer.toLowerCase() === 'q') {
        console.log(info('Exiting without action'));
        break;
      }

      const choice = parseInt(answer, 10);
      if (!isNaN(choice)) {
        await db.query(
          `UPDATE decisions SET status = 'resolved', chosen_option = $1, resolved_at = NOW()
           WHERE id = $2`,
          [choice, decision.id]
        );
        console.log(success('Decision recorded'));
      }
    }

  } finally {
    rl.close();
  }
}

function showHelp(): void {
  console.log('Usage: eklavya approve <project-id> [options]');
  newline();
  console.log('Approve demos, decisions, and provide feedback');
  newline();
  console.log('Options:');
  console.log('  -d, --demo <number>    Specific demo to review');
  console.log('  -f, --feedback <text>  Provide feedback');
  console.log('  -s, --skip             Skip demo, proceed to build');
  console.log('  -r, --reject           Reject and request changes');
  console.log('  -h, --help             Show this help');
  newline();
  console.log('Examples:');
  console.log('  eklavya approve my-app                  # Interactive review');
  console.log('  eklavya approve my-app -d 0             # Review Demo 0');
  console.log('  eklavya approve my-app -d 0 -f "LGTM"   # Approve with feedback');
  console.log('  eklavya approve my-app -d 0 -s          # Skip to build');
}
