# Study OS Repository Guidelines

- Approved Figma nodes are the visual source of truth.
- Main source: Figma node `44:216`.
- PIP v0.2 sources: Compact `46:5`, Expanded `46:26`, Pet states `46:48`.
- PIP node `44:311` is deprecated and must not be used as the implementation source.
- Do not use old nodes `30:5` or `41:3` as visual references.
- Do not reinterpret Study OS as a generic SaaS dashboard.
- Do not proliferate cards or pills beyond the approved Figma design.
- Main is centered on the daily vertical timeline.
- PIP modes are `compact`, `expanded`, and `pet`; Compact and Expanded share the `pip` window.
- PIP is centered on the current quest.
- Pet Mode is a focus-state indicator, not a decorative mascot widget.
- This is a public repository. Never commit secrets.
- Never add private e-Campus URLs, tokens, passwords, or personal credentials.
- Visual work requires QA in the actual Windows Tauri application.
- Do not unnecessarily rewrite working behavior for a visual-only change.
- Keep `Event`, `Assignment`, `StudyTask`, and `FocusSession` as separate domain concepts.
- UI components must use repository/service APIs and must not embed SQLite queries.
- Persist timestamps as UTC ISO 8601 strings and convert them to local time only at the UI boundary.
- Database schema changes require numbered migrations under `src-tauri/migrations/`.
- Quick Add natural-language parsing must remain local and deterministic; do not use AI or remote APIs.
- Recurring schedule rules are the source of truth; model one-date cancellations, moves, or overrides as exceptions instead of editing the rule.
- Remove temporary files created during feature work before that work ends.
- Remove deprecated implementations only after the replacement is approved and references are checked.
- Do not accumulate unused duplicate components or files.
- Never commit build, cache, or generated artifacts.
- Never delete a migration merely because it is old.
- Keep only the minimum QA screenshots required for the current milestone.
- If deletion safety is unclear, preserve the file and report it.

## Autonomous Task Loop

For new feature work, follow this loop by default:

1. Read `docs/project-state.md` and relevant documentation to recover the current state.
2. Inspect the actual repository, code, and Git state.
3. Make the minimum necessary design plan.
4. Implement while preserving the existing architecture.
5. Run the relevant automated tests.
6. For features that require real Tauri/Windows behavior, perform QA in the actual application.
7. For UI work, compare screenshots against the approved Figma source of truth.
8. If a failure or an obvious visual issue is found, perform up to two self-correction iterations.
9. Clean up obsolete and temporary files from the current work according to the repository hygiene rules.
10. Run the full build and test regression checks.
11. Update `docs/project-state.md` to reflect the actual completed state.
12. Report only the final result, concisely.

When confidence is low or context is incomplete, do not guess from earlier chat history. Recover the current state by rechecking the repository, Git diff and log, `AGENTS.md`, and `docs/project-state.md`.

Wait for user approval only in these cases:

- Changing an existing approved Figma source of truth.
- Making a major database or domain architecture change.
- Deleting migrations or making destructive data changes.
- Changing credential, authentication, or security policy.
- Performing an actual write or action against an external service.
- Introducing a breaking change to existing behavior.

When subagent or reviewer capabilities are available, use them for independent review or testing. When they are unavailable, perform the same verification sequentially.
