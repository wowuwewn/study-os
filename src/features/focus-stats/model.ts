import type { FocusInterval } from "../../domain/models";
import { localDateKey } from "../calendar/model.ts";
import { getLocalWeekRange } from "../week/model.ts";

export type FocusDayStat = {
  dateKey: string;
  label: string;
  minutes: number;
};

export type FocusStats = {
  todayMinutes: number;
  weekMinutes: number;
  weekSessionCount: number;
  days: FocusDayStat[];
};

function overlapSeconds(start: number, end: number, rangeStart: number, rangeEnd: number) {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart)) / 1000;
}

export function buildFocusStats(intervals: FocusInterval[], now: Date): FocusStats {
  const week = getLocalWeekRange(now);
  const nowMs = now.getTime();
  const sessionIds = new Set<string>();
  const secondsByDay = Array<number>(7).fill(0);

  for (const interval of intervals) {
    const start = Date.parse(interval.startedAt);
    const end = Math.min(interval.endedAt ? Date.parse(interval.endedAt) : nowMs, nowMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    let hasWeekOverlap = false;
    for (let index = 0; index < 7; index += 1) {
      const dayStart = new Date(week.start);
      dayStart.setDate(dayStart.getDate() + index);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const seconds = overlapSeconds(start, end, dayStart.getTime(), dayEnd.getTime());
      secondsByDay[index] += seconds;
      if (seconds > 0) hasWeekOverlap = true;
    }
    if (hasWeekOverlap) sessionIds.add(interval.sessionId);
  }

  const days = secondsByDay.map((seconds, index) => {
    const date = new Date(week.start);
    date.setDate(date.getDate() + index);
    return {
      dateKey: localDateKey(date),
      label: ["월", "화", "수", "목", "금", "토", "일"][index],
      minutes: Math.floor(seconds / 60),
    };
  });
  const todayKey = localDateKey(now);
  return {
    todayMinutes: days.find((day) => day.dateKey === todayKey)?.minutes ?? 0,
    weekMinutes: Math.floor(secondsByDay.reduce((sum, seconds) => sum + seconds, 0) / 60),
    weekSessionCount: sessionIds.size,
    days,
  };
}
