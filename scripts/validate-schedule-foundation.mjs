import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScheduleOccurrences } from "../src/features/schedule/occurrences.ts";
import {
  importSemesterSchedule,
  validateSemesterScheduleImport,
} from "../src/features/schedule/import.ts";
import { zonedDateTimeToUtc } from "../src/features/schedule/timezone.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const example = JSON.parse(await readFile(resolve(root, "semester.example.json"), "utf8"));
const now = "2026-09-01T00:00:00.000Z";

function saved(input, prefix) {
  return {
    ...input,
    id: input.id ?? `${prefix}:${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  };
}

function createMemoryRepositories() {
  const state = { courses: [], semesters: [], rules: [] };
  const source = {
    id: "test:source:manual",
    kind: "manual",
    displayName: "직접 입력",
    integrationMetadata: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    state,
    repositories: {
      sources: { async getOrCreateManual() { return source; } },
      courses: {
        async list() { return [...state.courses]; },
        async get(id) { return state.courses.find((item) => item.id === id) ?? null; },
        async save(input) {
          const value = saved(input, "course");
          state.courses = [...state.courses.filter((item) => item.id !== value.id), value];
          return value;
        },
        async remove(id) { state.courses = state.courses.filter((item) => item.id !== id); },
      },
      semesters: {
        async list() { return [...state.semesters]; },
        async get(id) { return state.semesters.find((item) => item.id === id) ?? null; },
        async save(input) {
          const value = saved(input, "semester");
          state.semesters = [...state.semesters.filter((item) => item.id !== value.id), value];
          return value;
        },
        async remove(id) { state.semesters = state.semesters.filter((item) => item.id !== id); },
      },
      rules: {
        async list() { return [...state.rules]; },
        async listForSemester(semesterId) { return state.rules.filter((item) => item.semesterId === semesterId); },
        async get(id) { return state.rules.find((item) => item.id === id) ?? null; },
        async save(input) {
          const value = saved(input, "rule");
          state.rules = [...state.rules.filter((item) => item.id !== value.id), value];
          return value;
        },
        async remove(id) { state.rules = state.rules.filter((item) => item.id !== id); },
      },
    },
  };
}

const memory = createMemoryRepositories();
const firstImport = await importSemesterSchedule(example, memory.repositories);
assert.equal(memory.state.semesters.length, 1, "semester import should persist one semester");
assert.equal(memory.state.courses.length, 2, "semester import should upsert courses");
assert.equal(memory.state.rules.length, 2, "semester import should upsert recurring rules");
const stableIds = {
  semester: firstImport.semester.id,
  courses: firstImport.courses.map((course) => course.id),
  rules: firstImport.rules.map((rule) => rule.id),
};
const secondImport = await importSemesterSchedule(example, memory.repositories);
assert.equal(memory.state.semesters.length, 1, "re-import must not duplicate semester");
assert.equal(memory.state.courses.length, 2, "re-import must not duplicate courses");
assert.equal(memory.state.rules.length, 2, "re-import must not duplicate rules");
assert.deepEqual(secondImport.courses.map((course) => course.id), stableIds.courses);
assert.deepEqual(secondImport.rules.map((rule) => rule.id), stableIds.rules);

const baseOccurrenceInput = {
  semesters: memory.state.semesters,
  courses: memory.state.courses,
  rules: memory.state.rules,
  exceptions: [],
  events: [],
};
const friday = buildScheduleOccurrences({
  ...baseOccurrenceInput,
  startAt: "2026-09-10T15:00:00.000Z",
  endAt: "2026-09-11T15:00:00.000Z",
});
assert.equal(friday.length, 2, "Friday rules should occur on Friday");
assert.deepEqual(friday.map((item) => item.startAt), [
  "2026-09-11T00:00:00.000Z",
  "2026-09-11T03:30:00.000Z",
]);
const saturday = buildScheduleOccurrences({
  ...baseOccurrenceInput,
  startAt: "2026-09-11T15:00:00.000Z",
  endAt: "2026-09-12T15:00:00.000Z",
});
assert.equal(saturday.length, 0, "rules must not occur on another weekday");
const outsideSemester = buildScheduleOccurrences({
  ...baseOccurrenceInput,
  startAt: "2027-09-10T15:00:00.000Z",
  endAt: "2027-09-11T15:00:00.000Z",
});
assert.equal(outsideSemester.length, 0, "rules must not occur outside semester dates");

const oneOff = {
  id: "test:event:one-off",
  sourceId: "test:source:manual",
  courseId: null,
  externalId: null,
  eventType: "personal",
  title: "Quick Add 일정",
  startAt: "2026-09-11T01:00:00.000Z",
  endAt: null,
  location: null,
  isFixed: true,
  notes: null,
  createdAt: now,
  updatedAt: now,
};
const merged = buildScheduleOccurrences({
  ...baseOccurrenceInput,
  events: [oneOff],
  startAt: "2026-09-10T15:00:00.000Z",
  endAt: "2026-09-11T15:00:00.000Z",
});
assert.deepEqual(
  merged.map((item) => item.title),
  ["자연어처리", "Quick Add 일정", "오픈소스AI응용"],
  "one-off and recurring occurrences should merge chronologically",
);

assert.equal(
  zonedDateTimeToUtc("2026-09-14", "00:30", "Asia/Seoul"),
  "2026-09-13T15:30:00.000Z",
  "semester wall-clock time must survive the UTC date boundary",
);
const boundarySemester = { ...memory.state.semesters[0], id: "semester:boundary", startsOn: "2026-09-14", endsOn: "2026-09-14" };
const boundaryRule = { ...memory.state.rules[0], id: "rule:boundary", semesterId: boundarySemester.id, weekday: 1, startLocalTime: "00:30", endLocalTime: "01:30" };
const boundaryOccurrence = buildScheduleOccurrences({
  semesters: [boundarySemester],
  courses: memory.state.courses,
  rules: [boundaryRule],
  exceptions: [],
  events: [],
  startAt: "2026-09-13T15:00:00.000Z",
  endAt: "2026-09-13T17:00:00.000Z",
});
assert.equal(boundaryOccurrence[0]?.startAt, "2026-09-13T15:30:00.000Z");

const invalidCases = [
  (value) => { value.semester.endsOn = "2026-08-31"; },
  (value) => { value.courses[0].meetings[0].weekday = 7; },
  (value) => { value.courses[0].meetings[0].endLocalTime = "08:00"; },
  (value) => { value.courses[0].name = "  "; },
  (value) => { value.semester.timezone = "Mars/Olympus"; },
  (value) => { value.courses[0].meetings.push(structuredClone(value.courses[0].meetings[0])); },
];
for (const mutate of invalidCases) {
  const invalid = structuredClone(example);
  mutate(invalid);
  assert.throws(() => validateSemesterScheduleImport(invalid));
}

const firstRule = memory.state.rules[0];
const originalDate = "2026-09-11";
const exceptionBase = {
  id: "exception:test",
  recurringRuleId: firstRule.id,
  sourceId: null,
  externalId: null,
  occurrenceOn: originalDate,
  replacementStartAt: null,
  replacementEndAt: null,
  titleOverride: null,
  locationOverride: null,
  notes: null,
  createdAt: now,
  updatedAt: now,
};
const cancelled = buildScheduleOccurrences({
  ...baseOccurrenceInput,
  exceptions: [{ ...exceptionBase, status: "cancelled" }],
  startAt: "2026-09-10T15:00:00.000Z",
  endAt: "2026-09-11T15:00:00.000Z",
});
assert.equal(cancelled.some((item) => item.recurringRuleId === firstRule.id), false);
const moved = buildScheduleOccurrences({
  ...baseOccurrenceInput,
  exceptions: [{
    ...exceptionBase,
    status: "moved",
    replacementStartAt: "2026-09-12T02:00:00.000Z",
    replacementEndAt: "2026-09-12T03:15:00.000Z",
    locationOverride: "보강 강의실",
  }],
  startAt: "2026-09-12T00:00:00.000Z",
  endAt: "2026-09-13T00:00:00.000Z",
});
assert.equal(moved[0]?.location, "보강 강의실", "moved exception should materialize on replacement date");
const overridden = buildScheduleOccurrences({
  ...baseOccurrenceInput,
  exceptions: [{ ...exceptionBase, status: "overridden", titleOverride: "특강" }],
  startAt: "2026-09-10T15:00:00.000Z",
  endAt: "2026-09-11T15:00:00.000Z",
});
assert.equal(overridden[0]?.title, "특강", "override should not mutate the recurring rule");

console.log("schedule foundation validation passed: import, idempotency, recurrence, merge, timezone, validation, exceptions");
