#!/usr/bin/env npx tsx
/**
 * Fix: Update calculate_project_progress function to use correct column names
 */

import { getDatabase } from '../lib/database.js';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'eklavya',
  user: process.env.DB_USER || 'eklavya',
  password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
};

const sql = `
CREATE OR REPLACE FUNCTION calculate_project_progress(p_project_id UUID)
RETURNS TABLE(
  overall_percent INTEGER,
  current_phase VARCHAR,
  agents_total INTEGER,
  agents_active INTEGER,
  agents_idle INTEGER,
  agents_working INTEGER,
  tasks_total INTEGER,
  tasks_pending INTEGER,
  tasks_in_progress INTEGER,
  tasks_completed INTEGER,
  tasks_failed INTEGER,
  budget_used DECIMAL,
  budget_total DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  WITH agent_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE status != 'terminated') as total,
      COUNT(*) FILTER (WHERE status IN ('idle', 'working')) as active,
      COUNT(*) FILTER (WHERE status = 'idle') as idle,
      COUNT(*) FILTER (WHERE status = 'working') as working
    FROM agents
    WHERE project_id = p_project_id
  ),
  task_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed
    FROM tasks
    WHERE project_id = p_project_id
  ),
  budget_info AS (
    SELECT
      COALESCE(SUM(cost_used), 0) as used,
      COALESCE(MAX(budget_cost_usd), 100) as total
    FROM projects
    WHERE id = p_project_id
  )
  SELECT
    CASE
      WHEN tc.total = 0 THEN 0
      ELSE ((tc.completed::DECIMAL / tc.total) * 100)::INTEGER
    END as overall_percent,
    CASE
      WHEN tc.completed = tc.total AND tc.total > 0 THEN 'completed'
      WHEN tc.in_progress > 0 THEN 'in_progress'
      WHEN tc.pending > 0 THEN 'pending'
      ELSE 'not_started'
    END::VARCHAR as current_phase,
    ac.total::INTEGER,
    ac.active::INTEGER,
    ac.idle::INTEGER,
    ac.working::INTEGER,
    tc.total::INTEGER,
    tc.pending::INTEGER,
    tc.in_progress::INTEGER,
    tc.completed::INTEGER,
    tc.failed::INTEGER,
    bi.used,
    bi.total
  FROM agent_counts ac
  CROSS JOIN task_counts tc
  CROSS JOIN budget_info bi;
END;
$$ LANGUAGE plpgsql;
`;

async function main() {
  const db = getDatabase(dbConfig);

  try {
    await db.query(sql);
    console.log('✓ calculate_project_progress function updated successfully');
  } catch (err) {
    console.error('Error updating function:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  await db.close();
}

main();
