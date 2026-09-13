import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(":memory:");
for (const name of ["001_initial.sql", "002_recurring_schedule.sql", "003_ical_sync.sql", "004_ical_date_guards.sql", "005_ical_adapter_version.sql"]) {
  db.exec(await readFile(resolve(root, "src-tauri/migrations", name), "utf8"));
}

const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name);
assert(columns("source_sync_states").includes("missing_reconciliation_enabled"));
assert(columns("source_sync_states").includes("adapter_version"));
assert(columns("events").includes("start_on"));
assert(columns("events").includes("time_kind"));
assert(columns("assignments").includes("due_on"));
assert(columns("recurring_schedule_rules").includes("starts_on"));

const now = "2026-09-13T00:00:00.000Z";
db.prepare("INSERT INTO sources (id, kind, display_name, created_at, updated_at) VALUES (?, 'ical', ?, ?, ?)")
  .run("source:test", "Synthetic iCal", now, now);
db.prepare("INSERT INTO source_sync_states (source_id, status, created_at, updated_at) VALUES (?, 'idle', ?, ?)")
  .run("source:test", now, now);
assert.equal(
  db.prepare("SELECT missing_reconciliation_enabled enabled FROM source_sync_states WHERE source_id=?")
    .get("source:test").enabled,
  0,
  "missing reconciliation must remain disabled in v0.1",
);

db.prepare(`INSERT INTO events
  (id, source_id, external_id, event_type, title, start_at, is_fixed, created_at, updated_at,
   time_kind, start_on, end_on_exclusive, source_timezone)
  VALUES (?, ?, ?, 'meeting', ?, ?, 1, ?, ?, 'date', ?, ?, ?)`)
  .run(
    "event:all-day",
    "source:test",
    "ical:v1:synthetic-hash",
    "Synthetic all-day event",
    "2026-09-17T15:00:00.000Z",
    now,
    now,
    "2026-09-18",
    "2026-09-19",
    "Asia/Seoul",
  );
const allDay = db.prepare("SELECT time_kind, start_on, start_at, source_timezone FROM events WHERE id=?")
  .get("event:all-day");
assert.deepEqual({ ...allDay }, {
  time_kind: "date",
  start_on: "2026-09-18",
  start_at: "2026-09-17T15:00:00.000Z",
  source_timezone: "Asia/Seoul",
});
assert.throws(() => db.prepare(`INSERT INTO events
  (id, event_type, title, start_at, is_fixed, created_at, updated_at, time_kind)
  VALUES (?, 'meeting', ?, ?, 1, ?, ?, 'date')`)
  .run("event:invalid-date", "Invalid synthetic date", now, now, now));

db.prepare(`INSERT INTO external_sync_items
  (source_id, external_id, entity_kind, event_id, content_hash, last_seen_generation, first_seen_at, last_seen_at)
  VALUES (?, ?, 'event', ?, ?, 1, ?, ?)`)
  .run("source:test", "ical:v1:synthetic-hash", "event:all-day", "content-hash", now, now);
assert.throws(() => db.prepare(`INSERT INTO external_sync_items
  (source_id, external_id, entity_kind, event_id, content_hash, last_seen_generation, first_seen_at, last_seen_at)
  VALUES (?, ?, 'event', ?, ?, 1, ?, ?)`)
  .run("source:test", "ical:v1:synthetic-hash", "event:all-day", "other", now, now));

const fixture = await readFile(resolve(root, "src-tauri/test-fixtures/canvas-synthetic.ics"), "utf8");
assert(fixture.includes("BEGIN:VEVENT"));
assert(fixture.includes("BEGIN:VTODO"));
assert(fixture.includes("RRULE:FREQ=WEEKLY"));
assert(!fixture.includes("token="));
assert(!fixture.includes("Cookie:"));

db.close();
console.log("iCal sync validation passed: migration, disabled missing reconciliation, date semantics, global dedup, synthetic fixture");
