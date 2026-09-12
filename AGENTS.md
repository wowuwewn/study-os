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
