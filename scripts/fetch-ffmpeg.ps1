# QuickKit — put an FFmpeg build into bin\ffmpeg\
#
#   powershell -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1 -From "C:\tools\ffmpeg\bin\ffmpeg.exe"
#
# Copies ffmpeg.exe (and ffprobe.exe when it sits next to it) into
# bin\ffmpeg\ and writes VERSION.txt with the exact build string.
# Reads bin\ffmpeg\NOTICE.txt first: the licence obligations depend on which
# build you pick.

param(
  [string]$From = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "bin\ffmpeg"
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }

function Find-Ffmpeg {
  $candidates = @()

  if ($script:From -ne "") {
    $candidates += $script:From
  }

  $onPath = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }

  # Common places a package manager leaves a static build.
  $globs = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\*\ffmpeg*\bin\ffmpeg.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe",
    "$env:ProgramData\chocolatey\bin\ffmpeg.exe",
    "$env:USERPROFILE\scoop\apps\ffmpeg\current\bin\ffmpeg.exe",
    "$env:ProgramFiles\ffmpeg\bin\ffmpeg.exe"
  )
  foreach ($pattern in $globs) {
    $hit = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { $candidates += $hit.FullName }
  }

  foreach ($path in $candidates) {
    if ($path -and (Test-Path $path)) { return (Resolve-Path $path).Path }
  }
  return $null
}

$source = Find-Ffmpeg
if (-not $source) {
  Write-Host ""
  Write-Host "No ffmpeg.exe found." -ForegroundColor Yellow
  Write-Host "  * Install one (winget install Gyan.FFmpeg) and run this script again, or"
  Write-Host "  * pass -From `"C:\path\to\ffmpeg.exe`"."
  Write-Host ""
  Write-Host "The panel still works: it also accepts ffmpeg.exe on PATH and a path"
  Write-Host "chosen in the Silence tab."
  exit 1
}

$target = Join-Path $dest "ffmpeg.exe"
if ((Test-Path $target) -and -not $Force) {
  $existing = (Get-Item $target).Length
  Write-Host "bin\ffmpeg\ffmpeg.exe already exists ($([math]::Round($existing / 1MB, 1)) MB)."
  Write-Host "Use -Force to replace it."
} else {
  Copy-Item -LiteralPath $source -Destination $target -Force
  Write-Host "Copied $source"
  Write-Host "    to  $target"
}

$probeSource = Join-Path (Split-Path -Parent $source) "ffprobe.exe"
if (Test-Path $probeSource) {
  Copy-Item -LiteralPath $probeSource -Destination (Join-Path $dest "ffprobe.exe") -Force
  Write-Host "Copied ffprobe.exe as well."
}

$version = (& $target -version 2>&1 | Select-Object -First 1)
if (-not $version) { $version = "unknown build" }
$build = (& $target -version 2>&1 | Select-String -Pattern "^configuration:" | Select-Object -First 1)
$license = "unknown"
if ("$version$build" -match "--enable-gpl") { $license = "GPL (GPLv2+) - see NOTICE.txt" }
elseif ("$version$build" -match "--enable-lgpl|--disable-gpl") { $license = "LGPL (LGPLv2.1+) - see NOTICE.txt" }

$lines = @(
  "QuickKit bundled FFmpeg",
  "Copied:  $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
  "Source:  $source",
  "Size:    $([math]::Round((Get-Item $target).Length / 1MB, 1)) MB",
  "Version: $version",
  "Licence: $license",
  "",
  "Read NOTICE.txt before redistributing this build."
)
Set-Content -LiteralPath (Join-Path $dest "VERSION.txt") -Value $lines -Encoding UTF8

Write-Host ""
Write-Host "Detected: $version"
Write-Host "Licence:  $license"
Write-Host ""
Write-Host "Next: run scripts\install.bat so the panel gets bin\ffmpeg as well."
