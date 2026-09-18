export const RECOVER_RUNNING_TASKS_SQL = `UPDATE study_tasks
  SET status = 'paused', updated_at = ?1
  WHERE id IN (
    SELECT task_id FROM focus_sessions
    WHERE status = 'running' AND task_id IS NOT NULL
  )`;

export const RECOVER_RUNNING_INTERVALS_SQL = `UPDATE focus_intervals
  SET ended_at = (
    SELECT updated_at FROM focus_sessions WHERE focus_sessions.id = focus_intervals.session_id
  )
  WHERE ended_at IS NULL AND session_id IN (
    SELECT id FROM focus_sessions WHERE status = 'running'
  )`;

export const RECOVER_RUNNING_SESSIONS_SQL = `UPDATE focus_sessions
  SET status = 'paused', updated_at = ?1
  WHERE status = 'running'`;

export const RESUME_FOCUS_SESSION_SQL = `UPDATE focus_sessions
  SET status = 'running', last_resumed_at = ?1, ended_at = NULL, updated_at = ?1
  WHERE id = ?2 AND status = 'paused'`;

export const PAUSE_FOCUS_SESSION_SQL = `UPDATE focus_sessions
  SET status = 'paused', elapsed_seconds = ?1, pause_count = pause_count + 1, updated_at = ?2
  WHERE id = ?3 AND status = 'running'`;

export const COMPLETE_FOCUS_SESSION_SQL = `UPDATE focus_sessions
  SET status = 'completed', elapsed_seconds = ?1, ended_at = ?2, updated_at = ?2
  WHERE id = ?3 AND status IN ('running', 'paused')`;

export const SAVE_FOCUS_ELAPSED_SQL = `UPDATE focus_sessions
  SET elapsed_seconds = ?1, updated_at = ?2
  WHERE id = ?3 AND status = 'running'`;
