import assert from "node:assert/strict";
import {
  buildDecisionCandidates,
  calculateLastSafeStart,
  evaluateDecision,
  resolveCandidateDueAt,
} from "../src/features/decision-engine/scoring.ts";
import { materializeDecisionTask } from "../src/features/decision-engine/materialize.ts";

const now = new Date("2026-09-14T00:00:00.000Z");
const iso = (hours) => new Date(now.getTime() + hours * 3_600_000).toISOString();

function task(overrides = {}) {
  return {
    id: "task:base",
    sourceId: null,
    courseId: null,
    assignmentId: null,
    title: "기본 작업",
    notes: null,
    estimatedMinutes: 30,
    priority: 50,
    status: "todo",
    dueAt: null,
    plannedStartAt: null,
    completedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    steps: [],
    ...overrides,
  };
}

function assignment(overrides = {}) {
  return {
    id: "assignment:base",
    sourceId: null,
    courseId: null,
    externalId: null,
    title: "기본 과제",
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
    ...overrides,
  };
}

function focus(taskId, status = "running") {
  return {
    id: `focus:${status}`,
    taskId,
    startedAt: now.toISOString(),
    endedAt: null,
    plannedMinutes: 30,
    elapsedSeconds: 300,
    status,
    lastResumedAt: now.toISOString(),
    pauseCount: status === "paused" ? 1 : 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function event(startHours, endHours = startHours + 1, overrides = {}) {
  return {
    id: `event:${startHours}`,
    origin: "event",
    recurringRuleId: null,
    exceptionId: null,
    semesterId: null,
    sourceId: null,
    courseId: null,
    externalId: null,
    eventType: "class",
    title: "고정 수업",
    startAt: iso(startHours),
    endAt: iso(endHours),
    location: null,
    isFixed: true,
    notes: null,
    timeKind: "date_time",
    startOn: null,
    endOnExclusive: null,
    sourceTimezone: null,
    ...overrides,
  };
}

function decide(tasks, options = {}) {
  return evaluateDecision({
    candidates: buildDecisionCandidates(tasks, options.assignments ?? []),
    schedule: options.schedule ?? [],
    activeFocus: options.activeFocus ?? null,
    currentCandidateId: options.currentCandidateId ?? null,
    now,
  });
}

const urgent = task({ id: "urgent", title: "긴급", dueAt: iso(5) });
const later = task({ id: "later", title: "나중", dueAt: iso(24 * 10) });
assert.equal(decide([later, urgent]).taskId, "urgent", "urgent task must outrank low urgency");
const priorityOnly = decide([task({ id: "priority-only", estimatedMinutes: null, priority: 100 })]);
assert.ok(priorityOnly.reasonCodes.includes("priority_high"));
assert.ok(priorityOnly.reasons.includes("높은 우선순위"), "an explicit priority contribution must remain explainable in the UI reasons");

const nextClass = event(1);
const short = task({ id: "short", estimatedMinutes: 40 });
const long = task({ id: "long", estimatedMinutes: 120 });
assert.equal(decide([long, short], { schedule: [nextClass] }).taskId, "short", "free-time fit must prefer a task that fits before the next event");
const oversized = decide([long], { schedule: [nextClass] });
assert.equal(oversized.score.freeTimeFit, 1.25, "a task far larger than the window must receive the .05 fit factor");
assert.equal(decide([short], { schedule: [event(-1, 1)] }).availableMinutes, 0, "an in-progress fixed event must block the current study window");

assert.equal(
  decide([urgent, later], { activeFocus: focus("later", "running") }).taskId,
  "later",
  "running focus must hard-lock its task",
);
assert.ok(decide([urgent, later], { activeFocus: focus("later", "running") }).reasonCodes.includes("focus_lock_running"));
assert.equal(
  decide([urgent, later], { activeFocus: focus("later", "paused") }).taskId,
  "later",
  "paused focus must hard-lock its task",
);
assert.ok(decide([urgent, later], { activeFocus: focus("later", "paused") }).reasonCodes.includes("focus_lock_paused"));

const incumbent = task({ id: "incumbent", priority: 50 });
const smallChallenger = task({ id: "small-challenger", priority: 80 });
assert.equal(
  decide([incumbent, smallChallenger], { currentCandidateId: "task:incumbent" }).taskId,
  "incumbent",
  "challenger below the 8 point threshold must not replace a valid recommendation",
);
const largeChallenger = task({ id: "large-challenger", priority: 100 });
assert.equal(
  decide([incumbent, largeChallenger], { currentCandidateId: "task:incumbent" }).taskId,
  "large-challenger",
  "challenger at least 8 points higher must replace the incumbent",
);

const tieLate = task({ id: "z", dueAt: iso(20), createdAt: "2026-09-01T00:00:00.000Z" });
const tieEarly = task({ id: "a", dueAt: iso(10), createdAt: "2026-09-10T00:00:00.000Z" });
assert.equal(decide([tieLate, tieEarly]).taskId, "a", "due time must be the first deterministic tie-break");
const stableZ = task({ id: "z", createdAt: "2026-09-01T00:00:00.000Z" });
const stableA = task({ id: "a", createdAt: "2026-09-01T00:00:00.000Z" });
assert.equal(decide([stableZ, stableA]).taskId, "a", "stable id must make final ties deterministic");

const linked = assignment({ id: "linked" });
const virtual = assignment({ id: "virtual", dueAt: iso(4) });
const candidates = buildDecisionCandidates([task({ id: "linked-task", assignmentId: "linked" })], [linked, virtual]);
assert.deepEqual(candidates.filter((candidate) => candidate.kind === "assignment").map((candidate) => candidate.assignmentId), ["virtual"]);
assert.equal(decide([], { assignments: [virtual] }).kind, "assignment", "unlinked open Assignment must remain a virtual candidate");

const virtualRecommendation = decide([], { assignments: [virtual] });
let savedInput = null;
const materialized = await materializeDecisionTask(virtualRecommendation, {
  assignments: { get: async () => virtual },
  tasks: {
    get: async () => null,
    createExecutableForAssignment: async (input) => {
      savedInput = input;
      return task({ id: "lazy-task", ...input, steps: [] });
    },
  },
});
assert.equal(materialized.assignmentId, "virtual");
assert.equal(savedInput.assignmentId, "virtual", "Assignment Start must lazily create a linked StudyTask");

const prepare = decide([urgent], { schedule: [event(14 / 60)] });
assert.equal(prepare.kind, "prepare_next_event");
assert.equal(prepare.focusable, false, "prepare recommendation must be non-focusable");

const dateCandidate = buildDecisionCandidates([], [assignment({
  id: "date-only",
  dueOn: "2026-09-14",
  dueTimezone: "Asia/Seoul",
})])[0];
assert.equal(
  resolveCandidateDueAt(dateCandidate),
  "2026-09-14T14:59:59.999Z",
  "DATE-only deadline must resolve to end-of-day in its source timezone, not UTC midnight",
);

const lastSafeStart = calculateLastSafeStart({
  now,
  deadline: iso(14),
  estimatedMinutes: 120,
  schedule: [event(10, 11), event(12, 13)],
});
assert.equal(lastSafeStart.status, "scheduled");
assert.equal(lastSafeStart.startAt, iso(9 + 40 / 60), "Last Safe Start must work backward through usable fixed-schedule gaps");
assert.equal(calculateLastSafeStart({ now, deadline: iso(4), estimatedMinutes: null, schedule: [] }), null);
assert.equal(calculateLastSafeStart({ now, deadline: null, estimatedMinutes: 30, schedule: [] }), null);

console.log(JSON.stringify({
  urgentVsLowUrgency: true,
  nextEventFit: true,
  oversizedTask: true,
  focusLocks: ["running", "paused"],
  hysteresisPoints: 8,
  deterministicTieBreak: true,
  assignmentVirtualCandidate: true,
  assignmentLazyCreation: true,
  prepareNextEvent: true,
  dateOnlyTimezoneSemantics: true,
  lastSafeStart: true,
  missingEstimateOrDeadline: true,
}, null, 2));
