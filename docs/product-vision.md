# Study OS — Product Vision

## Product promise

학교생활에 필요한 일정·과제·공부를 한곳에 모으고, 앱을 보는 순간 **지금 무엇을 해야 하는지** 결정해주는 Windows 데스크톱 앱.

Success criterion:

> 사용자가 약 2초 안에 “지금 할 한 가지”를 알 수 있어야 한다.

Study OS is not a generic dashboard, generic todo app, generic calendar, or AI chat wrapper.

## Core loop

**Capture → Decide → Focus → Record → Sync**

1. **Capture** — Quick Add and external sources collect commitments with minimal friction.
2. **Decide** — Study OS chooses the best next action from schedule, deadlines, available time, task estimate, progress, and importance.
3. **Focus** — Main/PIP/Pet provide a focused execution surface without becoming a large dashboard.
4. **Record** — FocusSession persists actual study time, pause/resume state, completion, and task progress.
5. **Sync** — School data flows in automatically, beginning with official iCal and later authenticated e-Campus detail retrieval where needed.

## Primary surfaces

### Main
- Today-first layout.
- Vertical timeline with NOW marker.
- Current Quest is visually dominant.
- Next fixed event and remaining tasks are secondary.
- Right-side quest detail contains duration, checklist, start/pause, and memo.
- Tabs: Today / Week / Tasks / Notes.
- Notes is lower priority than the execution loop.

### PIP
Three states:
- Compact PIP
- Expanded PIP
- Pet Mode

The PIP exists to keep the current quest visible without obstructing work.

### Pet Mode
Danwoong is a **focus-state visualization**, not a static logo or decorative mascot.

Principle:

> 정지 위치 = 상태, 움직임 = 이벤트.

No random wandering across the desktop. Motion should communicate focus start, running, pause, milestone, and completion.

### Quick Add
Keyboard-first global capture surface.

Current default shortcut:
`Ctrl+Shift+Space`

Target interaction:
shortcut → type → Enter → saved.

## Decision Engine

The defining Study OS feature is not “student planner” but:

> 학생의 시간표·마감·학습상태와 다음 고정 일정까지 남은 시간을 보고, 지금 할 한 가지를 결정한다.

Decision Engine v1 should be rules-based before AI.

Initial factors:
- deadline urgency
- course/task importance
- time until next fixed event
- estimated task duration
- task progress/status
- current focus state

The recommendation should explain itself in compact language, for example:

> 다음 수업까지 52분 · 예상 40분 · 이번 주 미완료

Later enhancement:
- deadline risk
- estimated vs actual duration
- workload awareness
- Last Safe Start

## Data sources

Priority sources:
1. Manual / Quick Add
2. Actual semester timetable
3. Official e-Campus iCal
4. Authenticated e-Campus detail retrieval when needed
5. LIKELION / personal study sources

External data must normalize into Study OS domain concepts rather than leaking provider-specific shapes into the UI.

## Domain meaning

Keep these concepts separate:

- **Event** — something fixed on the timeline.
- **Assignment** — an obligation with an external or academic deadline.
- **StudyTask** — the concrete action the user can perform.
- **FocusSession** — what was actually worked on and for how long.
- **RecurringScheduleRule** — source of truth for repeating class meetings.

This separation exists to support recommendation logic.

## e-Campus direction

The product should minimize the need to manually visit e-Campus.

Integration order:
1. Official iCal first for deadlines/exams/calendar data.
2. Sync/dedup/reconciliation.
3. Authenticated browser/session-based retrieval only for details that iCal cannot provide, such as notices, assignment descriptions, weekly learning, or grading state.

Security:
- never commit passwords, cookies, session tokens, private iCal URLs, or credentials
- prefer local app-data/config
- no CAPTCHA bypass
- no aggressive polling

## Visual direction

- Bright, warm/off-white Main.
- Dark navy/slate Acrylic PIP.
- Powder blue, sage, subtle peach, navy typography.
- Current typography baseline: Jua + Gowun Dodum.
- Avoid generic SaaS dashboards, card grids, excessive pills, gradients, and oversized headings.
- State should be communicated with position, color, and motion rather than color alone.
- Approved Figma implementation targets remain the visual source of truth.

## Technology

Core stack:
- Tauri 2
- React
- TypeScript
- Vite
- SQLite
- Motion for React where motion adds value

Use DOM/CSS for stable UI. Canvas/WebGL should be exceptional, not the default.

## Functional-complete target

A functionally complete Study OS should include:

- actual semester timetable
- Quick Add
- persistent local domain data
- FocusSession persistence/recovery
- Compact/Expanded PIP
- Pet Mode
- official iCal/e-Campus ingestion
- sync/dedup/reconciliation
- Calendar
- Decision Engine
- Last Safe Start / deadline risk
- Week and Tasks views
- focus statistics / estimated vs actual duration
- Windows polish: tray/startup/window positioning/multi-monitor/settings/release QA
- final Danwoong animation
- installer/release packaging

AI is a later layer, not the product foundation.

Possible later AI features:
- assignment decomposition
- syllabus/PDF extraction
- duration estimation
- richer natural-language Quick Add
- review-plan generation

## Priority

When tradeoffs are necessary, prioritize:

1. automatic school-data ingestion
2. current-quest decision quality
3. fast capture
4. focus execution
5. reliability and local persistence
6. visual polish
7. AI extras
