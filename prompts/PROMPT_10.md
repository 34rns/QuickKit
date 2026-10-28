# PROMPT 10 — PART 6C: Large original text animation library + MOGRT export

**STATUS: DONE (2026-10-28) — engine, panel, MOGRT export, batch, previews, tests, checklist. Real-app paths UNTESTED.**

Verbatim user prompt (2026-10-26):

> RESUME: Read PROJECT_RULES.md and PROGRESS.md first. Summarize status in
> 3 lines. Then do PART 6C only.
>
> PART 6C: Large original text animation library + MOGRT export
> 1. PRESET DEFINITIONS: a data-driven engine, so presets are JSON
>    definitions that generate the keyframes/expressions/animators, not
>    hand-written scripts. Build at least 40 original text presets across
>    categories: Fade, Slide, Scale/Pop, Typewriter, Per-character,
>    Per-word, Blur/Reveal, Rotate/Flip, Glitch, Wave/Bounce, Loop/Idle,
>    Out animations. Each has in, out, or in+out, and exposed parameters
>    (duration, delay, direction, easing, stagger, overshoot).
> 2. PARAMETER PANEL: after selecting a preset, show sliders and
>    dropdowns for its parameters, and re-apply live to the selected text
>    layer. Applied animations stay editable (real keyframes or text
>    animators).
> 3. QUALITY: all presets work on multi-line text, any font size, any
>    anchor/justification, and with multiple selected text layers.
> 4. MOGRT EXPORT (for Premiere): a button that builds a comp containing a
>    text layer with the preset applied, exposes the text and key
>    parameters through the Essential Graphics panel, and exports a .mogrt
>    into the library as a type "mogrt" item. First check Adobe's current
>    scripting docs for the MOGRT export method and tell me the exact API
>    you are using and its limits. If it cannot be fully scripted, build
>    the closest semi-automatic flow and explain the manual step.
> 5. Batch: "Export all text presets as MOGRTs" with progress and cancel.
> 6. Auto-generate previews for every new preset using the Part 6B system.
>
> Give me a manual test checklist (each category, multi-line text, 5 text
> layers at once, MOGRT export, and importing one of the MOGRTs by hand in
> Premiere to confirm it opens), update PROGRESS.md, and STOP.
