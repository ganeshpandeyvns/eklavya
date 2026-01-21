-- Migration: 009_complete_agents.sql
-- Description: Database schema for QA, Mentor, and Monitor agents
-- Supports: End-to-end testing, knowledge base, health monitoring

-- ============================================================================
-- QA Agent Tables
-- ============================================================================

-- QA test runs - tracks complete E2E test sessions
CREATE TABLE IF NOT EXISTS qa_test_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Test configuration
    test_type VARCHAR(50) DEFAULT 'e2e',  -- 'e2e', 'visual', 'report'
    config JSONB DEFAULT '{}',
    milestone VARCHAR(100),

    -- Timing
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    duration INTEGER,  -- milliseconds

    -- Status and results
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'running', 'pass', 'fail', 'error'
    summary JSONB DEFAULT '{}',
    tests JSONB DEFAULT '[]',
    issues JSONB DEFAULT '[]',
    coverage JSONB DEFAULT '{}',

    -- Visual regression specific
    baseline_id UUID,
    visual_diffs JSONB DEFAULT '[]',

    -- Report specific
    issues_summary JSONB DEFAULT '{}',
    recommendations JSONB DEFAULT '[]',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_test_runs_project ON qa_test_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_qa_test_runs_status ON qa_test_runs(status);
CREATE INDEX IF NOT EXISTS idx_qa_test_runs_type ON qa_test_runs(test_type);
CREATE INDEX IF NOT EXISTS idx_qa_test_runs_created ON qa_test_runs(created_at DESC);

-- QA test results - individual test/issue results
CREATE TABLE IF NOT EXISTS qa_test_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    test_run_id UUID REFERENCES qa_test_runs(id) ON DELETE CASCADE,

    -- Issue identification
    flow_id VARCHAR(100),
    step_id VARCHAR(100),

    -- Issue details
    severity VARCHAR(20) NOT NULL,  -- 'critical', 'high', 'medium', 'low', 'info'
    type VARCHAR(50) NOT NULL,  -- 'functional', 'visual', 'accessibility', etc.
    title VARCHAR(500) NOT NULL,
    description TEXT,

    -- Context
    url VARCHAR(500),
    selector VARCHAR(500),
    expected TEXT,
    actual TEXT,

    -- Evidence
    screenshot VARCHAR(500),
    trace VARCHAR(500),
    browser VARCHAR(50),
    viewport JSONB,

    -- Status
    reproducible BOOLEAN DEFAULT true,
    resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_test_results_project ON qa_test_results(project_id);
CREATE INDEX IF NOT EXISTS idx_qa_test_results_run ON qa_test_results(test_run_id);
CREATE INDEX IF NOT EXISTS idx_qa_test_results_severity ON qa_test_results(severity);
CREATE INDEX IF NOT EXISTS idx_qa_test_results_type ON qa_test_results(type);
CREATE INDEX IF NOT EXISTS idx_qa_test_results_unresolved ON qa_test_results(project_id) WHERE resolved = false;

-- Visual baselines - stores baseline screenshots for visual regression
CREATE TABLE IF NOT EXISTS visual_baselines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Baseline details
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Pages in baseline
    pages JSONB NOT NULL DEFAULT '[]',  -- Array of {name, path, image}

    -- Status
    active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visual_baselines_project ON visual_baselines(project_id);
CREATE INDEX IF NOT EXISTS idx_visual_baselines_active ON visual_baselines(project_id) WHERE active = true;

-- ============================================================================
-- Mentor Agent Tables
-- ============================================================================

-- Mentor guidance - guidance provided to blocked agents
CREATE TABLE IF NOT EXISTS mentor_guidance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_id UUID NOT NULL,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,

    -- Guidance details
    type VARCHAR(50) NOT NULL,  -- 'code_example', 'explanation', 'workaround', etc.
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,

    -- Additional resources
    code_example TEXT,
    links JSONB DEFAULT '[]',
    steps JSONB DEFAULT '[]',
    alternatives JSONB DEFAULT '[]',
    warnings JSONB DEFAULT '[]',

    -- Quality metrics
    confidence DECIMAL(3,2),  -- 0-1

    -- Outcome tracking
    helpful BOOLEAN,
    resolved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_guidance_agent ON mentor_guidance(agent_id);
CREATE INDEX IF NOT EXISTS idx_mentor_guidance_issue ON mentor_guidance(issue_id);
CREATE INDEX IF NOT EXISTS idx_mentor_guidance_type ON mentor_guidance(type);
CREATE INDEX IF NOT EXISTS idx_mentor_guidance_helpful ON mentor_guidance(helpful) WHERE helpful IS NOT NULL;

-- Knowledge base - stores reusable knowledge for mentor agent
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,  -- NULL for global knowledge

    -- Classification
    category VARCHAR(100) NOT NULL,
    topic VARCHAR(100) NOT NULL,

    -- Content
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    code_examples JSONB DEFAULT '[]',  -- Array of {language, code, description}
    links JSONB DEFAULT '[]',  -- Array of {title, url}

    -- Metadata
    tags JSONB DEFAULT '[]',

    -- Usage and quality metrics
    usage_count INTEGER DEFAULT 0,
    helpfulness_score DECIMAL(3,2) DEFAULT 0.5,  -- 0-1

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_project ON knowledge_base(project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_topic ON knowledge_base(topic);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tags ON knowledge_base USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_helpfulness ON knowledge_base(helpfulness_score DESC);

-- Full text search on knowledge base
CREATE INDEX IF NOT EXISTS idx_knowledge_base_search ON knowledge_base
    USING GIN(to_tsvector('english', title || ' ' || content));

-- ============================================================================
-- Monitor Agent Tables
-- ============================================================================

-- Health checks - periodic health check results
CREATE TABLE IF NOT EXISTS health_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Health status
    health_level VARCHAR(20) NOT NULL,  -- 'healthy', 'degraded', 'unhealthy', 'critical'
    score INTEGER NOT NULL,  -- 0-100

    -- Summary data
    summary JSONB NOT NULL DEFAULT '{}',

    -- Detailed data
    agents_data JSONB DEFAULT '[]',
    resources_data JSONB DEFAULT '{}',
    alerts_data JSONB DEFAULT '[]',

    -- Recommendations
    recommendations JSONB DEFAULT '[]',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_checks_project ON health_checks(project_id);
CREATE INDEX IF NOT EXISTS idx_health_checks_level ON health_checks(health_level);
CREATE INDEX IF NOT EXISTS idx_health_checks_created ON health_checks(created_at DESC);

-- Alerts - system alerts and notifications
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,

    -- Alert classification
    level VARCHAR(20) NOT NULL,  -- 'critical', 'warning', 'info', 'debug'
    type VARCHAR(50) NOT NULL,  -- 'agent_stuck', 'budget_warning', etc.

    -- Alert content
    title VARCHAR(500) NOT NULL,
    message TEXT NOT NULL,
    context JSONB DEFAULT '{}',

    -- Status tracking
    status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'acknowledged', 'resolved', 'dismissed'
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMPTZ,
    resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_project ON alerts(project_id);
CREATE INDEX IF NOT EXISTS idx_alerts_agent ON alerts(agent_id);
CREATE INDEX IF NOT EXISTS idx_alerts_level ON alerts(level);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON alerts(project_id) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);

-- Resource metrics - historical resource usage data
CREATE TABLE IF NOT EXISTS resource_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Metrics data
    metrics JSONB NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resource_metrics_project ON resource_metrics(project_id);
CREATE INDEX IF NOT EXISTS idx_resource_metrics_created ON resource_metrics(created_at DESC);

-- Partition resource_metrics by time for efficient querying
-- (In production, consider using TimescaleDB or native partitioning)

-- ============================================================================
-- Views
-- ============================================================================

-- QA summary view
CREATE OR REPLACE VIEW qa_summary AS
SELECT
    qr.project_id,
    p.name as project_name,
    COUNT(*) as total_runs,
    COUNT(*) FILTER (WHERE qr.status = 'pass') as passed_runs,
    COUNT(*) FILTER (WHERE qr.status = 'fail') as failed_runs,
    AVG(qr.duration) as avg_duration_ms,
    (SELECT COUNT(*) FROM qa_test_results r WHERE r.project_id = qr.project_id AND r.resolved = false) as open_issues,
    MAX(qr.created_at) as last_run
FROM qa_test_runs qr
JOIN projects p ON qr.project_id = p.id
GROUP BY qr.project_id, p.name;

-- Mentor effectiveness view
CREATE OR REPLACE VIEW mentor_effectiveness AS
SELECT
    mg.type as guidance_type,
    COUNT(*) as total_guidance,
    COUNT(*) FILTER (WHERE mg.helpful = true) as helpful_count,
    COUNT(*) FILTER (WHERE mg.helpful = false) as not_helpful_count,
    CASE WHEN COUNT(*) FILTER (WHERE mg.helpful IS NOT NULL) > 0
        THEN ROUND(COUNT(*) FILTER (WHERE mg.helpful = true)::decimal /
                   COUNT(*) FILTER (WHERE mg.helpful IS NOT NULL) * 100, 2)
        ELSE 0
    END as helpfulness_rate,
    AVG(mg.confidence) as avg_confidence
FROM mentor_guidance mg
GROUP BY mg.type
ORDER BY helpfulness_rate DESC;

-- Alert summary view
CREATE OR REPLACE VIEW alert_summary AS
SELECT
    a.project_id,
    p.name as project_name,
    a.level,
    a.type,
    COUNT(*) as total_alerts,
    COUNT(*) FILTER (WHERE a.resolved = false) as unresolved,
    COUNT(*) FILTER (WHERE a.acknowledged = false AND a.resolved = false) as pending,
    AVG(EXTRACT(EPOCH FROM (COALESCE(a.resolved_at, NOW()) - a.created_at))) as avg_resolution_time_sec
FROM alerts a
JOIN projects p ON a.project_id = p.id
GROUP BY a.project_id, p.name, a.level, a.type
ORDER BY a.project_id, a.level;

-- Health trend view
CREATE OR REPLACE VIEW health_trend AS
SELECT
    hc.project_id,
    DATE_TRUNC('hour', hc.created_at) as hour,
    AVG(hc.score) as avg_score,
    MODE() WITHIN GROUP (ORDER BY hc.health_level) as predominant_level,
    COUNT(*) as check_count
FROM health_checks hc
WHERE hc.created_at > NOW() - INTERVAL '7 days'
GROUP BY hc.project_id, DATE_TRUNC('hour', hc.created_at)
ORDER BY hc.project_id, hour DESC;

-- ============================================================================
-- Functions
-- ============================================================================

-- Function to get recent alerts for a project
CREATE OR REPLACE FUNCTION get_recent_alerts(
    p_project_id UUID,
    p_limit INTEGER DEFAULT 20,
    p_include_resolved BOOLEAN DEFAULT false
) RETURNS SETOF alerts AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM alerts
    WHERE project_id = p_project_id
      AND (p_include_resolved OR resolved = false)
    ORDER BY
        CASE level
            WHEN 'critical' THEN 1
            WHEN 'warning' THEN 2
            WHEN 'info' THEN 3
            WHEN 'debug' THEN 4
        END,
        created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get health history for a project
CREATE OR REPLACE FUNCTION get_health_history(
    p_project_id UUID,
    p_hours INTEGER DEFAULT 24
) RETURNS TABLE (
    check_time TIMESTAMPTZ,
    health_level VARCHAR(20),
    score INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        hc.created_at,
        hc.health_level,
        hc.score
    FROM health_checks hc
    WHERE hc.project_id = p_project_id
      AND hc.created_at > NOW() - (p_hours || ' hours')::INTERVAL
    ORDER BY hc.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to search knowledge base
CREATE OR REPLACE FUNCTION search_knowledge_base(
    p_query TEXT,
    p_project_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 10
) RETURNS TABLE (
    id UUID,
    category VARCHAR(100),
    topic VARCHAR(100),
    title VARCHAR(500),
    content TEXT,
    relevance REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        kb.id,
        kb.category,
        kb.topic,
        kb.title,
        kb.content,
        ts_rank(to_tsvector('english', kb.title || ' ' || kb.content), plainto_tsquery('english', p_query)) as relevance
    FROM knowledge_base kb
    WHERE (p_project_id IS NULL OR kb.project_id IS NULL OR kb.project_id = p_project_id)
      AND to_tsvector('english', kb.title || ' ' || kb.content) @@ plainto_tsquery('english', p_query)
    ORDER BY relevance DESC, kb.helpfulness_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to update knowledge helpfulness
CREATE OR REPLACE FUNCTION update_knowledge_helpfulness(
    p_knowledge_id UUID,
    p_helpful BOOLEAN
) RETURNS VOID AS $$
DECLARE
    adjustment DECIMAL(3,2);
BEGIN
    adjustment := CASE WHEN p_helpful THEN 0.05 ELSE -0.02 END;

    UPDATE knowledge_base
    SET
        helpfulness_score = GREATEST(0, LEAST(1, helpfulness_score + adjustment)),
        usage_count = usage_count + 1,
        updated_at = NOW()
    WHERE id = p_knowledge_id;
END;
$$ LANGUAGE plpgsql;

-- Function to create alert
CREATE OR REPLACE FUNCTION create_alert(
    p_project_id UUID,
    p_level VARCHAR(20),
    p_type VARCHAR(50),
    p_title VARCHAR(500),
    p_message TEXT,
    p_agent_id UUID DEFAULT NULL,
    p_context JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    v_alert_id UUID;
BEGIN
    INSERT INTO alerts (project_id, agent_id, level, type, title, message, context)
    VALUES (p_project_id, p_agent_id, p_level, p_type, p_title, p_message, p_context)
    RETURNING id INTO v_alert_id;

    -- Notify for real-time updates
    PERFORM pg_notify('eklavya_alerts', json_build_object(
        'alert_id', v_alert_id,
        'project_id', p_project_id,
        'level', p_level,
        'type', p_type,
        'title', p_title
    )::text);

    RETURN v_alert_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Triggers
-- ============================================================================

-- Trigger to update knowledge_base updated_at
CREATE TRIGGER knowledge_base_updated_at BEFORE UPDATE ON knowledge_base
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger to update visual_baselines updated_at
CREATE TRIGGER visual_baselines_updated_at BEFORE UPDATE ON visual_baselines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Notify on alert creation
CREATE OR REPLACE FUNCTION notify_alert()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'eklavya_alerts',
        json_build_object(
            'alert_id', NEW.id,
            'project_id', NEW.project_id,
            'level', NEW.level,
            'type', NEW.type,
            'title', NEW.title
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alerts_notify AFTER INSERT ON alerts
    FOR EACH ROW EXECUTE FUNCTION notify_alert();

-- ============================================================================
-- Seed Data: Default Knowledge Base Entries
-- ============================================================================

INSERT INTO knowledge_base (category, topic, title, content, tags, helpfulness_score)
VALUES
    ('typescript', 'error-handling', 'TypeScript Error Handling Best Practices',
     'Always use try-catch blocks for async operations. Type narrow errors before accessing properties. Use custom error classes for domain-specific errors.',
     '["typescript", "error-handling", "best-practice"]', 0.8),

    ('nodejs', 'database', 'Database Connection Pooling',
     'Use connection pooling to efficiently manage database connections. Set appropriate pool sizes based on expected load. Always release connections back to the pool.',
     '["nodejs", "database", "postgresql", "performance"]', 0.7),

    ('testing', 'mocking', 'Mocking External Dependencies',
     'Mock external dependencies in unit tests to isolate the code under test. Use dependency injection to make code more testable.',
     '["testing", "jest", "mocking"]', 0.75),

    ('git', 'workflow', 'Git Commit Best Practices',
     'Make small, focused commits. Write meaningful commit messages that explain WHY, not just WHAT. Use conventional commit format.',
     '["git", "workflow", "best-practice"]', 0.8),

    ('security', 'authentication', 'Secure Authentication Patterns',
     'Never store passwords in plain text. Use bcrypt or argon2 for password hashing. Implement rate limiting. Use secure session management.',
     '["security", "authentication", "best-practice"]', 0.85),

    ('performance', 'caching', 'Caching Strategies',
     'Use caching to reduce database load and improve response times. Consider TTL-based caching for frequently accessed, rarely changed data.',
     '["performance", "caching", "optimization"]', 0.7)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE qa_test_runs IS 'E2E test run records for QA agent';
COMMENT ON TABLE qa_test_results IS 'Individual test results and issues found by QA agent';
COMMENT ON TABLE visual_baselines IS 'Visual regression testing baselines';
COMMENT ON TABLE mentor_guidance IS 'Guidance provided by mentor agent to blocked agents';
COMMENT ON TABLE knowledge_base IS 'Reusable knowledge entries for mentor agent';
COMMENT ON TABLE health_checks IS 'Periodic health check results from monitor agent';
COMMENT ON TABLE alerts IS 'System alerts and notifications';
COMMENT ON TABLE resource_metrics IS 'Historical resource usage metrics';

COMMENT ON VIEW qa_summary IS 'Summary of QA test runs per project';
COMMENT ON VIEW mentor_effectiveness IS 'Effectiveness metrics for mentor guidance types';
COMMENT ON VIEW alert_summary IS 'Summary of alerts by project, level, and type';
COMMENT ON VIEW health_trend IS 'Health score trend over time';

COMMENT ON FUNCTION get_recent_alerts IS 'Get recent alerts for a project, ordered by severity';
COMMENT ON FUNCTION get_health_history IS 'Get health check history for a project';
COMMENT ON FUNCTION search_knowledge_base IS 'Full-text search on knowledge base entries';
COMMENT ON FUNCTION update_knowledge_helpfulness IS 'Update helpfulness score based on feedback';
COMMENT ON FUNCTION create_alert IS 'Create a new alert and notify listeners';
