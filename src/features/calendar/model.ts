import type { Assignment, ScheduleOccurrence } from "../../domain/models";

export type CalendarRange = {
  startAt: string;
  endAt: string;
  startsOn: string;
  endsOnExclusive: string;
};

export type CalendarDay = {
  dateKey: string;
  day: number;
};

export type CalendarRow = {
  id: string;
  kind: "occurrence" | "assignment";
  dateKey: string;
  title: string;
  sortAt: string;
  timeKind: "date_time" | "date";
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function dateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addLocalDays(value: string, days: number): string {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function monthRange(year: number, month: number): CalendarRange {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    startsOn: localDateKey(start),
    endsOnExclusive: localDateKey(end),
  };
}

export function monthDays(year: number, month: number): Array<CalendarDay | null> {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  return [
    ...Array<null>(first.getDay()).fill(null),
    ...Array.from({ length: days }, (_, index) => ({
      dateKey: `${year}-${pad(month + 1)}-${pad(index + 1)}`,
      day: index + 1,
    })),
  ];
}

export function assignmentDateKey(assignment: Assignment): string | null {
  if (assignment.dueOn) return assignment.dueOn;
  return assignment.dueAt ? localDateKey(new Date(assignment.dueAt)) : null;
}

export function filterAssignmentsFrom(
  assignments: Assignment[],
  range: Pick<CalendarRange, "startAt" | "startsOn">,
): Assignment[] {
  const start = Date.parse(range.startAt);
  return assignments.filter((assignment) => {
    if (assignment.dueOn) return assignment.dueOn >= range.startsOn;
    if (!assignment.dueAt) return false;
    return Date.parse(assignment.dueAt) >= start;
  });
}

export function occurrenceDateKeys(occurrence: ScheduleOccurrence): string[] {
  if (occurrence.timeKind !== "date" || !occurrence.startOn) {
    return [localDateKey(new Date(occurrence.startAt))];
  }

  const keys: string[] = [];
  const end = occurrence.endOnExclusive ?? addLocalDays(occurrence.startOn, 1);
  for (let date = occurrence.startOn; date < end; date = addLocalDays(date, 1)) {
    keys.push(date);
  }
  return keys;
}

export function calendarRowsForDate(
  dateKey: string,
  occurrences: ScheduleOccurrence[],
  assignments: Assignment[],
): CalendarRow[] {
  const rows: CalendarRow[] = [];
  for (const occurrence of occurrences) {
    if (!occurrenceDateKeys(occurrence).includes(dateKey)) continue;
    rows.push({
      id: occurrence.id,
      kind: "occurrence",
      dateKey,
      title: occurrence.title,
      sortAt: occurrence.timeKind === "date" ? `${dateKey}T00:00:00` : occurrence.startAt,
      timeKind: occurrence.timeKind,
    });
  }
  for (const assignment of assignments) {
    const dueDate = assignmentDateKey(assignment);
    if (dueDate !== dateKey) continue;
    rows.push({
      id: assignment.id,
      kind: "assignment",
      dateKey,
      title: assignment.title,
      sortAt: assignment.dueAt ?? `${dateKey}T23:59:59`,
      timeKind: assignment.dueOn ? "date" : "date_time",
    });
  }
  return rows.sort((left, right) => (
    Date.parse(left.sortAt) - Date.parse(right.sortAt) || left.title.localeCompare(right.title)
  ));
}

export function upcomingAssignmentRows(
  fromDateKey: string,
  assignments: Assignment[],
): CalendarRow[] {
  return assignments
    .flatMap((assignment): CalendarRow[] => {
      const dateKey = assignmentDateKey(assignment);
      if (!dateKey || dateKey < fromDateKey) return [];
      return [{
        id: assignment.id,
        kind: "assignment",
        dateKey,
        title: assignment.title,
        sortAt: assignment.dueAt ?? `${dateKey}T23:59:59`,
        timeKind: assignment.dueOn ? "date" : "date_time",
      }];
    })
    .sort((left, right) => (
      left.dateKey.localeCompare(right.dateKey)
      || Date.parse(left.sortAt) - Date.parse(right.sortAt)
      || left.title.localeCompare(right.title)
    ));
}
