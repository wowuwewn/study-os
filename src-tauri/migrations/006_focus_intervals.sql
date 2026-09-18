CREATE TABLE focus_intervals (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX uq_focus_intervals_open_session
  ON focus_intervals(session_id)
  WHERE ended_at IS NULL;
CREATE INDEX idx_focus_intervals_range
  ON focus_intervals(started_at, ended_at);
CREATE INDEX idx_focus_intervals_session
  ON focus_intervals(session_id, started_at);

-- Existing sessions did not retain pause boundaries. Preserve their accumulated
-- duration as one closed legacy interval ending at the last persisted update.
INSERT INTO focus_intervals (id, session_id, started_at, ended_at, created_at)
SELECT
  'legacy:' || id,
  id,
  strftime('%Y-%m-%dT%H:%M:%fZ', julianday(updated_at) - elapsed_seconds / 86400.0),
  updated_at,
  updated_at
FROM focus_sessions
WHERE elapsed_seconds > 0;

-- Continue only the currently running portion from the last persisted instant.
INSERT INTO focus_intervals (id, session_id, started_at, ended_at, created_at)
SELECT 'running:' || id, id, updated_at, NULL, updated_at
FROM focus_sessions
WHERE status = 'running';
