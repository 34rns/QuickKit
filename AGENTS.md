# AGENTS.md — standing rules for every AI agent in this repo

Applies to **any** AI tool working here (Freebuff, OpenCode, CLI agents, a
human's assistant). `QuickKit` is a local CEP extension; sessions get cut off
mid-turn without warning, so these rules are how the next agent picks up
cleanly. Last updated: 2026-10-26 (Prompt 5).

---

## 1. START OF SESSION (do this before touching anything)

Read, in this order:

1. `AGENTS.md` (this file)
2. `PROGRESS.md` — the master checklist (DONE / IN PROGRESS / TODO per prompt)
3. `HANDOFF.md` — architecture, file map, decisions, gotchas, next actions
4. `WORKLOG.md` — top 20 entries only (reverse-chronological)
5. `prompts/PROMPT_N.md` for the prompt you are resuming (and the newest one
   if a new prompt has arrived)
6. `PROJECT_RULES.md` — permanent project rules

Then run:

```bash
git status
git log -10 --oneline
git diff --stat
node tests/check-static.js        # 34 checks, must end "0 failed"
node tests/host-logic.test.js     # 75 tests, must end "0 failed"
```

**Note:** `PROGRESS.md` and `PROJECT_RULES.md` are in `.gitignore` (deliberate
— "internal working documents"). They will not appear in `git status` and
`git add -A` will never commit them. They exist only on this machine: never
delete them, and if a fresh clone has neither, rebuild them from
`HANDOFF.md` before doing anything else.

## 2. VERIFY — trust the code, not the chat

A previous session may have been cut off mid-edit. Compare the checklist in
`PROGRESS.md` against the **actual files**:

- For every `IN PROGRESS` step, open the named files and look for
  half-written functions, stray `TODO`, unmatched braces, functions declared
  but never wired to a button, HTML sections with no JS.
- Syntax-check before and after edits:
  - host: `cp host/quickkit.jsx /tmp/qk.js && node --check /tmp/qk.js`
    (Node refuses a `.jsx` extension)
  - panel: `node --check extension/js/panel.js`
- **After every `host/quickkit.jsx` edit, run `node tests/check-static.js`.**
  Its ES3 reserved-word scan is the only thing that catches an ExtendScript
  reserved word (see §8) — one such word makes the whole host file fail to
  parse in After Effects and every `qk*` function disappears.
- Run `node tests/host-logic.test.js` after any host behaviour change.
- Anything not exercised in the real app stays labelled `UNTESTED`
  (`PROJECT_RULES.md` → Honesty). Never flip a row to tested on a hunch.

## 3. REPORT — four lines, before you work

```
Prompt/step:  <PROMPT N, step X>  (from PROGRESS.md / prompts/PROMPT_N.md)
Verified done: <what you confirmed exists and passes>
Broken / incomplete: <half-written files, failing checks, unclear scope>
First action: <the first thing you will do>
```

## 4. RESUME

Resume from the **first step that is not verifiably DONE** in `PROGRESS.md`.
Never redo verified work. Never re-run a passing suite "just in case" — but do
re-run it after *your* edits.

## 5. NEW PROMPTS

When the user gives a new prompt (N+1), in this order:

1. If the current prompt is unfinished, **finish it first** unless the user
   explicitly says otherwise.
2. Save the new prompt **verbatim** to `prompts/PROMPT_N+1.md` with a
   `**STATUS:**` header.
3. Add its steps to `PROGRESS.md` as `TODO`.
4. Only then start working.

## 6. LIVE LOGGING — the agent does this, never the user

- After **every** file created or edited: append one line to `WORKLOG.md`
  (`[date/time] [tool/model] [prompt N, step X] what changed — files — result`).
- After **every completed step**: update `PROGRESS.md` (status) and the
  relevant section of `HANDOFF.md` (next actions), then commit:
  `git add -A && git commit -m "prompt N step X: ..."`.
- **Never batch logging to the end.** Sessions die mid-turn; unbatching is how
  work gets lost or double-done.
- `WORKLOG.md`, `HANDOFF.md`, `AGENTS.md`, `prompts/` are tracked by git;
  `PROGRESS.md` is not (see §1) — its edits will not show in `git status`.
  That is expected.

## 7. NEVER LEAVE ANYTHING HALF-WRITTEN

If budget or time is running low, stop at a clean point: finish the current
file, syntax-check it, update `PROGRESS.md` + `HANDOFF.md` + `WORKLOG.md`, and
commit. A committed clean stop beats an uncommitted half-edit.

## 8. STACK, CONVENTIONS AND PROJECT-SPECIFIC RULES

**Stack:** CEP 12 (HTML/JS panel + ExtendScript host), one `CSXS/manifest.xml`
targeting AEFT 26.5 and PPRO 26.0.2, Chromium 99 panel runtime, Windows
10/11 only. No bundler, no framework, no build step, **no network at runtime**
(enforced by a static check), no external services.

**Conventions:**

- Plain JS in `extension/`; ES5-flavoured in `host/quickkit.jsx`.
- **Host contract:** every host entry point is a `qk*` function returning a
  JSON **string** `{"ok":true|false,…}`. The panel calls it through
  `window.__qk.call` (`extension/js/csinterface-lite.js`) as
  `qkBridge('<fn>("…json…")' + suffix, cb)`.
- **Undo:** one `qkBeginUndo` / `qkEndUndo` pair per public host call, closed
  even on error.
- **Design binding:** every colour, size, radius, shadow and font comes from
  `design/tokens.css`; single accent `#7C5CFF`; errors are never red. Icons
  only via `QKIcons.svg(name, size)` — never inline an SVG elsewhere.
- **Files:** all host logic lives in `host/quickkit.jsx` (sections marked; no
  `$.evalFile` split); all panel logic in `extension/js/panel.js`.
- **Assets:** original or licensed only; anything third-party gets a row in
  `docs/ASSET_LICENSES.md` before it ships.
- **Working style** (`PROJECT_RULES.md`): one part at a time — run every
  check, hand over a manual checklist, update `PROGRESS.md`, **STOP** and wait
  for "next". Short replies, show file paths, no beginner explanations.

**ExtendScript gotchas (these break the app, not the tests):**

- **Reserved words** — `short`, `class`, `default`, `enum`, `export`, `import`,
  `int`, `long`, `native`, `package`, `private`, `protected`, `public`,
  `static`, `super`, `throw`, `transient`, `try`, `use`, `var` … are reserved
  in ExtendScript. Using one as an **identifier or object key** makes the whole
  `.jsx` file fail to parse in AE — the panel then reports a script problem and
  *every* `qk*` function is missing. This exact bug shipped once as `short:`
  at `host/quickkit.jsx:1503` (now `tooShort:`). The guard is
  `es3ReservedHits()` in `tests/check-static.js`.
- **ES3 only** — no `let`/`const`, arrows, template literals, `Array.map`,
  `JSON`, `Object.keys`, trailing commas. `node --check` passing is **not** an
  ES3 check (the static suite states this); the reserved-word scan is.
- **Panel is Chromium 99** — modern syntax is fine there, not in the host.
- **File dialogs / property group names** are only testable in the real app:
  keep them labelled `UNTESTED` until a checklist covers them.

**Honesty:** never claim something works unless you ran it. Unverified =
`UNTESTED`.
