# QuickKit — Part 6D manual checklist (Premiere library: MOGRT, recipes, bins)

Version **0.10.0**. Run this with **Premiere Pro 26.0.2** and **After Effects
26.5** on the same Windows machine. Each numbered line says what to do and what
should happen. Stop at the first failure and send the number, the expected
result and what you saw instead.

What was checked **without** the apps:

- `node tests/pr-recipes.test.js` — 33 tests on the real engine:
  - 18 recipes in 4 categories, unique ids and names, the full requested set
    (fade in/out/both, slide in/out in 4 directions, scale pop, zoom in/out,
    shake, spin, flicker);
  - every recipe compiles to a JSON-safe plan; `plan()` is repeatable and never
    mutates its input; numbers clamp; unknown easing falls back to smooth;
    recipes only expose the parameters they use;
  - direction signs, amount scaling (slide distance, pop overshoot, flicker
    dips), key ordering by edge then time, `"base"` values, and the fact that
    every default plan stays inside the host's clamps;
  - the host uses `importMGT`, `getMGTComponent`, `AE.ADBE Motion`,
    `AE.ADBE Opacity`, `areKeyframesSupported`, `setTimeVarying`, `addKey`,
    `setValueAtKey`, `setInterpolationTypeAtKey`, `isLocked`, `createBin`,
    `moveBin` and `getCurrentProjectViewSelection`;
  - the panel calls all seven entry points and seeds `.qkrecipe.json` items;
  - `library-core.js` keeps recipes Premiere-only.
- `node tests/host-logic.test.js` — 123 checks, including a mock Premiere world:
  context, recipe targeting (selected / playhead / nothing / audio / locked /
  already keyed), host re-clamping, MOGRT insert + JSON text payload + plain
  controls, bin create/sort/rename, and undo balance on every path.
- `node tests/check-static.js` — 140 checks. Section 21 asserts the engine, the
  script tag, the seed key, the seven host entry points, the API strings, the
  new pane ids and the dimming rule; the ES3 reserved-word scan still guards the
  host.

**Still UNTESTED, because it needs the real apps:**

- Whether Premiere accepts keyframe times as **sequence** times
  (`clip.start.seconds + offset`). This is the one assumption in the keyframe
  path; step 31 is the direct check.
- Real keyframe writes on Motion/Opacity for footage, adjustment layers and
  MOGRT graphics, and the interpolation enum values (0 linear, 4 hold,
  5 bezier).
- `sequence.importMGT` with a QuickKit-staged `.mogrt`, and the JSON text
  payload (`textEditValue` / `fontTextRunLength`) on real templates.
- `track.isLocked()` — undocumented and feature-detected.
- `app.getCurrentProjectViewSelection()` (Premiere 15.4+) and bin moves in the
  real Project panel.
- Native dialogs and the real mouse/keyboard in both apps.

Nothing here talks to the internet. Recipes are data in
`extension/js/pr-recipes.js`; the library stays in
`%APPDATA%\QuickKit\library\`.

---

## A. Before you start

1. Close both apps, run `scripts\install.bat`, then reopen them.
   **Expected:** `SUCCESS - QuickKit is installed.`; the panel header shows
   **v0.10.0**.
2. Open Premiere Pro, open a project with at least one sequence that has two
   video tracks (V1 and V2) and one clip on V1.
3. Open `Window > Extensions > QuickKit` and switch to the **Library** tab.
   **Expected:** the 18 recipes appear under **Recipe / …** (Fade, Slide,
   Scale, Motion), each with a **Premiere recipe** badge.
4. Switch to After Effects, open the same panel, **Library** tab.
   **Expected:** the same 18 recipes are listed and dimmed; the AE presets are
   not dimmed. (Section H checks the shared state.)
5. Back in Premiere, select the **Fade In** recipe card.
   **Expected:** the preview pane shows a fade approximation, the Apply button
   reads **Apply recipe**, and a **Target** row appears under the parameters.

## B. Targeting (recipe)

6. With **Target = Selected clips** and **nothing** selected on the timeline,
   press **Apply recipe**.
   **Expected:** an error starting *Nothing is selected…*, nothing changes, and
   Undo stays disabled.
7. Select the V1 clip, press **Apply recipe**.
   **Expected:** the clip gets two opacity keyframes at its in point and half a
   second later; the status bar says *Applied Fade In to … (2 keyframes)*.
8. Press **Ctrl+Z** once.
   **Expected:** both keyframes disappear in one step (one undo group).
9. Move the playhead over the middle of the V1 clip, set **Target = Clip under
   playhead**, press **Apply recipe**.
   **Expected:** the clip under the playhead is keyed even though nothing is
   selected.
10. Move the playhead into empty timeline space, press **Apply recipe** again.
    **Expected:** *No clip under the playhead…*, nothing changes.
11. Lock V1, select the clip, press **Apply recipe**.
    **Expected:** *The clip is on locked V1. Unlock the track and try again.*
    Unlock V1 afterwards.
12. Select only an audio clip on A1, press **Apply recipe**.
    **Expected:** *Only audio clips are selected…*.

## C. Each recipe on a video clip

For steps 13–28: select the V1 clip, choose the recipe, leave duration 0.6 s,
easing Smooth, amount 100, press **Apply recipe**, then **Ctrl+Z** before the
next one.

13. **Fade In** — opacity rises from 0 to the clip's own opacity at the in point.
14. **Fade Out** — opacity falls to 0 at the out point.
15. **Fade In and Out** — four keys: in at the start, out at the end.
16. **Slide In From Left** (direction Left) — Position starts 40% of the frame
    width to the left and settles on the original position.
17. **Slide In From Right** (direction Right) — starts 40% to the right.
18. **Slide In From Top** (direction Top) — starts 40% above.
19. **Slide In From Bottom** (direction Bottom) — starts 40% below.
20. **Slide Out To Left** — leaves to the left at the out point.
21. **Slide Out To Right** — leaves to the right.
22. **Slide Out To Top** — leaves upwards.
23. **Slide Out To Bottom** — leaves downwards.
24. **Scale Pop** — scale 60% → 108% → base, with a fade in.
25. **Scale Pop Out** — base → 108% → 60%, with a fade out.
26. **Zoom In** — scale base → 125% across the in window.
27. **Zoom Out** — scale base → 80% across the out window.
28. **Shake** — seven Position keys that settle on the original position.

## D. The remaining recipes on a graphic

Insert any MOGRT (section E) or use a colour matte / adjustment layer on V2,
select it, and repeat:

29. **Spin In** — rotation starts at −180° and settles on the graphic's own
    rotation.
30. **Flicker In** — opacity dips repeatedly and locks on at 100% (or the
    graphic's own opacity).
31. **Timing check** — with the clip selected and the recipe applied, open
    **Effect Controls > Motion** and confirm the first key sits at the clip's
    **in point on the timeline**, not at 0 s of the sequence. This confirms the
    sequence-time assumption; if the keys land at 0 s, stop and report it.
32. Change **Easing** to **Linear**, apply **Fade In** to the clip.
    **Expected:** both keys are linear, not bezier.
33. Change **Easing** to **Hold**, apply **Fade In** to the clip.
    **Expected:** the value holds and jumps at the second key.
34. Apply a recipe to a clip that already has Motion keys on that channel.
    **Expected:** *… already has keyframes on position (undo those first)*, and
    the existing keys are untouched.

## E. MOGRT import

35. Select a **MOGRT** item in the library (or export one from After Effects
    with Part 6C first).
    **Expected:** the Apply button reads **Insert at playhead** and a **Video
    track** picker appears.
36. Put the playhead at 2 seconds, choose **V2**, press **Insert at playhead**.
    **Expected:** the template is inserted on V2 at 2 s; the status bar names
    the track; the project panel gains the template item.
37. Press **Ctrl+Z** once.
    **Expected:** the inserted clip and its project item both disappear.
38. Insert it again on **V1** while V1 is locked.
    **Expected:** *V1 is locked. Unlock the track, then insert the MOGRT again.*
39. Insert it with **no sequence open**.
    **Expected:** *No open sequence…*.
40. Insert it with the `.mogrt` file deleted from the library folder.
    **Expected:** *The MOGRT file is not on disk: …* (Repair the library
    afterwards).

## F. MOGRT text and controls

41. After a successful insert, look below the preview.
    **Expected:** a **Controls on "…"** block listing the template's exposed
    controls, with a **Refresh** button.
42. Type a two-line title into the text box and press **Update text**.
    **Expected:** the graphic on the timeline shows the new text, on two lines,
    in the template's own style. Undo reverses it in one step.
43. Press **Refresh**.
    **Expected:** the text box still shows the new text (read back from the
    template).
44. Change a numeric control (for example Size) and press Enter/Tab.
    **Expected:** the graphic updates; the value survives a **Refresh**.
45. Toggle a checkbox control.
    **Expected:** the graphic updates.
46. A control that is neither text, number nor checkbox shows
    *Not editable from a script* and no input.
47. Delete the inserted graphic from the timeline, then press **Update text**.
    **Expected:** *That MOGRT is no longer on the timeline. Insert it again.*
48. Select an ordinary footage clip and check the pane.
    **Expected:** no MOGRT block appears.

## G. Dimming and unsupported items

49. In Premiere, select an **After Effects preset** item.
    **Expected:** the card is dimmed, Apply is disabled, and the tooltip says it
    only works in After Effects.
50. In After Effects, select a **MOGRT** or a **recipe** item.
    **Expected:** dimmed, Apply disabled, tooltip says Premiere Pro only.
51. Double-click a dimmed item.
    **Expected:** it previews, but nothing is applied and a readable error
    explains why.

## H. Shared library state (AE ⇄ Premiere)

52. In Premiere, favourite **Fade In** and preview three recipes.
53. Close Premiere, open After Effects, **Library** tab.
    **Expected:** **Fade In** is still in Favorites and the three recents are
    the same; the recipes are dimmed but present.
54. In After Effects, favourite a text preset, then reopen Premiere.
    **Expected:** that text preset is in Favorites there too.
55. Rename a folder or move a recipe into a folder in one app, then check the
    other.
    **Expected:** the same folder tree, because both read one `library.json`.

## I. Bin organizer (optional)

56. In Premiere, **Library** tab, scroll to **Bin organizer**.
    **Expected:** the section is visible; in After Effects it is hidden.
57. Press **Create bins** with a fresh project.
    **Expected:** Footage, Audio, Graphics and Exports appear in the Project
    panel; the message names them.
58. Press **Create bins** again.
    **Expected:** *The standard bins already exist (…)* and no duplicates.
59. Select a `.mov`, a `.wav`, a `.png` and a sequence in the Project panel,
    press **Sort selection**.
    **Expected:** each lands in the matching bin; the status bar reports 4 items
    moved; one **Ctrl+Z** puts them all back.
60. Press **Sort selection** with nothing selected in the Project panel.
    **Expected:** *Nothing is selected in the Project panel…*.
61. Select two clips, set **Rename = Find and replace**, Find `Shot`, Replace
    `Scene`, press **Rename selection**.
    **Expected:** both names change; one undo reverses both.
62. Set **Rename = Add prefix and suffix**, prefix `QK_`, press **Rename
    selection**.
    **Expected:** names gain the prefix.
63. Set **Rename = Number in order**, prefix `Shot_`, press **Rename
    selection**.
    **Expected:** names become `Shot_01`, `Shot_02`, …
64. Select a bin and press **Rename selection**.
    **Expected:** the bin is skipped with a note; nothing is renamed.

## J. Regression and close-out

65. Run every automated suite once more:
    `node tests/check-static.js`, `node tests/host-logic.test.js`,
    `node tests/render.test.js`, `node tests/ffmpeg.test.js`,
    `node tests/library.test.js`, `node tests/preview.test.js`,
    `node tests/text-presets.test.js`, `node tests/pr-recipes.test.js`.
    **Expected:** every suite ends `0 failed`.
66. In After Effects, apply any text preset and export one MOGRT.
    **Expected:** Part 6C still works unchanged.
67. In Premiere, run the Silence cutter on a short sequence.
    **Expected:** Part 5 still works unchanged.
68. Check the panel header and `CSXS/manifest.xml` both say **0.10.0**.
69. Close and reopen the panel in both apps.
    **Expected:** no script error, no missing `qk*` function, the library loads.

Report the first failing number with the expected and actual result. Anything
not covered here stays **UNTESTED**.
