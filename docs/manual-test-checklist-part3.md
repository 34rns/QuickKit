# Part 3 — Manual test checklist (After Effects)

Nothing in this file has been run inside After Effects by the build. The host
logic is covered by `tests/host-logic.test.js` against a mock app; the real
behaviour below is **UNTESTED** until you walk through it.

Use AE 26.5. Install first: `scripts\install.bat /quiet`, then restart AE.
Open **Window > Extensions > QuickKit**, Tab **Text**.

## Setup for every test

1. New comp, 1920×1080, 25 fps, 10 seconds.
2. Text layer with the words **QuickKit** in any font, at 100% scale.
3. A solid layer behind it, for the mixed-selection tests.
4. Duplicate the comp once (Ctrl+D) and keep the copy untouched, so you can
   compare and undo freely.
5. Panel width 360px unless a test says otherwise.

For every Apply press: **one Ctrl+Z must reverse the whole press.** If a press
needs two undos, that is a bug — report it.

## Fade, slide, scale pop (layer transform)

These three write normal keyframes on the layer's own transform properties.
They refuse to run when that property already has keys or an expression.

1. **Fade in and out**
   Select the text layer, choose **Fade**, duration `0.6`, delay `0`, easing
   **Smooth**, both edges on, press **Apply to selected layers**.
   Expected message: `Applied fade in and out to 1 layer.`
   Expected in the Timeline: the layer's **Opacity** gets 4 keys —
   `0` at the layer in point, `100` 0.6s later, `100` 0.6s before the out
   point, `0` at the out point. The text fades in, holds, fades out.
   Ctrl+Z once removes all 4 keys and the layer is visible again.
2. **Fade with delay**
   Same, delay `0.5`.
   Expected: first key 0.5s after the in point, fade ends 1.1s after the in
   point; the out keys are 1.1s and 0.5s before the out point.
3. **Fade only in / only out**
   Turn **Animate out** off, apply. Expected: 2 keys at the in point, no keys
   near the out point, message says `fade in to 1 layer`.
   Then do the opposite (only out). Expected: 2 keys at the out point.
4. **Slide from the left**
   Choose **Slide**. Set **From** `Left`, **Distance** `120`, both edges on,
   apply.
   Expected: the layer's **Position** gets 4 keys; the first is 120px to the
   left of the current position and the second is the current position. The
   layer slides in and back out. One undo.
5. **Slide directions**
   Repeat with `Right`, `Above`, `Below` at distance 80.
   Expected: only the X (left/right) or Y (above/below) value changes, by 80px
   in the named direction. There must be no diagonal movement.
6. **Scale pop**
   Choose **Scale pop**, only **Animate in** on, apply.
   Expected: **Scale** gets 2 keys, the first is 80% of the layer's current
   scale (e.g. 200% becomes 160%), the second is the current scale. It pops up
   from smaller to normal. If the layer rotates, it must not drift.
7. **Existing keys are protected**
   Keyframe Opacity by hand at 1s (100%) and 2s (50%). Select the layer, apply
   **Fade**.
   Expected: error `…already has opacity keyframes`, no new keys, one Ctrl+Z
   does nothing (nothing was changed).
8. **Expression is protected**
   Put any expression on Opacity (e.g. `100`). Apply **Fade**.
   Expected: error `…has an expression on opacity`, nothing changes.
9. **Layer shorter than the animation**
   Trim the text layer to 1 second, apply Fade with duration `0.6` and both
   edges on.
   Expected: layer skipped with `too short for both animations…`, no keys, and
   the message names the layer.
10. **Both edges off**
    Untick both **Animate in** and **Animate out**, press Apply.
    Expected: `Turn on Animate in, Animate out, or both.` Nothing changes.
11. **Invalid duration**
    Set duration to `0`, press Apply.
    Expected: `Enter a duration greater than zero seconds.` Nothing changes.
12. **Mixed selection**
    Select the text layer and the solid, apply **Fade**.
    Expected: both layers keyed, message says `2 layers`.
    Now undo, choose **Typewriter**, apply again.
    Expected: only the text layer is animated; message says
    `Skipped, not a text layer: <solid name>`.
13. **Locked layer**
    Lock the text layer, apply any preset.
    Expected: `No layers were animated… Locked: <name>`, nothing changes.

## Typewriter, stagger, blur reveal (text animators)

These add a **named text animator** to the layer. The Source Text is never
modified, so the words stay editable after the press. Each animator uses a
Range Selector whose **Start** percentage is keyed from 0 to 100 for the in
edge, and 100 to 0 for the out edge.

14. **Typewriter in and out**
    Select the text layer, choose **Typewriter**, duration `0.8`, delay `0`,
    both edges on, apply.
    Expected:
    - Timeline shows `QuickKit Typewriter` under **Text > Animators**.
    - Its **Opacity** is `0%`.
    - Its **Range Selector 1 > Advanced** is set to **Percentage** and
      **Characters** where those controls exist.
    - **Start** has 4 keys: `0` at the in point, `100` 0.8s later, `100` 0.8s
      before the out point, `0` at the out point. **End** stays `100`.
    - The words type on left-to-right, hold, then un-type from the right.
    - The text remains editable; typing new words still animates.
    - One Ctrl+Z removes the whole animator.
15. **Typewriter only in**
    Untick **Animate out**, apply. Expected: 2 Start keys at the in point and
    no keys near the out point; the text stays visible after typing in.
16. **Typewriter keeps character spacing**
    Apply typewriter to a text layer with wide tracking.
    Expected: characters do not move sideways as they appear. Only opacity
    changes, so the layout must not reflow. If characters push each other, the
    animator is wrong — report it.
17. **Stagger**
    Choose **Stagger**, both edges on, apply.
    Expected: a `QuickKit Character Stagger` animator with **Opacity** 0 and a
    **Position** offset of `(0, 40)`. Characters fade in with a small downward
    starting offset and rise into place, then fade out. If they fall instead of
    rise, report it (the offset sign is wrong).
18. **Blur reveal**
    Choose **Blur reveal**, both edges on, apply.
    Expected: a `QuickKit Blur Reveal` animator with **Blur** `20` and
    **Opacity** 0. Characters sharpen into focus and soften out again.
    Check both **Classic 3D** and **Cinema 4D** renderers, and check
    **Fast Draft** — if the blur does not render, note which renderer failed.
    This is the most likely match-name failure: if the message says
    `text blur is not available`, the property name needs correcting.
19. **Press twice**
    Apply **Typewriter** twice in a row to the same layer.
    Expected: only one `QuickKit Typewriter` animator remains after the second
    press. It must not stack two animators. Two Ctrl+Z must undo the two
    presses separately.
20. **Different animator kinds coexist**
    Apply Typewriter, then Stagger, then Blur to the same layer.
    Expected: three separately named animators, all editable, no error. Each
    press is one undo step. Remove one by hand; the other two must still work.
21. **Existing user animator is untouched**
    Add your own animator (Text > Animate > Opacity) and give it a name. Apply
    **Typewriter**.
    Expected: your animator is still there; QuickKit adds a second one and does
    not rename or remove yours.
22. **Non-text layer**
    Select only the solid, apply **Typewriter**.
    Expected: `Typewriter needs text layers; skipped: <solid name>`, nothing
    changes.
23. **Paragraph text**
    Use a paragraph text box with three short lines and a long word. Apply
    **Typewriter**.
    Expected: characters reveal across lines in reading order; words do not
    jump between lines. If the reveal runs by line instead of by character,
    the selector type is wrong — report it.
24. **Expressions on Source Text**
    Add an expression to Source Text, then apply **Typewriter**.
    Expected: the animator is still added (it does not key Source Text), and
    the expression keeps working.
25. **Layer shorter than both edges**
    Trim to 1 second, apply Typewriter with duration `0.6` and both edges on.
    Expected: `too short for both animations…`, no animator added.

## Panel and preview

26. **Preset preview**
    At 360px wide, click each of the six presets in turn.
    Expected: the word **QuickKit** in the preview stage plays that animation
    once and returns to normal. The one-line note under the stage changes.
    The slider controls are hidden except for **Slide**.
27. **Timing and easing change the preview**
    With **Fade** selected, set duration `1.5`, delay `0.5`, easing **Linear**.
    Expected: the preview waits, fades slowly, holds, fades out slowly, and the
    motion is even. Switch to **Snappy**; the motion is faster at the start.
28. **Both edges off in the preview**
    Untick both edge boxes.
    Expected: the stage stays still at full opacity; no animation runs. Press
    Apply still shows the host error from test 10.
29. **Reduced motion**
    Turn on Windows **Settings > Accessibility > Visual effects > Animation
    effects** off (or use a Chromium flag to emulate `prefers-reduced-motion`).
    Reopen the panel and click presets.
    Expected: no movement; the stage shows the final readable state. The host
    animation still applies normally.
30. **240px layout**
    Resize the panel to 240px.
    Expected: one preset per row, fields stacked, no horizontal scrollbar, the
    preview stage fits the column, Apply stays full width. The tab strip may
    scroll horizontally (by design).
31. **600px layout**
    Resize to 600px.
    Expected: a 480px centred tool column, two presets per row, two fields per
    row, no stretched inputs.
32. **Premiere Pro**
    Open the panel in Premiere Pro and select **Text**.
    Expected: `Available in After Effects` with the note about text layers.
    All other tabs still work; nothing calls the AE text functions.
33. **Not connected**
    Open `index.html` in a normal browser (or the preview server), press
    **Apply**.
    Expected: the message says QuickKit is not connected to After Effects and
    the status bar reads `Not connected — nothing changed`; nothing crashes.
34. **Keyboard and tooltips**
    Tab through the preset buttons and fields. Space/Enter selects a preset.
    Hover or focus any control.
    Expected: focus ring visible, tooltip appears and stays inside the panel,
    no tooltip covers the control it describes.

## What to report

For each failure: preset name, the exact message, what you expected, what the
Timeline showed (property and number of keys), AE version, and whether Undo
needed one or more presses. Screenshots of the Timeline expanded are ideal.

**Highest-risk items:** text blur match name, selector Advanced settings,
animator renaming, and typewriter on paragraph text. These are the four places
where the mock cannot prove real AE behaviour.
