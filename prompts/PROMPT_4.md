# PROMPT 4 — connection crash fix + PART 4: preset manager

**STATUS: DONE — all 6 sprint steps complete** (verified in code; in-app /
After Effects behaviour still UNTESTED; manual checklist written)

**Provenance:** Current chat session. Verbatim text preserved below exactly as
given (including the leading sentence and the images that were attached — two
screenshots of the failing panel, paths under
`C:\Users\siamr\AppData\Local\Temp\freebuff-desktop-pastes\`).

## Verbatim prompt text
> nothing is working not connecting if connects it shows that script problem
> fix them and do after  RESUME: Read PROJECT_RULES.md and PROGRESS.md first.
> Summarize status in 3 lines. Then do PART 4 only.
>
> PART 4: Preset manager
> - PRESETS tab: save selected layers or properties as a preset with an
>   auto-generated thumbnail.
> - Folders, search, favorites, rename, delete, drag to reorder.
> - Import and export a preset pack as a single file.
> - Click to apply. Stored locally in %APPDATA%\QuickKit\presets.
> - Ship 15 original starter presets that you create yourself (no
>   third-party assets).
> - Handle corrupted preset files without crashing.
> - Empty state when there are no presets.
>
> Give me a manual test checklist, update PROGRESS.md, and STOP.

## Sprint steps (as specified by the user for this prompt) — all verified

| # | Step | Status | Verified how |
|---|---|---|---|
| 1 | Fix ExtendScript reserved-word crash and add ES3 guard; verify connection path | DONE | `host/quickkit.jsx:1505` now `tooShort:` (was `short:`); `tests/check-static.js:208` `es3ReservedHits()` + self-test at line 279; `node tests/check-static.js` passes |
| 2 | Implement host preset storage, capture/apply, starters, import/export | DONE | `qkPreset*` functions at `host/quickkit.jsx:1986–3802` (`qkPresetRootPath`, `qkPresetSave`, `qkPresetApply`, `qkPresetSeedStarters`, `qkPresetExport`, `qkPresetImport`, …) |
| 3 | Build Presets panel UI and wire actions | DONE | `extension/index.html:154` `#qk-panel-presets`; `extension/js/panel.js` preset functions at lines 1044–2011 (`renderPresets`, `createPresetCard`, `savePreset`, `applyPreset`, `importPack`, `exportVisiblePresets`, `createFolder`, `deleteFolder`, drag reorder) |
| 4 | Extend mock host and static tests; run all checks | DONE | `node tests/check-static.js` → 34 passed; `node tests/host-logic.test.js` → 75 passed; both exit 0 |
| 5 | Install, verify UI with fake bridge and layouts, bump to 0.4.0 | DONE | `scripts/install.bat` updated + run; fake-CEP preview served from `tests/.preview/` (fake-cep.js); `manifest.xml` `ExtensionBundleVersion="0.4.0"`; static check "manifest and panel both report version 0.4.0" passes; layout measured at 240/600px |
| 6 | Write Part 4 checklist and update PROGRESS/README/docs | DONE | `docs/manual-test-checklist-part4.md` (147 lines), `PROGRESS.md`, `README.md` (v0.4.0), `docs/releasing.md` |

## Part 4 plan details (all implemented — verified in code)
- **Preset capture:** property rows selected → capture only those; otherwise
  capture selected layers' transform, text style, effect parameters, static
  values and keyframes (`qkPresetCaptureSelected`, `qkPresetCaptureLayer`).
- **Apply:** one undo group, replaces captured properties, one-layer preset
  applies to every selected layer, multi-layer maps in order (`qkPresetApply`).
- **Storage:** `%APPDATA%\QuickKit\presets`, one `.qkpreset` JSON file per
  preset, `folders.json` for logical folders, `.seeded` marker
  (`qkPresetRootPath`, `qkPresetLoadStore`).
- **Folders / search / favourites / rename / delete / drag reorder:**
  `qkPresetMove`, `qkPresetFavorite`, `qkPresetRename`, `qkPresetDelete`,
  `qkPresetReorder`; panel side `renderPresets`, `reorderPresets`,
  `visiblePresets`.
- **Import/export single file:** `.qkpack` JSON, new ids on import, duplicate
  names suffixed, small JSON parser — never evaluates code
  (`qkPresetExport`, `qkPresetImport`, `importPack`, `exportVisiblePresets`).
- **15 original starter presets:** created in-repo (no third-party assets),
  seeded once via `qkPresetSeedStarters` + `.seeded`.
- **Corruption handling:** bad preset / folders files skipped with a note,
  bad packs return a readable sentence (`qkPresetLoadOne`,
  `qkPresetNormalize*`).
- **Empty states:** no host / no presets / empty folder / no favourites / no
  search matches (`showPresetEmpty`).
- **Auto thumbnail:** data tile from glyph + saved colour + motion flag
  (`qkPresetThumbnail`, `presetColorCss`, `presetGlyph`) — generated, not a
  rendered frame.
- **Manual checklist:** `docs/manual-test-checklist-part4.md`.

## Known limitation carried forward
Everything touching the real app (connection fix, preset capture/apply, file
dialogs, text animators) is **UNTESTED in After Effects** until the Part 4
checklist is walked through.
