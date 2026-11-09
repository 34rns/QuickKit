# Premiere Pro library API — what QuickKit 6D uses, and its limits

Checked against Adobe's Premiere Pro scripting guide
(`ppro-scripting.docsforadobe.dev`, source files in
`github.com/docsforadobe/premiere-scripting-guide`, fetched 2026-10-28), the
guide's changelog, Adobe's `PProPanel` sample (`Premiere.jsx`) and Adobe
community threads where the docs are thin.

Premiere's ExtendScript API is **frozen**: the changelog says no further
ExtendScript changes are planned (PPro 23.0 note), and ExtendScript stays
supported through the CEP removal. Everything below is the current API, not a
future one. QuickKit targets **PPRO 26.0.2** but keeps every call behind a
feature check so older 22.x builds degrade with a message instead of an
exception.

## 1. MOGRT insertion

| Call | Since | Notes |
|---|---|---|
| `sequence.importMGT(path, timeTicks, vidTrackOffset, audTrackOffset)` | PPro 13.x (undocumented in the first guide, present in `PProPanel`) | `path` is a full filesystem path, `timeTicks` is a **string of ticks** (254016000000 ticks = 1 s), offsets are **zero-based track indexes**. Returns a `TrackItem`, or `0` on failure. |
| `sequence.importMGTFromLibrary(libraryName, mgtName, timeTicks, vidTrackOffset, audTrackOffset)` | PPro 13.x | Same, but the template comes from the signed-in user's Creative Cloud Libraries. **Not used**: QuickKit is local-only and never talks to Creative Cloud. |
| `trackItem.getMGTComponent()` | PPro 13.x | Returns the `Component` holding the template's exposed parameters, or `0` when the item is not a MOGRT. The docs put this method on `TrackItem`; one guide page mislabels it as an insert method. Insert first, then ask the inserted item. |

Limits:

- `importMGT` returns a **new track item**; it also adds the template to the
  project panel. Undo removes both.
- The MOGRT's duration is defined by the template, not by the call. QuickKit
  cannot set it during insert.
- There is no "insert at track X" beyond the zero-based offset. QuickKit shows
  a track picker built from `sequence.videoTracks` so the panel choice is
  explicit instead of guessing Premiere's track targeting (not exposed).
- Audio: `audTrackOffset` 0 inserts the template's audio (if any) on A1. QuickKit
  passes 0, matching Adobe's sample; most title MOGRTs have no audio.

## 2. MOGRT parameters (text and the rest)

| Call | Notes |
|---|---|
| `component.properties` | `ComponentParamCollection`; iterate `numItems` or index. |
| `component.properties.getParamForDisplayName(name)` | **Undocumented but present** and used by Adobe's own samples/community answers. Matches the **localized** `displayName`; QuickKit also falls back to a full scan and a case-insensitive compare. |
| `param.displayName` | Localized control name from Essential Graphics (for example `Text`, `Title`, `Lower Third`). |
| `param.getValue()` | Number, boolean, or a **string**. MOGRT text controls return a JSON string; a simple control returns a plain string. |
| `param.setValue(value, updateUI)` | `updateUI` = 1. For text, pass the JSON string back (not just the new text). |
| `param.setColorValue(a, r, g, b, updateUI)` | Color controls. QuickKit shows color controls read-only in 6D. |

**Text payload.** A styled MOGRT text control stores a JSON object; the text
lives in `textEditValue`, and `fontTextRunLength` is an array of run lengths.
The working pattern (Adobe community, 2024) is:

```js
var param = component.properties.getParamForDisplayName("Text");
var payload = JSON.parse(param.getValue());
payload.textEditValue = "New line 1\nNew line 2";
payload.fontTextRunLength = [payload.textEditValue.length];
param.setValue(JSON.stringify(payload), true);
```

QuickKit does exactly that, and handles the two other shapes: a plain string
(set it directly) and a JSON string without `textEditValue` (refused with a
message rather than corrupting the control). Other exposed parameters are
edited as number or checkbox controls; unknown/JSON parameters are shown
read-only.

Limits:

- Parameter **names are localized**. A German Premiere shows `Text` as
  something else; QuickKit lists whatever the template exposes and lets the
  user pick, instead of hard-coding English names.
- There is no API to add or remove exposed controls — that is done in After
  Effects' Essential Graphics panel (QuickKit 6C does it).
- There is no "text style" API. Changing the font/size of a MOGRT's text from
  a script is not supported; only the text run itself.
- `getMGTComponent()` returns `0` for ordinary clips, so QuickKit can tell a
  graphic clip from footage.

## 3. Keyframes on Motion and Opacity

| Call | Notes |
|---|---|
| `trackItem.components` | `ComponentCollection`; includes the intrinsic **Motion** and **Opacity** components plus applied effects. |
| `component.matchName` | `AE.ADBE Motion`, `AE.ADBE Opacity`, `AE.ADBE Gaussian Blur 2`, … — the stable identifier. **Use this, not the index**: Adobe's own sample comments say `0 = clip, 1 = Opacity`, while a 2025 Adobe answer uses `components[1]` for Motion. The order is not contractual. |
| `component.properties` | `ComponentParamCollection`; Motion exposes Position, Scale (sometimes Scale Width/Height), Rotation, Anchor Point. |
| `param.areKeyframesSupported()` | `true`/`false`. Check before writing. |
| `param.isTimeVarying()` / `setTimeVarying(true)` | Turns the stopwatch on. |
| `param.addKey(time)` | `time` is a **Time object** (or a number of seconds in practice). |
| `param.setValueAtKey(time, value, updateUI)` | Scalar, `[x, y]` for Position, number for Scale/Rotation/Opacity. |
| `param.setInterpolationTypeAtKey(time, type, updateUI)` | `0` linear, `4` hold, `5` bezier. The obsolete ease-in/ease-out constants (1–3) are not used. |
| `param.getKeys()` | Array of Time objects. |
| `param.removeKey(time)` / `removeKeyRange(start, end, updateUI)` | Removing keys. |
| `param.getValue()` | Base value to offset from. Position is a 2-number sequence; Scale is a number (or a 2-number sequence on some builds); Opacity 0–100. |

**Time base.** Keyframe times are sequence times. Adobe's `PProPanel` sample
adds a key at `sequence.getPlayerPosition()` (the CTI) and a 2025 Adobe answer
keys at the CTI the same way. QuickKit therefore computes
`clip.start.seconds + offset`, never clip-relative seconds. This is the one
assumption that needs real-app confirmation (checklist step 31).

Limits and gotchas:

- `addKey` can throw `"Unknown error"` on some non-color properties; every call
  is wrapped and reported per channel.
- Keyframe **interpolation is an enum only** — no custom bezier handles, no
  separate in/out curves. "Smooth" is `5`, "Linear" `0`, "Hold" `4`; a "snap"
  curve is approximated by key placement, not by handles.
- There is **no clip comment marker** in the Premiere API. QuickKit cannot tag
  its own keyframes the way it tags After Effects layers, so a clip that
  already has keys on a channel is **skipped with a reason** instead of being
  overwritten. Undo is the way back from a wrong recipe.
- The script API has no expression engine, so a recipe is baked keys.
- Audio clips expose no Motion/Opacity; QuickKit skips them and says so.

## 4. Selection, playhead, tracks, locking

| Call | Notes |
|---|---|
| `app.project.activeSequence` | `0` when no sequence is open. |
| `sequence.getSelection()` | Array of selected `TrackItem`s, in temporal order. Includes audio items. |
| `sequence.getPlayerPosition()` | `Time` object for the CTI. |
| `sequence.setPlayerPosition(ticks)` | String of ticks. |
| `sequence.videoTracks` / `audioTracks` | `TrackCollection`; `numTracks`, index access. |
| `track.clips` | `TrackItemCollection` in temporal order. |
| `track.isLocked()` / `track.setLocked(0|1)` | **Undocumented but present** (Adobe community, verified on PPro 14.3+). QuickKit feature-detects it; when absent it reports "this build does not expose track locking" instead of pretending. |
| `trackItem.type` | `1` video, `2` audio. |
| `trackItem.start` / `end` | Sequence times, `Time` objects. |
| `trackItem.isSelected()` / `setSelected(state, updateUI)` | Selection. |

## 5. Bins and project items (optional Bin organizer)

| Call | Notes |
|---|---|
| `app.project.rootItem` | Root bin. |
| `rootItem.createBin(name)` | Creates a bin inside a bin; returns the new `ProjectItem` or `0`. |
| `projectItem.children` | `ProjectItemCollection`; `numItems`. |
| `projectItem.moveBin(targetBin)` | Moves an item into a bin. |
| `projectItem.renameBin(name)` / `projectItem.name = …` | Rename a bin / any item. |
| `projectItem.type` | `"CLIP"`, `"BIN"`, `"ROOT"`, `"FILE"` (and sequences report `"CLIP"` with `isSequence()` true). |
| `app.getCurrentProjectViewSelection()` | PPro **15.4+**. Returns the Project-panel selection. QuickKit uses it and fails with a readable message on older builds. |
| `projectItem.isSequence()` | True for sequences, multicam and merged clips. |
| `projectItem.getMediaPath()` | File path for atomic media; empty for synthetic items. |

Limits:

- No API to delete/merge bins safely beyond `deleteBin()` (which deletes
  contents — QuickKit never calls it).
- No reliable "media type" field on a project item; QuickKit classifies by
  file extension and `isSequence()`, and reports anything it cannot classify
  instead of guessing.
- Bulk rename has no transactional rename; QuickKit applies names one by one
  inside one undo group and reports per-item failures.

## 6. What QuickKit deliberately does not do

- No Creative Cloud Libraries (`importMGTFromLibrary`), no network calls.
- No project save. `app.project.save()` is never called by 6D.
- No QE DOM for keyframes or MOGRTs: the public DOM covers both, and QE is
  undocumented and version-fragile.
- No expressions, no custom bezier handles, no MOGRT font/style edits — the
  API has none of those.

## Version floor

| Feature | Minimum |
|---|---|
| `importMGT`, `getMGTComponent`, component keyframes | PPro 13.x (2019) |
| `app.getCurrentProjectViewSelection()` | PPro 15.4 (2021) |
| `track.isLocked()` (undocumented) | seen on 14.3+; feature-detected |
| Everything else | PPro 22.x (QuickKit's manifest floor) |

## Sources

- `ppro-scripting.docsforadobe.dev` — Sequence, TrackItem, Component,
  ComponentParam, Track, ProjectItem, Time, Changelog (fetched 2026-10-28).
- Adobe-CEP/Samples `PProPanel/jsx/PPRO/Premiere.jsx` — MOGRT import and
  keyframe usage.
- Adobe community answers: MOGRT text payload (2024), scale keyframes (2025),
  `setLocked`/`remove` undocumented methods (2020).
