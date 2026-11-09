# PROMPT 11 — PART 6D: Premiere Pro library features

**STATUS: IN PROGRESS**

Verbatim user prompt (2026-10-28):

> RESUME: Read PROJECT_RULES.md and PROGRESS.md first. Summarize status in
> 3 lines. Then do PART 6D only.
>
> PART 6D: Premiere Pro library features
> First, check Adobe's current Premiere scripting docs for importMGT,
> getMGTComponent and keyframe APIs. Tell me the exact methods you will
> use and any version limits before writing code.
>
> 1. MOGRT APPLY: clicking a MOGRT item imports it onto the timeline at
>    the playhead on the selected video track using the sequence import
>    MOGRT method, then lets me type text in the panel and writes it into
>    the template's text parameter. Expose the template's other editable
>    parameters as controls where the API allows.
> 2. KEYFRAME RECIPES (pr-recipe) for any selected clip or graphic: fade
>    in/out, slide in/out (4 directions), scale pop, zoom in/out, shake,
>    spin, flicker. Use keyframes on Motion and Opacity, with duration,
>    direction and easing controls, as one undo step.
> 3. TARGETING: apply to selected clips, or to the clip under the
>    playhead, with clear errors for nothing selected or locked tracks.
> 4. Dim items that are not supported in Premiere.
> 5. Optional: a "Bin organizer" tool to create standard bins (Footage,
>    Audio, Graphics, Exports), sort selected project items into them by
>    type, and rename in bulk.
> 6. Library state, favorites and recents stay in sync with the AE side
>    because both read the same library folder.
>
> Report what you could and could not test, give me a manual test
> checklist (MOGRT import, text edit, each recipe on a clip and on a
> graphic, locked track, nothing selected), update PROGRESS.md, and STOP.
