/**
 * Stop Command
 * Stop projects or specific agents
 */

import { parseArgs } from 'util';
import * as readline from 'readline';
import { createSpinner } from '../utils/spinner.js';
import {
  success, error, info, header, table,
  newline, colorize, statusBadge,
} from '../utils/output.js';
import { initializeDatabase, getDb } from '../utils/config.js';

export async function stopCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      agent: { type: 'string', short: 'a' },
      force: { type: 'boolean', short: 'f' },
      all: { type: 'boolean' },
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
    console.log(info('Usage: eklavya stop <project-id> [options]'));
    process.exit(1);
  }

  const projectId = positionals[0];

  await handleStop(projectId, {
    agentId: values.agent as string | undefined,
    force: values.force as boolean,
    stopAll: values.all as boolean,
  });
}

async function handleStop(
  projectId: string,
  options: {
    agentId?: string;
    force?: boolean;
    stopAll?: boolean;
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

    // Get active agents
    const agentsResult = await db.query(
      `SELECT id, agent_type, status, current_task, tokens_used
       FROM agents WHERE project_id = $1 AND status IN ('working', 'idle', 'blocked')`,
      [projectId]
    );

    spinner.succeed('Project loaded');
    newline();

    header(`Stop: ${project.name}`);
    newline();

    const activeAgents = agentsResult.rows;

    if (activeAgents.length === 0) {
      console.log(info('No active agents to stop'));
      console.log(`Project status: ${statusBadge(project.status)}`);
      return;
    }

    // Show active agents
    console.log(colorize(`Active agents: ${activeAgents.length}`, 'yellow'));
    newline();

    const rows = activeAgents.map((a: Record<string, unknown>) => [
      (a.id as string).substring(0, 8),
      a.agent_type as string,
      statusBadge(a.status as string),
      (a.current_task as string)?.substring(0, 30) || '-',
    ]);
    table(rows, ['ID', 'Type', 'Status', 'Current Task']);
    newline();

    // Stop specific agent
    if (options.agentId) {
      const agent = activeAgents.find(
        (a: Record<string, unknown>) =>
          (a.id as string).startsWith(options.agentId!) ||
          a.agent_type === options.agentId
      );

      if (!agent) {
        console.log(error(`Agent "${options.agentId}" not found or not active`));
        process.exit(1);
      }

      await stopAgent(db, agent, options.force);
      return;
    }

    // Stop all agents
    if (options.stopAll || options.force) {
      if (!options.force) {
        const confirmed = await confirm(
          `Stop all ${activeAgents.length} agents? This will pause the project.`
        );
        if (!confirmed) {
          console.log(info('Cancelled'));
          return;
        }
      }

      await stopAllAgents(db, projectId, activeAgents);
      return;
    }

    // Interactive selection
    await interactiveStop(db, projectId, activeAgents);

  } catch (err) {
    spinner.fail('Failed to stop');
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }
}

async function stopAgent(
  db: ReturnType<typeof getDb>,
  agent: Record<string, unknown>,
  force?: boolean
): Promise<void> {
  const spinner = createSpinner(`Stopping agent ${agent.agent_type}...`);
  spinner.start();

  const newStatus = force ? 'terminated' : 'stopped';

  await db.query(
    `UPDATE agents SET status = $1, stopped_at = NOW()
     WHERE id = $2`,
    [newStatus, agent.id]
  );

  // Create checkpoint if not force
  if (!force) {
    await db.query(
      `INSERT INTO checkpoints (agent_id, project_id, state, created_at)
       VALUES ($1, (SELECT project_id FROM agents WHERE id = $1), $2, NOW())`,
      [agent.id, JSON.stringify({
        current_task: agent.current_task,
        tokens_used: agent.tokens_used,
        stopped_reason: 'user_requested',
      })]
    );
  }

  spinner.succeed(`Agent ${agent.agent_type} ${force ? 'terminated' : 'stopped'}`);

  if (!force) {
    console.log(info('Checkpoint created - agent can be resumed'));
  }
}

async function stopAllAgents(
  db: ReturnType<typeof getDb>,
  projectId: string,
  agents: Record<string, unknown>[]
): Promise<void> {
  const spinner = createSpinner(`Stopping ${agents.length} agents...`);
  spinner.start();

  // Stop all agents
  await db.query(
    `UPDATE agents SET status = 'stopped', stopped_at = NOW()
     WHERE project_id = $1 AND status IN ('working', 'idle', 'blocked')`,
    [projectId]
  );

  // Pause project
  await db.query(
    `UPDATE projects SET status = 'paused', updated_at = NOW()
     WHERE id = $1`,
    [projectId]
  );

  // Create checkpoints
  for (const agent of agents) {
    await db.query(
      `INSERT INTO checkpoints (agent_id, project_id, state, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [agent.id, projectId, JSON.stringify({
        current_task: agent.current_task,
        tokens_used: agent.tokens_used,
        stopped_reason: 'project_paused',
      })]
    );
  }

  spinner.succeed(`Stopped ${agents.length} agents`);
  console.log(info('Project paused - use "eklavya status" to check'));
  console.log(info('Checkpoints created - agents can be resumed'));
}

async function interactiveStop(
  db: ReturnType<typeof getDb>,
  projectId: string,
  agents: Record<string, unknown>[]
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
    console.log(colorize('Choose action:', 'bold'));
    console.log('  [1] Stop a specific agent');
    console.log('  [2] Stop all agents (pause project)');
    console.log('  [q] Cancel');
    newline();

    const choice = await question('Your choice: ');

    switch (choice) {
      case '1':
        newline();
        console.log('Enter agent ID prefix or type:');
        agents.forEach((a, i) => {
          console.log(`  [${i + 1}] ${a.agent_type} (${(a.id as string).substring(0, 8)})`);
        });
        newline();

        const agentChoice = await question('Agent number: ');
        const agentIndex = parseInt(agentChoice, 10) - 1;

        if (agentIndex >= 0 && agentIndex < agents.length) {
          await stopAgent(db, agents[agentIndex], false);
        } else {
          console.log(error('Invalid selection'));
        }
        break;

      case '2':
        const confirmed = await question('Stop all agents? (y/N): ');
        if (confirmed.toLowerCase() === 'y') {
          await stopAllAgents(db, projectId, agents);
        } else {
          console.log(info('Cancelled'));
        }
        break;

      case 'q':
        console.log(info('Cancelled'));
        break;

      default:
        console.log(error('Invalid choice'));
    }

  } finally {
    rl.close();
  }
}

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

function showHelp(): void {
  console.log('Usage: eklavya stop <project-id> [options]');
  newline();
  console.log('Stop projects or specific agents');
  newline();
  console.log('Options:');
  console.log('  -a, --agent <id>   Stop specific agent (ID prefix or type)');
  console.log('  -f, --force        Force stop without confirmation');
  console.log('      --all          Stop all agents (pause project)');
  console.log('  -h, --help         Show this help');
  newline();
  console.log('Examples:');
  console.log('  eklavya stop my-app                # Interactive stop');
  console.log('  eklavya stop my-app -a developer   # Stop developer agent');
  console.log('  eklavya stop my-app --all          # Stop all, pause project');
  console.log('  eklavya stop my-app --all -f       # Force stop all');
}
