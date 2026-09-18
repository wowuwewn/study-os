import { initializeStudyDatabase } from "../../data/db/client";
import {
  assignmentRepository,
  focusSessionRepository,
  studyTaskRepository,
} from "../../data/repositories";
import { buildFocusStats, type FocusStats } from "../focus-stats/model";
import { listScheduleOccurrencesBetween } from "../schedule/service";
import { buildWeekDays, getLocalWeekRange, type WeekDay } from "./model";

export type WeekSurfaceData = {
  days: WeekDay[];
  stats: FocusStats;
};

export async function loadWeekSurface(anchor: Date, now = new Date()): Promise<WeekSurfaceData> {
  await initializeStudyDatabase();
  const displayRange = getLocalWeekRange(anchor);
  const statsRange = getLocalWeekRange(now);
  const [occurrences, assignments, tasks, intervals] = await Promise.all([
    listScheduleOccurrencesBetween(displayRange.startAt, displayRange.endAt),
    assignmentRepository.listOpen(),
    studyTaskRepository.listOpen(),
    focusSessionRepository.listIntervalsBetween(statsRange.startAt, statsRange.endAt),
  ]);
  return {
    days: buildWeekDays({ anchor, now, occurrences, assignments, tasks }),
    stats: buildFocusStats(intervals, now),
  };
}
