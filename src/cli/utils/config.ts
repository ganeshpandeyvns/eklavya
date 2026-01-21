/**
 * CLI Configuration
 * Manages CLI settings and database connection
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getDatabase, type DatabaseConfig } from '../../lib/database.js';

export interface CliConfig {
  database: DatabaseConfig;
  defaults: {
    maxBudget: number;
    maxConcurrentAgents: number;
    notificationLevel: 'all' | 'important' | 'critical' | 'none';
  };
  ui: {
    colors: boolean;
    timestamps: boolean;
  };
}

const CONFIG_DIR = join(homedir(), '.eklavya');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: CliConfig = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'eklavya',
    user: process.env.DB_USER || 'eklavya',
    password: process.env.DB_PASSWORD || '',
  },
  defaults: {
    maxBudget: 100,
    maxConcurrentAgents: 5,
    notificationLevel: 'important',
  },
  ui: {
    colors: true,
    timestamps: true,
  },
};

let cachedConfig: CliConfig | null = null;

export function loadConfig(): CliConfig {
  if (cachedConfig) return cachedConfig;

  if (existsSync(CONFIG_FILE)) {
    try {
      const fileContent = readFileSync(CONFIG_FILE, 'utf-8');
      const fileConfig = JSON.parse(fileContent);
      cachedConfig = { ...DEFAULT_CONFIG, ...fileConfig };
    } catch {
      cachedConfig = DEFAULT_CONFIG;
    }
  } else {
    cachedConfig = DEFAULT_CONFIG;
  }

  // Override with environment variables
  if (process.env.DB_HOST) cachedConfig.database.host = process.env.DB_HOST;
  if (process.env.DB_PORT) cachedConfig.database.port = parseInt(process.env.DB_PORT, 10);
  if (process.env.DB_NAME) cachedConfig.database.database = process.env.DB_NAME;
  if (process.env.DB_USER) cachedConfig.database.user = process.env.DB_USER;
  if (process.env.DB_PASSWORD) cachedConfig.database.password = process.env.DB_PASSWORD;

  return cachedConfig;
}

export function saveConfig(config: Partial<CliConfig>): void {
  const currentConfig = loadConfig();
  const newConfig = { ...currentConfig, ...config };

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  cachedConfig = newConfig;
}

export function getConfigValue(key: string): unknown {
  const config = loadConfig();
  const keys = key.split('.');
  let value: unknown = config;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }

  return value;
}

export function setConfigValue(key: string, value: unknown): void {
  const config = loadConfig();
  const keys = key.split('.');
  let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;

  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!(k in obj) || typeof obj[k] !== 'object') {
      obj[k] = {};
    }
    obj = obj[k] as Record<string, unknown>;
  }

  obj[keys[keys.length - 1]] = value;
  saveConfig(config);
}

export async function initializeDatabase(): Promise<void> {
  const config = loadConfig();
  const db = getDatabase(config.database);
  await db.connect();
}

export function getDb() {
  return getDatabase();
}
