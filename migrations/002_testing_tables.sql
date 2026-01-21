-- Eklavya Testing & RL Feedback Schema
-- Demo₁: Bug Tracking and Test Results for RL-based Agent Learning

-- Bug severity enum
CREATE TYPE bug_severity AS ENUM ('critical', 'high', 'medium', 'low', 'info');

-- Bugs table - tracks bugs found by tester agents
CREATE TABLE bugs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    tester_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    developer_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    developer_prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL,
    severity bug_severity NOT NULL DEFAULT 'medium',
    type VARCHAR(100) NOT NULL,  -- e.g., 'console_error', 'api_failure', 'ui_broken'
    title VARCHAR(500) NOT NULL,
    description TEXT,
    file VARCHAR(500),
    line INTEGER,
    stack_trace TEXT,
    screenshot VARCHAR(500),
    reproducible BOOLEAN DEFAULT true,
    fixed BOOLEAN DEFAULT false,
    fixed_by UUID REFERENCES agents(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fixed_at TIMESTAMP WITH TIME ZONE
);

-- Test results table - individual test outcomes
CREATE TABLE test_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    tester_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    suite_id UUID,  -- Will reference test_suites
    test_type VARCHAR(50) NOT NULL,  -- 'unit', 'integration', 'e2e', 'api', 'visual'
    test_name VARCHAR(500) NOT NULL,
    status VARCHAR(20) NOT NULL,  -- 'pass', 'fail', 'skip', 'error'
    duration INTEGER NOT NULL DEFAULT 0,  -- milliseconds
    error TEXT,
    bug_id UUID REFERENCES bugs(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Test suites table - collection of related tests
CREATE TABLE test_suites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    passed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,  -- milliseconds
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add foreign key for test_results -> test_suites
ALTER TABLE test_results ADD CONSTRAINT fk_test_results_suite
    FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE;

-- Add prompt_id to agents table to track which prompt version they're using
ALTER TABLE agents ADD COLUMN IF NOT EXISTS prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL;

-- RL Outcomes table - tracks all reward signals for prompt learning
CREATE TABLE rl_outcomes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    outcome VARCHAR(50) NOT NULL,  -- 'success', 'failure', 'partial'
    reward DECIMAL(5,3) NOT NULL,  -- -1.0 to 1.0
    context JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_bugs_project ON bugs(project_id);
CREATE INDEX idx_bugs_developer ON bugs(developer_id);
CREATE INDEX idx_bugs_severity ON bugs(severity) WHERE fixed = false;
CREATE INDEX idx_bugs_unfixed ON bugs(project_id) WHERE fixed = false;

CREATE INDEX idx_test_results_project ON test_results(project_id);
CREATE INDEX idx_test_results_suite ON test_results(suite_id);
CREATE INDEX idx_test_results_status ON test_results(status);

CREATE INDEX idx_test_suites_project ON test_suites(project_id);

CREATE INDEX idx_rl_outcomes_prompt ON rl_outcomes(prompt_id);
CREATE INDEX idx_rl_outcomes_project ON rl_outcomes(project_id);
CREATE INDEX idx_rl_outcomes_created ON rl_outcomes(created_at);

-- Trigger to update prompt statistics when outcomes are recorded
CREATE OR REPLACE FUNCTION update_prompt_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Update alpha (successes) or beta (failures) based on outcome
    IF NEW.reward >= 0 THEN
        UPDATE prompts
        SET alpha = alpha + NEW.reward,
            successful_uses = successful_uses + 1,
            total_uses = total_uses + 1,
            updated_at = NOW()
        WHERE id = NEW.prompt_id;
    ELSE
        UPDATE prompts
        SET beta = beta + ABS(NEW.reward),
            total_uses = total_uses + 1,
            updated_at = NOW()
        WHERE id = NEW.prompt_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_prompt_stats
    AFTER INSERT ON rl_outcomes
    FOR EACH ROW
    EXECUTE FUNCTION update_prompt_stats();

-- View for prompt performance metrics
CREATE VIEW prompt_performance AS
SELECT
    p.id,
    p.agent_type,
    p.version,
    p.status,
    p.alpha,
    p.beta,
    p.total_uses,
    p.successful_uses,
    CASE WHEN p.total_uses > 0
        THEN ROUND(p.successful_uses::decimal / p.total_uses * 100, 2)
        ELSE 0
    END as success_rate,
    ROUND(p.alpha / (p.alpha + p.beta), 4) as thompson_score,
    (SELECT COUNT(*) FROM bugs b
     WHERE b.developer_prompt_id = p.id AND b.fixed = false) as open_bugs,
    (SELECT COUNT(*) FROM bugs b
     WHERE b.developer_prompt_id = p.id) as total_bugs,
    (SELECT AVG(reward) FROM rl_outcomes r
     WHERE r.prompt_id = p.id) as avg_reward
FROM prompts p;

-- View for developer accountability
CREATE VIEW developer_accountability AS
SELECT
    a.id as agent_id,
    a.type as agent_type,
    p.id as prompt_id,
    p.version as prompt_version,
    COUNT(DISTINCT b.id) as bugs_created,
    COUNT(DISTINCT CASE WHEN b.severity = 'critical' THEN b.id END) as critical_bugs,
    COUNT(DISTINCT CASE WHEN b.fixed THEN b.id END) as bugs_fixed,
    COUNT(DISTINCT t.id) as tasks_completed,
    AVG(r.reward) as avg_reward
FROM agents a
LEFT JOIN prompts p ON a.prompt_id = p.id
LEFT JOIN bugs b ON b.developer_id = a.id
LEFT JOIN tasks t ON t.assigned_agent_id = a.id AND t.status = 'completed'
LEFT JOIN rl_outcomes r ON r.agent_id = a.id
GROUP BY a.id, a.type, p.id, p.version;
