# QuickKit — Part 4 manual checklist (Preset manager)

Version 0.4.0. Run this inside After Effects 26.5 on Windows. Each line has
what to do and what should happen. Stop at the first failure and send the
number, the expected result, and what you saw instead.

The preset store is **`%APPDATA%\QuickKit\presets`**. It is not inside the CEP
extension folder.

---

## A. Connection fix first

1. **Close After Effects completely.** Run `scripts\install.bat` again, then
   reopen After Effects.
   **Expected:** the installer finishes with `SUCCESS - QuickKit is installed.`
2. Open `Window > Extensions > QuickKit` and press **Test host connection**.
   **Expected:** the host card says **Connected**, `After Effects 26.5`, and no
   “line 1503” or “Illegal use of reserved word” dialog appears.
   **If this still fails:** do not continue. Send the exact After Effects dialog
   text and `%TEMP%\CEP12-AEFT.log`.

## B. First open and starter presets

3. Open the **Presets** tab for the first time.
   **Expected:** 15 presets appear in three folders: Titles (5), Styles (6),
   Motion (4). A note says 15 starter presets were added. The footer shows
   `Stored in C:\Users\<you>\AppData\Roaming\QuickKit\presets`.
4. Open that folder in Explorer.
   **Expected:** 15 `.qkpreset` files, `folders.json`, and `.seeded`.
5. Close and reopen the panel, then open Presets again.
   **Expected:** still exactly 15 presets; no duplicates and no second seed.

## C. Save a preset

6. Select one layer and make two opacity keyframes, then in Presets press
   **Save selection**. Name it `Test fade`, choose `All presets`, press
   **Save preset**.
   **Expected:** a `Saved "Test fade"` message, the new card appears, and a new
   `.qkpreset` file exists. The thumbnail shows the layer colour and a motion
   bar.
7. Select a different layer and click the **Test fade** card.
   **Expected:** the target gets two opacity keys at the same offsets from its
   own in point, and one message like `Applied "Test fade" to 1 layer`.
8. Press **Ctrl+Z** once in After Effects.
   **Expected:** the whole preset application is undone in one step.
9. Save a preset while property rows are selected (select only **Opacity** in
   the Timeline).
   **Expected:** applying it changes only opacity. Position, scale and text
   content stay untouched.

## D. Text and motion presets

10. Add a text layer with the word `Hello`, change its font size to 20, then
    apply **Clean Lower Third**.
    **Expected:** the word `Hello` stays; font size becomes 48, tracking 20 and
    the fill becomes white.
11. Apply a text style preset to a solid layer.
    **Expected:** a readable “Nothing was applied” message, not a crash.
12. Apply **Title Rise** to a layer at position 500, 300.
    **Expected:** its position keys are 500, 360 → 500, 300, relative to the
    layer, not copied comp coordinates.
13. Apply **Fade In** to two selected layers.
    **Expected:** both get the fade, one undo group, one message with 2 layers.
14. Apply **Title Pop In** twice to the same layer.
    **Expected:** the target’s old opacity/scale keys are replaced, not doubled.

## E. Search, favourites, folders

15. Type `gold` in Search.
    **Expected:** only **Gold Accent** remains. Clear the search; all presets
    return.
16. Click the star on a card.
    **Expected:** it fills, the Favourites count becomes 1, and the card stays
    in its folder. Click **Favourites**; only starred presets show.
17. Press **New folder**, create `Brand Kit`.
    **Expected:** a `Brand Kit 0` chip appears and becomes active. The empty
    folder state offers **Save here** and **Show all presets**.
18. Save a preset into `Brand Kit` using the Folder menu in the save dialog.
    **Expected:** the preset appears under Brand Kit and All.
19. Open a card’s `⋯` menu → **Rename**, rename it.
    **Expected:** the card and the file’s `name` field change; the file name
    stays the same.
20. Open `⋯` → **Move to folder**, move it to Titles.
    **Expected:** the card shows `Titles`, and the Titles count grows by one.
21. Clear search and filters, then drag a card onto another card.
    **Expected:** a drop mark appears; after releasing, the order persists after
    closing and reopening the panel. Dragging is disabled while a search or
    folder filter is active, and a hint explains why.
22. Delete a preset from `⋯` → **Delete**, confirm.
    **Expected:** the card and its `.qkpreset` file disappear. Cancel once first
    and confirm nothing is deleted.
23. Select `Brand Kit` → **Delete folder**, confirm.
    **Expected:** the folder chip disappears; its presets move to All and are
    not deleted.

## F. Import and export

24. Press **Export pack** with All visible.
    **Expected:** a save dialog appears; save `QuickKit-Test.qkpack`. The file
    is valid JSON with `"format": "quickkit-pack"` and 15+ presets.
25. Press **Import pack** and choose that file.
    **Expected:** the presets are added with new ids. Existing presets are not
    overwritten; duplicate names get a ` 2` suffix.
26. Export while a folder is active.
    **Expected:** only that folder’s visible presets are written.
27. Cancel the export dialog.
    **Expected:** `Export cancelled. Nothing was written.` and no file.
28. Try to import a text file named `.qkpack`.
    **Expected:** a readable “not a QuickKit preset pack” message; the list is
    unchanged.

## G. Damaged files and empty state

29. Close the panel. In the presets folder, create `broken.qkpreset` containing
    `{not json`. Reopen Presets.
    **Expected:** the store still loads, a note says one damaged file was
    skipped, and the other presets still work.
30. Replace `folders.json` with `[]`, then reopen Presets.
    **Expected:** folders are rebuilt from the presets, a note explains it, and
    no folder disappears from the cards.
31. Delete every `.qkpreset` file **and** keep `.seeded`, then reopen Presets.
    **Expected:** the “No presets yet” empty state with **Save selection** and
    **Import pack**. The 15 starters do not reappear.
32. Delete the whole `%APPDATA%\QuickKit` folder, reopen Presets.
    **Expected:** the 15 starters are seeded again exactly once.

## H. Errors and layout

33. Save with no layer selected.
    **Expected:** a sentence asking you to select a layer; no file is written.
34. Apply a preset to a locked layer.
    **Expected:** a message naming the locked layer; one undo group is still
    opened and closed.
35. Resize the panel to about 240 px.
    **Expected:** one preset per row, no horizontal scrollbar, Save/Import/
    Export still reachable.
36. Resize to about 600 px.
    **Expected:** two preset columns in a 480 px centred panel; the card
    thumbnail, name, star and menu do not overlap.
37. Open QuickKit in Premiere Pro and select Presets.
    **Expected:** `Available in After Effects`; no preset buttons are active.

---

If a step fails, include the step number, the expected line, what happened,
and whether `%APPDATA%\QuickKit\presets` contains a `.tmp` file.
