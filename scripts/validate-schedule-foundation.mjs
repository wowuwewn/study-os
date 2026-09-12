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

const actual2026SecondSemester = {
  version: 1,
  semester: {
    name: "2026-2 Semester",
    startsOn: "2026-09-01",
    endsOn: "2026-12-14",
    timezone: "Asia/Seoul",
  },
  courses: [
    { name: "고급프로그래밍", meetings: [
      { weekday: 1, startLocalTime: "10:00", endLocalTime: "11:30", location: "소프트517" },
      { weekday: 3, startLocalTime: "10:00", endLocalTime: "11:30", location: "소프트517" },
    ] },
    { name: "멀티미디어신호처리", meetings: [
      { weekday: 1, startLocalTime: "14:00", endLocalTime: "15:30", location: "소프트516" },
      { weekday: 4, startLocalTime: "15:30", endLocalTime: "17:00", location: "소프트307" },
    ] },
    { name: "강화학습론", meetings: [
      { weekday: 2, startLocalTime: "13:00", endLocalTime: "14:30", location: "소프트414" },
      { weekday: 4, startLocalTime: "13:00", endLocalTime: "14:30", location: "소프트414" },
    ] },
    { name: "오픈소스AI응용", meetings: [
      { weekday: 2, startLocalTime: "17:00", endLocalTime: "18:30", location: "소프트516" },
      { weekday: 4, startLocalTime: "17:00", endLocalTime: "18:30", location: "소프트516" },
    ] },
    { name: "고급데이터베이스", meetings: [
      { weekday: 3, startLocalTime: "14:00", endLocalTime: "17:00", location: "소프트332" },
    ] },
    { name: "자연어처리", meetings: [
      { weekday: 5, startLocalTime: "09:00", endLocalTime: "11:30", location: "소프트414" },
    ] },
    { name: "오픈소스SW개발", meetings: [
      { weekday: 5, startLocalTime: "12:30", endLocalTime: "15:30", location: "소프트516" },
    ] },
  ],
};

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

const actualMemory = createMemoryRepositories();
for (const [index, name] of [
  "자연어처리",
  "오픈소스AI응용",
  "멀티미디어신호처리",
  "고급프로그래밍",
  "고급데이터베이스",
].entries()) {
  actualMemory.state.courses.push(saved({
    id: `seed:course:${index}`,
    sourceId: "test:source:manual",
    externalId: null,
    name,
    code: `SEED-${index}`,
    location: null,
    colorToken: null,
  }, "course"));
}
const eventCountBeforeActualImport = 0;
const firstActualImport = await importSemesterSchedule(actual2026SecondSemester, actualMemory.repositories);
const firstActualIds = {
  semester: firstActualImport.semester.id,
  courses: firstActualImport.courses.map((course) => course.id),
  rules: firstActualImport.rules.map((rule) => rule.id),
};
assert.equal(actualMemory.state.courses.length, 7, "actual timetable must contain exactly seven courses");
assert.equal(actualMemory.state.rules.length, 11, "actual timetable must contain exactly eleven weekly rules");
assert.equal(eventCountBeforeActualImport, 0, "recurring import must not materialize Event rows");
assert.deepEqual(
  firstActualImport.courses.slice(0, 5).map((course) => course.code),
  ["SEED-3", "SEED-2", null, "SEED-1", "SEED-4"],
  "an import without course codes must preserve metadata on reused courses",
);
const secondActualImport = await importSemesterSchedule(actual2026SecondSemester, actualMemory.repositories);
assert.equal(actualMemory.state.courses.length, 7, "actual re-import must not duplicate courses");
assert.equal(actualMemory.state.rules.length, 11, "actual re-import must not duplicate rules");
assert.equal(secondActualImport.semester.id, firstActualIds.semester);
assert.deepEqual(secondActualImport.courses.map((course) => course.id), firstActualIds.courses);
assert.deepEqual(secondActualImport.rules.map((rule) => rule.id), firstActualIds.rules);

const existingSemesterMemory = createMemoryRepositories();
existingSemesterMemory.state.semesters.push(saved({
  id: "semester:existing-2026-2",
  sourceId: "test:source:manual",
  externalId: null,
  name: "2026-2 Semester",
  startsOn: "2026-09-01",
  endsOn: "2026-12-14",
  timezone: "UTC",
}, "semester"));
const importWithDifferentDates = structuredClone(actual2026SecondSemester);
importWithDifferentDates.semester.startsOn = "2026-09-02";
importWithDifferentDates.semester.endsOn = "2026-12-15";
const preservedSemesterImport = await importSemesterSchedule(importWithDifferentDates, existingSemesterMemory.repositories);
assert.equal(preservedSemesterImport.semester.id, "semester:existing-2026-2");
assert.equal(preservedSemesterImport.semester.startsOn, "2026-09-01");
assert.equal(preservedSemesterImport.semester.endsOn, "2026-12-14");
assert.equal(preservedSemesterImport.semester.timezone, "Asia/Seoul");

const actualSunday = buildScheduleOccurrences({
  semesters: actualMemory.state.semesters,
  courses: actualMemory.state.courses,
  rules: actualMemory.state.rules,
  exceptions: [],
  events: [],
  startAt: "2026-09-12T15:00:00.000Z",
  endAt: "2026-09-13T15:00:00.000Z",
});
assert.equal(actualSunday.length, 0, "the actual timetable has no Sunday classes");
const actualMonday = buildScheduleOccurrences({
  semesters: actualMemory.state.semesters,
  courses: actualMemory.state.courses,
  rules: actualMemory.state.rules,
  exceptions: [],
  events: [],
  startAt: "2026-09-13T15:00:00.000Z",
  endAt: "2026-09-14T15:00:00.000Z",
});
assert.deepEqual(
  actualMonday.map(({ title, startAt, endAt, location }) => ({ title, startAt, endAt, location })),
  [
    { title: "고급프로그래밍", startAt: "2026-09-14T01:00:00.000Z", endAt: "2026-09-14T02:30:00.000Z", location: "소프트517" },
    { title: "멀티미디어신호처리", startAt: "2026-09-14T05:00:00.000Z", endAt: "2026-09-14T06:30:00.000Z", location: "소프트516" },
  ],
  "actual Monday occurrences must preserve canonical local times and rooms",
);

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

console.log("schedule validation passed: foundation plus actual 2026-2 7-course/11-rule idempotent import");
