# QuickKit — Part 6C manual checklist (Text presets + MOGRT export)

Version **0.9.0**. Run this with **After Effects 26.5** and **Premiere Pro
26.0.2** on the same Windows machine. Each numbered line says what to do and
what should happen. Stop at the first failure and send the number, the expected
result and what you saw instead.

What was checked **without** the apps:

- `node tests/text-presets.test.js` — 31 tests on the real engine:
  - 54 presets, all 12 requested categories populated, unique slug ids;
  - every preset declares `in`, `out` or `both`, and exposes duration, delay
    and easing (all seven parameters are exposed somewhere);
  - every preset compiles to a plan that survives a JSON round trip; key times
    are sorted and inside 0..1; values are concrete (`dx`/`dy`, `mx`/`my`,
    `deg`) or the literal `"base"`;
  - in/out overrides drop the opposite half, and in-only/out-only presets
    refuse to flip;
  - duration/delay/distance clamps, distance ratio, direction signs, overshoot
    keys, stagger → selector smoothness, words vs characters, em offsets,
    loop tiling, easing fallbacks, preview kinds;
  - the host defines `qkTextPresetApply` / `qkTextPresetMogrt`, uses
    `exportAsMotionGraphicsTemplate`, `motionGraphicsTemplateName`,
    `addToMotionGraphicsTemplateAs`, `canAddToMotionGraphicsTemplate` and
    `openInEssentialGraphics`, and never saves your project for an export;
  - the panel seeds `.qktextpreset` items and calls both entry points;
  - `preview-core.planGeneration()` schedules rendered previews for
    `.qktextpreset` assets.
- `node tests/check-static.js` — 125 checks. Section 14 loads the engine and
  asserts the catalogue, the parameter exposure, the grid/category/apply/MOGRT
  ids and both host entry points; the ES3 reserved-word scan still guards the
  host.
- `node tests/host-logic.test.js` — 104 checks, including the library apply
  path that now understands `.qktextpreset`.

**Still UNTESTED, because it needs the real apps:**

- Turning a plan into real keyframes on a layer, the text-animator match names
  (`ADBE Text Position 3D`, `ADBE Text Blur`, …) and the range-selector
  properties (`ADBE Text Range Type2`, `ADBE Text Selector Smoothness`).
- Anchoring: position offsets are relative to the layer's own position, so any
  anchor or justification should survive — **verify by eye** (section G).
- Essential Graphics exposure and `exportAsMotionGraphicsTemplate`, including
  the project **save prompt** and the manual `openInEssentialGraphics()` path.
- The 54-item batch (time taken, memory) and a cancel during it.
- Render-Queue previews for `.qktextpreset` items (the Part 6B pipeline).
- Importing a produced `.mogrt` in Premiere Pro by hand (section M).
- Native dialogs and the real mouse/keyboard in both apps.

Nothing here talks to the internet. MOGRTs are staged in
`%TEMP%\QuickKit\mogrt\` and copied into
`%APPDATA%\QuickKit\library\items\<id>\` as a `mogrt` item.

---

## A. Before you start

1. Close both apps, run `scripts\install.bat`, then reopen them.
   **Expected:** `SUCCESS - QuickKit is installed.`; the panel header shows
   **v0.9.0**.
2. In After Effects, open `Window > Extensions > QuickKit` > **Text**.
   **Expected:** the message area is quiet, the **Category** dropdown reads
   *All categories (54)*, and the grid is filled with preset buttons. The first
   preset (*Soft Fade*) is selected, its note is shown, and the stage plays a
   short fade.
3. Open **Library**.
   **Expected:** 54 items appear under `Text / <category>` with a
   `.qktextpreset` asset, numbered 1..54 in the name list; the message says
   54 text presets were added. After a few seconds the Part 6B batch starts
   filling thumbnails (see section L).

## B. Catalogue and filtering

4. Open the **Category** dropdown.
   **Expected:** 12 entries with counts — Fade (4), Slide (5), Scale/Pop (5),
   Typewriter (4), Per-character (5), Per-word (4), Blur/Reveal (5),
   Rotate/Flip (5), Glitch (4), Wave/Bounce (3), Loop/Idle (4), Out animations
   (6). The counts add up to 54.
5. Choose each category in turn.
   **Expected:** the grid shows exactly that category's presets, the selected
   preset stays selected if it is still visible, and hovering any button shows
   the preset's one-line note as a tooltip.
6. Choose **All categories** again and click a preset at random.
   **Expected:** the note under the stage updates, the stage replays with that
   preset's approximation, and the parameter rows show or hide to match its
   exposed parameters.

## C. Parameter panel

7. Select **Soft Fade**.
   **Expected:** Duration, Delay, Easing visible; From/Distance hidden; Stagger
   and Overshoot hidden.
8. Select **Character Rise**.
   **Expected:** Stagger appears (default 40%), Overshoot hidden, From and
   Distance hidden. Drag **Stagger** to 90.
   **Expected:** the label reads `90%` while you drag and the stage shows a
   softer, later cascade.
9. Select **Punch In**, drag **Overshoot** to 25.
   **Expected:** the label reads `25%`; the stage's pop visibly passes full size
   before settling.
10. Select **Slide From Left**.
    **Expected:** From shows *Left* and Distance 80. Change From to *Above*.
    **Expected:** the stage now brings the sample down from the top.
11. Select **Pop Out** (an out-only preset).
    **Expected:** *Animate in* is unticked and disabled, *Animate out* is ticked;
    the stage only plays the exit.
12. Select **Fade In** (an in-only preset).
    **Expected:** *Animate out* is unticked and disabled.
13. Set Duration to `0.05`, then to `60`, then to `-3`.
    **Expected:** the panel accepts 0.05 and 60 (the stage becomes very fast /
    very slow) and clamps the negative value to something usable. Nothing
    breaks and no error dialog appears.

## D. Apply, live update and editability

14. Select a text layer in the Timeline, choose **Character Rise**, press
    **Apply to selected layers**.
    **Expected:** the message names the preset and "(in and out)"; one Ctrl+Z
    undoes the whole press. On the layer:
    - an animator named **QuickKit Character Rise** exists with a Range Selector
      and *Opacity* + *Position* animators,
    - the layer comment is `QuickKit Text Preset|char-rise|v1` (Layer >
      Layer Notes),
    - **no** keyframes were added to the layer's own transform.
15. With that layer still selected, drag **Duration** to 2.0 and wait half a
    second.
    **Expected:** the layers update **without pressing Apply** (the status line
    reads *Updated Character Rise*), and the animator's selector keys move. One
    Ctrl+Z still undoes each live update as its own step.
16. Press Apply again, then drag Duration back.
    **Expected:** no duplicated animators accumulate — the old
    **QuickKit Character Rise** animator is replaced, not stacked. (Check the
    animator count in the Timeline.)
17. Choose **Soft Fade**, press Apply.
    **Expected:** Opacity keyframes appear on the layer (0 → your opacity → 0);
    they are normal, editable keyframes — drag one and the result follows.
18. Immediately apply **Slide From Left** to the same layer.
    **Expected:** QuickKit clears **only its own** Opacity keys and writes
    position keys. If the layer had hand-made Opacity keys before step 17, the
    panel reports the layer as skipped with a reason instead of overwriting
    anything.
19. On a fresh text layer, add a keyframe to Position by hand, then apply
    **Soft Fade**.
    **Expected:** Soft Fade still works (Opacity is untouched by you) and the
    panel does not complain about Position.
20. On another fresh layer, apply **Soft Fade**, then add a hand keyframe to
    Opacity.
    **Expected:** applying any preset again reports that layer as skipped
    (already keyed) and leaves your key alone.

## E. Multi-line text

21. Make a text layer with three lines (`QuickKit`, `text presets`, `work
    here`), then apply **Character Rise**.
    **Expected:** the animation reads top to bottom as one stream; no line is
    skipped or revealed out of order, and the last line ends fully visible.
22. Apply **Word Slide** to the same layer.
    **Expected:** each **word** moves as a unit; characters inside a word never
    separate.
23. Apply **Typewriter**.
    **Expected:** characters appear left-to-right, line by line, and the final
    frame shows all three lines.

## F. Any font size

24. Duplicate that layer and set the font size to **12 px**; apply
    **Character Rise**.
    **Expected:** the per-character rise is small but visible (offsets are in em,
    so they scale with the type), not a 30-pixel jump.
25. Set another copy to **400 px** and apply the same preset.
    **Expected:** the rise scales up with the type; nothing is clipped or
    displaced by a fixed pixel offset.
26. Apply **Blur In** at 12 px and again at 400 px.
    **Expected:** the blur radius reads the same visually at both sizes (the
    animator takes a blur amount, not a pixel offset).

## G. Any anchor and justification

27. With a left-justified paragraph layer, move the anchor to the bottom-left
    (Anchor Point tool), then apply **Slide From Right**.
    **Expected:** the text slides in horizontally and settles exactly where it
    was; it does not jump to a new place or drift vertically.
28. Repeat with the anchor at top-right, centre and middle-left, and with
    centre- and right-justified paragraphs.
    **Expected:** each time the settled position matches the pre-apply position;
    only the animated offset differs. Rotation presets (**Tilt In**) rotate
    around the layer's anchor, as After Effects normally does.
29. Put the layer's **in point** at 00:00:03 and its **out point** at
    00:00:05, then apply **Soft Pop** with duration 0.8.
    **Expected:** the in animation starts at 00:00:03 and the out animation
    finishes at 00:00:05; no keys land outside the layer.

## H. Five text layers at once

30. Add five text layers (mixed sizes, mixed justification, at least one
    multi-line) spread across the timeline so their in/out points differ by a
    second or two. Select all five.
31. Apply **Word Fade**, then **Pulse Idle**.
    **Expected:** the message says *5 layers*; every layer gets its own animator
    and its own keys aligned to **its own** in/out points (look at two layers
    with different in points). One Ctrl+Z undoes the whole press.
32. Select five layers where one is locked and one is not text (for example a
    solid). Apply **Fade In**.
    **Expected:** the three eligible text layers animate; the message names the
    locked layer and the non-text layer as skipped. Nothing crashes, and nothing
    is applied to the solid.
33. Select nothing and press Apply.
    **Expected:** a readable message asking you to select text layers. No undo
    step is created.

## I. Every category, once

For each line: apply the preset to a two-line text layer and confirm the bullet.

34. **Fade — Soft Fade:** fades in at the in point and out at the out point.
35. **Slide — Rise Up:** rises from below, settles, sinks away at the end.
36. **Scale/Pop — Punch In:** snaps in from ~60% with a visible overshoot.
37. **Typewriter — Typewriter:** characters appear one at a time; the animator
    is named *QuickKit Typewriter*.
38. **Per-character — Cascade:** characters arrive left-to-right with a stagger.
39. **Per-word — Word Pop:** words pop in one at a time; word spacing never
    changes permanently.
40. **Blur/Reveal — Blur In:** characters sharpen out of a blur.
41. **Rotate/Flip — Card Flip:** the line unfolds horizontally from zero width.
42. **Glitch — RGB Split:** short horizontal jitter with flicker, then locks on.
43. **Wave/Bounce — Bounce Drop:** characters drop in and settle.
44. **Loop/Idle — Float Idle:** a slow float that repeats for the whole layer
    duration (scrub the whole layer, not just 2 seconds).
45. **Out animations — Fade Out:** nothing happens at the in point; the fade
    happens only at the out point.
46. **Loop/Idle — Wobble Idle** on a 10-second layer: the wobble repeats and the
    keyframe count stays bounded (no runaway keys).

## J. MOGRT export — one preset

47. In After Effects, select **Character Rise** in the Text tab and press
    **Export MOGRT**.
    **Expected:** After Effects may show its project **save** prompt. Choose
    **Don't Save** (QuickKit never saves your project for an export). The
    message then says the preset was exported and saved in the library, and the
    status line reads *MOGRT saved in the library*.
48. Open the **Library** and find `<preset name> (MOGRT)` as a type **MOGRT**.
    **Expected:** it lists After Effects *and* Premiere Pro support, its category
    starts with `Text /`, and its file on disk is
    `%APPDATA%\QuickKit\library\items\<id>\*.mogrt` (non-zero size).
49. Check the Project panel.
    **Expected:** no leftover `QuickKit MOGRT - …` comp and no `QuickKit
    Controls` null. Your own comps and their content are unchanged.
50. Open the produced `.mogrt` in After Effects via **Essential Graphics >
    Install Motion Graphics Template** (or Premiere, see M).
    **Expected:** controls named **Text**, **Delay (s)** and **Speed (%)**; the
    text can be retyped and multi-line text stays centred; Delay shifts the
    animation later, Speed 200 makes it finish in about half the time.
51. Export the same preset a second time.
    **Expected:** the library item is not duplicated (message: it is already in
    the library as a MOGRT); no second file is added.

## K. The manual fallback (only if step 47 reports one)

52. If the message says the template comp is open in **Essential Graphics** and
    the button now reads **Finish MOGRT export**:
    **Expected:** the named comp is open in the Essential Graphics panel with
    the same controls exposed. In that panel press **Export Motion Graphics
    Template**, save into the folder the message named (the panel prints it),
    then press **Finish MOGRT export**.
    **Expected:** the `.mogrt` is picked up into the library with no duplicate
    and the button returns to **Export MOGRT**. Report that this path was needed
    — it means the scripted export returned `false` on your machine.

## L. Batch export + previews

53. In After Effects, press **Export all 54**.
    **Expected:** the progress line counts *MOGRT 1 of 54 — <name>* upwards; the
    Cancel button appears; **Export MOGRT** is disabled while it runs.
54. Press **Cancel** after the third preset.
    **Expected:** the line reads *Stopping after this preset…*; the item in flight
    finishes; it stops with *MOGRT export finished: N added, M failed, 54
    tried.* and the library shows exactly N new MOGRT items. No half-written
    files.
55. Run **Export all 54** to the end.
    **Expected:** *54 added, 0 failed* (or it names the failures and why). The
    library then holds 54 MOGRTs; existing items are not duplicated.
56. Open the **Library** and let the automatic preview batch run (it starts by
    itself after the text presets are seeded; otherwise gear menu > **Generate
    missing previews**).
    **Expected:** each `.qktextpreset` item gets a 2–4 s, ≤480 px, silent
    looping clip whose motion matches the preset; the temp comp never appears in
    your Project panel; other queue items keep their original Render checkbox.
57. Cancel that batch after two items.
    **Expected:** it stops after the current item with *Stopped after N of …*;
    the items already generated keep their previews; nothing is left half
    written.

## M. Hand import one MOGRT in Premiere Pro

58. Copy one produced `.mogrt` from
    `%APPDATA%\QuickKit\library\items\<id>\` to your Desktop.
59. In Premiere Pro, open **Essential Graphics** > **Browse** > **Install Motion
    Graphics Template** (or drag the `.mogrt` onto the Essential Graphics panel).
    **Expected:** the template installs without an error and appears under
    **Local Templates** with the preset's name.
60. Drag it onto a sequence.
    **Expected:** it opens as a graphic clip at the playhead; the **Text**,
    **Delay (s)** and **Speed (%)** controls appear in the **Edit** tab.
61. Retype the Text to two lines and set Delay to 0.5, Speed to 200.
    **Expected:** the text updates, the animation starts half a second later and
    runs about twice as fast. Scrubbing the clip shows the same motion shape as
    in After Effects.
62. Do the same with a per-character preset (for example **Character Rise**).
    **Expected:** the stagger survives the round trip; characters still arrive
    in order.
63. Click QuickKit's **Library** tab in Premiere and find the same MOGRT.
    **Expected:** the item is listed as a MOGRT with Premiere support; Apply is
    still marked as coming in 6D (applying MOGRTs from the library is 6D), and
    its preview (if generated) plays.

## N. Report back

64. If everything passes, reply `6C ok` with the version line from step 1 and
    whether the save prompt appeared at step 47.
65. If something fails, send the step number, what you expected and what
    happened. The most useful extras:
    - the exact message text,
    - the animator name/count in the Timeline (steps 14–19),
    - whether the mode was the scripted export or the manual fallback (52),
    - whether Premiere accepted the `.mogrt` at step 59,
    - a screenshot of the Text tab and of the Essential Graphics panel.
