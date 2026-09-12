# Study OS project state

This document is the handoff snapshot for continuing Study OS in a new Codex chat. It describes code that currently exists, not planned behavior. Read `AGENTS.md` and the topic-specific documents in this directory before changing the implementation.

## Repository snapshot

- Stack: Tauri 2, React 19, TypeScript, Vite, SQLite through `@tauri-apps/plugin-sql`.
- Application identifier: `com.wowuwewn.studyos`.
- Baseline commit before the current uncommitted milestone: `d5eb185` (`Codex 자율 작업 및 검수 규칙 추가`).
- The 2026-2 timetable milestone remains uncommitted by request.
- Do not commit secrets or personal schedule URLs/data. Local databases and personal semester JSON files are ignored.

## Completed functionality

- Main Visual Baseline v0.1 with the Today vertical timeline, current quest, three open-task rows, quest detail, checklist, start/pause control, and memo presentation.
- PIP v0.2 with Compact and Expanded modes, Windows Acrylic, always-on-top behavior, elapsed time, progress, next event, focus controls, and a replaceable runner structure.
- Pet Mode in a separate transparent window. It reflects idle/running/paused/completed focus state, can restore Compact, and can open Main. The final Danwoong animation is not implemented.
- One persistent focus-session source of truth shared by Main, PIP, and Pet. Start, pause, resume, completion, elapsed-time persistence, checklist changes, and restart recovery are implemented.
- Quick Add v0.1 as a keyboard-first window with deterministic local parsing for dates, times, deadlines, durations, tasks, and one-off Events. It performs local Course matching and writes through repositories.
- Local-first SQLite data layer with domain types, row mappers, repository contracts, SQLite implementations, idempotent development seed data, and numbered migrations.
- Real Schedule Foundation v0.1:
  - Semester and recurring Course meeting storage;
  - IANA semester timezone plus local wall-clock class times;
  - query-time occurrence generation;
  - cancelled/moved/overridden per-date exceptions;
  - validated, idempotent semester JSON import;
  - Today merging of recurring classes and one-off/Quick Add Events in time order.
- Actual 2026-2 timetable import:
  - canonical values come from `docs/timetable.md`;
  - Semester range is `2026-09-01` through `2026-12-14` in `Asia/Seoul`;
  - the local app database contains exactly 7 imported Courses and 11 weekly RecurringScheduleRules;
  - re-import preserves Semester, Course, and rule IDs without creating duplicate rows;
  - recurring classes remain query-time occurrences and do not create Event rows.
- The old fixed-date sample timeline Events are no longer seeded. Existing user/imported Events are not overwritten.

## Current window structure

All windows are created in Rust from `src-tauri/src/lib.rs` and load the same `index.html`; `src/App.tsx` selects the React root by Tauri window label.

| Label | Logical size | Initial state | Current role |
| --- | ---: | --- | --- |
| `main` | 855×760, minimum 855×760 | visible, resizable, custom decorations | Main Study OS Today surface |
| `pip` | 312×116 | visible, fixed-size, always on top | Compact quest tracker; React resizes it to 312×194 for Expanded |
| `pet` | 56×56 | hidden, fixed-size, transparent, always on top, skipped taskbar | Pet focus-state indicator; shown when PIP is hidden |
| `quick-add` | 810×126 | hidden, fixed-size, transparent, always on top, skipped taskbar | Global keyboard capture surface |

Windows-specific behavior:

- `pip` uses native Tauri `Effect::Acrylic` with a translucent slate color. CSS does not reduce the opacity of all PIP contents.
- `pet` intentionally has no Acrylic panel. Win32 `SetWindowPos` enforces the intended 56×56 physical size.
- Clicking the PIP body/brand shows, unminimizes, and focuses `main`.
- Pet single click restores Compact; Pet double click shows and focuses Main; Pet dragging moves the window.

## DB, domain, and migrations

The runtime database URL is `sqlite:study-os.db`. Tauri stores the file in application data, outside the repository. Persisted timestamps use UTC ISO 8601. Recurring rule times are stored as local `HH:mm` wall-clock values and resolved using the Semester IANA timezone.

Domain concepts in `src/domain/models.ts`:

- `Source`, `Course`, `Semester`;
- `RecurringScheduleRule`, `RecurringScheduleException`, generated `ScheduleOccurrence`;
- `StudyEvent`, `Assignment`, `StudyTask`, `TaskStep`, `FocusSession`;
- `StudyDashboard` for the current Main/PIP read model.

Keep `Event`, `Assignment`, and `StudyTask` semantically separate. A recurring rule is the source of truth; a one-date cancellation, move, or override belongs in an exception rather than changing the rule.

Migrations:

- `001_initial.sql`: `app_meta`, sources, courses, one-off events, assignments, study tasks, task steps, focus sessions, indexes, and single-active-focus constraint.
- `002_recurring_schedule.sql`: semesters, recurring schedule rules, recurring schedule exceptions, natural/external duplicate constraints, query indexes, and removal of only the deterministic legacy `seed:event:*` timeline rows.

The public dummy import template is `semester.example.json`. Personal files should use `semester.local.json`, `semester.*.local.json`, or `local-schedule/`; these paths are ignored by Git. There is currently no import Settings UI or file picker.

## Repository and service surface

Repository singletons are exported by `src/data/repositories/index.ts`:

- `sourceRepository`: get/create the manual Source.
- `courseRepository`: list/get/save/remove.
- `semesterRepository`: list/get/save/remove.
- `recurringScheduleRepository`: list, list by semester, get/save/remove.
- `scheduleExceptionRepository`: list, list by rule, get/save/remove.
- `eventRepository`: range query and CRUD for one-off Events.
- `assignmentRepository`: open-list query and CRUD.
- `studyTaskRepository`: open/current-quest queries, CRUD/status, and checklist operations.
- `focusSessionRepository`: active-session lookup and start/resume/pause/elapsed/complete/cancel lifecycle.

Important services and APIs:

- `loadStudyDashboard()` / `useStudyDashboard()`: shared Main/PIP read model and refresh subscription.
- `STUDY_DATA_CHANGED_EVENT`: tells open windows to reload persisted data.
- `FOCUS_COMMAND_EVENT`: lets Main forward focus start/pause commands to the PIP session owner.
- `parseQuickAdd()` and `saveQuickAdd()`: deterministic parsing and repository-backed persistence.
- `showQuickAddWindow()`: centers, shows, focuses, and resets Quick Add.
- `validateSemesterScheduleImport()`: validates the version 1 semester JSON contract.
- `importLocalSemesterSchedule()` / `importLocalSemesterScheduleJson()`: validation followed by manual Source lookup, Semester upsert, Course upsert, and rule upsert.
- `listTodaySchedule(now?)`: returns the current system-local day's recurring classes and one-off Events.
- `listScheduleOccurrencesBetween(startAt, endAt)`: bounded range API intended for Today, future Calendar, and the Decision Engine.
- `buildScheduleOccurrences()`: pure occurrence generation, exception application, Event merge, and chronological sort.

React components must not issue SQL directly. Extend repository contracts and services first.

## Figma source of truth

- Main: node `44:216`.
- PIP Compact: node `46:5`.
- PIP Expanded: node `46:26`.
- Pet states: node `46:48`.
- Overall composition reference: node `44:10`.
- Quick Add v0.1: node `44:387`.
- Future Calendar reference: node `44:333`.

Do not use Main nodes `30:5` or `41:3`. PIP node `44:311` is deprecated. Approved visual details are recorded in `docs/design-spec.md`.

## Global shortcut

`Ctrl+Shift+Space` is registered through `tauri-plugin-global-shortcut` in Rust. It reuses the existing `quick-add` window, centers it, shows it, focuses it, and emits `study-os-quick-add-opened`. Main's existing 추가 button opens the same window. In Quick Add, `Enter` saves, `Escape` hides without saving, and `Tab` changes the task/Event override.

## Current checks

Run from the repository root unless noted:

```powershell
npm run build
npm run test:data
npm run test:parser
npm run test:schedule
npm run tauri dev
cd src-tauri
cargo check
cargo fmt --check
```

- `test:data`: migrations, idempotent seed, repository-level task/focus lifecycle, restart recovery, and schedule schema constraints.
- `test:parser`: deterministic Quick Add parser cases.
- `test:schedule`: semester import, import idempotency, weekday and semester bounds, Event merge order, timezone boundary, invalid input, and exception behavior.
- `test:schedule` also covers the canonical 2026-2 shape: 7 Courses, 11 weekly rules, seed Course reuse without metadata loss, existing Semester date preservation, idempotent re-import, and canonical Monday occurrences.
- `npm run qa:schedule-import` reads ignored `semester.local.json`, invokes the existing import service inside a running Windows Tauri app through WebView2 CDP, imports twice, and verifies counts, stable IDs, zero Event materialization, current-day Today output, and canonical Monday occurrences.
- `scripts/qa-quick-add-live.mjs` is an actual-app CDP QA helper, not an npm test script. It expects a running dev app with WebView2 remote debugging.
- `npm run clean` removes only allowlisted, reproducible build/cache/temp outputs. It does not remove source, migrations, docs, assets, or local application data.

## Not implemented yet

- There is still no schedule import Settings UI or file picker; the completed actual timetable import uses the ignored local file plus the development live-import helper.
- No e-Campus login, scraping, assignment collection, iCal fetch, remote adapter, or credential storage exists.
- No background synchronization, sync cursor, conflict resolution, deletion reconciliation, or cross-provider dedup workflow exists. Current `(source_id, external_id)` and natural-key protections cover import-level duplicates only.
- Calendar UI is not implemented.
- Decision Engine and recommendation/scoring logic are not implemented.
- Last Safe Start calculation is not implemented.
- Week, Tasks, and Notes navigation destinations are not implemented; their Main tabs are presentational.
- Main memo is not persisted.
- No schedule import/settings UI, reminders, notifications, OCR, or AI feature exists.
- Windows production polish such as final installer behavior, accessibility audit, DPI/monitor edge-case coverage, and release packaging QA remains.
- Pet Mode has state communication and placeholder motion, but the final Danwoong artwork/animation is not implemented.

## Next priorities

1. Add e-Campus/iCal integration without storing credentials or private URLs in Git.
2. Add sync and dedup semantics beyond the current import-level unique keys.
3. Implement Calendar using node `44:333` and `listScheduleOccurrencesBetween()`.
4. Implement the Decision Engine against the existing Event/Assignment/StudyTask/ScheduleOccurrence separation.
5. Implement Last Safe Start.
6. Implement Week and Tasks surfaces; keep Notes out of scope unless separately prioritized.
7. Perform Windows polish and release-oriented QA.
8. Replace the Pet placeholder with the final Danwoong animation while preserving the existing state/event contract.
