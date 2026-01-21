-- Eklavya Database Schema
-- Demo₁: Agent Lifecycle Management

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE agent_type AS ENUM (
    'orchestrator', 'architect', 'developer', 'tester',
    'qa', 'pm', 'uat', 'sre', 'monitor', 'mentor'
);

CREATE TYPE agent_status AS ENUM (
    'initializing', 'idle', 'working', 'blocked', 'completed', 'failed', 'terminated'
);

CREATE TYPE task_status AS ENUM (
    'pending', 'assigned', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled'
);

CREATE TYPE message_type AS ENUM (
    'task_assign', 'task_complete', 'task_failed', 'task_blocked',
    'status_update', 'checkpoint', 'mentor_suggestion', 'broadcast'
);

CREATE TYPE prompt_status AS ENUM (
    'experimental', 'candidate', 'production', 'deprecated'
);

-- Projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    config JSONB DEFAULT '{}',
    budget_tokens INTEGER DEFAULT 1000000,
    budget_time_hours INTEGER DEFAULT 24,
    budget_cost_usd DECIMAL(10,2) DEFAULT 100.00,
    tokens_used INTEGER DEFAULT 0,
    cost_used DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agents table
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    type agent_type NOT NULL,
    status agent_status DEFAULT 'initializing',
    pid INTEGER,
    working_directory TEXT,
    current_task_id UUID,
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    checkpoint_data JSONB,
    metrics JSONB DEFAULT '{"tasks_completed": 0, "tasks_failed": 0, "tokens_used": 0}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tasks table
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    parent_task_id UUID REFERENCES tasks(id),
    assigned_agent_id UUID REFERENCES agents(id),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    type VARCHAR(100),
    status task_status DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    acceptance_criteria JSONB DEFAULT '[]',
    result JSONB,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages table (for agent communication)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    from_agent_id UUID REFERENCES agents(id),
    to_agent_id UUID REFERENCES agents(id),
    type message_type NOT NULL,
    channel VARCHAR(255),
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Prompts table (for RL-based prompt evolution)
CREATE TABLE prompts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_type agent_type NOT NULL,
    version INTEGER NOT NULL,
    status prompt_status DEFAULT 'experimental',
    content TEXT NOT NULL,
    variables JSONB DEFAULT '[]',
    -- Thompson Sampling parameters
    alpha DECIMAL(10,4) DEFAULT 1.0,  -- successes + 1
    beta DECIMAL(10,4) DEFAULT 1.0,   -- failures + 1
    total_uses INTEGER DEFAULT 0,
    successful_uses INTEGER DEFAULT 0,
    avg_task_completion_time DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(agent_type, version)
);

-- Checkpoints table
CREATE TABLE checkpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id),
    state JSONB NOT NULL,
    file_state JSONB,
    conversation_summary TEXT,
    recovery_instructions TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Learning events (for RL training)
CREATE TABLE learning_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id),
    prompt_id UUID REFERENCES prompts(id),
    task_id UUID REFERENCES tasks(id),
    event_type VARCHAR(100) NOT NULL,
    reward DECIMAL(5,4),  -- -1 to 1
    context JSONB,
    outcome JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_agents_project ON agents(project_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_agent_id);
CREATE INDEX idx_messages_project ON messages(project_id);
CREATE INDEX idx_messages_to_agent ON messages(to_agent_id, processed);
CREATE INDEX idx_messages_channel ON messages(channel);
CREATE INDEX idx_prompts_agent_type ON prompts(agent_type, status);
CREATE INDEX idx_checkpoints_agent ON checkpoints(agent_id);
CREATE INDEX idx_learning_events_prompt ON learning_events(prompt_id);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER prompts_updated_at BEFORE UPDATE ON prompts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Notify function for real-time updates
CREATE OR REPLACE FUNCTION notify_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'eklavya_changes',
        json_build_object(
            'table', TG_TABLE_NAME,
            'action', TG_OP,
            'id', COALESCE(NEW.id, OLD.id)
        )::text
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_notify AFTER INSERT OR UPDATE OR DELETE ON agents
    FOR EACH ROW EXECUTE FUNCTION notify_change();
CREATE TRIGGER tasks_notify AFTER INSERT OR UPDATE OR DELETE ON tasks
    FOR EACH ROW EXECUTE FUNCTION notify_change();
CREATE TRIGGER messages_notify AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION notify_change();
