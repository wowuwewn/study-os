# Study OS Visual Baseline v0.1 and PIP v0.2

This document records the approved baseline for future iteration. It is not the final product design.

## Roles

- Main Study OS: the primary daily planning surface, organized around a vertical Today timeline, today's tasks, and a focused quest detail panel.
- PIP Quest Tracker: an always-on-top current-quest surface with Compact, Expanded, and Pet modes. It is not a scaled-down Main window.

## Approved Figma sources

- Main: https://www.figma.com/design/iGwFUSJ5NJh3Jl9XVw2T6p?node-id=44-216
- PIP Compact: https://www.figma.com/design/iGwFUSJ5NJh3Jl9XVw2T6p?node-id=46-5
- PIP Expanded: https://www.figma.com/design/iGwFUSJ5NJh3Jl9XVw2T6p?node-id=46-26
- Pet states: https://www.figma.com/design/iGwFUSJ5NJh3Jl9XVw2T6p?node-id=46-48
- Composition reference: https://www.figma.com/design/iGwFUSJ5NJh3Jl9XVw2T6p?node-id=44-10

Old nodes `30:5` and `41:3` are not approved references. PIP node `44:311` is deprecated by PIP v0.2.

## Typography

- Use Jua for expressive quest and section headings where the approved frames specify it.
- Use Gowun Dodum for navigation, scheduling data, controls, metadata, and body text.
- Include fonts only through a license-safe, reproducible project dependency. Do not create fake font files or download files of unclear provenance.

## Color direction

- Main: warm off-white surfaces, deep navy text, restrained powder blue actions, light beige current-quest emphasis, sage/peach status accents, and quiet cool-gray dividers.
- PIP: dark navy/slate surfaces, warm off-white primary text, muted blue-gray secondary text, and a thin mint progress/status accent.
- Avoid gradients, electric blue, excessive shadows, and unapproved decorative color.

## Component hierarchy

- Main window
  - titlebar
  - navigation
  - Today timeline
    - schedule rows
    - current-time row
    - current-quest card
    - next event
  - today's tasks
  - footer phrase
  - independent quest detail panel
    - study label
    - title and subtitle
    - three metadata rows
    - checklist
    - full-width start/pause button
    - memo area
- PIP v0.2
  - `compact`: 312×116 logical px, current quest, elapsed/total time, progress, start/pause, next event
  - `expanded`: the same `pip` window resized to 312×194 logical px, adding subtitle and a short checklist
  - `pet`: a separate transparent 56×56 logical px always-on-top window with no panel, border, header, or text
  - one timer/session source of truth remains in the `pip` window and synchronizes Pet state through Tauri events
  - Compact and Expanded retain Windows Acrylic; Pet intentionally has no Acrylic to avoid a visible rectangle
  - Pet single click restores Compact, double click opens and focuses Main, and drag moves the Pet window

Pet Mode is a focus-state indicator, not a decorative mascot. Its motion communicates `idle`, `running`, `paused`, and `completed` state while staying at a static desktop position.

## Additional feature references

- Calendar: node `44:333`.
- Quick Add v0.1: node `44:387`; implementation details are recorded in `docs/quick-add.md`.

Calendar node `44:333` is implemented as an independent 311×433 widget. The v0.1 data-display requirements add restrained day markers and a selected-date agenda state while retaining the source node's geometry, palette, typography, and three-row lower information area. Quick Add remains an independent capture surface. Neither feature changes the approved Main/PIP visual baseline.
