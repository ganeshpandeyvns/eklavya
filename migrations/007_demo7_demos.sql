-- Migration: Demo₇ Demo System
-- Creates tables and functions for demo management, approval workflow, and client feedback

-- Demo type enum
DO $$ BEGIN
  CREATE TYPE demo_type AS ENUM ('wow', 'trust', 'milestone', 'final');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Demo status enum
DO $$ BEGIN
  CREATE TYPE demo_status AS ENUM ('draft', 'building', 'ready', 'approved', 'revision_requested', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Approval decision enum
DO $$ BEGIN
  CREATE TYPE approval_decision AS ENUM ('approve', 'request_changes', 'skip_to_build', 'reject');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Feedback sentiment enum
DO $$ BEGIN
  CREATE TYPE feedback_sentiment AS ENUM ('positive', 'neutral', 'negative');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Feedback category enum
DO $$ BEGIN
  CREATE TYPE feedback_category AS ENUM ('feature', 'design', 'performance', 'bug', 'general');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Demos table
CREATE TABLE IF NOT EXISTS demos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Demo info
  type demo_type NOT NULL DEFAULT 'milestone',
  version INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(200) NOT NULL,
  description TEXT,

  -- Status
  status demo_status NOT NULL DEFAULT 'draft',

  -- Preview
  preview_url VARCHAR(500),
  preview_port INTEGER,
  preview_pid INTEGER,

  -- Verification
  verified_at TIMESTAMPTZ,
  verification_result JSONB,

  -- Config
  config JSONB DEFAULT '{"features": [], "excludedFeatures": [], "scaffoldingPercent": 0, "estimatedTime": 0, "estimatedCost": 0}',
  scaffolding JSONB DEFAULT '{"totalFiles": 0, "reusableFiles": 0, "reusablePercent": 0, "components": [], "routes": [], "styles": []}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  built_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,

  UNIQUE(project_id, version)
);

-- Approval requests table
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  demo_id UUID NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Request
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  requested_by VARCHAR(100) DEFAULT 'system',

  -- Decision
  decision approval_decision,
  decided_at TIMESTAMPTZ,
  decided_by VARCHAR(100),

  -- Feedback
  comments TEXT,
  change_requests JSONB DEFAULT '[]',

  -- Next steps
  next_action VARCHAR(50)
);

-- Client feedback table
CREATE TABLE IF NOT EXISTS client_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  demo_id UUID NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Feedback
  sentiment feedback_sentiment NOT NULL DEFAULT 'neutral',
  category feedback_category NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,

  -- Context
  page_url VARCHAR(500),
  element_id VARCHAR(100),
  screenshot VARCHAR(500),

  -- Processing
  processed_at TIMESTAMPTZ,
  action_taken TEXT,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Demo verifications table
CREATE TABLE IF NOT EXISTS demo_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  demo_id UUID NOT NULL REFERENCES demos(id) ON DELETE CASCADE,

  -- Result
  passed BOOLEAN NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,

  -- Details
  checks JSONB DEFAULT '[]',
  passed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,

  -- Artifacts
  screenshots JSONB DEFAULT '[]',
  console_errors JSONB DEFAULT '[]',

  summary TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_demos_project ON demos(project_id);
CREATE INDEX IF NOT EXISTS idx_demos_status ON demos(status);
CREATE INDEX IF NOT EXISTS idx_demos_type ON demos(type);
CREATE INDEX IF NOT EXISTS idx_demos_created ON demos(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_demo ON approval_requests(demo_id);
CREATE INDEX IF NOT EXISTS idx_approval_project ON approval_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_approval_pending ON approval_requests(decision) WHERE decision IS NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_demo ON client_feedback(demo_id);
CREATE INDEX IF NOT EXISTS idx_feedback_project ON client_feedback(project_id);
CREATE INDEX IF NOT EXISTS idx_feedback_unresolved ON client_feedback(resolved_at) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verification_demo ON demo_verifications(demo_id);

-- Function: Create demo
CREATE OR REPLACE FUNCTION create_demo(
  p_project_id UUID,
  p_type demo_type,
  p_name VARCHAR,
  p_description TEXT DEFAULT NULL,
  p_config JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_demo_id UUID;
  v_version INTEGER;
BEGIN
  -- Get next version number for this project
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
  FROM demos WHERE project_id = p_project_id;

  INSERT INTO demos (
    project_id, type, version, name, description, config
  )
  VALUES (
    p_project_id, p_type, v_version, p_name, p_description, p_config
  )
  RETURNING id INTO v_demo_id;

  RETURN v_demo_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Update demo status with validation
CREATE OR REPLACE FUNCTION update_demo_status(
  p_demo_id UUID,
  p_new_status demo_status
)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_status demo_status;
  v_valid_transition BOOLEAN := false;
BEGIN
  SELECT status INTO v_current_status FROM demos WHERE id = p_demo_id;

  IF v_current_status IS NULL THEN
    RETURN false;
  END IF;

  -- Validate status transitions
  v_valid_transition := CASE v_current_status
    WHEN 'draft' THEN p_new_status IN ('building', 'archived')
    WHEN 'building' THEN p_new_status IN ('ready', 'draft')
    WHEN 'ready' THEN p_new_status IN ('approved', 'revision_requested', 'archived')
    WHEN 'revision_requested' THEN p_new_status IN ('building', 'archived')
    WHEN 'approved' THEN p_new_status = 'archived'
    WHEN 'archived' THEN false
    ELSE false
  END;

  IF NOT v_valid_transition THEN
    RETURN false;
  END IF;

  UPDATE demos SET
    status = p_new_status,
    built_at = CASE WHEN p_new_status = 'building' THEN NOW() ELSE built_at END,
    ready_at = CASE WHEN p_new_status = 'ready' THEN NOW() ELSE ready_at END,
    approved_at = CASE WHEN p_new_status = 'approved' THEN NOW() ELSE approved_at END,
    archived_at = CASE WHEN p_new_status = 'archived' THEN NOW() ELSE archived_at END
  WHERE id = p_demo_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function: Request approval
CREATE OR REPLACE FUNCTION request_demo_approval(
  p_demo_id UUID,
  p_requested_by VARCHAR DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
  v_request_id UUID;
  v_project_id UUID;
  v_status demo_status;
BEGIN
  SELECT project_id, status INTO v_project_id, v_status
  FROM demos WHERE id = p_demo_id;

  IF v_status != 'ready' THEN
    RAISE EXCEPTION 'Demo must be in ready status to request approval';
  END IF;

  INSERT INTO approval_requests (
    demo_id, project_id, requested_by
  )
  VALUES (
    p_demo_id, v_project_id, p_requested_by
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Process approval decision
CREATE OR REPLACE FUNCTION process_approval_decision(
  p_request_id UUID,
  p_decision approval_decision,
  p_decided_by VARCHAR,
  p_comments TEXT DEFAULT NULL,
  p_change_requests JSONB DEFAULT '[]'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_demo_id UUID;
  v_new_status demo_status;
  v_next_action VARCHAR;
BEGIN
  SELECT demo_id INTO v_demo_id FROM approval_requests WHERE id = p_request_id;

  IF v_demo_id IS NULL THEN
    RETURN false;
  END IF;

  -- Determine new status and next action
  CASE p_decision
    WHEN 'approve' THEN
      v_new_status := 'approved';
      v_next_action := 'proceed_to_build';
    WHEN 'request_changes' THEN
      v_new_status := 'revision_requested';
      v_next_action := 'revise_demo';
    WHEN 'skip_to_build' THEN
      v_new_status := 'approved';
      v_next_action := 'proceed_to_build';
    WHEN 'reject' THEN
      v_new_status := 'archived';
      v_next_action := 'cancel';
  END CASE;

  -- Update approval request
  UPDATE approval_requests SET
    decision = p_decision,
    decided_at = NOW(),
    decided_by = p_decided_by,
    comments = p_comments,
    change_requests = p_change_requests,
    next_action = v_next_action
  WHERE id = p_request_id;

  -- Update demo status
  PERFORM update_demo_status(v_demo_id, v_new_status);

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function: Add client feedback
CREATE OR REPLACE FUNCTION add_client_feedback(
  p_demo_id UUID,
  p_sentiment feedback_sentiment,
  p_category feedback_category,
  p_content TEXT,
  p_page_url VARCHAR DEFAULT NULL,
  p_element_id VARCHAR DEFAULT NULL,
  p_screenshot VARCHAR DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_feedback_id UUID;
  v_project_id UUID;
BEGIN
  SELECT project_id INTO v_project_id FROM demos WHERE id = p_demo_id;

  INSERT INTO client_feedback (
    demo_id, project_id, sentiment, category, content,
    page_url, element_id, screenshot
  )
  VALUES (
    p_demo_id, v_project_id, p_sentiment, p_category, p_content,
    p_page_url, p_element_id, p_screenshot
  )
  RETURNING id INTO v_feedback_id;

  RETURN v_feedback_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Record verification result
CREATE OR REPLACE FUNCTION record_demo_verification(
  p_demo_id UUID,
  p_passed BOOLEAN,
  p_started_at TIMESTAMPTZ,
  p_completed_at TIMESTAMPTZ,
  p_checks JSONB,
  p_screenshots JSONB DEFAULT '[]',
  p_console_errors JSONB DEFAULT '[]',
  p_summary TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_verification_id UUID;
  v_passed_count INTEGER;
  v_failed_count INTEGER;
BEGIN
  -- Count passed/failed checks
  SELECT
    COUNT(*) FILTER (WHERE (check_item->>'status') = 'passed'),
    COUNT(*) FILTER (WHERE (check_item->>'status') = 'failed')
  INTO v_passed_count, v_failed_count
  FROM jsonb_array_elements(p_checks) AS check_item;

  INSERT INTO demo_verifications (
    demo_id, passed, started_at, completed_at,
    checks, passed_count, failed_count,
    screenshots, console_errors, summary
  )
  VALUES (
    p_demo_id, p_passed, p_started_at, p_completed_at,
    p_checks, v_passed_count, v_failed_count,
    p_screenshots, p_console_errors, p_summary
  )
  RETURNING id INTO v_verification_id;

  -- Update demo verification status
  UPDATE demos SET
    verified_at = p_completed_at,
    verification_result = jsonb_build_object(
      'passed', p_passed,
      'passedCount', v_passed_count,
      'failedCount', v_failed_count,
      'summary', p_summary
    )
  WHERE id = p_demo_id;

  RETURN v_verification_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Get pending approvals
CREATE OR REPLACE FUNCTION get_pending_approvals()
RETURNS TABLE(
  request_id UUID,
  demo_id UUID,
  project_id UUID,
  demo_name VARCHAR,
  demo_type demo_type,
  requested_at TIMESTAMPTZ,
  requested_by VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ar.id as request_id,
    ar.demo_id,
    ar.project_id,
    d.name as demo_name,
    d.type as demo_type,
    ar.requested_at,
    ar.requested_by
  FROM approval_requests ar
  JOIN demos d ON ar.demo_id = d.id
  WHERE ar.decision IS NULL
  ORDER BY ar.requested_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Function: Get project scaffolding summary
CREATE OR REPLACE FUNCTION get_project_scaffolding(p_project_id UUID)
RETURNS TABLE(
  total_demos INTEGER,
  total_files INTEGER,
  reusable_files INTEGER,
  overall_reuse_percent NUMERIC,
  all_components JSONB,
  all_routes JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as total_demos,
    SUM((scaffolding->>'totalFiles')::INTEGER)::INTEGER as total_files,
    SUM((scaffolding->>'reusableFiles')::INTEGER)::INTEGER as reusable_files,
    CASE
      WHEN SUM((scaffolding->>'totalFiles')::INTEGER) > 0
      THEN ROUND(
        (SUM((scaffolding->>'reusableFiles')::INTEGER)::NUMERIC /
         SUM((scaffolding->>'totalFiles')::INTEGER)::NUMERIC) * 100, 1
      )
      ELSE 0
    END as overall_reuse_percent,
    jsonb_agg(DISTINCT component) as all_components,
    jsonb_agg(DISTINCT route) as all_routes
  FROM demos d,
    jsonb_array_elements_text(d.scaffolding->'components') AS component,
    jsonb_array_elements_text(d.scaffolding->'routes') AS route
  WHERE d.project_id = p_project_id
  AND d.status != 'archived';
END;
$$ LANGUAGE plpgsql;

-- Function: Get demo statistics
CREATE OR REPLACE FUNCTION get_demo_stats(p_project_id UUID DEFAULT NULL)
RETURNS TABLE(
  total_demos INTEGER,
  draft_count INTEGER,
  building_count INTEGER,
  ready_count INTEGER,
  approved_count INTEGER,
  revision_requested_count INTEGER,
  archived_count INTEGER,
  avg_approval_time_hours NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as total_demos,
    COUNT(*) FILTER (WHERE status = 'draft')::INTEGER as draft_count,
    COUNT(*) FILTER (WHERE status = 'building')::INTEGER as building_count,
    COUNT(*) FILTER (WHERE status = 'ready')::INTEGER as ready_count,
    COUNT(*) FILTER (WHERE status = 'approved')::INTEGER as approved_count,
    COUNT(*) FILTER (WHERE status = 'revision_requested')::INTEGER as revision_requested_count,
    COUNT(*) FILTER (WHERE status = 'archived')::INTEGER as archived_count,
    ROUND(AVG(
      EXTRACT(EPOCH FROM (approved_at - ready_at)) / 3600
    )::NUMERIC, 1) as avg_approval_time_hours
  FROM demos
  WHERE (p_project_id IS NULL OR project_id = p_project_id);
END;
$$ LANGUAGE plpgsql;

-- View: Demo summary with latest approval
CREATE OR REPLACE VIEW demo_summary AS
SELECT
  d.id,
  d.project_id,
  p.name as project_name,
  d.type,
  d.version,
  d.name,
  d.status,
  d.preview_url,
  d.verified_at,
  d.verification_result,
  d.config,
  d.scaffolding,
  d.created_at,
  d.ready_at,
  d.approved_at,
  ar.id as latest_approval_id,
  ar.decision as latest_decision,
  ar.decided_at as latest_decided_at,
  ar.comments as latest_comments
FROM demos d
LEFT JOIN projects p ON d.project_id = p.id
LEFT JOIN LATERAL (
  SELECT * FROM approval_requests
  WHERE demo_id = d.id
  ORDER BY requested_at DESC
  LIMIT 1
) ar ON true
ORDER BY d.created_at DESC;

-- View: Feedback summary
CREATE OR REPLACE VIEW feedback_summary AS
SELECT
  demo_id,
  COUNT(*) as total_feedback,
  COUNT(*) FILTER (WHERE sentiment = 'positive') as positive_count,
  COUNT(*) FILTER (WHERE sentiment = 'neutral') as neutral_count,
  COUNT(*) FILTER (WHERE sentiment = 'negative') as negative_count,
  COUNT(*) FILTER (WHERE resolved_at IS NULL) as unresolved_count,
  MAX(created_at) as latest_feedback_at
FROM client_feedback
GROUP BY demo_id;
