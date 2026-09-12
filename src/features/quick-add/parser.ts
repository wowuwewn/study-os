import type {
  QuickAddEntityType,
  QuickAddParseOptions,
  QuickAddParseResult,
} from "./types";

const TASK_SIGNAL = /(과제|복습|예습|공부|학습|문제|풀기|읽기|정리|암기|연습)/;
const EVENT_SIGNAL = /(회의|병원|피부과|약속|발표|수업|시험|일정)/;
const WEEKDAY_INDEX: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

type ExtractedDate = {
  date: Date | null;
  label: string | null;
  source: string | null;
  invalid: boolean;
  explicitWeek: boolean;
  rollover: "day" | "week" | "year" | "none";
};

type ExtractedTime = {
  hour: number | null;
  minute: number | null;
  label: string | null;
  source: string | null;
  invalid: boolean;
};

function localDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function toIsoAt(date: Date, hour: number, minute: number) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0,
  ).toISOString();
}

function extractDuration(input: string) {
  const match = input.match(/(\d+)\s*시간(?:\s*(\d+)\s*분)?|(\d+)\s*분/);
  if (!match) return { minutes: null, source: null };
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = match[3] ? Number(match[3]) : match[2] ? Number(match[2]) : 0;
  const total = hours * 60 + minutes;
  return { minutes: total > 0 ? total : null, source: match[0] };
}

function extractTime(input: string): ExtractedTime {
  const korean = input.match(/(오전|오후)?\s*(\d{1,2})\s*시(?!간)(?:\s*(\d{1,2})\s*분)?/);
  const clock = korean ? null : input.match(/(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$)/);
  if (!korean && !clock) {
    return { hour: null, minute: null, label: null, source: null, invalid: false };
  }

  const source = (korean ?? clock)?.[0].trim() ?? null;
  const period = korean?.[1] ?? null;
  let hour = Number(korean?.[2] ?? clock?.[1]);
  const minute = Number(korean?.[3] ?? clock?.[2] ?? 0);

  if (period === "오후" && hour < 12) hour += 12;
  if (period === "오전" && hour === 12) hour = 0;
  // v0.1 follows the approved examples: an unqualified 1–7시는 afternoon.
  if (!period && korean && hour >= 1 && hour <= 7) hour += 12;

  const invalid = hour < 0 || hour > 23 || minute < 0 || minute > 59;
  return {
    hour,
    minute,
    label: invalid ? null : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    source,
    invalid,
  };
}

function extractDate(input: string, now: Date): ExtractedDate {
  const today = localDay(now);
  const relative = input.match(/오늘|내일|모레/);
  if (relative) {
    const offset = relative[0] === "오늘" ? 0 : relative[0] === "내일" ? 1 : 2;
    return {
      date: addDays(today, offset),
      label: relative[0],
      source: relative[0],
      invalid: false,
      explicitWeek: false,
      rollover: "day",
    };
  }

  const absoluteKorean = input.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const absoluteSlash = absoluteKorean ? null : input.match(/(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?=\s|$)/);
  const absolute = absoluteKorean ?? absoluteSlash;
  if (absolute) {
    const month = Number(absolute[1]);
    const day = Number(absolute[2]);
    let year = now.getFullYear();
    let date = new Date(year, month - 1, day);
    const valid = date.getMonth() === month - 1 && date.getDate() === day;
    if (valid && date < today) {
      year += 1;
      date = new Date(year, month - 1, day);
    }
    return {
      date: valid ? date : null,
      label: valid ? `${month}월 ${day}일` : null,
      source: absolute[0].trim(),
      invalid: !valid,
      explicitWeek: false,
      rollover: "year",
    };
  }

  const weekday = input.match(/(?:(다음)\s*주|(이번)\s*주)?\s*([월화수목금토일])요일/);
  if (!weekday) {
    return {
      date: null,
      label: null,
      source: null,
      invalid: false,
      explicitWeek: false,
      rollover: "day",
    };
  }

  const target = WEEKDAY_INDEX[weekday[3]];
  const current = today.getDay();
  const nextWeek = Boolean(weekday[1]);
  const thisWeek = Boolean(weekday[2]);
  let date: Date;
  if (nextWeek || thisWeek) {
    const daysSinceMonday = (current + 6) % 7;
    const monday = addDays(today, -daysSinceMonday + (nextWeek ? 7 : 0));
    date = addDays(monday, (target + 6) % 7);
  } else {
    date = addDays(today, (target - current + 7) % 7);
  }

  return {
    date,
    label: nextWeek ? `다음 주 ${weekday[3]}요일` : thisWeek ? `이번 주 ${weekday[3]}요일` : `${weekday[3]}요일`,
    source: weekday[0].trim(),
    invalid: false,
    explicitWeek: nextWeek || thisWeek,
    rollover: nextWeek || thisWeek ? "none" : "week",
  };
}

function cleanTitle(input: string, removals: Array<string | null>) {
  let title = input;
  for (const removal of removals) {
    if (removal) title = title.replace(removal, " ");
  }
  return title
    .replace(/까지|마감/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,·\-\s]+|[,·\-\s]+$/g, "")
    .trim();
}

function inferEntityType(input: string, hasDeadline: boolean, hasDuration: boolean, hasDate: boolean, hasTime: boolean): QuickAddEntityType {
  if (hasDeadline || TASK_SIGNAL.test(input)) return "study-task";
  if (EVENT_SIGNAL.test(input) && hasDate) return "event";
  if (hasDuration && !hasTime) return "study-task";
  if (hasDate && hasTime) return "event";
  return "study-task";
}

export function parseQuickAdd(
  rawInput: string,
  options: QuickAddParseOptions = {},
): QuickAddParseResult {
  const now = options.now ? new Date(options.now) : new Date();
  const input = rawInput.replace(/\s+/g, " ").trim();
  const duration = extractDuration(input);
  const time = extractTime(input);
  const date = extractDate(input, now);
  const hasDeadline = /(까지|마감)/.test(input);
  const inferredType = inferEntityType(
    input,
    hasDeadline,
    duration.minutes !== null,
    date.date !== null,
    time.hour !== null,
  );
  const entityType = options.typeOverride ?? inferredType;
  const title = cleanTitle(input, [duration.source, time.source, date.source]);

  let resolvedDate = date.date ? new Date(date.date) : null;
  if (!resolvedDate && time.hour !== null) resolvedDate = localDay(now);
  if (
    resolvedDate &&
    time.hour !== null &&
    toIsoAt(resolvedDate, time.hour, time.minute ?? 0) <= now.toISOString()
  ) {
    if (date.rollover === "day") resolvedDate = addDays(resolvedDate, 1);
    if (date.rollover === "week") resolvedDate = addDays(resolvedDate, 7);
    if (date.rollover === "year") {
      resolvedDate.setFullYear(resolvedDate.getFullYear() + 1);
    }
  }

  const exactDateTime =
    resolvedDate && time.hour !== null
      ? toIsoAt(resolvedDate, time.hour, time.minute ?? 0)
      : null;
  const taskDueAt =
    entityType === "study-task" && hasDeadline && resolvedDate
      ? exactDateTime ?? toIsoAt(resolvedDate, 23, 59)
      : null;
  const plannedStartAt =
    entityType === "study-task" && !hasDeadline ? exactDateTime : null;
  const startAt = entityType === "event" ? exactDateTime : null;
  const endAt =
    startAt && duration.minutes
      ? new Date(Date.parse(startAt) + duration.minutes * 60_000).toISOString()
      : null;

  let error: string | null = null;
  if (!input) error = "추가할 내용을 입력해 주세요.";
  else if (date.invalid) error = "날짜를 확인해 주세요.";
  else if (time.invalid) error = "시간을 확인해 주세요.";
  else if (!title) error = "제목을 확인해 주세요.";
  else if (entityType === "event" && !startAt) error = "일정에는 날짜와 시작 시간이 필요해요.";

  return {
    rawInput: input,
    entityType,
    title,
    estimatedMinutes: duration.minutes,
    dueAt: taskDueAt,
    plannedStartAt,
    startAt,
    endAt,
    dateLabel: date.label,
    timeLabel: time.label,
    hasDeadline,
    valid: error === null,
    error,
  };
}
