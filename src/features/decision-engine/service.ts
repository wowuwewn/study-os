import type {
  AssignmentRepository,
  DecisionStateRepository,
  FocusSessionRepository,
  StudyTaskRepository,
} from "../../data/repositories/contracts";
import {
  assignmentRepository,
  decisionStateRepository,
  focusSessionRepository,
  studyTaskRepository,
} from "../../data/repositories";
import type { DecisionResult } from "../../domain/models";
import { listScheduleOccurrencesBetween } from "../schedule/service";
import {
  buildDecisionCandidates,
  calculateLastSafeStart,
  evaluateDecision,
  resolveCandidateDueAt,
} from "./scoring";
import { materializeDecisionTask as materializeWithDependencies } from "./materialize";

const INITIAL_SCHEDULE_HORIZON_DAYS = 8;

type DecisionDependencies = {
  assignments: AssignmentRepository;
  decisionState: DecisionStateRepository;
  focusSessions: FocusSessionRepository;
  tasks: StudyTaskRepository;
  listSchedule: typeof listScheduleOccurrencesBetween;
};

const defaultDependencies: DecisionDependencies = {
  assignments: assignmentRepository,
  decisionState: decisionStateRepository,
  focusSessions: focusSessionRepository,
  tasks: studyTaskRepository,
  listSchedule: listScheduleOccurrencesBetween,
};

export async function loadDecisionResult(
  now = new Date(),
  dependencies: DecisionDependencies = defaultDependencies,
): Promise<DecisionResult | null> {
  const [tasks, assignments, activeFocus, currentCandidateId] = await Promise.all([
    dependencies.tasks.listOpen(),
    dependencies.assignments.listOpen(),
    dependencies.focusSessions.getActive(),
    dependencies.decisionState.getCurrentCandidateId(),
  ]);
  if (activeFocus?.taskId && !tasks.some((task) => task.id === activeFocus.taskId)) {
    const lockedTask = await dependencies.tasks.get(activeFocus.taskId);
    if (lockedTask) tasks.push(lockedTask);
  }

  const candidates = buildDecisionCandidates(tasks, assignments);
  const scheduleStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const initialEnd = new Date(now.getTime() + INITIAL_SCHEDULE_HORIZON_DAYS * 86_400_000);
  const schedule = await dependencies.listSchedule(scheduleStart.toISOString(), initialEnd.toISOString());
  let result = evaluateDecision({ candidates, schedule, activeFocus, currentCandidateId, now });

  const deadline = result && resolveCandidateDueAt(result);
  if (
    result
    && deadline
    && result.estimatedMinutes != null
    && Date.parse(deadline) > initialEnd.getTime()
  ) {
    const extendedSchedule = await dependencies.listSchedule(
      scheduleStart.toISOString(),
      new Date(Date.parse(deadline) + 1).toISOString(),
    );
    result = {
      ...result,
      lastSafeStart: calculateLastSafeStart({
        now,
        deadline,
        estimatedMinutes: result.estimatedMinutes,
        steps: result.steps,
        focusElapsedSeconds: activeFocus?.taskId === result.taskId
          ? activeFocus.elapsedSeconds
          : undefined,
        schedule: extendedSchedule,
      }),
    };
  }

  const nextCandidateId = result?.candidateId ?? null;
  if (nextCandidateId !== currentCandidateId) {
    await dependencies.decisionState.setCurrentCandidateId(nextCandidateId);
  }
  return result;
}

export async function materializeDecisionTask(
  recommendation: DecisionResult,
): ReturnType<typeof materializeWithDependencies> {
  return materializeWithDependencies(recommendation, {
    assignments: assignmentRepository,
    tasks: studyTaskRepository,
  });
}
