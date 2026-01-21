-- Demo₄: Agent Lifecycle Management
-- Migration for agent process tracking, resources, and health monitoring

-- Agent process tracking
CREATE TABLE IF NOT EXISTS agent_processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    pid INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE,
    stopped_at TIMESTAMP WITH TIME ZONE,
    exit_code INTEGER,
    error_message TEXT,
    working_directory TEXT,
    environment JSONB DEFAULT '{}',
    restart_count INTEGER DEFAULT 0,
    max_restarts INTEGER DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent resource usage (time series)
CREATE TABLE IF NOT EXISTS agent_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    cpu_percent DECIMAL(5,2),
    memory_mb DECIMAL(10,2),
    tokens_used INTEGER DEFAULT 0,
    api_calls INTEGER DEFAULT 0,
    files_modified INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent health checks
CREATE TABLE IF NOT EXISTS agent_health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'unknown',
    latency_ms INTEGER,
    last_activity TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add lifecycle columns to agents table if not present
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'last_health_check') THEN
        ALTER TABLE agents ADD COLUMN last_health_check TIMESTAMP WITH TIME ZONE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'health_status') THEN
        ALTER TABLE agents ADD COLUMN health_status VARCHAR(20) DEFAULT 'unknown';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'total_tokens_used') THEN
        ALTER TABLE agents ADD COLUMN total_tokens_used INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'total_tasks_completed') THEN
        ALTER TABLE agents ADD COLUMN total_tasks_completed INTEGER DEFAULT 0;
    END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_processes_agent ON agent_processes(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_processes_status ON agent_processes(status);
CREATE INDEX IF NOT EXISTS idx_agent_processes_pid ON agent_processes(pid) WHERE pid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_resources_agent ON agent_resources(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_resources_timestamp ON agent_resources(timestamp);
CREATE INDEX IF NOT EXISTS idx_agent_health_agent ON agent_health_checks(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_health_created ON agent_health_checks(created_at);

-- View: Current agent process status
CREATE OR REPLACE VIEW agent_process_status AS
SELECT
    a.id as agent_id,
    a.type as agent_type,
    a.status as agent_status,
    a.health_status,
    a.project_id,
    ap.id as process_id,
    ap.pid,
    ap.status as process_status,
    ap.started_at,
    ap.stopped_at,
    ap.exit_code,
    ap.restart_count,
    ap.working_directory,
    CASE
        WHEN ap.status = 'running' THEN
            EXTRACT(EPOCH FROM (NOW() - ap.started_at))::INTEGER
        ELSE NULL
    END as uptime_seconds
FROM agents a
LEFT JOIN agent_processes ap ON a.id = ap.agent_id
    AND ap.id = (
        SELECT id FROM agent_processes
        WHERE agent_id = a.id
        ORDER BY created_at DESC
        LIMIT 1
    );

-- View: Agent resource summary
CREATE OR REPLACE VIEW agent_resource_summary AS
SELECT
    agent_id,
    COUNT(*) as sample_count,
    AVG(cpu_percent)::DECIMAL(5,2) as avg_cpu,
    MAX(cpu_percent) as max_cpu,
    AVG(memory_mb)::DECIMAL(10,2) as avg_memory_mb,
    MAX(memory_mb) as max_memory_mb,
    SUM(tokens_used) as total_tokens,
    SUM(api_calls) as total_api_calls,
    SUM(files_modified) as total_files_modified,
    MIN(timestamp) as first_sample,
    MAX(timestamp) as last_sample
FROM agent_resources
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY agent_id;

-- View: Project resource usage
CREATE OR REPLACE VIEW project_resource_usage AS
SELECT
    a.project_id,
    COUNT(DISTINCT a.id) as agent_count,
    SUM(COALESCE(ars.total_tokens, 0)) as total_tokens,
    SUM(COALESCE(ars.total_api_calls, 0)) as total_api_calls,
    AVG(COALESCE(ars.avg_cpu, 0))::DECIMAL(5,2) as avg_cpu,
    SUM(COALESCE(ars.avg_memory_mb, 0))::DECIMAL(10,2) as total_memory_mb
FROM agents a
LEFT JOIN agent_resource_summary ars ON a.id = ars.agent_id
GROUP BY a.project_id;

-- Function: Spawn agent process
CREATE OR REPLACE FUNCTION spawn_agent_process(
    p_agent_id UUID,
    p_pid INTEGER DEFAULT NULL,
    p_working_directory TEXT DEFAULT NULL,
    p_environment JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    v_process_id UUID;
    v_agent_status VARCHAR(50);
BEGIN
    -- Check agent exists and is in valid state
    SELECT status INTO v_agent_status FROM agents WHERE id = p_agent_id;

    IF v_agent_status IS NULL THEN
        RAISE EXCEPTION 'Agent not found: %', p_agent_id;
    END IF;

    -- Terminate any existing running process
    UPDATE agent_processes
    SET status = 'terminated', stopped_at = NOW(), updated_at = NOW()
    WHERE agent_id = p_agent_id AND status IN ('pending', 'starting', 'running');

    -- Create new process record
    INSERT INTO agent_processes (agent_id, pid, status, started_at, working_directory, environment)
    VALUES (p_agent_id, p_pid, 'starting', NOW(), p_working_directory, p_environment)
    RETURNING id INTO v_process_id;

    -- Update agent status
    UPDATE agents SET status = 'working', updated_at = NOW() WHERE id = p_agent_id;

    RETURN v_process_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Update agent process status
CREATE OR REPLACE FUNCTION update_agent_process(
    p_process_id UUID,
    p_status VARCHAR(50),
    p_pid INTEGER DEFAULT NULL,
    p_exit_code INTEGER DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_agent_id UUID;
BEGIN
    -- Get agent ID
    SELECT agent_id INTO v_agent_id FROM agent_processes WHERE id = p_process_id;

    IF v_agent_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Update process
    UPDATE agent_processes
    SET
        status = p_status,
        pid = COALESCE(p_pid, pid),
        exit_code = COALESCE(p_exit_code, exit_code),
        error_message = COALESCE(p_error_message, error_message),
        stopped_at = CASE WHEN p_status IN ('stopped', 'terminated', 'crashed', 'failed') THEN NOW() ELSE stopped_at END,
        updated_at = NOW()
    WHERE id = p_process_id;

    -- Update agent status based on process status
    UPDATE agents
    SET
        status = CASE
            WHEN p_status = 'running' THEN 'working'
            WHEN p_status IN ('stopped', 'terminated') THEN 'idle'
            WHEN p_status = 'crashed' THEN 'error'
            WHEN p_status = 'failed' THEN 'error'
            ELSE status
        END,
        updated_at = NOW()
    WHERE id = v_agent_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: Record health check
CREATE OR REPLACE FUNCTION record_health_check(
    p_agent_id UUID,
    p_status VARCHAR(20),
    p_latency_ms INTEGER DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_health_id UUID;
BEGIN
    -- Insert health check
    INSERT INTO agent_health_checks (agent_id, status, latency_ms, last_activity, error_message)
    VALUES (p_agent_id, p_status, p_latency_ms, NOW(), p_error_message)
    RETURNING id INTO v_health_id;

    -- Update agent health status
    UPDATE agents
    SET
        health_status = p_status,
        last_health_check = NOW(),
        updated_at = NOW()
    WHERE id = p_agent_id;

    RETURN v_health_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Record resource usage
CREATE OR REPLACE FUNCTION record_resource_usage(
    p_agent_id UUID,
    p_cpu_percent DECIMAL DEFAULT 0,
    p_memory_mb DECIMAL DEFAULT 0,
    p_tokens_used INTEGER DEFAULT 0,
    p_api_calls INTEGER DEFAULT 0,
    p_files_modified INTEGER DEFAULT 0
)
RETURNS UUID AS $$
DECLARE
    v_resource_id UUID;
BEGIN
    INSERT INTO agent_resources (agent_id, cpu_percent, memory_mb, tokens_used, api_calls, files_modified)
    VALUES (p_agent_id, p_cpu_percent, p_memory_mb, p_tokens_used, p_api_calls, p_files_modified)
    RETURNING id INTO v_resource_id;

    -- Update agent totals
    UPDATE agents
    SET
        total_tokens_used = total_tokens_used + p_tokens_used,
        updated_at = NOW()
    WHERE id = p_agent_id;

    RETURN v_resource_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Terminate agent process
CREATE OR REPLACE FUNCTION terminate_agent_process(
    p_agent_id UUID,
    p_exit_code INTEGER DEFAULT 0,
    p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_process_id UUID;
BEGIN
    -- Get current running process
    SELECT id INTO v_process_id
    FROM agent_processes
    WHERE agent_id = p_agent_id AND status IN ('pending', 'starting', 'running')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_process_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Update process status
    UPDATE agent_processes
    SET
        status = 'stopped',
        stopped_at = NOW(),
        exit_code = p_exit_code,
        error_message = p_error_message,
        updated_at = NOW()
    WHERE id = v_process_id;

    -- Update agent status
    UPDATE agents SET status = 'idle', updated_at = NOW() WHERE id = p_agent_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: Increment restart count
CREATE OR REPLACE FUNCTION increment_restart_count(p_agent_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_new_count INTEGER;
    v_max_restarts INTEGER;
BEGIN
    UPDATE agent_processes
    SET restart_count = restart_count + 1, updated_at = NOW()
    WHERE agent_id = p_agent_id AND status IN ('crashed', 'failed')
    RETURNING restart_count, max_restarts INTO v_new_count, v_max_restarts;

    RETURN v_new_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-update timestamps
CREATE OR REPLACE FUNCTION update_agent_process_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_process_update_timestamp ON agent_processes;
CREATE TRIGGER agent_process_update_timestamp
    BEFORE UPDATE ON agent_processes
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_process_timestamp();

-- Grant notification for real-time updates
CREATE OR REPLACE FUNCTION notify_agent_process_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('agent_process_change', json_build_object(
        'operation', TG_OP,
        'agent_id', NEW.agent_id,
        'process_id', NEW.id,
        'status', NEW.status,
        'pid', NEW.pid
    )::TEXT);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_process_notify ON agent_processes;
CREATE TRIGGER agent_process_notify
    AFTER INSERT OR UPDATE ON agent_processes
    FOR EACH ROW
    EXECUTE FUNCTION notify_agent_process_change();
