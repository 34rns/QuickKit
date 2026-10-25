# QuickKit

A free, local-only panel for **Adobe After Effects** and **Adobe Premiere Pro**
on Windows 10 and 11. One extension, seven tools, no account, no cloud, no
tracking.

Version **0.3.0** — Part 3: text animations join the live After Effects tools
(anchor, text, layers, easing), plus the Part 1 shell, host test and installer.

---

## What works in this version

- One CEP extension loads in **both** apps from a single manifest.
- Seven tabs: Anchor, Presets, Text, Easing, Layers, Silence, Bridge.
- Tabs that do not apply to the app you are in say **"Available in Premiere
  Pro"** or **"Available in After Effects"** instead of disappearing.
- **Test host connection** asks the app for its name and version and shows the
  answer. This is the proof the panel talks to the application.
- A welcome screen on first run, and a help button to bring it back.
- A status bar with the last action and an Undo slot (disabled until there is
  something to undo).
- Works from a 240px to 600px wide panel.

The Anchor, Text, Layers and Easing tabs are live in After Effects. Presets and
Bridge are still shells, and the Premiere-only Silence tab stays locked until
its tool exists. Every tool press is **one undo group**: press Ctrl+Z once in
After Effects to reverse the whole action.

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
Six presets for titles and lower thirds, with duration, delay, easing and
independent **Animate in** / **Animate out** edges placed at the layer's in and
out points.
- **Fade, slide, scale pop** write normal keyframes on the layer's own opacity,
  position or scale. Slide has a direction and distance; pop starts at 80% of
  the current scale. They refuse to overwrite an existing keyframe or an
  expression on that property.
- **Typewriter, character stagger, blur reveal** add a named, editable text
  animator (`QuickKit Typewriter`, `QuickKit Character Stagger`, `QuickKit Blur
  Reveal`) and key its Range Selector **Start** percentage. The Source Text is
  never changed, so the words stay editable and the tracking does not reflow.
- Pressing the same preset twice replaces its animator instead of stacking a
  second copy. Other animators on the layer are left alone.
- The Text tab shows a live preview of the selected preset. It is panel-side
  only and never calls the app.
- Text animations are After Effects-only; Premiere shows the tab as
  **Available in After Effects**.

---

## Requirements

- Windows 10 or 11. Built and checked on Windows 11.
- After Effects **22.0 or newer**, or Premiere Pro **22.0 or newer**.
  Built against After Effects 26.5 and Premiere Pro 26.0.2.
- No admin rights. Everything installs for your Windows user only.

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
That is by design. Anchor, Text, Easing and Layers use After Effects features;
Presets needs AE presets, and Silence works on Premiere sequences. The tab
stays visible so the panel looks the same in both apps.

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
  scripts/          install.bat, uninstall.bat
  docs/             licenses, manual test checklists
  tests/            check-static.js, host-logic.test.js
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
  js\panel.js, js\csinterface-lite.js
  design\tokens.css, design\fonts\, design\icons\
  host\quickkit.jsx
```

---

## For development

- No bundler, no build step, no npm install. Plain HTML/CSS/JS plus
  ExtendScript.
- Static checks: `node tests/check-static.js` (no dependencies).
- Chrome/CEF in CEP 12 is Chromium 99, so avoid newer CSS
  (`color-mix`, `:has`, container queries).- Manual test plans: `docs/manual-test-checklist-part1.md`, `docs/manual-test-checklist-part2.md`, `docs/manual-test-checklist-part3.md`.

---

## License

[MIT](LICENSE) © 34rns. Bundled Inter is under the SIL Open Font License 1.1 —
see `docs/ASSET_LICENSES.md`.
