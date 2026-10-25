<#
.SYNOPSIS
  Bump the QuickKit version, build the release zip and publish it with the GitHub CLI.

.DESCRIPTION
  1. writes the new version into the CEP manifest, the panel's VERSION constant
     and the README
  2. stages the folders install.bat needs and zips them as quickkit.zip
  3. commits and pushes the bump
  4. runs `gh release create v<version>` with --latest

  The asset is ALWAYS named quickkit.zip, so this link never changes:
  https://github.com/34rns/QuickKit/releases/latest/download/quickkit.zip

.EXAMPLE
  .\release.ps1 1.0.1

.NOTES
  Requires: PowerShell 5.1+, git, and a logged-in GitHub CLI (`gh auth status`).
  There is no build step: the zipped source IS the deliverable, installed by
  scripts\install.bat.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$root  = $PSScriptRoot
$asset = 'quickkit.zip'
$repo  = '34rns/QuickKit'
$noBom = New-Object System.Text.UTF8Encoding($false)

function Write-TextFile([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, $noBom)
  Write-Host ("  bumped  " + (Split-Path $Path -Leaf)) -ForegroundColor DarkGray
}

# --- 0. preconditions -------------------------------------------------------
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "The GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ then run: gh auth login"
}
Write-Host "Checking GitHub CLI ..." -ForegroundColor Cyan
& gh auth status
if ($LASTEXITCODE -ne 0) { throw "gh is not logged in. Run: gh auth login" }

if (-not (Test-Path (Join-Path $root '.git'))) {
  throw "Not a git repository. Run 'git init' in $root first."
}

# --- 1. bump the version everywhere it appears ------------------------------
Write-Host "`nBumping to v$Version ..." -ForegroundColor Cyan

$csxsPath = Join-Path $root 'extension\CSXS\manifest.xml'
$csxs = [System.IO.File]::ReadAllText($csxsPath)
$csxs = $csxs -replace '(ExtensionBundleVersion=")[^"]+(")', ('${1}' + $Version + '${2}')
$csxs = $csxs -replace '(<Extension\s+Id="[^"]+"\s+Version=")[^"]+(")', ('${1}' + $Version + '${2}')
Write-TextFile $csxsPath $csxs

$panelPath = Join-Path $root 'extension\js\panel.js'
$panel = [System.IO.File]::ReadAllText($panelPath)
$panel = $panel -replace '(var VERSION = ")[^"]+(")', ('${1}' + $Version + '${2}')
Write-TextFile $panelPath $panel

$readmePath = Join-Path $root 'README.md'
$readme = [System.IO.File]::ReadAllText($readmePath)
$readme = $readme -replace '(Version \*\*)\d+\.\d+\.\d+(\*\*)', ('${1}' + $Version + '${2}')
Write-TextFile $readmePath $readme

# --- 2. stage and zip exactly what install.bat needs ------------------------
Write-Host "`nBuilding $asset ..." -ForegroundColor Cyan

$stage = Join-Path $root '.release-stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
$app = New-Item -ItemType Directory -Path (Join-Path $stage 'QuickKit') -Force

foreach ($item in @('extension', 'host', 'design', 'scripts', 'docs', 'README.md', 'LICENSE')) {
  $source = Join-Path $root $item
  if (Test-Path $source) { Copy-Item $source (Join-Path $app.FullName $item) -Recurse -Force }
}

# Dev-only material must never reach a release zip.
foreach ($exclude in @(
    (Join-Path $app.FullName 'docs\releasing.md'),
    (Join-Path $app.FullName 'docs\screenshots'),
    (Join-Path $app.FullName 'docs\manual-test-checklist-part1.md'),
    (Join-Path $app.FullName 'docs\manual-test-checklist-part2.md'),
    (Join-Path $app.FullName 'docs\manual-test-checklist-part3.md')
  )) {
  if (Test-Path $exclude) { Remove-Item $exclude -Recurse -Force }
}

$zipPath = Join-Path $root $asset
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -Force
Remove-Item $stage -Recurse -Force

$zipInfo = Get-Item $zipPath
Write-Host ("  {0}  {1:N1} KB" -f $asset, ($zipInfo.Length / 1KB)) -ForegroundColor Green

# --- 3. commit and push the bump -------------------------------------------
Write-Host "`nCommitting the version bump ..." -ForegroundColor Cyan
& git -C $root add -- extension/CSXS/manifest.xml extension/js/panel.js README.md
& git -C $root diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  & git -C $root commit -m "v$Version"
  if ($LASTEXITCODE -ne 0) { throw "git commit failed." }
  & git -C $root push
  if ($LASTEXITCODE -ne 0) { throw "git push failed." }
} else {
  Write-Host "  nothing new to commit (already bumped?)" -ForegroundColor Yellow
}

# --- 4. publish -------------------------------------------------------------
Write-Host "`nCreating release v$Version ..." -ForegroundColor Cyan
$notes = @"
## QuickKit v$Version

1. Download **$asset** and extract it.
2. Open the extracted ``QuickKit\scripts`` folder and double-click ``install.bat``.
3. Close After Effects and Premiere Pro completely, then reopen them.
4. ``Window > Extensions > QuickKit``.

QuickKit has no auto-updater: to move to this version, extract the new zip over
the old folder, run ``install.bat`` again and restart both apps.

The latest build always lives at
https://github.com/$repo/releases/latest/download/$asset
"@

& gh release create "v$Version" $zipPath --repo $repo --latest --title "v$Version" --notes $notes
if ($LASTEXITCODE -ne 0) { throw "gh release create failed." }

Write-Host "`nDone. v$Version published." -ForegroundColor Green
Write-Host "Stable download: https://github.com/$repo/releases/latest/download/$asset" -ForegroundColor Cyan
