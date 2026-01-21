-- Workflow Engine Migration
-- Adds tables for architect outputs and workflow state tracking

-- Architect outputs table (stores generated architectures and task breakdowns)
CREATE TABLE IF NOT EXISTS architect_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
    architecture JSONB NOT NULL,
    task_breakdown JSONB NOT NULL DEFAULT '[]',
    estimated_effort JSONB DEFAULT '{}',
    risks JSONB DEFAULT '[]',
    review_result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Workflow state history (tracks phase transitions)
CREATE TABLE IF NOT EXISTS workflow_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    phase VARCHAR(50) NOT NULL,
    previous_phase VARCHAR(50),
    demo_phase VARCHAR(50),
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add prompt_id column to agents if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'prompt_id'
    ) THEN
        ALTER TABLE agents ADD COLUMN prompt_id UUID REFERENCES prompts(id);
    END IF;
END $$;

-- Add tasks_completed and tasks_failed columns to agents if not exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'tasks_completed'
    ) THEN
        ALTER TABLE agents ADD COLUMN tasks_completed INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'tasks_failed'
    ) THEN
        ALTER TABLE agents ADD COLUMN tasks_failed INTEGER DEFAULT 0;
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_architect_outputs_project ON architect_outputs(project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_project ON workflow_history(project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_phase ON workflow_history(phase);
CREATE INDEX IF NOT EXISTS idx_workflow_history_created ON workflow_history(created_at);
CREATE INDEX IF NOT EXISTS idx_agents_prompt ON agents(prompt_id);

-- Trigger for architect_outputs updated_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'architect_outputs_updated_at'
    ) THEN
        CREATE TRIGGER architect_outputs_updated_at BEFORE UPDATE ON architect_outputs
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

-- Trigger for workflow history notifications
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'workflow_history_notify'
    ) THEN
        CREATE TRIGGER workflow_history_notify AFTER INSERT ON workflow_history
            FOR EACH ROW EXECUTE FUNCTION notify_change();
    END IF;
END $$;

-- Function to record workflow state change
CREATE OR REPLACE FUNCTION record_workflow_state_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only record if status actually changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO workflow_history (project_id, phase, previous_phase)
        VALUES (NEW.id, NEW.status, OLD.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-record project status changes
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'projects_workflow_state_trigger'
    ) THEN
        CREATE TRIGGER projects_workflow_state_trigger
            AFTER UPDATE ON projects
            FOR EACH ROW EXECUTE FUNCTION record_workflow_state_change();
    END IF;
END $$;
