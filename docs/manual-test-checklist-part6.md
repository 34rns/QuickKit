# QuickKit — Part 6 manual checklist (Bridge)

Version **0.6.0**. Run this with **Premiere Pro 26.0.2** and **After Effects
26.5** on the same Windows machine, both installed normally. Each numbered line
says what to do and what should happen. Stop at the first failure and send the
number, the expected result, and what you saw instead.

What was already checked without the apps:

- `node tests/host-logic.test.js` — 104 tests, including a mock Premiere world
  (handoff written with the used in/out range, selection scope, offline clips)
  and a mock After Effects world (comp size/fps/duration, layer trim maths,
  speed stretch, unique comp names, template fallback, saved project check,
  return file, place at the original position).
- `node tests/render.test.js` — 12 tests against the **real** `aerender.exe`
  (`26.5x89`): discovery, version probe, progress parsing, cancel, and the real
  error text for a bad project path.
- `node tests/check-static.js` — panel wiring, bridge ids, honest note, README
  limitations.

**Still UNTESTED, because it needs the real apps:** writing a handoff from a
real Premiere sequence, `ImportOptions`/`importFile`, `comp.layers.add` trim
behaviour, `renderQueue.items.add` plus `outputModule.applyTemplate`, saving the
project, `renderQueue` placement, `app.project.importFiles`, `overwriteClip`,
and BridgeTalk between the two running apps.

The bridge is a **file handoff, not Dynamic Link**. Nothing here should look
live: the handoff is JSON in `%APPDATA%\QuickKit\bridge` and the render is an
ordinary media file.

---

## A. Before you start

1. Close both apps, run `scripts\install.bat`, then reopen them.
   **Expected:** `SUCCESS - QuickKit is installed.` and QuickKit appears under
   `Window > Extensions` in **both** apps.
2. In After Effects, open or create a project and **save it once**
   (`File > Save As`). Keep it open.
   **Expected:** the project has a path on disk. The render step needs this.
3. In Premiere Pro, build a short sequence (10–20 s is enough) with:
   - one video clip on **V1**,
   - a second video clip on **V1** later in the timeline,
   - one clip whose **speed is not 100%** (right-click > Speed/Duration),
   - one clip you have **trimmed** so its in/out points are not the whole file.
   Keep all media on a local drive.

## B. Send to After Effects (Premiere Pro)

4. Open `Window > Extensions > QuickKit` > **Bridge**.
   **Expected:**
   - the lead paragraph and a dashed note that says **"This is a file handoff,
     not Dynamic Link"**;
   - the **Send to After Effects** card (Clips: *Selected clips* / *Whole
     sequence*) and the **Renders waiting** card;
   - no After Effects card is visible in Premiere;
   - no error message.
5. Select **one** trimmed clip on the timeline, choose **Clips: Selected
   clips**, press **Send to After Effects**.
   **Expected:** the **Last action** list appears and every row is a tick:
   *Read the active sequence*, *Find the clips to send*, *Check the media
   files*, *Create the handoff folder*, *Write the handoff file*, plus a note
   that After Effects has to import it. The status bar says
   `Handoff written - open After Effects`. Nothing changes in the timeline.
6. Open `%APPDATA%\QuickKit\bridge\pending` in Explorer.
   **Expected:** one `*.qkhandoff` file. Open it in Notepad and check it holds
   `"format": "quickkit-handoff"`, the sequence name, `frameRate`, `width`,
   `height`, and for the clip its `name`, `path`, `inPoint`, `outPoint`,
   `sequenceStart` and `duration`. `inPoint`/`outPoint` must match the trimmed
   range you see in Premiere.
7. Back in the panel, choose **Clips: Whole sequence** and press **Send**
   again.
   **Expected:** a second handoff file. The step list says how many clips it
   found. The *Renders waiting* card still says no renders.
8. Switch every clip off in the timeline (or delete them) and press **Send**
   with **Whole sequence** selected.
   **Expected:** a clear failure such as *"This sequence has no video or audio
   clips QuickKit can read"*, status `Send failed - nothing changed`, and no new
   file in `pending`.
9. Relink one clip's media to a path that does not exist (rename the file on
   disk, reopen the project, keep the offline clip on the timeline) and send
   **Whole sequence** with other online clips present.
   **Expected:** the *Check the media files* row is a **note** naming the
   offline clip count, the handoff is still written, and the online clips are
   listed. With **only** offline clips, the send fails and says every clip is
   offline.

## C. Import in After Effects

10. Open `Window > Extensions > QuickKit` in After Effects > **Bridge**.
    **Expected:** the **Handoffs waiting** card lists both handoffs with the
    sequence name, size, frame rate and duration; the **Send back to Premiere**
    card shows the composition line (`No composition open` or the current comp);
    no Premiere card is visible.
11. Press **Import** on the first handoff.
    **Expected:** the step list shows *Read the handoff file*, *Check the
    handoff*, *Find the After Effects project*, *Import the footage*, *Create
    the composition*, *Place the clips in the composition*, *Remember the
    original position*, *File the handoff away*, *Ready to work*. A composition
    opens whose width, height and frame rate match the Premiere sequence and
    whose duration covers the used range.
12. Inspect the layers.
    **Expected:** each clip is one layer, trimmed to exactly the range Premiere
    was using. A clip that started 2 s into the sequence begins 2 s into the
    comp; a clip with speed 200% is twice as short on the comp timeline
    (Layer > Time > Time Stretch shows 50%). No extra frames before the in
    point.
13. Check `%APPDATA%\QuickKit\bridge`.
    **Expected:** the imported handoff is now in `imported\`, and
    `imports\<lowercased comp name>.json` holds the comp name, the sequence
    name and `place.start` / `place.track` / `place.trackName` from the first
    clip.
14. Import the second handoff.
    **Expected:** a second composition; if the name already exists it gets a
    ` 2` suffix.
15. Import a handoff whose media you renamed on disk.
    **Expected:** the *Import the footage* row is a **note** naming the missing
    file, the comp is still built from the clips that exist, and if **nothing**
    can be imported the import fails and no comp is created.
16. (Failure path) Put a text file named `bad.qkhandoff` into `pending\` and
    press **Refresh**, then **Import**.
    **Expected:** the row is either skipped from the list, or the import fails
    with *"That file is not a QuickKit handoff"*. Nothing crashes.

## D. Send back to Premiere

17. With the imported composition open in After Effects, choose **Format:
    Automatic** and press **Render and send back**.
    **Expected:** the step list fills in *Find the composition*, *Find the saved
    project file*, *Find aerender.exe* (with a path under
    `...\Adobe After Effects 2026\Support Files\aerender.exe`), *Add the
    composition to the render queue*, *Apply render settings*, *Set the output
    module* (naming a template that exists on your machine), *Save the
    project*, *Ready to render*. The progress bar then moves in real
    percentages while After Effects **stays responsive**.
18. While it renders, press **Cancel render**.
    **Expected:** the render stops within a few seconds, the panel says it was
    stopped, no return file is written, and Premiere is untouched. Render
    again to finish.
19. Let a render finish.
    **Expected:** progress reaches 100%, the file appears in
    `%APPDATA%\QuickKit\bridge\renders\`, the return file appears in
    `returns\`, and the panel reports either
    `Rendered and handed to Premiere Pro` (Premiere was running) or
    `Rendered - waiting in returns`.
20. Go to Premiere Pro and open the Bridge tab again.
    **Expected:** the **Renders waiting** card lists the render with its comp
    name and `at <time> on V1`.
21. Press **Place** (only if it was not placed automatically).
    **Expected:** the step list shows *Read the return file*, *Check the
    rendered file*, *Find the destination sequence*, *Import the render*,
    *Place it on the timeline*, *File the return away*, *Check the result*. The
    render is on **V1 at the original clip's start time** and the return file
    moves to `placed\`.
22. Play across the join.
    **Expected:** the render covers the original clip's screen position. Where
    the comp is longer than the original clip, the frames after it are
    overwritten — this is documented, not a bug.
23. (Failure path) Close Premiere Pro, then render again from After Effects.
    **Expected:** the render completes, the panel says the file is waiting in
    `returns`, and no error is claimed. Reopen Premiere, press **Place**, and
    it lands in the same place.
24. (Failure path) In After Effects, work in a project that has **never been
    saved**, then press **Render and send back**.
    **Expected:** the render is refused with *"This project has never been
    saved, so aerender has no file to open. Use File > Save As…"* and no render
    starts.
25. (Failure path) Rename `aerender.exe` in the After Effects `Support Files`
    folder to `aerender.off`, then press **Render and send back**.
    **Expected:** the comp is still queued with its output set, and the panel
    says `aerender.exe was not found…` and tells you to render it from the
    Render Queue by hand. Rename the file back.
26. (Failure path) Open a comp that was **not** built from a handoff and render
    it.
    **Expected:** it still renders, but the return has no original position and
    Premiere places it at `0 s` with a note saying so.

## E. What should *not* happen

27. Editing the Premiere clip after sending must not change the After Effects
    comp.
    **Expected:** nothing changes. This is a file handoff, not Dynamic Link.
28. Deleting `%APPDATA%\QuickKit\bridge` while a handoff is waiting must not
    crash anything.
    **Expected:** the lists go empty; importing a known id fails with *"could
    not read …"*; a new send recreates the folders.
29. Closing either app mid-way through a send or import must not leave the other
    app stuck.
    **Expected:** the waiting file stays where it is; the other panel's
    **Refresh** shows it again.

## F. Report back

For each failure, send:

- the step number,
- what the **Last action** list showed (copy the failing row),
- the status bar text,
- whether a file appeared in `pending`, `renders` or `returns`.
