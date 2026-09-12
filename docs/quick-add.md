# Quick Add v0.1

Quick Add is a separate hidden Tauri window (`quick-add`, 810 × 126 logical pixels) for keyboard-first task and event capture. Open it globally with `Ctrl+Shift+Space` or from Main's existing **추가** control. `Escape` hides the window without saving; `Enter` saves a valid parse and then hides it. `Tab` toggles the inferred type between 할 일 and 일정.

## Parsing rules

Parsing is local, deterministic TypeScript in `src/features/quick-add/parser.ts`. It never calls AI or a remote API.

- Dates: 오늘, 내일, 모레, weekdays, 이번 주/다음 주 weekdays, `M/D`, `M월 D일`
- Times: 오전/오후, `N시`, `N시 M분`, and `HH:MM`
- Deadlines: `까지`, `마감`
- Durations: `N분`, `N시간`, `N시간 N분`
- Task signals include 과제, 복습, 예습, 공부, 학습, 문제, 풀기, 읽기, 정리, 암기, 연습.
- An explicit deadline always produces a `StudyTask`; a date and time otherwise form an event candidate.
- `1–7시` without 오전/오후 follows the approved v0.1 examples and means afternoon.

Course matching normalizes the input and locally stored course names/codes. No match is saved as `course_id = null`. Data is persisted only through repository APIs with a get-or-created `manual` source, then the existing `study-os-data-changed` event refreshes open windows.

Dates are interpreted in the OS local timezone and converted to UTC ISO 8601 at the parser boundary before repository persistence.

## Deliberate v0.1 limits

Recurrence, reminders, fuzzy or semantic course matching, Assignment creation, ambiguous free-form dates, and location extraction are unsupported. A future AI-assisted parser may only be added as an explicit opt-in enhancement; the deterministic parser remains the predictable local baseline and no input is sent remotely in v0.1.

Run parser regression coverage with:

```powershell
npm run test:parser
```
