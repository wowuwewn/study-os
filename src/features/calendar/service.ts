import { initializeStudyDatabase } from "../../data/db/client";
import { assignmentRepository } from "../../data/repositories";
import type { Assignment, ScheduleOccurrence } from "../../domain/models";
import { listScheduleOccurrencesBetween } from "../schedule/service";
import { filterAssignmentsFrom, type CalendarRange } from "./model";

export type CalendarRangeData = {
  occurrences: ScheduleOccurrence[];
  assignments: Assignment[];
};

export async function loadCalendarRange(range: CalendarRange): Promise<CalendarRangeData> {
  await initializeStudyDatabase();
  const [occurrences, openAssignments] = await Promise.all([
    listScheduleOccurrencesBetween(range.startAt, range.endAt),
    assignmentRepository.listOpen(),
  ]);
  return {
    occurrences,
    assignments: filterAssignmentsFrom(openAssignments, range),
  };
}
