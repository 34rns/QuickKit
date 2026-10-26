# Asset Licenses

Rule: original or properly licensed only. Every third-party item gets a row here
before it ships, with the licence file kept in the repo.

| Asset | Used in | Source | License | License file |
|---|---|---|---|---|
| Inter (400 / 500 / 600, latin, woff2) | `design/tokens.css` → `design/fonts/` | rsms/inter v5.2.5 via `@fontsource/inter` npm package (files fetched at build time, served locally) | SIL Open Font License 1.1 | `design/fonts/OFL.txt` |
| FFmpeg for Windows (`ffmpeg.exe`, optional `ffprobe.exe`) | `bin/ffmpeg/` → installed into the CEP extension; started by `extension/js/ffmpeg-node.js` | The build copied on this machine is `ffmpeg N-126374-g089a48eb36-20260831 win64-gpl`, taken from the local WinGet package `yt-dlp.FFmpeg` by `scripts/fetch-ffmpeg.ps1`. Not in git; fetched per machine. | **GPL v2 or later** for this build (LGPLv2.1+ builds are accepted too) | `bin/ffmpeg/NOTICE.txt` (+ `bin/ffmpeg/VERSION.txt`, written by the fetch script) |
| QuickKit SVG icons | `design/icons/icons.js` | Original artwork drawn for this project | Same as QuickKit project code | — |
| Panel CSS, JS, ExtendScript, installers | `extension/`, `host/`, `scripts/` | Original code | Same as QuickKit project code | — |

### FFmpeg notes

- FFmpeg is a **separate program**, not linked into QuickKit. The panel starts
  it as a child process and parses its stderr/stdout. No FFmpeg code is
  compiled into or copied into QuickKit's own source.
- The binary is in `.gitignore` (139 MB, someone else's licence). The build
  script copies it from the machine, and `install.bat` copies it into the
  installed extension.
- A **GPL** build is what this machine has. Redistributing it means shipping
  the full GPL text and a written offer (or link) for the corresponding source
  of that exact build. For a public release, prefer an **LGPL** build: swap it
  with `scripts\fetch-ffmpeg.ps1 -From "C:\path\to\ffmpeg.exe"` and re-run
  `install.bat`. `NOTICE.txt` covers both cases.
- Full obligations are in `bin/ffmpeg/NOTICE.txt`; nothing about them is
  hidden from the user — the Silence tab shows the detected version and says
  the analysis is done by FFmpeg under its own licence.

## Not used, on purpose
- No Adobe CSInterface.js copy: `extension/js/csinterface-lite.js` is an original
  minimal wrapper over `window.__adobe_cep__`.
- No icon font, no framework, no CDN, no analytics.
- No third-party presets or project templates yet.
