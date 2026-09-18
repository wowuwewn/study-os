import {
  SqliteAssignmentRepository,
  SqliteCourseRepository,
  SqliteDecisionStateRepository,
  SqliteEventRepository,
  SqliteFocusSessionRepository,
  SqliteRecurringScheduleRepository,
  SqliteScheduleExceptionRepository,
  SqliteSemesterRepository,
  SqliteSourceRepository,
  SqliteStudyTaskRepository,
} from "./sqlite";

export const sourceRepository = new SqliteSourceRepository();
export const courseRepository = new SqliteCourseRepository();
export const decisionStateRepository = new SqliteDecisionStateRepository();
export const eventRepository = new SqliteEventRepository();
export const assignmentRepository = new SqliteAssignmentRepository();
export const studyTaskRepository = new SqliteStudyTaskRepository();
export const focusSessionRepository = new SqliteFocusSessionRepository();
export const semesterRepository = new SqliteSemesterRepository();
export const recurringScheduleRepository = new SqliteRecurringScheduleRepository();
export const scheduleExceptionRepository = new SqliteScheduleExceptionRepository();

export type {
  AssignmentRepository,
  CourseRepository,
  DecisionStateRepository,
  EventRepository,
  FocusSessionRepository,
  RecurringScheduleRepository,
  ScheduleExceptionRepository,
  SemesterRepository,
  SourceRepository,
  StudyTaskRepository,
} from "./contracts";
