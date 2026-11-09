# QuickKit

A free, local-only panel for **Adobe After Effects** and **Adobe Premiere Pro**
on Windows 10 and 11. One extension, eight tools, no account, no cloud, no
tracking.

Version **0.10.0** — Part 6D: the **Premiere side of the library** — insert a
MOGRT at the playhead on a chosen video track and edit its text and exposed
controls from the panel, apply 18 **keyframe recipes** (fade, slide in all four
directions, scale pop, zoom, shake, spin, flicker) to selected clips or the clip
under the playhead, and an optional **Bin organizer**. It joins Part 6C's text
presets and MOGRT export, Part 6B's preview pane, Part 6A's shared library, the
live After Effects tools (anchor, layers, easing, presets), the Premiere silence
cutter, the Bridge, and the Part 1 shell and installer.

---

## What works in this version

- One CEP extension loads in **both** apps from a single manifest.
- Eight tabs: Anchor, Presets, Library, Text, Easing, Layers, Silence, Bridge.
- Tabs that do not apply to the app you are in say **"Available in Premiere
  Pro"** or **"Available in After Effects"** instead of disappearing.
- A **Presets** library with folders, search, favourites, drag reordering,
  pack import/export and 15 original starters — all stored on your PC.
- A **Library** shared by both apps: presets, MOGRTs and Premiere recipes in
  nested folders, with smart collections, instant search, filters, grid/list
  views, `.qkpack` export/import and a Repair button. Part 4 presets are
  imported automatically the first time it opens.
- A **preview pane** pinned above the library grid: click to select and play,
  arrow keys to browse, Space for play/pause, Enter for the item menu,
  double-click or Apply to use the item. Cards stay cheap; only the selected
  item's clip is ever loaded.
- A **Text** tab with **54 original presets** in 12 categories. Every preset is
  a data definition compiled into real keyframes or a named text animator, so
  the result stays editable; the parameter panel re-applies live to the selected
  layers, and **Export MOGRT** (one or all 54, with Cancel) writes Premiere-ready
  templates into the Library.
- A **Silence cutter** for Premiere Pro: FFmpeg finds the gaps in the sequence
  audio, you check them on a waveform, then cut them out in one undo step.
- A **Bridge** between the two apps: send selected Premiere clips to After
  Effects as a handoff file, get a matching composition, render it with
  `aerender`, and place the render back at the original timeline position.
- **Test host connection** asks the app for its name and version and shows the
  answer. This is the proof the panel talks to the application.
- A welcome screen on first run, and a help button to bring it back.
- A status bar with the last action and an Undo slot (disabled until there is
  something to undo).
- Works from a 240px to 600px wide panel.

The Anchor, Presets, Text, Layers and Easing tabs are live in After Effects,
the Silence tab is live in Premiere Pro, and the Bridge tab works in both.
Every tool press is **one undo group**: press Ctrl+Z once to reverse the whole
action.

---

## After Effects tools

### Anchor
- A 3x3 grid. Click a cell to move the anchor point there; the layer does not
  shift on screen, even with scale, rotation or a parent.
- Works on all selected layers at once, including text and shape layers.
- **Center of selected layers** puts every selected layer's anchor at the
  middle of the group's combined bounds (handy for rotating a group around its
  centre).
- Layers without visible bounds (nulls, cameras, lights, adjustment layers) are
  skipped for the grid and named in the message. 3D layers: only X and Y are
  compensated, Z is left alone.

### Layers
- **Bulk rename:** prefix, suffix, find/replace, optional numbering (start,
  digits, `{n}` token in prefix or suffix).
- **Stagger start times:** in frames or seconds; the earliest layer stays put.
- **Null and parent:** adds "QuickKit Null" at the selection centre and parents
  the selected layers to it without moving them.
- **Sequence layers:** lays the selection out end to start in timeline order.
- **Precompose:** selected layers into a new comp (default name
  "QuickKit Precomp"), transforms preserved.

### Easing
- Easy ease, strong, overshoot and bounce, applied to the **selected keyframes**
  with a live curve preview.
- Easy/strong set bezier temporal ease (33.33 / 85 influence).
- Overshoot and bounce add extra keyframes after the selected one (2 and 4).
  They need a previous keyframe, a numeric property, no expression, and room
  before the next keyframe or the end of the composition. Otherwise the
  keyframe is skipped and the message says why.

### Text
**54 original text presets** in 12 categories — Fade, Slide, Scale/Pop,
Typewriter, Per-character, Per-word, Blur/Reveal, Rotate/Flip, Glitch,
Wave/Bounce, Loop/Idle and Out animations — built from data, not scripts.
- Each preset declares whether it animates **in**, **out** or both, and which
  parameters it exposes: **duration, delay, direction, easing, stagger,
  overshoot and distance**. The panel shows only those controls for the chosen
  preset, with sensible defaults.
- **Apply** writes to every selected text layer in one undo group, aligned to
  each layer's own in/out points. Press Apply once, then drag a slider: the
  selected layers update **live** until you change the selection or switch
  preset.
- Results stay editable. Fade/slide/scale/rotate presets write normal keyframes
  on the layer's own transform; Typewriter, per-character, per-word, blur and
  wave presets add a named text animator (`QuickKit Character Rise`,
  `QuickKit Word Slide`, …) with keyed Range Selectors, so the Source Text is
  never replaced.
- Offsets are relative to the layer's own values and per-character distances are
  in em, so presets work on multi-line text, any font size, any anchor and any
  justification, and with several layers at once.
- Re-applying replaces QuickKit's own keys and animators (the layer comment
  records which preset); a layer you keyed by hand is reported as skipped, never
  overwritten.
- The stage preview under the grid approximates each preset in the panel and
  never calls the app.
- **Export MOGRT** builds a 1920×1080 comp with the preset applied and the text
  and retiming controls exposed in Essential Graphics, then writes a `.mogrt`
  into the Library as a **MOGRT** item. **Export all 54** does the whole
  catalogue with progress and Cancel. Premiere itself cannot export a MOGRT, so
  the buttons are After Effects-only.
- The 54 presets are also seeded into the Library as `.qktextpreset` items, so
  they get previews and can be applied from there.
- Text animations are After Effects-only; Premiere shows the tab as
  **Available in After Effects**.

### Presets
Save a look once and apply it to any layer later. Everything lives in
`%APPDATA%\QuickKit\presets` on your PC.
- **Save** uses the selected layers, or only the selected property rows when
  you have picked some. A layer preset captures transform values, text style
  (font, size, tracking, leading, fill colour, stroke), effect parameters,
  static values and keyframes with their easing. Text content is never stored.
- **Apply** writes the saved properties to the selected layers inside one undo
group. A preset captured from one layer works on every selected layer; a
multi-layer preset maps layer by layer.
- **Folders, search and favourites.** Folders are labels, not disk folders, so
a preset can be organised without moving files. Search ignores case;
favourites filter with one click.
- **Rename, delete and drag to reorder.** All view only; drag is disabled while
a search or folder filter is active.
- **Import / export a pack** (`.qkpack`) as one file. Import merges with new ids
and renames duplicates instead of overwriting anything.
- **15 starter presets** across Titles, Styles and Motion, created for QuickKit.
They are seeded on first run; delete them all to see the empty state.
- A damaged preset file is skipped with a note under the list; the panel keeps
working and never crashes on it.

---

## Library (both apps)

One library shared by After Effects and Premiere Pro, opened from the
**Library** tab. Everything is a plain folder on your disk —
`%APPDATA%\QuickKit\library` — with `library.json` as the index and one folder
per item holding `item.json`, the asset and any previews.

- **Item types:** After Effects presets (`.ffx` or a QuickKit recipe), MOGRTs,
  Premiere recipes and packs. Each item records its name, type, category, tags,
  favourite, which app(s) it works in, when it was added, how often and when it
  was last used, author, licence and notes.
- **First run migrates your Part 4 presets.** They keep their ids, so the
  Presets tab keeps working. The old `%APPDATA%\QuickKit\presets` store is left
  exactly as it was; a damaged preset file is skipped and reported.
- **Nested folders.** Create, rename, move and delete; drag items or folders
  onto a folder. Deleting a folder never deletes items — they move up one level.
- **Smart collections:** All items, Favorites, Recently used, Most used,
  Untagged, Text, Transitions, Shapes, each with a live count.
- **Search and filters.** Search covers name, tags, category, notes, author and
  type; filter by type, app and category; sort by name, date or usage.
- **Grid or list view**, with a thumbnail size slider that is remembered.
- **Multi-select, context menu and shortcuts:** click / Ctrl+click /
  Shift+click, right-click for the item or folder menu, `Delete` to remove,
  `F2` to rename, `Enter` for details, `Ctrl+F` for search.
- **Dimmed items.** Items that do not work in the app you are in are dimmed with
  a tooltip; they stay in the library for the other app.
- **Share with `.qkpack`.** Export the selection or the folder you are in to one
  zip file (manifest + assets) and import it elsewhere with **skip**, **replace**
  or **keep both**. No dependency and no network: the zip is written by QuickKit
  itself and any zip tool can open it.
- **Nothing fatal.** A corrupt `library.json` is rebuilt from the item folders
  on load; a missing asset is a badge on the card, not a crash. **Repair
  library** rebuilds the index on demand and never deletes an item.
- **Previews.** Clicking a card selects it and plays its preview in the pinned
  pane above the grid. Cards keep static thumbnails; only the selected item's
  clip is loaded, and it is released when you select something else. The pane
  has play/pause, loop, 0.5x / 1x / 2x speed and a scrub bar, and its height and
  collapsed state are remembered. **Preview mode** (gear menu) is **Click** by
  default, with an optional **Hover** mode that previews without changing the
  selection.
- **Rendered previews in After Effects.** For `.ffx` and `.qkpreset` items,
  **Generate this preview** or **Generate missing previews (N)** renders a 2.5 s
  clip inside After Effects (a throwaway comp through the Render Queue),
  converts it with the bundled FFmpeg to a ≤480 px silent `.mp4` plus a `.webp`
  thumbnail, and stores both next to the item. Your project is not saved or
  changed, and other Render Queue items are restored afterwards. Cancel stops
  between items, because the panel is blocked while one render runs.
- **Never a blank card.** Anything without a clip — MOGRTs, Premiere recipes,
  items with no preview yet — plays a live canvas approximation of the preset
  (fade, slide, scale, wipe, type-on, blur, rotate) driven by its own
  parameters. Changing a parameter makes a real clip out of date: the pane says
  so and offers **Regenerate preview**. A param change never deletes the old
  file by itself, and **Clear preview cache…** removes only the preview files.

Applying an item works in **After Effects**: press **Apply**, double-click a
card, or use the item menu. In **Premiere Pro** the same button applies a
**recipe** or inserts a **MOGRT** (see below); After Effects presets stay dimmed
and wait for After Effects.

---

## Premiere Pro tools

### Silence

Find the silent gaps in a sequence and cut them out, with a preview before
anything changes.

- **Scan** the whole sequence or only the clips you selected. Every audio track
  is read; a gap is only offered when **every track that has sound there is
  quiet**, so a music bed or room tone cannot be cut by accident.
- **Controls:** threshold in dB, minimum silence length, padding before and
  after each cut, and *Cut through short breaths* (merges a pause and the breath
  inside it into one cut).
- **Preview first.** The panel draws a waveform of the sequence audio, shades
  each detected gap over it, and lists every gap with its time and length. Click
  a row to switch that gap off, and it is left alone. Coloured sequence markers
  are added for the same gaps so you can see them in the Timeline.
- **Apply** as **Delete and ripple**, **Only mark**, or **Mute in place**, as
  one undo group. Delete razors both edges on the audio and linked video tracks
  and ripples once per gap; mute keeps the sequence length and silences the cut
  pieces (Premiere's scripting cannot move clips to another track).
- **Long files** run out of process with a progress bar and a working **Cancel**
  button, so the panel never freezes. A clip with no audio, or one whose media
  is offline, is named and skipped instead of stopping the scan.
- Paths with spaces, `#`, `&` and non-English characters work: FFmpeg is started
  from an argument array, never through a shell.

**FFmpeg.** The audio analysis is done by FFmpeg, a separate command-line
program that QuickKit starts and reads text from. It is not part of QuickKit and
is under its own licence: see `bin/ffmpeg/NOTICE.txt`. QuickKit never downloads
anything — the binary is placed in `bin\ffmpeg` on the machine that builds the
extension (`scripts\fetch-ffmpeg.ps1`), and the panel also accepts an FFmpeg
already on PATH or one you pick yourself. If none is found the tab says which
places it looked in.

---

## Premiere library: recipes, MOGRTs and bins

Everything here lives in the **Library** tab and reads the same folder as After
Effects, so favourites, recents and folders stay in sync. Items for the other
app are dimmed rather than hidden.

### Keyframe recipes

Select a recipe (Fade, Slide, Scale or Motion) and press **Apply recipe**. The
panel writes real Motion/Opacity keyframes as **one undo step**:

- **Fade** — in, out, or both, on Opacity.
- **Slide** — in or out from the left, right, top or bottom, on Position.
- **Scale** — pop in/out, zoom in, zoom out, on Scale (plus Opacity for the
  pops).
- **Motion** — shake (seven settling Position keys), spin in (Rotation), and
  flicker in (Opacity).

**Duration**, **easing** (smooth, linear or hold), **amount** and, where the
recipe uses it, **direction** are controls in the preview pane. Positions are
fractions of the frame, so they hold at any sequence size; scale values are
multipliers of the clip's own scale, and rotation is a delta. A channel that
already has keyframes is **skipped with a reason** instead of being overwritten —
Premiere has no clip-comment marker to tag QuickKit's own keys, so Undo is the
way back.

### Targeting

**Target = Selected clips** applies to every selected video clip or graphic;
**Target = Clip under playhead** finds the clip at the CTI, searching down from
the chosen track. Nothing selected, only audio selected, no clip under the
playhead and locked tracks each produce a readable message and change nothing.

### MOGRT insert and text

Select a MOGRT item, choose a **video track** and press **Insert at playhead**.
QuickKit calls Premiere's `sequence.importMGT`, then lists the template's
exposed controls below the preview:

- **Text** — type in the box and press **Update text**. QuickKit writes the
  template's JSON payload (`textEditValue`, `fontTextRunLength`), so styling is
  preserved; a plain-string control is written directly.
- **Number** and **checkbox** controls are editable in place.
- Anything else is shown read-only, because Premiere's scripting has no setter
  for it.

Control names are whatever the template exposes (Premiere localises them), and
**Refresh** re-reads them from the clip. The MOGRT's duration and styling are
defined by the template, not by the panel.

### Bin organizer (optional)

Premiere only. **Create bins** makes Footage, Audio, Graphics and Exports;
**Sort selection** moves the Project-panel selection into the matching bin by
file extension and `isSequence()`; **Rename selection** does find-and-replace,
prefix/suffix or numbered names in one undo step. Bins are never deleted or
renamed in bulk. The selection comes from
`app.getCurrentProjectViewSelection()` (Premiere 15.4+); older builds get a
readable message.

API details and version floors: `docs/premiere-6d-api.md`. Real-app steps:
`docs/manual-test-checklist-part6d.md`.

---

## Bridge (Premiere Pro ⇄ After Effects)

**This is a file handoff, not Dynamic Link.** QuickKit cannot create a Dynamic
Link composition from a script, and it does not pretend to: nothing stays
linked, and editing a clip in Premiere after sending it does not update the
After Effects comp.

How it works, in two halves:

1. **Send to After Effects** (Premiere Pro side). Select clips on the timeline
   and press **Send**. QuickKit writes a small JSON handoff into
   `%APPDATA%\QuickKit\bridge\pending` with the sequence name, frame rate,
   width and height, and for each clip its **used in/out range**, source path,
   speed and timeline position. The panel lists every step it took and stops
   with a specific message if there is no sequence, no readable media, or an
   offline file.
2. **Import** (After Effects side). Open the Bridge tab in After Effects and
   press **Import** on the waiting handoff. QuickKit imports the footage once
   per file, creates a composition at the sequence's frame rate and size, and
   trims each layer to exactly the range Premiere was using (including speed).
   Comp time 0 is the earliest clip's timeline start. The original Premiere
   position is remembered for the return trip.
3. **Send back to Premiere** (After Effects side). Open the finished comp and
   press **Render and send back**. QuickKit applies an output template that
   exists on this machine, saves the project, renders with **`aerender`**, and
   writes a return file. Premiere imports the render and overwrites the clip at
   the original position. If Premiere is not running, the render waits in
   `returns` and the Premiere panel's **Place** button finishes the job.

**Why `aerender` and not the Render Queue.** `app.project.renderQueue.render()`
runs inside ExtendScript: while it runs, After Effects cannot answer the panel,
so the panel freezes, the progress bar cannot move and Cancel cannot work. It
can also open modal dialogs the panel cannot dismiss. `aerender` is a separate
process, so QuickKit reads real progress from its output, Cancel kills the
child, and the panel stays usable. The render queue is only a documented
fallback: if `aerender.exe` is missing, the comp is still queued with its
output configured, and the panel says to render it from the Render Queue by
hand.

**Limitations, in plain words.**
- Not Dynamic Link. The handoff and the render are ordinary files; moving or
  deleting `%APPDATA%\QuickKit\bridge` breaks the link between the two halves.
- One-way edits. Changes made to the Premiere clip after sending are not seen
  by After Effects, and changes in the comp are only seen after another render.
- The footage must be on disk. An offline clip is reported by name; it is not
  relinked automatically.
- Speed changes are applied as a layer stretch; time remapping, reverse speed
  and speed ramps are not carried over.
- Multi-clip handoffs come back as **one rendered file** placed at the first
  clip's start and video track. Anything else under it is overwritten.
- The After Effects project must be **saved at least once** before rendering,
  because `aerender` needs a file to open. The panel says so before it starts.
- Audio is not carried over: the comp is built from the video clips.

---

## Requirements

- Windows 10 or 11. Built and checked on Windows 11.
- After Effects **22.0 or newer**, or Premiere Pro **22.0 or newer**.
  Built against After Effects 26.5 and Premiere Pro 26.0.2.
- No admin rights. Everything installs for your Windows user only.
- The Silence tab needs an `ffmpeg.exe`. One is bundled by
  `scripts\fetch-ffmpeg.ps1` at build time; an FFmpeg already on PATH also
  works. The other tabs do not need it.
- The Bridge needs After Effects installed on the same machine as Premiere Pro.
  The After Effects project must be saved once before a render, and the AE half
  uses the `aerender.exe` that ships with After Effects.

---

## Download

Grab **[quickkit.zip](https://github.com/34rns/QuickKit/releases/latest/download/quickkit.zip)** — the latest release. That link never changes, so you can bookmark it; it always resolves to the newest version.

Then extract it anywhere and follow the three install steps below.

---

## Install (three steps)

1. Open the QuickKit folder you downloaded, then open the `scripts` folder.
2. Double-click **`install.bat`**.
   A console window lists what it is doing and ends with
   `SUCCESS - QuickKit is installed.` If it ends with `FAILED`, read the last
   lines — they name the folder or file that blocked it.
3. **Close After Effects and Premiere Pro completely**, then open the app
   again. (Panels are only scanned at startup; a restart is required.)

Then open the panel:

- **After Effects:** `Window > Extensions > QuickKit`
- **Premiere Pro:** `Window > Extensions > QuickKit`

On first open, a welcome dialog repeats these three steps. Press **Got it**.
The `?` button in the panel's top-right corner opens it again.

---

## What install.bat changes on your PC

Only two things, both for your user account:

1. Copies the extension to
   `%APPDATA%\Adobe\CEP\extensions\QuickKit`
   (that is `C:\Users\<you>\AppData\Roaming\Adobe\CEP\extensions\QuickKit`).
2. Sets the registry value `PlayerDebugMode` to `1` under
   `HKCU\Software\Adobe\CSXS.9`, `CSXS.10`, `CSXS.11`, `CSXS.12`
   (and `CSXS.13` if that key already exists).

Why the registry value: CEP panels from outside the Adobe Marketplace are
unsigned, and Adobe only loads unsigned panels when that flag is on. If the
panel still refuses to load, see Troubleshooting.

Install.bat does **not** install services, scheduled tasks, certificates or
anything in `Program Files`, and it never needs administrator rights.

---

## Uninstall

1. Close After Effects and Premiere Pro.
2. Double-click **`scripts\uninstall.bat`**.

It deletes `%APPDATA%\Adobe\CEP\extensions\QuickKit` and leaves the
`PlayerDebugMode` registry values in place on purpose, because other unsigned
development panels on your machine may depend on them. The script prints the
exact `reg delete` command if you want to remove them yourself.

---

## Troubleshooting

### QuickKit is not listed under Window > Extensions
- **Did you restart the app?** Panels are enumerated at launch. Quit fully
  (including the tray/background process) and reopen.
- **Does the folder exist?** Run `install.bat` again and read its output.
  Check `%APPDATA%\Adobe\CEP\extensions\QuickKit\CSXS\manifest.xml` exists.
- **Is PlayerDebugMode set?** Open `regedit` and look at
  `HKEY_CURRENT_USER\Software\Adobe\CSXS.12` → `PlayerDebugMode` should be the
  string `1`. Re-run `install.bat` to set it again.
- **Did the app update?** A new major app version can change the CEP version.
  Run `install.bat` again after updates; it covers CSXS 9–13.
- **Version gate:** the manifest accepts app versions 22.0 through 99.9. If you
  run an older build than 22.0, the panel will not load.

### The panel opens but is blank or white
- Check the CEP log: `%TEMP%\CEP12-AEFT.log` or `%TEMP%\CEP12-PPRO.log`
  (paste `%TEMP%` into the Explorer address bar).
- Also look for `CEPHtmlEngine12-AEFT-*.log` / `CEPHtmlEngine12-PPRO-*.log` in
  the same folder; those contain JavaScript errors from the panel.
- Raise the log level: in `regedit`, under
  `HKEY_CURRENT_USER\Software\Adobe\CSXS.12`, create a **String** value
  `LogLevel` with data `6`, restart the app, reproduce, then read the log.
  (0 = off … 6 = everything.)
- Re-run `install.bat`: a partial copy is the usual cause of a blank panel.

### "Available in Premiere Pro" or "Available in After Effects"
That is by design. Anchor, Presets, Text, Easing and Layers use After Effects
features; Silence working on Premiere sequences is the other way round. The tab
stays visible so the panel looks the same in both apps.

### The Silence tab says ffmpeg is missing
QuickKit looked in the extension folder, `%APPDATA%\QuickKit`, `QK_FFMPEG` and
PATH. Fix it with any one of these:
- Reinstall with `scripts\install.bat` after running
  `scripts\fetch-ffmpeg.ps1` (puts the binary in the extension folder).
- Install FFmpeg for Windows (for example `winget install Gyan.FFmpeg`) and
  reopen the panel.
- Put an `ffmpeg.exe` path in `%APPDATA%\QuickKit\settings.json` as
  `"ffmpegPath": "C:\\path\\to\\ffmpeg.exe"`.

`bin/ffmpeg/README.txt` has the same three options with the exact commands.

### A tool says it cannot reach the app
- The panel is open in a browser, not inside After Effects. Open it from
  `Window > Extensions`.
- If the message says the QuickKit script could not run, reinstall with
  `scripts\install.bat` and reopen the panel.

### A text animation says a property is not available
- Typewriter, stagger and blur need a **text layer**. Fade, slide and pop work
  on any layer.
- If the message says `text blur is not available`, your AE build does not
  expose the blur animator property; the helper fails cleanly and leaves the
  layer untouched.

### A tool skipped some layers or keyframes
That is deliberate and the message names them: locked layers are never touched,
layers without bounds cannot take a grid anchor, and overshoot/bounce skip
keyframes without a previous key, without room after them, with expressions, or
on non-numeric properties (text, masks, colours are skipped).

### The test button says it cannot reach the app
- The panel runs inside the app only when opened from `Window > Extensions`.
  Opened in a normal browser it shows a preview state instead.
- If `host\quickkit.jsx` is missing from the installed folder, ExtendScript
  cannot run; re-run `install.bat`.
- If **every** button says it cannot reach the app and After Effects shows
  `Unable to execute script at line … Illegal use of reserved word`, the
  installed host file is from an old build that does not parse. Re-run
  `scripts\install.bat`, close After Effects completely and reopen it.

### The welcome screen comes back every time
Panel storage is blocked. Everything else still works; use **Got it** each
session or the `?` button.

### Where are the logs?
- CEP host logs: `%TEMP%\CEP12-AEFT.log`, `%TEMP%\CEP12-PPRO.log`
- Panel/CEF logs: `%TEMP%\CEPHtmlEngine12-<HOST>-<version>-<extension-id>*.log`

---

## Updating

QuickKit does not auto-update. To move to a new version, download
[`quickkit.zip`](https://github.com/34rns/QuickKit/releases/latest/download/quickkit.zip)
again, extract it over the old folder, and double-click `scripts\install.bat`.
Then restart After Effects and Premiere Pro completely — panels are only scanned
at startup. How to cut a release: [docs/releasing.md](docs/releasing.md).

---

## Privacy

Everything runs on your machine. The panel makes no network requests, has no
analytics, no crash reporting, no update check and no remote fonts or icons —
Inter is bundled in `design/fonts`. `tests/check-static.js` fails the build if
an `http://` or `https://` reference appears in shipped files.

---

## Folder layout

```
QuickKit/
  extension/        CEP files: manifest, panel HTML/CSS/JS
  host/             ExtendScript (quickkit.jsx)
  design/           tokens.css, DESIGN_SYSTEM.md, Inter, icons
  bin/ffmpeg/       bundled ffmpeg.exe slot + NOTICE.txt (binary not in git)
  scripts/          install.bat, uninstall.bat, fetch-ffmpeg.ps1
  docs/             licenses, manual test checklists, preset format
  tests/            check-static.js, host-logic.test.js, ffmpeg.test.js
  PROJECT_RULES.md  permanent project rules
  PROGRESS.md       living status
```

`install.bat` assembles the installed extension from these folders, so
`design/` and `host/` stay the single source of truth. The installed layout is:

```
%APPDATA%\Adobe\CEP\extensions\QuickKit\
  CSXS\manifest.xml
  index.html
  css\panel.css
  js\panel.js, js\csinterface-lite.js, js\library-core.js, js\library-io.js,
    js\preview-core.js, js\preview-node.js, js\text-presets.js,
    js\ffmpeg-node.js, js\render-node.js
  design\tokens.css, design\fonts\, design\icons\
  host\quickkit.jsx
  bin\ffmpeg\ffmpeg.exe, bin\ffmpeg\NOTICE.txt
```

Your own data never goes in the extension folder:

```
%APPDATA%\QuickKit\
  library\          library.json, folders.json, items\<id>\item.json + assets
  presets\          the Part 4 preset store (still read and written by the
                    Presets tab; untouched by the library migration)
  bridge\           handoff files, renders and returns for the Bridge tab
```

---

## For development

- No bundler, no build step, no npm install. Plain HTML/CSS/JS plus
  ExtendScript.
- Static checks: `node tests/check-static.js` (no dependencies).
- Host logic tests: `node tests/host-logic.test.js` (mock After Effects and a
  mock Premiere world; not the real apps).
- FFmpeg tests: `node tests/ffmpeg.test.js` (runs the real binary when one is
  present and skips the real-run checks when it is not).
- Bridge render tests: `node tests/render.test.js` (uses the real `aerender.exe`
  when After Effects is installed; the success path is still manual).
- Library tests: `node tests/library.test.js` (real temp folders: schema files,
  Part 4 migration, folders, corrupt-index repair, packs, conflict modes).
- Preview tests: `node tests/preview.test.js` (clock, easing, approximation,
  param clamping, signatures, preview files on disk, ffmpeg argument builders
  and a real encode when `bin/ffmpeg` exists).
- Text preset tests: `node tests/text-presets.test.js` (the 54-preset catalogue,
  plan compiler purity and clamps, direction/overshoot/stagger, em offsets, the
  MOGRT API calls in the host, and the panel wiring).
- Browser preview: `node tests/refresh-preview.js` then open
  `tests/.preview/index.html` (append `?host=PPRO` for the Premiere side; `?many=500`,
  `?slow=1`, `?empty=1` exercise the large library, cancel and empty states) — a
  fake CEP harness, not shipped.
- Chrome/CEF in CEP 12 is Chromium 99, so avoid newer CSS
  (`color-mix`, `:has`, container queries).
- `host/quickkit.jsx` runs as ExtendScript, which is ES3: no `const`, `let`,
  arrows, template strings, trailing commas, or reserved words as object keys.
  `tests/check-static.js` rejects those and reports the line.
- Manual test plans: `docs/manual-test-checklist-part1.md`,
  `docs/manual-test-checklist-part2.md`,
  `docs/manual-test-checklist-part3.md`,
  `docs/manual-test-checklist-part4.md`,
  `docs/manual-test-checklist-part5.md`,
  `docs/manual-test-checklist-part6.md`,
  `docs/manual-test-checklist-part6a.md`,
  `docs/manual-test-checklist-part6b.md`,
  `docs/manual-test-checklist-part6c.md`.
- MOGRT export: the exact API, what can be exposed and where Adobe stops you
  are written down in `docs/mogrt-export-api.md`.

---

## License

[MIT](LICENSE) © 34rns. Bundled Inter is under the SIL Open Font License 1.1 —
see `docs/ASSET_LICENSES.md`. The bundled FFmpeg build is a separate program
under its own licence (GPL or LGPL, depending on the build) — see
`bin/ffmpeg/NOTICE.txt`.
