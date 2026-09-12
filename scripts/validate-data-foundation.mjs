import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SAMPLE_SEED_STATEMENTS } from "../src/data/db/seedData.ts";
import {
  COMPLETE_FOCUS_SESSION_SQL,
  PAUSE_FOCUS_SESSION_SQL,
  RECOVER_RUNNING_SESSIONS_SQL,
  RECOVER_RUNNING_TASKS_SQL,
  RESUME_FOCUS_SESSION_SQL,
} from "../src/data/db/sql.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = await Promise.all([
  readFile(resolve(root, "src-tauri/migrations/001_initial.sql"), "utf8"),
  readFile(resolve(root, "src-tauri/migrations/002_recurring_schedule.sql"), "utf8"),
]);
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
  "focus_sessions",
  "recurring_schedule_exceptions",
  "recurring_schedule_rules",
  "semesters",
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
   VALUES (?1, ?2, 30, 10, 'doing', ?3, ?3)`,
  ["test:task:focus", "Focus lifecycle", now],
);
run(
  `INSERT INTO focus_sessions
   (id, task_id, started_at, planned_minutes, elapsed_seconds, status, last_resumed_at, created_at, updated_at)
   VALUES (?1, ?2, ?3, 30, 0, 'running', ?3, ?3, ?3)`,
  ["test:focus:lifecycle", "test:task:focus", now],
);
assert.equal(one("SELECT status FROM focus_sessions WHERE id = ?1", ["test:focus:lifecycle"]).status, "running");
run(PAUSE_FOCUS_SESSION_SQL, [60, "2026-09-12T00:01:00.000Z", "test:focus:lifecycle"]);
assert.deepEqual(
  { ...one("SELECT status, elapsed_seconds, pause_count FROM focus_sessions WHERE id = ?1", ["test:focus:lifecycle"]) },
  { status: "paused", elapsed_seconds: 60, pause_count: 1 },
);
run(RESUME_FOCUS_SESSION_SQL, ["2026-09-12T00:02:00.000Z", "test:focus:lifecycle"]);
assert.equal(one("SELECT status FROM focus_sessions WHERE id = ?1", ["test:focus:lifecycle"]).status, "running");
run(COMPLETE_FOCUS_SESSION_SQL, [125, "2026-09-12T00:03:00.000Z", "test:focus:lifecycle"]);
run("UPDATE study_tasks SET status = 'done', completed_at = ?1, updated_at = ?1 WHERE id = ?2", [
  "2026-09-12T00:03:00.000Z",
  "test:task:focus",
]);
assert.deepEqual(
  { ...one("SELECT status, elapsed_seconds FROM focus_sessions WHERE id = ?1", ["test:focus:lifecycle"]) },
  { status: "completed", elapsed_seconds: 125 },
);
assert.equal(one("SELECT status FROM study_tasks WHERE id = ?1", ["test:task:focus"]).status, "done");

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
run(RECOVER_RUNNING_TASKS_SQL, ["2026-09-12T01:00:00.000Z"]);
run(RECOVER_RUNNING_SESSIONS_SQL, ["2026-09-12T01:00:00.000Z"]);
assert.deepEqual(
  { ...one("SELECT status, elapsed_seconds FROM focus_sessions WHERE id = ?1", ["test:focus:recovery"]) },
  { status: "paused", elapsed_seconds: 77 },
  "restart recovery must pause without accruing offline time",
);
assert.equal(one("SELECT status FROM study_tasks WHERE id = ?1", ["test:task:recovery"]).status, "paused");

db.close();
console.log("data foundation validation passed: migrations, idempotent seed, task CRUD, focus lifecycle, restart recovery");
