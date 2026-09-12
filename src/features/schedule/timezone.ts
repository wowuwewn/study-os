const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

type WallClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function isValidIsoDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidLocalTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

function parseIsoDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match || !isValidIsoDate(value)) throw new Error(`Invalid local date: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function parseLocalTime(value: string) {
  const match = TIME_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid local time: ${value}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function wallClockParts(instant: Date, timeZone: string): WallClockParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

export function dateInTimeZone(instant: Date, timeZone: string): string {
  const parts = wallClockParts(instant, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addCalendarDays(date: string, days: number): string {
  const { year, month, day } = parseIsoDate(date);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function weekdayOfDate(date: string): number {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function localTimeMinutes(value: string): number {
  const { hour, minute } = parseLocalTime(value);
  return hour * 60 + minute;
}

export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) throw new Error(`Invalid timezone: ${timeZone}`);
  const dateParts = parseIsoDate(date);
  const timeParts = parseLocalTime(time);
  const desired = { ...dateParts, ...timeParts };
  const desiredTimestamp = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  let candidate = desiredTimestamp;

  for (let attempt = 0;; attempt += 1) {
    const observed = wallClockParts(new Date(candidate), timeZone);
    const observedTimestamp = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    const adjustment = desiredTimestamp - observedTimestamp;
    if (adjustment === 0) break;
    if (attempt >= 4) throw new Error(`Local time does not exist in ${timeZone}: ${date} ${time}`);
    candidate += adjustment;
  }

  const verified = wallClockParts(new Date(candidate), timeZone);
  if (Object.keys(desired).some((key) => verified[key as keyof WallClockParts] !== desired[key as keyof WallClockParts])) {
    throw new Error(`Local time does not exist in ${timeZone}: ${date} ${time}`);
  }
  return new Date(candidate).toISOString();
}

export function getSystemLocalDayRange(now = new Date()): { startAt: string; endAt: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}
