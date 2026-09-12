import type Database from "@tauri-apps/plugin-sql";
import type {
  Assignment,
  Course,
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
import { createEntityId, getDatabase, utcNow } from "../db/client";
import {
  COMPLETE_FOCUS_SESSION_SQL,
  PAUSE_FOCUS_SESSION_SQL,
  RESUME_FOCUS_SESSION_SQL,
  SAVE_FOCUS_ELAPSED_SQL,
} from "../db/sql";
import {
  mapAssignment,
  mapCourse,
  mapEvent,
  mapFocusSession,
  mapRecurringScheduleException,
  mapRecurringScheduleRule,
  mapSemester,
  mapSource,
  mapStudyTask,
  mapTaskStep,
  type AssignmentRow,
  type CourseRow,
  type EventRow,
  type FocusSessionRow,
  type RecurringScheduleExceptionRow,
  type RecurringScheduleRuleRow,
  type SemesterRow,
  type SourceRow,
  type StudyTaskRow,
  type TaskStepRow,
} from "../db/rows";
import type {
  AssignmentInput,
  AssignmentRepository,
  CourseInput,
  CourseRepository,
  EventInput,
  EventRepository,
  FocusSessionRepository,
  RecurringScheduleExceptionInput,
  RecurringScheduleRuleInput,
  RecurringScheduleRepository,
  ScheduleExceptionRepository,
  SemesterInput,
  SemesterRepository,
  SourceRepository,
  StudyTaskInput,
  StudyTaskRepository,
} from "./contracts";

async function first<T>(database: Database, query: string, values: unknown[] = []): Promise<T | null> {
  const rows = await database.select<T[]>(query, values);
  return rows[0] ?? null;
}

export class SqliteSourceRepository implements SourceRepository {
  async getOrCreateManual(): Promise<Source> {
    const database = await getDatabase();
    const existing = await first<SourceRow>(
      database,
      "SELECT * FROM sources WHERE kind = 'manual' ORDER BY created_at LIMIT 1",
    );
    if (existing) return mapSource(existing);

    const id = createEntityId();
    const now = utcNow();
    await database.execute(
      `INSERT INTO sources
        (id, kind, display_name, integration_metadata_json, created_at, updated_at)
       VALUES (?1, 'manual', ?2, NULL, ?3, ?3)`,
      [id, "직접 입력", now],
    );
    const saved = await first<SourceRow>(database, "SELECT * FROM sources WHERE id = ?1", [id]);
    if (!saved) throw new Error("Manual source creation failed");
    return mapSource(saved);
  }
}

export class SqliteCourseRepository implements CourseRepository {
  async list(): Promise<Course[]> {
    const database = await getDatabase();
    const rows = await database.select<CourseRow[]>("SELECT * FROM courses ORDER BY name");
    return rows.map(mapCourse);
  }

  async get(id: string): Promise<Course | null> {
    const database = await getDatabase();
    const row = await first<CourseRow>(database, "SELECT * FROM courses WHERE id = ?1", [id]);
    return row ? mapCourse(row) : null;
  }

  async save(input: CourseInput): Promise<Course> {
    const database = await getDatabase();
    const id = input.id ?? createEntityId();
    const now = utcNow();
    await database.execute(
      `INSERT INTO courses
        (id, source_id, external_id, name, code, location, color_token, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(id) DO UPDATE SET
        source_id=excluded.source_id, external_id=excluded.external_id, name=excluded.name,
        code=excluded.code, location=excluded.location, color_token=excluded.color_token,
        updated_at=excluded.updated_at`,
      [id, input.sourceId, input.externalId, input.name, input.code, input.location, input.colorToken, now],
    );
    const saved = await this.get(id);
    if (!saved) throw new Error("Course save failed");
    return saved;
  }

  async remove(id: string): Promise<void> {
    const database = await getDatabase();
    await database.execute("DELETE FROM courses WHERE id = ?1", [id]);
  }
}

export class SqliteSemesterRepository implements SemesterRepository {
  async list(): Promise<Semester[]> {
    const database = await getDatabase();
    const rows = await database.select<SemesterRow[]>(
      "SELECT * FROM semesters ORDER BY starts_on, name",
    );
    return rows.map(mapSemester);
  }

  async get(id: string): Promise<Semester | null> {
    const database = await getDatabase();
    const row = await first<SemesterRow>(database, "SELECT * FROM semesters WHERE id = ?1", [id]);
    return row ? mapSemester(row) : null;
  }

  async save(input: SemesterInput): Promise<Semester> {
    const database = await getDatabase();
    const id = input.id ?? createEntityId();
    const now = utcNow();
    await database.execute(
      `INSERT INTO semesters
        (id, source_id, external_id, name, starts_on, ends_on, timezone, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(id) DO UPDATE SET
        source_id=excluded.source_id, external_id=excluded.external_id, name=excluded.name,
        starts_on=excluded.starts_on, ends_on=excluded.ends_on, timezone=excluded.timezone,
        updated_at=excluded.updated_at`,
      [
        id,
        input.sourceId,
        input.externalId,
        input.name,
        input.startsOn,
        input.endsOn,
        input.timezone,
        now,
      ],
    );
    const saved = await this.get(id);
    if (!saved) throw new Error("Semester save failed");
    return saved;
  }

  async remove(id: string): Promise<void> {
    const database = await getDatabase();
    await database.execute("DELETE FROM semesters WHERE id = ?1", [id]);
  }
}

export class SqliteRecurringScheduleRepository implements RecurringScheduleRepository {
  async list(): Promise<RecurringScheduleRule[]> {
    const database = await getDatabase();
    const rows = await database.select<RecurringScheduleRuleRow[]>(
      "SELECT * FROM recurring_schedule_rules ORDER BY weekday, start_local_time",
    );
    return rows.map(mapRecurringScheduleRule);
  }

  async listForSemester(semesterId: string): Promise<RecurringScheduleRule[]> {
    const database = await getDatabase();
    const rows = await database.select<RecurringScheduleRuleRow[]>(
      `SELECT * FROM recurring_schedule_rules
       WHERE semester_id = ?1 ORDER BY weekday, start_local_time`,
      [semesterId],
    );
    return rows.map(mapRecurringScheduleRule);
  }

  async get(id: string): Promise<RecurringScheduleRule | null> {
    const database = await getDatabase();
    const row = await first<RecurringScheduleRuleRow>(
      database,
      "SELECT * FROM recurring_schedule_rules WHERE id = ?1",
      [id],
    );
    return row ? mapRecurringScheduleRule(row) : null;
  }

  async save(input: RecurringScheduleRuleInput): Promise<RecurringScheduleRule> {
    const database = await getDatabase();
    const id = input.id ?? createEntityId();
    const now = utcNow();
    await database.execute(
      `INSERT INTO recurring_schedule_rules
        (id, semester_id, course_id, source_id, external_id, weekday, start_local_time, end_local_time, location, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
       ON CONFLICT(id) DO UPDATE SET
        semester_id=excluded.semester_id, course_id=excluded.course_id,
        source_id=excluded.source_id, external_id=excluded.external_id,
        weekday=excluded.weekday, start_local_time=excluded.start_local_time,
        end_local_time=excluded.end_local_time, location=excluded.location,
        updated_at=excluded.updated_at`,
      [
        id,
        input.semesterId,
        input.courseId,
        input.sourceId,
        input.externalId,
        input.weekday,
        input.startLocalTime,
        input.endLocalTime,
        input.location,
        now,
      ],
    );
    const saved = await this.get(id);
    if (!saved) throw new Error("Recurring schedule rule save failed");
    return saved;
  }

  async remove(id: string): Promise<void> {
    const database = await getDatabase();
    await database.execute("DELETE FROM recurring_schedule_rules WHERE id = ?1", [id]);
  }
}

export class SqliteScheduleExceptionRepository implements ScheduleExceptionRepository {
  async list(): Promise<RecurringScheduleException[]> {
    const database = await getDatabase();
    const rows = await database.select<RecurringScheduleExceptionRow[]>(
      "SELECT * FROM recurring_schedule_exceptions ORDER BY occurrence_on",
    );
    return rows.map(mapRecurringScheduleException);
  }

  async listForRule(recurringRuleId: string): Promise<RecurringScheduleException[]> {
    const database = await getDatabase();
    const rows = await database.select<RecurringScheduleExceptionRow[]>(
      `SELECT * FROM recurring_schedule_exceptions
       WHERE recurring_rule_id = ?1 ORDER BY occurrence_on`,
      [recurringRuleId],
    );
    return rows.map(mapRecurringScheduleException);
  }

  async get(id: string): Promise<RecurringScheduleException | null> {
    const database = await getDatabase();
    const row = await first<RecurringScheduleExceptionRow>(
      database,
      "SELECT * FROM recurring_schedule_exceptions WHERE id = ?1",
      [id],
    );
    return row ? mapRecurringScheduleException(row) : null;
  }

  async save(input: RecurringScheduleExceptionInput): Promise<RecurringScheduleException> {
    const database = await getDatabase();
    const id = input.id ?? createEntityId();
    const now = utcNow();
    await database.execute(
      `INSERT INTO recurring_schedule_exceptions
        (id, recurring_rule_id, source_id, external_id, occurrence_on, status,
         replacement_start_at, replacement_end_at, title_override, location_override,
         notes, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
       ON CONFLICT(id) DO UPDATE SET
        recurring_rule_id=excluded.recurring_rule_id, source_id=excluded.source_id,
        external_id=excluded.external_id, occurrence_on=excluded.occurrence_on,
        status=excluded.status, replacement_start_at=excluded.replacement_start_at,
        replacement_end_at=excluded.replacement_end_at,
        title_override=excluded.title_override, location_override=excluded.location_override,
        notes=excluded.notes, updated_at=excluded.updated_at`,
      [
        id,
        input.recurringRuleId,
        input.sourceId,
        input.externalId,
        input.occurrenceOn,
        input.status,
        input.replacementStartAt,
        input.replacementEndAt,
        input.titleOverride,
        input.locationOverride,
        input.notes,
        now,
      ],
    );
    const saved = await this.get(id);
    if (!saved) throw new Error("Recurring schedule exception save failed");
    return saved;
  }

  async remove(id: string): Promise<void> {
    const database = await getDatabase();
    await database.execute("DELETE FROM recurring_schedule_exceptions WHERE id = ?1", [id]);
  }
}

export class SqliteEventRepository implements EventRepository {
  async listBetween(startAt: string, endAt: string): Promise<StudyEvent[]> {
    const database = await getDatabase();
    const rows = await database.select<EventRow[]>(
      "SELECT * FROM events WHERE start_at >= ?1 AND start_at < ?2 ORDER BY start_at",
      [startAt, endAt],
    );
    return rows.map(mapEvent);
  }

  async get(id: string): Promise<StudyEvent | null> {
    const database = await getDatabase();
    const row = await first<EventRow>(database, "SELECT * FROM events WHERE id = ?1", [id]);
    return row ? mapEvent(row) : null;
  }

  async save(input: EventInput): Promise<StudyEvent> {
    const database = await getDatabase();
    const id = input.id ?? createEntityId();
    const now = utcNow();
    await database.execute(
      `INSERT INTO events
        (id, source_id, course_id, external_id, event_type, title, start_at, end_at, location, is_fixed, notes, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
       ON CONFLICT(id) DO UPDATE SET
        source_id=excluded.source_id, course_id=excluded.course_id, external_id=excluded.external_id,
        event_type=excluded.event_type, title=excluded.title, start_at=excluded.start_at,
        end_at=excluded.end_at, location=excluded.location, is_fixed=excluded.is_fixed,
        notes=excluded.notes, updated_at=excluded.updated_at`,
      [
        id,
        input.sourceId,
        input.courseId,
        input.externalId,
        input.eventType,
        input.title,
        input.startAt,
        input.endAt,
        input.location,
        input.isFixed ? 1 : 0,
        input.notes,
        now,
      ],
    );
    const saved = await this.get(id);
    if (!saved) throw new Error("Event save failed");
    return saved;
  }

  async remove(id: string): Promise<void> {
    const database = await getDatabase();
    await database.execute("DELETE FROM events WHERE id = ?1", [id]);
  }
}

export class SqliteAssignmentRepository implements AssignmentRepository {
  async listOpen(): Promise<Assignment[]> {
    const database = await getDatabase();
    const rows = await database.select<AssignmentRow[]>(
      "SELECT * FROM assignments WHERE status = 'open' ORDER BY due_at IS NULL, due_at",
    );
    return rows.map(mapAssignment);
  }

  async get(id: string): Promise<Assignment | null> {
    const database = await getDatabase();
    const row = await first<AssignmentRow>(database, "SELECT * FROM assignments WHERE id = ?1", [id]);
    return row ? mapAssignment(row) : null;
  }

  async save(input: AssignmentInput): Promise<Assignment> {
    const database = await getDatabase();
    const id = input.id ?? createEntityId();
    const now = utcNow();
    await database.execute(
      `INSERT INTO assignments
        (id, source_id, course_id, external_id, title, description, due_at, points, submission_type, status, submitted_at, graded_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(id) DO UPDATE SET
        source_id=excluded.source_id, course_id=excluded.course_id, external_id=excluded.external_id,
        title=excluded.title, description=excluded.description, due_at=excluded.due_at,
        points=excluded.points, submission_type=excluded.submission_type, status=excluded.status,
        submitted_at=excluded.submitted_at, graded_at=excluded.graded_at, updated_at=excluded.updated_at`,
      [
        id,
        input.sourceId,
        input.courseId,
        input.externalId,
        input.title,
        input.description,
        input.dueAt,
        input.points,
        input.submissionType,
        input.status,
        input.submittedAt,
        input.gradedAt,
        now,
      ],
    );
    const saved = await this.get(id);
    if (!saved) throw new Error("Assignment save failed");
    return saved;
  }

  async remove(id: string): Promise<void> {
    const database = await getDatabase();
    await database.execute("DELETE FROM assignments WHERE id = ?1", [id]);
  }
}

export class SqliteStudyTaskRepository implements StudyTaskRepository {
  async withSteps(row: StudyTaskRow): Promise<StudyTask> {
    return mapStudyTask(row, await this.listSteps(row.id));
  }

  async listOpen(): Promise<StudyTask[]> {
    const database = await getDatabase();
    const rows = await database.select<StudyTaskRow[]>(
      `SELECT * FROM study_tasks
       WHERE status IN ('todo', 'doing', 'paused')
       ORDER BY priority DESC, due_at IS NULL, due_at, created_at`,
    );
    return Promise.all(rows.map((row) => this.withSteps(row)));
  }

  async get(id: string): Promise<StudyTask | null> {
    const database = await getDatabase();
    const row = await first<StudyTaskRow>(database, "SELECT * FROM study_tasks WHERE id = ?1", [id]);
    return row ? this.withSteps(row) : null;
  }

  async getCurrentQuest(): Promise<StudyTask | null> {
    const database = await getDatabase();
    const row = await first<StudyTaskRow>(
      database,
      `SELECT task.*
       FROM study_tasks task
       LEFT JOIN focus_sessions focus
         ON focus.task_id = task.id AND focus.status IN ('running', 'paused')
       WHERE task.status IN ('todo', 'doing', 'paused')
       ORDER BY CASE
         WHEN focus.status = 'running' THEN 0
         WHEN focus.status = 'paused' THEN 1
         WHEN task.status = 'doing' THEN 2
         ELSE 3
       END,
       task.priority DESC, task.due_at IS NULL, task.due_at, task.created_at
       LIMIT 1`,
    );
    return row ? this.withSteps(row) : null;
  }

  async save(input: StudyTaskInput): Promise<StudyTask> {
    const database = await getDatabase();
    const id = input.id ?? createEntityId();
    const now = utcNow();
    await database.execute(
      `INSERT INTO study_tasks
        (id, source_id, course_id, assignment_id, title, notes, estimated_minutes, priority, status, due_at, planned_start_at, completed_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(id) DO UPDATE SET
        source_id=excluded.source_id, course_id=excluded.course_id,
        assignment_id=excluded.assignment_id, title=excluded.title, notes=excluded.notes,
        estimated_minutes=excluded.estimated_minutes, priority=excluded.priority,
        status=excluded.status, due_at=excluded.due_at, planned_start_at=excluded.planned_start_at,
        completed_at=excluded.completed_at, updated_at=excluded.updated_at`,
      [
        id,
        input.sourceId,
        input.courseId,
        input.assignmentId,
        input.title,
        input.notes,
        input.estimatedMinutes,
        input.priority,
        input.status,
        input.dueAt,
        input.plannedStartAt,
        input.completedAt,
        now,
      ],
    );
    const saved = await this.get(id);
    if (!saved) throw new Error("Study task save failed");
    return saved;
  }

  async setStatus(id: string, status: StudyTaskStatus): Promise<void> {
    const database = await getDatabase();
    const now = utcNow();
    await database.execute(
      `UPDATE study_tasks SET status = ?1,
       completed_at = CASE WHEN ?1 = 'done' THEN ?2 ELSE NULL END,
       updated_at = ?2 WHERE id = ?3`,
      [status, now, id],
    );
  }

  async remove(id: string): Promise<void> {
    const database = await getDatabase();
    await database.execute("DELETE FROM study_tasks WHERE id = ?1", [id]);
  }

  async listSteps(taskId: string): Promise<TaskStep[]> {
    const database = await getDatabase();
    const rows = await database.select<TaskStepRow[]>(
      "SELECT * FROM task_steps WHERE task_id = ?1 ORDER BY sort_order",
      [taskId],
    );
    return rows.map(mapTaskStep);
  }

  async setStepCompleted(stepId: string, isCompleted: boolean): Promise<void> {
    const database = await getDatabase();
    const now = utcNow();
    await database.execute(
      `UPDATE task_steps SET is_completed = ?1, completed_at = ?2, updated_at = ?3 WHERE id = ?4`,
      [isCompleted ? 1 : 0, isCompleted ? now : null, now, stepId],
    );
  }
}

export class SqliteFocusSessionRepository implements FocusSessionRepository {
  async getById(id: string): Promise<FocusSession | null> {
    const database = await getDatabase();
    const row = await first<FocusSessionRow>(database, "SELECT * FROM focus_sessions WHERE id = ?1", [id]);
    return row ? mapFocusSession(row) : null;
  }

  async getActive(): Promise<FocusSession | null> {
    const database = await getDatabase();
    const row = await first<FocusSessionRow>(
      database,
      `SELECT * FROM focus_sessions
       WHERE status IN ('running', 'paused')
       ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
    );
    return row ? mapFocusSession(row) : null;
  }

  async startOrResume(task: StudyTask, elapsedSeconds = 0): Promise<FocusSession> {
    const active = await this.getActive();
    if (active) {
      if (active.taskId !== task.id) {
        throw new Error("Another focus session is already active");
      }
      if (active.status === "paused") return this.resume(active.id, task.id);
      return active;
    }

    const database = await getDatabase();
    const id = createEntityId();
    const now = utcNow();
    await database.execute(
      `INSERT INTO focus_sessions
        (id, task_id, started_at, ended_at, planned_minutes, elapsed_seconds, status, last_resumed_at, pause_count, created_at, updated_at)
       VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'running', ?3, 0, ?3, ?3)`,
      [id, task.id, now, task.estimatedMinutes, elapsedSeconds],
    );
    await database.execute(
      "UPDATE study_tasks SET status = 'doing', updated_at = ?1 WHERE id = ?2",
      [now, task.id],
    );
    const session = await this.getById(id);
    if (!session) throw new Error("Focus session start failed");
    return session;
  }

  async pause(sessionId: string, taskId: string | null, elapsedSeconds: number): Promise<FocusSession> {
    const database = await getDatabase();
    const now = utcNow();
    await database.execute(PAUSE_FOCUS_SESSION_SQL, [elapsedSeconds, now, sessionId]);
    if (taskId) {
      await database.execute(
        "UPDATE study_tasks SET status = 'paused', updated_at = ?1 WHERE id = ?2",
        [now, taskId],
      );
    }
    const session = await this.getById(sessionId);
    if (!session) throw new Error("Focus session pause failed");
    return session;
  }

  async resume(sessionId: string, taskId: string | null): Promise<FocusSession> {
    const database = await getDatabase();
    const now = utcNow();
    await database.execute(RESUME_FOCUS_SESSION_SQL, [now, sessionId]);
    if (taskId) {
      await database.execute(
        "UPDATE study_tasks SET status = 'doing', updated_at = ?1 WHERE id = ?2",
        [now, taskId],
      );
    }
    const session = await this.getById(sessionId);
    if (!session) throw new Error("Focus session resume failed");
    return session;
  }

  async saveElapsed(sessionId: string, elapsedSeconds: number): Promise<void> {
    const database = await getDatabase();
    await database.execute(SAVE_FOCUS_ELAPSED_SQL, [elapsedSeconds, utcNow(), sessionId]);
  }

  async complete(sessionId: string, taskId: string | null, elapsedSeconds: number): Promise<FocusSession> {
    const database = await getDatabase();
    const now = utcNow();
    await database.execute(COMPLETE_FOCUS_SESSION_SQL, [elapsedSeconds, now, sessionId]);
    if (taskId) {
      await database.execute(
        "UPDATE study_tasks SET status = 'done', completed_at = ?1, updated_at = ?1 WHERE id = ?2",
        [now, taskId],
      );
    }
    const session = await this.getById(sessionId);
    if (!session) throw new Error("Focus session completion failed");
    return session;
  }

  async cancel(sessionId: string, elapsedSeconds: number): Promise<FocusSession> {
    const database = await getDatabase();
    const now = utcNow();
    await database.execute(
      `UPDATE focus_sessions SET status = 'cancelled', elapsed_seconds = ?1,
       ended_at = ?2, updated_at = ?2 WHERE id = ?3`,
      [elapsedSeconds, now, sessionId],
    );
    const session = await this.getById(sessionId);
    if (!session) throw new Error("Focus session cancellation failed");
    return session;
  }
}
