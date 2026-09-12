import type {
  CourseRepository,
  RecurringScheduleRepository,
  SemesterRepository,
  SourceRepository,
} from "../../data/repositories/contracts";
import type { RecurringScheduleRule } from "../../domain/models";
import { isValidIsoDate, isValidLocalTime, isValidTimeZone, localTimeMinutes } from "./timezone.ts";

export type SemesterScheduleImport = {
  version: 1;
  semester: {
    externalId?: string;
    name: string;
    startsOn: string;
    endsOn: string;
    timezone: string;
  };
  courses: Array<{
    externalId?: string;
    name: string;
    code?: string;
    location?: string;
    colorToken?: string;
    meetings: Array<{
      externalId?: string;
      weekday: number;
      startLocalTime: string;
      endLocalTime: string;
      location?: string;
    }>;
  }>;
};

export type ScheduleImportRepositories = {
  sources: SourceRepository;
  courses: CourseRepository;
  semesters: SemesterRepository;
  rules: RecurringScheduleRepository;
};

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${path} must not be empty`);
  return value.trim();
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, path);
}

export function validateSemesterScheduleImport(value: unknown): SemesterScheduleImport {
  if (!value || typeof value !== "object") throw new Error("Schedule import must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) throw new Error("Unsupported schedule import version");
  if (!raw.semester || typeof raw.semester !== "object") throw new Error("semester is required");
  const semesterRaw = raw.semester as Record<string, unknown>;
  const startsOn = requiredString(semesterRaw.startsOn, "semester.startsOn");
  const endsOn = requiredString(semesterRaw.endsOn, "semester.endsOn");
  const timezone = requiredString(semesterRaw.timezone, "semester.timezone");
  if (!isValidIsoDate(startsOn)) throw new Error("semester.startsOn must be YYYY-MM-DD");
  if (!isValidIsoDate(endsOn)) throw new Error("semester.endsOn must be YYYY-MM-DD");
  if (endsOn < startsOn) throw new Error("semester.endsOn must not be before startsOn");
  if (!isValidTimeZone(timezone)) throw new Error("semester.timezone is invalid");
  if (!Array.isArray(raw.courses)) throw new Error("courses must be an array");

  const externalIds = new Set<string>();
  const ruleSignatures = new Set<string>();
  const courses = raw.courses.map((courseValue, courseIndex) => {
    if (!courseValue || typeof courseValue !== "object") throw new Error(`courses[${courseIndex}] must be an object`);
    const courseRaw = courseValue as Record<string, unknown>;
    const courseName = requiredString(courseRaw.name, `courses[${courseIndex}].name`);
    const courseExternalId = optionalString(courseRaw.externalId, `courses[${courseIndex}].externalId`);
    if (courseExternalId) {
      if (externalIds.has(`course:${courseExternalId}`)) throw new Error(`Duplicate course externalId: ${courseExternalId}`);
      externalIds.add(`course:${courseExternalId}`);
    }
    if (!Array.isArray(courseRaw.meetings)) throw new Error(`courses[${courseIndex}].meetings must be an array`);
    const meetings = courseRaw.meetings.map((meetingValue, meetingIndex) => {
      if (!meetingValue || typeof meetingValue !== "object") {
        throw new Error(`courses[${courseIndex}].meetings[${meetingIndex}] must be an object`);
      }
      const meetingRaw = meetingValue as Record<string, unknown>;
      const path = `courses[${courseIndex}].meetings[${meetingIndex}]`;
      if (!Number.isInteger(meetingRaw.weekday) || Number(meetingRaw.weekday) < 0 || Number(meetingRaw.weekday) > 6) {
        throw new Error(`${path}.weekday must be an integer from 0 to 6`);
      }
      const startLocalTime = requiredString(meetingRaw.startLocalTime, `${path}.startLocalTime`);
      const endLocalTime = requiredString(meetingRaw.endLocalTime, `${path}.endLocalTime`);
      if (!isValidLocalTime(startLocalTime) || !isValidLocalTime(endLocalTime)) {
        throw new Error(`${path} times must use HH:mm`);
      }
      if (localTimeMinutes(endLocalTime) <= localTimeMinutes(startLocalTime)) {
        throw new Error(`${path}.endLocalTime must be after startLocalTime`);
      }
      const location = optionalString(meetingRaw.location, `${path}.location`);
      const meetingExternalId = optionalString(meetingRaw.externalId, `${path}.externalId`);
      if (meetingExternalId) {
        if (externalIds.has(`rule:${meetingExternalId}`)) throw new Error(`Duplicate rule externalId: ${meetingExternalId}`);
        externalIds.add(`rule:${meetingExternalId}`);
      }
      const signature = [courseExternalId ?? courseName.toLocaleLowerCase(), meetingRaw.weekday, startLocalTime, endLocalTime, location ?? ""].join("|");
      if (ruleSignatures.has(signature)) throw new Error(`Duplicate recurring rule: ${signature}`);
      ruleSignatures.add(signature);
      return {
        externalId: meetingExternalId,
        weekday: Number(meetingRaw.weekday),
        startLocalTime,
        endLocalTime,
        location,
      };
    });
    return {
      externalId: courseExternalId,
      name: courseName,
      code: optionalString(courseRaw.code, `courses[${courseIndex}].code`),
      location: optionalString(courseRaw.location, `courses[${courseIndex}].location`),
      colorToken: optionalString(courseRaw.colorToken, `courses[${courseIndex}].colorToken`),
      meetings,
    };
  });

  return {
    version: 1,
    semester: {
      externalId: optionalString(semesterRaw.externalId, "semester.externalId"),
      name: requiredString(semesterRaw.name, "semester.name"),
      startsOn,
      endsOn,
      timezone,
    },
    courses,
  };
}

function sameRule(
  rule: RecurringScheduleRule,
  value: { courseId: string; weekday: number; startLocalTime: string; endLocalTime: string; location: string | null },
) {
  return rule.courseId === value.courseId
    && rule.weekday === value.weekday
    && rule.startLocalTime === value.startLocalTime
    && rule.endLocalTime === value.endLocalTime
    && (rule.location ?? "") === (value.location ?? "");
}

export async function importSemesterSchedule(
  value: unknown,
  repositories: ScheduleImportRepositories,
) {
  const document = validateSemesterScheduleImport(value);
  const source = await repositories.sources.getOrCreateManual();
  const existingSemesters = await repositories.semesters.list();
  const semesterMatch = existingSemesters.find((semester) =>
    document.semester.externalId
      ? semester.sourceId === source.id && semester.externalId === document.semester.externalId
      : semester.name === document.semester.name
        && semester.startsOn === document.semester.startsOn
        && semester.endsOn === document.semester.endsOn
        && semester.timezone === document.semester.timezone,
  );
  const semester = await repositories.semesters.save({
    id: semesterMatch?.id,
    sourceId: source.id,
    externalId: document.semester.externalId ?? null,
    name: document.semester.name,
    startsOn: document.semester.startsOn,
    endsOn: document.semester.endsOn,
    timezone: document.semester.timezone,
  });

  const importedCourses = [];
  const importedRules = [];
  let knownCourses = await repositories.courses.list();
  let knownRules = await repositories.rules.listForSemester(semester.id);
  for (const courseValue of document.courses) {
    const courseMatch = knownCourses.find((course) =>
      courseValue.externalId
        ? course.sourceId === source.id && course.externalId === courseValue.externalId
        : course.name.toLocaleLowerCase() === courseValue.name.toLocaleLowerCase()
          && (course.code ?? "") === (courseValue.code ?? ""),
    );
    const course = await repositories.courses.save({
      id: courseMatch?.id,
      sourceId: source.id,
      externalId: courseValue.externalId ?? null,
      name: courseValue.name,
      code: courseValue.code ?? null,
      location: courseValue.location ?? null,
      colorToken: courseValue.colorToken ?? null,
    });
    importedCourses.push(course);
    knownCourses = [...knownCourses.filter((known) => known.id !== course.id), course];

    for (const meeting of courseValue.meetings) {
      const ruleValue = {
        courseId: course.id,
        weekday: meeting.weekday,
        startLocalTime: meeting.startLocalTime,
        endLocalTime: meeting.endLocalTime,
        location: meeting.location ?? course.location,
      };
      const ruleMatch = knownRules.find((rule) =>
        meeting.externalId
          ? rule.sourceId === source.id && rule.externalId === meeting.externalId
          : sameRule(rule, ruleValue),
      ) ?? knownRules.find((rule) => sameRule(rule, ruleValue));
      const rule = await repositories.rules.save({
        id: ruleMatch?.id,
        semesterId: semester.id,
        courseId: course.id,
        sourceId: source.id,
        externalId: meeting.externalId ?? null,
        weekday: meeting.weekday,
        startLocalTime: meeting.startLocalTime,
        endLocalTime: meeting.endLocalTime,
        location: ruleValue.location,
      });
      importedRules.push(rule);
      knownRules = [...knownRules.filter((known) => known.id !== rule.id), rule];
    }
  }

  return { semester, courses: importedCourses, rules: importedRules };
}
