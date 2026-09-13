export type EntityId = string;
export type IsoDateTime = string;

export type SourceKind = "manual" | "ical" | "ecampus" | "likelion";
export type EventType = "class" | "exam" | "personal" | "study_block" | "meeting";
export type EventTimeKind = "date_time" | "date";
export type AssignmentStatus = "open" | "submitted" | "graded" | "cancelled";
export type StudyTaskStatus = "todo" | "doing" | "paused" | "done" | "cancelled";
export type FocusSessionStatus = "running" | "paused" | "completed" | "cancelled";
export type ScheduleExceptionStatus = "cancelled" | "moved" | "overridden";

export type Source = {
  id: EntityId;
  kind: SourceKind;
  displayName: string;
  integrationMetadata: Record<string, string> | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type Course = {
  id: EntityId;
  sourceId: EntityId | null;
  externalId: string | null;
  name: string;
  code: string | null;
  location: string | null;
  colorToken: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type Semester = {
  id: EntityId;
  sourceId: EntityId | null;
  externalId: string | null;
  name: string;
  startsOn: string;
  endsOn: string;
  timezone: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type RecurringScheduleRule = {
  id: EntityId;
  semesterId: EntityId;
  courseId: EntityId;
  sourceId: EntityId | null;
  externalId: string | null;
  weekday: number;
  startLocalTime: string;
  endLocalTime: string;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type RecurringScheduleException = {
  id: EntityId;
  recurringRuleId: EntityId;
  sourceId: EntityId | null;
  externalId: string | null;
  occurrenceOn: string;
  status: ScheduleExceptionStatus;
  replacementStartAt: IsoDateTime | null;
  replacementEndAt: IsoDateTime | null;
  titleOverride: string | null;
  locationOverride: string | null;
  notes: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type StudyEvent = {
  id: EntityId;
  sourceId: EntityId | null;
  courseId: EntityId | null;
  externalId: string | null;
  eventType: EventType;
  title: string;
  startAt: IsoDateTime;
  endAt: IsoDateTime | null;
  location: string | null;
  isFixed: boolean;
  notes: string | null;
  timeKind: EventTimeKind;
  startOn: string | null;
  endOnExclusive: string | null;
  sourceTimezone: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type Assignment = {
  id: EntityId;
  sourceId: EntityId | null;
  courseId: EntityId | null;
  externalId: string | null;
  title: string;
  description: string | null;
  dueAt: IsoDateTime | null;
  dueOn: string | null;
  dueTimezone: string | null;
  points: number | null;
  submissionType: string | null;
  status: AssignmentStatus;
  submittedAt: IsoDateTime | null;
  gradedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type TaskStep = {
  id: EntityId;
  taskId: EntityId;
  title: string;
  sortOrder: number;
  isCompleted: boolean;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type StudyTask = {
  id: EntityId;
  sourceId: EntityId | null;
  courseId: EntityId | null;
  assignmentId: EntityId | null;
  title: string;
  notes: string | null;
  estimatedMinutes: number | null;
  priority: number;
  status: StudyTaskStatus;
  dueAt: IsoDateTime | null;
  plannedStartAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  steps: TaskStep[];
};

export type FocusSession = {
  id: EntityId;
  taskId: EntityId | null;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  plannedMinutes: number | null;
  elapsedSeconds: number;
  status: FocusSessionStatus;
  lastResumedAt: IsoDateTime | null;
  pauseCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type StudyDashboard = {
  timelineEvents: ScheduleOccurrence[];
  currentQuest: StudyTask;
  todayTasks: StudyTask[];
  activeFocusSession: FocusSession | null;
};

export type ScheduleOccurrence = Omit<StudyEvent, "createdAt" | "updatedAt"> & {
  origin: "event" | "recurring";
  recurringRuleId: EntityId | null;
  exceptionId: EntityId | null;
  semesterId: EntityId | null;
};

export type NewCourse = Pick<Course, "name"> &
  Partial<Pick<Course, "sourceId" | "externalId" | "code" | "location" | "colorToken">>;

export type NewStudyEvent = Pick<StudyEvent, "eventType" | "title" | "startAt"> &
  Partial<
    Pick<
      StudyEvent,
      "sourceId" | "courseId" | "externalId" | "endAt" | "location" | "isFixed" | "notes"
      | "timeKind" | "startOn" | "endOnExclusive" | "sourceTimezone"
    >
  >;

export type NewAssignment = Pick<Assignment, "title"> &
  Partial<
    Pick<
      Assignment,
      | "sourceId"
      | "courseId"
      | "externalId"
      | "description"
      | "dueAt"
      | "dueOn"
      | "dueTimezone"
      | "points"
      | "submissionType"
      | "status"
      | "submittedAt"
      | "gradedAt"
    >
  >;

export type NewStudyTask = Pick<StudyTask, "title"> &
  Partial<
    Pick<
      StudyTask,
      | "sourceId"
      | "courseId"
      | "assignmentId"
      | "notes"
      | "estimatedMinutes"
      | "priority"
      | "status"
      | "dueAt"
      | "plannedStartAt"
    >
  >;
