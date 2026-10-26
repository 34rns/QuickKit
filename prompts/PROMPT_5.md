# PROMPT 5 — multi-tool handoff system (AGENTS/PROGRESS/HANDOFF/WORKLOG/prompts)

**STATUS: IN PROGRESS** (this prompt; being executed by the session that wrote
this file)

**Provenance:** Current chat session, given directly. Verbatim text preserved
below word for word.

## Verbatim prompt text
> Set up a seamless multi-tool handoff system for this project. Different AI
> tools (Freebuff, OpenCode) will continue each other's work, and sessions can
> be cut off mid-turn without warning. Do NOT change any source code this
> turn. You do ALL git and file work yourself; I will not run any commands.
>
> 0) GIT: If this isn't a git repo, run `git init`. Run
> `git add -A && git commit -m "checkpoint before handoff setup"` so the
> current uncommitted work is saved.
>
> A) PROMPTS: Find every prompt I gave in this chat (Prompt 1, 2, 3, 4...).
> Save each one's full original text, word for word, to prompts/PROMPT_N.md
> with a status header.
>
> B) PROGRESS.md: master checklist. For every prompt, list its steps/to-dos
> with status DONE / IN PROGRESS / TODO. Verify each by reading the actual
> code, not by trusting chat claims. For IN PROGRESS items, list exactly which
> files and functions are finished, half-written, or untested. Include this
> sprint for Prompt 4:
>  1. Fix ExtendScript reserved-word crash and add ES3 guard; verify connection path
>  2. Implement host preset storage, capture/apply, starters, import/export
>  3. Build Presets panel UI and wire actions
>  4. Extend mock host and static tests; run all checks
>  5. Install, verify UI with fake bridge and layouts, bump to 0.4.0
>  6. Write Part 4 checklist and update PROGRESS/README/docs
>  Also include the Part 4 plan details: preset capture/apply, storage in
>  %APPDATA%\QuickKit\presets, folders, search, favorites, drag reorder,
>  import/export, 15 starter presets, corruption handling, manual checklist.
>
> C) HANDOFF.md: what we're building, architecture, file map (what each file
> does), key decisions and why, known bugs and gotchas (e.g. ExtendScript
> reserved words like `short`, ES3 only), how to run/test, and the next 3
> concrete actions.
>
> D) WORKLOG.md: reverse-chronological journal. Backfill from git history, the
> current diff, and this chat. Format each entry: [date/time] [tool/model]
> [prompt N, step X] what was done, files touched, result.
>
> E) AGENTS.md: standing rules for ANY AI agent in this repo:
>  1. START OF SESSION: read AGENTS.md, PROGRESS.md, HANDOFF.md, WORKLOG.md
> (top 20 entries) and the relevant prompts/PROMPT_N.md. Run `git status`,
> `git log -10`, `git diff --stat`.
>  2. VERIFY: compare the checklist against the real code. A previous session
> may have been cut off mid-edit, so check IN PROGRESS files for half-written
> code, syntax errors, and missing pieces.
>  3. REPORT in 4 lines before working: current prompt/step, verified done,
> broken/incomplete, what you'll do first.
>  4. RESUME from the first step that is not verifiably DONE. Never redo
> verified work.
>  5. NEW PROMPTS: if I give a new prompt (N+1), save it to
> prompts/PROMPT_N+1.md first, add its steps to PROGRESS.md as TODO, then work
> on it. If the current prompt isn't finished, finish it first unless I say
> otherwise.
>  6. LIVE LOGGING (the agent does this, never me): after EVERY file created or
> edited, append one line to WORKLOG.md. After every completed step, update
> PROGRESS.md and HANDOFF.md and run `git add -A && git commit -m "prompt N
> step X: ..."`. Never batch logging to the end.
>  7. Never leave a file half-written. If budget is low, stop at a clean point,
> update all the files, and commit.
>  8. Include the stack, conventions, and project-specific rules (ES3/
> ExtendScript reserved-word check, etc.).
>
> F) When done, commit everything with
> `git add -A && git commit -m "add handoff system"` and print a 5-line summary
> of the current state.

## Notes on numbering
The user counts prompts across the whole project:
Prompt 1 = Part 1, Prompt 2 = Part 2, Prompt 3 = Part 3, Prompt 4 = fix +
Part 4, Prompt 5 = this prompt. Prompts 1 and 2 predate the preserved
transcript, so their files carry reconstructed scope instead of verbatim text —
this is flagged in each file.

## Deliverables for this prompt
- `prompts/PROMPT_1.md` … `prompts/PROMPT_5.md`
- `PROGRESS.md` (master checklist, per prompt)
- `HANDOFF.md`
- `WORKLOG.md`
- `AGENTS.md`
- commits: "checkpoint before handoff setup" (already existed as `fb77945`),
  then "add handoff system"

## Constraint honoured
No source code (`extension/`, `host/`, `design/`, `scripts/`, `tests/`) was
modified this turn — documentation and git only.
