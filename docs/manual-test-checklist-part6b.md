# QuickKit — Part 6B manual checklist (Select and preview)

Version **0.8.0**. Run this with **After Effects 26.5** and **Premiere Pro
26.0.2** on the same Windows machine, both installed normally. Each numbered
line says what to do and what should happen. Stop at the first failure and send
the number, the expected result, and what you saw instead.

What was already checked without the apps:

- `node tests/preview.test.js` — 23 tests, all real:
  - clock (`m:ss.t`), speed cycling, clamping, all four easing curves (bounce
    is allowed to travel back between impacts);
  - the approximation classifier (wipe / rotate / blur / type / scale / slide /
    fade, packs have none) and the sampled pose at each progress;
  - param defaults, clamping and dropped unknown keys; the preview signature
    follows params / asset / bytes and ignores renames;
  - `ready` / `stale` / `none`, and a param change leaving the preview stale;
  - saving and clearing `preview.mp4` + `thumb.webp` in a real temp folder,
    "recorded but gone" reported without failing, targeted clears;
  - the ffmpeg argument builders, and a **real encode** of 24 PNG frames into a
    480 px mp4 + webp (skipped with `SKIP` when `bin/ffmpeg` is absent).
- `node tests/check-static.js` — preview files parse, `preview-core.js` is the
  only page script (`preview-node.js` / `library-io.js` stay Node-only), the
  pane and its ids exist above the grid, `qkLibraryApply` and
  `qkPreviewGenerate` exist, generation uses `queue.render()` and never
  `aerender`, and the play/pause icons and preview tokens exist.
- Browser harness (`tests/refresh-preview.js`, `127.0.0.1:8137`): empty state,
  click to select with the video autoplaying, stale preview falling back to the
  canvas + *Regenerate preview*, the canvas changing per scrub position, clock
  and scrub tracking, speed 1x → 2x → 0.5x → 1x, loop, Space, arrow keys, Hover
  mode previewing without changing the selection, params going stale and
  persisting, Apply and double-click sending `qkLibraryApply` with the right
  path, *Generate missing* running the whole list, Cancel stopping after one
  item, the Premiere read-only state, collapse/resize persisting, the clear-cache
  dialog, and a 500-item library (400 cards rendered in 23 ms, every thumbnail
  still lazy, exactly one `<video>` in the page). **No console errors** except
  the deliberate `file://` thumbnail test.

## Why the Render Queue and not aerender

Generation renders the **open project**, so it uses the Render Queue. aerender
only renders a saved `.aep`; using it would mean saving (or Save-As-ing) your
real project, and QuickKit does not touch your project file for a preview. The
queue item is added for a throwaway comp, every other queue item is temporarily
disabled and restored in a `finally`, and the comp is deleted when the call
ends. The cost: the panel is blocked while one preview renders, so **Cancel
takes effect between items, not inside one**.

**Still UNTESTED, because it needs the real apps:**

- `queue.render()` producing PNG frames from the throwaway comp, and the
  `"PNG Sequence"` output template name on a localized After Effects (the
  `.png` file extension is the fallback; `saveFrameToPng` is the last resort).
- `layer.applyPreset` / `.ffx` application inside that temp comp.
- `file://` **video** playback in the CEP Chromium 99 runtime. If it fails the
  pane falls back to the canvas approximation, so this must be checked by eye.
- 20 real renders in one batch (time taken, memory) and a cancel during them.
- Native dialogs and the real mouse / keyboard in both apps.
- Migration of **your** real presets and their first previews.

Nothing here talks to the internet. Previews live on your disk next to the
items: `%APPDATA%\QuickKit\library\items\<id>\preview.mp4` and `thumb.webp`.

---

## A. Before you start

1. Close both apps, run `scripts\install.bat`, then reopen them.
   **Expected:** `SUCCESS - QuickKit is installed.` and the header shows
   **v0.8.0**.
2. In After Effects, open `Window > Extensions > QuickKit` > **Library**.
   **Expected:** the preview pane is pinned **above** the item grid with a stage
   placeholder and *Click an item to preview it here. Arrow keys move the
   selection.* The grid is below it and still scrolls normally.

## B. Click to select and preview

3. Click one preset card once.
   **Expected:** the card gets a ring and the pane shows its name, type badge,
   app support, tags, **Apply** and the star. The preview starts **by itself** —
   no second click, no hover needed. Moving the mouse over other cards changes
   nothing in the pane.
4. Click a different card.
   **Expected:** the pane switches immediately; the previous clip stops and is
   released (only one preview plays at a time).
5. Click the same card again.
   **Expected:** nothing breaks; the preview restarts or keeps playing.
6. Hover a card and count: the tooltip must still appear, but the **pane must
   not change** while the mode is Click.

## C. Keyboard and apply

7. With a card focused, press the arrow keys.
   **Expected:** selection, ring, focus and the pane move together one card at a
   time; the preview for each new selection starts on its own.
8. Press **Space** on the grid.
   **Expected:** play/pause toggles in the pane (the button icon flips) and the
   page does not scroll.
9. Press **Enter**.
   **Expected:** the item menu opens (details / apply / favorite). Press
   **Escape** to close it.
10. **Double-click** a card.
    **Expected:** it applies to the selected layers in After Effects with the
    usual message. One Ctrl+Z undoes it.
11. Press **Apply** in the pane on the same item.
    **Expected:** identical result. On an `.ffx` item it applies the effect
    preset; on a MOGRT in After Effects it applies the same way the old button
    did.

## D. Transport and parameters

12. Press pause, then play; press the speed button three times.
    **Expected:** 1x → 2x → 0.5x → 1x, and the actual playback speed follows.
13. Toggle **loop** off and let a clip reach the end.
    **Expected:** it stops at the last frame, the clock stops, and the button
    shows play.
14. Drag the scrub bar while paused.
    **Expected:** the picture follows the playhead frame by frame and the clock
    reads `m:ss.t` (for example `0:01.2`, never `1:02`).
15. Open the pane's gear menu.
    **Expected:** **Click (default)** ticked, **Hover**, *Generate missing
    previews (N)*, *Generate this preview*, *Clear preview cache…*.
16. Change **Duration** on a rendered preview.
    **Expected:** the pane switches to the **approximation** canvas with the note
    *Showing an approximation, not the rendered preset.* and the row
    **Regenerate preview**. The param value is still there after switching tabs
    and back, and after reopening the panel.
17. Set the duration back and generate that preview again (see F).
    **Expected:** the note and the regenerate row disappear and the real clip
    plays.

## E. Hover mode

18. Gear menu > **Hover**.
    **Expected:** the pane header says *Hover to preview* and moving the mouse
    across cards previews them **without** changing the selection ring.
19. Click a card in Hover mode, then move away.
    **Expected:** the click still selects and applies-focus as usual; the pane
    follows the selection again once the mouse leaves the cards.
20. Switch back to **Click (default)** and reload the panel.
    **Expected:** the choice was remembered.

## F. Generating previews (After Effects only)

21. Gear menu > **Generate this preview** on an `.ffx`/`.qkpreset` item with no
    preview.
    **Expected:** the busy row appears (*Rendering frames in After Effects…*),
    the panel is unresponsive while it works, and afterwards the card shows a
    thumbnail, the pane plays a **2–4 s, ≤480 px wide, silent looping clip**, and
    `%APPDATA%\QuickKit\library\items\<id>\` now contains `preview.mp4` and
    `thumb.webp`.
22. **Check the project is untouched:** the temp comp is gone from the Project
    panel, your own comps are unchanged, and every queue item that existed
    before is still there with its original *Render* checkbox.
23. Generate a batch: select 20 AE presets that have no preview, then gear menu >
    **Generate missing previews (N)**.
    **Expected:** it works through them one at a time and ends with
    *Generated 20 of 20 previews.* (or names the ones that failed and why).
    While it runs, switching tabs keeps the batch going.
24. Start a batch again and press **Cancel** after the second item.
    **Expected:** the button says *Stopping after this item…*, the current item
    finishes, and it stops with *Stopped after N of 20.* No half-written
    `preview.mp4` is left behind.
25. Click an item whose preview failed (for example one whose preset needs a
    specific layer type).
    **Expected:** the pane still shows a canvas approximation plus a **Generate
    preview** button, and a readable error in the message area. Nothing crashes.
26. Gear menu > **Clear preview cache…**
    **Expected:** the dialog names the file count and size and says the items and
    presets are not touched. After confirming: every preview file is gone, cards
    fall back to glyphs/thumbnails, and *Removed N preview file(s).*

## G. Large library

27. With about 500 items (`?many=500` in the harness, or your real one), open
    **Library** and scroll fast.
    **Expected:** the grid appears immediately (the first 400 cards), the count
    says `500 items`, and thumbnails fill in as they come into view. Scrolling
    stays smooth and memory does not grow with every card you pass.
28. Click an item far down the list.
    **Expected:** it previews the same way. Only one `<video>` element exists in
    the page (dev tools), no matter how many previews the library has.

## H. Premiere Pro

29. Open QuickKit in Premiere Pro > **Library** and click an AE preset.
    **Expected:** the preview **plays** (it is a plain file), but:
    - **Apply** reads **Coming in 6D** and is disabled,
    - the tooltip says *Applying library items in Premiere Pro is part 6D.
      Previews still play here.*,
    - *Generate missing* / *Generate this preview* are disabled,
    - *Clear preview cache* is disabled and says *(After Effects only)*.
30. Click a Premiere recipe or MOGRT.
    **Expected:** it previews as in After Effects; Apply is still 6D.

## I. Report back

31. If everything passes, reply `6B ok` with the version line from step 1.
    If something fails, send the step number, what you expected, and what
    happened — a screenshot of the message area and of the pane helps most.
    In particular, say whether the **video** played or whether you only ever saw
    the approximation canvas.
