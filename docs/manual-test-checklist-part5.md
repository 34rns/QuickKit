# QuickKit — Part 5 manual checklist (Silence cutter)

Version **0.5.0**. Run this inside **Premiere Pro 26.0.2** on Windows. Each
numbered line says what to do and what should happen. Stop at the first
failure and send the number, the expected result, and what you saw instead.

The parts of this feature that could not be exercised here are marked
**UNTESTED** in `PROGRESS.md`: everything that needs the real Premiere object
model (razor, ripple delete, marker colours, Volume muting, `getSelection`).
The automated suites cover the FFmpeg side, the interval maths and the control
flow in a mock Premiere world — not Premiere itself.

---

## A. Install and find FFmpeg

1. Close Premiere Pro. Run `scripts\install.bat`.
   **Expected:** the installer reports `[OK] Bundled ffmpeg copied` and ends
   with `SUCCESS - QuickKit is installed.`
2. Confirm `%APPDATA%\Adobe\CEP\extensions\QuickKit\bin\ffmpeg\` contains
   `ffmpeg.exe`, `NOTICE.txt` and (if the build had one) `ffprobe.exe`.
3. Open `Window > Extensions > QuickKit` and choose the **Silence** tab.
   **Expected:** the chip reads **ffmpeg ready** plus `GPL` or `LGPL`, and the
   line under it shows the `ffmpeg version …` build string and where it came
   from (`bundled`). No red error.
4. Press **Find ffmpeg** again.
   **Expected:** the same result; the panel does not freeze.
5. If you want to test the failure path: rename
   `bin\ffmpeg\ffmpeg.exe` to `ffmpeg.off`, reopen the panel, press
   **Find ffmpeg**.
   **Expected:** chip **ffmpeg missing**, a message listing how many places were
   checked and how to fix it. **Scan for silence** must refuse with a readable
   message, not a crash or a spinner that never stops. Rename the file back.

**Report the licence line:** the build copied on this machine is a **GPL**
build (`ffmpeg N-126374 … win64-gpl`). `bin/ffmpeg/NOTICE.txt` explains the
obligation and how to swap in an LGPL build before any public release.

## B. Short clip (3–5 minutes, one person talking)

6. Put one linked A/V clip on V1/A1 in a new sequence (25 fps or any rate).
   Mark it as **offline-proof**: the media must be on a local drive.
7. Silence tab: Scan = **Whole sequence**, Threshold `-35 dB`, Min silence
   `0.5`, Pad before/after `0.08`, **Cut through short breaths** unticked.
   Press **Scan for silence**.
   **Expected while it runs:** the progress bar moves, the caption names the
   clip, and the timeline is **untouched**. Premiere stays responsive.
8. When it finishes:
   **Expected:** a waveform with shaded bands over the gaps, a list of gaps with
   `0:00.00 – 0:02.35` style times and lengths, a summary line
   `N gaps, X s — N ticked (X s)`, and **coloured sequence markers** on each
   gap. Nothing is cut yet.
9. Click three gaps in the list to switch them **off**.
   **Expected:** those rows dim, their band on the waveform dims, and the ticked
   total at the bottom drops. Click them again to switch them back on.
10. Set **Apply as → Only mark**, press **Apply to sequence**.
    **Expected:** markers are added again (a second set with the same
    `QuickKit silence` prefix), the sequence is not changed, and `Ctrl+Z`
    removes just that one marker set.
11. Press **Clear QuickKit markers**.
    **Expected:** only markers whose name starts with `QuickKit` disappear; your
    own chapter markers stay.
12. Scan again, then **Apply as → Delete and ripple**, press **Apply to
    sequence**.
    **Expected:** the timeline gets shorter by the sum of the ticked gaps, the
    waveform/segment list clears, and **one** `Ctrl+Z` restores the whole edit
    (all cuts and the ripple, not one gap at a time).
13. Check a cut point by ear and by frame: no word is clipped at either edge
    (that is what the 0.08 s padding buys).
14. Scan again, choose **Apply as → Mute in place**, apply.
    **Expected:** the sequence keeps its **length**; each gap is a separate clip
    with silence instead of sound. `Ctrl+Z` undoes it in one step.
    *(Premiere's scripting cannot move clips to another track, so "mute" is
    implemented as razor + silence in place, not a track move.)*

## C. One-hour clip (long file, progress + cancel)

15. Build a sequence whose audio is about **one hour** (a long recording, or one
    clip used end to end). Scan with the same settings.
    **Expected:** the progress bar advances smoothly, the panel stays usable
    (you can switch tabs and come back, the window redraws), and Premiere does
    not report "not responding".
16. Halfway through, press **Cancel**.
    **Expected:** the run stops within a second or two, the message says the
    scan was stopped and **nothing was changed**, the progress bar hides, and
    the Button **Scan for silence** is enabled again. No marker was added and
    no clip was cut.
17. Scan the same hour again and let it finish.
    **Expected:** it completes without running out of memory; the panel reports
    the number of gaps and the total seconds. Waveform drawing stays smooth
    when you resize the panel.
    **Note the time it took** — that number goes in `HANDOFF.md`.

## D. Clip with no silence

18. Use a clip that is continuous sound (music, or speech with no pause longer
    than 0.5 s). Scan.
    **Expected:** `No cuttable silence was left after padding…` (or a very small
    number of gaps), the list is empty or short, **Apply to sequence** refuses
    with `No gap is ticked…` and nothing in the timeline changes.
19. Lower **Min silence** to `0.2` and scan again.
    **Expected:** more gaps appear. This proves the control reaches FFmpeg.

## E. Clip with no audio

20. Put a video-only clip (no audio stream at all) in a sequence and scan.
    **Expected:** a note like `<clip>: no audio stream`, the scan finishes
    instead of hanging, and the panel says what it found. Nothing crashes and
    nothing is cut.
21. Scan a sequence that has **no audio clips at all**.
    **Expected:** `This sequence has no audio clips QuickKit can read…` and no
    progress bar left spinning.

## F. Multiple audio tracks and linked video

22. Put the same take on A1 and a room-tone track on A2, with tone audible
    during three of the A1 gaps.
    **Expected:** those three gaps are **not** offered, because a track still has
    sound there. The gaps where both tracks are quiet are offered.
23. Apply Delete and ripple on a sequence with A1 + A2 + linked V1.
    **Expected:** the picture moves with the audio (V1 is cut too, no black gap
    and no picture sliding over itself), all tracks stay in sync, and one
    `Ctrl+Z` restores everything.
24. Apply Mute in place on the same sequence.
    **Expected:** the picture is **not** split (only audio is razored) and the
    length stays the same.

## G. Paths with spaces and non-English characters

25. Copy the media into a folder like `C:\剪辑 test\啪 啪 take.wav` (spaces and
    Chinese characters), relink the clip to it, and scan.
    **Expected:** detection runs normally. No "file not found" and no mojibake
    in the messages. The waveform appears.
26. Do the same with a `#` and a `&` in the folder name.
    **Expected:** still works. QuickKit passes the path to FFmpeg as a single
    argument, never through a shell.

## H. Selection scope and offline media

27. Select two of four audio clips in the Timeline, set Scan = **Selected clips
    only**, scan.
    **Expected:** only those two clips are analysed. If the selection has no
    readable audio, a note says the whole sequence was scanned instead.
28. Make one clip offline (close the media file), then scan the sequence.
    **Expected:** a note naming the clip and the reason, the other clips still
    get analysed, and nothing crashes.

## I. No regressions

29. Switch to After Effects 26.5, open QuickKit, press **Test host connection**.
    **Expected:** Connected, and the Silence tab shows its "Available in
    Premiere Pro" card instead of the controls. Every other tab still works.
30. Check the header version reads **v0.5.0**.

---

## Results

| # | Test | Result | Notes |
|---|---|---|---|
| 3 | FFmpeg found and reported | | |
| 7 | Scan leaves the timeline untouched | | |
| 8 | Waveform, list and coloured markers | | |
| 9 | Per-gap toggles update the total | | |
| 12 | Delete + ripple, one undo step | | |
| 14 | Mute in place keeps the length | | |
| 16 | Cancel leaves nothing changed | | |
| 17 | One-hour scan completes | | |
| 18 | No silence is reported, not applied | | |
| 20 | No audio is explained | | |
| 22 | Other tracks block a gap | | |
| 23 | Linked video stays in sync | | |
| 25 | Spaces + Chinese path | | |
| 27 | Selection scope | | |
| 28 | Offline media | | |
| 29 | After Effects unaffected | | |

## Known limits (by design, not bugs)

- **Mute in place** razors the gap and sets the Audio Volume control to −96 dB.
  Premiere's ExtendScript has no "move clip to another track" call, so the clip
  cannot actually be moved.
- **Razor and ripple need QE.** If `app.enableQE()` / `qe.project` is missing in
  a future build, QuickKit refuses to guess and tells you to use **Only mark**.
- The delete path assumes Premiere's ripple delete closes the gap on every
  track (the normal case with track sync lock on). If the tracks are unlocked,
  check the result before saving.
- Markers are added automatically after a scan so you can see the gaps in the
  Timeline; they are removed with **Clear QuickKit markers** or `Ctrl+Z`.
