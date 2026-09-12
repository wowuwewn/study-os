# Study OS Visual Baseline v0.1

This document records the approved baseline for future iteration. It is not the final product design.

## Roles

- Main Study OS: the primary daily planning surface, organized around a vertical Today timeline, today's tasks, and a focused quest detail panel.
- PIP Quest Tracker: a small always-on-top current-quest surface for time, progress, start/pause, completion, and the next event. It is not a scaled-down Main window.

## Approved Figma sources

- Main: https://www.figma.com/design/iGwFUSJ5NJh3Jl9XVw2T6p?node-id=44-216
- PIP: https://www.figma.com/design/iGwFUSJ5NJh3Jl9XVw2T6p?node-id=44-311
- Composition reference: https://www.figma.com/design/iGwFUSJ5NJh3Jl9XVw2T6p?node-id=44-10

Old nodes `30:5` and `41:3` are not approved references.

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
- PIP window
  - compact header and window controls
  - status/time
  - current quest
  - progress track and replaceable Runner marker
  - start/pause and completion controls
  - elapsed time
  - next event footer

## Future references

- Calendar: node `44:333`.
- Quick Add: node `44:387`.

Calendar and Quick Add are future work and are not part of Visual Baseline v0.1 implementation.
