PRAGMA foreign_keys = ON;

CREATE TRIGGER validate_events_date_semantics_insert
BEFORE INSERT ON events
WHEN (
  (NEW.time_kind = 'date' AND (
    NEW.start_on IS NULL OR NEW.source_timezone IS NULL OR NEW.end_at IS NOT NULL OR
    NEW.start_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' OR
    (NEW.end_on_exclusive IS NOT NULL AND NEW.end_on_exclusive <= NEW.start_on)
  )) OR
  (NEW.time_kind = 'date_time' AND (NEW.start_on IS NOT NULL OR NEW.end_on_exclusive IS NOT NULL))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid event date semantics');
END;

CREATE TRIGGER validate_events_date_semantics_update
BEFORE UPDATE OF time_kind, start_on, end_on_exclusive, source_timezone, end_at ON events
WHEN (
  (NEW.time_kind = 'date' AND (
    NEW.start_on IS NULL OR NEW.source_timezone IS NULL OR NEW.end_at IS NOT NULL OR
    NEW.start_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' OR
    (NEW.end_on_exclusive IS NOT NULL AND NEW.end_on_exclusive <= NEW.start_on)
  )) OR
  (NEW.time_kind = 'date_time' AND (NEW.start_on IS NOT NULL OR NEW.end_on_exclusive IS NOT NULL))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid event date semantics');
END;

CREATE TRIGGER validate_assignments_date_semantics_insert
BEFORE INSERT ON assignments
WHEN (NEW.due_at IS NOT NULL AND NEW.due_on IS NOT NULL)
  OR (NEW.due_on IS NOT NULL AND NEW.due_timezone IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid assignment date semantics');
END;

CREATE TRIGGER validate_assignments_date_semantics_update
BEFORE UPDATE OF due_at, due_on, due_timezone ON assignments
WHEN (NEW.due_at IS NOT NULL AND NEW.due_on IS NOT NULL)
  OR (NEW.due_on IS NOT NULL AND NEW.due_timezone IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid assignment date semantics');
END;

CREATE TRIGGER validate_recurring_rule_bounds_insert
BEFORE INSERT ON recurring_schedule_rules
WHEN NEW.starts_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.ends_on < NEW.starts_on
BEGIN
  SELECT RAISE(ABORT, 'invalid recurring rule bounds');
END;

CREATE TRIGGER validate_recurring_rule_bounds_update
BEFORE UPDATE OF starts_on, ends_on ON recurring_schedule_rules
WHEN NEW.starts_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.ends_on < NEW.starts_on
BEGIN
  SELECT RAISE(ABORT, 'invalid recurring rule bounds');
END;
