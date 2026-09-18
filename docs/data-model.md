# Study OS data model

Study OS is a local-first application. The SQLite database is stored by Tauri in the operating system's application-data area and is never part of the repository. Schema changes are applied through numbered migrations in `src-tauri/migrations/`.

## Entity responsibilities

- **Source** records where imported or manually entered data originated. It stores no credentials. Future adapters may use non-secret integration metadata.
- **Course** is the academic context shared by events, assignments, and study tasks.
- **Semester** owns an academic date range and IANA timezone without tying the app to one particular term.
- **RecurringScheduleRule** stores a course meeting's weekday and local wall-clock time for a semester.
- **RecurringScheduleException** changes one dated occurrence without mutating its rule.
- **Event** is something fixed on the time axis: a class, exam, meeting, personal event, or reserved study block.
- **Assignment** is an external obligation, usually with a due date and submission lifecycle.
- **StudyTask** is a concrete action the learner can perform. It may optionally be derived from an assignment, but it also supports independent tasks.
- **TaskStep** is an ordered checklist item belonging to a study task.
- **FocusSession** is one measured period of work on a task. It owns timer state and accumulated elapsed seconds.
- **FocusInterval** is an internal running segment of a FocusSession. It exists so statistics exclude pauses and split work accurately at local day/week boundaries without merging domain concepts.

```mermaid
erDiagram
  SOURCE ||--o{ COURSE : provides
  SOURCE ||--o{ EVENT : provides
  SOURCE ||--o{ ASSIGNMENT : provides
  SOURCE ||--o{ STUDY_TASK : provides
  SOURCE ||--o{ SEMESTER : provides
  COURSE ||--o{ EVENT : schedules
  SEMESTER ||--o{ RECURRING_SCHEDULE_RULE : bounds
  COURSE ||--o{ RECURRING_SCHEDULE_RULE : meets_as
  RECURRING_SCHEDULE_RULE ||--o{ RECURRING_SCHEDULE_EXCEPTION : excepts
  COURSE ||--o{ ASSIGNMENT : groups
  COURSE ||--o{ STUDY_TASK : groups
  ASSIGNMENT ||--o{ STUDY_TASK : decomposes_into
  STUDY_TASK ||--o{ TASK_STEP : contains
  STUDY_TASK ||--o{ FOCUS_SESSION : measured_by
  FOCUS_SESSION ||--o{ FOCUS_INTERVAL : contains
```

## Why Event, Assignment, and StudyTask stay separate

An **Event** answers “when does something happen?”, an **Assignment** answers “what obligation is due?”, and a **StudyTask** answers “what action will I do now?”. One assignment can therefore become several executable tasks, while a class remains an event even if it inspires later study tasks. Decision Engine v1 preserves this separation: an eligible Assignment is only a virtual candidate until Start atomically creates or reuses a linked executable StudyTask.

## FocusSession lifecycle

`running` → `paused` → `running` may repeat without creating a new session. Each pause persists `elapsed_seconds` and increments `pause_count`; resume refreshes `last_resumed_at`. Completion stores the final elapsed value and `ended_at`, sets the session to `completed`, and marks its task `done`. Compact, Expanded, and Pet are presentation modes and do not create sessions.

Each running period also owns one open `focus_intervals` row. Pause, completion, and cancellation close it; resume opens another. Focus statistics sum interval overlap rather than wall-clock session duration, so paused time is excluded and an interval crossing local midnight is apportioned to both dates. Migration 006 backfills older accumulated sessions as one conservative closed interval because their historical pause boundaries were not previously available.

At most one `running` or `paused` session can exist at once. Its task is the hard-locked Current Quest until that session completes or is cancelled. Without active focus, Decision Engine v1 selects from unfinished StudyTasks and eligible virtual Assignments using the approved score, deterministic ties, and persisted 8-point hysteresis.

## Restart and time policy

If the process stops while a session is `running`, the next PIP initialization changes it and its task to `paused` without modifying `elapsed_seconds`. Time spent while the app was closed is not counted. The user explicitly resumes from the saved value.

All timestamps are stored as UTC ISO 8601 strings. UI code converts them to the user's local timezone only when formatting for display. Recurring class times are the exception: a rule stores `HH:mm` wall-clock values and its Semester stores the IANA timezone needed to resolve each date to UTC. IDs are text UUIDs for user-created rows so records can later merge across external sources; deterministic `seed:*` IDs make development seed data idempotent.

## Source adapters

Future iCal, e-Campus, or other adapters write through repositories and identify imported records with `(source_id, external_id)`. Partial unique indexes prevent duplicate imported courses, events, and assignments while allowing either field to remain null for manual data. Secrets, session cookies, private calendar URLs, and credentials must never be stored in seed data or committed files.

The recurring schedule model and import contract are documented in [schedule-model.md](./schedule-model.md).
