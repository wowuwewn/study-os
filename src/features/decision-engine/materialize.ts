import type {
  AssignmentRepository,
  StudyTaskRepository,
} from "../../data/repositories/contracts";
import type { DecisionResult, StudyTask } from "../../domain/models";
import { resolveCandidateDueAt } from "./scoring.ts";

export type MaterializeDependencies = {
  assignments: Pick<AssignmentRepository, "get">;
  tasks: Pick<StudyTaskRepository, "createExecutableForAssignment" | "get">;
};

export async function materializeDecisionTask(
  recommendation: DecisionResult,
  dependencies: MaterializeDependencies,
): Promise<StudyTask> {
  if (!recommendation.focusable) throw new Error("Recommendation is not focusable");
  if (recommendation.taskId) {
    const task = await dependencies.tasks.get(recommendation.taskId);
    if (!task) throw new Error("Recommended task no longer exists");
    return task;
  }
  if (!recommendation.assignmentId) throw new Error("Recommendation has no executable source");

  const assignment = await dependencies.assignments.get(recommendation.assignmentId);
  if (!assignment || assignment.status !== "open") {
    throw new Error("Recommended assignment is no longer open");
  }
  return dependencies.tasks.createExecutableForAssignment({
    sourceId: assignment.sourceId,
    courseId: assignment.courseId,
    assignmentId: assignment.id,
    title: assignment.title,
    notes: assignment.description,
    estimatedMinutes: null,
    priority: 50,
    status: "todo",
    dueAt: resolveCandidateDueAt(recommendation),
    plannedStartAt: null,
    completedAt: null,
  });
}
