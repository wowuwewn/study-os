import { initializeStudyDatabase } from "../../data/db/client";
import {
  courseRepository,
  eventRepository,
  recurringScheduleRepository,
  scheduleExceptionRepository,
  semesterRepository,
  sourceRepository,
} from "../../data/repositories";
import type { ScheduleOccurrence } from "../../domain/models";
import { buildScheduleOccurrences } from "./occurrences";
import { importSemesterSchedule } from "./import";
import { getSystemLocalDayRange } from "./timezone";

export async function importLocalSemesterSchedule(value: unknown) {
  await initializeStudyDatabase();
  return importSemesterSchedule(value, {
    sources: sourceRepository,
    courses: courseRepository,
    semesters: semesterRepository,
    rules: recurringScheduleRepository,
  });
}

export async function importLocalSemesterScheduleJson(json: string) {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Schedule import is not valid JSON");
  }
  return importLocalSemesterSchedule(value);
}

export async function listScheduleOccurrencesBetween(
  startAt: string,
  endAt: string,
): Promise<ScheduleOccurrence[]> {
  await initializeStudyDatabase();
  const [events, semesters, courses, rules, exceptions] = await Promise.all([
    eventRepository.listBetween(startAt, endAt),
    semesterRepository.list(),
    courseRepository.list(),
    recurringScheduleRepository.list(),
    scheduleExceptionRepository.list(),
  ]);
  return buildScheduleOccurrences({ events, semesters, courses, rules, exceptions, startAt, endAt });
}

export async function listTodaySchedule(now = new Date()): Promise<ScheduleOccurrence[]> {
  const range = getSystemLocalDayRange(now);
  return listScheduleOccurrencesBetween(range.startAt, range.endAt);
}
