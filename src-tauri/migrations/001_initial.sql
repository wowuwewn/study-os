PRAGMA foreign_keys = ON;

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'ical', 'ecampus', 'likelion')),
  display_name TEXT NOT NULL,
  integration_metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE courses (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  external_id TEXT,
  name TEXT NOT NULL,
  code TEXT,
  location TEXT,
  color_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_courses_external
  ON courses(source_id, external_id)
  WHERE source_id IS NOT NULL AND external_id IS NOT NULL;

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  external_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('class', 'exam', 'personal', 'study_block', 'meeting')),
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  location TEXT,
  is_fixed INTEGER NOT NULL DEFAULT 1 CHECK (is_fixed IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_at IS NULL OR end_at >= start_at)
);

CREATE UNIQUE INDEX uq_events_external
  ON events(source_id, external_id)
  WHERE source_id IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_events_start_at ON events(start_at);
CREATE INDEX idx_events_course_start ON events(course_id, start_at);

CREATE TABLE assignments (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  due_at TEXT,
  points REAL,
  submission_type TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'graded', 'cancelled')),
  submitted_at TEXT,
  graded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_assignments_external
  ON assignments(source_id, external_id)
  WHERE source_id IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_assignments_due_at ON assignments(due_at);
CREATE INDEX idx_assignments_course_status ON assignments(course_id, status);

CREATE TABLE study_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  notes TEXT,
  estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'paused', 'done', 'cancelled')),
  due_at TEXT,
  planned_start_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_study_tasks_status ON study_tasks(status);
CREATE INDEX idx_study_tasks_due_at ON study_tasks(due_at);
CREATE INDEX idx_study_tasks_priority ON study_tasks(priority DESC, due_at);
CREATE INDEX idx_study_tasks_assignment ON study_tasks(assignment_id);

CREATE TABLE task_steps (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES study_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, sort_order)
);

CREATE INDEX idx_task_steps_task_order ON task_steps(task_id, sort_order);

CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT REFERENCES study_tasks(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  planned_minutes INTEGER CHECK (planned_minutes IS NULL OR planned_minutes > 0),
  elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'cancelled')),
  last_resumed_at TEXT,
  pause_count INTEGER NOT NULL DEFAULT 0 CHECK (pause_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_focus_sessions_single_active
  ON focus_sessions((1))
  WHERE status IN ('running', 'paused');
CREATE INDEX idx_focus_sessions_task_id ON focus_sessions(task_id);
CREATE INDEX idx_focus_sessions_started_at ON focus_sessions(started_at);
CREATE INDEX idx_focus_sessions_status ON focus_sessions(status);
