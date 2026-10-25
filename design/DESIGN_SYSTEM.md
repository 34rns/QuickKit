# QuickKit Design System

Binding for every part. Source of truth: `design/tokens.css`. No file outside
`tokens.css` may hard-code a color, font, duration, radius, shadow or spacing
value. `tests/check-static.js` fails the build if it does.

## Palette

| Token | Value | Use |
|---|---|---|
| `--qk-bg` | `#0E0F12` | Panel background |
| `--qk-surface` | `#16181D` | Cards, status bar, dialog |
| `--qk-surface-raised` | `#1B1E24` | Hovered cards, tooltip |
| `--qk-border` | `#23262D` | 1px borders, dividers |
| `--qk-border-strong` | `#2F333C` | Button border, hover border |
| `--qk-text` | `#E6E8EC` | Primary text |
| `--qk-muted` | `#8B90A0` | Secondary text, inactive tabs, icons at rest |
| `--qk-accent` | `#7C5CFF` | Primary button fill, active tab indicator and label, focus ring |

Accent rules: primary actions and active states only. Never for decoration,
never for body text, never two accents on one screen. Hover/pressed shades
(`#8F73FF`, `#6A4AE6`) live in tokens; they are the same hue, not a second
accent.

Contrast: `--qk-text` on `--qk-bg` is AA; `--qk-muted` is used at 11–12px for
secondary information only, never for the only copy of a control label.

## Typography

Inter, bundled in `design/fonts/` (SIL OFL 1.1, no CDN). Fallback:
Segoe UI Variable Text → Segoe UI → system-ui.

| Token | Size | Typical use |
|---|---|---|
| `--qk-fs-11` | 11px | Status bar, tooltips, captions |
| `--qk-fs-12` | 12px | Body, tab labels, buttons |
| `--qk-fs-13` | 13px | Card titles, emphasized values |
| `--qk-fs-16` | 16px | Section headings |
| `--qk-fs-20` | 20px | Dialog title (only place 20px is used) |

Weights: 400 regular, 500 medium (controls, tabs), 600 semibold (titles,
values). Line-height 1.45 body / 1.25 headings. No letter-spacing except
`--qk-tracking-caps` for uppercase micro-labels.

## Spacing, shape, elevation

- 8px grid: 8 / 16 / 24 / 32. 4px is the half-step for inline gaps only
  (icon-to-label, chip padding).
- Radii: 6px small controls and tooltips, 8px cards and dialogs. Nothing round
  except status pills.
- Borders: always 1px, `--qk-border` at rest, `--qk-border-strong` on
  interactive hover.
- Shadows: only on floating elements — welcome dialog and tooltip. The status
  bar uses a 1px top border, not a shadow.
- Motion: 120ms (hover/press), 160ms default, 180ms overlays, all
  `ease-out`. Respect `prefers-reduced-motion`.

## Buttons

| State | Primary | Secondary |
|---|---|---|
| Default | accent fill, white text | raised surface, strong border, text |
| Hover | `--qk-accent-hover` | `--qk-border` fill |
| Pressed | `--qk-accent-pressed` | `--qk-border-strong` fill |
| Disabled | 45% opacity, no hover, `cursor: default` | same |
| Loading | label stays, 12px spinner replaces the leading icon, `aria-busy="true"`, no double-submit | same |

Ghost buttons (status bar, icon buttons) are muted at rest, text color on
hover, accent only when active. Every control has a tooltip and either a
visible label or `aria-label`.

## Tabs

Top of the panel, horizontal, 40px tall, icon 16px + 12px medium label.
Active = text color + 2px accent underline + `aria-selected="true"`. A tab
that does not apply to the current host stays selectable (never a dead
disabled tab) and shows an "Available in Premiere Pro" / "Available in After
Effects" state. Its label/icon sit at 50% opacity so the shape of the panel is
still readable.

Keyboard: Left/Right move, Home/End jump, focus ring follows. Roving tabindex.

## Empty states

Icon in a bordered surface circle, short title at 13px semibold, one or two
lines of muted body at 12px, and a muted hint at 11px. Friendly, never
apologetic-technical. No illustrations, no emoji.

## Icons

Custom set in `design/icons/icons.js`, 16×16 viewBox, single 1.5px stroke,
round caps/joins, `currentColor`, `fill="none"` except deliberate 1px dots.
No emoji anywhere. Available: anchor, presets, text, easing, layers, silence,
bridge, help, close, check, info, undo, plug.

## Tooltips

One JS-positioned layer (`#qk-tooltip`), not CSS bubbles — they would be
clipped by the panel edge at 240px. Every control has `data-tip`. Shown on
hover and keyboard focus, hidden on leave/blur/Escape, clamped inside the
viewport, max 220px wide, 11px text, raised surface, float shadow.

## Panel width

240px → 600px. Layout is fluid: content padding 8px at ≤280px, 12px at
281–419px, 16px at ≥420px. Below ~420px the tab strip scrolls horizontally
with a visible thin scrollbar, wheel scrolling and Left/Right/Home/End keys;
nothing else may overflow horizontally. Status bar stays pinned and truncates
its label with an ellipsis.

## Errors

Human sentences, no codes, no stack traces: what happened, why, what to try
next. Red is not part of this palette; errors use text + border emphasis and
the muted/accent system, never a second accent color.

## Accessibility

Focus visible on every interactive element (`--qk-focus-ring`). All controls
are real `<button>`s with labels. Overlays use `role="dialog"`,
`aria-modal="true"`, focus the first action, close on Escape. Live region on
the host card so results are announced.

## Tool panels (Part 2)

- **Panel column.** Tool content is capped at `--qk-panel-max` (480px) and
  centred, so a 600px panel does not stretch form fields across the window.
- **Anchor grid.** 3×3 of `--qk-anchor-cell` (64px) buttons, 1px border,
  `--qk-surface` fill, radius 6. Each cell shows a `--qk-anchor-dot` marker at
  24/50/76%. Hover raises the surface and strengthens the border; the dot stays
  neutral. 9px gaps, `justify-self: center`.
- **Fields.** Inputs and selects are 28px tall, `--qk-input-bg` fill, 1px
  `--qk-input-border`, radius 6, 12px text. Focus uses the accent border plus
  the focus ring. Two-column rows collapse to one column at ≤280px.
- **Collapsible sections.** Native `<details>` styled as a surface card with a
  chevron that rotates on open. No custom JS for disclosure.
- **Messages.** One live strip at the top of the content: surface fill, 1px
  strong border for success, dashed muted border for errors, 11px text, icon
  from the custom set. No red.
- **Easing.** Four preset buttons (accent-soft + accent border when pressed),
  a 110px SVG curve preview (accent stroke, dashed muted axes), a one-line
  explanation, then one primary Apply button. The preview is panel-side only;
  it never calls the host.

## Text panel (Part 3)

- **Presets.** Six buttons in the same two-column grid as the easing presets
  (one column at ≤280px). Selected = accent-soft fill, accent border and
  `aria-pressed="true"`; unselected stays muted. One line of 11px muted text
  under the preview explains the selected animation.
- **Preview stage.** A `--qk-text-stage-height` (92px) surface card with a 1px
  border and 8px radius. The sample is 24px semibold, one line, centred and
  clipped by the card; it is decorative (`aria-hidden`), so the controls and
  the note are the accessible description. Motion values come from
  `--qk-text-shift`, `--qk-text-blur` and `--qk-text-pop`; the animation resets
  to the readable state after one pass. Under `prefers-reduced-motion` the
  stage shows the end state without animating.
- **Fields.** Duration and delay share a two-column row; easing is a full-width
  select. The direction/distance row is hidden unless **Slide** is selected.
- **Edges.** Two full-width checkbox rows, 12px labels, 4px gap. They are
  independent; both may be off, in which case the host explains why nothing
  can be animated.
- **Action.** One full-width primary **Apply to selected layers** button. The
  preview never calls the host; only this button does.

## Build note

`design/` and `host/` are copied into the installed extension by
`scripts/install.bat`, so the panel loads `design/tokens.css`,
`design/icons/icons.js` and `host/quickkit.jsx` from its own root. Do not
duplicate token values into `extension/`.
