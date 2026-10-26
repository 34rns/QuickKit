# PROMPT 6 — PART 5: Silence cutter (Premiere)

**STATUS: DONE** (2026-10-26). All three suites pass —
`node tests/check-static.js` **55 / 0 failed**, `node tests/host-logic.test.js`
**89 / 0 failed**, `node tests/ffmpeg.test.js` **20 / 0 / 0 skipped** — against
the real bundled FFmpeg. Everything that only exists inside Premiere Pro is
`UNTESTED` and listed in `docs/manual-test-checklist-part5.md`.

**Provenance:** Current chat session, given directly (2026-10-26). Verbatim text
preserved below word for word.

**Numbering note:** the user calls this "PART 5" (parts are project milestones;
prompts are chat turns). This archive continues the prompt numbering, so the file
is `PROMPT_6.md` while the docs call the work "Part 5 — Silence cutter".

## Verbatim prompt text
> RESUME: Read PROJECT_RULES.md and PROGRESS.md first. Summarize status in
> 3 lines. Then do PART 5 only.
>
> PART 5: Silence cutter (Premiere)
> - Bundle ffmpeg for Windows (check its license, include the required
>   notice file) and call it from the panel using Node (CEP) to run
>   silencedetect on the selected clip or sequence audio.
> - Controls: threshold (dB slider), minimum silence length, padding before
>   and after, option to keep short breaths.
> - PREVIEW FIRST: show detected silences on a waveform in the panel, and
>   let me toggle individual segments on or off. Add colored sequence
>   markers for the detected segments.
> - APPLY: razor at the segments and ripple delete, as one undo step.
>   Modes: delete, only mark, or move to a muted track.
> - Handle multiple audio tracks, linked video, long files (progress bar,
>   cancel button, UI never freezes), and clips with no audio.
> - Handle paths with spaces and non-English characters on Windows.
> - Test ffmpeg detection with a sample audio file you generate, and report
>   what you could and could not test.
>
> Give me a manual test checklist (short clip, 1-hour clip, clip with no
> silence, clip with no audio), update PROGRESS.md, and STOP.
> and let me know after

## Deliverables for this prompt
- `prompts/PROMPT_6.md` (this file)
- `bin/ffmpeg/` — bundled binary slot, `NOTICE.txt`, `README.txt`
- `scripts/fetch-ffmpeg.ps1`, `scripts/install.bat` (copies `bin/`)
- `extension/js/ffmpeg-node.js` — Node side: locate, probe, silencedetect, peaks, cancel
- `extension/index.html` + `extension/css/tools.css` + `extension/js/panel.js` — Silence tab
- `host/quickkit.jsx` — Premiere silence section (`qkSilence*`)
- `tests/ffmpeg.test.js` — parser + real ffmpeg runs on a generated sample
- `tests/host-logic.test.js` — Premiere mock: mapping, merging, markers, apply modes
- `tests/check-static.js` — new checks
- `docs/manual-test-checklist-part5.md`
- `PROGRESS.md`, `HANDOFF.md`, `WORKLOG.md`, `README.md`, `docs/ASSET_LICENSES.md`

## Constraint
Part 5 only. Parts 1–4 are untouched except where Part 5 has to extend a shared
file (manifest version, panel tab list, tokens, test suites).
