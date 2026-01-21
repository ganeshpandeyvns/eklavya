/**
 * Config Command
 * Manage CLI configuration
 */

import { parseArgs } from 'util';
import {
  success, error, info, header, subheader, keyValue,
  newline, colorize, dim,
} from '../utils/output.js';
import {
  loadConfig, saveConfig, getConfigValue, setConfigValue,
  type CliConfig,
} from '../utils/config.js';

export async function configCommand(args: string[]): Promise<void> {
  const { positionals } = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (positionals.length === 0 || positionals[0] === 'list') {
    showConfig();
    return;
  }

  const action = positionals[0];

  switch (action) {
    case 'get':
      if (positionals.length < 2) {
        console.log(error('Key is required'));
        console.log(info('Usage: eklavya config get <key>'));
        process.exit(1);
      }
      getConfig(positionals[1]);
      break;

    case 'set':
      if (positionals.length < 3) {
        console.log(error('Key and value are required'));
        console.log(info('Usage: eklavya config set <key> <value>'));
        process.exit(1);
      }
      setConfig(positionals[1], positionals[2]);
      break;

    case 'reset':
      resetConfig();
      break;

    case 'help':
    default:
      showHelp();
  }
}

function showConfig(): void {
  const config = loadConfig();

  header('Eklavya Configuration');
  newline();

  subheader('Database');
  keyValue({
    'Host': config.database.host,
    'Port': config.database.port.toString(),
    'Database': config.database.database,
    'User': config.database.user,
    'Password': config.database.password ? '********' : dim('(not set)'),
  });

  subheader('Defaults');
  keyValue({
    'Max Budget': `$${config.defaults.maxBudget}`,
    'Max Concurrent Agents': config.defaults.maxConcurrentAgents.toString(),
    'Notification Level': config.defaults.notificationLevel,
  });

  subheader('UI');
  keyValue({
    'Colors': config.ui.colors ? 'enabled' : 'disabled',
    'Timestamps': config.ui.timestamps ? 'enabled' : 'disabled',
  });

  newline();
  console.log(dim('Config file: ~/.eklavya/config.json'));
  console.log(dim('Environment variables override file settings'));
}

function getConfig(key: string): void {
  const value = getConfigValue(key);

  if (value === undefined) {
    console.log(error(`Configuration key "${key}" not found`));
    newline();
    console.log('Available keys:');
    console.log('  database.host, database.port, database.database, database.user, database.password');
    console.log('  defaults.maxBudget, defaults.maxConcurrentAgents, defaults.notificationLevel');
    console.log('  ui.colors, ui.timestamps');
    process.exit(1);
  }

  if (typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

function setConfig(key: string, value: string): void {
  // Parse value based on key
  let parsedValue: unknown = value;

  // Boolean values
  if (value === 'true' || value === 'false') {
    parsedValue = value === 'true';
  }
  // Numeric values
  else if (!isNaN(Number(value)) && value.trim() !== '') {
    parsedValue = Number(value);
  }

  // Validate key
  const validKeys = [
    'database.host', 'database.port', 'database.database', 'database.user', 'database.password',
    'defaults.maxBudget', 'defaults.maxConcurrentAgents', 'defaults.notificationLevel',
    'ui.colors', 'ui.timestamps',
  ];

  if (!validKeys.includes(key)) {
    console.log(error(`Invalid configuration key: ${key}`));
    newline();
    console.log('Valid keys:');
    validKeys.forEach(k => console.log(`  ${k}`));
    process.exit(1);
  }

  // Validate notification level
  if (key === 'defaults.notificationLevel') {
    const validLevels = ['all', 'important', 'critical', 'none'];
    if (!validLevels.includes(value)) {
      console.log(error(`Invalid notification level: ${value}`));
      console.log(info(`Valid values: ${validLevels.join(', ')}`));
      process.exit(1);
    }
  }

  setConfigValue(key, parsedValue);
  console.log(success(`Set ${key} = ${value}`));
}

function resetConfig(): void {
  // Save empty config to reset to defaults
  const defaultConfig: Partial<CliConfig> = {};
  saveConfig(defaultConfig);

  console.log(success('Configuration reset to defaults'));
  newline();
  showConfig();
}

function showHelp(): void {
  console.log('Usage: eklavya config [command] [options]');
  newline();
  console.log('Manage CLI configuration');
  newline();
  console.log('Commands:');
  console.log('  list          Show all configuration (default)');
  console.log('  get <key>     Get a specific value');
  console.log('  set <key> <value>  Set a value');
  console.log('  reset         Reset to defaults');
  newline();
  console.log('Configuration Keys:');
  console.log(colorize('  Database:', 'cyan'));
  console.log('    database.host       PostgreSQL host (default: localhost)');
  console.log('    database.port       PostgreSQL port (default: 5432)');
  console.log('    database.database   Database name (default: eklavya)');
  console.log('    database.user       Database user (default: eklavya)');
  console.log('    database.password   Database password');
  newline();
  console.log(colorize('  Defaults:', 'cyan'));
  console.log('    defaults.maxBudget              Default budget per project (default: 100)');
  console.log('    defaults.maxConcurrentAgents    Max agents per project (default: 5)');
  console.log('    defaults.notificationLevel      all|important|critical|none');
  newline();
  console.log(colorize('  UI:', 'cyan'));
  console.log('    ui.colors       Enable/disable colors (true/false)');
  console.log('    ui.timestamps   Show timestamps (true/false)');
  newline();
  console.log('Environment Variables:');
  console.log('  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD');
  console.log('  Environment variables override config file settings');
  newline();
  console.log('Examples:');
  console.log('  eklavya config                     # Show all settings');
  console.log('  eklavya config get database.host   # Get specific value');
  console.log('  eklavya config set database.host 192.168.1.100');
  console.log('  eklavya config set defaults.maxBudget 200');
}
