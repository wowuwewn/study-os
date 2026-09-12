import type {
  Course,
  RecurringScheduleException,
  RecurringScheduleRule,
  ScheduleOccurrence,
  Semester,
  StudyEvent,
} from "../../domain/models";
import {
  addCalendarDays,
  dateInTimeZone,
  localTimeMinutes,
  weekdayOfDate,
  zonedDateTimeToUtc,
} from "./timezone.ts";

export type OccurrenceInput = {
  semesters: Semester[];
  courses: Course[];
  rules: RecurringScheduleRule[];
  exceptions: RecurringScheduleException[];
  events: StudyEvent[];
  startAt: string;
  endAt: string;
};

function isInRange(value: string, startAt: string, endAt: string) {
  const instant = Date.parse(value);
  return instant >= Date.parse(startAt) && instant < Date.parse(endAt);
}

function durationMinutes(rule: RecurringScheduleRule) {
  return localTimeMinutes(rule.endLocalTime) - localTimeMinutes(rule.startLocalTime);
}

function recurringOccurrence(
  rule: RecurringScheduleRule,
  semester: Semester,
  course: Course,
  occurrenceOn: string,
  exception?: RecurringScheduleException,
): ScheduleOccurrence | null {
  if (exception?.status === "cancelled") return null;

  const originalStartAt = zonedDateTimeToUtc(occurrenceOn, rule.startLocalTime, semester.timezone);
  const originalEndAt = zonedDateTimeToUtc(occurrenceOn, rule.endLocalTime, semester.timezone);
  const startAt = exception?.replacementStartAt ?? originalStartAt;
  const endAt = exception?.replacementEndAt
    ?? (exception?.replacementStartAt
      ? new Date(Date.parse(startAt) + durationMinutes(rule) * 60_000).toISOString()
      : originalEndAt);

  return {
    id: `occurrence:${rule.id}:${occurrenceOn}`,
    origin: "recurring",
    recurringRuleId: rule.id,
    exceptionId: exception?.id ?? null,
    semesterId: semester.id,
    sourceId: rule.sourceId ?? semester.sourceId,
    courseId: course.id,
    externalId: rule.externalId ? `${rule.externalId}:${occurrenceOn}` : null,
    eventType: "class",
    title: exception?.titleOverride ?? course.name,
    startAt,
    endAt,
    location: exception?.locationOverride ?? rule.location ?? course.location,
    isFixed: true,
    notes: exception?.notes ?? null,
  };
}

export function eventOccurrence(event: StudyEvent): ScheduleOccurrence {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...value } = event;
  return {
    ...value,
    origin: "event",
    recurringRuleId: null,
    exceptionId: null,
    semesterId: null,
  };
}

export function buildScheduleOccurrences(input: OccurrenceInput): ScheduleOccurrence[] {
  if (Date.parse(input.endAt) <= Date.parse(input.startAt)) {
    throw new Error("Schedule range end must be after start");
  }

  const semesterById = new Map(input.semesters.map((semester) => [semester.id, semester]));
  const courseById = new Map(input.courses.map((course) => [course.id, course]));
  const ruleById = new Map(input.rules.map((rule) => [rule.id, rule]));
  const exceptionByOccurrence = new Map(
    input.exceptions.map((exception) => [
      `${exception.recurringRuleId}:${exception.occurrenceOn}`,
      exception,
    ]),
  );
  const occurrences = input.events
    .filter((event) => isInRange(event.startAt, input.startAt, input.endAt))
    .map(eventOccurrence);
  const seen = new Set<string>();

  for (const rule of input.rules) {
    const semester = semesterById.get(rule.semesterId);
    const course = courseById.get(rule.courseId);
    if (!semester || !course) continue;

    let date = addCalendarDays(dateInTimeZone(new Date(input.startAt), semester.timezone), -1);
    const finalDate = addCalendarDays(
      dateInTimeZone(new Date(Date.parse(input.endAt) - 1), semester.timezone),
      1,
    );
    while (date <= finalDate) {
      if (date >= semester.startsOn && date <= semester.endsOn && weekdayOfDate(date) === rule.weekday) {
        const exception = exceptionByOccurrence.get(`${rule.id}:${date}`);
        const occurrence = recurringOccurrence(rule, semester, course, date, exception);
        if (occurrence && isInRange(occurrence.startAt, input.startAt, input.endAt)) {
          occurrences.push(occurrence);
          seen.add(occurrence.id);
        }
      }
      date = addCalendarDays(date, 1);
    }
  }

  // A moved class can land inside this range even when its original date is
  // outside it. Resolve those exceptions independently of the normal rule pass.
  for (const exception of input.exceptions) {
    if (!exception.replacementStartAt || !isInRange(exception.replacementStartAt, input.startAt, input.endAt)) continue;
    const rule = ruleById.get(exception.recurringRuleId);
    if (!rule) continue;
    const semester = semesterById.get(rule.semesterId);
    const course = courseById.get(rule.courseId);
    if (!semester || !course) continue;
    const occurrence = recurringOccurrence(rule, semester, course, exception.occurrenceOn, exception);
    if (occurrence && !seen.has(occurrence.id)) occurrences.push(occurrence);
  }

  return occurrences.sort(
    (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || left.title.localeCompare(right.title),
  );
}
