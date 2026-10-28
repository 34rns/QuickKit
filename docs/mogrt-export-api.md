# MOGRT export — the API QuickKit uses, and its limits

Checked against Adobe's current After Effects scripting docs
(`ae-scripting.docsforadobe.dev`, generated from the AE 26.x scripting guide,
fetched 2026-10-26) and the After Effects Help pages for Motion Graphics
templates.

## The exact calls

| Call | Since | What it does |
|---|---|---|
| `comp.exportAsMotionGraphicsTemplate(doOverWriteFileIfExisting[, file_path])` | AE 15.0 (CC 2018) | Exports that comp as a `.mogrt`. **`file_path` is the destination folder, not a file.** Returns `true`/`false`. The file name comes from `comp.motionGraphicsTemplateName`, with `.mogrt` appended. |
| `comp.motionGraphicsTemplateName` | AE 15.0 | Read/write the name shown in Essential Graphics; it is also the exported file name (for example `My Template.mogrt`). |
| `prop.addToMotionGraphicsTemplate(comp)` | AE 15.0 | Adds a supported property to that comp's Essential Graphics panel. |
| `prop.addToMotionGraphicsTemplateAs(comp, name)` | AE 16.1 (CC 2019) | Same, with a custom control name. QuickKit uses this so controls read *Text*, *Duration (s)*, *Delay (s)*. |
| `prop.canAddToMotionGraphicsTemplate(comp)` | AE 15.0 | Tests support **and** whether the property is already added. |
| `comp.openInEssentialGraphics()` | AE 17.0 | Makes the comp the one Essential Graphics is editing — used for the manual fallback. |

Supported property types for Essential Graphics (from
`Property.canAddToMotionGraphicsTemplate()`): **Checkbox, Color, numerical
Slider (any single-value numerical property, e.g. Opacity or a Slider Control
effect), and Source Text.** Nothing else: no font picker, no dropdowns, no
multi-dimensional Scale/Position.

## What QuickKit does with them

1. Build a 1920×1080 / 24 fps comp with two lines of placeholder text (proves
   multi-line), centred, with the preset's keyframes/animators applied.
2. Add a `QuickKit Controls` null carrying two Slider Controls: **Delay (s)**
   and **Speed (%)**. They are exposed with `addToMotionGraphicsTemplateAs`,
   and expressions on the animated properties retime with `valueAtTime()`, so
   the sliders do something in Premiere. A *Duration* slider is deliberately
   not exposed: Essential Graphics has no expression editor, so a duration
   change could only be honoured by baking different keyframes, which a slider
   cannot do. Speed covers the useful half of that request.
3. Expose the text layer's Source Text as **Text**.
4. `comp.motionGraphicsTemplateName = <preset name>` then
   `comp.exportAsMotionGraphicsTemplate(true, <temp folder>)`.
5. Move the produced `.mogrt` into the library as a `mogrt` item, delete the
   helper comp and null, leave the user's comps alone.

## Limits (documented, not hidden)

- **The save prompt is the one manual step.** Adobe: *"If the project has been
  changed since the last time it was saved, After Effects will prompt the user
  to save the project. To avoid this, use the project save() method before
  exporting."* QuickKit will not call `app.project.save()`: that would write the
  user's project (and our helper comp) to disk without asking. So When AE asks,
  choose **Don't Save** — the export only needs the in-memory project. If the
  export returns `false`, the comp is already open in Essential Graphics: press
  **Export Motion Graphics Template** there and save to the folder QuickKit
  shows. The panel button then reads **Finish MOGRT export** in that state.
- **Sliders must drive expressions, not keyframes.** Essential Graphics cannot
  expose a dropdown or a multi-value property, so *Easing* and *Direction* are
  baked at export time; only Duration, Delay and Speed stay live. That is an
  Adobe limit, not a QuickKit one.
- **Templates that use expressions** (the retime sliders) may need After
  Effects installed on the machine that edits the MOGRT, depending on the
  Premiere version; Adobe's own guidance is to universalise expressions before
  sharing. QuickKit's expressions reference only a layer by name and a slider,
  which is the portable form.
- **Only the Classic 3D renderer** is supported in templates exported for
  Premiere without AE. QuickKit creates 2D text comps, so this is satisfied.
- **No Essential Graphics control for the text style.** Font, size, colour and
  justification stay as the template defines them; Premiere editors can change
  the **Text** only. Exposing a colour is possible (Color is supported) but
  intentionally not done in 6C.
- **`exportAsMotionGraphicsTemplate` is AE-only.** Premiere cannot export a
  `.mogrt` by script; the button is disabled there with a reason.
