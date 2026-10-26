# PROMPT 7 — PART 6: Bridge (Premiere ⇄ After Effects file handoff)

**STATUS: DONE** — 2026-10-26. Every step is in `PROGRESS.md` → "Prompt 7 —
Part 6: Bridge". Evidence: 104 mock-host tests, 12 real-`aerender` tests
(`26.5x89`), 75 static checks, install of 0.6.0, browser check in both host
modes with 0 console messages. Real two-app behaviour (handoff from a real
sequence, `ImportOptions`, layer trim, `outputModule`, `importFiles`,
`overwriteClip`, BridgeTalk) stays **UNTESTED** until
`docs/manual-test-checklist-part6.md` is walked through.

Verbatim user prompt (2026-10-26):

> test whatever you can yourself i will test when i want after adding some more feture now after you test start RESUME: Read PROJECT_RULES.md and PROGRESS.md first. Summarize status in
> 3 lines. Then do PART 6 only.
>
> PART 6: Bridge
> - "Send to After Effects": take the selected Premiere clip(s), use the
>   used in/out range, write a handoff JSON (frame rate, resolution,
>   duration, clip name, in/out, source path), and have After Effects
>   create a matching comp with the footage in it. The panel running in
>   After Effects picks up the handoff.
> - "Send back to Premiere": render the comp (choose aerender or the
>   render queue, whichever is more reliable, and tell me why), then import
>   the file into Premiere and place it on the timeline at the original
>   position.
> - Step-by-step status in the panel with a specific error message for
>   each step that can fail. Be honest in the UI: this is a file handoff,
>   not Dynamic Link.
> - Document the limitations in the README.
>
> Give me a manual test checklist, update PROGRESS.md, and STOP. remember about hand over and log everything as i said 1st  and make it
