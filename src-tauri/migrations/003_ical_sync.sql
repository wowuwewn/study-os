PRAGMA foreign_keys = ON;

CREATE TABLE source_sync_states (
  source_id TEXT PRIMARY KEY NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'needs_configuration'
    CHECK (status IN ('needs_configuration', 'idle', 'syncing', 'ok', 'error')),
  sync_generation INTEGER NOT NULL DEFAULT 0 CHECK (sync_generation >= 0),
  etag TEXT,
  last_modified TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_code TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  missing_reconciliation_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (missing_reconciliation_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE external_sync_items (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL
    CHECK (entity_kind IN ('event', 'assignment', 'recurring_rule', 'schedule_exception', 'course', 'unsupported')),
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE CASCADE,
  recurring_rule_id TEXT REFERENCES recurring_schedule_rules(id) ON DELETE CASCADE,
  schedule_exception_id TEXT REFERENCES recurring_schedule_exceptions(id) ON DELETE CASCADE,
  course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  remote_sequence INTEGER,
  last_seen_generation INTEGER NOT NULL CHECK (last_seen_generation >= 0),
  explicitly_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (explicitly_cancelled IN (0, 1)),
  removed_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (source_id, external_id),
  CHECK (
    entity_kind = 'unsupported' OR
    ((event_id IS NOT NULL) + (assignment_id IS NOT NULL) +
     (recurring_rule_id IS NOT NULL) + (schedule_exception_id IS NOT NULL) +
     (course_id IS NOT NULL)) = 1
  )
);

CREATE UNIQUE INDEX uq_external_sync_event
  ON external_sync_items(event_id) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX uq_external_sync_assignment
  ON external_sync_items(assignment_id) WHERE assignment_id IS NOT NULL;
CREATE UNIQUE INDEX uq_external_sync_rule
  ON external_sync_items(recurring_rule_id) WHERE recurring_rule_id IS NOT NULL;
CREATE UNIQUE INDEX uq_external_sync_exception
  ON external_sync_items(schedule_exception_id) WHERE schedule_exception_id IS NOT NULL;
CREATE INDEX idx_external_sync_generation
  ON external_sync_items(source_id, last_seen_generation);

ALTER TABLE events ADD COLUMN time_kind TEXT NOT NULL DEFAULT 'date_time'
  CHECK (time_kind IN ('date_time', 'date'));
ALTER TABLE events ADD COLUMN start_on TEXT;
ALTER TABLE events ADD COLUMN end_on_exclusive TEXT;
ALTER TABLE events ADD COLUMN source_timezone TEXT;
ALTER TABLE events ADD COLUMN source_cancelled_at TEXT;
ALTER TABLE events ADD COLUMN source_removed_at TEXT;
ALTER TABLE events ADD COLUMN source_content_hash TEXT;
ALTER TABLE events ADD COLUMN last_seen_sync_generation INTEGER;

ALTER TABLE assignments ADD COLUMN due_on TEXT;
ALTER TABLE assignments ADD COLUMN due_timezone TEXT;
ALTER TABLE assignments ADD COLUMN source_removed_at TEXT;
ALTER TABLE assignments ADD COLUMN source_content_hash TEXT;
ALTER TABLE assignments ADD COLUMN last_seen_sync_generation INTEGER;

ALTER TABLE recurring_schedule_rules ADD COLUMN starts_on TEXT;
ALTER TABLE recurring_schedule_rules ADD COLUMN ends_on TEXT;
ALTER TABLE recurring_schedule_rules ADD COLUMN source_cancelled_at TEXT;
ALTER TABLE recurring_schedule_rules ADD COLUMN source_removed_at TEXT;
ALTER TABLE recurring_schedule_rules ADD COLUMN source_content_hash TEXT;
ALTER TABLE recurring_schedule_rules ADD COLUMN last_seen_sync_generation INTEGER;

CREATE INDEX idx_events_active_start
  ON events(start_at) WHERE source_cancelled_at IS NULL AND source_removed_at IS NULL;
CREATE INDEX idx_events_active_date
  ON events(start_on) WHERE source_cancelled_at IS NULL AND source_removed_at IS NULL;
CREATE INDEX idx_assignments_active_due_on
  ON assignments(due_on) WHERE source_removed_at IS NULL;
CREATE INDEX idx_recurring_rules_active
  ON recurring_schedule_rules(semester_id, weekday, start_local_time)
  WHERE source_cancelled_at IS NULL AND source_removed_at IS NULL;
