# PROMPT 9 — PART 6B: Preview system, select-and-preview workflow (Animation Composer style)

**STATUS: DONE** (2026-10-26) — Part 6B built and installed as 0.8.0. Playback
maths, params/signatures, preview files and the real ffmpeg encode are covered
by `node tests/preview.test.js` (23/23) and the static suite is 112/112; the
pane, click-select autoplay, arrow browsing, double-click apply, params,
Hover mode, batch + cancel and a 500-item library were verified in the browser
harness in both host modes. Render Queue output, `applyPreset` inside the temp
comp, `file://` video in CEP and a real 20-item batch are **UNTESTED** — see
`docs/manual-test-checklist-part6b.md`.

Verbatim user prompt (2026-10-26):

> RESUME: Read PROJECT_RULES.md and PROGRESS.md first. Summarize status in
> 3 lines. If any hover-preview code was already built for Part 6B, list
> it, then replace it with the design below. Then do PART 6B only.
>
> PART 6B: Preview system, select-and-preview workflow (Animation
> Composer style). No hover-to-play.
>
> 1. INTERACTION MODEL
>    - Single click on a card: selects it and loads it into the PREVIEW
>      PANE, which starts playing automatically (looping, muted).
>    - Double-click on a card, or the Apply button in the preview pane:
>      applies the item to the current selection in the host app.
>    - Arrow keys move the selection through the grid and the preview
>      pane updates each time. Space toggles play/pause. Enter applies.
>    - Cards show a static thumbnail only. Nothing animates on hover
>      except a subtle highlight.
>    - Settings option "Preview mode": Click (default) or Hover. Hover
>      is optional and off by default.
>
> 2. PREVIEW PANE
>    - Pinned at the top of the panel, with a resizable height and a
>      collapse toggle. It shows the playing preview, item name, type
>      badge, host support, tags, and Apply and Favorite buttons.
>    - Controls: play/pause, loop toggle, speed (0.5x, 1x, 2x), and a
>      scrub bar.
>    - Below the preview: the item's parameters (duration, direction,
>      easing, and so on, when the item has them). Changing a parameter
>      updates the preview using the approximation in step 5, or shows
>      "Regenerate preview" if exact output requires a render.
>    - Empty state when nothing is selected.
>
> 3. PREVIEW FILES
>    - Each item has a thumbnail (webp) and a short looping preview
>      (WebM or MP4, max about 480px wide, 2-4 seconds) made with the
>      bundled ffmpeg.
>    - Only the selected item's video is loaded. Thumbnails are
>      lazy-loaded so a library of 500+ items scrolls smoothly. Release
>      video resources when selection changes.
>
> 4. AUTO-GENERATION IN AFTER EFFECTS
>    - "Generate preview" for one item and "Generate missing previews
>      (batch)". For each AE preset a script builds a temporary comp with
>      a sample layer (the item name as text on a dark background),
>      applies the preset, renders it (pick aerender or render queue,
>      whichever is more reliable, and tell me why), converts with
>      ffmpeg, saves it, and deletes the temp comp. Show progress with
>      cancel. Never touch my real comps.
>
> 5. FALLBACK
>    - If no preview exists, show a lightweight CSS/canvas approximation
>      for simple presets, or a placeholder with a Generate button.
>
> 6. CACHE
>    - Cache invalidation when a preset changes. A setting to clear the
>      preview cache.
>
> 7. PREMIERE
>    - Same panel and previews, read-only for generation. Apply uses the
>      Part 6D logic (not built yet, so the button shows "Coming in 6D"
>      for now).
>
> Report what you could and could not test. Give me a manual test
> checklist (click to select and preview, arrow-key browsing, double-click
> apply, parameter change, single preview generation, batch of 20, cancel
> mid-batch, 500-item scroll test, switching Preview mode to Hover), update
> PROGRESS.md, and STOP.
