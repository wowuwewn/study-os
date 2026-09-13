# Study OS project state

This document is the handoff snapshot for continuing Study OS in a new Codex chat. It describes code that currently exists, not planned behavior. Read `AGENTS.md` and the topic-specific documents in this directory before changing the implementation.

## Repository snapshot

- Stack: Tauri 2, React 19, TypeScript, Vite, SQLite through `@tauri-apps/plugin-sql`.
- Application identifier: `com.wowuwewn.studyos`.
- Latest completed iCal baseline before Calendar v0.1: `7067bdc` (`iCal 동기화 상태 UX 마무리`).
- iCal Sync/Dedup v0.1 and Calendar v0.1 are complete.
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
- e-Campus iCal Sync v0.1:
  - the Main settings entry provides connect, connection status, Sync Now, last-success time, sanitized errors, and disconnect without redesigning Main;
  - only `https://canvas.dankook.ac.kr` on port 443 is accepted, with same-host redirects, timeouts, a 5 MiB streaming response cap, and single-flight sync;
  - the private URL is handled only by Rust through Windows Credential Manager and is never stored in SQLite, Git, logs, or raw fixture output;
  - Rust fetches and parses VEVENT/VTODO, DATE/date-time values, constrained weekly RRULE, EXDATE, RECURRENCE-ID, SEQUENCE, and explicit STATUS:CANCELLED;
  - normalized data is applied atomically to Source, Event, Assignment, RecurringScheduleRule, and recurring exceptions with stable UID hashes and a global external identity ledger;
  - deterministic Canvas evidence is required for Assignment; uncertain VEVENT values remain Event;
  - recurring occurrences are not materialized as Event rows, stale revisions cannot overwrite newer ones, and canonical manual recurring rules are linked without provider mutation;
  - feed absence does not delete rows because authoritative-full-snapshot behavior is still unverified; generation tracking and the disabled reconciliation flag prepare that later step;
  - a successful changed sync emits `study-os-data-changed` once. A conditional 304 updates sync success without emitting a data-change event.
  - parsing is tolerant at the item boundary: standard auxiliary components and optional/unknown properties do not reject the feed, while unsupported DTSTART/DTEND/DUE/RRULE/RECURRENCE-ID semantics skip only the affected item and increment redacted reason counts;
  - diagnostics expose only allowlisted component/property names, DATE/date-time counts, recurrence-shape buckets, and fixed reason codes; provider values are never returned or logged;
  - the first real private feed QA completed on 2026-09-13: `VCALENDAR=1`, `VEVENT=1`, `VTODO=0`, `DATE=2`, `DATE-TIME=0`; observed property buckets were `CALSCALE`, `CLASS`, `DESCRIPTION`, `DTEND`, `DTSTAMP`, `DTSTART`, `METHOD`, `PRODID`, `SEQUENCE`, `SUMMARY`, `UID`, `URL`, `VERSION`, and `X-*` (three), with no recurrence shape; the one supported item classified as Assignment, with zero Event, recurring rule, exception, cancellation, or unsupported items;
  - the real Canvas feed uses a DATE-declared all-day value with an exact midnight suffix. The adapter preserves it as date semantics; non-midnight mismatches remain unsupported instead of being truncated;
  - real-feed repeat sync returned conditional 304 with stable identities and no duplicates. The canonical 7 Courses/11 manual rules were unchanged, no recurring Event rows were materialized, and the actual-date Today result remained valid with zero scheduled items for 2026-09-13.
  - a failed manual sync now clears any stale prior success summary and reloads the persisted error status before the Settings panel returns to idle; the real-feed QA asserts the repeat request is a conditional 304.
- Calendar v0.1:
  - Figma node `44:333` is implemented as an independent 311×433 borderless Calendar widget without changing Main, PIP, or Pet presentation;
  - month navigation, date selection, stale-response protection, six-row month support, selected-day agenda, explicit `+N` overflow, and the Figma-aligned three-row `다가오는 마감` fallback are implemented; upcoming deadlines can cross the displayed month boundary;
  - Semester recurring occurrences, Quick Add/manual one-off Events, and normalized iCal Events come only through `listScheduleOccurrencesBetween()`; open iCal Assignments remain a separate domain collection and are merged only in the Calendar read model;
  - days containing schedule or deadline data carry a restrained marker and accessible item labels; no provider raw payload, external identity, or integration metadata is rendered;
  - the widget reloads on `study-os-data-changed`, so Quick Add saves and changed iCal syncs appear without reopening it;
  - Windows QA verified the real 2026-2 range, a temporary one-off Event refresh, the actual iCal Assignment rendered on its due date, provider identity non-rendering, 311×433 sizing, six-row spacing, and unchanged FocusSession state. The temporary Event and private-data screenshot were removed after QA.

## Current window structure

All windows are created in Rust from `src-tauri/src/lib.rs` and load the same `index.html`; `src/App.tsx` selects the React root by Tauri window label.

| Label | Logical size | Initial state | Current role |
| --- | ---: | --- | --- |
| `main` | 855×760, minimum 855×760 | visible, resizable, custom decorations | Main Study OS Today surface |
| `pip` | 312×116 | visible, fixed-size, always on top | Compact quest tracker; React resizes it to 312×194 for Expanded |
| `pet` | 56×56 | hidden, fixed-size, transparent, always on top, skipped taskbar | Pet focus-state indicator; shown when PIP is hidden |
| `quick-add` | 810×126 | hidden, fixed-size, transparent, always on top, skipped taskbar | Global keyboard capture surface |
| `calendar` | 311×433 | visible, fixed-size, transparent shell | Figma `44:333` monthly schedule/deadline widget |

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
- `003_ical_sync.sql`: per-Source sync state, conditional request metadata, sync generations, cross-domain external identity ledger, provider cancellation/removal metadata, and explicit DATE semantics.
- `004_ical_date_guards.sql`: write guards for Event/Assignment DATE versus date-time invariants and recurring rule date bounds.
- `005_ical_adapter_version.sql`: parser/adapter version tracking so an adapter upgrade invalidates stale conditional-request metadata and reprocesses the feed safely.

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
- `listScheduleOccurrencesBetween(startAt, endAt)`: bounded range API shared by Today, Calendar, and the future Decision Engine.
- `loadCalendarRange(range)`: Calendar read model that preserves separate `ScheduleOccurrence[]` and `Assignment[]` collections while using the existing schedule range API.
- `buildScheduleOccurrences()`: pure occurrence generation, exception application, Event merge, and chronological sort.
- Rust Tauri commands `ical_connection_status`, `connect_ical`, `sync_ical`, and `disconnect_ical`: main-window-only secret and sync boundary.
- `src/features/ical-sync/service.ts`: typed frontend command adapter; React never receives provider raw data or the stored URL.

React components must not issue SQL directly. Extend repository contracts and services first.

## Figma source of truth

- Main: node `44:216`.
- PIP Compact: node `46:5`.
- PIP Expanded: node `46:26`.
- Pet states: node `46:48`.
- Overall composition reference: node `44:10`.
- Quick Add v0.1: node `44:387`.
- Calendar: node `44:333`.

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
npm run test:ical
npm run test:calendar
npm run tauri dev
npm run qa:ical
npm run qa:ical:real
npm run qa:calendar
npm run qa:windows
cd src-tauri
cargo test
cargo check
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

- `test:data`: migrations, idempotent seed, repository-level task/focus lifecycle, restart recovery, and schedule schema constraints.
- `test:parser`: deterministic Quick Add parser cases.
- `test:schedule`: semester import, import idempotency, weekday and semester bounds, Event merge order, timezone boundary, invalid input, and exception behavior.
- `test:schedule` also covers the canonical 2026-2 shape: 7 Courses, 11 weekly rules, seed Course reuse without metadata loss, existing Semester date preservation, idempotent re-import, and canonical Monday occurrences.
- `npm run qa:schedule-import` reads ignored `semester.local.json`, invokes the existing import service inside a running Windows Tauri app through WebView2 CDP, imports twice, and verifies counts, stable IDs, zero Event materialization, current-day Today output, and canonical Monday occurrences.
- `test:ical`: migrations and date guards plus Rust endpoint, parsing, classification, recurrence, cancellation tombstone, stale-sequence, cross-kind transition, atomicity, idempotency, no-missing-delete, and manual-rule reuse tests against redacted synthetic data.
- `test:calendar`: month-grid and six-row layout data, local month bounds, Assignment DATE/date-time filtering, recurring/Quick Add/iCal Event/Assignment read-model separation and sort, and multi-day DATE coverage.
- `npm run qa:ical`: actual Windows Tauri and Credential Manager connect/status/disconnect QA, connected and disconnected Settings states, SQLite secret absence, and cleanup verification. It deliberately does not perform network sync without the user's private feed URL.
- `npm run qa:ical:real`: uses only the existing Credential Manager entry, performs real Sync Now and repeated sync, and reports only redacted aggregate diagnostics while asserting stable identities, canonical 7-course/11-rule preservation, Today refresh, and unchanged Focus state.
- `npm run qa:calendar`: actual Windows Calendar window, range-service data, actual Semester recurrence, temporary one-off Event refresh, actual iCal Assignment due-month inclusion, provider identity non-rendering, Focus state, and one temporary visual capture. It removes its temporary Event; delete `qa/.tmp/` after visual inspection.
- `npm run qa:windows`: actual Main/PIP/Pet regression for shared quest state, Compact/Expanded sizing, Pet transition, and unchanged Focus state.
- `scripts/qa-quick-add-live.mjs` is an actual-app CDP QA helper, not an npm test script. It expects a running dev app with WebView2 remote debugging.
- `npm run clean` removes only allowlisted, reproducible build/cache/temp outputs. It does not remove source, migrations, docs, assets, or local application data.

## Not implemented yet

- There is still no schedule import Settings UI or file picker; the completed actual timetable import uses the ignored local file plus the development live-import helper.
- Authenticated e-Campus detail enrichment, login/scraping, and background synchronization are not implemented.
- Missing-item deletion reconciliation remains deliberately disabled until the official feed is verified as an authoritative full snapshot. Cross-provider semantic dedup beyond exact recurring-rule reuse is not implemented.
- Decision Engine and recommendation/scoring logic are not implemented.
- Last Safe Start calculation is not implemented.
- Week, Tasks, and Notes navigation destinations are not implemented; their Main tabs are presentational.
- Main memo is not persisted.
- No schedule import/settings UI, reminders, notifications, OCR, or AI feature exists.
- Windows production polish such as final installer behavior, accessibility audit, DPI/monitor edge-case coverage, and release packaging QA remains.
- Pet Mode has state communication and placeholder motion, but the final Danwoong artwork/animation is not implemented.

## Next priorities

1. Verify whether the feed is authoritative before enabling generation-based missing-item reconciliation.
2. Add authenticated e-Campus detail enrichment only for fields that iCal cannot provide.
3. Gate B: decide the Decision Engine v1 policy against the existing Event/Assignment/StudyTask/ScheduleOccurrence separation before implementation.
4. Implement Last Safe Start only after the Decision Engine policy is approved.
5. Implement Week and Tasks surfaces; keep Notes out of scope unless separately prioritized.
6. Perform Windows polish and release-oriented QA.
7. Replace the Pet placeholder with the final Danwoong animation while preserving the existing state/event contract.
