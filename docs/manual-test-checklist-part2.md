# Part 2 — Manual test checklist (After Effects)

Nothing in this file has been run inside After Effects by the build. The host
logic is covered by `tests/host-logic.test.js` against a mock app; the real
behaviour below is **UNTESTED** until you walk through it.

Use AE 26.5. Install first: `scripts\install.bat`, then restart AE.

## Setup for every test
Create a comp with three layers: a solid, a text layer and a shape layer. Give
the solid 100% → 50% scale and 30° rotation so the anchor maths is actually
tested. Keep one copy of the comp to undo back to.

## Anchor

1. **Anchor grid (all nine cells)**
   Select the solid → Anchor tab → click top-left, middle-center, bottom-right.
   Expected: the layer does not move on screen; in the Layer panel the anchor
   point sits on that part of the layer. One Ctrl+Z per click restores the
   previous anchor and position.
2. **Text layer**
   Select the text layer, click `bottom-center`.
   Expected: text stays in place, anchor moves to the bottom middle of the text
   box. Ctrl+Z once reverses it.
3. **Shape layer**
   Same as text. Expected: anchor sits on the shape's bounds, no visual shift.
4. **Multiple layers**
   Select all three, click `middle-center`.
   Expected: message says "…on 3 layers", none of the three moves.
5. **Center of selected layers**
   Select two layers far apart, press it.
   Expected: each layer's anchor jumps to the middle of the pair, layers stay
   put, rotating either layer now rotates around that shared centre.
6. **Locked layer**
   Lock one of three selected layers and press a cell.
   Expected: success message for the other two, and "Skipped locked: <name>".
7. **Null / camera selected**
   Select only a null, press a cell.
   Expected: error "No visible bounds", nothing changes, Ctrl+Z is not needed.
8. **Nothing selected**
   Expected: "Nothing selected. Select at least one layer in the Timeline."
9. **No comp open** (close the comp, leave the Project panel active)
   Expected: "No active composition…" for any button.

## Layers

10. **Rename with prefix + suffix + numbering**
    Select three layers. Prefix `UI_`, suffix `_v2`, numbering on, from 1, 2
    digits. Press **Rename selected layers**.
    Expected: `UI_<old name>_v2 01`, `…02`, `…03`. One Ctrl+Z restores all three.
11. **Find/replace**
    Names contain "copy". Find `copy`, replace `final`, numbering off.
    Expected: "Layer 1 copy" → "Layer 1 final".
12. **{n} token**
    Prefix `L_{n}_`, numbering on, start 7, 3 digits.
    Expected: `L_007_<name>`.
13. **Nothing to rename**
    Clear every field, numbering off → expected error naming what to add.
14. **Stagger in frames**
    Three layers starting at 0s, 1s, 2s. Offset 5, unit Frames (25 fps comp).
    Expected: start times 0, 0.2s, 0.4s.
15. **Stagger in seconds**
    Offset 1.5, unit Seconds. Expected: 0, 1.5s, 3s from the earliest layer.
16. **Stagger zero**
    Offset 0 → expected "Enter an offset greater than zero."
17. **Null and parent**
    Select two layers, press it.
    Expected: "QuickKit Null" appears at the middle of the selection, both
    layers are parented to it, neither moves. Ctrl+Z removes the null and the
    parenting.
18. **Sequence end to start**
    Three layers of different lengths, scattered on the timeline.
    Expected: they sit back to back in timeline order, starting where the
    earliest one started. Zero-length layers are skipped and named.
19. **Precompose**
    Select two layers, leave the name empty, press it.
    Expected: new comp "QuickKit Precomp", the two layers are inside it with
    their transforms unchanged. Custom name works too.
20. **Locked layer in a layer action**
    Lock one of the selection, run rename.
    Expected: others rename, message names the locked one.

## Easing

21. **Curve preview**
    Easing tab, click each preset.
    Expected: the curve and the one-line explanation change; the pressed preset
    is highlighted.
22. **Easy ease**
    Select two or more keyframes on a Position property, press Apply.
    Expected: keyframes become bezier with 33.33 influence; message counts them.
    One Ctrl+Z restores linear.
23. **Strong**
    Expected: 85 influence (check Keyframe Velocity).
24. **Overshoot**
    Select the second keyframe of a move with room after it, press Apply.
    Expected: two extra keys appear 2 and 5 frames after it, the first past the
    end value by 12%, then settling on the value. Message says "Added 2
    keyframes".
25. **Bounce**
    Same setup, press Apply.
    Expected: four extra keys over 8 frames, springing back and settling.
26. **No keyframes selected**
    Click an empty part of the timeline, press Apply.
    Expected: "Select at least one keyframe in the Timeline…"
27. **Overshoot on the first keyframe**
    Select only the first keyframe of a property → expected "without a previous
    key" in the error.
28. **Overshoot with no room**
    Select a keyframe 1 frame before the next one → expected "no room after
    them" in the error.
29. **Expression on the property**
    Add an expression, select a keyframe → expected "with expressions" in the
    error and no keys added.
30. **Text source keyframes**
    Select text source keyframes, overshoot → expected "non-numeric" skip.

## Panel behaviour

31. **Undo granularity**
    Every one of the actions above must be reversed by exactly one Ctrl+Z.
32. **Status bar**
    After each action the bottom bar shows "Last action: …" until the next one;
    Undo stays greyed with the Ctrl+Z tooltip.
33. **Messages**
    Success shows a check icon and plain text; failures show a dashed border and
    a sentence that says what to do, never a code.
34. **Resize**
    Drag the panel to 240px and 600px with the Layers tab open: fields stack at
    240, nothing clips, the tool column stays centred at 600.
35. **Locked tabs in Premiere**
    Open Premiere 26.0.2: Anchor, Presets, Easing and Layers show "Available in
    After Effects"; Silence is available (its tool is not built yet).

## Known limits
- 3D layers: anchor compensation is X/Y only.
- Overshoot/bounce are keyframe insertions, not a magic curve: they change the
  timing after the selected key.
- The panel's Undo button is intentionally disabled; undo is Ctrl+Z in the app.
