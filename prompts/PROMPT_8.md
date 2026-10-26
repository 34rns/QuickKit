# PROMPT 8 — PART 6A: Unified library engine + folder management

**STATUS: DONE** (2026-10-26) — Part 6A built and installed as 0.7.0. Engine and store tested by `node tests/library.test.js` (18/18) and the static suite (96/96); the UI was verified in the browser preview in both host modes with no console messages. Real CEP behaviour (require in CEP, native dialogs, `file://` thumbnails, real-mouse drag & drop, migration of the real Part 4 presets) is **UNTESTED** — see `docs/manual-test-checklist-part6a.md`. Applying library items is out of scope here and arrives in 6B/6C.

Verbatim user prompt (2026-10-26):

> RESUME: Read PROJECT_RULES.md and PROGRESS.md first. Summarize status in
> 3 lines. Confirm Parts 1-6 are marked tested and list any known bugs.
> Add a section "Library expansion (Parts 6A-6E)" to PROGRESS.md. Then do
> PART 6A only.
>
> PART 6A: Unified library engine + folder management
> Goal: one library that works in both After Effects and Premiere, like a
> professional preset manager.
>
> 1. STORAGE: %APPDATA%\QuickKit\library\ with:
>    - library.json (index) and one folder per item containing item.json,
>      the asset file, and preview files.
>    - Item types: ae-preset (.ffx or QuickKit JSON recipe), mogrt,
>      pr-recipe (keyframe recipe JSON for Premiere clips), pack.
>    - item.json fields: id, name, type, category, tags[], favorite,
>      hostSupport ["AEFT","PPRO"], createdAt, usageCount, lastUsed,
>      previewVideo, previewThumb, author, license, notes.
>    - Version the schema and write a migration that imports my existing
>      Part 4 presets without losing any.
> 2. FOLDERS: nested folders, create/rename/delete/move, drag and drop items
>    between folders, a "Smart collections" list (Favorites, Recently used,
>    Most used, Untagged, Text, Transitions, Shapes).
> 3. SEARCH AND FILTER: instant search by name/tag, filter by type, host
>    support, category. Sort by name, date, usage.
> 4. SHARING: export a folder or selection as a .qkpack (zip with manifest),
>    import with conflict handling (skip, replace, keep both).
> 5. UI: grid and list view, adjustable thumbnail size slider, breadcrumb,
>    right-click context menu, multi-select, empty states, keyboard
>    shortcuts (Delete, F2 rename, Ctrl+F search). Follow the design system.
> 6. Items not supported in the current host appear dimmed with a tooltip.
> 7. Corrupted or missing files must not crash anything. Add a "Repair
>    library" button that rebuilds library.json from disk.
>
> Run what you can, give me a manual test checklist for both apps, update
> PROGRESS.md, and STOP.
