import type {
  Assignment,
  Course,
  FocusSession,
  StudyEvent,
  StudyTask,
  StudyTaskStatus,
  TaskStep,
} from "../../domain/models";

type PersistedFields = "id" | "createdAt" | "updatedAt";

export type CourseInput = Omit<Course, PersistedFields> & { id?: string };
export type EventInput = Omit<StudyEvent, PersistedFields> & { id?: string };
export type AssignmentInput = Omit<Assignment, PersistedFields> & { id?: string };
export type StudyTaskInput = Omit<StudyTask, PersistedFields | "steps"> & { id?: string };

export interface CourseRepository {
  list(): Promise<Course[]>;
  get(id: string): Promise<Course | null>;
  save(input: CourseInput): Promise<Course>;
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
  listOpen(): Promise<StudyTask[]>;
  get(id: string): Promise<StudyTask | null>;
  getCurrentQuest(): Promise<StudyTask | null>;
  save(input: StudyTaskInput): Promise<StudyTask>;
  setStatus(id: string, status: StudyTaskStatus): Promise<void>;
  remove(id: string): Promise<void>;
  listSteps(taskId: string): Promise<TaskStep[]>;
  setStepCompleted(stepId: string, isCompleted: boolean): Promise<void>;
}

export interface FocusSessionRepository {
  getActive(): Promise<FocusSession | null>;
  startOrResume(task: StudyTask, elapsedSeconds?: number): Promise<FocusSession>;
  pause(sessionId: string, taskId: string | null, elapsedSeconds: number): Promise<FocusSession>;
  resume(sessionId: string, taskId: string | null): Promise<FocusSession>;
  saveElapsed(sessionId: string, elapsedSeconds: number): Promise<void>;
  complete(sessionId: string, taskId: string | null, elapsedSeconds: number): Promise<FocusSession>;
  cancel(sessionId: string, elapsedSeconds: number): Promise<FocusSession>;
}
