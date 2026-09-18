import type {
  Assignment,
  DecisionReasonCode,
  DecisionResult,
  DecisionScore,
  FocusSession,
  LastSafeStart,
  ScheduleOccurrence,
  StudyTask,
  StudyTaskStatus,
  TaskStep,
} from "../../domain/models.ts";
import { addCalendarDays, zonedDateTimeToUtc } from "../schedule/timezone.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const FREE_TIME_BUFFER_MINUTES = 10;
const PREPARE_THRESHOLD_MINUTES = 15;
const HYSTERESIS_POINTS = 8;

export type DecisionCandidate = {
  candidateId: string;
  kind: "task" | "assignment";
  taskId: string | null;
  assignmentId: string | null;
  title: string;
  notes: string | null;
  estimatedMinutes: number | null;
  priority: number | null;
  status: StudyTaskStatus | null;
  dueAt: string | null;
  dueOn: string | null;
  dueTimezone: string | null;
  createdAt: string;
  steps: TaskStep[];
};

export type EvaluateDecisionInput = {
  candidates: DecisionCandidate[];
  schedule: ScheduleOccurrence[];
  activeFocus: FocusSession | null;
  currentCandidateId: string | null;
  now: Date;
};

export function buildDecisionCandidates(
  tasks: StudyTask[],
  assignments: Assignment[],
): DecisionCandidate[] {
  const linkedAssignmentIds = new Set(
    tasks.flatMap((task) => task.assignmentId ? [task.assignmentId] : []),
  );
  const taskCandidates: DecisionCandidate[] = tasks.map((task) => ({
    candidateId: `task:${task.id}`,
    kind: "task",
    taskId: task.id,
    assignmentId: task.assignmentId,
    title: task.title,
    notes: task.notes,
    estimatedMinutes: task.estimatedMinutes,
    priority: task.priority,
    status: task.status,
    dueAt: task.dueAt,
    dueOn: null,
    dueTimezone: null,
    createdAt: task.createdAt,
    steps: task.steps,
  }));
  const assignmentCandidates: DecisionCandidate[] = assignments
    .filter((assignment) => !linkedAssignmentIds.has(assignment.id))
    .map((assignment) => ({
      candidateId: `assignment:${assignment.id}`,
      kind: "assignment",
      taskId: null,
      assignmentId: assignment.id,
      title: assignment.title,
      notes: assignment.description,
      estimatedMinutes: null,
      priority: null,
      status: null,
      dueAt: assignment.dueAt,
      dueOn: assignment.dueOn,
      dueTimezone: assignment.dueTimezone,
      createdAt: assignment.createdAt,
      steps: [],
    }));
  return [...taskCandidates, ...assignmentCandidates];
}

export function resolveCandidateDueAt(candidate: Pick<DecisionCandidate, "dueAt" | "dueOn" | "dueTimezone">): string | null {
  if (candidate.dueAt) return candidate.dueAt;
  if (!candidate.dueOn || !candidate.dueTimezone) return null;
  const nextDayStart = zonedDateTimeToUtc(
    addCalendarDays(candidate.dueOn, 1),
    "00:00",
    candidate.dueTimezone,
  );
  return new Date(Date.parse(nextDayStart) - 1).toISOString();
}

function urgencyFactor(dueAt: string | null, nowMs: number): { factor: number; code: DecisionReasonCode } {
  if (!dueAt) return { factor: 0.1, code: "no_due" };
  const remaining = Date.parse(dueAt) - nowMs;
  if (remaining < 0) return { factor: 1, code: "overdue" };
  if (remaining <= 6 * HOUR) return { factor: 0.95, code: "due_within_6h" };
  if (remaining <= DAY) return { factor: 0.85, code: "due_within_24h" };
  if (remaining <= 3 * DAY) return { factor: 0.65, code: "due_within_3d" };
  if (remaining <= 7 * DAY) return { factor: 0.4, code: "due_within_7d" };
  return { factor: 0.2, code: "due_later" };
}

function fitFactor(
  estimate: number | null,
  availableMinutes: number | null,
): { factor: number; code: DecisionReasonCode } {
  const available = availableMinutes ?? Number.POSITIVE_INFINITY;
  if (estimate != null) {
    if (estimate <= available) return { factor: 1, code: "fits_window" };
    if (estimate <= available * 1.25) return { factor: 0.4, code: "slightly_over_window" };
    return { factor: 0.05, code: "too_large_for_window" };
  }
  if (available >= 45) return { factor: 0.55, code: "estimate_unknown_long_window" };
  if (available >= 20) return { factor: 0.3, code: "estimate_unknown_medium_window" };
  return { factor: 0.05, code: "estimate_unknown_short_window" };
}

export function normalizePriority(priority: number | null): number {
  if (priority == null || !Number.isFinite(priority)) return 0.5;
  return Math.min(1, Math.max(0, priority / 100));
}

function continuityFactor(candidate: DecisionCandidate): {
  factor: number;
  codes: DecisionReasonCode[];
} {
  const codes: DecisionReasonCode[] = [];
  let factor = 0;
  if (candidate.status === "doing") {
    factor = 0.7;
    codes.push("continuity_doing");
  } else if (candidate.status === "paused") {
    factor = 0.65;
    codes.push("continuity_paused");
  }
  if (candidate.steps.length > 0) {
    const completed = candidate.steps.filter((step) => step.isCompleted).length;
    if (completed > 0) {
      factor = Math.max(factor, 0.35) + (completed / candidate.steps.length) * 0.3;
      codes.push("checklist_progress");
    }
  }
  return { factor: Math.min(1, factor), codes };
}

function nextFixedEvent(schedule: ScheduleOccurrence[], nowMs: number): ScheduleOccurrence | null {
  return schedule.find((event) => event.isFixed && Date.parse(event.startAt) > nowMs) ?? null;
}

function availableMinutesUntil(
  event: ScheduleOccurrence | null,
  schedule: ScheduleOccurrence[],
  nowMs: number,
): number | null {
  const currentlyBusy = schedule.some((item) => {
    if (!item.isFixed) return false;
    const interval = intervalForOccurrence(item);
    return interval.start <= nowMs && interval.end > nowMs;
  });
  if (currentlyBusy) return 0;
  if (!event) return null;
  return Math.max(0, Math.floor((Date.parse(event.startAt) - nowMs) / MINUTE) - FREE_TIME_BUFFER_MINUTES);
}

function scoreCandidate(
  candidate: DecisionCandidate,
  availableMinutes: number | null,
  nowMs: number,
): { score: DecisionScore; reasonCodes: DecisionReasonCode[] } {
  const urgency = urgencyFactor(resolveCandidateDueAt(candidate), nowMs);
  const fit = fitFactor(candidate.estimatedMinutes, availableMinutes);
  const priority = normalizePriority(candidate.priority);
  const continuity = continuityFactor(candidate);
  const score = {
    urgency: urgency.factor * 45,
    freeTimeFit: fit.factor * 25,
    priority: priority * 20,
    continuity: continuity.factor * 10,
    raw: 0,
  };
  score.raw = score.urgency + score.freeTimeFit + score.priority + score.continuity;
  return {
    score,
    reasonCodes: [
      urgency.code,
      fit.code,
      candidate.priority == null
        ? "priority_missing"
        : priority >= 0.75
          ? "priority_high"
          : priority >= 0.5
            ? "priority_medium"
            : "priority_low",
      ...(candidate.kind === "assignment" ? ["assignment_without_task" as const] : []),
      ...continuity.codes,
    ],
  };
}

function tieBreak(
  left: DecisionCandidate,
  right: DecisionCandidate,
  availableMinutes: number | null,
): number {
  const leftDue = resolveCandidateDueAt(left);
  const rightDue = resolveCandidateDueAt(right);
  if (leftDue !== rightDue) {
    if (!leftDue) return 1;
    if (!rightDue) return -1;
    const dueOrder = Date.parse(leftDue) - Date.parse(rightDue);
    if (dueOrder !== 0) return dueOrder;
  }
  const priorityOrder = normalizePriority(right.priority) - normalizePriority(left.priority);
  if (priorityOrder !== 0) return priorityOrder;
  const available = availableMinutes ?? Number.POSITIVE_INFINITY;
  const leftEstimate = left.estimatedMinutes != null && left.estimatedMinutes <= available
    ? left.estimatedMinutes
    : Number.POSITIVE_INFINITY;
  const rightEstimate = right.estimatedMinutes != null && right.estimatedMinutes <= available
    ? right.estimatedMinutes
    : Number.POSITIVE_INFINITY;
  if (leftEstimate !== rightEstimate) return leftEstimate - rightEstimate;
  const createdOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (createdOrder !== 0) return createdOrder;
  return left.candidateId.localeCompare(right.candidateId);
}

function formatDueReason(dueAt: string | null, nowMs: number): string | null {
  if (!dueAt) return null;
  const remaining = Date.parse(dueAt) - nowMs;
  if (remaining < 0) return "마감이 지났어요";
  const hours = Math.max(1, Math.ceil(remaining / HOUR));
  return hours <= 48 ? `마감 ${hours}시간 남음` : `마감 ${Math.ceil(hours / 24)}일 남음`;
}

function displayReasons(
  candidate: DecisionCandidate,
  dueAt: string | null,
  nextEvent: ScheduleOccurrence | null,
  nowMs: number,
  focusCode: DecisionReasonCode | null,
): string[] {
  const reasons: string[] = [];
  if (focusCode) reasons.push("진행 중인 작업 이어서");
  const dueReason = formatDueReason(dueAt, nowMs);
  if (dueReason) reasons.push(dueReason);
  if (nextEvent) {
    const minutes = Math.max(0, Math.floor((Date.parse(nextEvent.startAt) - nowMs) / MINUTE));
    reasons.push(`${nextEvent.eventType === "class" ? "다음 수업" : "다음 일정"}까지 ${minutes}분`);
  }
  if (candidate.estimatedMinutes != null) reasons.push(`예상 ${candidate.estimatedMinutes}분`);
  if (!focusCode && (candidate.status === "doing" || candidate.status === "paused")) {
    reasons.push("진행 중인 작업 이어서");
  }
  if (candidate.priority != null) {
    reasons.push(normalizePriority(candidate.priority) >= 0.75 ? "높은 우선순위" : "설정한 우선순위 반영");
  }
  if (candidate.kind === "assignment") reasons.push("연결할 실행 작업이 필요해요");
  return [...new Set(reasons)].slice(0, 3);
}

function intervalForOccurrence(event: ScheduleOccurrence): { start: number; end: number } {
  if (event.timeKind === "date" && event.startOn && event.sourceTimezone) {
    const start = Date.parse(zonedDateTimeToUtc(event.startOn, "00:00", event.sourceTimezone));
    const endOn = event.endOnExclusive ?? addCalendarDays(event.startOn, 1);
    const end = Date.parse(zonedDateTimeToUtc(endOn, "00:00", event.sourceTimezone));
    return { start: start - FREE_TIME_BUFFER_MINUTES * MINUTE, end };
  }
  const start = Date.parse(event.startAt) - FREE_TIME_BUFFER_MINUTES * MINUTE;
  return { start, end: event.endAt ? Date.parse(event.endAt) : Date.parse(event.startAt) };
}

export function calculateLastSafeStart(input: {
  now: Date;
  deadline: string | null;
  estimatedMinutes: number | null;
  steps?: TaskStep[];
  focusElapsedSeconds?: number;
  schedule: ScheduleOccurrence[];
}): LastSafeStart | null {
  if (!input.deadline || input.estimatedMinutes == null) return null;
  const nowMs = input.now.getTime();
  const deadlineMs = Date.parse(input.deadline);
  if (!Number.isFinite(deadlineMs)) return null;

  const stepProgress = input.steps?.length
    ? input.steps.filter((step) => step.isCompleted).length / input.steps.length
    : 0;
  const elapsedProgress = Math.min(1, Math.max(0, (input.focusElapsedSeconds ?? 0) / (input.estimatedMinutes * 60)));
  const progress = Math.max(stepProgress, elapsedProgress);
  const remainingMinutes = Math.max(0, Math.ceil(input.estimatedMinutes * (1 - progress)));
  if (deadlineMs <= nowMs) {
    return { status: "at_risk", startAt: null, remainingMinutes, availableMinutes: 0 };
  }

  const busy = input.schedule
    .filter((event) => event.isFixed)
    .map(intervalForOccurrence)
    .map((interval) => ({
      start: Math.max(nowMs, interval.start),
      end: Math.min(deadlineMs, interval.end),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of busy) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }

  const free: Array<{ start: number; end: number }> = [];
  let cursor = nowMs;
  for (const interval of merged) {
    if (interval.start > cursor) free.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < deadlineMs) free.push({ start: cursor, end: deadlineMs });
  const availableMinutes = Math.max(0, Math.floor(
    free.reduce((total, interval) => total + interval.end - interval.start, 0) / MINUTE,
  ));

  let remainingMs = remainingMinutes * MINUTE;
  for (let index = free.length - 1; index >= 0; index -= 1) {
    const interval = free[index];
    const duration = interval.end - interval.start;
    if (duration >= remainingMs) {
      return {
        status: "scheduled",
        startAt: new Date(interval.end - remainingMs).toISOString(),
        remainingMinutes,
        availableMinutes,
      };
    }
    remainingMs -= duration;
  }
  return { status: "at_risk", startAt: null, remainingMinutes, availableMinutes };
}

function nextLocalMidnight(now: Date): number {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

function nextRecalculationAt(
  now: Date,
  nextEvent: ScheduleOccurrence | null,
  schedule: ScheduleOccurrence[],
): string {
  const nowMs = now.getTime();
  const boundaries = [nowMs + 5 * MINUTE, nextLocalMidnight(now)];
  if (nextEvent) {
    const eventStart = Date.parse(nextEvent.startAt);
    if (eventStart > nowMs) boundaries.push(eventStart);
    if (eventStart - PREPARE_THRESHOLD_MINUTES * MINUTE >= nowMs) {
      boundaries.push(eventStart - PREPARE_THRESHOLD_MINUTES * MINUTE + 1_000);
    }
  }
  for (const item of schedule) {
    if (!item.isFixed) continue;
    const end = intervalForOccurrence(item).end;
    if (end > nowMs) boundaries.push(end);
  }
  return new Date(Math.min(...boundaries)).toISOString();
}

export function evaluateDecision(input: EvaluateDecisionInput): DecisionResult | null {
  const nowMs = input.now.getTime();
  const nextEvent = nextFixedEvent(input.schedule, nowMs);
  const availableMinutes = availableMinutesUntil(nextEvent, input.schedule, nowMs);
  const activeCandidate = input.activeFocus?.taskId
    ? input.candidates.find((candidate) => candidate.taskId === input.activeFocus?.taskId)
    : null;

  if (activeCandidate && input.activeFocus) {
    const focusCode: DecisionReasonCode = input.activeFocus.status === "running"
      ? "focus_lock_running"
      : "focus_lock_paused";
    const evaluated = scoreCandidate(activeCandidate, availableMinutes, nowMs);
    const dueAt = resolveCandidateDueAt(activeCandidate);
    return {
      ...activeCandidate,
      focusable: true,
      score: evaluated.score,
      reasonCodes: [focusCode, ...evaluated.reasonCodes],
      reasons: displayReasons(activeCandidate, dueAt, nextEvent, nowMs, focusCode),
      availableMinutes,
      lastSafeStart: calculateLastSafeStart({
        now: input.now,
        deadline: dueAt,
        estimatedMinutes: activeCandidate.estimatedMinutes,
        steps: activeCandidate.steps,
        focusElapsedSeconds: input.activeFocus.elapsedSeconds,
        schedule: input.schedule,
      }),
      nextRecalculationAt: null,
    };
  }

  if (nextEvent && Date.parse(nextEvent.startAt) - nowMs < PREPARE_THRESHOLD_MINUTES * MINUTE) {
    const minutes = Math.max(0, Math.floor((Date.parse(nextEvent.startAt) - nowMs) / MINUTE));
    return {
      candidateId: `prepare:${nextEvent.id}`,
      kind: "prepare_next_event",
      taskId: null,
      assignmentId: null,
      title: "다음 일정 준비하기",
      notes: nextEvent.title,
      estimatedMinutes: null,
      priority: null,
      status: null,
      dueAt: nextEvent.startAt,
      dueOn: null,
      dueTimezone: null,
      createdAt: input.now.toISOString(),
      steps: [],
      focusable: false,
      score: { raw: 0, urgency: 0, freeTimeFit: 0, priority: 0, continuity: 0 },
      reasonCodes: ["prepare_next_event"],
      reasons: [`${nextEvent.eventType === "class" ? "다음 수업" : "다음 일정"}까지 ${minutes}분`],
      availableMinutes: 0,
      lastSafeStart: null,
      nextRecalculationAt: nextRecalculationAt(input.now, nextEvent, input.schedule),
    };
  }

  const evaluated = input.candidates.map((candidate) => ({
    candidate,
    ...scoreCandidate(candidate, availableMinutes, nowMs),
  }));
  evaluated.sort((left, right) => (
    right.score.raw - left.score.raw || tieBreak(left.candidate, right.candidate, availableMinutes)
  ));
  const challenger = evaluated[0];
  if (!challenger) return null;
  const current = evaluated.find((entry) => entry.candidate.candidateId === input.currentCandidateId);
  const selected = current && challenger.score.raw < current.score.raw + HYSTERESIS_POINTS
    ? current
    : challenger;
  const dueAt = resolveCandidateDueAt(selected.candidate);
  return {
    ...selected.candidate,
    focusable: true,
    score: selected.score,
    reasonCodes: selected.reasonCodes,
    reasons: displayReasons(selected.candidate, dueAt, nextEvent, nowMs, null),
    availableMinutes,
    lastSafeStart: calculateLastSafeStart({
      now: input.now,
      deadline: dueAt,
      estimatedMinutes: selected.candidate.estimatedMinutes,
      steps: selected.candidate.steps,
      schedule: input.schedule,
    }),
    nextRecalculationAt: nextRecalculationAt(input.now, nextEvent, input.schedule),
  };
}
