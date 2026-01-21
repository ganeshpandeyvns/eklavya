-- Demo₈: Self-Build Test
-- Migration: 008_demo8_self_build.sql
-- Description: Database schema for self-build test functionality

-- Self-build status enum
DO $$ BEGIN
  CREATE TYPE self_build_status AS ENUM (
    'pending',
    'planning',
    'executing',
    'completed',
    'failed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Self-build runs table
CREATE TABLE IF NOT EXISTS self_build_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Configuration
  config JSONB NOT NULL DEFAULT '{}',

  -- Execution plan
  execution_plan JSONB,

  -- Status
  status self_build_status NOT NULL DEFAULT 'pending',

  -- Results
  result JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Metrics
  total_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  total_agents INTEGER DEFAULT 0,
  execution_time_ms INTEGER,
  estimated_cost_usd NUMERIC(10, 2)
);

-- Indexes for self_build_runs
CREATE INDEX IF NOT EXISTS idx_self_build_project ON self_build_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_self_build_status ON self_build_runs(status);
CREATE INDEX IF NOT EXISTS idx_self_build_created ON self_build_runs(created_at DESC);

-- Self-build phases table (for tracking individual phase execution)
CREATE TABLE IF NOT EXISTS self_build_phases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES self_build_runs(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,

  -- Phase details
  parallelizable BOOLEAN DEFAULT false,
  estimated_duration_ms INTEGER,

  -- Status
  status VARCHAR(30) NOT NULL DEFAULT 'pending',

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  success BOOLEAN,
  error_message TEXT,

  UNIQUE(run_id, phase_number)
);

CREATE INDEX IF NOT EXISTS idx_self_build_phase_run ON self_build_phases(run_id);

-- Self-build tasks table (for tracking individual task execution)
CREATE TABLE IF NOT EXISTS self_build_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES self_build_runs(id) ON DELETE CASCADE,
  phase_id UUID REFERENCES self_build_phases(id) ON DELETE CASCADE,

  -- Task details
  title VARCHAR(255) NOT NULL,
  description TEXT,
  task_type VARCHAR(50) NOT NULL,
  agent_type VARCHAR(50) NOT NULL,
  priority INTEGER DEFAULT 0,
  dependencies UUID[] DEFAULT '{}',
  specification TEXT,
  estimated_duration_ms INTEGER,

  -- Execution
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  execution_time_ms INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_self_build_task_run ON self_build_tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_self_build_task_phase ON self_build_tasks(phase_id);
CREATE INDEX IF NOT EXISTS idx_self_build_task_status ON self_build_tasks(status);
CREATE INDEX IF NOT EXISTS idx_self_build_task_agent ON self_build_tasks(agent_id);

-- Function to start a self-build run
CREATE OR REPLACE FUNCTION start_self_build(
  p_project_id UUID,
  p_config JSONB
) RETURNS UUID AS $$
DECLARE
  v_run_id UUID;
BEGIN
  INSERT INTO self_build_runs (project_id, config, status)
  VALUES (p_project_id, p_config, 'pending')
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update self-build status
CREATE OR REPLACE FUNCTION update_self_build_status(
  p_run_id UUID,
  p_status self_build_status
) RETURNS BOOLEAN AS $$
DECLARE
  v_current_status self_build_status;
BEGIN
  SELECT status INTO v_current_status
  FROM self_build_runs
  WHERE id = p_run_id;

  IF v_current_status IS NULL THEN
    RETURN false;
  END IF;

  -- Validate status transitions
  IF v_current_status = 'completed' OR v_current_status = 'failed' OR v_current_status = 'cancelled' THEN
    -- Terminal states cannot transition
    RETURN false;
  END IF;

  UPDATE self_build_runs
  SET
    status = p_status,
    started_at = CASE WHEN p_status = 'planning' AND started_at IS NULL THEN NOW() ELSE started_at END,
    completed_at = CASE WHEN p_status IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE completed_at END
  WHERE id = p_run_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to set execution plan
CREATE OR REPLACE FUNCTION set_execution_plan(
  p_run_id UUID,
  p_plan JSONB
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE self_build_runs
  SET execution_plan = p_plan
  WHERE id = p_run_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to create a phase
CREATE OR REPLACE FUNCTION create_self_build_phase(
  p_run_id UUID,
  p_phase_number INTEGER,
  p_parallelizable BOOLEAN DEFAULT false,
  p_estimated_duration_ms INTEGER DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_phase_id UUID;
BEGIN
  INSERT INTO self_build_phases (run_id, phase_number, parallelizable, estimated_duration_ms)
  VALUES (p_run_id, p_phase_number, p_parallelizable, p_estimated_duration_ms)
  RETURNING id INTO v_phase_id;

  RETURN v_phase_id;
END;
$$ LANGUAGE plpgsql;

-- Function to create a task
CREATE OR REPLACE FUNCTION create_self_build_task(
  p_run_id UUID,
  p_phase_id UUID,
  p_title VARCHAR(255),
  p_description TEXT,
  p_task_type VARCHAR(50),
  p_agent_type VARCHAR(50),
  p_priority INTEGER DEFAULT 0,
  p_dependencies UUID[] DEFAULT '{}',
  p_specification TEXT DEFAULT NULL,
  p_estimated_duration_ms INTEGER DEFAULT NULL,
  p_task_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_task_id UUID;
BEGIN
  -- Use provided task_id or generate a new one
  v_task_id := COALESCE(p_task_id, uuid_generate_v4());

  INSERT INTO self_build_tasks (
    id, run_id, phase_id, title, description, task_type, agent_type,
    priority, dependencies, specification, estimated_duration_ms
  )
  VALUES (
    v_task_id, p_run_id, p_phase_id, p_title, p_description, p_task_type, p_agent_type,
    p_priority, p_dependencies, p_specification, p_estimated_duration_ms
  );

  -- Increment total tasks count
  UPDATE self_build_runs
  SET total_tasks = total_tasks + 1
  WHERE id = p_run_id;

  RETURN v_task_id;
END;
$$ LANGUAGE plpgsql;

-- Function to start a phase
CREATE OR REPLACE FUNCTION start_self_build_phase(
  p_phase_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE self_build_phases
  SET status = 'executing', started_at = NOW()
  WHERE id = p_phase_id AND status = 'pending';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to complete a phase
CREATE OR REPLACE FUNCTION complete_self_build_phase(
  p_phase_id UUID,
  p_success BOOLEAN,
  p_error_message TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE self_build_phases
  SET
    status = CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
    completed_at = NOW(),
    success = p_success,
    error_message = p_error_message
  WHERE id = p_phase_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to start a task
CREATE OR REPLACE FUNCTION start_self_build_task(
  p_task_id UUID,
  p_agent_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE self_build_tasks
  SET
    status = 'executing',
    started_at = NOW(),
    agent_id = p_agent_id
  WHERE id = p_task_id AND status = 'pending';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to complete a task
CREATE OR REPLACE FUNCTION complete_self_build_task(
  p_task_id UUID,
  p_success BOOLEAN,
  p_error_message TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_run_id UUID;
  v_started_at TIMESTAMPTZ;
BEGIN
  SELECT run_id, started_at INTO v_run_id, v_started_at
  FROM self_build_tasks
  WHERE id = p_task_id;

  IF v_run_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE self_build_tasks
  SET
    status = CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
    completed_at = NOW(),
    execution_time_ms = EXTRACT(EPOCH FROM (NOW() - v_started_at)) * 1000,
    error_message = p_error_message
  WHERE id = p_task_id;

  -- Update run counters
  IF p_success THEN
    UPDATE self_build_runs
    SET completed_tasks = completed_tasks + 1
    WHERE id = v_run_id;
  ELSE
    UPDATE self_build_runs
    SET failed_tasks = failed_tasks + 1
    WHERE id = v_run_id;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to finalize a self-build run
CREATE OR REPLACE FUNCTION finalize_self_build(
  p_run_id UUID,
  p_result JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_success BOOLEAN;
  v_failed_tasks INTEGER;
BEGIN
  SELECT started_at, failed_tasks INTO v_started_at, v_failed_tasks
  FROM self_build_runs
  WHERE id = p_run_id;

  IF v_started_at IS NULL THEN
    RETURN false;
  END IF;

  v_success := v_failed_tasks = 0;

  UPDATE self_build_runs
  SET
    status = CASE WHEN v_success THEN 'completed'::self_build_status ELSE 'failed'::self_build_status END,
    completed_at = NOW(),
    execution_time_ms = EXTRACT(EPOCH FROM (NOW() - v_started_at)) * 1000,
    result = p_result
  WHERE id = p_run_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to increment agent count
CREATE OR REPLACE FUNCTION increment_self_build_agents(
  p_run_id UUID
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE self_build_runs
  SET total_agents = total_agents + 1
  WHERE id = p_run_id
  RETURNING total_agents INTO v_count;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- View for self-build run summary
CREATE OR REPLACE VIEW self_build_summary AS
SELECT
  r.id AS run_id,
  r.project_id,
  p.name AS project_name,
  r.status,
  r.total_tasks,
  r.completed_tasks,
  r.failed_tasks,
  r.total_agents,
  r.execution_time_ms,
  r.estimated_cost_usd,
  r.created_at,
  r.started_at,
  r.completed_at,
  CASE
    WHEN r.total_tasks > 0 THEN
      ROUND((r.completed_tasks::NUMERIC / r.total_tasks) * 100, 1)
    ELSE 0
  END AS progress_percent
FROM self_build_runs r
JOIN projects p ON r.project_id = p.id;

-- View for phase progress
CREATE OR REPLACE VIEW self_build_phase_progress AS
SELECT
  ph.id AS phase_id,
  ph.run_id,
  ph.phase_number,
  ph.status,
  ph.parallelizable,
  ph.started_at,
  ph.completed_at,
  ph.success,
  COUNT(t.id) AS total_tasks,
  COUNT(t.id) FILTER (WHERE t.status = 'completed') AS completed_tasks,
  COUNT(t.id) FILTER (WHERE t.status = 'failed') AS failed_tasks,
  COUNT(t.id) FILTER (WHERE t.status = 'executing') AS executing_tasks
FROM self_build_phases ph
LEFT JOIN self_build_tasks t ON ph.id = t.phase_id
GROUP BY ph.id;

-- Function to get run details with phases
CREATE OR REPLACE FUNCTION get_self_build_details(
  p_run_id UUID
) RETURNS TABLE (
  run_id UUID,
  project_id UUID,
  config JSONB,
  execution_plan JSONB,
  status self_build_status,
  result JSONB,
  total_tasks INTEGER,
  completed_tasks INTEGER,
  failed_tasks INTEGER,
  total_agents INTEGER,
  execution_time_ms INTEGER,
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.project_id,
    r.config,
    r.execution_plan,
    r.status,
    r.result,
    r.total_tasks,
    r.completed_tasks,
    r.failed_tasks,
    r.total_agents,
    r.execution_time_ms,
    r.created_at,
    r.started_at,
    r.completed_at
  FROM self_build_runs r
  WHERE r.id = p_run_id;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE self_build_runs IS 'Self-build test runs tracking autonomous project builds';
COMMENT ON TABLE self_build_phases IS 'Execution phases within a self-build run';
COMMENT ON TABLE self_build_tasks IS 'Individual tasks within self-build phases';
COMMENT ON VIEW self_build_summary IS 'Summary view of self-build runs with progress';
COMMENT ON VIEW self_build_phase_progress IS 'Phase progress with task counts';
