import { initializeStudyDatabase } from "../../data/db/client";
import {
  assignmentRepository,
  focusSessionRepository,
  studyTaskRepository,
} from "../../data/repositories";
import type { StudyTask } from "../../domain/models";
import { loadDecisionResult } from "../decision-engine/service";
import { resolveCandidateDueAt } from "../decision-engine/scoring";
import { buildTaskList, type TaskListItem } from "./model";

export type TasksSurfaceData = {
  items: TaskListItem[];
  activeTaskId: string | null;
};

export async function loadTasksSurface(now = new Date()): Promise<TasksSurfaceData> {
  await initializeStudyDatabase();
  const [tasks, assignments, recommendation, activeFocus] = await Promise.all([
    studyTaskRepository.list(),
    assignmentRepository.listOpen(),
    loadDecisionResult(now),
    focusSessionRepository.getActive(),
  ]);
  return {
    items: buildTaskList({ tasks, assignments, recommendation, now }),
    activeTaskId: activeFocus?.taskId ?? null,
  };
}

function endOfLocalDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const end = new Date(year, month - 1, day + 1);
  return new Date(end.getTime() - 1).toISOString();
}

export async function updateTaskItem(
  item: TaskListItem,
  values: { priority: number | null; estimatedMinutes: number | null; deadlineDate: string | null },
): Promise<void> {
  await initializeStudyDatabase();
  if (item.kind === "task") {
    const task = await studyTaskRepository.get(item.entityId);
    if (!task) throw new Error("할 일을 찾을 수 없습니다.");
    await studyTaskRepository.save({
      ...task,
      priority: Math.max(0, Math.min(100, values.priority ?? task.priority)),
      estimatedMinutes: values.estimatedMinutes,
      dueAt: values.deadlineDate ? endOfLocalDate(values.deadlineDate) : null,
    });
    return;
  }
  const assignment = await assignmentRepository.get(item.entityId);
  if (!assignment) throw new Error("과제를 찾을 수 없습니다.");
  await assignmentRepository.save({
    ...assignment,
    dueAt: null,
    dueOn: values.deadlineDate,
    dueTimezone: values.deadlineDate
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : null,
  });
}

export async function setTaskItemOutcome(
  item: Pick<TaskListItem, "kind" | "entityId">,
  outcome: "complete" | "cancel",
): Promise<void> {
  await initializeStudyDatabase();
  const active = await focusSessionRepository.getActive();
  if (item.kind === "task") {
    if (active?.taskId === item.entityId) {
      throw new Error("집중 중인 할 일은 PIP에서 먼저 완료하거나 취소해 주세요.");
    }
    await studyTaskRepository.setStatus(item.entityId, outcome === "complete" ? "done" : "cancelled");
    return;
  }
  const assignment = await assignmentRepository.get(item.entityId);
  if (!assignment) throw new Error("과제를 찾을 수 없습니다.");
  const now = new Date().toISOString();
  await assignmentRepository.save({
    ...assignment,
    status: outcome === "complete" ? "submitted" : "cancelled",
    submittedAt: outcome === "complete" ? now : assignment.submittedAt,
  });
}

async function executableTaskFor(item: TaskListItem): Promise<StudyTask> {
  if (item.kind === "task") {
    const task = await studyTaskRepository.get(item.entityId);
    if (!task || !["todo", "doing", "paused"].includes(task.status)) {
      throw new Error("시작할 수 있는 할 일이 아닙니다.");
    }
    return task;
  }
  const assignment = await assignmentRepository.get(item.entityId);
  if (!assignment || assignment.status !== "open") throw new Error("시작할 수 있는 과제가 아닙니다.");
  return studyTaskRepository.createExecutableForAssignment({
    sourceId: assignment.sourceId,
    courseId: assignment.courseId,
    assignmentId: assignment.id,
    title: assignment.title,
    notes: assignment.description,
    estimatedMinutes: null,
    priority: 50,
    status: "todo",
    dueAt: resolveCandidateDueAt(assignment),
    plannedStartAt: null,
    completedAt: null,
  });
}

export async function startTaskItem(item: TaskListItem): Promise<void> {
  await initializeStudyDatabase();
  const active = await focusSessionRepository.getActive();
  if (active) {
    if (item.kind !== "task" || active.taskId !== item.entityId) {
      throw new Error("이미 진행 중인 집중 세션이 있습니다.");
    }
  }
  const task = await executableTaskFor(item);
  await focusSessionRepository.startOrResume(task, active?.elapsedSeconds ?? 0);
}
