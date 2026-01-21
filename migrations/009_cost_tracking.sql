-- Migration: 009_cost_tracking.sql
-- Description: Cost tracking and budget management tables for production use

-- Cost events table - tracks individual API call costs
CREATE TABLE IF NOT EXISTS cost_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,

  -- Model and token tracking
  model VARCHAR(100) NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,

  -- Cost calculation
  cost_usd DECIMAL(10, 6) NOT NULL DEFAULT 0,

  -- Metadata
  request_type VARCHAR(50), -- 'completion', 'embedding', 'vision', etc.
  duration_ms INTEGER,
  cached BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for cost_events
CREATE INDEX IF NOT EXISTS idx_cost_events_project ON cost_events(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_events_agent ON cost_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_cost_events_created ON cost_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_events_model ON cost_events(model);
CREATE INDEX IF NOT EXISTS idx_cost_events_project_date ON cost_events(project_id, created_at);

-- Budget alerts table - tracks budget threshold alerts
CREATE TABLE IF NOT EXISTS budget_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Alert details
  threshold_percent INTEGER NOT NULL, -- 50, 75, 90, 100
  current_spend DECIMAL(10, 2) NOT NULL,
  budget_limit DECIMAL(10, 2) NOT NULL,

  -- Status
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by VARCHAR(100),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_alerts_project ON budget_alerts(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_alerts_unacked ON budget_alerts(project_id, acknowledged) WHERE NOT acknowledged;

-- Cost summary by day - materialized for performance
CREATE TABLE IF NOT EXISTS cost_daily_summary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,

  -- Aggregated metrics
  total_cost DECIMAL(10, 4) NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 0,

  -- Cost by model
  cost_by_model JSONB DEFAULT '{}',

  -- Cost by agent type
  cost_by_agent_type JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(project_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_cost_daily_project ON cost_daily_summary(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_daily_date ON cost_daily_summary(summary_date DESC);

-- Model pricing table - stores pricing per model
CREATE TABLE IF NOT EXISTS model_pricing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model VARCHAR(100) NOT NULL UNIQUE,

  -- Pricing per 1000 tokens (in USD)
  input_price_per_1k DECIMAL(10, 6) NOT NULL,
  output_price_per_1k DECIMAL(10, 6) NOT NULL,

  -- Optional cached pricing
  cached_input_price_per_1k DECIMAL(10, 6),
  cached_output_price_per_1k DECIMAL(10, 6),

  -- Metadata
  provider VARCHAR(50) NOT NULL DEFAULT 'anthropic',
  active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_pricing_model ON model_pricing(model);

-- Seed default model pricing (Anthropic Claude models as of 2024)
INSERT INTO model_pricing (model, provider, input_price_per_1k, output_price_per_1k, cached_input_price_per_1k, cached_output_price_per_1k)
VALUES
  ('claude-sonnet-4-20250514', 'anthropic', 0.003, 0.015, 0.0003, 0.015),
  ('claude-opus-4-5-20251101', 'anthropic', 0.015, 0.075, 0.0015, 0.075),
  ('claude-3-haiku-20240307', 'anthropic', 0.00025, 0.00125, 0.000025, 0.00125),
  ('claude-3-5-sonnet-20241022', 'anthropic', 0.003, 0.015, 0.0003, 0.015)
ON CONFLICT (model) DO NOTHING;

-- Function to calculate cost for an API call
CREATE OR REPLACE FUNCTION calculate_api_cost(
  p_model VARCHAR(100),
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_cached BOOLEAN DEFAULT FALSE
) RETURNS DECIMAL(10, 6) AS $$
DECLARE
  v_input_price DECIMAL(10, 6);
  v_output_price DECIMAL(10, 6);
  v_total_cost DECIMAL(10, 6);
BEGIN
  -- Get pricing for the model
  SELECT
    CASE WHEN p_cached AND cached_input_price_per_1k IS NOT NULL
         THEN cached_input_price_per_1k
         ELSE input_price_per_1k END,
    CASE WHEN p_cached AND cached_output_price_per_1k IS NOT NULL
         THEN cached_output_price_per_1k
         ELSE output_price_per_1k END
  INTO v_input_price, v_output_price
  FROM model_pricing
  WHERE model = p_model AND active = TRUE;

  -- Default to Claude Sonnet pricing if model not found
  IF v_input_price IS NULL THEN
    v_input_price := 0.003;
    v_output_price := 0.015;
  END IF;

  -- Calculate total cost
  v_total_cost := (p_input_tokens * v_input_price / 1000) +
                  (p_output_tokens * v_output_price / 1000);

  RETURN v_total_cost;
END;
$$ LANGUAGE plpgsql;

-- Function to record a cost event and update project totals
CREATE OR REPLACE FUNCTION record_cost_event(
  p_project_id UUID,
  p_agent_id UUID,
  p_task_id UUID,
  p_model VARCHAR(100),
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_request_type VARCHAR(50) DEFAULT 'completion',
  p_duration_ms INTEGER DEFAULT NULL,
  p_cached BOOLEAN DEFAULT FALSE
) RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
  v_cost DECIMAL(10, 6);
  v_new_total DECIMAL(10, 2);
  v_budget DECIMAL(10, 2);
  v_threshold INTEGER;
BEGIN
  -- Calculate cost
  v_cost := calculate_api_cost(p_model, p_input_tokens, p_output_tokens, p_cached);

  -- Insert cost event
  INSERT INTO cost_events (
    project_id, agent_id, task_id, model,
    input_tokens, output_tokens, cost_usd,
    request_type, duration_ms, cached
  )
  VALUES (
    p_project_id, p_agent_id, p_task_id, p_model,
    p_input_tokens, p_output_tokens, v_cost,
    p_request_type, p_duration_ms, p_cached
  )
  RETURNING id INTO v_event_id;

  -- Update project totals
  UPDATE projects
  SET
    cost_used = COALESCE(cost_used, 0) + v_cost,
    tokens_used = COALESCE(tokens_used, 0) + p_input_tokens + p_output_tokens,
    updated_at = NOW()
  WHERE id = p_project_id
  RETURNING cost_used, budget_cost_usd INTO v_new_total, v_budget;

  -- Check budget thresholds and create alerts
  IF v_budget > 0 THEN
    -- Check thresholds in order: 90%, 75%, 50%
    v_threshold := CASE
      WHEN v_new_total >= v_budget * 0.90 THEN 90
      WHEN v_new_total >= v_budget * 0.75 THEN 75
      WHEN v_new_total >= v_budget * 0.50 THEN 50
      ELSE NULL
    END;

    -- Create alert if threshold crossed and no existing unacked alert for this threshold
    IF v_threshold IS NOT NULL THEN
      INSERT INTO budget_alerts (project_id, threshold_percent, current_spend, budget_limit)
      SELECT p_project_id, v_threshold, v_new_total, v_budget
      WHERE NOT EXISTS (
        SELECT 1 FROM budget_alerts
        WHERE project_id = p_project_id
          AND threshold_percent = v_threshold
          AND NOT acknowledged
      );
    END IF;
  END IF;

  -- Update daily summary
  INSERT INTO cost_daily_summary (
    project_id, summary_date, total_cost, total_tokens,
    input_tokens, output_tokens, api_calls,
    cost_by_model, cost_by_agent_type
  )
  VALUES (
    p_project_id, CURRENT_DATE, v_cost, p_input_tokens + p_output_tokens,
    p_input_tokens, p_output_tokens, 1,
    jsonb_build_object(p_model, v_cost),
    '{}'
  )
  ON CONFLICT (project_id, summary_date)
  DO UPDATE SET
    total_cost = cost_daily_summary.total_cost + v_cost,
    total_tokens = cost_daily_summary.total_tokens + p_input_tokens + p_output_tokens,
    input_tokens = cost_daily_summary.input_tokens + p_input_tokens,
    output_tokens = cost_daily_summary.output_tokens + p_output_tokens,
    api_calls = cost_daily_summary.api_calls + 1,
    cost_by_model = cost_daily_summary.cost_by_model ||
      jsonb_build_object(p_model, COALESCE((cost_daily_summary.cost_by_model->>p_model)::DECIMAL, 0) + v_cost),
    updated_at = NOW();

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get project cost summary
CREATE OR REPLACE FUNCTION get_project_cost_summary(
  p_project_id UUID
) RETURNS TABLE (
  total_cost DECIMAL(10, 4),
  token_cost DECIMAL(10, 4),
  total_tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  api_calls BIGINT,
  budget_limit DECIMAL(10, 2),
  budget_remaining DECIMAL(10, 2),
  budget_percent DECIMAL(5, 2),
  cost_by_model JSONB,
  cost_by_day JSONB,
  cost_by_agent JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(p.cost_used, 0)::DECIMAL(10, 4) AS total_cost,
    COALESCE(p.cost_used, 0)::DECIMAL(10, 4) AS token_cost,
    COALESCE(p.tokens_used, 0)::INTEGER AS total_tokens,
    COALESCE(SUM(ce.input_tokens), 0)::INTEGER AS input_tokens,
    COALESCE(SUM(ce.output_tokens), 0)::INTEGER AS output_tokens,
    COUNT(ce.id) AS api_calls,
    COALESCE(p.budget_cost_usd, 100)::DECIMAL(10, 2) AS budget_limit,
    GREATEST(0, COALESCE(p.budget_cost_usd, 100) - COALESCE(p.cost_used, 0))::DECIMAL(10, 2) AS budget_remaining,
    CASE WHEN COALESCE(p.budget_cost_usd, 100) > 0
         THEN (COALESCE(p.cost_used, 0) / COALESCE(p.budget_cost_usd, 100) * 100)::DECIMAL(5, 2)
         ELSE 0::DECIMAL(5, 2)
    END AS budget_percent,
    COALESCE(
      (SELECT jsonb_object_agg(model, model_cost)
       FROM (SELECT model, SUM(cost_usd)::DECIMAL(10, 4) AS model_cost
             FROM cost_events WHERE project_id = p_project_id GROUP BY model) m),
      '{}'::JSONB
    ) AS cost_by_model,
    COALESCE(
      (SELECT jsonb_object_agg(day, day_cost)
       FROM (SELECT summary_date::TEXT AS day, total_cost AS day_cost
             FROM cost_daily_summary
             WHERE project_id = p_project_id
             ORDER BY summary_date DESC LIMIT 30) d),
      '{}'::JSONB
    ) AS cost_by_day,
    COALESCE(
      (SELECT jsonb_object_agg(agent_id::TEXT, agent_cost)
       FROM (SELECT agent_id, SUM(cost_usd)::DECIMAL(10, 4) AS agent_cost
             FROM cost_events WHERE project_id = p_project_id AND agent_id IS NOT NULL
             GROUP BY agent_id) a),
      '{}'::JSONB
    ) AS cost_by_agent
  FROM projects p
  LEFT JOIN cost_events ce ON ce.project_id = p.id
  WHERE p.id = p_project_id
  GROUP BY p.id, p.cost_used, p.tokens_used, p.budget_cost_usd;
END;
$$ LANGUAGE plpgsql;

-- Function to check and enforce budget
CREATE OR REPLACE FUNCTION check_budget_status(
  p_project_id UUID
) RETURNS TABLE (
  within_budget BOOLEAN,
  current_spend DECIMAL(10, 2),
  budget_limit DECIMAL(10, 2),
  percent_used DECIMAL(5, 2),
  remaining DECIMAL(10, 2),
  status VARCHAR(20)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (COALESCE(p.cost_used, 0) < COALESCE(p.budget_cost_usd, 100)) AS within_budget,
    COALESCE(p.cost_used, 0)::DECIMAL(10, 2) AS current_spend,
    COALESCE(p.budget_cost_usd, 100)::DECIMAL(10, 2) AS budget_limit,
    CASE WHEN COALESCE(p.budget_cost_usd, 100) > 0
         THEN (COALESCE(p.cost_used, 0) / COALESCE(p.budget_cost_usd, 100) * 100)::DECIMAL(5, 2)
         ELSE 0::DECIMAL(5, 2)
    END AS percent_used,
    GREATEST(0, COALESCE(p.budget_cost_usd, 100) - COALESCE(p.cost_used, 0))::DECIMAL(10, 2) AS remaining,
    CASE
      WHEN COALESCE(p.cost_used, 0) >= COALESCE(p.budget_cost_usd, 100) THEN 'exceeded'
      WHEN COALESCE(p.cost_used, 0) >= COALESCE(p.budget_cost_usd, 100) * 0.9 THEN 'critical'
      WHEN COALESCE(p.cost_used, 0) >= COALESCE(p.budget_cost_usd, 100) * 0.75 THEN 'warning'
      WHEN COALESCE(p.cost_used, 0) >= COALESCE(p.budget_cost_usd, 100) * 0.5 THEN 'caution'
      ELSE 'healthy'
    END AS status
  FROM projects p
  WHERE p.id = p_project_id;
END;
$$ LANGUAGE plpgsql;

-- View for cost overview across all projects
CREATE OR REPLACE VIEW cost_overview AS
SELECT
  p.id AS project_id,
  p.name AS project_name,
  COALESCE(p.cost_used, 0) AS total_cost,
  COALESCE(p.tokens_used, 0) AS total_tokens,
  COALESCE(p.budget_cost_usd, 100) AS budget_limit,
  CASE WHEN COALESCE(p.budget_cost_usd, 100) > 0
       THEN ROUND((COALESCE(p.cost_used, 0) / COALESCE(p.budget_cost_usd, 100) * 100)::NUMERIC, 1)
       ELSE 0
  END AS budget_percent,
  COALESCE((SELECT COUNT(*) FROM cost_events ce WHERE ce.project_id = p.id), 0) AS api_calls,
  COALESCE((SELECT SUM(cost_usd) FROM cost_events ce
            WHERE ce.project_id = p.id AND ce.created_at >= CURRENT_DATE), 0) AS today_cost,
  p.created_at,
  p.updated_at
FROM projects p
WHERE p.status != 'archived';

-- Comments
COMMENT ON TABLE cost_events IS 'Individual API call cost tracking events';
COMMENT ON TABLE budget_alerts IS 'Budget threshold alerts for projects';
COMMENT ON TABLE cost_daily_summary IS 'Aggregated daily cost summaries per project';
COMMENT ON TABLE model_pricing IS 'Pricing configuration for AI models';
COMMENT ON FUNCTION calculate_api_cost IS 'Calculate USD cost for an API call based on model pricing';
COMMENT ON FUNCTION record_cost_event IS 'Record an API call and update all related cost tracking';
COMMENT ON FUNCTION get_project_cost_summary IS 'Get comprehensive cost summary for a project';
COMMENT ON FUNCTION check_budget_status IS 'Check if project is within budget and get status';
