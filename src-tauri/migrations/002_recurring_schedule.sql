PRAGMA foreign_keys = ON;

CREATE TABLE semesters (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  external_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (ends_on >= starts_on)
);

CREATE UNIQUE INDEX uq_semesters_external
  ON semesters(source_id, external_id)
  WHERE source_id IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_semesters_dates ON semesters(starts_on, ends_on);

CREATE TABLE recurring_schedule_rules (
  id TEXT PRIMARY KEY NOT NULL,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  external_id TEXT,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_local_time TEXT NOT NULL,
  end_local_time TEXT NOT NULL,
  location TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_local_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (end_local_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (start_local_time < '24:00' AND end_local_time < '24:00'),
  CHECK (end_local_time > start_local_time)
);

CREATE UNIQUE INDEX uq_recurring_schedule_rules_external
  ON recurring_schedule_rules(source_id, external_id)
  WHERE source_id IS NOT NULL AND external_id IS NOT NULL;
CREATE UNIQUE INDEX uq_recurring_schedule_rules_natural
  ON recurring_schedule_rules(
    semester_id,
    course_id,
    weekday,
    start_local_time,
    end_local_time,
    ifnull(location, '')
  );
CREATE INDEX idx_recurring_schedule_rules_semester_weekday
  ON recurring_schedule_rules(semester_id, weekday, start_local_time);

CREATE TABLE recurring_schedule_exceptions (
  id TEXT PRIMARY KEY NOT NULL,
  recurring_rule_id TEXT NOT NULL REFERENCES recurring_schedule_rules(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  external_id TEXT,
  occurrence_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('cancelled', 'moved', 'overridden')),
  replacement_start_at TEXT,
  replacement_end_at TEXT,
  title_override TEXT,
  location_override TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(recurring_rule_id, occurrence_on),
  CHECK (occurrence_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  CHECK (status <> 'moved' OR replacement_start_at IS NOT NULL),
  CHECK (
    replacement_end_at IS NULL OR
    (replacement_start_at IS NOT NULL AND replacement_end_at >= replacement_start_at)
  )
);

CREATE UNIQUE INDEX uq_recurring_schedule_exceptions_external
  ON recurring_schedule_exceptions(source_id, external_id)
  WHERE source_id IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_recurring_schedule_exceptions_rule_date
  ON recurring_schedule_exceptions(recurring_rule_id, occurrence_on);
CREATE INDEX idx_recurring_schedule_exceptions_replacement_start
  ON recurring_schedule_exceptions(replacement_start_at);

-- Remove only the old deterministic development timeline. User-created and
-- imported Event rows are intentionally preserved.
DELETE FROM events
WHERE id IN (
  'seed:event:nlp',
  'seed:event:open-source-ai',
  'seed:event:multimedia',
  'seed:event:personal'
);
