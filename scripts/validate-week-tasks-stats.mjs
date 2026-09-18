import assert from "node:assert/strict";

process.env.TZ = "Asia/Seoul";

const { buildWeekDays, getLocalWeekRange } = await import("../src/features/week/model.ts");
const { buildTaskList } = await import("../src/features/tasks/model.ts");
const { buildFocusStats } = await import("../src/features/focus-stats/model.ts");

const now = new Date("2026-09-16T01:00:00.000Z");
const range = getLocalWeekRange(now);
assert.equal(range.start.toISOString(), "2026-09-13T15:00:00.000Z", "week must start Monday local time");
assert.equal(range.end.toISOString(), "2026-09-20T15:00:00.000Z", "week must end after Sunday local time");

const taskBase = {
  sourceId: null,
  courseId: null,
  assignmentId: null,
  notes: null,
  estimatedMinutes: 30,
  priority: 50,
  status: "todo",
  plannedStartAt: null,
  completedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  steps: [],
};
const assignmentBase = {
  sourceId: null,
  courseId: null,
  externalId: null,
  description: null,
  dueAt: null,
  dueOn: null,
  dueTimezone: null,
  points: null,
  submissionType: null,
  status: "open",
  submittedAt: null,
  gradedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const tasks = [
  { ...taskBase, id: "linked-task", assignmentId: "linked-assignment", title: "연결 과제 실행", dueAt: "2026-09-17T14:59:59.999Z" },
  { ...taskBase, id: "no-deadline", title: "기한 없는 할 일", dueAt: null },
  { ...taskBase, id: "completed", title: "끝난 할 일", dueAt: "2026-09-15T14:59:59.999Z", status: "done", completedAt: "2026-09-15T02:00:00.000Z" },
];
const assignments = [
  { ...assignmentBase, id: "linked-assignment", title: "중복되면 안 되는 과제", dueOn: "2026-09-17", dueTimezone: "Asia/Seoul" },
  { ...assignmentBase, id: "virtual-assignment", title: "가상 과제", dueOn: "2026-09-18", dueTimezone: "Asia/Seoul" },
];
const occurrence = {
  id: "class:monday",
  sourceId: null,
  courseId: "course:1",
  externalId: null,
  eventType: "class",
  title: "월요일 실제 수업",
  startAt: "2026-09-14T00:00:00.000Z",
  endAt: "2026-09-14T01:00:00.000Z",
  location: "강의실",
  isFixed: true,
  notes: null,
  timeKind: "date_time",
  startOn: null,
  endOnExclusive: null,
  sourceTimezone: null,
  origin: "recurring",
  recurringRuleId: "rule:1",
  exceptionId: null,
  semesterId: "semester:1",
};

const days = buildWeekDays({ anchor: now, now, occurrences: [occurrence], assignments, tasks: tasks.filter((task) => task.status !== "done") });
assert.equal(days.length, 7, "week must always contain Monday through Sunday");
assert.equal(days[0].dateKey, "2026-09-14");
assert.equal(days[6].dateKey, "2026-09-20");
assert.ok(days[0].items.some((item) => item.title === "월요일 실제 수업"));
assert.ok(days.some((day) => day.items.some((item) => item.title === "연결 과제 실행")));
assert.ok(days.some((day) => day.items.some((item) => item.title === "가상 과제")));
assert.ok(!days.some((day) => day.items.some((item) => item.title === "중복되면 안 되는 과제")), "linked assignment must be suppressed");

const recommendation = {
  candidateId: "assignment:virtual-assignment",
  reasons: ["마감 3일 남음"],
  lastSafeStart: null,
};
const list = buildTaskList({ tasks, assignments, recommendation, now });
assert.equal(list.filter((item) => item.id === "assignment:linked-assignment").length, 0, "linked open task must suppress virtual assignment");
assert.equal(list.find((item) => item.id === "assignment:virtual-assignment")?.group, "this_week");
assert.equal(list.find((item) => item.id === "task:no-deadline")?.group, "no_deadline");
assert.equal(list.find((item) => item.id === "task:completed")?.group, "completed");
assert.equal(list.find((item) => item.id === "assignment:virtual-assignment")?.isRecommended, true, "Decision Engine recommendation must be reused");

const statsNow = new Date("2026-09-16T01:00:00.000Z"); // Wednesday 10:00 KST
const intervals = [
  { id: "i1", sessionId: "s1", startedAt: "2026-09-14T14:50:00.000Z", endedAt: "2026-09-14T15:10:00.000Z", sessionStatus: "completed" },
  { id: "i2", sessionId: "s2", startedAt: "2026-09-16T00:30:00.000Z", endedAt: null, sessionStatus: "running" },
  { id: "i3a", sessionId: "s3", startedAt: "2026-09-15T00:00:00.000Z", endedAt: "2026-09-15T00:15:00.000Z", sessionStatus: "completed" },
  { id: "i3b", sessionId: "s3", startedAt: "2026-09-15T00:45:00.000Z", endedAt: "2026-09-15T01:00:00.000Z", sessionStatus: "completed" },
];
const stats = buildFocusStats(intervals, statsNow);
assert.equal(stats.todayMinutes, 30, "running elapsed must extend exactly to injected now");
assert.equal(stats.weekMinutes, 80, "paused gap must not count");
assert.equal(stats.weekSessionCount, 3, "multiple intervals from one session count once");
assert.equal(stats.days[0].minutes, 10, "cross-midnight interval must split at local day boundary");
assert.equal(stats.days[1].minutes, 40, "Tuesday must include post-midnight and two running segments");

console.log("Week, Tasks, and Focus Stats validation passed.");
