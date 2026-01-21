-- Eklavya Demo₃: Autonomous Task Execution Schema
-- Enhancements for task queue, execution tracking, and checkpoint recovery

-- Add specification field to tasks for detailed task requirements
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS specification JSONB DEFAULT '{}';

-- Add assigned_at timestamp to track when task was assigned
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE;

-- Add execution context for tracking agent execution state
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS execution_context JSONB DEFAULT '{}';

-- Add estimated_duration for task scheduling
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER;

-- Add task dependencies for proper ordering
CREATE TABLE IF NOT EXISTS task_dependencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(task_id, depends_on_task_id)
);

-- Add index for dependency lookups
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);

-- Enhanced checkpoints with more state tracking
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS checkpoint_type VARCHAR(50) DEFAULT 'auto';
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS is_valid BOOLEAN DEFAULT true;
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS restored_count INTEGER DEFAULT 0;
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS last_restored_at TIMESTAMP WITH TIME ZONE;

-- Create execution logs for detailed tracking
CREATE TABLE IF NOT EXISTS execution_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    log_level VARCHAR(20) NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient log queries
CREATE INDEX IF NOT EXISTS idx_execution_logs_project ON execution_logs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_logs_agent ON execution_logs(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_logs_task ON execution_logs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_logs_level ON execution_logs(log_level);

-- Orchestrator state tracking
CREATE TABLE IF NOT EXISTS orchestrator_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'stopped',
    current_plan JSONB,
    active_agents JSONB DEFAULT '[]',
    pending_tasks INTEGER DEFAULT 0,
    running_tasks INTEGER DEFAULT 0,
    completed_tasks INTEGER DEFAULT 0,
    failed_tasks INTEGER DEFAULT 0,
    last_health_check TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    stopped_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger for orchestrator state updates
CREATE TRIGGER orchestrator_state_updated_at BEFORE UPDATE ON orchestrator_state
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Notify on orchestrator state changes
CREATE TRIGGER orchestrator_state_notify AFTER INSERT OR UPDATE ON orchestrator_state
    FOR EACH ROW EXECUTE FUNCTION notify_change();

-- Agent work queue for task distribution
CREATE TABLE IF NOT EXISTS agent_work_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 5,
    queued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processing_started_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'queued',
    UNIQUE(agent_id, task_id)
);

-- Index for work queue operations
CREATE INDEX IF NOT EXISTS idx_work_queue_agent ON agent_work_queue(agent_id, priority DESC, queued_at);
CREATE INDEX IF NOT EXISTS idx_work_queue_status ON agent_work_queue(status);

-- Task execution metrics for performance tracking
CREATE TABLE IF NOT EXISTS task_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    execution_time_ms INTEGER,
    tokens_used INTEGER DEFAULT 0,
    api_calls INTEGER DEFAULT 0,
    files_read INTEGER DEFAULT 0,
    files_written INTEGER DEFAULT 0,
    lines_of_code INTEGER DEFAULT 0,
    tests_written INTEGER DEFAULT 0,
    tests_passed INTEGER DEFAULT 0,
    first_attempt_success BOOLEAN,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- View for task queue status
CREATE OR REPLACE VIEW task_queue_status AS
SELECT
    t.project_id,
    t.status,
    COUNT(*) as task_count,
    AVG(EXTRACT(EPOCH FROM (NOW() - t.created_at))) as avg_age_seconds,
    MAX(t.priority) as max_priority,
    MIN(t.created_at) as oldest_task
FROM tasks t
WHERE t.status IN ('pending', 'assigned', 'in_progress', 'blocked')
GROUP BY t.project_id, t.status;

-- View for agent workload
CREATE OR REPLACE VIEW agent_workload AS
SELECT
    a.id as agent_id,
    a.type,
    a.status,
    a.project_id,
    COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'in_progress') as active_tasks,
    COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'completed') as completed_today,
    COUNT(DISTINCT wq.id) as queued_tasks,
    MAX(a.last_heartbeat) as last_heartbeat,
    COALESCE(SUM(tm.execution_time_ms), 0) as total_execution_time_ms
FROM agents a
LEFT JOIN tasks t ON t.assigned_agent_id = a.id
LEFT JOIN agent_work_queue wq ON wq.agent_id = a.id AND wq.status = 'queued'
LEFT JOIN task_metrics tm ON tm.agent_id = a.id AND tm.created_at > NOW() - INTERVAL '24 hours'
GROUP BY a.id, a.type, a.status, a.project_id;

-- View for checkpoint recovery stats
CREATE OR REPLACE VIEW checkpoint_stats AS
SELECT
    c.agent_id,
    a.type as agent_type,
    c.project_id,
    COUNT(*) as total_checkpoints,
    COUNT(*) FILTER (WHERE c.is_valid) as valid_checkpoints,
    SUM(c.restored_count) as total_restores,
    MAX(c.created_at) as latest_checkpoint,
    MAX(c.last_restored_at) as last_restore
FROM checkpoints c
JOIN agents a ON a.id = c.agent_id
GROUP BY c.agent_id, a.type, c.project_id;

-- Function to get next task for an agent type
CREATE OR REPLACE FUNCTION get_next_task(p_project_id UUID, p_agent_type agent_type)
RETURNS UUID AS $$
DECLARE
    next_task_id UUID;
BEGIN
    -- Find highest priority pending task that matches agent type
    SELECT t.id INTO next_task_id
    FROM tasks t
    WHERE t.project_id = p_project_id
      AND t.status = 'pending'
      AND (t.type IS NULL OR t.type = p_agent_type::text || '_task')
      AND NOT EXISTS (
          -- Check no unmet dependencies
          SELECT 1 FROM task_dependencies td
          JOIN tasks dt ON dt.id = td.depends_on_task_id
          WHERE td.task_id = t.id AND dt.status != 'completed'
      )
    ORDER BY t.priority DESC, t.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    RETURN next_task_id;
END;
$$ LANGUAGE plpgsql;

-- Function to mark task as started
CREATE OR REPLACE FUNCTION start_task(p_task_id UUID, p_agent_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE tasks
    SET status = 'in_progress',
        assigned_agent_id = p_agent_id,
        assigned_at = NOW(),
        started_at = NOW(),
        updated_at = NOW()
    WHERE id = p_task_id AND status IN ('pending', 'assigned');

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to complete task with metrics
CREATE OR REPLACE FUNCTION complete_task(
    p_task_id UUID,
    p_result JSONB DEFAULT '{}',
    p_metrics JSONB DEFAULT '{}'
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE tasks
    SET status = 'completed',
        result = p_result,
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_task_id AND status = 'in_progress';

    IF FOUND THEN
        -- Insert metrics if provided
        INSERT INTO task_metrics (
            task_id,
            agent_id,
            execution_time_ms,
            tokens_used,
            api_calls,
            files_read,
            files_written,
            first_attempt_success
        )
        SELECT
            p_task_id,
            t.assigned_agent_id,
            COALESCE((p_metrics->>'execution_time_ms')::INTEGER,
                     EXTRACT(EPOCH FROM (NOW() - t.started_at)) * 1000),
            COALESCE((p_metrics->>'tokens_used')::INTEGER, 0),
            COALESCE((p_metrics->>'api_calls')::INTEGER, 0),
            COALESCE((p_metrics->>'files_read')::INTEGER, 0),
            COALESCE((p_metrics->>'files_written')::INTEGER, 0),
            t.retry_count = 0
        FROM tasks t
        WHERE t.id = p_task_id
        ON CONFLICT (task_id) DO UPDATE SET
            execution_time_ms = EXCLUDED.execution_time_ms,
            tokens_used = EXCLUDED.tokens_used;
    END IF;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to fail task with retry logic
CREATE OR REPLACE FUNCTION fail_task(
    p_task_id UUID,
    p_error_message TEXT,
    p_should_retry BOOLEAN DEFAULT true
)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
    v_retry_count INTEGER;
    v_max_retries INTEGER;
BEGIN
    SELECT retry_count, max_retries INTO v_retry_count, v_max_retries
    FROM tasks WHERE id = p_task_id;

    IF p_should_retry AND v_retry_count < v_max_retries THEN
        -- Retry the task
        UPDATE tasks
        SET status = 'pending',
            error_message = p_error_message,
            retry_count = retry_count + 1,
            assigned_agent_id = NULL,
            assigned_at = NULL,
            started_at = NULL,
            updated_at = NOW()
        WHERE id = p_task_id;

        v_result := jsonb_build_object(
            'status', 'retrying',
            'retry_count', v_retry_count + 1,
            'max_retries', v_max_retries
        );
    ELSE
        -- Mark as failed
        UPDATE tasks
        SET status = 'failed',
            error_message = p_error_message,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = p_task_id;

        v_result := jsonb_build_object(
            'status', 'failed',
            'retry_count', v_retry_count,
            'max_retries', v_max_retries
        );
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;
