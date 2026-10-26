/* Rebuilds tests/.preview from the real source files.
 *
 * The preview is a committed fake-CEP harness: open tests/.preview/index.html
 * (or serve the folder) and the panel runs against fake-cep.js, which stubs
 * window.__adobe_cep__. Append ?host=PPRO to see the Premiere side.
 *
 * Run: node tests/refresh-preview.js
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var OUT = path.join(__dirname, ".preview");
var INJECT = '  <script src="fake-cep.js"></script>\r\n  <script src="js/csinterface-lite.js"></script>';

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(function (name) {
    var src = path.join(from, name);
    var dst = path.join(to, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  });
}

function rebuildIndex() {
  var html = fs.readFileSync(path.join(ROOT, "extension/index.html"), "utf8");
  var anchor = '  <script src="js/csinterface-lite.js"></script>';
  if (html.indexOf(anchor) === -1) {
    throw new Error("index.html no longer has the csinterface-lite script tag");
  }
  if (html.indexOf("fake-cep.js") === -1) {
    html = html.replace(anchor, INJECT);
  }
  fs.writeFileSync(path.join(OUT, "index.html"), html);
  return html.split("\n").length;
}

copyDir(path.join(ROOT, "extension/css"), path.join(OUT, "css"));
copyDir(path.join(ROOT, "extension/js"), path.join(OUT, "js"));
copyDir(path.join(ROOT, "design/icons"), path.join(OUT, "design/icons"));
fs.copyFileSync(path.join(ROOT, "design/tokens.css"), path.join(OUT, "design/tokens.css"));

var lines = rebuildIndex();
var ffmpegNode = path.join(OUT, "js/ffmpeg-node.js");

console.log("preview refreshed: index.html " + lines + " lines");
console.log("  js/panel.js      " + fs.statSync(path.join(OUT, "js/panel.js")).size + " bytes");
console.log("  js/ffmpeg-node.js " + (fs.existsSync(ffmpegNode) ? fs.statSync(ffmpegNode).size + " bytes (require-only, not a <script>)" : "MISSING"));
