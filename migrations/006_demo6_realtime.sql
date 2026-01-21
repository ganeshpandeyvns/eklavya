-- Migration: Demo₆ Real-Time Portal
-- Creates tables and functions for notifications, activity streaming, and progress tracking

-- Notification level enum
DO $$ BEGIN
  CREATE TYPE notification_level AS ENUM ('critical', 'warning', 'info', 'silent');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Availability mode enum
DO $$ BEGIN
  CREATE TYPE availability_mode AS ENUM ('active', 'busy', 'away', 'dnd');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Activity event type enum
DO $$ BEGIN
  CREATE TYPE activity_event_type AS ENUM (
    'agent_status',
    'task_progress',
    'file_change',
    'build_event',
    'test_result',
    'checkpoint',
    'error',
    'milestone'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID, -- For future multi-user support

  -- Notification content
  level notification_level NOT NULL DEFAULT 'info',
  event_type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT,

  -- Context
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,

  -- Delivery tracking
  channels_sent TEXT[] DEFAULT '{}',
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity stream table
CREATE TABLE IF NOT EXISTS activity_stream (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Event source
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  agent_type VARCHAR(50),

  -- Event details
  event_type activity_event_type NOT NULL DEFAULT 'agent_status',
  action VARCHAR(100) NOT NULL,
  details TEXT,

  -- Context
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  file_path VARCHAR(500),

  -- Notification level
  notification_level notification_level DEFAULT 'silent',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification settings table
CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID, -- For future multi-user

  -- Availability
  availability_mode availability_mode DEFAULT 'active',

  -- Channel preferences
  email_enabled BOOLEAN DEFAULT true,
  push_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT false,

  -- Quiet hours
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  quiet_hours_mode availability_mode DEFAULT 'away',

  -- Level overrides (per-level channel config)
  level_overrides JSONB DEFAULT '{}',

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id)
);

-- Project progress snapshots (for historical tracking)
CREATE TABLE IF NOT EXISTS project_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Progress metrics
  overall_percent INTEGER DEFAULT 0,
  current_phase VARCHAR(100),

  -- Agent counts
  agents_total INTEGER DEFAULT 0,
  agents_active INTEGER DEFAULT 0,
  agents_idle INTEGER DEFAULT 0,
  agents_working INTEGER DEFAULT 0,

  -- Task counts
  tasks_total INTEGER DEFAULT 0,
  tasks_pending INTEGER DEFAULT 0,
  tasks_in_progress INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  tasks_failed INTEGER DEFAULT 0,

  -- Budget tracking
  budget_used DECIMAL(10, 2) DEFAULT 0,
  budget_total DECIMAL(10, 2) DEFAULT 100,

  -- Time tracking
  elapsed_ms BIGINT DEFAULT 0,
  estimated_remaining_ms BIGINT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_notifications_project ON notifications(project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_level ON notifications(level);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_stream(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_stream(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_stream(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_stream(agent_id);

CREATE INDEX IF NOT EXISTS idx_progress_project ON project_progress(project_id);
CREATE INDEX IF NOT EXISTS idx_progress_created ON project_progress(created_at DESC);

-- Function: Create notification
CREATE OR REPLACE FUNCTION create_notification(
  p_project_id UUID,
  p_level notification_level,
  p_event_type VARCHAR,
  p_title VARCHAR,
  p_message TEXT DEFAULT NULL,
  p_agent_id UUID DEFAULT NULL,
  p_task_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO notifications (
    project_id, level, event_type, title, message,
    agent_id, task_id, metadata
  )
  VALUES (
    p_project_id, p_level, p_event_type, p_title, p_message,
    p_agent_id, p_task_id, p_metadata
  )
  RETURNING id INTO v_notification_id;

  -- Notify via PostgreSQL NOTIFY for real-time delivery
  PERFORM pg_notify('notification_events', json_build_object(
    'id', v_notification_id,
    'projectId', p_project_id,
    'level', p_level,
    'eventType', p_event_type,
    'title', p_title,
    'message', p_message
  )::text);

  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Log activity event
CREATE OR REPLACE FUNCTION log_activity(
  p_project_id UUID,
  p_event_type activity_event_type,
  p_action VARCHAR,
  p_details TEXT DEFAULT NULL,
  p_agent_id UUID DEFAULT NULL,
  p_agent_type VARCHAR DEFAULT NULL,
  p_task_id UUID DEFAULT NULL,
  p_file_path VARCHAR DEFAULT NULL,
  p_notification_level notification_level DEFAULT 'silent'
)
RETURNS UUID AS $$
DECLARE
  v_activity_id UUID;
BEGIN
  INSERT INTO activity_stream (
    project_id, event_type, action, details,
    agent_id, agent_type, task_id, file_path, notification_level
  )
  VALUES (
    p_project_id, p_event_type, p_action, p_details,
    p_agent_id, p_agent_type, p_task_id, p_file_path, p_notification_level
  )
  RETURNING id INTO v_activity_id;

  -- Notify via PostgreSQL NOTIFY
  PERFORM pg_notify('activity_events', json_build_object(
    'id', v_activity_id,
    'projectId', p_project_id,
    'eventType', p_event_type,
    'action', p_action,
    'details', p_details,
    'agentId', p_agent_id,
    'agentType', p_agent_type,
    'notificationLevel', p_notification_level
  )::text);

  RETURN v_activity_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate project progress
CREATE OR REPLACE FUNCTION calculate_project_progress(p_project_id UUID)
RETURNS TABLE(
  overall_percent INTEGER,
  current_phase VARCHAR,
  agents_total INTEGER,
  agents_active INTEGER,
  agents_idle INTEGER,
  agents_working INTEGER,
  tasks_total INTEGER,
  tasks_pending INTEGER,
  tasks_in_progress INTEGER,
  tasks_completed INTEGER,
  tasks_failed INTEGER,
  budget_used DECIMAL,
  budget_total DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  WITH agent_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE status != 'terminated') as total,
      COUNT(*) FILTER (WHERE status IN ('idle', 'working')) as active,
      COUNT(*) FILTER (WHERE status = 'idle') as idle,
      COUNT(*) FILTER (WHERE status = 'working') as working
    FROM agents
    WHERE project_id = p_project_id
  ),
  task_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed
    FROM tasks
    WHERE project_id = p_project_id
  ),
  budget_info AS (
    SELECT
      COALESCE(SUM(cost_used), 0) as used,
      COALESCE(MAX(budget_cost_usd), 100) as total
    FROM projects
    WHERE id = p_project_id
  )
  SELECT
    CASE
      WHEN tc.total = 0 THEN 0
      ELSE ((tc.completed::DECIMAL / tc.total) * 100)::INTEGER
    END as overall_percent,
    CASE
      WHEN tc.completed = tc.total AND tc.total > 0 THEN 'completed'
      WHEN tc.in_progress > 0 THEN 'in_progress'
      WHEN tc.pending > 0 THEN 'pending'
      ELSE 'not_started'
    END::VARCHAR as current_phase,
    ac.total::INTEGER,
    ac.active::INTEGER,
    ac.idle::INTEGER,
    ac.working::INTEGER,
    tc.total::INTEGER,
    tc.pending::INTEGER,
    tc.in_progress::INTEGER,
    tc.completed::INTEGER,
    tc.failed::INTEGER,
    bi.used,
    bi.total
  FROM agent_counts ac
  CROSS JOIN task_counts tc
  CROSS JOIN budget_info bi;
END;
$$ LANGUAGE plpgsql;

-- Function: Get notification channels for level and availability
CREATE OR REPLACE FUNCTION get_notification_channels(
  p_level notification_level,
  p_availability availability_mode DEFAULT 'active'
)
RETURNS TEXT[] AS $$
BEGIN
  -- Determine which channels to use based on level and availability
  CASE p_availability
    WHEN 'dnd' THEN
      -- Only critical emergencies
      IF p_level = 'critical' THEN
        RETURN ARRAY['websocket'];
      ELSE
        RETURN ARRAY[]::TEXT[];
      END IF;

    WHEN 'away' THEN
      -- Critical only
      IF p_level = 'critical' THEN
        RETURN ARRAY['push', 'websocket'];
      ELSE
        RETURN ARRAY['websocket'];
      END IF;

    WHEN 'busy' THEN
      -- Critical and warning
      CASE p_level
        WHEN 'critical' THEN RETURN ARRAY['sms', 'push', 'websocket'];
        WHEN 'warning' THEN RETURN ARRAY['push', 'websocket'];
        ELSE RETURN ARRAY['websocket'];
      END CASE;

    ELSE -- 'active'
      -- All notifications
      CASE p_level
        WHEN 'critical' THEN RETURN ARRAY['sms', 'push', 'email', 'websocket'];
        WHEN 'warning' THEN RETURN ARRAY['push', 'email', 'websocket'];
        WHEN 'info' THEN RETURN ARRAY['push', 'websocket'];
        ELSE RETURN ARRAY['websocket'];
      END CASE;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function: Mark notification as read
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE notifications
  SET read_at = NOW()
  WHERE id = p_notification_id AND read_at IS NULL;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function: Acknowledge notification
CREATE OR REPLACE FUNCTION acknowledge_notification(p_notification_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE notifications
  SET acknowledged_at = NOW(), read_at = COALESCE(read_at, NOW())
  WHERE id = p_notification_id AND acknowledged_at IS NULL;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function: Get unread notification count
CREATE OR REPLACE FUNCTION get_unread_notification_count(p_project_id UUID DEFAULT NULL)
RETURNS TABLE(total INTEGER, critical INTEGER, warning INTEGER, info INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as total,
    COUNT(*) FILTER (WHERE level = 'critical')::INTEGER as critical,
    COUNT(*) FILTER (WHERE level = 'warning')::INTEGER as warning,
    COUNT(*) FILTER (WHERE level = 'info')::INTEGER as info
  FROM notifications
  WHERE read_at IS NULL
  AND (p_project_id IS NULL OR project_id = p_project_id);
END;
$$ LANGUAGE plpgsql;

-- View: Recent activity with agent info
CREATE OR REPLACE VIEW recent_activity AS
SELECT
  a.id,
  a.project_id,
  p.name as project_name,
  a.agent_id,
  COALESCE(a.agent_type, ag.type::VARCHAR) as agent_type,
  a.event_type,
  a.action,
  a.details,
  a.task_id,
  t.title as task_title,
  a.file_path,
  a.notification_level,
  a.created_at
FROM activity_stream a
LEFT JOIN projects p ON a.project_id = p.id
LEFT JOIN agents ag ON a.agent_id = ag.id
LEFT JOIN tasks t ON a.task_id = t.id
ORDER BY a.created_at DESC;

-- View: Notification summary by project
CREATE OR REPLACE VIEW notification_summary AS
SELECT
  project_id,
  COUNT(*) as total_notifications,
  COUNT(*) FILTER (WHERE read_at IS NULL) as unread,
  COUNT(*) FILTER (WHERE level = 'critical' AND read_at IS NULL) as critical_unread,
  COUNT(*) FILTER (WHERE level = 'warning' AND read_at IS NULL) as warning_unread,
  COUNT(*) FILTER (WHERE level = 'info' AND read_at IS NULL) as info_unread,
  MAX(created_at) as latest_notification
FROM notifications
GROUP BY project_id;

-- Trigger: Auto-log activity on agent status change
CREATE OR REPLACE FUNCTION trigger_agent_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM log_activity(
      NEW.project_id,
      'agent_status',
      'Agent status changed to ' || NEW.status,
      'Agent ' || NEW.id || ' (' || NEW.type || ') changed from ' || COALESCE(OLD.status::TEXT, 'new') || ' to ' || NEW.status,
      NEW.id,
      NEW.type::VARCHAR,
      NULL,
      NULL,
      CASE
        WHEN NEW.status = 'failed' THEN 'warning'::notification_level
        WHEN NEW.status IN ('working', 'idle') THEN 'info'::notification_level
        ELSE 'silent'::notification_level
      END
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_activity_trigger ON agents;
CREATE TRIGGER agent_activity_trigger
  AFTER INSERT OR UPDATE OF status ON agents
  FOR EACH ROW
  EXECUTE FUNCTION trigger_agent_activity();

-- Trigger: Auto-log activity on task status change
CREATE OR REPLACE FUNCTION trigger_task_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM log_activity(
      NEW.project_id,
      'task_progress',
      'Task status changed to ' || NEW.status,
      'Task "' || NEW.title || '" changed from ' || COALESCE(OLD.status::TEXT, 'new') || ' to ' || NEW.status,
      NEW.assigned_agent_id,
      NULL,
      NEW.id,
      NULL,
      CASE
        WHEN NEW.status = 'completed' THEN 'info'::notification_level
        WHEN NEW.status = 'failed' THEN 'warning'::notification_level
        ELSE 'silent'::notification_level
      END
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_activity_trigger ON tasks;
CREATE TRIGGER task_activity_trigger
  AFTER INSERT OR UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION trigger_task_activity();

-- Trigger: Create notification on critical events
CREATE OR REPLACE FUNCTION trigger_critical_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if this is a critical event that needs notification
  IF NEW.notification_level = 'critical' THEN
    PERFORM create_notification(
      NEW.project_id,
      'critical',
      NEW.event_type::VARCHAR,
      'Critical: ' || NEW.action,
      NEW.details,
      NEW.agent_id,
      NEW.task_id,
      '{}'::JSONB
    );
  ELSIF NEW.notification_level = 'warning' THEN
    PERFORM create_notification(
      NEW.project_id,
      'warning',
      NEW.event_type::VARCHAR,
      'Warning: ' || NEW.action,
      NEW.details,
      NEW.agent_id,
      NEW.task_id,
      '{}'::JSONB
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS critical_notification_trigger ON activity_stream;
CREATE TRIGGER critical_notification_trigger
  AFTER INSERT ON activity_stream
  FOR EACH ROW
  WHEN (NEW.notification_level IN ('critical', 'warning'))
  EXECUTE FUNCTION trigger_critical_notification();

-- Insert default notification settings
INSERT INTO notification_settings (user_id, availability_mode)
VALUES (NULL, 'active')
ON CONFLICT DO NOTHING;
