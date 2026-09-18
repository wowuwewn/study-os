import type {
  Assignment,
  Course,
  FocusInterval,
  FocusSession,
  RecurringScheduleException,
  RecurringScheduleRule,
  Semester,
  Source,
  StudyEvent,
  StudyTask,
  StudyTaskStatus,
  TaskStep,
} from "../../domain/models";

type PersistedFields = "id" | "createdAt" | "updatedAt";

export type CourseInput = Omit<Course, PersistedFields> & { id?: string };
type EventSyncFields = "timeKind" | "startOn" | "endOnExclusive" | "sourceTimezone";
type AssignmentSyncFields = "dueOn" | "dueTimezone";
type RuleSyncFields = "startsOn" | "endsOn";
export type EventInput = Omit<StudyEvent, PersistedFields | EventSyncFields> &
  Partial<Pick<StudyEvent, EventSyncFields>> & { id?: string };
export type AssignmentInput = Omit<Assignment, PersistedFields | AssignmentSyncFields> &
  Partial<Pick<Assignment, AssignmentSyncFields>> & { id?: string };
export type StudyTaskInput = Omit<StudyTask, PersistedFields | "steps"> & { id?: string };
export type SemesterInput = Omit<Semester, PersistedFields> & { id?: string };
export type RecurringScheduleRuleInput = Omit<
  RecurringScheduleRule,
  PersistedFields | RuleSyncFields
> & Partial<Pick<RecurringScheduleRule, RuleSyncFields>> & { id?: string };
export type RecurringScheduleExceptionInput = Omit<RecurringScheduleException, PersistedFields> & { id?: string };

export interface SourceRepository {
  getOrCreateManual(): Promise<Source>;
}

export interface CourseRepository {
  list(): Promise<Course[]>;
  get(id: string): Promise<Course | null>;
  save(input: CourseInput): Promise<Course>;
  remove(id: string): Promise<void>;
}

export interface SemesterRepository {
  list(): Promise<Semester[]>;
  get(id: string): Promise<Semester | null>;
  save(input: SemesterInput): Promise<Semester>;
  remove(id: string): Promise<void>;
}

export interface RecurringScheduleRepository {
  list(): Promise<RecurringScheduleRule[]>;
  listForSemester(semesterId: string): Promise<RecurringScheduleRule[]>;
  get(id: string): Promise<RecurringScheduleRule | null>;
  save(input: RecurringScheduleRuleInput): Promise<RecurringScheduleRule>;
  remove(id: string): Promise<void>;
}

export interface ScheduleExceptionRepository {
  list(): Promise<RecurringScheduleException[]>;
  listForRule(recurringRuleId: string): Promise<RecurringScheduleException[]>;
  get(id: string): Promise<RecurringScheduleException | null>;
  save(input: RecurringScheduleExceptionInput): Promise<RecurringScheduleException>;
  remove(id: string): Promise<void>;
}

export interface EventRepository {
  listBetween(startAt: string, endAt: string): Promise<StudyEvent[]>;
  get(id: string): Promise<StudyEvent | null>;
  save(input: EventInput): Promise<StudyEvent>;
  remove(id: string): Promise<void>;
}

export interface AssignmentRepository {
  listOpen(): Promise<Assignment[]>;
  get(id: string): Promise<Assignment | null>;
  save(input: AssignmentInput): Promise<Assignment>;
  remove(id: string): Promise<void>;
}

export interface StudyTaskRepository {
  list(): Promise<StudyTask[]>;
  listOpen(): Promise<StudyTask[]>;
  get(id: string): Promise<StudyTask | null>;
  findExecutableByAssignment(assignmentId: string): Promise<StudyTask | null>;
  createExecutableForAssignment(input: StudyTaskInput): Promise<StudyTask>;
  save(input: StudyTaskInput): Promise<StudyTask>;
  setStatus(id: string, status: StudyTaskStatus): Promise<void>;
  remove(id: string): Promise<void>;
  listSteps(taskId: string): Promise<TaskStep[]>;
  setStepCompleted(stepId: string, isCompleted: boolean): Promise<void>;
}

export interface DecisionStateRepository {
  getCurrentCandidateId(): Promise<string | null>;
  setCurrentCandidateId(candidateId: string | null): Promise<void>;
}

export interface FocusSessionRepository {
  getActive(): Promise<FocusSession | null>;
  listIntervalsBetween(startAt: string, endAt: string): Promise<FocusInterval[]>;
  startOrResume(task: StudyTask, elapsedSeconds?: number): Promise<FocusSession>;
  pause(sessionId: string, elapsedSeconds: number): Promise<FocusSession>;
  resume(sessionId: string): Promise<FocusSession>;
  saveElapsed(sessionId: string, elapsedSeconds: number): Promise<void>;
  complete(sessionId: string, elapsedSeconds: number): Promise<FocusSession>;
  cancel(sessionId: string, elapsedSeconds: number): Promise<FocusSession>;
}
