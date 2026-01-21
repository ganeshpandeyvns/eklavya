#!/usr/bin/env npx tsx
/**
 * Apply migration 007 for Demo₇: Demo System
 */

import { getDatabase } from '../lib/database.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'eklavya',
  user: process.env.DB_USER || 'eklavya',
  password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
};

async function main() {
  const db = getDatabase(dbConfig);

  const migrationPath = join(__dirname, '../../migrations/007_demo7_demos.sql');
  const sql = readFileSync(migrationPath, 'utf8');

  try {
    await db.query(sql);
    console.log('✓ Migration 007_demo7_demos.sql applied successfully');
  } catch (err) {
    console.error('Error applying migration:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  await db.close();
}

main();
