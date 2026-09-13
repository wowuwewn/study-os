import assert from "node:assert/strict";
import {
  assignmentDateKey,
  calendarRowsForDate,
  filterAssignmentsFrom,
  localDateKey,
  monthDays,
  monthRange,
  occurrenceDateKeys,
  upcomingAssignmentRows,
} from "../src/features/calendar/model.ts";

const september = monthDays(2026, 8);
assert.equal(september.length, 32);
assert.deepEqual(september.slice(0, 3), [null, null, { dateKey: "2026-09-01", day: 1 }]);
assert.deepEqual(september.at(-1), { dateKey: "2026-09-30", day: 30 });
assert.equal(monthDays(2026, 7).length, 37, "six-row months must retain every leading blank and date");

const range = monthRange(2026, 8);
assert.equal(localDateKey(new Date(range.startAt)), "2026-09-01");
assert.equal(localDateKey(new Date(range.endAt)), "2026-10-01");

const assignmentBase = {
  sourceId: "integration:ical:canvas-dankook",
  courseId: null,
  externalId: "opaque",
  description: null,
  dueTimezone: "Asia/Seoul",
  points: null,
  submissionType: null,
  status: "open",
  submittedAt: null,
  gradedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const assignments = [
  { ...assignmentBase, id: "assignment:date", title: "iCal DATE 과제", dueAt: null, dueOn: "2026-09-14" },
  { ...assignmentBase, id: "assignment:instant", title: "iCal 시각 과제", dueAt: "2026-09-16T03:00:00.000Z", dueOn: null },
  { ...assignmentBase, id: "assignment:outside", title: "범위 밖 과제", dueAt: null, dueOn: "2026-10-01" },
];
assert.equal(assignmentDateKey(assignments[0]), "2026-09-14");
assert.equal(assignmentDateKey(assignments[1]), "2026-09-16");
assert.deepEqual(
  filterAssignmentsFrom(assignments, range).map((item) => item.id),
  ["assignment:date", "assignment:instant", "assignment:outside"],
  "upcoming deadlines must remain visible across the displayed month's boundary",
);

const eventBase = {
  sourceId: null,
  courseId: null,
  externalId: null,
  eventType: "personal",
  endAt: null,
  location: null,
  isFixed: true,
  notes: null,
  endOnExclusive: null,
  sourceTimezone: null,
  origin: "event",
  recurringRuleId: null,
  exceptionId: null,
  semesterId: null,
};
const occurrences = [
  {
    ...eventBase,
    id: "occurrence:semester",
    title: "실제 Semester 반복 수업",
    startAt: "2026-09-14T01:00:00.000Z",
    timeKind: "date_time",
    startOn: null,
    origin: "recurring",
    recurringRuleId: "rule:semester",
    semesterId: "semester:2026-2",
  },
  {
    ...eventBase,
    id: "event:quick-add",
    title: "Quick Add one-off Event",
    startAt: "2026-09-14T08:00:00.000Z",
    timeKind: "date_time",
    startOn: null,
  },
  {
    ...eventBase,
    id: "event:ical",
    sourceId: "integration:ical:canvas-dankook",
    externalId: "hashed-uid",
    title: "iCal Event",
    startAt: "2026-09-14T09:00:00.000Z",
    timeKind: "date_time",
    startOn: null,
  },
];
assert.deepEqual(
  calendarRowsForDate("2026-09-14", occurrences, assignments).map(({ kind, title }) => ({ kind, title })),
  [
    { kind: "occurrence", title: "실제 Semester 반복 수업" },
    { kind: "occurrence", title: "Quick Add one-off Event" },
    { kind: "occurrence", title: "iCal Event" },
    { kind: "assignment", title: "iCal DATE 과제" },
  ],
  "Calendar must merge normalized recurring, one-off, iCal Event, and Assignment rows without collapsing domains",
);

const multiDay = {
  ...eventBase,
  id: "event:multi-day",
  title: "연속 종일 일정",
  startAt: "2026-09-17T15:00:00.000Z",
  timeKind: "date",
  startOn: "2026-09-18",
  endOnExclusive: "2026-09-21",
  sourceTimezone: "Asia/Seoul",
};
assert.deepEqual(occurrenceDateKeys(multiDay), ["2026-09-18", "2026-09-19", "2026-09-20"]);
assert.deepEqual(
  upcomingAssignmentRows("2026-09-15", assignments).map((row) => row.id),
  ["assignment:instant", "assignment:outside"],
);

console.log("calendar validation passed: grid, range, timezone boundary, domain merge, all-day span");
