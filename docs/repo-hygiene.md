# Repository hygiene

Study OS keeps source, migrations, active assets, current specifications, test scripts, and package/configuration files in Git. Reproducible build output, caches, local databases, logs, editor state, and temporary QA output stay ignored.

## Classification used in this cleanup

1. **Keep:** `src/`, `src-tauri/src/`, numbered migrations, the referenced PIP control asset, current docs, validation/QA scripts, package/lock/config files, Tauri icons, and the current milestone QA set below.
2. **Ignore as generated:** `node_modules/`, `dist/`, `src-tauri/target/`, generated Tauri schemas, coverage/cache/temp folders, logs, local SQLite files, environment files, and OS/IDE state.
3. **Remove as obsolete:** superseded Main/PIP/debug QA captures, unused create-tauri-app logo assets, and unreferenced duplicate Danwoong SVG exports.
4. **Preserve when uncertain:** the template-oriented `README.md` and the complete Tauri platform icon set remain until their replacement or packaging requirements are confirmed.

## Safe cleanup

Run `npm run clean` to remove only the explicit generated-path allowlist in `scripts/clean-generated.mjs`. It removes frontend/Rust build output, tool caches, generated Tauri schemas, and dedicated temporary QA directories. It intentionally does not remove dependencies, source, migrations, docs, active assets, configuration, approved QA screenshots, or local application data stored outside the repository.

## Current QA set

- Main Visual Baseline v0.1: `qa/baseline-v01-main-fix.png`
- PIP v0.2: `qa/pip-v02-compact.png`, `qa/pip-v02-expanded.png`
- Pet Mode: `qa/pet-v02-idle.png`, `qa/pet-v02-focus.png`
- Quick Add v0.1: `qa/quick-add-v01-empty.png`, `qa/quick-add-v01-parsed-task.png`, `qa/quick-add-v01-parsed-event.png`

Before deleting an unreferenced file, check code, documentation, package/configuration, and Git history. Preserve and report anything whose purpose or recovery risk remains unclear. Numbered database migrations are permanent history and are never cleanup targets.
