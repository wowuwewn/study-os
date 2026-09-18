-- Repair any interval left open by a pre-v0.1 partial lifecycle write.
UPDATE focus_intervals
SET ended_at = (
  SELECT COALESCE(focus_sessions.ended_at, focus_sessions.updated_at)
  FROM focus_sessions
  WHERE focus_sessions.id = focus_intervals.session_id
)
WHERE ended_at IS NULL
  AND session_id IN (
    SELECT id FROM focus_sessions WHERE status != 'running'
  );

-- A running session without an interval can only be known from its last
-- persisted update. Start there so statistics never invent offline time.
INSERT INTO focus_intervals (id, session_id, started_at, ended_at, created_at)
SELECT
  'repair:' || id,
  id,
  updated_at,
  NULL,
  updated_at
FROM focus_sessions
WHERE status = 'running'
  AND NOT EXISTS (
    SELECT 1 FROM focus_intervals WHERE session_id = focus_sessions.id AND ended_at IS NULL
  );

CREATE TRIGGER focus_session_insert_running
AFTER INSERT ON focus_sessions
WHEN NEW.status = 'running'
BEGIN
  INSERT INTO focus_intervals (id, session_id, started_at, ended_at, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.id, NEW.updated_at, NULL, NEW.updated_at);
  UPDATE study_tasks
  SET status = 'doing', updated_at = NEW.updated_at
  WHERE id = NEW.task_id;
END;

CREATE TRIGGER focus_session_resume
AFTER UPDATE OF status ON focus_sessions
WHEN OLD.status != 'running' AND NEW.status = 'running'
BEGIN
  INSERT INTO focus_intervals (id, session_id, started_at, ended_at, created_at)
  SELECT lower(hex(randomblob(16))), NEW.id, NEW.updated_at, NULL, NEW.updated_at
  WHERE NOT EXISTS (
    SELECT 1 FROM focus_intervals WHERE session_id = NEW.id AND ended_at IS NULL
  );
  UPDATE study_tasks
  SET status = 'doing', completed_at = NULL, updated_at = NEW.updated_at
  WHERE id = NEW.task_id;
END;

CREATE TRIGGER focus_session_leave_running
AFTER UPDATE OF status ON focus_sessions
WHEN OLD.status = 'running' AND NEW.status != 'running'
BEGIN
  UPDATE focus_intervals
  SET ended_at = NEW.updated_at
  WHERE session_id = NEW.id AND ended_at IS NULL;
END;

CREATE TRIGGER focus_session_pause_task
AFTER UPDATE OF status ON focus_sessions
WHEN NEW.status = 'paused' AND OLD.status != 'paused'
BEGIN
  UPDATE study_tasks
  SET status = 'paused', updated_at = NEW.updated_at
  WHERE id = NEW.task_id;
END;

CREATE TRIGGER focus_session_complete_task
AFTER UPDATE OF status ON focus_sessions
WHEN NEW.status = 'completed' AND OLD.status != 'completed'
BEGIN
  UPDATE study_tasks
  SET status = 'done', completed_at = COALESCE(NEW.ended_at, NEW.updated_at), updated_at = NEW.updated_at
  WHERE id = NEW.task_id;
END;
