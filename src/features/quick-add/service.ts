import type { Course, EventType } from "../../domain/models";
import { initializeStudyDatabase } from "../../data/db/client";
import {
  courseRepository,
  eventRepository,
  sourceRepository,
  studyTaskRepository,
} from "../../data/repositories";
import { notifyStudyDataChanged } from "../../data/studyData";
import type { QuickAddParseResult, QuickAddSaveResult } from "./types";

export function normalizeCourseText(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g, "");
}

export function matchQuickAddCourse(
  rawInput: string,
  title: string,
  courses: Course[],
): Course | null {
  const input = normalizeCourseText(rawInput);
  const normalizedTitle = normalizeCourseText(title);
  return (
    [...courses]
      .sort((a, b) => normalizeCourseText(b.name).length - normalizeCourseText(a.name).length)
      .find((course) => {
        const name = normalizeCourseText(course.name);
        const code = normalizeCourseText(course.code ?? "");
        return (
          (name.length >= 2 && (input.includes(name) || normalizedTitle.includes(name))) ||
          (code.length >= 2 && input.includes(code))
        );
      }) ?? null
  );
}

function inferEventType(title: string): EventType {
  if (/회의/.test(title)) return "meeting";
  if (/시험/.test(title)) return "exam";
  if (/수업|강의/.test(title)) return "class";
  return "personal";
}

export async function saveQuickAdd(parsed: QuickAddParseResult): Promise<QuickAddSaveResult> {
  if (!parsed.valid) throw new Error(parsed.error ?? "입력 내용을 확인해 주세요.");

  await initializeStudyDatabase();
  const [source, courses] = await Promise.all([
    sourceRepository.getOrCreateManual(),
    courseRepository.list(),
  ]);
  const course = matchQuickAddCourse(parsed.rawInput, parsed.title, courses);

  if (parsed.entityType === "event") {
    if (!parsed.startAt) throw new Error("일정에는 날짜와 시작 시간이 필요해요.");
    const saved = await eventRepository.save({
      sourceId: source.id,
      courseId: course?.id ?? null,
      externalId: null,
      eventType: inferEventType(parsed.title),
      title: parsed.title,
      startAt: parsed.startAt,
      endAt: parsed.endAt,
      location: null,
      isFixed: true,
      notes: null,
    });
    await notifyStudyDataChanged();
    return { id: saved.id, entityType: "event", courseId: saved.courseId };
  }

  const saved = await studyTaskRepository.save({
    sourceId: source.id,
    courseId: course?.id ?? null,
    assignmentId: null,
    title: parsed.title,
    notes: null,
    estimatedMinutes: parsed.estimatedMinutes,
    priority: 50,
    status: "todo",
    dueAt: parsed.dueAt,
    plannedStartAt: parsed.plannedStartAt,
    completedAt: null,
  });
  await notifyStudyDataChanged();
  return { id: saved.id, entityType: "study-task", courseId: saved.courseId };
}
