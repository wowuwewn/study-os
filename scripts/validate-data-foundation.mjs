import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SAMPLE_SEED_STATEMENTS } from "../src/data/db/seedData.ts";
import {
  COMPLETE_FOCUS_SESSION_SQL,
  PAUSE_FOCUS_SESSION_SQL,
  RECOVER_RUNNING_INTERVALS_SQL,
  RECOVER_RUNNING_SESSIONS_SQL,
  RECOVER_RUNNING_TASKS_SQL,
  RESUME_FOCUS_SESSION_SQL,
} from "../src/data/db/sql.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationFiles = [
  "001_initial.sql",
  "002_recurring_schedule.sql",
  "003_ical_sync.sql",
  "004_ical_date_guards.sql",
  "005_ical_adapter_version.sql",
  "006_focus_intervals.sql",
  "007_atomic_focus_lifecycle.sql",
];
const migrations = await Promise.all(
  migrationFiles.map((name) => readFile(resolve(root, "src-tauri/migrations", name), "utf8")),
);
const migrationRunner = await readFile(resolve(root, "src-tauri/src/lib.rs"), "utf8");
assert.match(
  migrationRunner,
  /version:\s*7,[\s\S]*?include_str!\("\.\.\/migrations\/007_atomic_focus_lifecycle\.sql"\)/,
  "Tauri migration runner must register migration 007",
);

const upgradeDb = new DatabaseSync(":memory:");
for (const migration of migrations.slice(0, 5)) upgradeDb.exec(migration);
const upgradeRun = (sql, values = []) => upgradeDb.prepare(sql).run(...values);
const upgradeOne = (sql, values = []) => upgradeDb.prepare(sql).get(...values);
upgradeRun(
  `INSERT INTO study_tasks
   (id, title, estimated_minutes, priority, status, created_at, updated_at)
   VALUES (?1, ?2, 30, 10, ?3, ?4, ?4)`,
  ["upgrade:task:completed", "Completed before migration 007", "done", "2026-09-11T23:55:00.000Z"],
);
upgradeRun(
  `INSERT INTO focus_sessions
   (id, task_id, started_at, ended_at, planned_minutes, elapsed_seconds, status, last_resumed_at, created_at, updated_at)
   VALUES (?1, ?2, ?3, ?4, 30, 300, 'completed', ?3, ?3, ?4)`,
  [
    "upgrade:focus:completed",
    "upgrade:task:completed",
    "2026-09-11T23:55:00.000Z",
    "2026-09-12T00:00:00.000Z",
  ],
);
upgradeRun(
  `INSERT INTO study_tasks
   (id, title, estimated_minutes, priority, status, created_at, updated_at)
   VALUES (?1, ?2, 30, 10, 'doing', ?3, ?3)`,
  ["upgrade:task:running", "Running before migration 007", "2026-09-12T00:01:00.000Z"],
);
upgradeRun(
  `INSERT INTO focus_sessions
   (id, task_id, started_at, planned_minutes, elapsed_seconds, status, last_resumed_at, created_at, updated_at)
   VALUES (?1, ?2, ?3, 30, 0, 'running', ?3, ?3, ?3)`,
  ["upgrade:focus:running", "upgrade:task:running", "2026-09-12T00:01:00.000Z"],
);
upgradeDb.exec(migrations[5]);
assert.deepEqual(
  {
    ...upgradeOne(
      "SELECT started_at, ended_at FROM focus_intervals WHERE id = ?1",
      ["legacy:upgrade:focus:completed"],
    ),
  },
  { started_at: "2026-09-11T23:55:00.000Z", ended_at: "2026-09-12T00:00:00.000Z" },
  "migration 006 must backfill accumulated elapsed time as one closed legacy interval",
);
assert.deepEqual(
  {
    ...upgradeOne(
      "SELECT started_at, ended_at FROM focus_intervals WHERE id = ?1",
      ["running:upgrade:focus:running"],
    ),
  },
  { started_at: "2026-09-12T00:01:00.000Z", ended_at: null },
  "migration 006 must continue a running session from its last persisted update",
);
upgradeRun(
  "UPDATE focus_intervals SET ended_at = NULL WHERE id = ?1",
  ["legacy:upgrade:focus:completed"],
);
upgradeRun(
  "DELETE FROM focus_intervals WHERE id = ?1",
  ["running:upgrade:focus:running"],
);
upgradeDb.exec(migrations[6]);
assert.equal(
  upgradeOne("SELECT ended_at FROM focus_intervals WHERE id = ?1", ["legacy:upgrade:focus:completed"]).ended_at,
  "2026-09-12T00:00:00.000Z",
  "migration 007 must repair an interval left open for a completed session",
);
assert.deepEqual(
  {
    ...upgradeOne(
      "SELECT started_at, ended_at FROM focus_intervals WHERE session_id = ?1",
      ["upgrade:focus:running"],
    ),
  },
  { started_at: "2026-09-12T00:01:00.000Z", ended_at: null },
  "migration 007 must repair a running session that has no open interval",
);
upgradeDb.close();

const db = new DatabaseSync(":memory:");
for (const migration of migrations) db.exec(migration);

const run = (sql, values = []) => db.prepare(sql).run(...values);
const one = (sql, values = []) => db.prepare(sql).get(...values);
const now = "2026-09-12T00:00:00.000Z";

const expectedTables = [
  "app_meta",
  "assignments",
  "courses",
  "events",
  "external_sync_items",
  "focus_intervals",
  "focus_sessions",
  "recurring_schedule_exceptions",
  "recurring_schedule_rules",
  "semesters",
  "source_sync_states",
  "sources",
  "study_tasks",
  "task_steps",
];
const actualTables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map(({ name }) => name);
assert.deepEqual(actualTables, expectedTables, "migrations should create the complete schema");

const seed = () => {
  for (const statement of SAMPLE_SEED_STATEMENTS) run(statement.sql, statement.values);
};
seed();
const countsAfterFirstSeed = Object.fromEntries(
  expectedTables
    .filter((table) => table !== "app_meta")
    .map((table) => [table, one(`SELECT COUNT(*) AS count FROM ${table}`).count]),
);
seed();
const countsAfterSecondSeed = Object.fromEntries(
  expectedTables
    .filter((table) => table !== "app_meta")
    .map((table) => [table, one(`SELECT COUNT(*) AS count FROM ${table}`).count]),
);
assert.deepEqual(countsAfterSecondSeed, countsAfterFirstSeed, "seed must be idempotent");

run(
  `INSERT INTO semesters
   (id, source_id, external_id, name, starts_on, ends_on, timezone, created_at, updated_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
  ["test:semester", "seed:source:manual", "test-semester", "Test semester", "2026-09-01", "2026-12-18", "Asia/Seoul", now],
);
run(
  `INSERT INTO recurring_schedule_rules
   (id, semester_id, course_id, source_id, external_id, weekday, start_local_time, end_local_time, location, created_at, updated_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
  ["test:rule", "test:semester", "seed:course:nlp", "seed:source:manual", "test-rule", 5, "09:00", "10:15", "Room", now],
);
assert.throws(
  () => run(
    `INSERT INTO recurring_schedule_rules
     (id, semester_id, course_id, weekday, start_local_time, end_local_time, location, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    ["test:rule:duplicate", "test:semester", "seed:course:nlp", 5, "09:00", "10:15", "Room", now],
  ),
  "database must reject duplicate natural rules",
);
assert.throws(
  () => run(
    `INSERT INTO recurring_schedule_exceptions
     (id, recurring_rule_id, occurrence_on, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'moved', ?4, ?4)`,
    ["test:exception:invalid", "test:rule", "2026-09-11", now],
  ),
  "moved exception must include a replacement start",
);
run(
  `INSERT INTO recurring_schedule_exceptions
   (id, recurring_rule_id, occurrence_on, status, title_override, created_at, updated_at)
   VALUES (?1, ?2, ?3, 'overridden', ?4, ?5, ?5)`,
  ["test:exception:override", "test:rule", "2026-09-11", "Special class", now],
);

run(
  `INSERT INTO study_tasks
   (id, title, estimated_minutes, priority, status, created_at, updated_at)
   VALUES (?1, ?2, ?3, ?4, 'todo', ?5, ?5)`,
  ["test:task:crud", "Repository CRUD", 25, 5, now],
);
assert.equal(one("SELECT title FROM study_tasks WHERE id = ?1", ["test:task:crud"]).title, "Repository CRUD");
run("UPDATE study_tasks SET title = ?1, status = 'doing', updated_at = ?2 WHERE id = ?3", [
  "Repository CRUD updated",
  now,
  "test:task:crud",
]);
run(
  `INSERT INTO task_steps
   (id, task_id, title, sort_order, is_completed, created_at, updated_at)
   VALUES (?1, ?2, ?3, 0, 0, ?4, ?4)`,
  ["test:step:crud", "test:task:crud", "Step", now],
);
assert.equal(one("SELECT status FROM study_tasks WHERE id = ?1", ["test:task:crud"]).status, "doing");
run("DELETE FROM study_tasks WHERE id = ?1", ["test:task:crud"]);
assert.equal(one("SELECT COUNT(*) AS count FROM task_steps WHERE id = ?1", ["test:step:crud"]).count, 0);

run("UPDATE focus_sessions SET status = 'completed', ended_at = ?1, updated_at = ?1 WHERE status = 'paused'", [now]);
run(
  `INSERT INTO study_tasks
   (id, title, estimated_minutes, priority, status, created_at, updated_at)
   VALUES (?1, ?2, 30, 10, 'todo', ?3, ?3)`,
  ["test:task:focus", "Focus lifecycle", now],
);
run(
  `INSERT INTO focus_sessions
   (id, task_id, started_at, planned_minutes, elapsed_seconds, status, last_resumed_at, created_at, updated_at)
   VALUES (?1, ?2, ?3, 30, 0, 'running', ?3, ?3, ?3)`,
  ["test:focus:lifecycle", "test:task:focus", now],
);
assert.equal(one("SELECT status FROM focus_sessions WHERE id = ?1", ["test:focus:lifecycle"]).status, "running");
assert.equal(one("SELECT status FROM study_tasks WHERE id = ?1", ["test:task:focus"]).status, "doing");
assert.deepEqual(
  {
    ...one(
      "SELECT started_at, ended_at FROM focus_intervals WHERE session_id = ?1",
      ["test:focus:lifecycle"],
    ),
  },
  { started_at: now, ended_at: null },
  "starting focus must atomically open its first running interval",
);
run(PAUSE_FOCUS_SESSION_SQL, [60, "2026-09-12T00:01:00.000Z", "test:focus:lifecycle"]);
assert.deepEqual(
  { ...one("SELECT status, elapsed_seconds, pause_count FROM focus_sessions WHERE id = ?1", ["test:focus:lifecycle"]) },
  { status: "paused", elapsed_seconds: 60, pause_count: 1 },
);
assert.equal(one("SELECT status FROM study_tasks WHERE id = ?1", ["test:task:focus"]).status, "paused");
assert.equal(
  one("SELECT ended_at FROM focus_intervals WHERE session_id = ?1", ["test:focus:lifecycle"]).ended_at,
  "2026-09-12T00:01:00.000Z",
  "pausing focus must close the running interval",
);
run(RESUME_FOCUS_SESSION_SQL, ["2026-09-12T00:02:00.000Z", "test:focus:lifecycle"]);
assert.equal(one("SELECT status FROM focus_sessions WHERE id = ?1", ["test:focus:lifecycle"]).status, "running");
assert.equal(one("SELECT status FROM study_tasks WHERE id = ?1", ["test:task:focus"]).status, "doing");
assert.deepEqual(
  {
    ...one(
      `SELECT started_at, ended_at FROM focus_intervals
       WHERE session_id = ?1 ORDER BY started_at DESC LIMIT 1`,
      ["test:focus:lifecycle"],
    ),
  },
  { started_at: "2026-09-12T00:02:00.000Z", ended_at: null },
  "resuming focus must open a new running interval",
);
run(COMPLETE_FOCUS_SESSION_SQL, [125, "2026-09-12T00:03:00.000Z", "test:focus:lifecycle"]);
assert.deepEqual(
  { ...one("SELECT status, elapsed_seconds FROM focus_sessions WHERE id = ?1", ["test:focus:lifecycle"]) },
  { status: "completed", elapsed_seconds: 125 },
);
assert.deepEqual(
  { ...one("SELECT status, completed_at FROM study_tasks WHERE id = ?1", ["test:task:focus"]) },
  { status: "done", completed_at: "2026-09-12T00:03:00.000Z" },
);
assert.equal(
  one("SELECT COUNT(*) AS count FROM focus_intervals WHERE session_id = ?1 AND ended_at IS NULL", ["test:focus:lifecycle"]).count,
  0,
  "completing focus must leave no open running interval",
);

run(
  `INSERT INTO study_tasks
   (id, title, estimated_minutes, priority, status, created_at, updated_at)
   VALUES (?1, ?2, 15, 10, 'todo', ?3, ?3)`,
  ["test:task:cancel", "Focus cancellation", "2026-09-12T00:04:00.000Z"],
);
run(
  `INSERT INTO focus_sessions
   (id, task_id, started_at, planned_minutes, elapsed_seconds, status, last_resumed_at, created_at, updated_at)
   VALUES (?1, ?2, ?3, 15, 0, 'running', ?3, ?3, ?3)`,
  ["test:focus:cancel", "test:task:cancel", "2026-09-12T00:04:00.000Z"],
);
run(
  `UPDATE focus_sessions
   SET status = 'cancelled', elapsed_seconds = 30, ended_at = ?1, updated_at = ?1
   WHERE id = ?2`,
  ["2026-09-12T00:04:30.000Z", "test:focus:cancel"],
);
assert.equal(
  one("SELECT ended_at FROM focus_intervals WHERE session_id = ?1", ["test:focus:cancel"]).ended_at,
  "2026-09-12T00:04:30.000Z",
  "cancelling focus must close the running interval",
);
assert.equal(
  one("SELECT COUNT(*) AS count FROM focus_sessions WHERE status IN ('running', 'paused')").count,
  0,
  "cancelling focus must release the single-active-session boundary",
);

run(
  `INSERT INTO study_tasks
   (id, title, estimated_minutes, priority, status, created_at, updated_at)
   VALUES (?1, ?2, 20, 10, 'doing', ?3, ?3)`,
  ["test:task:recovery", "Restart recovery", now],
);
run(
  `INSERT INTO focus_sessions
   (id, task_id, started_at, planned_minutes, elapsed_seconds, status, last_resumed_at, created_at, updated_at)
   VALUES (?1, ?2, ?3, 20, 77, 'running', ?3, ?3, ?3)`,
  ["test:focus:recovery", "test:task:recovery", now],
);
run(RECOVER_RUNNING_INTERVALS_SQL);
run(RECOVER_RUNNING_TASKS_SQL, ["2026-09-12T01:00:00.000Z"]);
run(RECOVER_RUNNING_SESSIONS_SQL, ["2026-09-12T01:00:00.000Z"]);
assert.deepEqual(
  { ...one("SELECT status, elapsed_seconds FROM focus_sessions WHERE id = ?1", ["test:focus:recovery"]) },
  { status: "paused", elapsed_seconds: 77 },
  "restart recovery must pause without accruing offline time",
);
assert.equal(one("SELECT status FROM study_tasks WHERE id = ?1", ["test:task:recovery"]).status, "paused");
assert.equal(
  one("SELECT ended_at FROM focus_intervals WHERE session_id = ?1", ["test:focus:recovery"]).ended_at,
  now,
  "restart recovery must close the interval at the last persisted session update",
);

db.close();
console.log("data foundation validation passed: migrations 001-007, idempotent seed, task CRUD, atomic focus lifecycle, restart recovery");
