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

- Rules-based v1 is the approved implementation; AI scheduling is out of scope.
- Goal is one recommended Current Quest, not a ranked dashboard full of options.
- Candidates are unfinished StudyTasks and virtual open Assignments without an executable linked StudyTask. Fixed Events and recurring classes are free-time constraints, not candidates.
- The 100-point score is urgency 45, fit before the next fixed schedule 25, normalized priority 20, and continuity/checklist progress 10. `now` is injected into the pure scorer.
- A running or paused FocusSession hard-locks its task. Without active focus, a valid current recommendation changes only when a challenger is at least 8 points higher; initial ties are deterministic.
- Under 15 minutes before the next fixed item, return non-focusable `prepare_next_event` instead of starting a new task.
- DecisionResult retains raw component scores and reason codes, while user-facing Main/PIP copy shows at most three reasons and never exposes the raw score.
- Starting a virtual Assignment recommendation lazily and atomically creates/reuses an executable StudyTask linked by `assignment_id`; the two domains remain separate.
- Last Safe Start v0.1 uses deadline minus remaining estimated work across fixed-busy schedule windows. It preserves source-local DATE-only semantics and returns no timestamp when estimate or deadline is missing.

## Week, Tasks, and Focus Stats

- Week is a Monday–Sunday read surface over recurring Semester occurrences, one-off Events, open Assignments, and unfinished StudyTask deadlines. It does not auto-schedule study blocks.
- An open Assignment is hidden when an executable linked StudyTask exists; Assignment and StudyTask remain separate records.
- Tasks is one user-facing list with overdue, today, this week, later, no deadline, and completed groups. Assignment priority/estimate remain StudyTask concerns, so a virtual Assignment exposes deadline/status actions and receives task-specific fields only after Start materializes it.
- Tasks Start checks for an active FocusSession before Assignment materialization. The database single-active constraint remains the final concurrency guard.
- Focus statistics are derived from persisted running intervals, not total wall-clock session span. Local Monday/week and midnight boundaries are applied at the UI/service boundary, and paused/offline time is excluded.
- Week/Tasks retain the approved Main titlebar, navigation, warm palette, typography, and two-column hierarchy. Acrylic/transparency behavior is unchanged.

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

## iCal missing-item reconciliation gate

Decision date: 2026-09-18. Status: `UNVERIFIED`; missing-item reconciliation remains disabled.

Official meaning:

- The [Canvas Calendar feed guide](https://community.instructure.com/en/kb/articles/662804-unknown) says the export contains only the previous 30 days and next 366 days, is capped at 1,000 items, excludes To Do items, and can require re-import after a new course enrollment. It does not state that an omitted UID means deletion.
- The [Canvas upstream feed implementation at the reviewed revision](https://github.com/instructure/canvas-lms/blob/1c9f0bb8013ed69c4f2efe11fd483025469b7e6c/app/controllers/calendar_events_api_controller.rb#L1157-L1275) applies the same moving time window and per-query limit before serializing `METHOD:PUBLISH`. It exposes no completeness, truncation, generation, or deletion-tombstone marker. The institution deployment version and customizations are not established by this upstream source.
- [RFC 5545 section 3.6](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6) allows an iCalendar object to carry one or more components; the file format alone does not prove a complete provider snapshot. [RFC 5546](https://www.rfc-editor.org/rfc/rfc5546.html#section-3.2.1) defines `PUBLISH` separately from explicit cancellation, so absence from a published feed is not itself a deletion signal.
- [RFC 9110 section 15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#name-304-not-modified) defines `304 Not Modified` as reuse of the stored representation. It has no response content and must never be treated as an empty snapshot.

Actual observation:

- The redacted real-feed QA observed one supported calendar item classified as an Assignment and then a conditional 304 with stable identities. No deletion or omission transition was observed, and user data was not deliberately removed for testing.
- Stable repeated responses demonstrate conditional caching and idempotency only. They do not prove completeness or define the meaning of a missing item.

Code assumptions and fail-closed policy:

- `sync_generation` is a counter for successfully applied HTTP 200 representations, not proof of an authoritative generation.
- A 304 reuses the stored representation and may refresh ETag or Last-Modified metadata supplied by the response; an omitted validator is preserved. It does not advance generation, apply a snapshot, emit a data-change event, or run reconciliation. Validator string equality is not treated as a protocol invariant.
- Structural parse failure applies nothing. Item-level unsupported values, duplicate conflicts, ignored auxiliary components, and apply-stage warnings make a response ineligible for any future missing-item reconciliation.
- Missing-item reconciliation may only be considered after all four gates are independently true: successful fetch with representation content, complete parse/apply without partial-processing signals, provider authority confirmed by an applicable official contract, and an explicit local enablement decision. The authority gate is currently false, so the database flag alone cannot authorize deletion.
- Explicit provider cancellation and same-UID type reclassification remain separate update signals. Mere absence never tombstones Event, Assignment, recurring rule, exception, Course, or manual data.

## M02 authenticated Assignment enrichment gate

Decision date: 2026-09-23. Status: `NOT READY`; no authenticated detail-enrichment implementation may start until all three Gate A conditions are independently proven.

Approved scope, if the gate is later satisfied:

- Enrich only `description`, `points`, and `submissionType` from the exact Canvas Assignment identified by `course_id + assignment_id`.
- Keep iCal-owned fields, deletion reconciliation, UI redesign, Notes/AI, and notifications out of M02.
- Never request a user-entered Personal Access Token, embed a client secret in the desktop app or repository, store a password, bypass SSO/2FA/CAPTCHA, scrape without authorization, or use title/due-date fuzzy matching.

Gate A-1 — official and permitted Dankook Canvas API path: `UNPROVEN`.

- Dankook's [official e-Campus entry](https://nlms.dankook.ac.kr/login?type=general) and [official LMS notice](https://gslp.dankook.ac.kr/-23?_dku_bbs_web_BbsPortlet_action=view_message&_dku_bbs_web_BbsPortlet_bbsMessageId=102894&p_p_id=dku_bbs_web_BbsPortlet&p_p_lifecycle=0) establish that its LMS is Canvas-based, and unauthenticated responses from `https://canvas.dankook.ac.kr/api/v1/...` identify Canvas REST/OAuth endpoints. Instructure's [Assignments API](https://developerdocs.instructure.com/services/canvas/resources/assignments) documents the read-only endpoint `GET /api/v1/courses/:course_id/assignments/:id` with scope `url:GET|/api/v1/courses/:course_id/assignments/:id`; its Assignment object contains the three approved enrichment fields as `description`, `points_possible`, and `submission_types`.
- Endpoint presence is not permission. [Canvas Developer Keys](https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys) says institution root administrators issue institution keys and control endpoint scopes. No Dankook public policy, app-registration procedure, approved key, or approved minimal Assignment scope for Study OS was found.
- The [Canvas OAuth overview](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth) states that multi-user applications must use OAuth and must not ask users to manually create and enter tokens. A Personal Access Token is therefore not an acceptable fallback.

Gate A-2 — institution-approved OAuth/PKCE for a Windows public client: `UNPROVEN`.

- Current upstream Canvas supports `client_type=public`: [the official Developer Keys resource](https://developerdocs.instructure.com/services/canvas/resources/developer_keys) says public SPA/mobile clients require PKCE, cannot use `client_credentials`, and receive short-lived access tokens with rotating refresh tokens. The reviewed upstream implementation accepts PKCE `S256` and allows an approved public Developer Key to exchange and refresh without a client secret ([authorization controller](https://github.com/instructure/canvas-lms/blob/1c9f0bb8013ed69c4f2efe11fd483025469b7e6c/app/controllers/oauth2_provider_controller.rb#L35-L49), [public-client authorization grant](https://github.com/instructure/canvas-lms/blob/1c9f0bb8013ed69c4f2efe11fd483025469b7e6c/lib/canvas/oauth/grant_types/authorization_code_with_pkce.rb#L19-L27), [public-client refresh grant](https://github.com/instructure/canvas-lms/blob/1c9f0bb8013ed69c4f2efe11fd483025469b7e6c/lib/canvas/oauth/grant_types/refresh_token.rb#L8-L35)).
- Dankook's deployed static [OAuth overview](https://canvas.dankook.ac.kr/doc/api/file.oauth.html) and [OAuth endpoint documentation](https://canvas.dankook.ac.kr/doc/api/file.oauth_endpoints.html) report `Last-Modified: 2021-02-15` in their HTTP responses, document only the older client-secret/OOB native flow, and do not document PKCE. The runtime may be newer, but its deployed version and public-client configuration are not externally proven.
- No institution-approved Study OS `client_id`, `client_type=public` registration, exact native redirect URI, minimal read scope, or secretless refresh contract has been obtained. A confidential key cannot be embedded in a public desktop client.

Gate A-3 — explicit stable iCal Assignment to Canvas ID mapping: `UNPROVEN`.

- [RFC 5545 UID](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.4.7) identifies an iCalendar component; it does not define Canvas `course_id` or `assignment_id`. The [Canvas Calendar feed guide](https://community.instructure.com/en/kb/articles/662804-unknown) does not publish a UID/URL/X-property-to-API-ID contract.
- The reviewed upstream feed implementation encodes the course context as `include_contexts=course_<id>` and a base Assignment ID in the calendar URL fragment and `event-assignment-<id>` UID, but an applied due-date override changes the UID to `event-assignment-override-<override_id>` ([implementation](https://github.com/instructure/canvas-lms/blob/1c9f0bb8013ed69c4f2efe11fd483025469b7e6c/app/models/calendar_event.rb#L838-L860)). This is strong implementation evidence, not a stable public contract for Dankook's unknown deployment/customizations; UID parsing alone is wrong for overrides.
- Study OS currently hashes the feed UID into its external identity and does not persist provider `assignment_id`. Existing redacted real-feed QA retained only property-name buckets, not identifier values, so it proves classification and idempotence but not an exact crosswalk.

Official next path:

1. Contact the Dankook Digital Learning team through the [official e-Campus contact path](https://nlms.dankook.ac.kr/login?type=general) and obtain written confirmation from the root-account administrator or another authorized official that Study OS may use the Canvas API and receive an institution-scoped, minimal read-only public Developer Key.
2. Obtain the approved `client_type=public` PKCE `S256` flow, exact native redirect URI, secretless code exchange and rotating refresh behavior, and data-handling/distribution conditions.
3. Obtain a documented identifier contract for the deployed iCal feed, including Assignment overrides. After OAuth approval, validate only exact provider identifiers against the official Calendar Events/Assignments API. Require an unambiguous exact match and skip enrichment otherwise.
4. Re-run Gate A. Only if all three conditions pass may M02 implement the three approved fields.

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
5. Week / Tasks
6. Windows production polish
7. final Danwoong animation
8. optional AI enhancements

Notes is intentionally lower priority.
