# Real Schedule Foundation

## Model

`Semester` stores `name`, inclusive `starts_on` / `ends_on` dates, and an IANA `timezone`. It may optionally carry `(source_id, external_id)`, so future terms and imported providers do not require schema changes.

`RecurringScheduleRule` belongs to one Semester and one Course. It stores weekday using JavaScript's `0 = Sunday` through `6 = Saturday`, `HH:mm` start/end wall-clock values, location, and optional source/external identifiers. Existing one-off `Event`, `Assignment`, and `StudyTask` meanings do not change.

`RecurringScheduleException` identifies the rule and original `occurrence_on` date. Its status is:

- `cancelled`: omit that occurrence.
- `moved`: use the required replacement start and optional replacement end.
- `overridden`: keep the original time unless replacement timestamps are supplied, while allowing title/location/notes changes.

A one-date change never edits the recurring rule.

## Occurrence strategy

Rules are the source of truth and occurrences are calculated at query time for a bounded UTC range. Today and future Calendar queries can therefore generate only the dates they need, with no occurrence rows to deduplicate or keep synchronized. The range query merges generated classes with stored one-off Events and sorts the combined result by UTC start time.

This keeps v0.1 smaller than a materialization engine. The exception table handles cancellations, moves, and overrides; a moved exception is also checked by replacement timestamp so a class moved in from another date is not missed. If a future Calendar needs caching, generated occurrences can be cached without changing the rule/exception contract.

## Timezone policy

Semester timezone is an IANA identifier such as `Asia/Seoul`. Rule times retain their local wall-clock meaning across timezone offsets. Query-time generation resolves each `(local date, local time, semester timezone)` to a UTC ISO 8601 timestamp. One-off Events continue to persist UTC timestamps. Today uses the operating system's local calendar-day bounds, then compares all occurrences on the UTC timeline.

## Import format

[`semester.example.json`](../semester.example.json) is the public, dummy-data template. Personal files should be named `semester.local.json`, `semester.*.local.json`, or placed under `local-schedule/`; those locations are ignored by Git.

The version 1 document contains one `semester` and an array of courses. Each course contains `meetings` with `weekday`, `startLocalTime`, `endLocalTime`, and optional location/external ID. Application code passes parsed JSON to `importLocalSemesterSchedule`, or raw JSON text to `importLocalSemesterScheduleJson`.

Import validates the whole document before writing, then performs:

1. manual Source lookup;
2. Semester upsert;
3. Course upsert;
4. recurring rule upsert.

Stable source/external IDs are preferred. When absent, documented natural keys are used. Database unique indexes provide a second duplicate guard, so importing the same file repeatedly reuses existing IDs.

Validation rejects reversed semester dates, weekdays outside 0–6, malformed or non-increasing local times, empty course names, invalid IANA timezone identifiers, duplicate external IDs, and duplicate natural rules in one document.

## Reuse by later features

- Today calls `listTodaySchedule(now?)`.
- Calendar can call `listScheduleOccurrencesBetween(startAt, endAt)` for any bounded range.
- Decision Engine can consume the same sorted `ScheduleOccurrence[]` without knowing whether an item came from an Event or a recurring rule.
- iCal/e-Campus adapters can upsert providers by `(source_id, external_id)` and populate rules/exceptions, while isolated instances remain ordinary Events.
