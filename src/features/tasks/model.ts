import type { Assignment, DecisionResult, StudyTask } from "../../domain/models";
import { assignmentDateKey, localDateKey } from "../calendar/model.ts";
import { getLocalWeekRange } from "../week/model.ts";

export type TaskGroupKey = "overdue" | "today" | "this_week" | "later" | "no_deadline" | "completed";

export const TASK_GROUPS: Array<{ key: TaskGroupKey; label: string }> = [
  { key: "overdue", label: "기한 지남" },
  { key: "today", label: "오늘" },
  { key: "this_week", label: "이번 주" },
  { key: "later", label: "나중" },
  { key: "no_deadline", label: "기한 없음" },
  { key: "completed", label: "완료" },
];

export type TaskListItem = {
  id: string;
  entityId: string;
  kind: "task" | "assignment";
  title: string;
  status: StudyTask["status"] | Assignment["status"];
  group: TaskGroupKey;
  deadlineDate: string | null;
  priority: number | null;
  estimatedMinutes: number | null;
  isRecommended: boolean;
  recommendationReasons: string[];
  lastSafeStart: DecisionResult["lastSafeStart"] | null;
};

function groupForDeadline(deadlineDate: string | null, now: Date): TaskGroupKey {
  if (!deadlineDate) return "no_deadline";
  const today = localDateKey(now);
  if (deadlineDate < today) return "overdue";
  if (deadlineDate === today) return "today";
  const weekEnd = localDateKey(getLocalWeekRange(now).end);
  return deadlineDate < weekEnd ? "this_week" : "later";
}

export function buildTaskList(input: {
  tasks: StudyTask[];
  assignments: Assignment[];
  recommendation: DecisionResult | null;
  now: Date;
}): TaskListItem[] {
  const openLinkedAssignmentIds = new Set(
    input.tasks
      .filter((task) => ["todo", "doing", "paused"].includes(task.status))
      .flatMap((task) => task.assignmentId ? [task.assignmentId] : []),
  );
  const taskItems = input.tasks.map((task): TaskListItem => {
    const deadlineDate = task.dueAt ? localDateKey(new Date(task.dueAt)) : null;
    const isCompleted = task.status === "done" || task.status === "cancelled";
    const isRecommended = input.recommendation?.candidateId === `task:${task.id}`;
    return {
      id: `task:${task.id}`,
      entityId: task.id,
      kind: "task",
      title: task.title,
      status: task.status,
      group: isCompleted ? "completed" : groupForDeadline(deadlineDate, input.now),
      deadlineDate,
      priority: task.priority,
      estimatedMinutes: task.estimatedMinutes,
      isRecommended,
      recommendationReasons: isRecommended ? input.recommendation?.reasons ?? [] : [],
      lastSafeStart: isRecommended ? input.recommendation?.lastSafeStart ?? null : null,
    };
  });
  const assignmentItems = input.assignments
    .filter((assignment) => !openLinkedAssignmentIds.has(assignment.id))
    .map((assignment): TaskListItem => {
      const deadlineDate = assignmentDateKey(assignment);
      const isRecommended = input.recommendation?.candidateId === `assignment:${assignment.id}`;
      return {
        id: `assignment:${assignment.id}`,
        entityId: assignment.id,
        kind: "assignment",
        title: assignment.title,
        status: assignment.status,
        group: groupForDeadline(deadlineDate, input.now),
        deadlineDate,
        priority: null,
        estimatedMinutes: null,
        isRecommended,
        recommendationReasons: isRecommended ? input.recommendation?.reasons ?? [] : [],
        lastSafeStart: isRecommended ? input.recommendation?.lastSafeStart ?? null : null,
      };
    });
  return [...taskItems, ...assignmentItems].sort((left, right) => (
    Number(right.isRecommended) - Number(left.isRecommended)
    || (left.deadlineDate ?? "9999-12-31").localeCompare(right.deadlineDate ?? "9999-12-31")
    || (right.priority ?? -1) - (left.priority ?? -1)
    || left.title.localeCompare(right.title)
  ));
}
