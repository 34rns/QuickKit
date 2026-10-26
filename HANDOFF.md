# HANDOFF — QuickKit

**Read this together with `AGENTS.md`, `PROGRESS.md`, `WORKLOG.md` and the
relevant `prompts/PROMPT_N.md`.** Last updated: 2026-10-26 (Prompt 8 → Part 6A,
the unified library: store, folders, packs, Repair).

---

## 1. What we are building

QuickKit is a **free, local-only CEP extension** for Adobe After Effects and
Premiere Pro: an HTML/JS panel plus an ExtendScript (`.jsx`) host, one manifest
targeting both apps, Windows 10/11 only, no network at runtime.

Current version: **0.7.0** (Parts 0–6 and 6A done: shell, AE core tools, text
animations, preset manager, Premiere silence cutter, Premiere ⇄ After Effects
bridge, unified library store/UI). 6A stores and organises items but does not
apply them yet. Everything that touches the real app is still `UNTESTED` until
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
| `extension/CSXS/manifest.xml` | One manifest, `HostList` = AEFT + PPRO, `[22.0,99.9]`, version 0.7.0, CEF `--enable-nodejs` + `--mixed-context`. |
| `extension/index.html` | Panel markup: header, host block, 8 tabs, one `<section>` per tool (incl. `#qk-panel-library`), the library context menu, dialogs, tooltip, status strip. |
| `extension/js/panel.js` | All panel logic (~5400 lines): tabs, tooltips, welcome, per-tool wiring, presets UI, WAAPI text preview, silence tab, bridge tab, library UI. |
| `extension/js/csinterface-lite.js` | The bridge (`window.__qk.call`). |
| `extension/js/library-core.js` | Library rules, no dependencies: schema/normalisation, nested folders, search/filter/sort, smart collections, Part 4 migration, repair-from-disk, pack manifest/import planning. Loaded as a plain `<script>`. |
| `extension/js/library-io.js` | Library store, `require()`d only: fs adapter (atomic writes), CRC32 + zip writer/reader, `create({root, legacyRoot})` → `load`, `repair`, folder/item CRUD, `touch`, `exportPack`, `inspectPack`, `importPack`. Never a process. |
| `extension/js/ffmpeg-node.js` | Node side of the Silence tool: `locate`, `probe`, `detect`, `peaks`, `cancel`, parsers, `PeakBuilder`. One of two files that start a process. |
| `extension/js/render-node.js` | Node side of the Bridge render: `locate`/`probe` for `aerender.exe`, `parseVersion`/`parseProgress`/`classifyFailure`, `spawnJob` (line streaming + `cancel()`), `render()`. Real output tested against `aerender 26.5x89`. |
| `extension/css/panel.css` | Shell: grid, header, tabs, status, tooltip, welcome, dialogs. |
| `extension/css/tools.css` | Tool panels: anchors, transforms, easing, text, presets, silence (waveform, progress, segment list), bridge (cards, lists, step dots), library (search, folder tree, cards, menu, dialog), message strip. |
| `host/quickkit.jsx` | The entire host (~5780 lines): helpers, host info, anchor, layers, easing, text engine, preset store, Premiere silence cutter (`qkSilence*`), bridge (`qkBridge*`). Marked sections; `$.evalFile` split deliberately avoided. |
| `bin/ffmpeg/` | `NOTICE.txt` + `README.txt` (tracked); `ffmpeg.exe`, `ffprobe.exe`, `VERSION.txt` fetched per machine and **gitignored**. |
| `design/tokens.css` | 126 tokens: dark theme, single accent `#7C5CFF`. Only place raw colours/fonts/radii live. |
| `design/DESIGN_SYSTEM.md` | The binding visual spec (states, spacing, typography). |
| `design/icons/icons.js` | Original 16×16 icon set, `QKIcons.svg()`. |
| `design/fonts/*` | Bundled Inter (OFL), logged in `docs/ASSET_LICENSES.md`. |
| `scripts/install.bat`, `scripts/uninstall.bat` | Copy/clean the extension folder, toggle `PlayerDebugMode`. |
| `scripts/fetch-ffmpeg.ps1` | Copies a local `ffmpeg.exe` (and `ffprobe.exe`) into `bin\ffmpeg\`, writes `VERSION.txt` with the build string and the detected licence. |
| `tests/check-static.js` | 96 static checks incl. the **ES3 reserved-word scan**, the no-network check, and the silence/ffmpeg/bridge/library/manifest assertions (bridge checks 23–27, library checks 28–31). |
| `tests/host-logic.test.js` | 104 mock-host tests (mock AE object model, mock AE bridge project with render queue, **and** a mock Premiere world; no Adobe apps needed). |
| `tests/render.test.js` | 12 checks against the real `aerender.exe`: version/progress parsing, `spawnJob` streaming + cancel, error classification, discovery, and the real error text for a bad project. Skips the real runs when AE is absent. |
| `tests/ffmpeg.test.js` | 20 checks against the real `ffmpeg.exe`, including a generated WAV in a path with spaces and 中文; skips the real runs when no binary is found. |
| `tests/library.test.js` | 18 checks on real temp folders: schema files, Part 4 migration (ids kept, damaged file skipped), item/folder CRUD, corrupt-index repair, missing assets, newer-schema refusal, pack round trip, skip/replace/keep-both, a PowerShell `Expand-Archive` proof, and hostile/truncated pack refusal. |
| `tests/.preview/` | Fake-CEP harness: `fake-cep.js` stubs `__qk.call` (AEFT by default, PPRO with `?host=PPRO`), including bridge stand-ins and an in-memory `window.QKFakeLibrary` (14 items, 5 folders, one missing asset, `?empty=1` for the first-run state). |
| `tests/refresh-preview.js` | Rebuilds `tests/.preview` from `extension/`, `design/tokens.css` and `design/icons/`, injecting the `fake-cep.js` script tag. Run it after any panel change. |
| `tests/.preview-server.js` | Test-only static server for `tests/.preview` (`node tests/.preview-server.js 8137`) so `file://` restrictions do not hide image/CSS bugs. |
| `docs/manual-test-checklist-part{1..6}.md`, `docs/manual-test-checklist-part6a.md` | Manual test lists for the real apps. |
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

## 6. How to run and test

```bash
# automated — all five must pass, exit 0
node tests/check-static.js        # 96 checks: structure, versions, ES3 scan, no-network, silence + bridge + library wiring
node tests/host-logic.test.js     # 104 mock-host tests (mock AE, mock AE bridge, mock Premiere), no apps needed
node tests/render.test.js         # 12 checks against the real aerender.exe (skips real runs if AE absent)
node tests/ffmpeg.test.js         # 20 checks against the real ffmpeg (skips real runs if absent)
node tests/library.test.js        # 18 checks on real temp folders: schema, migration, repair, packs

# syntax spot-check (copy first — Node rejects .jsx)
cp host/quickkit.jsx /tmp/qk.js && node --check /tmp/qk.js
node --check extension/js/panel.js
node --check extension/js/library-core.js
node --check extension/js/library-io.js
node --check extension/js/ffmpeg-node.js
node --check extension/js/render-node.js

# put a binary in bin\ffmpeg\ (once per machine), then install
powershell -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1
cmd //c "scripts\\install.bat"    # then restart AE/PPro: Window > Extensions > QuickKit

# browser preview of the panel with a fake host (no Adobe apps)
node tests/refresh-preview.js                     # copies the panel into tests/.preview
node tests/.preview-server.js 8137                # open http://127.0.0.1:8137/index.html
# fake-cep.js stubs window.__qk.call; append ?host=PPRO for the Premiere side,
# ?empty=1 for the library first-run state
# (in a browser there is no Node, so the Silence and Bridge tabs say so — expected)
```

Real-app verification = walk `docs/manual-test-checklist-part6a.md` (library),
then `part6` (bridge), `part5` (silence) and `part4` (presets), then parts 1–3.
Report each item's number, expected result and what actually happened.

## 7. Next 3 concrete actions

0. **Status as of 2026-10-26 (Prompt 8 closeout) — no code work is
   outstanding.** Prompts 1–8 are all `DONE` in `PROGRESS.md` and in
   `prompts/PROMPT_N.md`; all five suites are green (96 / 104 / 12 / 20 / 18);
   `scripts\install.bat` installed **0.7.0** and the library UI was re-checked
   in the browser preview in both host modes with no console messages. What is
   left is manual, and needs a human in the apps. Part 6A is the store and the
   UI only — **applying a library item is not built yet** (6B/6C).

1. **Run `docs/manual-test-checklist-part6a.md` (Library) first** — it is the
   newest and least proven area: `require()` in CEP, the real native dialogs,
   `file://` thumbnails, real-mouse drag and drop, the migration of the user's
   own Part 4 presets, and the whole panel in Premiere Pro. Copy the outcome
   into this file and set the 6A rows in `PROGRESS.md` from `UNTESTED` to
   tested only for the steps that actually passed.
2. **Then run `docs/manual-test-checklist-part6.md` (Bridge) and `part5`
   (Silence)**, then `part4` (presets) if still unwalked — the bridge and every
   Premiere call in it are `UNTESTED`.
3. **If any item fails, fix one part at a time and re-run all five suites** —
   for a host error start with `node tests/check-static.js` (a single
   ExtendScript reserved word silently kills every host function); for a
   razor/ripple difference change `qkSilence*` **and** the mock together; for a
   bridge difference change `qkBridge*` **and** `installAeBridge()` /
   `createPremiereWorld({bridge:true})` together; for a library difference
   change `library-core.js` **and** `tests/library.test.js` /
   `tests/.preview/fake-cep.js` together. Re-run `scripts\install.bat` before
   the retest and record the real behaviour here.
