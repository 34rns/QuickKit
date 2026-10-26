# HANDOFF — QuickKit

**Read this together with `AGENTS.md`, `PROGRESS.md`, `WORKLOG.md` and the
relevant `prompts/PROMPT_N.md`.** Last updated: 2026-10-26 (Prompt 6 → Part 5,
Silence cutter).

---

## 1. What we are building

QuickKit is a **free, local-only CEP extension** for Adobe After Effects and
Premiere Pro: an HTML/JS panel plus an ExtendScript (`.jsx`) host, one manifest
targeting both apps, Windows 10/11 only, no network at runtime.

Current version: **0.5.0** (Parts 0–5 done: shell, AE core tools, text
animations, preset manager, Premiere silence cutter). Everything that touches
the real app is still `UNTESTED` until the manual checklists in `docs/` are
walked through.

## 2. Architecture

```
┌──────────────────────────────┐    window.__qk.call(script)    ┌──────────────────────────┐
│ extension/  (Chromium 99 CEP │ ─────────────────────────────► │ host/quickkit.jsx        │
│ panel: index.html, panel.js, │ ◄───────────────────────────── │ ExtendScript in AE/PPro  │
│ csinterface-lite.js bridge)  │        JSON string reply       │ every public fn = qk*()  │
└──────────────┬───────────────┘                                └──────────────────────────┘
               │ require() + child_process (Premiere only)
               ▼
      js/ffmpeg-node.js ──spawn(argv, no shell)──► bin/ffmpeg/ffmpeg.exe
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
  `require()` from the panel, never a `<script>` tag, and is the only file that
  touches `child_process`. Every run is `spawn(path, [args])` — no shell, so
  spaces and non-English characters need no quoting. The manifest passes
  `--enable-nodejs` and `--mixed-context` so `require` exists in CEP.

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
| `extension/CSXS/manifest.xml` | One manifest, `HostList` = AEFT + PPRO, `[22.0,99.9]`, version 0.5.0, CEF `--enable-nodejs` + `--mixed-context`. |
| `extension/index.html` | Panel markup: header, host block, 7 tabs, one `<section>` per tool, dialogs, tooltip, status strip. |
| `extension/js/panel.js` | All panel logic (~2950 lines): tabs, tooltips, welcome, per-tool wiring, presets UI, WAAPI text preview, silence tab. |
| `extension/js/csinterface-lite.js` | The bridge (`window.__qk.call`). |
| `extension/js/ffmpeg-node.js` | Node side of the Silence tool: `locate`, `probe`, `detect`, `peaks`, `cancel`, parsers, `PeakBuilder`. Only file that starts a process. |
| `extension/css/panel.css` | Shell: grid, header, tabs, status, tooltip, welcome, dialogs. |
| `extension/css/tools.css` | Tool panels: anchors, transforms, easing, text, presets, silence (waveform, progress, segment list), message strip. |
| `host/quickkit.jsx` | The entire host (~4990 lines): helpers, host info, anchor, layers, easing, text engine, preset store, Premiere silence cutter (`qkSilence*`). Marked sections; `$.evalFile` split deliberately avoided. |
| `bin/ffmpeg/` | `NOTICE.txt` + `README.txt` (tracked); `ffmpeg.exe`, `ffprobe.exe`, `VERSION.txt` fetched per machine and **gitignored**. |
| `design/tokens.css` | ~115 tokens: dark theme, single accent `#7C5CFF`. Only place raw colours/fonts/radii live. |
| `design/DESIGN_SYSTEM.md` | The binding visual spec (states, spacing, typography). |
| `design/icons/icons.js` | Original 16×16 icon set, `QKIcons.svg()`. |
| `design/fonts/*` | Bundled Inter (OFL), logged in `docs/ASSET_LICENSES.md`. |
| `scripts/install.bat`, `scripts/uninstall.bat` | Copy/clean the extension folder, toggle `PlayerDebugMode`. |
| `scripts/fetch-ffmpeg.ps1` | Copies a local `ffmpeg.exe` (and `ffprobe.exe`) into `bin\ffmpeg\`, writes `VERSION.txt` with the build string and the detected licence. |
| `tests/check-static.js` | 55 static checks incl. the **ES3 reserved-word scan**, the no-network check, and the silence/ffmpeg/manifest assertions. |
| `tests/host-logic.test.js` | 89 mock-host tests (mock AE object model **and** a mock Premiere world; no Adobe apps needed). |
| `tests/ffmpeg.test.js` | 20 checks against the real `ffmpeg.exe`, including a generated WAV in a path with spaces and 中文; skips the real runs when no binary is found. |
| `tests/.preview/` | Fake-CEP harness: `fake-cep.js` stubs `__qk.call` (AEFT by default, PPRO with `?host=PPRO`), plus a copy of the panel served on 127.0.0.1 for browser checks. |
| `tests/refresh-preview.js` | Rebuilds `tests/.preview` from `extension/`, `design/tokens.css` and `design/icons/`, injecting the `fake-cep.js` script tag. Run it after any panel change. |
| `docs/manual-test-checklist-part{1..5}.md` | Manual test lists for the real apps. |
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
  marker colour, Volume muting, `getSelection`), and the panel drawing inside
  real CEP. The panel itself **was** re-checked in the browser preview during
  Part 5 (both `?host=PPRO` and `?host=AEFT`, no console errors) — that proves
  the markup, CSS and JS wiring, not CEP's own rendering.
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

## 6. How to run and test

```bash
# automated — all three must pass, exit 0
node tests/check-static.js        # 55 checks: structure, versions, ES3 scan, no-network, silence wiring
node tests/host-logic.test.js     # 89 mock-host tests (mock AE + mock Premiere), no apps needed
node tests/ffmpeg.test.js         # 20 checks against the real ffmpeg (skips real runs if absent)

# syntax spot-check (copy first — Node rejects .jsx)
cp host/quickkit.jsx /tmp/qk.js && node --check /tmp/qk.js
node --check extension/js/panel.js
node --check extension/js/ffmpeg-node.js

# put a binary in bin\ffmpeg\ (once per machine), then install
powershell -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1
cmd //c "scripts\\install.bat"    # then restart AE/PPro: Window > Extensions > QuickKit

# browser preview of the panel with a fake host (no Adobe apps)
node tests/refresh-preview.js                     # copies the panel into tests/.preview
cd tests/.preview && python -m http.server 8752   # open http://127.0.0.1:8752/index.html
# fake-cep.js stubs window.__qk.call; append ?host=PPRO for the Premiere side
# (in a browser there is no Node, so the Silence tab shows that message — expected)
```

Real-app verification = walk `docs/manual-test-checklist-part5.md` (silence) and
`part4` (presets), then parts 1–3. Report each item's number, expected result
and what actually happened.

## 7. Next 3 concrete actions

0. **Status as of 2026-10-26 14:05 — no code work is outstanding.** Prompts 1–6
   are all `DONE` in `PROGRESS.md` and in `prompts/PROMPT_N.md`; all three
   suites are green (55 / 89 / 20). What is left is manual, and needs a human in
   the apps.

1. **Run `docs/manual-test-checklist-part5.md` in Premiere Pro 26.0.2** — the
   four required cases (short clip, one-hour clip, no silence, no audio) plus
   multi-track, linked video and the unicode path. Everything Premiere-side is
   `UNTESTED` until then. Fill in the Results table at the bottom of the file
   and copy the timings into this handoff.
2. **Run `docs/manual-test-checklist-part4.md` in After Effects 26.5** if it is
   still unwalked; the connection fix and preset capture/apply are `UNTESTED`.
3. **If any item fails, fix and re-run all three suites** — for a host error
   start with `node tests/check-static.js` (a single ExtendScript reserved word
   silently kills every host function). For a razor/ripple difference, change
   `qkSilence*` **and** the mock in `tests/host-logic.test.js` together, then
   record the real behaviour here.
