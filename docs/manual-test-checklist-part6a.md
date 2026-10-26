# QuickKit — Part 6A manual checklist (Unified library)

Version **0.7.0**. Run this with **After Effects 26.5** and **Premiere Pro
26.0.2** on the same Windows machine, both installed normally. Each numbered
line says what to do and what should happen. Stop at the first failure and send
the number, the expected result, and what you saw instead.

What was already checked without the apps:

- `node tests/library.test.js` — 18 tests on a **real temp folder**:
  - `library.json` + `folders.json` + `items\<id>\item.json` written, read and
    re-read (a clean second load does not touch the index);
  - migration of a fake Part 4 preset store: 3 valid presets imported with their
    original **ids** kept, the folder names turned into real folders, the file
    copied byte-for-byte, the old store left where it was, and a deliberately
    damaged preset skipped instead of crashing;
  - item add / touch / update / move / delete on disk;
  - a corrupt `library.json` rebuilt from the item folders, with an empty folder
    surviving through `folders.json`;
  - a missing asset reported but never fatal;
  - a newer `schemaVersion` refused for changes instead of downgraded;
  - `.qkpack` export → import round trip (folder recreated, bytes match), then
    skip / replace / keep both, and refusal of empty selections;
  - the pack proven to be a **real zip** by unpacking it with PowerShell
    `Expand-Archive`;
  - damaged, truncated, empty and path-traversal packs refused with a readable
    message and nothing written outside the store.
- `node tests/check-static.js` — library files parse, the engine is a page
  script, the store is require-only, every library control and id exists, the
  icons exist, and no network URL is used.
- Browser preview (`tests/refresh-preview.js`, served on `127.0.0.1:8137`):
  rendered 14 seeded items, nested folders, collections, search, filters, sort,
  grid/list, selection, dimming in `?host=PPRO`, context menus, rename/details
  dialogs, export/import/repair dialogs, drag and drop, empty states (library,
  folder and "nothing matches"), and the thumbnail fallback. **No console
  errors.**

**Still UNTESTED, because it needs the real apps:**

- `require("js/library-io.js")` inside CEP (Node availability, `%APPDATA%`
  resolution, the extension path decode).
- The real migration of **your** Part 4 presets and applying one afterwards
  (the preset id is kept, so `qkPresetApply(id)` should still find the file).
- Native **Save / Open** dialogs (`window.cep.fs.showSaveDialogEx` /
  `showOpenDialogEx`) and real `.qkpack` files written where you chose.
- `file://` thumbnails loading inside the CEP Chromium 99 runtime.
- Drag and drop with the real mouse in both apps.
- Applying a library item (`.ffx`, `.mogrt`, recipe). **Not built yet** — 6A is
  the store and the UI; applying arrives in 6B/6C.
- Anything at all in Premiere Pro beyond the panel rendering.

Nothing here talks to the internet. The library is a folder on your disk:
`%APPDATA%\QuickKit\library`.

---

## A. Before you start

1. Close both apps, run `scripts\install.bat`, then reopen them.
   **Expected:** `SUCCESS - QuickKit is installed.` and the header shows
   **v0.7.0**.
2. If you have never used QuickKit, skip to step 4. If you used the **Presets**
   tab from Part 4 before, keep that store as it is:
   `%APPDATA%\QuickKit\presets` must still exist afterwards.
3. In After Effects, open `Window > Extensions > QuickKit` > **Library**.
   **Expected:**
   - a note: *Imported N saved presets into the library* (the number matches
     the presets you had; damaged files are mentioned separately),
   - the **Presets** tab still lists the same presets as before,
   - `%APPDATA%\QuickKit\library\library.json`, `folders.json` and one
     `items\<id>\` folder per preset now exist,
   - `%APPDATA%\QuickKit\presets` is untouched.
4. Select a preset in the **Presets** tab and apply it to a few layers.
   **Expected:** it still applies exactly as it did in 0.6.0 — the library
   migration did not move or rename the file the host reads.

## B. First look (both apps)

5. Open **Library**.
   **Expected:**
   - search box, **Type / App / Category / Sort** selects, and the path
     `All items`, then the smart collections, then the folder tree;
   - the count line (`14 items`, `N of M items` when filtered);
   - a grid of cards with a thumbnail area, name and `type · category` line;
   - a star on each card, a `Missing` badge only on items whose file was
     deleted;
   - the footer: **Export pack**, **Import pack**, **Repair library**;
   - the last line shows where the library lives on disk.
6. Hover a card. **Expected:** a tooltip with the type, which app(s) it works
   in, and a note when the file is missing.
7. Switch to **List** and drag the **Thumb** slider.
   **Expected:** the layout changes immediately, and the choice is remembered
   after closing and reopening the panel.

## C. Folders

8. Press **New folder**, type `Titles`, press Enter.
   **Expected:** a new row under the folder list with a count.
9. With `Titles` selected, press **New folder** again and create `Lower thirds`.
   **Expected:** it appears **indented** under `Titles`. Click `Titles` in the
   breadcrumb above the items to jump back.
10. Drag two cards onto `Titles`.
    **Expected:** the folder row highlights while you hover, the cards
    disappear from `All items` when you are inside a folder, and the counts
    update. Nothing is copied — the item moves.
11. Right-click `Lower thirds` > **Rename folder**, and rename it.
    **Expected:** the breadcrumb and the item paths follow the new name.
    Creating a second folder with the same name next to it is refused with
    *A folder called … already exists here.*
12. Right-click a folder > **Delete folder…**
    **Expected:** the dialog says items **move up one level** and are kept.
    After confirming, the folder is gone, its items are still in the library
    and its subfolders moved up.
13. Drag a folder onto another folder in the list (or use
    **Move folder to All items**).
    **Expected:** it nests/moves, and a folder can never be dropped inside
    itself.

## D. Search, filters, collections

14. Type `glow` in **Search**, then a tag you know, then part of a note.
    **Expected:** results narrow as you type; the ✕ clears it; `Ctrl+F` focuses
    the search box from anywhere in the library.
15. Set **Type: MOGRT**, then **App: Premiere Pro**, then a **Category**.
    **Expected:** each filter narrows the list, the count says `N of M items`,
    and **Clear filters** (in the empty state) resets everything.
16. Click through **Favorites**, **Recently used**, **Most used**,
    **Untagged**, **Text**, **Transitions**, **Shapes**.
    **Expected:** each shows the matching items with a live count; clicking the
    active one again returns to **All items**.
17. Change **Sort** to **Newest first** and **Most used**.
    **Expected:** the order changes and stays after a reload.

## E. Selection, details, keyboard

18. Click a card, then Ctrl+click a second, then Shift+click a third.
    **Expected:** one, two, then a range is selected; the count line shows
    `N selected`.
19. Double-click a card (or press Enter).
    **Expected:** **Item details** opens with name, category, tags, folder and
    notes, plus a line with type, apps, usage count and the date added. Save a
    change; the card updates.
20. Press **F2** on the selected item.
    **Expected:** rename dialog; an empty name is refused in place.
21. Click the star.
    **Expected:** it fills, the item appears under **Favorites**, and the change
    survives a reload of the panel.
22. Press **Delete**.
    **Expected:** a confirmation that names the item(s) and says the folders are
    removed from disk; Cancel does nothing. After confirming, the card is gone
    and `items\<id>` no longer exists.
23. Use the arrow keys on a focused card.
    **Expected:** focus and selection move one card at a time; Space toggles the
    item in the selection.

## F. Packs

24. Select two items and press **Export pack**.
    **Expected:** a native Save dialog suggests `.qkpack`; after saving, the
    status bar says `Pack written` and the message names the file. Open the file
    with 7-Zip or Explorer: it is a normal zip containing `manifest.json` and
    `items\<id>\…`.
25. Export again from inside a folder with nothing selected.
    **Expected:** the whole folder is exported, and the suggested name is the
    folder name.
26. Open a second machine (or a fresh Windows user) and press **Import pack**,
    pick the file.
    **Expected:** a dialog shows the pack name, when it was made, the item count
    and the first names, with **Skip / Replace / Keep both** and Import
    preselected on Skip.
27. Import it with **Keep both** twice.
    **Expected:** the first import adds the items, the second adds numbered
    copies (`Name (2)`), and the message reports `Added / replaced / kept both /
    skipped` counts. Importing a second time with **Skip** changes nothing.
28. Try importing a text file renamed to `.qkpack`.
    **Expected:** a short message that it is not a QuickKit pack — no crash, no
    stack trace, library unchanged.

## G. Repair and damaged files

29. Close the app. Rename `%APPDATA%\QuickKit\library\library.json` to
    `library.json.bak`, reopen the panel.
    **Expected:** the library still lists every item — it is rebuilt from the
    `items\*\item.json` files, and empty folders come back from
    `folders.json`.
30. Close the app, delete one asset file (`items\<id>\asset.*`) and reopen.
    **Expected:** the card is still there with a **Missing** badge and a
    tooltip; nothing crashes and the rest of the library works.
31. With the app open, press **Repair library**.
    **Expected:** a confirmation, then *Rebuilt the library index: N items in M
    folders.* Items are never deleted by Repair.
32. Open `library.json` in Notepad, put `{ broken` at the top, save, press
    **Repair library**.
    **Expected:** the library rebuilds instead of failing. Put the good file
    back afterwards if you made a backup.
33. Set `"schemaVersion"` in `library.json` to `99`, save, reopen the panel.
    **Expected:** the library still **lists** items, and any change is refused
    with *This library was saved by a newer QuickKit. Update QuickKit before
    changing it.* — it does not downgrade or wipe the file.

## H. Premiere Pro

34. Open QuickKit in Premiere Pro > **Library**.
    **Expected:** the same library. Items that only work in After Effects are
    **dimmed** with a tooltip *Only works in After Effects. It stays in the
    library for that app.*; Premiere recipes and MOGRTs are normal.
35. Repeat steps 7, 10, 14–16, 21 and 24 here.
    **Expected:** identical behaviour. Folders, packs and search are shared, so
    a change made in one app is there the next time the other app opens the
    panel.

## I. Report back

36. If everything passes, reply `6A ok` with the version line from step 1.
    If something fails, send the step number, what you expected, and what
    happened — a screenshot of the message area helps most.
