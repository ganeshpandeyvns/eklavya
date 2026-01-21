#!/usr/bin/env node
/**
 * Eklavya CLI
 * Command-line interface for autonomous agent orchestration
 */

import { parseArgs } from 'util';
import { header, error, info, colorize, newline } from './utils/output.js';
import { loadConfig } from './utils/config.js';

// Command imports
import { newCommand } from './commands/new.js';
import { statusCommand } from './commands/status.js';
import { listCommand } from './commands/list.js';
import { approveCommand } from './commands/approve.js';
import { logsCommand } from './commands/logs.js';
import { configCommand } from './commands/config.js';
import { demoCommand } from './commands/demo.js';
import { stopCommand } from './commands/stop.js';

const VERSION = '1.0.0';

const COMMANDS: Record<string, {
  description: string;
  usage: string;
  handler: (args: string[]) => Promise<void>;
}> = {
  new: {
    description: 'Create a new project',
    usage: 'eklavya new <name> [--description "..."] [--budget <amount>]',
    handler: newCommand,
  },
  status: {
    description: 'Check project status',
    usage: 'eklavya status [project-id]',
    handler: statusCommand,
  },
  list: {
    description: 'List all projects',
    usage: 'eklavya list [--status <status>] [--limit <n>]',
    handler: listCommand,
  },
  approve: {
    description: 'Approve a demo or decision',
    usage: 'eklavya approve <project-id> [--demo <number>] [--feedback "..."]',
    handler: approveCommand,
  },
  logs: {
    description: 'Stream project logs',
    usage: 'eklavya logs <project-id> [--follow] [--agent <type>]',
    handler: logsCommand,
  },
  demo: {
    description: 'View or manage demos',
    usage: 'eklavya demo <project-id> [--open] [--screenshots]',
    handler: demoCommand,
  },
  stop: {
    description: 'Stop a project or agent',
    usage: 'eklavya stop <project-id> [--agent <id>] [--force]',
    handler: stopCommand,
  },
  config: {
    description: 'Manage CLI configuration',
    usage: 'eklavya config [get|set|list] [key] [value]',
    handler: configCommand,
  },
};

function showHelp(): void {
  header('Eklavya CLI');
  newline();
  console.log('Autonomous agent orchestration for software development');
  newline();

  console.log(colorize('USAGE:', 'bold'));
  console.log('  eklavya <command> [options]');
  newline();

  console.log(colorize('COMMANDS:', 'bold'));
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`  ${colorize(name.padEnd(12), 'cyan')} ${cmd.description}`);
  }
  newline();

  console.log(colorize('OPTIONS:', 'bold'));
  console.log('  -h, --help     Show help');
  console.log('  -v, --version  Show version');
  newline();

  console.log(colorize('EXAMPLES:', 'bold'));
  console.log('  eklavya new my-app --description "E-commerce platform"');
  console.log('  eklavya status my-app');
  console.log('  eklavya approve my-app --demo 0');
  console.log('  eklavya logs my-app --follow');
  newline();

  console.log(colorize('WORKFLOW:', 'bold'));
  console.log('  1. Create project:  eklavya new <name>');
  console.log('  2. Monitor status:  eklavya status <name>');
  console.log('  3. Review demo:     eklavya demo <name> --open');
  console.log('  4. Approve/adjust:  eklavya approve <name>');
  console.log('  5. Check logs:      eklavya logs <name> --follow');
  newline();
}

function showVersion(): void {
  console.log(`eklavya v${VERSION}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    showHelp();
    return;
  }

  if (args[0] === '-v' || args[0] === '--version') {
    showVersion();
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  if (!(command in COMMANDS)) {
    console.log(error(`Unknown command: ${command}`));
    newline();
    console.log(info('Run "eklavya --help" for available commands'));
    process.exit(1);
  }

  try {
    // Load config before running command
    loadConfig();

    await COMMANDS[command].handler(commandArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(error(err.message || 'Fatal error'));
  process.exit(1);
});
