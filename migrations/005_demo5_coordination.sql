-- Migration: Demo₅ Multi-Agent Coordination
-- Creates tables and functions for coordinating multiple agents

-- Coordination configuration table
CREATE TABLE IF NOT EXISTS agent_coordination (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  coordinator_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  max_concurrent_agents INTEGER DEFAULT 10,
  current_agent_count INTEGER DEFAULT 0,
  coordination_strategy VARCHAR(50) DEFAULT 'round_robin',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id)
);

-- File locks table for conflict prevention
CREATE TABLE IF NOT EXISTS file_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  file_path VARCHAR(500) NOT NULL,
  lock_type VARCHAR(20) DEFAULT 'exclusive',
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '5 minutes',
  UNIQUE(project_id, file_path)
);

-- Conflicts table for tracking file conflicts
CREATE TABLE IF NOT EXISTS file_conflicts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_path VARCHAR(500) NOT NULL,
  agent_a_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_b_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conflict_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  resolution VARCHAR(50),
  resolved_by UUID REFERENCES agents(id),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Agent workload tracking (renamed to avoid conflict with view)
CREATE TABLE IF NOT EXISTS agent_workload_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  active_tasks INTEGER DEFAULT 0,
  pending_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  avg_task_duration_ms INTEGER DEFAULT 0,
  last_task_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id)
);

-- Coordination messages history
CREATE TABLE IF NOT EXISTS coordination_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message_type VARCHAR(50) NOT NULL,
  from_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for coordination queries
CREATE INDEX IF NOT EXISTS idx_coordination_project ON agent_coordination(project_id);
CREATE INDEX IF NOT EXISTS idx_file_locks_project ON file_locks(project_id);
CREATE INDEX IF NOT EXISTS idx_file_locks_expires ON file_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_file_conflicts_status ON file_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_agent_workload_agent ON agent_workload_tracking(agent_id);
CREATE INDEX IF NOT EXISTS idx_coord_messages_project ON coordination_messages(project_id);

-- View: Agent workload summary
CREATE OR REPLACE VIEW agent_workload_summary AS
SELECT
  a.id as agent_id,
  a.project_id,
  a.type as agent_type,
  a.status as agent_status,
  COALESCE(w.active_tasks, 0) as active_tasks,
  COALESCE(w.pending_tasks, 0) as pending_tasks,
  COALESCE(w.completed_tasks, 0) as completed_tasks,
  COALESCE(w.avg_task_duration_ms, 0) as avg_task_duration_ms,
  w.last_task_at,
  (SELECT COUNT(*) FROM file_locks fl WHERE fl.agent_id = a.id AND fl.expires_at > NOW()) as active_locks
FROM agents a
LEFT JOIN agent_workload_tracking w ON a.id = w.agent_id
WHERE a.status != 'terminated';

-- View: Project coordination status
CREATE OR REPLACE VIEW project_coordination_status AS
SELECT
  p.id as project_id,
  p.name as project_name,
  COALESCE(c.max_concurrent_agents, 10) as max_agents,
  (SELECT COUNT(*) FROM agents a WHERE a.project_id = p.id AND a.status IN ('working', 'idle')) as active_agents,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'pending') as pending_tasks,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'in_progress') as active_tasks,
  (SELECT COUNT(*) FROM file_locks fl WHERE fl.project_id = p.id AND fl.expires_at > NOW()) as active_locks,
  (SELECT COUNT(*) FROM file_conflicts fc WHERE fc.project_id = p.id AND fc.status = 'pending') as pending_conflicts
FROM projects p
LEFT JOIN agent_coordination c ON p.id = c.project_id;

-- Function: Acquire file lock
CREATE OR REPLACE FUNCTION acquire_file_lock(
  p_project_id UUID,
  p_agent_id UUID,
  p_file_path VARCHAR,
  p_duration_minutes INTEGER DEFAULT 5
)
RETURNS TABLE(success BOOLEAN, lock_id UUID, message TEXT) AS $$
DECLARE
  v_lock_id UUID;
  v_existing_lock RECORD;
BEGIN
  -- Clean up expired locks first
  DELETE FROM file_locks WHERE expires_at < NOW();

  -- Check for existing lock
  SELECT * INTO v_existing_lock
  FROM file_locks
  WHERE project_id = p_project_id AND file_path = p_file_path;

  IF v_existing_lock.id IS NOT NULL THEN
    IF v_existing_lock.agent_id = p_agent_id THEN
      -- Extend existing lock
      UPDATE file_locks
      SET expires_at = NOW() + (p_duration_minutes || ' minutes')::INTERVAL
      WHERE id = v_existing_lock.id;

      RETURN QUERY SELECT TRUE, v_existing_lock.id, 'Lock extended'::TEXT;
    ELSE
      -- Lock held by another agent
      RETURN QUERY SELECT FALSE, NULL::UUID,
        ('File locked by agent ' || v_existing_lock.agent_id)::TEXT;
    END IF;
  ELSE
    -- Create new lock
    INSERT INTO file_locks (project_id, agent_id, file_path, expires_at)
    VALUES (p_project_id, p_agent_id, p_file_path,
            NOW() + (p_duration_minutes || ' minutes')::INTERVAL)
    RETURNING id INTO v_lock_id;

    RETURN QUERY SELECT TRUE, v_lock_id, 'Lock acquired'::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function: Release file lock
CREATE OR REPLACE FUNCTION release_file_lock(
  p_lock_id UUID,
  p_agent_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM file_locks
  WHERE id = p_lock_id AND agent_id = p_agent_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function: Check coordination limits
CREATE OR REPLACE FUNCTION check_agent_limit(
  p_project_id UUID
)
RETURNS TABLE(can_spawn BOOLEAN, current_count INTEGER, max_count INTEGER) AS $$
DECLARE
  v_current INTEGER;
  v_max INTEGER;
BEGIN
  -- Get current active agents
  SELECT COUNT(*) INTO v_current
  FROM agents
  WHERE project_id = p_project_id
  AND status IN ('working', 'idle', 'initializing');

  -- Get max limit
  SELECT COALESCE(max_concurrent_agents, 10) INTO v_max
  FROM agent_coordination
  WHERE project_id = p_project_id;

  IF v_max IS NULL THEN
    v_max := 10; -- Default
  END IF;

  RETURN QUERY SELECT v_current < v_max, v_current, v_max;
END;
$$ LANGUAGE plpgsql;

-- Function: Route task to best agent
CREATE OR REPLACE FUNCTION route_task_to_agent(
  p_task_id UUID,
  p_preferred_type VARCHAR DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_project_id UUID;
  v_task_type VARCHAR;
  v_agent_id UUID;
BEGIN
  -- Get task info
  SELECT project_id, type INTO v_project_id, v_task_type
  FROM tasks WHERE id = p_task_id;

  IF v_project_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Find best available agent
  -- Priority: matching type > idle > least workload
  SELECT a.id INTO v_agent_id
  FROM agents a
  LEFT JOIN agent_workload_tracking w ON a.id = w.agent_id
  WHERE a.project_id = v_project_id
  AND a.status IN ('idle', 'working')
  AND (p_preferred_type IS NULL OR a.type = p_preferred_type::agent_type)
  ORDER BY
    CASE WHEN a.status = 'idle' THEN 0 ELSE 1 END,
    COALESCE(w.active_tasks, 0) ASC
  LIMIT 1;

  RETURN v_agent_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Update agent workload
CREATE OR REPLACE FUNCTION update_agent_workload(
  p_agent_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_project_id UUID;
  v_active INTEGER;
  v_pending INTEGER;
  v_completed INTEGER;
  v_avg_duration INTEGER;
BEGIN
  SELECT project_id INTO v_project_id FROM agents WHERE id = p_agent_id;

  -- Count tasks
  SELECT
    COUNT(*) FILTER (WHERE status = 'in_progress'),
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::INTEGER, 0)
  INTO v_active, v_pending, v_completed, v_avg_duration
  FROM tasks
  WHERE assigned_agent_id = p_agent_id;

  -- Upsert workload record
  INSERT INTO agent_workload_tracking (agent_id, project_id, active_tasks, pending_tasks,
                              completed_tasks, avg_task_duration_ms, last_task_at, updated_at)
  VALUES (p_agent_id, v_project_id, v_active, v_pending, v_completed, v_avg_duration, NOW(), NOW())
  ON CONFLICT (agent_id) DO UPDATE SET
    active_tasks = EXCLUDED.active_tasks,
    pending_tasks = EXCLUDED.pending_tasks,
    completed_tasks = EXCLUDED.completed_tasks,
    avg_task_duration_ms = EXCLUDED.avg_task_duration_ms,
    last_task_at = EXCLUDED.last_task_at,
    updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;

-- Function: Record coordination message
CREATE OR REPLACE FUNCTION record_coordination_message(
  p_project_id UUID,
  p_message_type VARCHAR,
  p_from_agent_id UUID,
  p_to_agent_id UUID,
  p_payload JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_message_id UUID;
BEGIN
  INSERT INTO coordination_messages (project_id, message_type, from_agent_id, to_agent_id, payload)
  VALUES (p_project_id, p_message_type, p_from_agent_id, p_to_agent_id, p_payload)
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update workload on task status change
CREATE OR REPLACE FUNCTION trigger_update_workload()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL THEN
    PERFORM update_agent_workload(NEW.assigned_agent_id);
  END IF;

  IF OLD.assigned_agent_id IS NOT NULL AND OLD.assigned_agent_id != NEW.assigned_agent_id THEN
    PERFORM update_agent_workload(OLD.assigned_agent_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_workload_update ON tasks;
CREATE TRIGGER task_workload_update
  AFTER INSERT OR UPDATE OF status, assigned_agent_id ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_workload();
