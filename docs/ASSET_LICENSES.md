# Asset Licenses

Rule: original or properly licensed only. Every third-party item gets a row here
before it ships, with the licence file kept in the repo.

| Asset | Used in | Source | License | License file |
|---|---|---|---|---|
| Inter (400 / 500 / 600, latin, woff2) | `design/tokens.css` → `design/fonts/` | rsms/inter v5.2.5 via `@fontsource/inter` npm package (files fetched at build time, served locally) | SIL Open Font License 1.1 | `design/fonts/OFL.txt` |
| QuickKit SVG icons | `design/icons/icons.js` | Original artwork drawn for this project | Same as QuickKit project code | — |
| Panel CSS, JS, ExtendScript, installers | `extension/`, `host/`, `scripts/` | Original code | Same as QuickKit project code | — |

## Not used, on purpose
- No Adobe CSInterface.js copy: `extension/js/csinterface-lite.js` is an original
  minimal wrapper over `window.__adobe_cep__`.
- No icon font, no framework, no CDN, no analytics.
- No third-party presets or project templates yet.
