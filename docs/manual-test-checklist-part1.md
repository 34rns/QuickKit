# Part 1 — Manual test checklist

Only these steps prove the panel inside the real apps. Everything below that
needs Adobe has not been run by the build; the static checks and the browser
preview are the only automated evidence.

Environment used for the build: Windows 11, After Effects 26.5, Premiere Pro
26.0.2, CEP 12.

## 1. Install
1. Open `QuickKit\scripts`.
2. Double-click `install.bat`.
3. Expected: `[OK] PlayerDebugMode=1 on CSXS.9` … `CSXS.12`, a list of detected
   Adobe apps, then `SUCCESS - QuickKit is installed.`
4. Check `%APPDATA%\Adobe\CEP\extensions\QuickKit\` contains `index.html`,
   `CSXS\manifest.xml`, `design\tokens.css`, `host\quickkit.jsx`.
5. If the window closes too fast to read, run it from a terminal:
   `cmd /k scripts\install.bat`.

## 2. Open in After Effects 26.5
1. Close AE completely, reopen it.
2. `Window > Extensions > QuickKit`.
3. Expected: the panel docks and shows the welcome dialog with three steps.
   "Got it" closes it; the help icon (top right) reopens it.
4. Expected: host card reads "After Effects 26.5" with the chip "Host detected".

## 3. Host test in After Effects
1. Press **Test host connection**.
2. Expected: chip "Connected", value `After Effects 26.5`, detail mentions
   ExtendScript and the open project name if one is open.
3. Expected: status bar (bottom) reads `Checked host: After Effects 26.5`;
   Undo is greyed out with a tooltip.

## 4. Tabs in After Effects
1. Anchor, Presets, Text, Easing, Layers, Bridge show their empty states.
2. Silence shows **Available in Premiere Pro** and says you are in After Effects.
3. Click every tab; no blank panel, no error text.
4. Keyboard: focus a tab, press Left/Right/Home/End; selection follows focus.

## 5. Resize
1. Drag the panel narrower to about 240px: tabs scroll horizontally, the host
   button goes full width, nothing is cut off, status bar stays at the bottom.
2. Drag to about 600px: content stays centred, no stretched controls.
3. Restart the app: the welcome dialog stays dismissed.

## 6. Open in Premiere Pro 26.0.2
1. Close Premiere, reopen it, `Window > Extensions > QuickKit`.
2. Expected: host card reads `Premiere Pro 26.0.2`.
3. Press **Test host connection**; expected value `Premiere Pro 26.0.2` and a
   status line `Checked host: Premiere Pro 26.0.2`.
4. Anchor and Presets show **Available in After Effects**; Silence is active;
   the other tabs work.
5. Repeat the resize check.

## 7. Uninstall
1. Close both apps.
2. Double-click `scripts\uninstall.bat`.
3. Expected: `SUCCESS - the QuickKit panel was removed.` and a note that the
   `CSXS.*` registry values were left on purpose.
4. Reopen AE: QuickKit is gone from `Window > Extensions`.
5. Re-run `install.bat` to put it back.

## Known limits of this build
- Tabs are shells: no tool logic yet (by design, Part 1 is scaffold only).
- Undo is intentionally disabled; nothing is undoable yet.
- Host version strings come from `app.version` inside the app; if a build
  returns an empty string the panel shows "version not reported" instead of
  guessing.
- If the installer reports a registry warning, the panel may not load; see
  README troubleshooting.
