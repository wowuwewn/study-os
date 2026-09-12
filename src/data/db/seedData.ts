export type SqlValue = string | number | null;

export type SeedStatement = {
  sql: string;
  values: SqlValue[];
};

export const SAMPLE_SEED_KEY = "sample_seed_version";
export const SAMPLE_SEED_VERSION = "1";

const CREATED_AT = "2026-09-10T00:00:00.000Z";

export const SAMPLE_SEED_STATEMENTS: SeedStatement[] = [
  {
    sql: `INSERT OR IGNORE INTO sources
      (id, kind, display_name, integration_metadata_json, created_at, updated_at)
      VALUES (?1, ?2, ?3, NULL, ?4, ?4)`,
    values: ["seed:source:manual", "manual", "직접 입력", CREATED_AT],
  },
  {
    sql: `INSERT OR IGNORE INTO sources
      (id, kind, display_name, integration_metadata_json, created_at, updated_at)
      VALUES (?1, ?2, ?3, NULL, ?4, ?4)`,
    values: ["seed:source:likelion", "likelion", "멋쟁이사자처럼", CREATED_AT],
  },
  ...[
    ["seed:course:nlp", "자연어처리", "NLP", "미래관 503호", "powder-blue"],
    ["seed:course:open-source-ai", "오픈소스AI응용", "OSAI", "e-Campus", "sage"],
    ["seed:course:multimedia", "멀티미디어신호처리", "MMSP", "공학관 305호", "peach"],
    ["seed:course:advanced-programming", "고급프로그래밍", "ADV-PROG", null, "powder-blue"],
    ["seed:course:advanced-database", "고급데이터베이스", "ADV-DB", null, "sage"],
  ].map<SeedStatement>(([id, name, code, location, colorToken]) => ({
    sql: `INSERT OR IGNORE INTO courses
      (id, source_id, external_id, name, code, location, color_token, created_at, updated_at)
      VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?7)`,
    values: [id, "seed:source:manual", name, code, location, colorToken, CREATED_AT],
  })),
  {
    sql: `INSERT OR IGNORE INTO assignments
      (id, source_id, course_id, external_id, title, description, due_at, points, submission_type, status, submitted_at, graded_at, created_at, updated_at)
      VALUES (?1, ?2, NULL, ?3, ?4, NULL, ?5, NULL, NULL, 'open', NULL, NULL, ?6, ?6)`,
    values: [
      "seed:assignment:j2-week02",
      "seed:source:likelion",
      "j2-week02",
      "멋사 J2-week02 과제",
      "2026-09-16T14:59:00.000Z",
      CREATED_AT,
    ],
  },
  ...[
    [
      "seed:task:java-basics",
      null,
      null,
      "Java 기초 복습",
      "조건문, 반복문 정리",
      45,
      100,
      "paused",
      null,
    ],
    [
      "seed:task:ide-setup",
      "seed:course:advanced-programming",
      null,
      "자바IDE설치 및 프로젝트 생성",
      null,
      null,
      80,
      "todo",
      "2026-09-11T14:59:00.000Z",
    ],
    [
      "seed:task:j2-week02",
      null,
      "seed:assignment:j2-week02",
      "멋사 J2-week02 과제",
      null,
      null,
      70,
      "todo",
      "2026-09-16T14:59:00.000Z",
    ],
    [
      "seed:task:database-preview",
      "seed:course:advanced-database",
      null,
      "고급데이터베이스 강의 예습",
      null,
      30,
      40,
      "todo",
      null,
    ],
  ].map<SeedStatement>(
    ([id, courseId, assignmentId, title, notes, estimatedMinutes, priority, status, dueAt]) => ({
      sql: `INSERT OR IGNORE INTO study_tasks
        (id, source_id, course_id, assignment_id, title, notes, estimated_minutes, priority, status, due_at, planned_start_at, completed_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL, ?11, ?11)`,
      values: [
        id,
        "seed:source:manual",
        courseId,
        assignmentId,
        title,
        notes,
        estimatedMinutes,
        priority,
        status,
        dueAt,
        CREATED_AT,
      ],
    }),
  ),
  ...[
    ["seed:step:java-1", "조건문 개념 정리", 0, 1],
    ["seed:step:java-2", "반복문 개념 정리", 1, 1],
    ["seed:step:java-3", "예제 2-1 실습", 2, 0],
    ["seed:step:java-4", "간단한 문제 3개 풀기", 3, 0],
  ].map<SeedStatement>(([id, title, sortOrder, completed]) => ({
    sql: `INSERT OR IGNORE INTO task_steps
      (id, task_id, title, sort_order, is_completed, completed_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    values: [
      id,
      "seed:task:java-basics",
      title,
      sortOrder,
      completed,
      completed ? "2026-09-11T08:00:00.000Z" : null,
      CREATED_AT,
    ],
  })),
  {
    sql: `INSERT OR IGNORE INTO focus_sessions
      (id, task_id, started_at, ended_at, planned_minutes, elapsed_seconds, status, last_resumed_at, pause_count, created_at, updated_at)
      VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'paused', ?6, 1, ?3, ?6)`,
    values: [
      "seed:focus:java-basics",
      "seed:task:java-basics",
      "2026-09-11T08:20:00.000Z",
      45,
      32 * 60 + 14,
      "2026-09-11T08:52:14.000Z",
    ],
  },
];
