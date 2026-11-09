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
["extension/js/csinterface-lite.js", "extension/js/panel.js", "extension/js/library-core.js", "extension/js/library-io.js", "extension/js/preview-core.js", "extension/js/preview-node.js", "design/icons/icons.js"].forEach(function (rel) {
  if (!exists(rel)) return;
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, rel)], { stdio: "pipe" });
    pass("syntax ok: " + rel);
  } catch (error) {
    fail("syntax error in " + rel + ": " + String(error.stderr || error.message));
  }
});

/* ExtendScript: Node can parse the file, but it is NOT an ES3 parser. The
   reserved-word scan below is the check that catches what After Effects
   rejects (for example `short:` at line 1503). */
function es3ReservedHits(source) {
  var reserved = {};
  "abstract boolean byte char class const debugger double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile let yield".split(" ").forEach(function (word) {
    reserved[word] = true;
  });
  var hits = [];
  var i = 0;
  var line = 1;
  var length = source.length;
  var backslash = String.fromCharCode(92);

  while (i < length) {
    var c = source.charAt(i);
    var next = source.charAt(i + 1);

    if (c === "/" && next === "/") {
      while (i < length && source.charAt(i) !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < length && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")) {
        if (source.charAt(i) === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "\"" || c === "'") {
      var quote = c;
      i++;
      while (i < length) {
        if (source.charAt(i) === backslash) {
          i += 2;
          continue;
        }
        if (source.charAt(i) === quote) {
          i++;
          break;
        }
        if (source.charAt(i) === "\n") line++;
        i++;
      }
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      var start = i + 1;
      while (start < length && /[A-Za-z0-9_$]/.test(source.charAt(start))) start++;
      var word = source.substring(i, start);
      if (Object.prototype.hasOwnProperty.call(reserved, word)) hits.push({ line: line, word: word });
      i = start;
      continue;
    }
    if (c === "\n") line++;
    i++;
  }
  return hits;
}

if (exists("host/quickkit.jsx")) {
  var tmp = path.join(os.tmpdir(), "quickkit-host-syntax-" + process.pid + ".js");
  fs.writeFileSync(tmp, read("host/quickkit.jsx"), "utf8");
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
    pass("syntax ok: host/quickkit.jsx (Node parser)");
  } catch (error) {
    fail("syntax error in host/quickkit.jsx: " + String(error.stderr || error.message));
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }

  var probe = es3ReservedHits("var x = { short: 1 }; // short\nvar s = 'class';") ;
  if (probe.length !== 1 || probe[0].word !== "short") {
    fail("ES3 guard self-test failed: it must see code but ignore strings and comments");
  } else {
    pass("ES3 guard self-test sees code but ignores strings and comments");
  }

  var es3Hits = es3ReservedHits(read("host/quickkit.jsx"));
  if (es3Hits.length) {
    fail(
      "host/quickkit.jsx uses ExtendScript reserved word(s): " +
      es3Hits.map(function (hit) { return hit.word + " at line " + hit.line; }).join(", ")
    );
  } else {
    pass("host/quickkit.jsx uses no ExtendScript reserved words");
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

/* 14. text panel matches the data-driven engine (Part 6C) */
var textPanelMatch = /<section[^>]*id="qk-panel-text"[\s\S]*?<\/section>/.exec(html);
var enginePath = path.join(ROOT, "extension", "js", "text-presets.js");
var textEngine = exists("extension/js/text-presets.js") ? require(enginePath) : null;

if (!textEngine) {
  fail("extension/js/text-presets.js is missing, so there is no preset engine");
} else {
  if (textEngine.PRESETS.length >= 40) pass("text preset engine has " + textEngine.PRESETS.length + " presets");
  else fail("text preset engine has only " + textEngine.PRESETS.length + " presets (needs 40)");

  var missingCategories = textEngine.CATEGORIES.filter(function (name) {
    return !textEngine.PRESETS.some(function (preset) { return preset.category === name; });
  });
  if (missingCategories.length) fail("preset categories with no presets: " + missingCategories.join(", "));
  else pass("all " + textEngine.CATEGORIES.length + " preset categories are populated");

  var edgesOk = textEngine.PRESETS.every(function (preset) {
    return preset.edges === "in" || preset.edges === "out" || preset.edges === "both";
  });
  if (!edgesOk) fail("a preset has an in/out/both value the host does not know");
  else pass("every preset declares in, out or both");

  var exposed = {};
  var paramProblems = [];
  textEngine.PRESETS.forEach(function (preset) {
    ["duration", "delay", "easing"].forEach(function (key) {
      if (!preset.expose || preset.expose.indexOf(key) === -1) paramProblems.push(preset.id + " does not expose " + key);
    });
    (preset.expose || []).forEach(function (key) {
      exposed[key] = true;
      if (!textEngine.PARAMS[key]) paramProblems.push(preset.id + " exposes unknown parameter " + key);
    });
    if (!preset.note) paramProblems.push(preset.id + " has no note");
    if (!preset.name) paramProblems.push(preset.id + " has no name");
  });
  if (paramProblems.length) fail(paramProblems.slice(0, 3).join("; "));
  else pass("every preset exposes duration, delay and easing, and names its parameters");

  var missingParams = textEngine.PARAM_ORDER.filter(function (key) { return !exposed[key]; });
  if (missingParams.length) fail("parameters never exposed by any preset: " + missingParams.join(", "));
  else pass("every parameter is exposed by at least one preset");

  var unplanned = textEngine.PRESETS.filter(function (preset) {
    return !textEngine.plan(preset.id, null);
  });
  if (unplanned.length) fail("presets that compile to no plan: " + unplanned.map(function (p) { return p.id; }).join(", "));
  else pass("every preset compiles to a key plan");

  var ids = {};
  var duplicate = "";
  textEngine.PRESETS.forEach(function (preset) {
    if (ids[preset.id]) duplicate = preset.id;
    ids[preset.id] = true;
  });
  if (duplicate) fail("duplicate preset id: " + duplicate);
  else pass("preset ids are unique");

  if (!textPanelMatch) fail("text panel #qk-panel-text is missing");
  else {
    var textPanel = textPanelMatch[0];
    if (textPanel.indexOf('id="qk-text-presets"') === -1) fail("text panel has no preset grid container");
    else pass("text panel renders the preset grid from the engine");

    if (textPanel.indexOf('id="qk-text-category"') === -1) fail("text panel has no category filter");
    else pass("text panel has a category filter");

    if (textPanel.indexOf('id="qk-text-stage"') === -1) fail("text panel has no preview stage");
    else pass("text panel has a preview stage");

    if (textPanel.indexOf('id="qk-text-apply"') === -1) fail("text panel has no apply button");
    else pass("text panel has an apply button");

    if (textPanel.indexOf('id="qk-text-mogrt"') === -1 || textPanel.indexOf('id="qk-text-mogrt-all"') === -1) {
      fail("text panel is missing a MOGRT export button");
    } else {
      pass("text panel has single and batch MOGRT export buttons");
    }

    if (textPanel.indexOf('id="qk-text-in"') === -1 || textPanel.indexOf('id="qk-text-out"') === -1) {
      fail("text panel is missing the in/out edge checkboxes");
    } else {
      pass("text panel has both edge checkboxes");
    }

    ["qk-text-stagger", "qk-text-overshoot", "qk-text-direction"].forEach(function (id) {
      if (textPanel.indexOf('id="' + id + '"') === -1) fail("text panel is missing the " + id + " control");
    });
    if (
      textPanel.indexOf('id="qk-text-stagger"') !== -1 &&
      textPanel.indexOf('id="qk-text-overshoot"') !== -1 &&
      textPanel.indexOf('id="qk-text-direction"') !== -1
    ) {
      pass("text panel exposes direction, stagger and overshoot");
    }

    if (html.indexOf('src="js/text-presets.js"') === -1) fail("index.html does not load text-presets.js");
    else pass("index.html loads the preset engine");

    if (!/function qkTextPresetApply\(/.test(hostSource)) fail("host has no qkTextPresetApply()");
    else pass("host defines qkTextPresetApply()");

    if (!/function qkTextPresetMogrt\(/.test(hostSource)) fail("host has no qkTextPresetMogrt()");
    else pass("host defines qkTextPresetMogrt()");
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

/* 17. silence cutter panel (Part 5) */
var silencePanel = /<section[^>]*id="qk-panel-silence"[\s\S]*?<\/section>/.exec(html);
if (!silencePanel) {
  fail("silence panel #qk-panel-silence is missing");
} else {
  pass("silence panel is present");

  var silenceTab = /id:\s*"silence",[\s\S]{0,240}?panelId:\s*"silence"/.exec(panelJs);
  if (!silenceTab) fail("panel.js silence tab is not linked to panelId \"silence\"");
  else pass("silence tab is linked to its panel element");

  if (panelJs.indexOf("if (id === \"silence\") silenceOnShow();") === -1) {
    fail("selectTab never calls silenceOnShow()");
  } else {
    pass("selectTab refreshes the silence panel when the tab opens");
  }

  if (!/bindSilence\(\);/.test(panelJs)) fail("boot() never calls bindSilence()");
  else pass("boot() binds the silence controls");

  ["qk-silence-mode-delete", "qk-silence-mode-mark", "qk-silence-mode-mute"].forEach(function (id) {
    if (silencePanel[0].indexOf('id="' + id + '"') === -1) fail("silence panel is missing mode " + id);
  });
  if (["qk-silence-mode-delete", "qk-silence-mode-mark", "qk-silence-mode-mute"].every(function (id) {
    return silencePanel[0].indexOf('id="' + id + '"') !== -1;
  })) {
    pass("silence panel offers delete, mark and mute modes");
  }

  if (silencePanel[0].indexOf('id="qk-silence-wave"') === -1) fail("silence panel has no waveform canvas");
  else pass("silence panel has a waveform preview");

  if (silencePanel[0].indexOf('id="qk-silence-cancel"') === -1) fail("silence panel has no cancel button");
  else pass("silence panel has a cancel button");
}

/* 18. every silence id used by the panel exists in index.html */
var silenceIdsUsed = {};
panelJs.replace(/(qk-silence-[a-z0-9-]+)/g, function (_, id) {
  if (id.charAt(id.length - 1) !== "-") silenceIdsUsed[id] = true;
  return _;
});
var silenceIdsMissing = Object.keys(silenceIdsUsed).filter(function (id) {
  return html.indexOf('id="' + id + '"') === -1;
});
if (silenceIdsMissing.length) fail("panel.js uses silence ids that index.html does not have: " + silenceIdsMissing.join(", "));
else pass("all " + Object.keys(silenceIdsUsed).length + " silence ids used by the panel exist in index.html");

/* 19. the Node side is a required module, never a script tag */
if (!exists("extension/js/ffmpeg-node.js")) {
  fail("extension/js/ffmpeg-node.js is missing");
} else {
  pass("ffmpeg-node.js is present");

  var nodeCheck = 0;
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, "extension/js/ffmpeg-node.js")], { stdio: "pipe" });
  } catch (eCheck) {
    nodeCheck = 1;
  }
  if (nodeCheck) fail("extension/js/ffmpeg-node.js does not parse");
  else pass("extension/js/ffmpeg-node.js parses");

  if (html.indexOf("ffmpeg-node.js") !== -1) fail("index.html loads ffmpeg-node.js; it must only be require()d in CEP");
  else pass("ffmpeg-node.js is not loaded as a page script");

  if (panelJs.indexOf("ffmpeg-node.js") === -1) fail("panel.js never requires ffmpeg-node.js");
  else pass("panel.js requires ffmpeg-node.js");

  if (panelJs.indexOf("child_process") !== -1) fail("panel.js must not start processes itself; that belongs in ffmpeg-node.js");
  else pass("process handling stays inside ffmpeg-node.js");

  if (panelJs.indexOf("require(") === -1) fail("panel.js never calls require, so the module can never load");
  else pass("panel.js loads the Node module with require()");
}

/* 20. CEP is told to provide Node, and Premiere is a listed host */
if (manifest.indexOf("<Parameter>--enable-nodejs</Parameter>") === -1) {
  fail("manifest.xml does not pass --enable-nodejs, so require() fails inside CEP");
} else if (manifest.indexOf("<Parameter>--mixed-context</Parameter>") === -1) {
  fail("manifest.xml does not pass --mixed-context");
} else {
  pass("manifest.xml enables Node for the panel");
}
if (manifest.indexOf('<Host Name="PPRO"') === -1) fail("manifest.xml no longer lists Premiere Pro (PPRO)");
else pass("manifest.xml lists Premiere Pro");

/* 21. bundled ffmpeg notice and install path */
if (!exists("bin/ffmpeg/NOTICE.txt")) {
  fail("bin/ffmpeg/NOTICE.txt is missing; the bundled binary has no licence notice");
} else {
  var notice = read("bin/ffmpeg/NOTICE.txt");
  if (!/GNU General Public License/.test(notice) || !/GNU Lesser General Public License/.test(notice)) {
    fail("bin/ffmpeg/NOTICE.txt does not cover both the GPL and LGPL builds");
  } else if (notice.indexOf("ffmpeg.org") === -1) {
    fail("bin/ffmpeg/NOTICE.txt does not point at the FFmpeg source");
  } else {
    pass("bin/ffmpeg/NOTICE.txt covers GPL, LGPL and the source offer");
  }
}
var ignore = exists(".gitignore") ? read(".gitignore") : "";
if (ignore.indexOf("bin/ffmpeg/*.exe") === -1) fail(".gitignore does not exclude the ffmpeg binary");
else pass(".gitignore keeps the ffmpeg binary out of the repository");

if (exists("scripts/fetch-ffmpeg.ps1")) pass("scripts/fetch-ffmpeg.ps1 is present");
else fail("scripts/fetch-ffmpeg.ps1 is missing");

/* 22. silence entry points exist in the host */
["qkSilenceTargets", "qkSilenceSegments", "qkSilenceMarkers", "qkSilenceClearMarkers", "qkSilenceApply"].forEach(function (name) {
  if (!definedFns[name]) fail("host is missing " + name + "()");
});
if (["qkSilenceTargets", "qkSilenceSegments", "qkSilenceMarkers", "qkSilenceClearMarkers", "qkSilenceApply"].every(function (name) {
  return definedFns[name];
})) {
  pass("host defines all 5 silence entry points");
}

if (exists("tests/ffmpeg.test.js")) pass("ffmpeg test suite is present");
else fail("tests/ffmpeg.test.js is missing");

/* 23. bridge panel (Part 6) */
var bridgePanel = /<section[^>]*id="qk-panel-bridge"[\s\S]*?<\/section>/.exec(html);
if (!bridgePanel) {
  fail("bridge panel #qk-panel-bridge is missing");
} else {
  pass("bridge panel is present");

  var bridgeTab = /id:\s*"bridge",[\s\S]{0,240}?panelId:\s*"bridge"/.exec(panelJs);
  if (!bridgeTab) fail("panel.js bridge tab is not linked to panelId \"bridge\"");
  else pass("bridge tab is linked to its panel element");

  if (panelJs.indexOf("if (id === \"bridge\") bridgeOnShow();") === -1) {
    fail("selectTab never calls bridgeOnShow()");
  } else {
    pass("selectTab refreshes the bridge panel when the tab opens");
  }

  if (!/bindBridge\(\);/.test(panelJs)) fail("boot() never calls bindBridge()");
  else pass("boot() binds the bridge controls");

  if (bridgePanel[0].indexOf('id="qk-bridge-send"') === -1) fail("bridge panel has no Send to After Effects button");
  else pass("bridge panel has a Send to After Effects button");

  if (bridgePanel[0].indexOf('id="qk-bridge-render"') === -1) fail("bridge panel has no Send back render button");
  else pass("bridge panel has a Send back render button");

  if (bridgePanel[0].indexOf('id="qk-bridge-cancel"') === -1) fail("bridge panel has no cancel button");
  else pass("bridge panel can cancel a render");

  if (bridgePanel[0].indexOf('id="qk-bridge-steps"') === -1) fail("bridge panel has no step by step list");
  else pass("bridge panel shows step by step status");

  if (bridgePanel[0].indexOf("not Dynamic Link") === -1) fail("bridge panel does not say it is a file handoff, not Dynamic Link");
  else pass("bridge panel is honest about the file handoff");

  ["qk-bridge-pending", "qk-bridge-returns", "qk-bridge-scope", "qk-bridge-format"].forEach(function (id) {
    if (bridgePanel[0].indexOf('id="' + id + '"') === -1) fail("bridge panel is missing " + id);
  });
  if (["qk-bridge-pending", "qk-bridge-returns", "qk-bridge-scope", "qk-bridge-format"].every(function (id) {
    return bridgePanel[0].indexOf('id="' + id + '"') !== -1;
  })) {
    pass("bridge panel lists handoffs, renders, clip scope and format");
  }
}

/* 24. every bridge id used by the panel exists in index.html.
   `qk-bridge-step*` and `qk-bridge-row*` are CSS class names, not ids, so they
   are skipped; every other qk-bridge-* token in panel.js must be a real id. */
var bridgeIdsUsed = {};
var bridgeCssClasses = ["qk-bridge-step", "qk-bridge-row"];
panelJs.replace(/(qk-bridge-[a-z0-9-]+)/g, function (_, id) {
  if (id.charAt(id.length - 1) === "-") return _;
  if (bridgeCssClasses.indexOf(id) !== -1) return _;
  bridgeIdsUsed[id] = true;
  return _;
});
var bridgeIdsMissing = Object.keys(bridgeIdsUsed).filter(function (id) {
  return html.indexOf('id="' + id + '"') === -1;
});
if (bridgeIdsMissing.length) fail("panel.js uses bridge ids that index.html does not have: " + bridgeIdsMissing.join(", "));
else pass("all " + Object.keys(bridgeIdsUsed).length + " bridge ids used by the panel exist in index.html");

/* 25. render-node.js is a required module, never a script tag */
if (!exists("extension/js/render-node.js")) {
  fail("extension/js/render-node.js is missing");
} else {
  pass("render-node.js is present");

  var renderCheck = 0;
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, "extension/js/render-node.js")], { stdio: "pipe" });
  } catch (eRenderCheck) {
    renderCheck = 1;
  }
  if (renderCheck) fail("extension/js/render-node.js does not parse");
  else pass("extension/js/render-node.js parses");

  if (html.indexOf("render-node.js") !== -1) fail("index.html loads render-node.js; it must only be require()d in CEP");
  else pass("render-node.js is not loaded as a page script");

  if (panelJs.indexOf("render-node.js") === -1) fail("panel.js never requires render-node.js");
  else pass("panel.js requires render-node.js");

  var renderNode = read("extension/js/render-node.js");
  if (renderNode.indexOf("child_process") === -1) fail("render-node.js never starts aerender");
  else pass("render-node.js owns the aerender process");

  if (panelJs.indexOf("child_process") !== -1) fail("panel.js must not start processes itself; that belongs in render-node.js");
  else pass("bridge process handling stays inside render-node.js");
}

/* 26. bridge entry points exist in the host */
var bridgeFns = [
  "qkBridgeSendToAe",
  "qkBridgeImport",
  "qkBridgePrepareRender",
  "qkBridgeFinishRender",
  "qkBridgePlaceReturn",
  "qkBridgeList",
  "qkBridgeInfo"
];
bridgeFns.forEach(function (name) {
  if (!definedFns[name]) fail("host is missing " + name + "()");
});
if (bridgeFns.every(function (name) {
  return definedFns[name];
})) {
  pass("host defines all " + bridgeFns.length + " bridge entry points");
}

/* 27. the README documents the bridge and its limits */
var readmeText = exists("README.md") ? read("README.md") : "";
if (!readmeText) fail("README.md is missing");
else if (readmeText.indexOf("Dynamic Link") === -1) fail("README.md does not explain that the bridge is not Dynamic Link");
else if (!/bridge/i.test(readmeText)) fail("README.md has no bridge section");
else pass("README.md documents the bridge and its Dynamic Link limits");

if (exists("tests/render.test.js")) pass("render test suite is present");
else fail("tests/render.test.js is missing");

/* 28. library engine and store (Part 6A) */
var libPanel = /<section[^>]*id="qk-panel-library"[\s\S]*?<\/section>/.exec(html);
var libCoreJs = exists("extension/js/library-core.js") ? read("extension/js/library-core.js") : "";
var libIoJs = exists("extension/js/library-io.js") ? read("extension/js/library-io.js") : "";

if (!libCoreJs) fail("extension/js/library-core.js is missing");
else if (!libIoJs) fail("extension/js/library-io.js is missing");
else pass("library engine and store are present");

if (!libPanel) {
  fail("library panel #qk-panel-library is missing");
} else {
  pass("library panel is present");

  var libTab = /id:\s*"library",[\s\S]{0,260}?panelId:\s*"library"/.exec(panelJs);
  if (!libTab) fail("panel.js library tab is not linked to panelId \"library\"");
  else pass("library tab is linked to its panel element");

  if (panelJs.indexOf('if (id === "library") libOnShow();') === -1) {
    fail("selectTab never calls libOnShow()");
  } else {
    pass("selectTab refreshes the library when the tab opens");
  }

  if (!/bindLibrary\(\);/.test(panelJs)) fail("boot() never calls bindLibrary()");
  else pass("boot() binds the library controls");

  if (!/renderLibrary\(\);/.test(panelJs)) fail("boot() never renders the library");
  else pass("boot() renders the library");

  /* the engine is a page script; the store touches fs and must be require()d */
  if (html.indexOf('<script src="js/library-core.js"></script>') === -1) {
    fail("index.html does not load js/library-core.js as a page script");
  } else {
    pass("index.html loads the library engine");
  }
  if (html.indexOf("library-io.js") !== -1) fail("index.html loads library-io.js; it must only be require()d in CEP");
  else pass("library-io.js is not loaded as a page script");
  if (panelJs.indexOf("library-io.js") === -1) fail("panel.js never requires library-io.js");
  else pass("panel.js requires library-io.js");
  if (panelJs.indexOf("require(\"fs\")") !== -1) fail("panel.js requires fs; disk access belongs in library-io.js");
  else pass("disk access stays inside library-io.js");

  /* every control the library UI promises is in the markup */
  var libControls = [
    "qk-lib-search",
    "qk-lib-type",
    "qk-lib-host",
    "qk-lib-category",
    "qk-lib-sort",
    "qk-lib-crumbs",
    "qk-lib-collections",
    "qk-lib-new-folder",
    "qk-lib-folders",
    "qk-lib-count",
    "qk-lib-view-grid",
    "qk-lib-view-list",
    "qk-lib-thumb",
    "qk-lib-items",
    "qk-lib-empty",
    "qk-lib-export",
    "qk-lib-import",
    "qk-lib-repair"
  ];
  var libMissingControls = libControls.filter(function (id) {
    return libPanel[0].indexOf('id="' + id + '"') === -1;
  });
  if (libMissingControls.length) fail("library panel is missing: " + libMissingControls.join(", "));
  else pass("library panel has all " + libControls.length + " controls (search, filters, folders, views, packs, repair)");

  if (libPanel[0].indexOf("qk-lib-empty") === -1) fail("library panel has no empty state");
  if (html.indexOf('id="qk-lib-dialog"') === -1) fail("index.html has no library dialog");
  if (html.indexOf('id="qk-lib-menu"') === -1) fail("index.html has no library context menu");
}

/* 29. the library engine remembers the Part 4 preset ids */
if (libCoreJs) {
  ["migratePresets", "repair", "packManifest", "planImport", "applyImport", "query"].forEach(function (name) {
    if (!new RegExp("function\\s+" + name + "\\s*\\(").test(libCoreJs)) fail("library-core.js is missing " + name + "()");
  });
  if (["migratePresets", "repair", "packManifest", "planImport", "applyImport", "query"].every(function (name) {
    return new RegExp("function\\s+" + name + "\\s*\\(").test(libCoreJs);
  })) {
    pass("library-core.js has migration, repair, query and pack functions");
  }

  if (libCoreJs.indexOf("quickkit-library") === -1) fail("library-core.js does not name the library format");
  else pass("library-core.js versions its index format");

  if (!/schemaVersion/.test(libCoreJs)) fail("library-core.js has no schemaVersion");
  else pass("library-core.js carries a schema version");
}

/* 30. every library id used by the panel exists in index.html */
var libIdsUsed = {};
panelJs.replace(/getElementById\("(qk-lib-[a-z0-9-]+)"\)/g, function (_, id) {
  libIdsUsed[id] = true;
  return _;
});
var libIdsMissing = Object.keys(libIdsUsed).filter(function (id) {
  return html.indexOf('id="' + id + '"') === -1;
});
if (libIdsMissing.length) fail("panel.js uses library ids that index.html does not have: " + libIdsMissing.join(", "));
else pass("all " + Object.keys(libIdsUsed).length + " library ids used by the panel exist in index.html");

/* icons used only through the library helpers are not caught by section 6 */
var libIcons = {};
panelJs.replace(/libIconEl\("([a-z]+)"/g, function (_, name) {
  libIcons[name] = true;
  return _;
});
panelJs.replace(/if \(type === "[a-z-]+"\) return "([a-z]+)";/g, function (_, name) {
  libIcons[name] = true;
  return _;
});
var libIconsMissing = Object.keys(libIcons).filter(function (name) {
  return !definedIcons[name];
});
if (libIconsMissing.length) fail("library uses icons that icons.js does not define: " + libIconsMissing.join(", "));
else pass("all " + Object.keys(libIcons).length + " icons used by the library exist");

/* 31. library tests and the manual checklist ship with the part */
if (exists("tests/library.test.js")) pass("library test suite is present");
else fail("tests/library.test.js is missing");
if (exists("docs/manual-test-checklist-part6a.md")) pass("Part 6A manual checklist is present");
else fail("docs/manual-test-checklist-part6a.md is missing");
if (/library/i.test(readmeText) && /qkpack/i.test(readmeText)) pass("README documents the library and packs");
else fail("README does not document the library and .qkpack packs");

/* 32. preview pane, preview files and generation (Part 6B) */
var previewCoreJs = exists("extension/js/preview-core.js") ? read("extension/js/preview-core.js") : "";
var previewNodeJs = exists("extension/js/preview-node.js") ? read("extension/js/preview-node.js") : "";
var hostJs = exists("host/quickkit.jsx") ? read("host/quickkit.jsx") : "";

if (!previewCoreJs) fail("extension/js/preview-core.js is missing");
else if (!previewNodeJs) fail("extension/js/preview-node.js is missing");
else pass("preview core and encoder are present");

if (previewCoreJs) {
  ["sampleAt", "approxFor", "planGeneration", "formatClock", "nextSpeed", "easingFn"].forEach(function (name) {
    if (!new RegExp("function\\s+" + name + "\\s*\\(").test(previewCoreJs)) {
      fail("preview-core.js is missing " + name + "()");
    }
  });
  if (/function\s+sampleAt\s*\(/.test(previewCoreJs) && /function\s+planGeneration\s*\(/.test(previewCoreJs)) {
    pass("preview-core.js has the sampling and batch-planning functions");
  }
}

if (previewNodeJs && previewNodeJs.indexOf("libx264") === -1) fail("preview-node.js does not encode h.264");
else if (previewNodeJs) pass("preview-node.js encodes the preview clip");

if (html.indexOf('src="js/preview-core.js"') === -1) fail("index.html does not load preview-core.js");
else pass("index.html loads preview-core.js");

/* Node-only modules must never reach the page: they require fs and spawn. */
var leakedModules = ["js/preview-node.js", "js/library-io.js", "js/ffmpeg-node.js"].filter(function (rel) {
  return html.indexOf('src="' + rel + '"') !== -1;
});
if (leakedModules.length) fail("index.html loads Node-only modules: " + leakedModules.join(", "));
else pass("Node-only modules stay out of index.html");

var previewIds = [
  "qk-lib-preview", "qk-lib-preview-video", "qk-lib-preview-canvas", "qk-lib-preview-scrub",
  "qk-lib-preview-settings", "qk-lib-preview-play", "qk-lib-preview-apply", "qk-lib-preview-generate"
];
var previewIdsMissing = previewIds.filter(function (id) {
  return html.indexOf('id="' + id + '"') === -1;
});
if (previewIdsMissing.length) fail("index.html is missing preview ids: " + previewIdsMissing.join(", "));
else pass("the preview pane has its stage, transport and action ids");

if (html.indexOf('id="qk-lib-preview"') > html.indexOf('id="qk-lib-items"')) {
  fail("the preview pane sits below the item grid; it must stay pinned above it");
} else if (html.indexOf('id="qk-lib-preview"') >= 0 && html.indexOf('id="qk-lib-items"') >= 0) {
  pass("the preview pane is pinned above the item grid");
}

if (hostJs) {
  if (!/function\s+qkLibraryApply\s*\(/.test(hostJs)) fail("host has no qkLibraryApply()");
  if (!/function\s+qkPreviewGenerate\s*\(/.test(hostJs)) fail("host has no qkPreviewGenerate()");
  if (/function\s+qkLibraryApply\s*\(/.test(hostJs) && /function\s+qkPreviewGenerate\s*\(/.test(hostJs)) {
    pass("host exposes qkLibraryApply() and qkPreviewGenerate()");
  }

  var generateStart = hostJs.indexOf("function qkPreviewGenerate");
  if (generateStart >= 0) {
    var generateBody = hostJs.slice(generateStart);
    if (generateBody.indexOf("queue.render()") === -1) {
      fail("qkPreviewGenerate does not render through queue.render()");
    } else if (generateBody.indexOf("aerender") !== -1) {
      fail("qkPreviewGenerate uses aerender; the Render Queue must render the open project");
    } else {
      pass("qkPreviewGenerate renders the open project with the Render Queue, never aerender");
    }
  }
}

["play", "pause"].forEach(function (name) {
  if (!definedIcons[name]) fail("the preview transport needs the \"" + name + "\" icon");
});
if (definedIcons.play && definedIcons.pause) pass("play and pause icons exist");

var tokensCss = exists("design/tokens.css") ? read("design/tokens.css") : "";
if (tokensCss.indexOf("--qk-lib-preview-stage-h") === -1) fail("tokens.css has no preview stage height token");
else pass("tokens.css carries the preview pane tokens");

if (exists("tests/preview.test.js")) pass("preview test suite is present");
else fail("tests/preview.test.js is missing");
if (exists("docs/manual-test-checklist-part6b.md")) pass("Part 6B manual checklist is present");
else fail("docs/manual-test-checklist-part6b.md is missing");
if (/preview/i.test(readmeText) && /ffmpeg/i.test(readmeText)) pass("README documents previews and the bundled ffmpeg");
else fail("README does not document previews and the bundled ffmpeg");

/* 21. Premiere library features (Part 6D) */
var recipePath = path.join(ROOT, "extension", "js", "pr-recipes.js");
var recipeEngine = exists("extension/js/pr-recipes.js") ? require(recipePath) : null;

if (!recipeEngine) {
  fail("extension/js/pr-recipes.js is missing, so there is no Premiere recipe engine");
} else {
  if (recipeEngine.RECIPES.length === 18) pass("recipe engine has 18 recipes");
  else fail("recipe engine has " + recipeEngine.RECIPES.length + " recipes (needs 18)");

  var recipeIds = {};
  var duplicateRecipe = "";
  var recipeProblems = [];
  recipeEngine.RECIPES.forEach(function (recipe) {
    if (recipeIds[recipe.id]) duplicateRecipe = recipe.id;
    recipeIds[recipe.id] = true;
    if (!recipe.note) recipeProblems.push(recipe.id + " has no note");
    if (recipeEngine.CATEGORIES.indexOf(recipe.category) === -1) recipeProblems.push(recipe.id + " has an unknown category");
    if (!recipeEngine.defaultPlan(recipe.id)) recipeProblems.push(recipe.id + " compiles to no plan");
  });
  if (duplicateRecipe) fail("duplicate recipe id: " + duplicateRecipe);
  else pass("recipe ids are unique");
  if (recipeProblems.length) fail(recipeProblems.slice(0, 3).join("; "));
  else pass("every recipe has a note, a known category and a plan");

  var recipeCategories = recipeEngine.categories().filter(function (entry) { return entry.count > 0; });
  if (recipeCategories.length === 4) pass("all 4 recipe categories are populated");
  else fail("only " + recipeCategories.length + " recipe categories have recipes");
}

if (html.indexOf('src="js/pr-recipes.js"') === -1) fail("index.html does not load pr-recipes.js");
else pass("index.html loads the Premiere recipe engine");

if (panelJs.indexOf(".qkrecipe.json") === -1) fail("panel never seeds .qkrecipe.json items");
else pass("panel seeds recipes as .qkrecipe.json library items");
if (panelJs.indexOf("qk.recipes.seeded") === -1) fail("panel has no recipe seed key");
else pass("panel remembers which recipes it seeded");

["qkPrContext", "qkPrRecipeApply", "qkPrMogrtInsert", "qkPrMogrtParams", "qkPrMogrtSetText", "qkPrMogrtSetParam", "qkPrBins"].forEach(function (name) {
  if (!new RegExp("function\\s+" + name + "\\s*\\(").test(hostSource)) fail("host has no " + name + "()");
});
if (["qkPrContext", "qkPrRecipeApply", "qkPrMogrtInsert", "qkPrMogrtParams", "qkPrMogrtSetText", "qkPrMogrtSetParam", "qkPrBins"].every(function (name) {
  return new RegExp("function\\s+" + name + "\\s*\\(").test(hostSource);
})) {
  pass("host defines all 7 Premiere library entry points");
}

["importMGT(", "getMGTComponent", "AE.ADBE Motion", "AE.ADBE Opacity", "areKeyframesSupported", "setInterpolationTypeAtKey", "isLocked", "createBin", "moveBin", "getCurrentProjectViewSelection"].forEach(function (needle) {
  if (hostSource.indexOf(needle) === -1) fail("host never uses " + needle);
});
if (["importMGT(", "getMGTComponent", "AE.ADBE Motion", "AE.ADBE Opacity", "areKeyframesSupported", "setInterpolationTypeAtKey", "isLocked", "createBin", "moveBin", "getCurrentProjectViewSelection"].every(function (needle) {
  return hostSource.indexOf(needle) !== -1;
})) {
  pass("host uses the documented Premiere API (MOGRT, keyframes, locks, bins)");
}

["qk-lib-preview-target", "qk-lib-preview-mogrt", "qk-lib-bins", "qk-lib-bins-create", "qk-lib-bins-sort", "qk-lib-bins-rename"].forEach(function (id) {
  if (html.indexOf('id="' + id + '"') === -1) fail("index.html is missing #" + id);
});
if (["qk-lib-preview-target", "qk-lib-preview-mogrt", "qk-lib-bins", "qk-lib-bins-create", "qk-lib-bins-sort", "qk-lib-bins-rename"].every(function (id) {
  return html.indexOf('id="' + id + '"') !== -1;
})) {
  pass("the library pane has targeting, MOGRT controls and the bin organizer");
}

if (panelJs.indexOf('"Apply recipe"') === -1) fail("panel never labels the Premiere recipe action");
else pass("panel labels the Premiere recipe action");
if (panelJs.indexOf('"Insert at playhead"') === -1) fail("panel never labels the MOGRT insert action");
else pass("panel labels the MOGRT insert action");

var toolsCss = exists("extension/css/tools.css") ? read("extension/css/tools.css") : "";
if (toolsCss.indexOf(".qk-lib-card.is-other-host") === -1) fail("unsupported library items are not dimmed");
else pass("library items for the other app are dimmed");

if (exists("docs/premiere-6d-api.md")) {
  var apiDoc = read("docs/premiere-6d-api.md");
  if (apiDoc.indexOf("importMGT") !== -1 && apiDoc.indexOf("getMGTComponent") !== -1 && apiDoc.indexOf("13.x") !== -1) {
    pass("the Premiere API report documents MOGRT calls and version floors");
  } else {
    fail("docs/premiere-6d-api.md does not document the MOGRT calls and version floors");
  }
} else {
  fail("docs/premiere-6d-api.md is missing");
}

if (exists("tests/pr-recipes.test.js")) pass("recipe test suite is present");
else fail("tests/pr-recipes.test.js is missing");
if (exists("docs/manual-test-checklist-part6d.md")) pass("Part 6D manual checklist is present");
else fail("docs/manual-test-checklist-part6d.md is missing");

/* report */
passes.forEach(function (message) { console.log("PASS  " + message); });
skips.forEach(function (message) { console.log("SKIP  " + message); });
fails.forEach(function (message) { console.log("FAIL  " + message); });
console.log("");
console.log(passes.length + " passed, " + fails.length + " failed, " + skips.length + " skipped");
process.exit(fails.length ? 1 : 0);
