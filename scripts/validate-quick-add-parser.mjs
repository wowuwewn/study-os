import assert from "node:assert/strict";
import { parseQuickAdd } from "../src/features/quick-add/parser.ts";

const now = new Date(2026, 8, 12, 10, 0, 0, 0); // Saturday, local time
const parse = (input) => parseQuickAdd(input, { now });
const localParts = (iso) => {
  const value = new Date(iso);
  return [value.getFullYear(), value.getMonth() + 1, value.getDate(), value.getHours(), value.getMinutes()];
};

const java = parse("Java 복습 40분");
assert.equal(java.entityType, "study-task");
assert.equal(java.title, "Java 복습");
assert.equal(java.estimatedMinutes, 40);

const assignment = parse("강화학습 과제 일요일까지 1시간");
assert.equal(assignment.entityType, "study-task");
assert.equal(assignment.title, "강화학습 과제");
assert.equal(assignment.estimatedMinutes, 60);
assert.deepEqual(localParts(assignment.dueAt), [2026, 9, 13, 23, 59]);

const clinic = parse("내일 3시 피부과");
assert.equal(clinic.entityType, "event");
assert.equal(clinic.title, "피부과");
assert.deepEqual(localParts(clinic.startAt), [2026, 9, 13, 15, 0]);

const meeting = parse("멋사 회의 금요일 7시");
assert.equal(meeting.entityType, "event");
assert.equal(meeting.title, "멋사 회의");
assert.deepEqual(localParts(meeting.startAt), [2026, 9, 18, 19, 0]);

const database = parse("데이터베이스 예습 30분");
assert.equal(database.entityType, "study-task");
assert.equal(database.estimatedMinutes, 30);

const nextTuesday = parse("다음 주 화요일 자연어처리 복습 45분");
assert.equal(nextTuesday.entityType, "study-task");
assert.equal(nextTuesday.dateLabel, "다음 주 화요일");
assert.equal(nextTuesday.title, "자연어처리 복습");

const presentation = parse("9월 18일 14시 발표");
assert.equal(presentation.entityType, "event");
assert.equal(presentation.title, "발표");
assert.deepEqual(localParts(presentation.startAt), [2026, 9, 18, 14, 0]);

const combinedDuration = parse("자료 읽기 1시간 30분");
assert.equal(combinedDuration.estimatedMinutes, 90);
assert.equal(parse("").valid, false);
assert.equal(parseQuickAdd("Java 복습 40분", { now, typeOverride: "event" }).valid, false);

console.log("quick add parser validation passed: 9 deterministic cases");
