-- Migration: 010_experiments.sql
-- Description: A/B testing experiments for prompt evolution

-- Experiment status enum
DO $$ BEGIN
  CREATE TYPE experiment_status AS ENUM (
    'running',
    'completed',
    'stopped',
    'inconclusive'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Experiments table for A/B testing prompts
CREATE TABLE IF NOT EXISTS experiments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Agent type this experiment is for
  agent_type VARCHAR(50) NOT NULL,

  -- Control and treatment prompts
  control_prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  treatment_prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,

  -- Traffic split (0.0 to 1.0 - portion going to treatment)
  traffic_split DECIMAL(3, 2) NOT NULL DEFAULT 0.5,

  -- Sample size requirements
  min_sample_size INTEGER NOT NULL DEFAULT 100,
  max_duration_days INTEGER,

  -- Success metric to compare
  success_metric VARCHAR(50) NOT NULL DEFAULT 'success_rate',

  -- Status
  status experiment_status NOT NULL DEFAULT 'running',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Constraints
  CHECK (traffic_split >= 0 AND traffic_split <= 1),
  CHECK (control_prompt_id != treatment_prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_experiments_agent_type ON experiments(agent_type);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiments_control ON experiments(control_prompt_id);
CREATE INDEX IF NOT EXISTS idx_experiments_treatment ON experiments(treatment_prompt_id);

-- Experiment outcomes table for tracking which prompt was used
CREATE TABLE IF NOT EXISTS experiment_outcomes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  outcome_id UUID NOT NULL REFERENCES rl_outcomes(id) ON DELETE CASCADE,
  variant VARCHAR(20) NOT NULL, -- 'control' or 'treatment'
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(experiment_id, outcome_id)
);

CREATE INDEX IF NOT EXISTS idx_exp_outcomes_experiment ON experiment_outcomes(experiment_id);

-- Function to select prompt based on experiment
CREATE OR REPLACE FUNCTION select_experiment_prompt(
  p_experiment_id UUID
) RETURNS UUID AS $$
DECLARE
  v_experiment experiments;
  v_random DECIMAL;
BEGIN
  SELECT * INTO v_experiment
  FROM experiments
  WHERE id = p_experiment_id AND status = 'running';

  IF v_experiment IS NULL THEN
    RETURN NULL;
  END IF;

  v_random := random();

  IF v_random <= v_experiment.traffic_split THEN
    RETURN v_experiment.treatment_prompt_id;
  ELSE
    RETURN v_experiment.control_prompt_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to record experiment outcome
CREATE OR REPLACE FUNCTION record_experiment_outcome(
  p_experiment_id UUID,
  p_outcome_id UUID,
  p_variant VARCHAR(20)
) RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO experiment_outcomes (experiment_id, outcome_id, variant)
  VALUES (p_experiment_id, p_outcome_id, p_variant)
  ON CONFLICT (experiment_id, outcome_id) DO NOTHING;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- View for experiment summary
CREATE OR REPLACE VIEW experiment_summary AS
SELECT
  e.id,
  e.name,
  e.agent_type,
  e.status,
  e.traffic_split,
  e.min_sample_size,
  e.created_at,
  e.completed_at,
  pc.version as control_version,
  pt.version as treatment_version,
  COUNT(eo.id) FILTER (WHERE eo.variant = 'control') as control_samples,
  COUNT(eo.id) FILTER (WHERE eo.variant = 'treatment') as treatment_samples,
  AVG(ro.reward) FILTER (WHERE eo.variant = 'control') as control_avg_reward,
  AVG(ro.reward) FILTER (WHERE eo.variant = 'treatment') as treatment_avg_reward
FROM experiments e
LEFT JOIN prompts pc ON e.control_prompt_id = pc.id
LEFT JOIN prompts pt ON e.treatment_prompt_id = pt.id
LEFT JOIN experiment_outcomes eo ON e.id = eo.experiment_id
LEFT JOIN rl_outcomes ro ON eo.outcome_id = ro.id
GROUP BY e.id, pc.version, pt.version;

-- Comments
COMMENT ON TABLE experiments IS 'A/B testing experiments for prompt evolution';
COMMENT ON TABLE experiment_outcomes IS 'Tracking which experiment variant was used for each outcome';
COMMENT ON FUNCTION select_experiment_prompt IS 'Select prompt based on experiment traffic split';
COMMENT ON FUNCTION record_experiment_outcome IS 'Record which variant was used for an outcome';
