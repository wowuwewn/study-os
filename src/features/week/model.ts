import type { Assignment, ScheduleOccurrence, StudyTask } from "../../domain/models";
import { assignmentDateKey, localDateKey, occurrenceDateKeys } from "../calendar/model.ts";

export type WeekRange = {
  start: Date;
  end: Date;
  startAt: string;
  endAt: string;
};

export type WeekItem = {
  id: string;
  kind: "occurrence" | "assignment" | "task";
  title: string;
  timeLabel: string;
  sortAt: string;
};

export type WeekDay = {
  dateKey: string;
  date: Date;
  isToday: boolean;
  items: WeekItem[];
};

export function startOfLocalWeek(value: Date): Date {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

export function getLocalWeekRange(anchor: Date): WeekRange {
  const start = startOfLocalWeek(anchor);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end, startAt: start.toISOString(), endAt: end.toISOString() };
}

function localTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function inRange(dateKey: string, startKey: string, endKey: string) {
  return dateKey >= startKey && dateKey < endKey;
}

export function buildWeekDays(input: {
  anchor: Date;
  now: Date;
  occurrences: ScheduleOccurrence[];
  assignments: Assignment[];
  tasks: StudyTask[];
}): WeekDay[] {
  const range = getLocalWeekRange(input.anchor);
  const startKey = localDateKey(range.start);
  const endKey = localDateKey(range.end);
  const todayKey = localDateKey(input.now);
  const itemsByDate = new Map<string, WeekItem[]>();
  const push = (dateKey: string, item: WeekItem) => {
    if (!inRange(dateKey, startKey, endKey)) return;
    itemsByDate.set(dateKey, [...(itemsByDate.get(dateKey) ?? []), item]);
  };

  for (const occurrence of input.occurrences) {
    for (const dateKey of occurrenceDateKeys(occurrence)) {
      push(dateKey, {
        id: `occurrence:${occurrence.id}:${dateKey}`,
        kind: "occurrence",
        title: occurrence.title,
        timeLabel: occurrence.timeKind === "date" ? "종일" : localTime(occurrence.startAt),
        sortAt: occurrence.timeKind === "date" ? `${dateKey}T00:00:00` : occurrence.startAt,
      });
    }
  }

  const linkedAssignmentIds = new Set(
    input.tasks.flatMap((task) => task.assignmentId ? [task.assignmentId] : []),
  );
  for (const assignment of input.assignments) {
    if (linkedAssignmentIds.has(assignment.id)) continue;
    const dateKey = assignmentDateKey(assignment);
    if (!dateKey) continue;
    push(dateKey, {
      id: `assignment:${assignment.id}`,
      kind: "assignment",
      title: assignment.title,
      timeLabel: assignment.dueAt ? localTime(assignment.dueAt) : "마감",
      sortAt: assignment.dueAt ?? `${dateKey}T23:59:59`,
    });
  }

  for (const task of input.tasks) {
    if (!task.dueAt) continue;
    const dateKey = localDateKey(new Date(task.dueAt));
    push(dateKey, {
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      timeLabel: localTime(task.dueAt),
      sortAt: task.dueAt,
    });
  }

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(range.start);
    date.setDate(date.getDate() + index);
    const dateKey = localDateKey(date);
    return {
      dateKey,
      date,
      isToday: dateKey === todayKey,
      items: (itemsByDate.get(dateKey) ?? []).sort((left, right) => (
        Date.parse(left.sortAt) - Date.parse(right.sortAt) || left.title.localeCompare(right.title)
      )),
    };
  });
}
