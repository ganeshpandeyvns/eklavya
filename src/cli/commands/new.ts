/**
 * New Project Command
 * Creates a new autonomous project
 */

import { parseArgs } from 'util';
import { createSpinner } from '../utils/spinner.js';
import { success, error, info, header, keyValue, newline, colorize } from '../utils/output.js';
import { loadConfig, initializeDatabase, getDb } from '../utils/config.js';

interface NewProjectOptions {
  name: string;
  description?: string;
  budget?: number;
  type?: 'new' | 'existing';
  path?: string;
}

export async function newCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      description: { type: 'string', short: 'd' },
      budget: { type: 'string', short: 'b' },
      type: { type: 'string', short: 't' },
      path: { type: 'string', short: 'p' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    return;
  }

  if (positionals.length === 0) {
    console.log(error('Project name is required'));
    console.log(info('Usage: eklavya new <name> [options]'));
    process.exit(1);
  }

  const options: NewProjectOptions = {
    name: positionals[0],
    description: values.description as string | undefined,
    budget: values.budget ? parseFloat(values.budget as string) : undefined,
    type: (values.type as 'new' | 'existing') || 'new',
    path: values.path as string | undefined,
  };

  await createProject(options);
}

async function createProject(options: NewProjectOptions): Promise<void> {
  header(`Creating Project: ${options.name}`);
  newline();

  const spinner = createSpinner('Initializing database connection...');
  spinner.start();

  try {
    await initializeDatabase();
    spinner.succeed('Database connected');
  } catch (err) {
    spinner.fail('Database connection failed');
    console.log(error('Make sure PostgreSQL is running and configured'));
    console.log(info('Run "eklavya config list" to check database settings'));
    process.exit(1);
  }

  const config = loadConfig();
  const budget = options.budget || config.defaults.maxBudget;

  spinner.start('Creating project...');

  try {
    const db = getDb();

    // Check if project with same name exists
    const existing = await db.query(
      'SELECT id FROM projects WHERE name = $1',
      [options.name]
    );

    if (existing.rows.length > 0) {
      spinner.fail('Project already exists');
      console.log(error(`A project with name "${options.name}" already exists`));
      console.log(info('Use "eklavya status ' + existing.rows[0].id + '" to check its status'));
      process.exit(1);
    }

    // Create the project (let PostgreSQL generate UUID)
    const result = await db.query(
      `INSERT INTO projects (name, description, status, budget_cost_usd, config, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, name, status, created_at`,
      [
        options.name,
        options.description || `Project: ${options.name}`,
        'planning',
        budget,
        JSON.stringify({ type: options.type }),
      ]
    );

    const project = result.rows[0];

    spinner.succeed('Project created');
    newline();

    console.log(colorize('Project Details:', 'bold'));
    keyValue({
      'ID': project.id,
      'Name': project.name,
      'Status': 'planning',
      'Budget': `$${budget}`,
      'Type': options.type === 'existing' ? 'Import Existing' : 'New Project',
      'Created': new Date(project.created_at).toLocaleString(),
    });
    newline();

    console.log(colorize('Next Steps:', 'bold'));
    if (options.type === 'existing' && options.path) {
      console.log(`  1. Analyzing codebase at: ${options.path}`);
      console.log('  2. Generating health report...');
    } else {
      console.log('  1. Orchestrator will analyze requirements');
      console.log('  2. Architect will create technical plan');
      console.log('  3. You will be notified for approval');
    }
    newline();

    console.log(success(`Project "${options.name}" created successfully!`));
    console.log(info(`Run "eklavya status ${project.id}" to monitor progress`));

  } catch (err) {
    spinner.fail('Failed to create project');
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(error(message));
    process.exit(1);
  }
}

function showHelp(): void {
  console.log('Usage: eklavya new <name> [options]');
  newline();
  console.log('Create a new autonomous project');
  newline();
  console.log('Options:');
  console.log('  -d, --description <text>  Project description');
  console.log('  -b, --budget <amount>     Budget limit in USD (default: 100)');
  console.log('  -t, --type <type>         Project type: new or existing');
  console.log('  -p, --path <path>         Path to existing codebase (for imports)');
  console.log('  -h, --help                Show this help');
  newline();
  console.log('Examples:');
  console.log('  eklavya new my-app -d "E-commerce platform"');
  console.log('  eklavya new client-fix -t existing -p ./client-code');
}
