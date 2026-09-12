import {
  SqliteAssignmentRepository,
  SqliteCourseRepository,
  SqliteEventRepository,
  SqliteFocusSessionRepository,
  SqliteStudyTaskRepository,
} from "./sqlite";

export const courseRepository = new SqliteCourseRepository();
export const eventRepository = new SqliteEventRepository();
export const assignmentRepository = new SqliteAssignmentRepository();
export const studyTaskRepository = new SqliteStudyTaskRepository();
export const focusSessionRepository = new SqliteFocusSessionRepository();

export type {
  AssignmentRepository,
  CourseRepository,
  EventRepository,
  FocusSessionRepository,
  StudyTaskRepository,
} from "./contracts";
