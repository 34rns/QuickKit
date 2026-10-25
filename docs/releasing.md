# Releasing QuickKit

## To update, run `.\release.ps1 1.0.1`

```powershell
cd path\to\QuickKit
.\release.ps1 1.0.1
```

That one command:

1. writes `1.0.1` into `extension/CSXS/manifest.xml`
   (`ExtensionBundleVersion` and the `<Extension>` version),
   `extension/js/panel.js` (`VERSION`) and the README;
2. stages the folders `install.bat` needs and zips them as **`quickkit.zip`**;
3. commits and pushes the version bump;
4. runs `gh release create v1.0.1 quickkit.zip --latest`.

Pass any `major.minor.patch` version. The script refuses anything else.

There is no build step — plain HTML/CSS/JS plus ExtendScript — so the zipped
source **is** the deliverable.

## The download link never changes

The asset is **always** named `quickkit.zip`, so this URL always resolves to
the newest build no matter how many releases you publish:

```
https://github.com/34rns/QuickKit/releases/latest/download/quickkit.zip
```

Do not rename the asset per release, or that link breaks. `releases/latest`
always points at whatever release GitHub considers current.

## Prerequisites

- PowerShell 5.1 or newer (Windows 10/11 ships it).
- [GitHub CLI](https://cli.github.com/) installed and logged in — the script
  runs `gh auth status` first and stops if you are not authenticated.
- A git repository with a remote (`git remote -v` should show the GitHub URL).
  The release tag is created from the pushed commit, so the script pushes
  before it publishes.

## Installing a new version

QuickKit is copied into place by `scripts/install.bat`, so updating is:

1. Extract the new `quickkit.zip` over the old folder (or next to it).
2. Double-click `scripts\install.bat`.
3. Close After Effects and Premiere Pro **completely**, then reopen them.

The panel is only scanned at startup, so the restart is required — the
installer even says so at the end.

## Unpacked extensions cannot auto-update

QuickKit is not installed from the Adobe Marketplace. It is a folder copied
into `%APPDATA%\Adobe\CEP\extensions\` with `PlayerDebugMode` turned on, and
nothing in that mechanism checks for new versions. There is no update URL, no
background service and no update prompt — the installed copy stays exactly
what it was until someone runs `install.bat` again.

So a release is a zip plus a note telling people to re-run the installer;
it is never applied silently.

### Store distribution later

The Adobe route would be the equivalent of the Chrome Web Store for auto-
updates: a Marketplace entry gets distributed and refreshed by Adobe instead
of by hand. Per Adobe's published roadmap, new CEP Marketplace submissions stop in
**December 2027** and CEP is removed from flagship apps by **December 2029**,
so a store-distributed CEP panel has a limited shelf life. Re-check those dates
current Adobe documentation before relying on them.

The mitigation already in place is structural: every host call sits behind one
adapter folder, so a UXP port replaces that folder rather than the panel.
If and when that happens, `release.ps1` keeps its shape — bump, zip, publish —
and only the packaged payload changes.

Re-check the Adobe dates against current docs before relying on them.
