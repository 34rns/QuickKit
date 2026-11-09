# HANDOFF — QuickKit

**Read this together with `AGENTS.md`, `PROGRESS.md`, `WORKLOG.md` and the
relevant `prompts/PROMPT_N.md`.** Last updated: 2026-10-29 (Prompt 11 → Part 6D,
the Premiere side of the library: MOGRT insert/text, keyframe recipes,
targeting, bin organizer).

---

## 1. What we are building

QuickKit is a **free, local-only CEP extension** for Adobe After Effects and
Premiere Pro: an HTML/JS panel plus an ExtendScript (`.jsx`) host, one manifest
targeting both apps, Windows 10/11 only, no network at runtime.

Current version: **0.10.0** (Parts 0–6, 6A, 6B, 6C and 6D done: shell, AE core
tools, text animations, preset manager, Premiere silence cutter, Premiere ⇄
After Effects bridge, unified library store/UI, select-and-preview pane with
rendered clips and canvas approximations, a data-driven text animation library
with MOGRT export, and the Premiere side of the library — MOGRT insert/text,
18 keyframe recipes, targeting and a bin organizer). Applying a library item now
works in both apps: After Effects applies presets, Premiere applies recipes or
inserts MOGRTs. Everything that touches the real app is still `UNTESTED` until
the manual checklists in `docs/` are walked through.

## 2. Architecture

```
┌──────────────────────────────┐    window.__qk.call(script)    ┌──────────────────────────┐
│ extension/  (Chromium 99 CEP │ ─────────────────────────────► │ host/quickkit.jsx        │
│ panel: index.html, panel.js, │ ◄───────────────────────────── │ ExtendScript in AE/PPro  │
│ csinterface-lite.js bridge)  │        JSON string reply       │ every public fn = qk*()  │
└──────────────┬───────────────┘                                └──────────────────────────┘
               │ require() + child_process
               ▼
      js/ffmpeg-node.js ──spawn(argv, no shell)──► bin/ffmpeg/ffmpeg.exe      (Silence tab)
      js/render-node.js ──spawn(argv, no shell)──► …\Adobe After Effects 2026\Support Files\aerender.exe
                                                                              (Bridge render)
               │ require() + fs / zlib  (no child process)
               ▼
      js/library-io.js ──read/write──► %APPDATA%\QuickKit\library\          (Library tab)
      (rules live in js/library-core.js, a plain <script> load)
```

**Bridge file handoff** (`%APPDATA%\QuickKit\bridge\`):

```
pending\<id>.qkhandoff   Premiere writes  →  After Effects imports (then moves to imported\)
imports\<comp>.json      AE remembers the original timeline position for that comp
renders\<comp>.<ext>     aerender writes the finished file
returns\<id>.qkreturn    AE writes     →  Premiere's Place button (then moves to placed\)
```

- **Panel → host:** `extension/js/csinterface-lite.js` is an original minimal
  bridge (no Adobe CSInterface.js). It evaluates `hostscript` via the CEP
  `evalScript` interface and resolves a Promise with the raw string.
- **Contract:** the panel wraps every call as `qkBridge('<fnName>("…json…")' +
  /* suffix */, cb)` and the host answers with a **JSON string**:
  `{"ok":true,"message":…,…}` or `{"ok":false,"error":…}`. Never let a host
  function return anything else.
- **Undo:** every public host function wraps its work in
  `qkBeginUndo(label)` / `qkEndUndo(started)` — exactly one undo group per
  press, closed even on error.
- **No bundler, no framework, no build step.** Plain ES5-flavoured JS,
  `<script>` tags, `QKIcons.svg(name, size)` for every icon (nothing inlines an
  SVG elsewhere).
- **Install-time assembly:** `scripts/install.bat` copies `extension/`,
  `design/`, `host/` and `bin/ffmpeg/` into
  `%APPDATA%\Adobe\CEP\extensions\QuickKit`, writes `PlayerDebugMode=1`, and
  verifies byte-for-byte.
- **FFmpeg (Premiere only):** `extension/js/ffmpeg-node.js` is loaded with
  `require()` from the panel, never a `<script>` tag, and is one of only two
  files that touch `child_process` (the other is `render-node.js`, the Bridge
  render engine). Every run is `spawn(path, [args])` — no shell, so spaces and
  non-English characters need no quoting. The manifest passes
  `--enable-nodejs` and `--mixed-context` so `require` exists in CEP.
- **Bridge:** the host writes/reads JSON files through `File`/`Folder`; the
  panel only renders `steps[]` and drives `aerender` through `render-node.js`.
  Every bridge entry point returns `{ok, steps:[{id,label,state,detail}], …}`
  so the same list is used for the panel readout and the failure message. No
  host call ever claims the other app did something it did not.
- **Library (Part 6A):** two files, deliberately split. `library-core.js` is a
  plain `<script>` (no Node, no DOM) holding the schema, folder/item rules,
  query, migration, repair and pack planning; it runs in CEP, in Node tests and
  in the browser preview unchanged. `library-io.js` is `require()`d from the
  panel and owns all disk work (`fs`, a hand-written zip via `zlib`) plus the
  public `load/repair/…/importPack` calls. The ExtendScript host does **not**
  touch the library: binary-safe `.mogrt`/pack copying is impossible there.

## 3. File map

| Path | What it is |
|---|---|
| `PROJECT_RULES.md` | Permanent project rules (goal, platform, design binding, honesty rule). Read first. **gitignored** (see §6). |
| `PROGRESS.md` | Master checklist + environment + features table + known bugs + decisions. **gitignored** (see §6). |
| `AGENTS.md` | Standing rules for every AI session in this repo. |
| `HANDOFF.md` | This file: architecture, map, decisions, next actions. |
| `WORKLOG.md` | Reverse-chronological journal, one line per edit/step. |
| `prompts/PROMPT_N.md` | Verbatim prompt archive with status headers. |
| `README.md` | Public-facing docs: what works, install (3 steps), troubleshooting, privacy. |
| `extension/CSXS/manifest.xml` | One manifest, `HostList` = AEFT + PPRO, `[22.0,99.9]`, version 0.10.0, CEF `--enable-nodejs` + `--mixed-context`. |
| `extension/index.html` | Panel markup: header, host block, 8 tabs, one `<section>` per tool (incl. `#qk-panel-library`), the library context menu, dialogs, tooltip, status strip. |
| `extension/js/panel.js` | All panel logic (~7800 lines): tabs, tooltips, welcome, per-tool wiring, presets UI, WAAPI text preview, the engine-driven Text tab (grid, params, live re-apply, MOGRT single/batch), silence tab, bridge tab, library UI, preview pane + generation, text preset seeding, and the Part 6D Premiere preview (targeting, recipe params, MOGRT controls, bin organizer). |
| `extension/js/csinterface-lite.js` | The bridge (`window.__qk.call`). |
| `extension/js/text-presets.js` | Text preset engine (Part 6C), no dependencies: 54 preset definitions in 12 categories, the parameter schema, and `plan()` — the only compiler from preset data + user parameters to numeric key lists. Loaded as a plain `<script>` and by `require()` in tests. |
| `extension/js/pr-recipes.js` | Premiere recipe engine (Part 6D), no dependencies: 18 recipes in 4 categories (Fade, Slide, Scale, Motion) as `motion` descriptors, the four parameters (duration, easing, amount, direction), and `plan()` — the only compiler from recipe data to a JSON key plan. Loaded as a plain `<script>` and by `require()` in tests. |
| `extension/js/preview-core.js` | Preview rules, no DOM: speeds, clock, easing curves, approximation classifier from name/category/tags, `sampleAt()` pose, `planGeneration()` batch filter. Loaded as a plain `<script>`. |
| `extension/js/preview-node.js` | Preview encoder, `require()`d only: frame-name parsing, `%0Nd` pattern vs concat fallback, `videoArgs`/`thumbArgs`, `encode()` with `cancel()`. Spawns ffmpeg, no shell. |
| `extension/js/library-core.js` | Library rules, no dependencies: schema/normalisation, nested folders, search/filter/sort, smart collections, Part 4 migration, repair-from-disk, pack manifest/import planning. Loaded as a plain `<script>`. |
| `extension/js/library-io.js` | Library store, `require()`d only: fs adapter (atomic writes), CRC32 + zip writer/reader, `create({root, legacyRoot})` → `load`, `repair`, folder/item CRUD, `touch`, `exportPack`, `inspectPack`, `importPack`. Never a process. |
| `extension/js/ffmpeg-node.js` | Node side of the Silence tool: `locate`, `probe`, `detect`, `peaks`, `cancel`, parsers, `PeakBuilder`. One of two files that start a process. |
| `extension/js/render-node.js` | Node side of the Bridge render: `locate`/`probe` for `aerender.exe`, `parseVersion`/`parseProgress`/`classifyFailure`, `spawnJob` (line streaming + `cancel()`), `render()`. Real output tested against `aerender 26.5x89`. |
| `extension/css/panel.css` | Shell: grid, header, tabs, status, tooltip, welcome, dialogs. |
| `extension/css/tools.css` | Tool panels: anchors, transforms, easing, text, presets, silence (waveform, progress, segment list), bridge (cards, lists, step dots), library (search, folder tree, cards, menu, dialog), message strip. |
| `host/quickkit.jsx` | The entire host (~9100 lines): helpers, host info, anchor, layers, easing, text engine, data-driven text preset plan executor + MOGRT export (`qkTextPresetApply`, `qkTextPresetMogrt`), preset store, Premiere silence cutter (`qkSilence*`), bridge (`qkBridge*`), library apply + preview generation (`qkLibraryApply`, `qkPreviewGenerate`), and the Part 6D Premiere block (`qkPrContext`, `qkPrRecipeApply`, `qkPrMogrt*`, `qkPrBins`). Marked sections; `$.evalFile` split deliberately avoided. |
| `bin/ffmpeg/` | `NOTICE.txt` + `README.txt` (tracked); `ffmpeg.exe`, `ffprobe.exe`, `VERSION.txt` fetched per machine and **gitignored**. |
| `design/tokens.css` | 126 tokens: dark theme, single accent `#7C5CFF`. Only place raw colours/fonts/radii live. |
| `design/DESIGN_SYSTEM.md` | The binding visual spec (states, spacing, typography). |
| `design/icons/icons.js` | Original 16×16 icon set, `QKIcons.svg()`. |
| `design/fonts/*` | Bundled Inter (OFL), logged in `docs/ASSET_LICENSES.md`. |
| `scripts/install.bat`, `scripts/uninstall.bat` | Copy/clean the extension folder, toggle `PlayerDebugMode`. |
| `scripts/fetch-ffmpeg.ps1` | Copies a local `ffmpeg.exe` (and `ffprobe.exe`) into `bin\ffmpeg\`, writes `VERSION.txt` with the build string and the detected licence. |
| `tests/check-static.js` | 141 static checks incl. the **ES3 reserved-word scan**, the no-network check, and the silence/ffmpeg/bridge/library/preview/text-preset/Premiere-recipe assertions (bridge checks 23–27, library checks 28–31, preview check 32, text preset section 14, Premiere section 21). |
| `tests/host-logic.test.js` | 123 mock-host tests (mock AE object model, mock AE bridge project with render queue, **and** a mock Premiere world incl. MOGRT insert, Motion/Opacity keyframe params, track locks, bins and Project-panel selection; no Adobe apps needed). |
| `tests/render.test.js` | 12 checks against the real `aerender.exe`: version/progress parsing, `spawnJob` streaming + cancel, error classification, discovery, and the real error text for a bad project. Skips the real runs when AE is absent. |
| `tests/ffmpeg.test.js` | 20 checks against the real `ffmpeg.exe`, including a generated WAV in a path with spaces and 中文; skips the real runs when no binary is found. |
| `tests/library.test.js` | 18 checks on real temp folders: schema files, Part 4 migration (ids kept, damaged file skipped), item/folder CRUD, corrupt-index repair, missing assets, newer-schema refusal, pack round trip, skip/replace/keep-both, a PowerShell `Expand-Archive` proof, and hostile/truncated pack refusal. |
| `tests/preview.test.js` | 23 checks: clock/speed/easing, approximation + `sampleAt`, params and preview signatures, ready/stale/none, preview files on a real temp folder, ffmpeg argument builders, and a real PNG→mp4+webp encode when `bin/ffmpeg` exists. |
| `tests/text-presets.test.js` | 31 checks on the real engine: 54 presets / 12 categories, edges + parameter exposure, plan purity and key shapes, clamps, direction signs, overshoot, stagger → smoothness, words vs characters, em offsets, loop tiling, preview kinds, plus host assertions (MOGRT API, no project save) and panel wiring. |
| `tests/pr-recipes.test.js` | 33 checks on the real engine: 18 recipes / 4 categories, the required set, JSON-safe plans, purity and repeatability, clamps, direction signs, amount scaling, key ordering, `"base"` values, host API strings and the seven entry points, panel wiring, and the Premiere-only host flag. |
| `tests/.preview/` | Fake-CEP harness: `fake-cep.js` stubs `__qk.call` (AEFT by default, PPRO with `?host=PPRO`), including bridge stand-ins, an in-memory `window.QKFakeLibrary` (14 items, 5 folders, one missing asset, preview records ready/stale/gone), `?empty=1`, `?many=N` (bulk items) and `?slow=1` (cancel a batch), plus `fixtures/preview.mp4` + `thumb.webp`. |
| `tests/refresh-preview.js` | Rebuilds `tests/.preview` from `extension/`, `design/tokens.css` and `design/icons/`, injecting the `fake-cep.js` script tag. Run it after any panel change. |
| `tests/.preview-server.js` | Test-only static server for `tests/.preview` (`node tests/.preview-server.js 8137`) so `file://` restrictions do not hide image/CSS bugs. |
| `docs/manual-test-checklist-part{1..6}.md`, `docs/manual-test-checklist-part6a.md`, `docs/manual-test-checklist-part6b.md`, `docs/manual-test-checklist-part6c.md`, `docs/manual-test-checklist-part6d.md` | Manual test lists for the real apps. |
| `docs/premiere-6d-api.md` | The verified Premiere API for Part 6D: `importMGT`, `getMGTComponent` and the JSON text payload, the keyframe methods and interpolation enum, `isLocked`, bins and `getCurrentProjectViewSelection`, with version floors and the one deliberate assumption (sequence-time keys). |
| `docs/mogrt-export-api.md` | The verified MOGRT export API, the property types Essential Graphics accepts, and every limit (save prompt, no dropdowns, retime only by expression). |
| `docs/releasing.md`, `release.ps1`, `quickkit.zip` | Release flow and artifact. |

## 4. Key decisions and why

1. **CEP 12, not UXP** — both installed apps still load CEP; UXP would force a
   rewrite. Every host call sits behind the single adapter so a UXP port
   replaces a folder, not the panel. (CEP marketplace closes Dec 2027,
   disabled Dec 2028 — revisit before adding features.)
2. **One host file (`quickkit.jsx`)** — `$.evalFile` splitting has
   unverifiable scoping risk in ExtendScript; sections are marked instead.
3. **JSON-string contract in both directions** — no objects cross the bridge;
   keeps failures readable in the panel message strip.
4. **Preset storage = plain JSON files, not `.ffx`** — one `.qkpreset` file
   per preset under `%APPDATA%\QuickKit\presets`, `folders.json` for logical
   folders, `.seeded` marker. Import/export is a single `.qkpack`, parsed with
   a small JSON parser that **never evaluates code**; imported ids are
   regenerated and duplicate names suffixed.
5. **Text: transforms vs animators** — fade/slide/scale-pop key the layer's own
   transform; typewriter/stagger/blur add a *named text animator* so the text
   stays editable (user's choice over a baked Source Text effect).
6. **Errors are not red** — one accent colour only, per the design system.
7. **Panel-side previews** (easing curve SVG, text WAAPI preview, preset
   thumbnails) never call the host — they are approximations by design.
8. **Honesty rule** — anything not exercised in the real app is labelled
   `UNTESTED` in `PROGRESS.md` and the README.
9. **FFmpeg is a bundled external program, not a library** — `bin/ffmpeg/`
   holds an unmodified `ffmpeg.exe` (fetched per machine, gitignored, 139 MB),
   started as a child process and read as text. `NOTICE.txt` carries the GPL and
   LGPL notices and the source offer; the build on this machine is GPL, and an
   LGPL build can be swapped in with `fetch-ffmpeg.ps1 -From`. Discovery order:
   bundled → saved path in `%APPDATA%\QuickKit\settings.json` → `QK_FFMPEG` →
   PATH.
10. **A silence gap is cut only when every sounding track is quiet** — per
    track `coverage − silence`, then the cuttable set is the sequence coverage
    minus the union of everything still audible. Padding shrinks each side;
    "cut through short breaths" merges silent ranges separated by a short
    sound.
11. **Delete = one ripple per gap, last gap first** — razor every audio and
    video track at both edges, remove the pieces inside the gap without their
    own ripple, and let one piece carry the ripple. **Mute in place** exists
    because ExtendScript cannot move a clip to another track: razor, then set
    the Volume control to −96 dB, keeping the sequence length.
12. **Bridge renders with `aerender`, not the Render Queue** —
    `app.project.renderQueue.render()` runs inside ExtendScript and blocks
    `evalScript`, so the panel would freeze with no progress and a Cancel that
    cannot work. `aerender` is a separate process: stdout is parsed for
    percentages, Cancel kills the child. The comp is still queued with its
    output module set, which `aerender -comp` reuses and a user can render by
    hand if the binary is missing.
13. **Bridge is a file handoff, not Dynamic Link** — a script cannot create a
    Dynamic Link comp. The handoff is JSON, the return is ordinary media, and
    both the panel and README say so. Nothing stays linked.
14. **Templates are verified before rendering** — candidate order is
    QuickTime, Lossless, `H.264 - Match Render Settings - 15 Mbps`,
    `Apple ProRes 422 HQ`, `Apple ProRes 422`, `H.264`, `Lossless with Alpha`;
    the first `applyTemplate` that does not throw wins and sets the extension.
    None found is a specific failure, never a silent H.264.
15. **Bridge comp maths** — comp time 0 = earliest clip start;
    `layer.startTime = -inPoint + (sequenceStart − earliest)`, `inPoint`/
    `outPoint` bound the used range, `stretch = 100/speed` when speed ≠ 100.
    The original position is stored in `imports\<comp>.json` so the return
    lands on the same start and video track.
16. **Cross-app hand-off is honest by construction** — BridgeTalk is used only
    when `premierepro` is in `BridgeTalk.getTargets()`; otherwise the
    `.qkreturn` waits in `returns\` and Premiere's **Place** button finishes
    it. The panel reports `placed` from the host reply, never assumed.
17. **The library is split into rules and disk, with one writer** —
    `library-core.js` holds the schema, folders, query, migration, repair and
    pack planning and touches neither Node nor the DOM, so the same code runs
    in CEP, in the Node tests and in the browser preview. `library-io.js` is
    `require()`d and is the **only** thing that writes `library.json`: each
    mutation re-reads the index, applies one change, writes it back atomically
    (temp file + rename). The ExtendScript host never touches the library —
    it cannot copy a `.mogrt` or a pack byte-safely. Packs are written by
    QuickKit's own zip writer (`zlib` + CRC32) so there is no dependency and
    any zip tool can still open the result.
18. **Text presets are data, and the engine is the only compiler** —
    `text-presets.js` holds 54 preset records (`edges`, `expose`, `note`,
    `preview`, `layer` programs and/or an `animator`) and one `plan()` that turns
    a record plus the seven parameters into numeric key lists. Both the panel and
    the host read only the plan, so a new preset never means new host code, and
    the whole catalogue is testable without Adobe. Per-character offsets are
    stored in **em** and multiplied by the layer's `doc.fontSize` at apply time,
    and position/scale/rotation are resolved **relative to the layer's own
    current value**, which is what makes any font size, anchor and justification
    work. `stagger` is range-selector smoothness; `basedOn` maps characters=1,
    words=3, lines=4.
19. **QuickKit marks its own work instead of owning the layer** — after applying,
    the layer's comment becomes `QuickKit Text Preset|<id>|v<v>`, and the host
    clears only channels it keyed plus animators named `QuickKit *`. A layer the
    user keyed by hand is reported as skipped, never overwritten. Re-applying
    (including every live update) replaces QuickKit's work instead of stacking.
20. **MOGRT export never saves the project** — `exportAsMotionGraphicsTemplate`
    can trigger After Effects' own save prompt; QuickKit deliberately does not
    call the project's save method, because that would write the user's file and
    our helper comp to disk. The prompt is the single manual step (choose
    **Don't Save**). If the scripted export returns `false`, the comp is opened
    with `openInEssentialGraphics()` and the button becomes **Finish MOGRT
    export**, which picks up the file the user saved. Helper comp and the
    `QuickKit Controls` null are removed on success. Only Source Text and two
    numerical sliders (Delay, Speed) are exposed because those are the only
    types Essential Graphics accepts that can also drive an expression; Easing
    and Direction stay baked.
21. **Premiere recipes are data too, and the host re-clamps the plan** —
    `pr-recipes.js` holds 18 recipes as `motion` descriptors (`opacity`,
    `position`, `scale`, `rotation`) with an in/out edge and `at` fractions, and
    one `plan()` turns a descriptor plus duration/easing/amount/direction into a
    JSON key plan. The panel never builds keyframes; `qkPrRecipeApply` reads the
    plan, re-clamps every value (duration 0.2–3 s, `at` 0–1, offsets ±2 frames,
    opacity 0–100, scale 0.05–4) and writes the keys. Adding a recipe is a data
    edit. Positions are fractions of the sequence frame, scale values are
    multipliers of the clip's own scale, and rotation is a delta; the literal
    `"base"` means "read the clip's current value at apply time", so a recipe
    settles on what the user already had instead of resetting it.
22. **Premiere keyframes are written at sequence time** — `addKey`/`setValueAtKey`
    take a `Time` on the sequence timeline, so the host computes
    `clip.start.seconds + (edge === "out" ? clip.duration - window : 0) + at*window`.
    This is the one assumption in 6D that the mocks cannot settle; step 31 of
    `docs/manual-test-checklist-part6d.md` checks it in the real app (keys must
    land at the clip's in point, not 0 s). If it is wrong, only `qkPrApplyChannel`
    changes.
23. **A recipe never overwrites hand-made keys** — Premiere has no clip-comment
    marker to tag QuickKit's own keyframes the way 6C tags layers, so the host
    checks `isTimeVarying()`/`getKeys()` first and **skips a channel that already
    has keys**, reporting why. Undo is the way back. It also skips audio clips,
    locked tracks and clips with no Motion/Opacity component, and caps a plan at
    40 keys per channel.
24. **MOGRT insert uses an explicit video-track picker** — Premiere scripting
    does not expose track targeting, so the panel lists the sequence's video
    tracks and sends a zero-based index to `sequence.importMGT(path, ticks,
    vidTrackOffset, 0)`. The inserted `TrackItem` is addressed afterwards by its
    `nodeId`; controls are re-read with `getMGTComponent()` and text is written
    as the template's own JSON payload (`textEditValue` + `fontTextRunLength`),
    never as a plain string, so styling survives. Only text, number and checkbox
    controls get setters — everything else is shown read-only rather than
    pretending.
25. **Bin organizer reads the Project-panel selection, not the timeline** —
    `app.getCurrentProjectViewSelection()` (Premiere 15.4+) returns project
    items, which is what "sort my footage" means. Bins are created once and never
    deleted or renamed in bulk; classification is by `isSequence()` then file
    extension, and anything unclassifiable is reported instead of guessed.
    Older Premiere builds get a readable "needs 15.4" message.

## 5. Known bugs and gotchas

- **ExtendScript reserved words (the crash that started Part 4):** AE's
  engine reserves words like `short`, `class`, `default`, `enum`, `int`,
  `long`, `super`, `throw`, `transient`, `try`, `use`, `var`, `while`… used
  **as an object key or identifier** they make the *whole file* fail to parse,
  so every `qk*` function vanishes and the panel reports a script problem.
  It happened with `short:` at `host/quickkit.jsx:1503` (now `tooShort:`).
  **Guard:** `tests/check-static.js` → `es3ReservedHits()` tokenises the host
  file, skips strings/comments, and fails the run on any reserved word. Run it
  after every host edit; it also has a self-test proving it sees code but
  ignores `'class'` and `// short`.
- **ES3 only in the host.** `host/quickkit.jsx` is parsed by ExtendScript:
  no `let`/`const`, no arrow functions, no template literals, no `Array.map`,
  no `JSON`, no trailing commas in objects. Node's `node --check` passing is
  *not* proof — it is not an ES3 parser (the static suite says this out loud).
  Copy to a `.js` file before `node --check`; Node refuses the `.jsx` extension.
- **Panel JS is Chromium 99** — modern syntax is fine there, not in the host.
- **Git ignores `PROGRESS.md` and `PROJECT_RULES.md`** (`.gitignore` lines
  5–6, deliberate: "internal working documents — not published"). They live
  only on this machine; `git add -A` will never carry them. Never delete or
  "clean" them, and re-create them from `HANDOFF.md` on a fresh clone.
- **Windows folder lock on install:** a process holding
  `%APPDATA%\Adobe\CEP\extensions\QuickKit` blocks `rmdir`; the scripts retry
  once and name the cause. Under a live lock the retry is untested.
- **Panel layout:** tab strip scrolls below ~420px (by design); version chip
  hidden ≤280px (by design).
- **Known-untested areas:** connection round trip in the real app, text
  animator match names (`ADBE Text Blur` in particular), anchor on
  text/shape layers, parenting, precompose, preset capture/apply, text style
  mutation, effect parameter paths, modal file dialogs, undo granularity,
  every Premiere call in the silence tool (QE razor, `item.remove(true,true)`,
  marker colour, Volume muting, `getSelection`), the whole bridge in the real
  apps (`ImportOptions`/`importFile` visually, `comp.layers.add` trim
  behaviour, `renderQueue.items.add` + `outputModule.applyTemplate`,
  `app.project.save`, a real comp rendered by `aerender`, `app.project
  .importFiles`, `overwriteClip`, BridgeTalk), and the panel drawing inside
  real CEP. The panel itself **was** re-checked in the browser preview during
  Parts 5 and 6 (both `?host=PPRO` and `?host=AEFT`, no console messages) —
  that proves the markup, CSS and JS wiring, not CEP's own rendering.
- **The bridge mocks are models, not the apps.** `installAeBridge()` models
  `items.addComp`, `importFile`, `renderQueue.items.add`, `applyTemplate` and
  `save`; `createPremiereWorld({bridge:true})` models `importFiles`,
  `overwriteClip` and `insertClip`. They prove the maths, the branch order and
  the undo pairing. A real difference (e.g. `overwriteClip` refusing an
  unsynced track) belongs in `qkBridgePlace*` **and** the mock together.
- **The bridge needs a saved After Effects project.** `aerender` opens the
  project from disk; an unsaved project is refused before any render starts.
- **A renamed comp loses its return position.** The position is keyed by the
  lowercased comp name written at import; renaming the comp afterwards means
  the return finds no record and Premiere places it at 0 s (checklist §D26).
- **Multi-clip handoffs come back flattened.** One render, placed at the first
  clip's start and video track; anything under it is overwritten. Documented,
  not a bug.
- **`aerender` exiting 15 for `-version` is normal.** `render-node.js` parses
  stdout instead of trusting the exit code; do not "fix" that.
- **The silence mock is a model, not Premiere.** `createPremiereWorld()` in
  `tests/host-logic.test.js` implements razor as "split the clip at that time",
  ripple as "shift everything starting at or after the removed piece left", and
  markers as plain objects. It proves the mapping, the interval maths, the mode
  branches and the undo pairing — **not** what Premiere actually does. If the
  real razor or ripple differs, the fix belongs in `qkSilenceRazorAt` /
  `qkSilenceRemoveInside`, and the mock has to be updated with it.
- **Ripple assumptions:** delete mode assumes track sync lock is on, so one
  ripple closes the gap on every track. With unlocked tracks the picture can
  stay put while the audio closes up; the checklist (§F) covers it.
- **FFmpeg is gitignored.** A fresh clone has `bin/ffmpeg/NOTICE.txt` and
  `README.txt` but no binary; run `scripts\fetch-ffmpeg.ps1` before
  `install.bat` if you want the Silence tab to work out of the box.
- **`tests/.preview/` is committed** (fake-CEP harness); do not treat it as
  build junk.
- **The library has never run inside CEP.** Everything in 6A was proven by
  `tests/library.test.js` on real temp folders and by the browser preview —
  not by After Effects or Premiere. Explicitly `UNTESTED`: `require()` of
  `library-io.js` in CEP, `%APPDATA%` resolution there, the native Save/Open
  dialogs (`window.cep.fs.showSaveDialogEx` / `showOpenDialogEx`),
  `file://` thumbnails in Chromium 99, real-mouse drag and drop, and the
  migration of the user's real Part 4 presets. Checklist:
  `docs/manual-test-checklist-part6a.md`.
- **The Part 4 preset store is never moved or rewritten.** Migration only
  *copies* `presets\*.qkpreset` into the library and keeps the original id, so
  `qkPresetApply(id)` still resolves the old file. Do not "clean up" the old
  store; the Presets tab still reads it.
- **`library.json` has exactly one writer.** Never edit it from the host or a
  second panel code path: two writers would interleave read-modify-write and
  drop items. Everything goes through `library-io.js`, and a stale in-memory
  index is re-read on each mutation.
- **Text presets: the plan is data, the host validates it again.** `qkTextPlanRead`
  re-clamps every number and channel coming from a `.qktextpreset` file, because
  a library pack can carry a hand-edited one. Every new host behaviour belongs in
  the planner/executor here, never in a per-preset `if` — adding a preset must
  stay a data edit in `text-presets.js`.
- **Text layers are marked, and only QuickKit's own keys are cleared.** The
  comment marker (`QuickKit Text Preset|<id>|v<v>`) plus the `QuickKit ` animator
  prefix are the whole ownership rule. Never clear a channel or animator without
  checking them: a user's hand keyframes must survive and be reported as skipped.
- **MOGRT export: the save prompt, the folder argument, and the copy.** The
  export takes a **folder**, not a file, and the name comes from
  `motionGraphicsTemplateName`; the panel then reads the produced `.mogrt` and
  adds it to the library as a `mogrt` item (the host never writes into the
  library). Never add a project save call to get past the prompt — the prompt is
  the documented manual step (choose **Don't Save**), and the fallback is
  `openInEssentialGraphics()` + **Finish MOGRT export**.
- **Only Source Text and single-value numeric properties can be exposed** to
  Essential Graphics. Dropdown-like controls (Easing, Direction) cannot exist, so
  they are baked; retiming works only because Delay/Speed sliders are referenced
  by expressions using `valueAtTime()`. Anything else is an Adobe limit, not a
  bug to "fix" with a fake control.
- **Premiere recipes: the plan is data, the host validates it again.**
  `qkPrPlanRead` re-clamps duration, easing, `at`, offsets, opacity and scale
  coming from a `.qkrecipe.json` file (a pack can carry a hand-edited one).
  Adding or changing a recipe is a data edit in `pr-recipes.js`; never add a
  per-recipe branch in `qkPrRecipeApply`.
- **Premiere key times are the one real-app unknown.** The mock stores whatever
  `Time` it is given, so it cannot tell whether Premiere wants sequence time or
  clip-relative time. `qkPrApplyChannel` deliberately uses sequence time
  (`clip.start.seconds + …`); if checklist step 31 shows keys at 0 s, change
  that one function and the mock assertion in `tests/host-logic.test.js`
  together.
- **`track.isLocked()` is undocumented.** The host feature-detects it and treats
  a missing method as "not locked", because refusing every apply on a build
  without it would be worse. If a real build reports locks differently, extend
  `qkPrTrackLocked` only.
- **MOGRT text is a JSON payload, not a string.** Writing a bare string into a
  text control replaces the styling. `qkPrMogrtSetText` accepts either a plain
  string (plain-text controls) or a JSON object with `textEditValue`, rebuilds
  `fontTextRunLength` as `[length]` and refuses JSON without `textEditValue`.
  It also caps text at 4000 characters. Control *names* are localised by
  Premiere — never match on a display name, only on the index returned by
  `getMGTComponent()`.
- **Bin classification is extension-based and deliberately conservative.** A
  file it cannot place is reported, never dropped into Footage by default.
  `getCurrentProjectViewSelection()` needs Premiere 15.4+; older builds get a
  readable message rather than an empty "nothing selected".
- **`sequence.importMGT` can succeed and still return 0** when the template
  needs a font or a Dynamic Link media replacement. The host reports
  "Premiere did not insert the template" instead of claiming success; check the
  file and the template's fonts before assuming a QuickKit bug.
- **The text preset seed writes 54 files once.** `localStorage` key
  `qk.textpresets.seeded` holds `<VERSION>:<count>`; bumping `VERSION` in
  `text-presets.js` re-seeds (existing ids collide, so item ids are the preset id
  — do not change ids casually, it duplicates items).

- **A newer `schemaVersion` is refused, not downgraded.** `load()` still lists
  the items, but every change returns *"This library was saved by a newer
  QuickKit. Update QuickKit before changing it."* Never "fix" this by writing
  the old schema over it.
- **Repair never deletes.** `repair()` rebuilds `library.json` from
  `items\*\item.json` and `folders.json`; a damaged item folder is skipped and
  left untouched. Do not add a cleanup pass that removes files it does not
  understand.
- **Packs are untrusted input.** The reader refuses path traversal, caps entry
  sizes and total size, and validates the manifest. Keep those guards when
  touching the zip code — the tests include hostile and truncated packs.
- **Library preview evidence is browser-only.** The fake library in
  `tests/.preview/fake-cep.js` (14 items, 5 folders, one missing asset,
  `?empty=1`) proves the wiring. It is not a model of the real store; a real
  difference belongs in `library-core.js` **and** the fake together.
- **Preview generation uses the Render Queue, not aerender.** aerender only
  renders a saved `.aep`; using it would mean saving or Save-As-ing the user's
  project for a preview. `qkPreviewGenerate` therefore renders the **open**
  project, disables every other queue item and restores it in `finally`, and
  deletes the throwaway comp. The static suite fails if `aerender` appears in
  `qkPreviewGenerate`. Consequence: the panel is blocked during a render, so
  **Cancel only takes effect between batch items** — do not promise otherwise,
  and do not try to make it interrupt `queue.render()`.
- **Preview freshness is a signature, not a timestamp.** `previewSignature()`
  hashes `type|asset|bytes|params`; it deliberately ignores `updatedAt`, so
  rename / favorite / move keep a preview valid, while a param or asset change
  makes it `stale` without deleting anything. Changing the hash inputs orphans
  every existing preview — treat it as a schema change and note it.
- **The preview pane loads exactly one `<video>`.** Only the selected item's
  clip is assigned a `src`; thumbnails stay in `data-src` until they scroll into
  view. Keep that rule when touching `libCard` / `renderLibrary`, or a 500-item
  library starts loading 500 clips.
- **`file://` video in CEP 12 is unproven.** The pane handles a video `error`
  event by falling back to the canvas approximation, so a broken codec or a
  blocked scheme never leaves a blank stage. Do not "fix" a blank preview by
  removing that fallback — first find out which path ran.

## 6. How to run and test

```bash
# automated — all eight must pass, exit 0
node tests/check-static.js        # 141 checks: structure, versions, ES3 scan, no-network, silence + bridge + library + preview + text preset + Premiere recipe wiring
node tests/host-logic.test.js     # 123 mock-host tests (mock AE, mock AE bridge, mock Premiere incl. MOGRT/recipes/bins), no apps needed
node tests/render.test.js         # 12 checks against the real aerender.exe (skips real runs if AE absent)
node tests/ffmpeg.test.js         # 20 checks against the real ffmpeg (skips real runs if absent)
node tests/library.test.js        # 18 checks on real temp folders: schema, migration, repair, packs
node tests/preview.test.js        # 23 checks: playback maths, params/signatures, preview files, real encode when ffmpeg exists
node tests/text-presets.test.js   # 31 checks: 54-preset engine, plan compiler, host MOGRT API, panel wiring
node tests/pr-recipes.test.js     # 33 checks: 18-recipe engine, plan compiler, host Premiere API, panel wiring

# syntax spot-check (copy first — Node rejects .jsx)
cp host/quickkit.jsx /tmp/qk.js && node --check /tmp/qk.js
node --check extension/js/panel.js
node --check extension/js/library-core.js
node --check extension/js/library-io.js
node --check extension/js/preview-core.js
node --check extension/js/preview-node.js
node --check extension/js/text-presets.js
node --check extension/js/pr-recipes.js
node --check extension/js/ffmpeg-node.js
node --check extension/js/render-node.js

# put a binary in bin\ffmpeg\ (once per machine), then install
powershell -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1
cmd //c "scripts\\install.bat"    # then restart AE/PPro: Window > Extensions > QuickKit

# browser preview of the panel with a fake host (no Adobe apps)
node tests/refresh-preview.js                     # copies the panel into tests/.preview
node tests/.preview-server.js 8137                # open http://127.0.0.1:8137/index.html
# fake-cep.js stubs window.__qk.call; append ?host=PPRO for the Premiere side,
# ?empty=1 for the library first-run state, ?many=500 for the lazy-thumbnail
# case, ?slow=1 to press Cancel during a preview batch
# (in a browser there is no Node, so the Silence and Bridge tabs say so — expected)
```

Real-app verification = walk `docs/manual-test-checklist-part6d.md` (Premiere
library: MOGRT, recipes, bins), then `part6c` (text presets + MOGRTs), `part6b`
(previews), `part6a` (library), `part6` (bridge), `part5` (silence) and `part4`
(presets), then parts 1–3. Report each item's number, expected result and what
actually happened.

## 7. Next 3 concrete actions

0. **Status as of 2026-10-29 (Prompt 11 closeout) — no code work is
   outstanding.** Prompts 1–11 are all `DONE` in `PROGRESS.md`; all eight suites
   are green (141 / 123 / 12 / 20 / 18 / 23 / 31 / 33); `scripts\install.bat`
   installed **0.10.0**. Part 6D adds the Premiere side of the library: MOGRT
   insert with a video-track picker and JSON text/parameter editing, 18 keyframe
   recipes with targeting, and the optional bin organizer. Every real-app path
   (key times on the sequence timeline, real Motion/Opacity keyframe writes,
   `importMGT` with a QuickKit `.mogrt`, `isLocked`, Project-panel selection and
   bin moves) is **UNTESTED**.

1. **Run `docs/manual-test-checklist-part6d.md` (Premiere library) first** — it
   is the newest area, and step 31 is the one that settles the keyframe-time
   assumption (keys must land at the clip's in point, not 0 s). Steps 35–47
   settle MOGRT insert + text, 49–51 dimming, 56–64 bins. Copy the outcome here
   and only then flip the 6D rows in `PROGRESS.md` from `UNTESTED` to tested.
2. **Then run `docs/manual-test-checklist-part6c.md` (Text + MOGRT)**, then
   `part6b` (Preview), `part6a` (Library), `part6` (Bridge), `part5` (Silence)
   and `part4` (presets). The two questions that decide 6C's feel: do the
   animators and selector properties resolve to real names on your AE version
   (steps 14–16), and does the scripted MOGRT export succeed or fall back to
   Essential Graphics (steps 47–52)?
3. **If any item fails, fix one part at a time and re-run all eight suites** —
   for a host error start with `node tests/check-static.js` (a single
   ExtendScript reserved word silently kills every host function); for a recipe
   or text-preset behaviour change edit `pr-recipes.js` / `text-presets.js`
   **and** their test files together (never add a per-recipe or per-preset branch
   in the host); for a razor/ripple difference change `qkSilence*` **and** the
   mock together; for a bridge difference change `qkBridge*` **and**
   `installAeBridge()` / `createPremiereWorld({bridge:true})` together; for a
   library or preview difference change `library-core.js` / `preview-core.js`
   **and** `tests/library.test.js` / `tests/preview.test.js` /
   `tests/.preview/fake-cep.js` together. Re-run `scripts\install.bat` before the
   retest and record the real behaviour here.
