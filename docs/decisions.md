# Study OS — Decisions

This file records approved product/architecture decisions that should not be silently reversed by a new chat or implementation task.

## Source-of-truth order

When facts conflict, use:

1. `project-state.md`
2. `timetable.md`
3. `product-vision.md`
4. `decisions.md`
5. current chat

Do not infer important project facts from old chat memory when a project source exists.

## Development workflow

- One feature/milestone per Codex chat.
- New Codex chats first read `AGENTS.md`, `docs/project-state.md`, relevant docs, recent git log, and git status.
- `AGENTS.md` Autonomous Task Loop is the default implementation workflow.
- A feature task should normally include design/implementation/tests/Windows QA/self-review/repo hygiene/project-state update.
- Escalate to the user before destructive DB changes, large architecture changes, approved Figma changes, security/auth policy changes, external writes/actions, or breaking behavior.
- Update `project-state.md` after every completed implementation milestone.
- Use Korean Git commit messages.
- Do not push unless the user explicitly chooses to.

## Repository hygiene

- Public repository: never commit secrets, credentials, cookies, private iCal URLs, tokens, local SQLite DBs, or personal local schedule files.
- `npm run clean` may only remove allowlisted reproducible artifacts.
- Do not delete migrations merely because they are old.
- Remove obsolete/temp files at the end of the task only when deletion is clearly safe.
- Preserve uncertain files and report them instead of guessing.

## Approved stack

- Tauri 2 + React + TypeScript + Vite.
- SQLite is local-first persistence.
- Official Tauri plugins are preferred when stable and compatible.
- Motion for React/CSS for UI motion.
- Do not introduce Canvas/WebGL for ordinary UI/mascot animation.

## Window architecture

Current intended surfaces:
- Main
- PIP Compact
- PIP Expanded
- Pet
- Quick Add
- future Calendar widget

Pet is a separate transparent Tauri window because PIP Acrylic must not leave a visible rectangular blur.

PIP/Pet/Main must share focus state; do not create independent timers per window.

## Approved Figma sources

- Main: `44:216`
- PIP Compact: `46:5`
- PIP Expanded: `46:26`
- Pet states: `46:48`
- Quick Add: `44:387`
- Calendar future reference: `44:333`
- Overall composition: `44:10`

Deprecated:
- Main `30:5`
- Main `41:3`
- PIP `44:311`

Approved Figma is the implementation baseline. New ideas belong in backlog/review before replacing the source of truth.

## Visual/product rules

Avoid:
- generic SaaS dashboard styling
- huge headings
- motivational filler
- excessive cards/pills/badges
- gradients/electric blue
- large empty whitespace
- generic AI dashboard layouts
- static mascot-as-logo treatment

Current Main/PIP baseline should not be redesigned during unrelated feature work.

## Domain decisions

Keep separate:
- Event
- Assignment
- StudyTask
- FocusSession

Recurring class rules are also distinct from one-off Event rows.

Reason:
- Event = when something happens
- Assignment = what must be completed by a deadline
- StudyTask = what the user can actually do
- FocusSession = what the user actually worked on

This distinction is required by the Decision Engine.

## Time and recurrence

- Persist normal timestamps in a consistent UTC/ISO-8601 representation.
- Semester owns an IANA timezone.
- Recurring classes preserve local wall-clock time and resolve it with the semester timezone.
- Recurring schedule rule is the source of truth.
- Occurrences are generated at query time.
- One-date changes use cancelled/moved/overridden exceptions instead of mutating the base rule.

## FocusSession restart policy

If the app closes while a session is running:
- preserve elapsed time
- restore the session as paused
- do not count offline time automatically

PIP/Pet mode transitions never create a new focus session.

## Quick Add

- Default shortcut: `Ctrl+Shift+Space`.
- `Alt+Space` is intentionally not used because it conflicts with Windows system behavior.
- v0.1 parsing is deterministic/local, not AI.
- Parser logic stays outside UI components.
- Repository layer handles persistence.
- AI parsing, if added later, is an enhancement rather than a replacement for safe deterministic behavior.

## Decision Engine

- Implement rules-based v1 before AI.
- Goal is one recommended Current Quest, not a ranked dashboard full of options.
- Consider urgency, importance, estimated duration, free time until next fixed event, progress, and focus state.
- Recommendation reason should be visible/explainable.
- Last Safe Start is a later extension.

## e-Campus integration

Preferred sequence:
1. official iCal
2. source adapter + sync/dedup/reconciliation
3. authenticated detail retrieval only where needed

Never:
- store credentials/private URLs in Git
- bypass CAPTCHA
- aggressively poll
- make the UI depend directly on provider-specific raw data

## Mascot motion

Danwoong behavior:
- idle: quiet
- focus start: brief run-in
- focus: running state with minimal distraction
- pause: stop/sit
- completion: short sprint/jump/reaction

Do not let Danwoong continuously wander around the desktop.

## Feature priority

Current priority order after the schedule foundation:

1. import actual 2026-2 timetable
2. e-Campus/iCal integration
3. sync/dedup/reconciliation
4. Calendar
5. Decision Engine v1
6. Last Safe Start
7. Week / Tasks
8. Windows production polish
9. final Danwoong animation
10. optional AI enhancements

Notes is intentionally lower priority.
