#!/usr/bin/env node
/* QuickKit preview tests (Part 6B).
 *
 * Three layers, all real:
 *   1. extension/js/preview-core.js on plain objects: speeds, clock, easing,
 *      the approximation classifier, the sampled pose and batch planning.
 *   2. the preview half of library-core.js / library-io.js on a temp folder:
 *      params, preview signatures, ready/stale/none, saving and clearing the
 *      two files, and the "recorded but gone" report.
 *   3. extension/js/preview-node.js: argument builders always, and a real
 *      ffmpeg encode (PNG sequence -> mp4 + webp) when bin/ffmpeg exists.
 *
 * No Adobe app is involved: the Render Queue path, layer.applyPreset,
 * file:// video playback in CEP and the real mouse are NOT tested here and
 * stay UNTESTED in the checklist.
 *
 * Run: node tests/preview.test.js */

"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var execFileSync = require("child_process").execFileSync;
var spawnSync = require("child_process").spawnSync;

var ROOT = path.resolve(__dirname, "..");
var pc = require(path.join(ROOT, "extension/js/preview-core.js"));
var core = require(path.join(ROOT, "extension/js/library-core.js"));
var libio = require(path.join(ROOT, "extension/js/library-io.js"));
var pn = require(path.join(ROOT, "extension/js/preview-node.js"));

var passed = 0;
var failed = 0;
var skipped = [];
var failures = [];
var tests = [];

function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

function skip(name, why) {
  skipped.push(name + " — " + why);
  console.log("SKIP  " + name + " — " + why);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, label) {
  assert(
    actual === expected,
    label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)
  );
}

function near(actual, expected, tolerance, label) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    label + ": expected " + expected + " ±" + tolerance + ", got " + actual
  );
}

function has(list, value, label) {
  assert(list.indexOf(value) >= 0, label + ": expected to find " + JSON.stringify(value));
}

var tempDirs = [];

function tempDir(tag) {
  var dir = path.join(
    os.tmpdir(),
    "qk-preview-" + (tag || "t") + "-" + Date.now() + "-" + Math.floor(Math.random() * 100000)
  );
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir.replace(/\\/g, "/");
}

function cleanTemp() {
  for (var i = 0; i < tempDirs.length; i++) {
    try {
      fs.rmSync(tempDirs[i], { recursive: true, force: true });
    } catch (eClean) {
      /* a locked file in temp is not a test failure */
    }
  }
}

/* ------------------------------------------------------------- 1. core */

test("speeds cycle 0.5 -> 1 -> 2 and fall back to 1", function () {
  equal(pc.SPEEDS.join(","), "0.5,1,2", "SPEEDS");
  equal(pc.nextSpeed(0.5), 1, "0.5 next");
  equal(pc.nextSpeed(1), 2, "1 next");
  equal(pc.nextSpeed(2), 0.5, "2 next");
  equal(pc.nextSpeed(7), 1, "an unknown speed starts over at 1");
  equal(pc.nextSpeed("nonsense"), 2, "junk reads as 1x, so it moves to 2x");
});

test("the clock reads m:ss.t, never m:tt", function () {
  equal(pc.formatClock(0), "0:00.0", "zero");
  equal(pc.formatClock(1.24), "0:01.2", "1.24s");
  equal(pc.formatClock(2.5), "0:02.5", "2.5s");
  equal(pc.formatClock(9.98), "0:09.9", "9.98s");
  equal(pc.formatClock(61.05), "1:01.0", "61.05s");
  equal(pc.formatClock(-4), "0:00.0", "negative clamps");
  equal(pc.formatClock("junk"), "0:00.0", "junk clamps");
});

test("clampTime keeps the playhead inside the clip", function () {
  equal(pc.clampTime(2, 2.5), 2, "inside");
  equal(pc.clampTime(-3, 2.5), 0, "below zero");
  equal(pc.clampTime(9, 2.5), 2.5, "past the end");
  equal(pc.clampTime(1, 0), 0, "zero length");
  equal(pc.clampTime("junk", 2), 0, "junk time");
});

test("easing curves start at 0, end at 1 and stay in range", function () {
  ["linear", "smooth", "snap", "bounce"].forEach(function (name) {
    var fn = pc.easingFn(name);
    near(fn(0), 0, 1e-9, name + "(0)");
    near(fn(1), 1, 1e-9, name + "(1)");
    equal(fn(-1), 0, name + " clamps below");
    equal(fn(2), 1, name + " clamps above");
    for (var t = 0; t <= 1.0001; t += 0.05) {
      var value = fn(t);
      assert(value >= -1e-9 && value <= 1 + 1e-9, name + " stays between 0 and 1 at " + t);
    }
  });

  /* bounce is the only curve allowed to travel backwards: landing between
     impacts is what makes it a bounce. */
  ["linear", "smooth", "snap"].forEach(function (name) {
    var fn = pc.easingFn(name);
    var last = -1;
    for (var t = 0; t <= 1.0001; t += 0.05) {
      var value = fn(t);
      assert(value >= last - 1e-9, name + " must not go backwards");
      last = value;
    }
  });
  var bounce = pc.easingFn("bounce");
  assert(bounce(0.5) < bounce(0.36) - 0.1, "bounce dips between impacts");

  near(pc.easingFn("smooth")(0.5), 0.875, 1e-9, "smooth is ease-out cubic");
  near(pc.easingFn("linear")(0.25), 0.25, 1e-9, "linear is linear");
});

test("the approximation is picked from name, category and tags", function () {
  function kind(item) {
    var found = pc.approxFor(item);
    return found ? found.kind : null;
  }
  equal(kind({ type: "ae-preset", name: "Wipe left", tags: ["transition", "wipe"] }), "wipe", "wipe");
  equal(kind({ type: "ae-preset", name: "Title Spin In" }), "rotate", "spin");
  equal(kind({ type: "ae-preset", name: "Soft push", tags: ["move", "slow"] }), "blur", "soft beats push");
  equal(kind({ type: "ae-preset", name: "Punch in" }), "scale", "punch");
  equal(kind({ type: "ae-preset", name: "Type on" }), "type", "type");
  equal(kind({ type: "pr-recipe", name: "Caption pop" }), "type", "caption");
  equal(kind({ type: "ae-preset", name: "Slide up" }), "slide", "slide");
  equal(kind({ type: "ae-preset", name: "Gold Accent", category: "Styles" }), "fade", "default");
  equal(kind({ type: "pack", name: "Wipe pack" }), null, "packs have no approximation");
  equal(pc.approxFor(null), null, "no item, no approximation");
});

test("the approximation honours params and clamps nonsense", function () {
  var found = pc.approxFor({
    type: "ae-preset",
    name: "Wipe left",
    params: { duration: 3, easing: "bounce", direction: "left", distance: 80 }
  });
  equal(found.kind, "wipe", "kind");
  equal(found.easing, "bounce", "easing");
  equal(found.direction, "left", "direction");
  equal(found.distance, 80, "distance");
  equal(found.duration, 3, "duration");
  equal(found.label, "Wipe approximation", "label");

  var clamped = pc.approxFor({ type: "ae-preset", name: "Fade", params: { duration: 99 } });
  equal(clamped.duration, 12, "duration clamps to 12s");
  var tiny = pc.approxFor({ type: "ae-preset", name: "Fade", params: { duration: 0.01 } });
  equal(tiny.duration, 0.4, "duration clamps to 0.4s");
  var junk = pc.approxFor({ type: "ae-preset", name: "Fade", params: { duration: "junk", distance: "junk" } });
  equal(junk.duration, 1.2, "junk duration falls back");
  equal(junk.distance, 40, "junk distance falls back");
});

test("the sampled pose animates each kind from hidden to settled", function () {
  var start = pc.sampleAt("fade", 0, {});
  var end = pc.sampleAt("fade", 1, {});
  equal(start.opacity, 0, "fade starts hidden");
  equal(end.opacity, 1, "fade ends visible");

  equal(pc.sampleAt("type", 0.25, {}).clip, 0.25, "type reveal follows progress");
  equal(pc.sampleAt("wipe", 0.5, {}).clip, 0.5, "wipe reveal follows progress");

  var big = pc.sampleAt("scale", 0, {});
  equal(big.scale, 0.72, "scale starts small");
  equal(pc.sampleAt("scale", 1, {}).scale, 1, "scale ends normal");

  equal(pc.sampleAt("blur", 0, {}).blur, 8, "blur starts soft");
  equal(pc.sampleAt("blur", 1, {}).blur, 0, "blur ends sharp");

  equal(pc.sampleAt("rotate", 0, {}).rotate, -18, "rotate starts tilted");
  equal(pc.sampleAt("rotate", 1, {}).rotate, 0, "rotate ends straight");

  var fromRight = pc.sampleAt("slide", 0, { direction: "right", distance: 40 });
  equal(fromRight.dx, -40, "sliding from the right starts on the right");
  equal(fromRight.dy, 0, "no vertical drift");
  var fromUp = pc.sampleAt("slide", 0, { direction: "up", distance: 40 });
  equal(fromUp.dy, 40, "sliding from above starts above");
  equal(pc.sampleAt("slide", 1, { direction: "right", distance: 40 }).dx, 0, "slide lands centred");

  var half = pc.sampleAt("fade", 0.5, { direction: "both" });
  near(half.opacity, 1, 1e-9, "both is fully in at the halfway mark");
  var threeQuarters = pc.sampleAt("fade", 0.75, { direction: "both" });
  near(threeQuarters.opacity, 0.5, 1e-9, "both fades out after halfway");

  var clamped = pc.sampleAt("fade", 5, {});
  equal(clamped.opacity, 1, "progress clamps past the end");
});

test("batch planning picks only renderable After Effects presets", function () {
  var items = [
    { id: "a", type: "ae-preset", asset: "asset.qkpreset", hostSupport: ["AEFT"] },
    { id: "b", type: "ae-preset", asset: "asset.ffx", hostSupport: ["AEFT"] },
    { id: "c", type: "ae-preset", asset: "asset.qkpreset", hostSupport: ["PPRO"] },
    { id: "d", type: "mogrt", asset: "asset.mogrt", hostSupport: ["AEFT", "PPRO"] },
    { id: "e", type: "pr-recipe", asset: "asset.json", hostSupport: ["PPRO"] },
    { id: "f", type: "ae-preset", asset: "asset.qkpreset", hostSupport: ["AEFT"] },
    { id: "g", type: "ae-preset", asset: "asset.qkpreset" }
  ];
  var states = { a: "none", b: "stale", c: "none", d: "none", e: "none", f: "ready", g: "none" };
  var planned = pc.planGeneration(items, function (item) {
    return states[item.id] || "none";
  });
  var ids = planned.map(function (item) {
    return item.id;
  });
  equal(ids.join(","), "a,b", "none and stale AE presets only");
  equal(pc.planGeneration([], null).length, 0, "empty list");
  equal(pc.planGeneration(null, null).length, 0, "null list");
  equal(
    pc.planGeneration([{ id: "x", type: "ae-preset", asset: "asset.qkpreset", hostSupport: ["AEFT"] }], null).length,
    1,
    "a missing stateOf means nothing is ready"
  );
});

/* ------------------------------------------- 2. params and preview state */

function libItem(type, extra) {
  var raw = {
    id: "i1",
    name: "Type on",
    type: type || "ae-preset",
    asset: "asset.qkpreset",
    bytes: 120
  };
  for (var key in extra || {}) {
    if (Object.prototype.hasOwnProperty.call(extra, key)) raw[key] = extra[key];
  }
  return core.normalizeItem(raw, "");
}

/* library-core has no addItem: the store writes items. Build the smallest
   index that holds one item so the preview functions can be exercised. */
function indexWith(item) {
  return core.normalizeIndex({
    format: "quickkit-library",
    schemaVersion: 2,
    folders: [],
    items: [item]
  });
}

test("param definitions, defaults and clamping", function () {
  var defs = core.paramDefs("ae-preset");
  assert(defs.length >= 4, "an After Effects preset declares its params");
  var keys = defs.map(function (def) {
    return def.key;
  });
  has(keys, "duration", "duration");
  has(keys, "easing", "easing");

  var defaults = core.paramDefaults("ae-preset");
  equal(typeof defaults.duration, "number", "duration default is a number");

  var loose = core.normalizeParams("ae-preset", {
    duration: 900,
    easing: "not-a-curve",
    direction: "sideways",
    distance: -50,
    unknown: "drop me"
  });
  equal(loose.duration, 6, "duration clamps to the declared maximum");
  equal(loose.easing, defaults.easing, "unknown easing falls back");
  equal(loose.direction, defaults.direction, "unknown direction falls back");
  equal(loose.distance, 8, "distance clamps to the declared minimum");
  equal(loose.unknown, undefined, "unknown keys are dropped");
  equal(core.paramDefs("pack").length, 0, "packs declare no params");
});

test("the preview signature follows params, not names", function () {
  var item = libItem("ae-preset", { params: { duration: 1.2 } });
  var again = libItem("ae-preset", { name: "Renamed", params: { duration: 1.2 } });
  equal(core.previewSignature(item), core.previewSignature(again), "a rename keeps the signature");

  var slower = libItem("ae-preset", { params: { duration: 2 } });
  assert(core.previewSignature(item) !== core.previewSignature(slower), "a param change moves the signature");

  var otherFile = libItem("ae-preset", { params: { duration: 1.2 }, asset: "other.ffx" });
  assert(core.previewSignature(item) !== core.previewSignature(otherFile), "a new asset moves the signature");

  var heavier = libItem("ae-preset", { params: { duration: 1.2 }, bytes: 999 });
  assert(core.previewSignature(item) !== core.previewSignature(heavier), "new bytes move the signature");
  equal(core.previewSignature(null), "", "no item, no signature");
});

test("preview state is none, ready or stale", function () {
  equal(core.previewState(null), "none", "no item");
  var item = libItem("ae-preset");
  equal(core.previewState(item), "none", "no file");

  var index = indexWith(item);
  var state = core.itemPreviewSet(index, item.id, {
    video: core.PREVIEW_VIDEO,
    thumb: core.PREVIEW_THUMB,
    key: core.previewSignature(item)
  });
  equal(state.error, undefined, "set works");
  equal(core.previewState(state.item), "ready", "matching key is ready");

  var stale = core.itemPreviewSet(index, item.id, {
    video: core.PREVIEW_VIDEO,
    thumb: core.PREVIEW_THUMB,
    key: "from-older-params"
  });
  equal(core.previewState(stale.item), "stale", "a different key is stale");

  core.itemPreviewClear(index, item.id);
  equal(core.previewState(core.itemById(index, item.id)), "none", "clear goes back to none");

  var refuses = core.itemPreviewSet(index, "missing", { video: "x.mp4" });
  assert(refuses.error, "an unknown id is refused");
});

test("changing params through itemUpdate leaves the saved preview stale", function () {
  var item = libItem("ae-preset");
  var index = indexWith(item);
  core.itemPreviewSet(index, item.id, {
    video: core.PREVIEW_VIDEO,
    thumb: core.PREVIEW_THUMB,
    key: core.previewSignature(item)
  });
  var changed = core.itemUpdate(index, { id: item.id, params: { duration: 2.4 } });
  equal(changed.error, undefined, "update works");
  equal(changed.item.params.duration, 2.4, "the new duration is stored");
  equal(core.previewState(changed.item), "stale", "the old preview no longer matches");
});

/* ------------------------------------------------- 3. files on disk */

function store(tag) {
  var dir = tempDir(tag);
  var api = libio.create({ root: dir, legacyRoot: "" });
  var loaded = api.load();
  equal(loaded.ok, true, "store loads");
  return { api: api, dir: dir };
}

function writeFile(dir, name, contents) {
  var file = path.join(dir, name);
  fs.writeFileSync(file, contents, "utf8");
  return file.replace(/\\/g, "/");
}

test("previewsSave copies both files into the item folder and records the key", function () {
  var made = store("save");
  var added = made.api.itemAdd({ id: "i1", name: "Type on", type: "ae-preset", text: "{}" });
  equal(added.ok, true, "item added");

  var from = tempDir("encoded");
  var video = writeFile(from, "preview.mp4", "not really an mp4");
  var thumb = writeFile(from, "thumb.webp", "not really a webp");

  var saved = made.api.previewsSave({ id: "i1", videoPath: video, thumbPath: thumb });
  equal(saved.ok, true, "save works: " + (saved.error || ""));
  equal(saved.item.previewVideo, core.PREVIEW_VIDEO, "video name recorded");
  equal(saved.item.previewThumb, core.PREVIEW_THUMB, "thumb name recorded");
  assert(saved.item.previewKey, "a key is recorded");
  assert(saved.videoUrl.indexOf("file://") === 0, "a file:// url comes back for the panel");

  var folder = made.api.itemDirectory("i1");
  equal(fs.readFileSync(path.join(folder, core.PREVIEW_VIDEO), "utf8"), "not really an mp4", "video copied");
  equal(fs.readFileSync(path.join(folder, core.PREVIEW_THUMB), "utf8"), "not really a webp", "thumb copied");

  var info = made.api.previewsInfo();
  equal(info.ready, 1, "one ready preview");
  equal(info.clearable, 1, "one clearable preview");
  assert(info.bytes > 0, "bytes are counted");

  var gone = made.api.load().previewsGone;
  equal(gone.length, 0, "nothing is reported gone while the files exist");
});

test("previewsSave refuses a missing source and a missing id", function () {
  var made = store("refuse");
  made.api.itemAdd({ id: "i1", name: "One", type: "ae-preset", text: "{}" });
  equal(made.api.previewsSave({ id: "i1", videoPath: "C:/nope/missing.mp4" }).ok, false, "missing file refused");
  equal(made.api.previewsSave({ id: "nope", videoPath: "C:/nope/x.mp4" }).ok, false, "unknown id refused");
  equal(made.api.previewsSave({ id: "i1" }).ok, false, "nothing to copy refused");
});

test("a cleared or deleted preview is reported, never fatal", function () {
  var made = store("gone");
  made.api.itemAdd({ id: "i1", name: "One", type: "ae-preset", text: "{}" });
  var from = tempDir("gone-src");
  made.api.previewsSave({
    id: "i1",
    videoPath: writeFile(from, "preview.mp4", "mp4"),
    thumbPath: writeFile(from, "thumb.webp", "webp")
  });

  var folder = made.api.itemDirectory("i1");
  fs.unlinkSync(path.join(folder, core.PREVIEW_THUMB));

  var gone = made.api.load().previewsGone;
  equal(gone.join(","), "i1", "the item is reported as having a missing preview");
  equal(made.api.previewsInfo().clearable, 1, "it still counts as clearable");

  var cleared = made.api.previewsClear({});
  equal(cleared.ok, true, "clear works");
  equal(cleared.cleared, 1, "one item cleared");
  equal(made.api.load().previewsGone.length, 0, "nothing is reported gone after a clear");
  equal(made.api.previewsInfo().clearable, 0, "nothing is left to clear");
});

test("previewsClear can target one id and leaves the rest alone", function () {
  var made = store("target");
  var from = tempDir("target-src");
  var video = writeFile(from, "preview.mp4", "mp4");
  var thumb = writeFile(from, "thumb.webp", "webp");
  made.api.itemAdd({ id: "i1", name: "One", type: "ae-preset", text: "{}" });
  made.api.itemAdd({ id: "i2", name: "Two", type: "ae-preset", text: "{}" });
  made.api.previewsSave({ id: "i1", videoPath: video, thumbPath: thumb });
  made.api.previewsSave({ id: "i2", videoPath: video, thumbPath: thumb });

  var cleared = made.api.previewsClear({ ids: ["i2"] });
  equal(cleared.cleared, 1, "one cleared");
  equal(made.api.previewsInfo().ready, 1, "one preview left");
  var index = made.api.load().index;
  assert(core.itemById(index, "i1").previewVideo, "i1 keeps its preview");
  equal(core.itemById(index, "i2").previewVideo, "", "i2 lost its preview");
});

test("itemAssetPath gives the host a native path inside the item folder", function () {
  var made = store("asset");
  made.api.itemAdd({ id: "i1", name: "One", type: "ae-preset", text: "{}" });
  var hostPath = made.api.itemAssetPath("i1");
  assert(hostPath.indexOf("i1") >= 0, "the path names the item folder");
  assert(/\.qkpreset$/.test(hostPath), "the path ends in the asset name");
  assert(hostPath.indexOf("file://") < 0, "no file:// prefix for ExtendScript");
  equal(made.api.itemAssetPath("nope"), "", "unknown id gives an empty string");
});

/* ------------------------------------------------------- 4. the encoder */

test("frame names split and an even sequence becomes one pattern", function () {
  var part = pn.splitFrameName("C:/tmp/Comp 1_00007.png");
  equal(part.prefix, "Comp 1_", "prefix");
  equal(part.digits, 5, "digits");
  equal(part.value, 7, "value");
  equal(part.suffix, ".png", "suffix");
  equal(pn.splitFrameName("no-number.png"), null, "a name without digits has no pattern");

  var files = [];
  for (var i = 0; i < 5; i++) files.push("C:/tmp/preview_0000" + i + ".png");
  var pattern = pn.framePattern(files);
  equal(pattern.pattern, "C:/tmp/preview_%05d.png", "pattern path");
  equal(pattern.start, 0, "start number");
  equal(pattern.count, 5, "count");

  var gapped = files.slice(0, 2).concat(files.slice(3));
  equal(pn.framePattern(gapped), null, "a gap falls back to the concat list");
  equal(pn.framePattern([]), null, "no frames, no pattern");
  equal(pn.framePattern(["C:/tmp/a1.png", "C:/tmp/b2.png"]), null, "different prefixes do not mix");
});

test("the concat list escapes quotes and repeats the last frame", function () {
  var text = pn.concatText(["C:/tmp/it's 1.png", "C:/tmp/two.png"], 24);
  equal(
    text,
    "file 'C:/tmp/it'\\''s 1.png'\nduration 0.04167\nfile 'C:/tmp/two.png'\nduration 0.04167\nfile 'C:/tmp/two.png'\n",
    "concat text"
  );
  equal(pn.concatText([], 24), "", "no files, no list");
});

test("width and seconds stay inside the preview limits", function () {
  equal(pn.clampWidth(480), 480, "480 is allowed");
  equal(pn.clampWidth(1920), 480, "never wider than 480");
  equal(pn.clampWidth(10), 160, "never narrower than 160");
  equal(pn.clampWidth("junk"), 480, "junk falls back to 480");
  equal(pn.clampSeconds(2.5), 2.5, "in range");
  equal(pn.clampSeconds(9), 4, "never longer than 4s");
  equal(pn.clampSeconds(0.5), 2, "never shorter than 2s");
});

test("the ffmpeg arguments ask for a muted 480 px h.264 clip and a webp thumb", function () {
  var video = pn.videoArgs({
    pattern: "C:/tmp/preview_%05d.png",
    start: 0,
    fps: 24,
    width: 480,
    seconds: 2.5,
    outVideo: "C:/tmp/preview.mp4"
  });
  has(video, "-an", "muted");
  equal(video[video.indexOf("-t") + 1], "2.5", "trimmed to the clip length");
  equal(video[video.indexOf("-c:v") + 1], "libx264", "h.264");
  has(video, "yuv420p", "pixel format browsers can play");
  has(video, "+faststart", "faststart for instant playback");
  var filter = video[video.indexOf("-vf") + 1];
  assert(filter.indexOf("min(480,iw)") >= 0, "scales down but never up: " + filter);
  has(video, "C:/tmp/preview.mp4", "output path");

  var thumb = pn.thumbArgs({
    outVideo: "C:/tmp/preview.mp4",
    outThumb: "C:/tmp/thumb.webp",
    width: 480,
    seconds: 2.5
  });
  equal(thumb[thumb.indexOf("-ss") + 1], "1", "thumbnail comes from 40% into the clip");
  equal(thumb[thumb.indexOf("-c:v") + 1], "libwebp", "webp encoder");
  has(thumb, "1", "exactly one frame");
});

test("encode refuses an empty frame list without starting ffmpeg", function (done) {
  var job = pn.encode(
    { ffmpeg: "does-not-matter", frames: [], outVideo: "x.mp4", outThumb: "x.webp" },
    {
      onDone: function (error) {
        try {
          equal(error && error.code, "no_frames", "no frames is reported");
          done();
        } catch (eDone) {
          done(eDone);
        }
      }
    }
  );
  assert(job && typeof job.cancel === "function", "a job handle comes back");
});

/* A real encode, only when ffmpeg is installed (bin/ffmpeg is gitignored, so
   a fresh clone must still pass every other test). */
var FFMPEG = (function () {
  var exe = path.join(ROOT, "bin", "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return fs.existsSync(exe) ? exe : "";
})();

test("real encode: PNG frames become a playable mp4 and a webp thumb", function (done) {
  if (!FFMPEG) {
    skip("real encode", "no bundled ffmpeg on this machine");
    done();
    return;
  }
  var dir = tempDir("encode");
  var frames = path.join(dir, "frames");
  fs.mkdirSync(frames, { recursive: true });

  /* 2.5s of moving colour, generated by ffmpeg itself at 24 fps. */
  var made = spawnSync(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=2.5",
      path.join(frames, "Sample_%04d.png").replace(/\\/g, "/")
    ],
    { encoding: "utf8", timeout: 60000 }
  );
  equal(made.status, 0, "frame generation worked: " + (made.stderr || "").slice(0, 200));

  var images = fs
    .readdirSync(frames)
    .filter(function (name) {
      return /\.png$/.test(name);
    })
    .sort()
    .map(function (name) {
      return path.join(frames, name).replace(/\\/g, "/");
    });
  assert(images.length >= 24, "enough frames to encode: " + images.length);

  var outVideo = path.join(dir, "preview.mp4").replace(/\\/g, "/");
  var outThumb = path.join(dir, "thumb.webp").replace(/\\/g, "/");
  pn.encode(
    {
      ffmpeg: FFMPEG,
      frames: images,
      fps: 24,
      width: 480,
      seconds: 2.5,
      outVideo: outVideo,
      outThumb: outThumb
    },
    {
      onDone: function (error, value) {
        try {
          equal(error, null, "encode finished: " + (error && error.message));
          assert(fs.existsSync(outVideo), "the mp4 exists");
          assert(fs.existsSync(outThumb), "the webp exists");
          equal(value.width, 480, "encoded at 480 px");
          equal(value.usedPattern, true, "the single-pattern path was used");

          var head = fs.readFileSync(outVideo).slice(0, 12).toString("latin1");
          assert(head.indexOf("ftyp") >= 0, "the mp4 has an ftyp box: " + head);
          var webp = fs.readFileSync(outThumb);
          equal(webp.slice(0, 4).toString("latin1"), "RIFF", "webp starts with RIFF");
          equal(webp.slice(8, 12).toString("latin1"), "WEBP", "webp is a webp");

          var probe = execFileSync(
            FFMPEG.replace(/ffmpeg(\.exe)?$/, function (m) {
              return m === "ffmpeg.exe" ? "ffprobe.exe" : "ffprobe";
            }),
            ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration", "-of", "csv=p=0", outVideo],
            { encoding: "utf8", timeout: 30000 }
          ).trim();
          var parts = probe.split(",");
          equal(parts[0], "480", "ffprobe agrees on the width");
          var seconds = Number(parts[2]);
          assert(seconds >= 1.9 && seconds <= 4.1, "clip length is 2-4s, got " + seconds);
          done();
        } catch (eCheck) {
          done(eCheck);
        }
      }
    }
  );
});

/* --------------------------------------------------------------- runner */

(async function run() {
  for (var i = 0; i < tests.length; i++) {
    var current = tests[i];
    try {
      if (current.fn.length > 0) {
        await new Promise(function (resolve, reject) {
          current.fn(function (error) {
            if (error) reject(error);
            else resolve();
          });
        });
      } else {
        await current.fn();
      }
      passed++;
      console.log("ok    " + current.name);
    } catch (error) {
      failed++;
      failures.push(current.name + ": " + (error && error.message ? error.message : error));
      console.log("FAIL  " + current.name + "\n      " + (error && error.message ? error.message : error));
    }
  }

  cleanTemp();

  console.log("");
  console.log(passed + " passed, " + failed + " failed, " + skipped.length + " skipped");
  if (failures.length) {
    console.log("");
    for (var f = 0; f < failures.length; f++) console.log("- " + failures[f]);
  }
  process.exit(failed ? 1 : 0);
})();
