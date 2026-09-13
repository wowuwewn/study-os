import type {
  Assignment,
  AssignmentStatus,
  Course,
  EventType,
  FocusSession,
  FocusSessionStatus,
  RecurringScheduleException,
  RecurringScheduleRule,
  ScheduleExceptionStatus,
  Semester,
  Source,
  SourceKind,
  StudyEvent,
  StudyTask,
  StudyTaskStatus,
  TaskStep,
} from "../../domain/models";

export type SourceRow = {
  id: string;
  kind: SourceKind;
  display_name: string;
  integration_metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type CourseRow = {
  id: string;
  source_id: string | null;
  external_id: string | null;
  name: string;
  code: string | null;
  location: string | null;
  color_token: string | null;
  created_at: string;
  updated_at: string;
};

export type SemesterRow = {
  id: string;
  source_id: string | null;
  external_id: string | null;
  name: string;
  starts_on: string;
  ends_on: string;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type RecurringScheduleRuleRow = {
  id: string;
  semester_id: string;
  course_id: string;
  source_id: string | null;
  external_id: string | null;
  weekday: number;
  start_local_time: string;
  end_local_time: string;
  location: string | null;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  updated_at: string;
};

export type RecurringScheduleExceptionRow = {
  id: string;
  recurring_rule_id: string;
  source_id: string | null;
  external_id: string | null;
  occurrence_on: string;
  status: ScheduleExceptionStatus;
  replacement_start_at: string | null;
  replacement_end_at: string | null;
  title_override: string | null;
  location_override: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  source_id: string | null;
  course_id: string | null;
  external_id: string | null;
  event_type: EventType;
  title: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  is_fixed: number;
  notes: string | null;
  time_kind: "date_time" | "date";
  start_on: string | null;
  end_on_exclusive: string | null;
  source_timezone: string | null;
  created_at: string;
  updated_at: string;
};

export type AssignmentRow = {
  id: string;
  source_id: string | null;
  course_id: string | null;
  external_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  due_on: string | null;
  due_timezone: string | null;
  points: number | null;
  submission_type: string | null;
  status: AssignmentStatus;
  submitted_at: string | null;
  graded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StudyTaskRow = {
  id: string;
  source_id: string | null;
  course_id: string | null;
  assignment_id: string | null;
  title: string;
  notes: string | null;
  estimated_minutes: number | null;
  priority: number;
  status: StudyTaskStatus;
  due_at: string | null;
  planned_start_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskStepRow = {
  id: string;
  task_id: string;
  title: string;
  sort_order: number;
  is_completed: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FocusSessionRow = {
  id: string;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number | null;
  elapsed_seconds: number;
  status: FocusSessionStatus;
  last_resumed_at: string | null;
  pause_count: number;
  created_at: string;
  updated_at: string;
};

export const mapSource = (row: SourceRow): Source => ({
  id: row.id,
  kind: row.kind,
  displayName: row.display_name,
  integrationMetadata: row.integration_metadata_json
    ? (JSON.parse(row.integration_metadata_json) as Record<string, string>)
    : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapCourse = (row: CourseRow): Course => ({
  id: row.id,
  sourceId: row.source_id,
  externalId: row.external_id,
  name: row.name,
  code: row.code,
  location: row.location,
  colorToken: row.color_token,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapSemester = (row: SemesterRow): Semester => ({
  id: row.id,
  sourceId: row.source_id,
  externalId: row.external_id,
  name: row.name,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  timezone: row.timezone,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapRecurringScheduleRule = (
  row: RecurringScheduleRuleRow,
): RecurringScheduleRule => ({
  id: row.id,
  semesterId: row.semester_id,
  courseId: row.course_id,
  sourceId: row.source_id,
  externalId: row.external_id,
  weekday: row.weekday,
  startLocalTime: row.start_local_time,
  endLocalTime: row.end_local_time,
  location: row.location,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapRecurringScheduleException = (
  row: RecurringScheduleExceptionRow,
): RecurringScheduleException => ({
  id: row.id,
  recurringRuleId: row.recurring_rule_id,
  sourceId: row.source_id,
  externalId: row.external_id,
  occurrenceOn: row.occurrence_on,
  status: row.status,
  replacementStartAt: row.replacement_start_at,
  replacementEndAt: row.replacement_end_at,
  titleOverride: row.title_override,
  locationOverride: row.location_override,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapEvent = (row: EventRow): StudyEvent => ({
  id: row.id,
  sourceId: row.source_id,
  courseId: row.course_id,
  externalId: row.external_id,
  eventType: row.event_type,
  title: row.title,
  startAt: row.start_at,
  endAt: row.end_at,
  location: row.location,
  isFixed: Boolean(row.is_fixed),
  notes: row.notes,
  timeKind: row.time_kind,
  startOn: row.start_on,
  endOnExclusive: row.end_on_exclusive,
  sourceTimezone: row.source_timezone,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapAssignment = (row: AssignmentRow): Assignment => ({
  id: row.id,
  sourceId: row.source_id,
  courseId: row.course_id,
  externalId: row.external_id,
  title: row.title,
  description: row.description,
  dueAt: row.due_at,
  dueOn: row.due_on,
  dueTimezone: row.due_timezone,
  points: row.points,
  submissionType: row.submission_type,
  status: row.status,
  submittedAt: row.submitted_at,
  gradedAt: row.graded_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapTaskStep = (row: TaskStepRow): TaskStep => ({
  id: row.id,
  taskId: row.task_id,
  title: row.title,
  sortOrder: row.sort_order,
  isCompleted: Boolean(row.is_completed),
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapStudyTask = (row: StudyTaskRow, steps: TaskStep[] = []): StudyTask => ({
  id: row.id,
  sourceId: row.source_id,
  courseId: row.course_id,
  assignmentId: row.assignment_id,
  title: row.title,
  notes: row.notes,
  estimatedMinutes: row.estimated_minutes,
  priority: row.priority,
  status: row.status,
  dueAt: row.due_at,
  plannedStartAt: row.planned_start_at,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  steps,
});

export const mapFocusSession = (row: FocusSessionRow): FocusSession => ({
  id: row.id,
  taskId: row.task_id,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  plannedMinutes: row.planned_minutes,
  elapsedSeconds: row.elapsed_seconds,
  status: row.status,
  lastResumedAt: row.last_resumed_at,
  pauseCount: row.pause_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
