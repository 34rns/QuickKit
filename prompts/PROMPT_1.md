# PROMPT 1 — Part 1: scaffold, installer, UI shell

**STATUS: DONE** (verified in code; loading inside AE/PPro still UNTESTED)

**Provenance:** This prompt was given in an *earlier chat session* whose
transcript is not preserved in the current conversation, so the original
word-for-word text is **not available**. The scope below is reconstructed from
the durable project record (`PROGRESS.md` → "Completed parts", `README.md`,
`docs/manual-test-checklist-part1.md`, and the `6c64031 Initial commit:
QuickKit 0.3.0` git commit). Do not treat the scope text below as a verbatim
quote.

## Reconstructed scope (not verbatim)
- Create the QuickKit project: one CEP extension (HTML/JS panel + ExtendScript
  host) with a single manifest targeting After Effects and Premiere Pro.
- Folder layout per `PROJECT_RULES.md`: `extension/`, `host/`, `design/`,
  `scripts/`, `docs/`, `tests/`.
- Installer (`scripts/install.bat`) that copies `extension/`, `design/` and
  `host/` into `%APPDATA%\Adobe\CEP\extensions\QuickKit`, enables
  `PlayerDebugMode`, and can uninstall.
- Panel shell: header, tabs, tooltips, welcome overlay, host-info block,
  "Test host connection" button, minimal original bridge (no Adobe CSInterface.js).
- Design system: `design/tokens.css` (dark theme, one accent #7C5CFF),
  `design/DESIGN_SYSTEM.md`, bundled Inter fonts, original 16x16 icon set.
- Static test harness `tests/check-static.js`.
- Docs: README, licenses (`docs/ASSET_LICENSES.md`), manual checklist part 1.

## Verification (performed 2026-10-26 during handoff setup)
- `node tests/check-static.js` → 34 passed, 0 failed.
- Files present: `extension/CSXS/manifest.xml`, `extension/index.html`,
  `extension/js/panel.js`, `extension/js/csinterface-lite.js`,
  `design/tokens.css`, `design/icons/icons.js`, `scripts/install.bat`,
  `docs/manual-test-checklist-part1.md`.
