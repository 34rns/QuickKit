QuickKit — FFmpeg folder
========================

QuickKit's Silence tab needs `ffmpeg.exe` in this folder (next to this file).
It is intentionally NOT in git: the binary is 100 MB and is somebody else's
licence, so it is fetched or copied on the machine that builds the extension.

Option A — copy what you already have (recommended)
---------------------------------------------------
    powershell -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1

The script looks for ffmpeg.exe on PATH and in the usual package-manager
folders, copies ffmpeg.exe (and ffprobe.exe when it is next to it) here, and
writes VERSION.txt with the exact build string.

Option B — point at a specific file
-----------------------------------
    powershell -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1 -From "C:\tools\ffmpeg\bin\ffmpeg.exe"

This is the way to choose an LGPL build instead of a GPL one.

Option C — do nothing
---------------------
The panel also accepts an FFmpeg that is already on PATH, and a path you pick
in the panel (stored in %APPDATA%\QuickKit\settings.json). Nothing breaks when
this folder is empty; the Silence tab just says which places it looked in.

Files
-----
  NOTICE.txt   licence notice that must travel with the binary
  VERSION.txt  build string written by the fetch script (not in git)
  ffmpeg.exe   the binary itself (not in git)
  ffprobe.exe  optional, only used to read stream info when present

Then install as usual:
    scripts\install.bat
which copies this folder into
    %APPDATA%\Adobe\CEP\extensions\QuickKit\bin\ffmpeg
