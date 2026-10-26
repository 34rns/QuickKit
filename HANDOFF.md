# HANDOFF — QuickKit

**Read this together with `AGENTS.md`, `PROGRESS.md`, `WORKLOG.md` and the
relevant `prompts/PROMPT_N.md`.** Last updated: 2026-10-26 (Prompt 5 setup).

---

## 1. What we are building

QuickKit is a **free, local-only CEP extension** for Adobe After Effects and
Premiere Pro: an HTML/JS panel plus an ExtendScript (`.jsx`) host, one manifest
targeting both apps, Windows 10/11 only, no network at runtime.

Current version: **0.4.0** (Parts 0–4 done: shell, AE core tools, text
animations, preset manager). Everything that touches the real app is still
`UNTESTED` until the manual checklists in `docs/` are walked through.

## 2. Architecture

```
┌──────────────────────────────┐    window.__qk.call(script)    ┌──────────────────────────┐
│ extension/  (Chromium 99 CEP │ ─────────────────────────────► │ host/quickkit.jsx        │
│ panel: index.html, panel.js, │ ◄───────────────────────────── │ ExtendScript in AE/PPro  │
│ csinterface-lite.js bridge)  │        JSON string reply       │ every public fn = qk*()  │
└──────────────────────────────┘                                └──────────────────────────┘
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
  `design/`, and `host/` into `%APPDATA%\Adobe\CEP\extensions\QuickKit`,
  writes `PlayerDebugMode=1`, and verifies byte-for-byte.

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
| `extension/CSXS/manifest.xml` | One manifest, `HostList` = AEFT + PPRO, `[22.0,99.9]`, version 0.4.0. |
| `extension/index.html` | Panel markup: header, host block, 7 tabs, one `<section>` per tool, dialogs, tooltip, status strip. |
| `extension/js/panel.js` | All panel logic (~2200 lines): tabs, tooltips, welcome, per-tool wiring, presets UI, WAAPI text preview. |
| `extension/js/csinterface-lite.js` | The bridge (`window.__qk.call`). |
| `extension/css/panel.css` | Shell: grid, header, tabs, status, tooltip, welcome, dialogs. |
| `extension/css/tools.css` | Tool panels: anchors, transforms, easing, text, presets, message strip. |
| `host/quickkit.jsx` | The entire host (~4000 lines): helpers, host info, anchor, layers, easing, text engine, preset store. Marked sections; `$.evalFile` split deliberately avoided. |
| `design/tokens.css` | ~100 tokens: dark theme, single accent `#7C5CFF`. Only place raw colours/fonts/radii live. |
| `design/DESIGN_SYSTEM.md` | The binding visual spec (states, spacing, typography). |
| `design/icons/icons.js` | Original 16×16 icon set, `QKIcons.svg()`. |
| `design/fonts/*` | Bundled Inter (OFL), logged in `docs/ASSET_LICENSES.md`. |
| `scripts/install.bat`, `scripts/uninstall.bat` | Copy/clean the extension folder, toggle `PlayerDebugMode`. |
| `tests/check-static.js` | 34 static checks incl. the **ES3 reserved-word scan** and no-network check. |
| `tests/host-logic.test.js` | 75 mock-host tests (mock AE object model; no After Effects needed). |
| `tests/.preview/` | Fake-CEP harness: `fake-cep.js` stubs `__qk.call`, plus a copy of the panel served on 127.0.0.1 for browser checks. |
| `docs/manual-test-checklist-part{1..4}.md` | Manual test lists for the real apps. |
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
  mutation, effect parameter paths, modal file dialogs, undo granularity.
- **`tests/.preview/` is committed** (fake-CEP harness); do not treat it as
  build junk.

## 6. How to run and test

```bash
# automated — both must pass, exit 0
node tests/check-static.js        # 34 checks: structure, versions, ES3 scan, no-network
node tests/host-logic.test.js     # 75 mock-host tests, no After Effects needed

# syntax spot-check (copy first — Node rejects .jsx)
cp host/quickkit.jsx /tmp/qk.js && node --check /tmp/qk.js
node --check extension/js/panel.js

# install into CEP (Windows)
cmd //c "scripts\\install.bat"    # then restart AE/PPro: Window > Extensions > QuickKit

# browser preview of the panel with a fake host (no Adobe apps)
cd tests/.preview && python -m http.server 8752   # open http://127.0.0.1:8752/index.html
# fake-cep.js stubs window.__qk.call; append ?host=PPRO to see the locked Premiere state
```

Real-app verification = walk `docs/manual-test-checklist-part4.md` (and parts
1–3). Report each item's number, expected result and what actually happened.

## 7. Next 3 concrete actions

1. **Run `docs/manual-test-checklist-part4.md` in After Effects 26.5** — the
   connection fix, preset capture/apply, import/export dialogs and undo
   granularity are all `UNTESTED` until then. Report results into
   `PROGRESS.md` (flip `UNTESTED` rows) and `WORKLOG.md`.
2. **If any checklist item fails, fix and re-run both suites** — start with
   the reserved-word scan (`node tests/check-static.js`) for any host-file
   error, since a single reserved word silently kills every host function.
3. **Then choose the next part** (per `PROJECT_RULES.md`: one part at a time,
   checks → checklist → `PROGRESS.md` → STOP): candidates are the **Bridge**
   tool, **Premiere Silence**, or polish. Record the new prompt as
   `prompts/PROMPT_6.md` before starting.
