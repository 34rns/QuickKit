#!/usr/bin/env node
/* QuickKit static checks. No dependencies.
   Run from the QuickKit folder:  node tests/check-static.js
   Exits 1 if any check fails. */

"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var execFileSync = require("child_process").execFileSync;

var ROOT = path.resolve(__dirname, "..");
var passes = [];
var fails = [];
var skips = [];

function pass(message) {
  passes.push(message);
}
function fail(message) {
  fails.push(message);
}
function skip(message) {
  skips.push(message);
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}
function walk(rel, out) {
  var abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  fs.readdirSync(abs, { withFileTypes: true }).forEach(function (entry) {
    var child = path.join(rel, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else out.push(child);
  });
  return out;
}
function resolvePanelRef(ref) {
  var clean = ref.replace(/^\.\//, "").split("?")[0];
  if (clean.indexOf("design/") === 0) return path.join(ROOT, clean);
  return path.join(ROOT, "extension", clean);
}

/* 1. manifest */
var manifestPath = "extension/CSXS/manifest.xml";
var manifest = exists(manifestPath) ? read(manifestPath) : "";
if (!manifest) {
  fail("manifest missing: " + manifestPath);
} else {
  if (manifest.indexOf('<Host Name="AEFT" Version="[22.0,99.9]"') !== -1) pass("manifest targets AEFT 22.0-99.9");
  else fail("manifest AEFT host entry is missing or not [22.0,99.9]");

  if (manifest.indexOf('<Host Name="PPRO" Version="[22.0,99.9]"') !== -1) pass("manifest targets PPRO 22.0-99.9");
  else fail("manifest PPRO host entry is missing or not [22.0,99.9]");

  if (manifest.indexOf('RequiredRuntime Name="CSXS" Version="9.0"') !== -1) pass("manifest requires CSXS 9.0");
  else fail("manifest RequiredRuntime CSXS 9.0 missing");

  if (manifest.indexOf("<MainPath>./index.html</MainPath>") !== -1) pass("manifest MainPath points at index.html");
  else fail("manifest MainPath is not ./index.html");

  if (manifest.indexOf("<ScriptPath>./host/quickkit.jsx</ScriptPath>") !== -1) pass("manifest ScriptPath points at host/quickkit.jsx");
  else fail("manifest ScriptPath is not ./host/quickkit.jsx");
}

/* 2. installed-layout assets referenced by the panel */
var html = exists("extension/index.html") ? read("extension/index.html") : "";
if (!html) fail("extension/index.html missing");
var refs = [];
html.replace(/(?:src|href)="([^"]+)"/g, function (_, ref) {
  refs.push(ref);
  return _;
});
refs.forEach(function (ref) {
  var target = resolvePanelRef(ref);
  if (!fs.existsSync(target)) fail("index.html references a missing file: " + ref);
});
if (refs.length && refs.every(function (ref) { return fs.existsSync(resolvePanelRef(ref)); })) {
  pass("every script/link in index.html resolves in the installed layout (" + refs.length + " files)");
}

/* required source folders that install.bat assembles */
["design/tokens.css", "design/icons/icons.js", "host/quickkit.jsx", "extension/css/panel.css"].forEach(function (rel) {
  if (!exists(rel)) fail("missing source file: " + rel);
});

/* 3. token usage */
var tokensFile = exists("design/tokens.css") ? read("design/tokens.css") : "";
var defined = {};
tokensFile.replace(/(--qk-[a-z0-9-]+)\s*:/g, function (_, name) {
  defined[name] = true;
  return _;
});
if (Object.keys(defined).length < 20) fail("tokens.css defines only " + Object.keys(defined).length + " tokens");
else pass("tokens.css defines " + Object.keys(defined).length + " tokens");

var panelsFiles = walk("extension", []).filter(function (f) {
  return /\.(css|html|js)$/.test(f);
}).concat(walk("design/icons", []).filter(function (f) {
  return /\.js$/.test(f);
}));

var usedTokens = {};
panelsFiles.forEach(function (rel) {
  read(rel).replace(/var\((--qk-[a-z0-9-]+)/g, function (_, name) {
    usedTokens[name] = rel;
    return _;
  });
});
Object.keys(usedTokens).forEach(function (name) {
  if (!defined[name]) fail("undefined token " + name + " used in " + usedTokens[name]);
});
if (Object.keys(usedTokens).every(function (name) { return defined[name]; })) {
  pass("every var(--qk-*) used outside tokens.css is defined (" + Object.keys(usedTokens).length + " tokens)");
}

/* 4. no raw colors outside tokens.css */
var colorPattern = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
panelsFiles.forEach(function (rel) {
  if (rel === "design/tokens.css") return;
  var body = read(rel);
  var match = colorPattern.exec(body);
  if (match) fail("raw color " + JSON.stringify(match[0]) + " in " + rel + " (use a token)");
});
if (!panelsFiles.some(function (rel) {
  return rel !== "design/tokens.css" && colorPattern.test(read(rel));
})) {
  pass("no raw colors outside design/tokens.css");
}

/* 5. no network references in shipped files */
var shipped = walk("extension", []).concat(walk("design", []), walk("host", []));
/* Fonts are binary and license texts must keep their reference URLs, so only
   code and markup are scanned for network access. */
function isScannable(rel) {
  return !/\.(woff2|ttf|otf|txt)$/.test(rel);
}
shipped.filter(isScannable).forEach(function (rel) {
  var body = read(rel).replace(/http:\/\/www\.w3\.org\/2001\/XMLSchema-instance/g, "");
  if (/https?:\/\//.test(body)) fail("network URL found in shipped file: " + rel);
});
if (!shipped.filter(isScannable).some(function (rel) {
  return /https?:\/\//.test(read(rel).replace(/http:\/\/www\.w3\.org\/2001\/XMLSchema-instance/g, ""));
})) {
  pass("no http(s) references in shipped code and markup (license text excluded)");
}

/* 6. every icon used exists */
var iconSource = exists("design/icons/icons.js") ? read("design/icons/icons.js") : "";
var definedIcons = {};
iconSource.replace(/^ {4}([a-z]+):/gm, function (_, name) {
  definedIcons[name] = true;
  return _;
});
var usedIcons = {};
html.replace(/data-icon="([a-z]+)"/g, function (_, name) {
  usedIcons[name] = true;
  return _;
});
var panelJs = exists("extension/js/panel.js") ? read("extension/js/panel.js") : "";
panelJs.replace(/QKIcons\.svg\(\s*["']([a-z]+)["']/g, function (_, name) {
  usedIcons[name] = true;
  return _;
});
panelJs.replace(/icon:\s*["']([a-z]+)["']/g, function (_, name) {
  usedIcons[name] = true;
  return _;
});
Object.keys(usedIcons).forEach(function (name) {
  if (!definedIcons[name]) fail("icon not defined in design/icons/icons.js: " + name);
});
if (Object.keys(usedIcons).every(function (name) { return definedIcons[name]; })) {
  pass("all " + Object.keys(usedIcons).length + " used icons exist");
}

/* 7. DOM ids referenced by panel.js exist in index.html */
var ids = {};
panelJs.replace(/getElementById\("([^"]+)"\)/g, function (_, id) {
  ids[id] = true;
  return _;
});
Object.keys(ids).forEach(function (id) {
  if (html.indexOf('id="' + id + '"') === -1) fail("panel.js expects #" + id + " but index.html has no such id");
});
if (Object.keys(ids).every(function (id) { return html.indexOf('id="' + id + '"') !== -1; })) {
  pass("all " + Object.keys(ids).length + " element ids used by panel.js exist");
}

/* 8. JavaScript syntax */
["extension/js/csinterface-lite.js", "extension/js/panel.js", "design/icons/icons.js"].forEach(function (rel) {
  if (!exists(rel)) return;
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, rel)], { stdio: "pipe" });
    pass("syntax ok: " + rel);
  } catch (error) {
    fail("syntax error in " + rel + ": " + String(error.stderr || error.message));
  }
});

/* ExtendScript: check syntax through node by copying to a .js temp file */
if (exists("host/quickkit.jsx")) {
  var tmp = path.join(os.tmpdir(), "quickkit-host-syntax-" + process.pid + ".js");
  fs.writeFileSync(tmp, read("host/quickkit.jsx"), "utf8");
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
    pass("syntax ok: host/quickkit.jsx (parsed as ES3-compatible JS)");
  } catch (error) {
    fail("syntax error in host/quickkit.jsx: " + String(error.stderr || error.message));
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

/* 9. manifest is well-formed XML */
if (manifest) {
  try {
    execFileSync("python", ["-c", "import xml.etree.ElementTree as ET,sys;ET.parse(sys.argv[1])", path.join(ROOT, manifestPath)], { stdio: "pipe" });
    pass("manifest parses as XML (python xml.etree)");
  } catch (error) {
    if (String(error.code) === "ENOENT") skip("XML parse check skipped (python not on PATH)");
    else fail("manifest is not well-formed XML: " + String(error.stderr || error.message));
  }
}

/* 10. installer behaviour */
var install = exists("scripts/install.bat") ? read("scripts/install.bat") : "";
var uninstall = exists("scripts/uninstall.bat") ? read("scripts/uninstall.bat") : "";
if (!install) fail("scripts/install.bat missing");
else {
  if (install.indexOf("%APPDATA%\\Adobe\\CEP\\extensions\\QuickKit") !== -1) pass("install.bat targets %APPDATA%\\Adobe\\CEP\\extensions\\QuickKit");
  else fail("install.bat does not target the per-user CEP extensions folder");
  if (install.indexOf("/v PlayerDebugMode") !== -1 && install.indexOf("/t REG_SZ") !== -1) pass("install.bat sets PlayerDebugMode as REG_SZ");
  else fail("install.bat does not set PlayerDebugMode as REG_SZ");
  if (/call :set_debug 9/.test(install) && /call :set_debug 12/.test(install)) pass("install.bat covers CSXS 9 through 12");
  else fail("install.bat does not cover CSXS 9-12");
}
/* cmd.exe only resolves labels reliably in CRLF files; LF-only batches break goto. */
["scripts/install.bat", "scripts/uninstall.bat"].forEach(function (rel) {
  if (!exists(rel)) return;
  var text = fs.readFileSync(path.join(ROOT, rel)).toString("binary");
  var bareLf = text.replace(/\r\n/g, "").indexOf("\n") !== -1;
  if (bareLf) fail(rel + " has bare LF line endings; cmd.exe needs CRLF for labels");
  else pass(rel + " uses CRLF line endings");
});
if (!uninstall) fail("scripts/uninstall.bat missing");
else {
  if (uninstall.indexOf("rmdir /s /q") !== -1 && uninstall.indexOf("CSXS.12") !== -1) pass("uninstall.bat removes the folder and documents the kept registry keys");
  else fail("uninstall.bat does not remove the folder or document registry keys");
}

/* 11. panel -> host API surface */
var hostSource = exists("host/quickkit.jsx") ? read("host/quickkit.jsx") : "";
var definedFns = {};
hostSource.replace(/^function\s+(qk[A-Za-z0-9]+)\s*\(/gm, function (_, name) {
  definedFns[name] = true;
  return _;
});

/* host calls are built as string literals: "qkName(" + args ... */
var usedFns = {};
panelJs.replace(/"(qk[A-Z][A-Za-z0-9]+)\(/g, function (_, name) {
  usedFns[name] = true;
  return _;
});
Object.keys(usedFns).forEach(function (name) {
  if (!definedFns[name]) fail("panel.js calls " + name + "() but host/quickkit.jsx does not define it");
});
if (Object.keys(usedFns).every(function (name) { return definedFns[name]; })) {
  pass("all " + Object.keys(usedFns).length + " host functions used by the panel are defined");
}

/* 12. anchor grid completeness */
var expectedCells = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right"
];
var anchorCells = [];
html.replace(/data-anchor="([a-z-]+)"/g, function (_, cell) {
  anchorCells.push(cell);
  return _;
});
var missingCells = expectedCells.filter(function (cell) { return anchorCells.indexOf(cell) === -1; });
if (missingCells.length) fail("anchor grid is missing: " + missingCells.join(", "));
else pass("anchor grid has all 9 cells");

/* 13. every action button has a tooltip */
var actionButtons = html.match(/<button[^>]*qk-action[^>]*>/g) || [];
var noTip = actionButtons.filter(function (tag) { return tag.indexOf("data-tip=") === -1; });
if (!actionButtons.length) fail("no action buttons found in index.html");
else if (noTip.length) fail(noTip.length + " action button(s) without data-tip");
else pass("all " + actionButtons.length + " action buttons have tooltips");

/* 14. text panel matches the host presets */
var hostKinds = [];
var kindsMatch = /var QK_TEXT_KINDS = \[([^\]]+)\]/.exec(hostSource);
if (kindsMatch) {
  kindsMatch[1].replace(/"([a-z]+)"/g, function (_, kind) {
    hostKinds.push(kind);
    return _;
  });
}

var textPanelMatch = /<section[^>]*id="qk-panel-text"[\s\S]*?<\/section>/.exec(html);
if (!hostKinds.length) {
  fail("host QK_TEXT_KINDS is missing or empty");
} else if (!textPanelMatch) {
  fail("text panel #qk-panel-text is missing");
} else {
  var textPanel = textPanelMatch[0];
  var panelKinds = [];
  textPanel.replace(/data-text-preset="([a-z]+)"/g, function (_, kind) {
    if (panelKinds.indexOf(kind) === -1) panelKinds.push(kind);
    return _;
  });

  var missingKinds = hostKinds.filter(function (kind) { return panelKinds.indexOf(kind) === -1; });
  var extraKinds = panelKinds.filter(function (kind) { return hostKinds.indexOf(kind) === -1; });
  if (missingKinds.length) fail("text panel is missing presets: " + missingKinds.join(", "));
  else if (extraKinds.length) fail("text panel offers presets the host does not know: " + extraKinds.join(", "));
  else pass("text panel offers all " + hostKinds.length + " host presets");

  if (textPanel.indexOf('id="qk-text-stage"') === -1) fail("text panel has no preview stage");
  else pass("text panel has a preview stage");

  if (textPanel.indexOf('id="qk-text-apply"') === -1) fail("text panel has no apply button");
  else pass("text panel has an apply button");

  if (textPanel.indexOf('id="qk-text-in"') === -1 || textPanel.indexOf('id="qk-text-out"') === -1) {
    fail("text panel is missing the in/out edge checkboxes");
  } else {
    pass("text panel has both edge checkboxes");
  }
}

/* 15. manifest and panel versions agree */
var bundleVersion = /ExtensionBundleVersion="([0-9.]+)"/.exec(manifest);
var panelVersion = /var VERSION = "([0-9.]+)"/.exec(panelJs);
if (!bundleVersion || !panelVersion) {
  fail("could not read the manifest or panel version");
} else if (bundleVersion[1] !== panelVersion[1]) {
  fail("manifest version " + bundleVersion[1] + " does not match panel VERSION " + panelVersion[1]);
} else {
  pass("manifest and panel both report version " + panelVersion[1]);
}

/* 16. panel test suites exist */
["tests/host-logic.test.js"].forEach(function (rel) {
  if (!exists(rel)) fail("missing test suite: " + rel);
});
if (exists("tests/host-logic.test.js")) pass("host logic test suite is present");

/* report */
passes.forEach(function (message) { console.log("PASS  " + message); });
skips.forEach(function (message) { console.log("SKIP  " + message); });
fails.forEach(function (message) { console.log("FAIL  " + message); });
console.log("");
console.log(passes.length + " passed, " + fails.length + " failed, " + skips.length + " skipped");
process.exit(fails.length ? 1 : 0);
