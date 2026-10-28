#!/usr/bin/env node
/* QuickKit text preset tests (Part 6C).
 *
 * Everything here is real: extension/js/text-presets.js is required and its
 * compiled plans are inspected, the host source is read for the MOGRT API and
 * the apply entry point, and the panel is checked for the .qktextpreset
 * library convention the plans rely on.
 *
 * NOT tested here (they need After Effects, so they stay UNTESTED in the
 * checklist): turning a plan into real keyframes, animator match names,
 * Essential Graphics exposure, exportAsMotionGraphicsTemplate, the save
 * prompt, Render Queue previews and a hand import in Premiere.
 *
 * Run: node tests/text-presets.test.js */

"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var engine = require(path.join(ROOT, "extension/js/text-presets.js"));
var preview = require(path.join(ROOT, "extension/js/preview-core.js"));

var host = fs.readFileSync(path.join(ROOT, "host/quickkit.jsx"), "utf8");
var panel = fs.readFileSync(path.join(ROOT, "extension/js/panel.js"), "utf8");

var passed = 0;
var failed = 0;
var skipped = [];
var failures = [];
var tests = [];

function test(name, fn) {
  tests.push({ name: name, fn: fn });
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
    label + ": expected " + expected + " +/-" + tolerance + ", got " + actual
  );
}

function has(list, value, label) {
  assert(list.indexOf(value) >= 0, label + ": expected to find " + JSON.stringify(value));
}

/* --------------------------------------------------------------- catalogue */

test("the library holds at least 40 original presets", function () {
  assert(engine.PRESETS.length >= 40, "only " + engine.PRESETS.length + " presets");
});

test("all twelve requested categories are populated", function () {
  equal(engine.CATEGORIES.length, 12, "category count");
  var wanted = [
    "Fade", "Slide", "Scale/Pop", "Typewriter", "Per-character", "Per-word",
    "Blur/Reveal", "Rotate/Flip", "Glitch", "Wave/Bounce", "Loop/Idle", "Out animations"
  ];
  for (var i = 0; i < wanted.length; i++) has(engine.CATEGORIES, wanted[i], "categories");

  engine.CATEGORIES.forEach(function (name) {
    var count = engine.PRESETS.filter(function (preset) { return preset.category === name; }).length;
    assert(count > 0, "no presets in " + name);
  });
});

test("every preset declares in, out or both", function () {
  engine.PRESETS.forEach(function (preset) {
    assert(
      preset.edges === "in" || preset.edges === "out" || preset.edges === "both",
      preset.id + " has edges " + preset.edges
    );
  });
  assert(engine.PRESETS.some(function (p) { return p.edges === "in"; }), "no in-only preset");
  assert(engine.PRESETS.some(function (p) { return p.edges === "out"; }), "no out-only preset");
  assert(engine.PRESETS.some(function (p) { return p.edges === "both"; }), "no in+out preset");
});

test("every preset exposes duration, delay and easing", function () {
  engine.PRESETS.forEach(function (preset) {
    ["duration", "delay", "easing"].forEach(function (key) {
      has(preset.expose, key, preset.id + " expose");
    });
    (preset.expose || []).forEach(function (key) {
      assert(engine.PARAMS[key], preset.id + " exposes unknown parameter " + key);
    });
    assert(preset.note && preset.note.length > 20, preset.id + " has no useful note");
  });
});

test("all seven parameters are exposed by the catalogue", function () {
  var exposed = {};
  engine.PRESETS.forEach(function (preset) {
    (preset.expose || []).forEach(function (key) { exposed[key] = true; });
  });
  engine.PARAM_ORDER.forEach(function (key) {
    assert(exposed[key], "no preset exposes " + key);
  });
});

test("ids are unique and slugs are safe", function () {
  var seen = {};
  engine.PRESETS.forEach(function (preset) {
    assert(!seen[preset.id], "duplicate id " + preset.id);
    seen[preset.id] = true;
    assert(/^[a-z0-9-]+$/.test(preset.id), preset.id + " is not slug-shaped");
    equal(engine.slug(preset.id), preset.id, "slug round trip");
  });
});

test("categories() and inCategory() agree with the catalogue", function () {
  var total = 0;
  engine.categories().forEach(function (entry) {
    assert(entry.count > 0, entry.name + " has a zero count");
    total += entry.count;
    equal(engine.inCategory(entry.name).length, entry.count, entry.name + " count");
  });
  equal(total, engine.PRESETS.length, "category total");
  equal(engine.inCategory("all").length, engine.PRESETS.length, "all total");
});

/* ------------------------------------------------------------------- plans */

function layerChannels(plan) {
  var out = [];
  plan.layer.forEach(function (program) {
    if (out.indexOf(program.channel) === -1) out.push(program.channel);
  });
  return out;
}

test("every preset compiles to a plan", function () {
  engine.PRESETS.forEach(function (preset) {
    var plan = engine.plan(preset.id, null);
    assert(plan, preset.id + " compiled to null");
    equal(plan.id, preset.id, preset.id + " plan id");
    equal(plan.name, preset.name, preset.id + " plan name");
    equal(plan.category, preset.category, preset.id + " plan category");
    assert(plan.layer.length > 0 || plan.animator, preset.id + " animates nothing");
  });
});

test("plans are pure data: JSON round trip keeps every value", function () {
  engine.PRESETS.forEach(function (preset) {
    var plan = engine.plan(preset.id, null);
    var round = JSON.parse(JSON.stringify(plan));
    equal(JSON.stringify(round), JSON.stringify(plan), preset.id + " round trip");
  });
});

test("layer key times are sorted, inside 0..1, and values are concrete", function () {
  var allowed = { opacity: 1, position: 1, scale: 1, rotation: 1 };
  engine.PRESETS.forEach(function (preset) {
    var plan = engine.plan(preset.id, null);
    plan.layer.forEach(function (program) {
      assert(allowed[program.channel], preset.id + " unknown channel " + program.channel);
      assert(program.keys.length >= 2, preset.id + " channel with fewer than two keys");
      var previous = -1;
      program.keys.forEach(function (key) {
        assert(key.at >= 0 && key.at <= 1, preset.id + " key at " + key.at);
        assert(key.at >= previous, preset.id + " keys out of order");
        previous = key.at;
        assert(key.v !== undefined, preset.id + " key without a value");

        if (program.channel === "opacity") {
          assert(typeof key.v === "number" || key.v === "base", preset.id + " opacity value");
          if (typeof key.v === "number") assert(key.v >= 0 && key.v <= 100, preset.id + " opacity range");
        } else if (program.channel === "position") {
          assert(key.v === "base" || (typeof key.v.dx === "number" && typeof key.v.dy === "number"), preset.id + " position value");
        } else if (program.channel === "scale") {
          assert(
            key.v === "base" || (typeof key.v.mx === "number" && typeof key.v.my === "number"),
            preset.id + " scale value"
          );
        } else if (program.channel === "rotation") {
          assert(key.v === "base" || typeof key.v.deg === "number", preset.id + " rotation value");
        }
      });
    });
  });
});

test("edges override filters the opposite half of the plan", function () {
  var both = engine.plan("fade-soft", { edges: "in" });
  equal(both.edges, "in", "forced in edges");
  equal(both.layer.filter(function (p) { return p.when === "out"; }).length, 0, "no out programs");

  var outOnly = engine.plan("fade-soft", { edges: "out" });
  equal(outOnly.layer.filter(function (p) { return p.when === "in"; }).length, 0, "no in programs");

  var lockedIn = engine.plan("fade-in", { edges: "both" });
  equal(lockedIn.edges, "in", "in-only preset stays in");

  var lockedOut = engine.plan("out-fade", { edges: "both" });
  equal(lockedOut.edges, "out", "out-only preset stays out");
});

test("duration, delay and distance are clamped, not trusted", function () {
  var plan = engine.plan("slide-left", { duration: 99, delay: -4, distance: 99999 });
  equal(plan.params.duration, 60, "duration clamp");
  equal(plan.params.delay, 0, "delay clamp");
  equal(plan.params.distance, 4000, "distance clamp");
});

test("distance scales slide offsets", function () {
  var close = engine.plan("slide-left", { distance: 40 });
  var far = engine.plan("slide-left", { distance: 400 });
  var a = close.layer[0].keys[0].v.dx;
  var b = far.layer[0].keys[0].v.dx;
  assert(a < 0 && b < 0, "slide from left moves left first");
  near(b / a, 10, 0.001, "distance ratio");
});

test("direction changes which way a slide starts", function () {
  var fromAbove = engine.plan("slide-up", { direction: "up", distance: 100 });
  var fromBelow = engine.plan("slide-up", { direction: "down", distance: 100 });
  assert(fromAbove.layer[0].keys[0].v.dy < 0, "coming from above starts above the layer");
  assert(fromBelow.layer[0].keys[0].v.dy > 0, "coming from below starts below the layer");

  var fromLeft = engine.plan("slide-left", { direction: "left", distance: 100 });
  var fromRight = engine.plan("slide-left", { direction: "right", distance: 100 });
  assert(fromLeft.layer[0].keys[0].v.dx < 0, "left starts left");
  assert(fromRight.layer[0].keys[0].v.dx > 0, "right starts right");
});

test("overshoot inserts a settling key on scale and rotation", function () {
  var flat = engine.plan("pop-punch", { overshoot: 0 });
  var over = engine.plan("pop-punch", { overshoot: 20 });
  equal(flat.layer[0].keys.length, 2, "no overshoot keys at 0");
  assert(over.layer[0].keys.length > flat.layer[0].keys.length, "overshoot adds a key");
  var peak = over.layer[0].keys[1].v;
  assert(peak.mx > 1 && peak.my > 1, "scale overshoots past the base");

  var rot = engine.plan("rotate-in", { overshoot: 18 });
  var spin = rot.layer[0];
  assert(spin.keys.length === 3, "rotation overshoot adds one key");
  assert(spin.keys[1].v.deg > 0, "negative start overshoots the other way");
});

test("stagger becomes selector smoothness", function () {
  var crisp = engine.plan("char-rise", { stagger: 0 });
  var soft = engine.plan("char-rise", { stagger: 80 });
  equal(crisp.animator.smoothness, 0, "crisp smoothness");
  equal(soft.animator.smoothness, 80, "soft smoothness");
});

test("per-word presets target words; per-character presets target characters", function () {
  equal(engine.plan("word-pop", null).animator.basedOn, "words", "word basedOn");
  equal(engine.plan("char-cascade", null).animator.basedOn, "characters", "char basedOn");
});

test("per-character position offsets stay in em, so any font size works", function () {
  var plan = engine.plan("char-rise", null);
  var position = null;
  plan.animator.props.forEach(function (prop) {
    if (prop.channel === "position") position = prop;
  });
  assert(position, "no per-character position");
  equal(position.unit, "em", "position unit");
  assert(Math.abs(position.value[1]) > 0 && Math.abs(position.value[1]) < 3, "em offset is sane");
});

test("selector sweeps cover the in and out edges", function () {
  var plan = engine.plan("char-rise", null);
  equal(plan.animator.selectors.length, 2, "in and out selectors");

  plan.animator.selectors.forEach(function (selector) {
    assert(selector.start.length >= 2 && selector.end.length >= 2, "selector needs both keys");
    selector.start.forEach(function (key) {
      assert(key.at >= 0 && key.at <= 1 && key.v >= 0 && key.v <= 100, "start key range");
    });
    selector.end.forEach(function (key) {
      assert(key.at >= 0 && key.at <= 1 && key.v >= 0 && key.v <= 100, "end key range");
    });
  });
});

test("loop presets tile over a period and return to their first value", function () {
  var plan = engine.plan("loop-wobble", null);
  equal(plan.layer.length, 1, "one loop program");
  var program = plan.layer[0];
  equal(program.when, "loop", "loop when");
  assert(program.period > 0.1, "no period");
  equal(program.keys[0].v, program.keys[program.keys.length - 1].v, "loop closes on its first value");
});

test("easing is carried into the plan and its programs", function () {
  var plan = engine.plan("fade-soft", { easing: "snappy" });
  equal(plan.params.easing, "snappy", "plan easing");
  plan.layer.forEach(function (program) {
    equal(program.ease, "snappy", "program easing");
  });
});

test("a hand-edited easing value falls back to smooth", function () {
  var plan = engine.plan("fade-soft", { easing: "wobble" });
  equal(plan.params.easing, "smooth", "fallback easing");
});

test("previewLook returns a drawable kind for every preset", function () {
  var kinds = ["fade", "slide", "pop", "type", "stagger", "blur", "rotate", "glitch"];
  engine.PRESETS.forEach(function (preset) {
    var look = engine.previewLook(preset.id);
    has(kinds, look.kind, preset.id + " preview kind");
    assert(typeof look.chars === "boolean", preset.id + " chars flag");
  });
});

test("preview-core will plan a preview for a .qktextpreset asset", function () {
  var items = [
    { id: "a", type: "ae-preset", hostSupport: ["AEFT"], asset: "fade-soft.qktextpreset" },
    { id: "b", type: "ae-preset", hostSupport: ["AEFT"], asset: "old.qkpreset" },
    { id: "c", type: "mogrt", hostSupport: ["AEFT", "PPRO"], asset: "x.mogrt" }
  ];
  var queue = preview.planGeneration(items, function () { return "none"; });
  equal(queue.length, 2, "rendered previews are planned for presets only");
});

/* -------------------------------------------------------------------- host */

test("the host defines the apply and MOGRT entry points", function () {
  assert(/function qkTextPresetApply\(payloadJson\)/.test(host), "qkTextPresetApply missing");
  assert(/function qkTextPresetMogrt\(payloadJson\)/.test(host), "qkTextPresetMogrt missing");
});

test("MOGRT export uses Adobe's documented API", function () {
  assert(host.indexOf("exportAsMotionGraphicsTemplate(true, dir)") !== -1, "export call missing");
  assert(host.indexOf("motionGraphicsTemplateName") !== -1, "template name missing");
  assert(host.indexOf("addToMotionGraphicsTemplateAs") !== -1, "named exposure missing");
  assert(host.indexOf("canAddToMotionGraphicsTemplate") !== -1, "support check missing");
  assert(host.indexOf("openInEssentialGraphics") !== -1, "manual fallback missing");
});

test("the MOGRT path never saves the user's project", function () {
  var start = host.indexOf("MOGRT export (Part 6C)");
  var end = host.indexOf("Preset manager", start);
  assert(start !== -1 && end > start, "MOGRT section not found in the host");
  var section = host.slice(start, end);
  assert(section.indexOf("project.save(") === -1, "MOGRT export saves the project");
  assert(section.indexOf("saveWithDialog") === -1, "MOGRT export opens a save dialog");
  assert(section.indexOf("exportAsMotionGraphicsTemplate") !== -1, "MOGRT section has no export call");
});

test("the host marks its own work so re-applying is safe", function () {
  assert(host.indexOf("QK_TEXT_MARKER") !== -1, "no layer marker");
  assert(host.indexOf("qkTextPlanClear") !== -1, "no cleanup path");
  assert(/layer\.comment = QK_TEXT_MARKER/.test(host), "marker is never written");
});

test("MOGRT helper documents the one manual step", function () {
  assert(
    host.indexOf("QuickKit deliberately does not call") !== -1,
    "the save prompt decision is not documented in the host"
  );
  var docs = path.join(ROOT, "docs/mogrt-export-api.md");
  assert(fs.existsSync(docs), "docs/mogrt-export-api.md missing");
  var text = fs.readFileSync(docs, "utf8");
  assert(text.indexOf("exportAsMotionGraphicsTemplate") !== -1, "API doc does not name the API");
  assert(text.indexOf("Don't Save") !== -1, "API doc does not explain the manual step");
});

test("the panel seeds presets as .qktextpreset library items", function () {
  assert(panel.indexOf(".qktextpreset") !== -1, "panel never mentions .qktextpreset");
  assert(panel.indexOf("quickkit-text-preset") !== -1, "panel does not write the preset format");
  assert(panel.indexOf("qkTextPresetApply(") !== -1, "panel never calls the apply entry point");
  assert(panel.indexOf("qkTextPresetMogrt(") !== -1, "panel never calls the MOGRT entry point");
});

test("every preset has a stable exported name", function () {
  engine.PRESETS.forEach(function (preset) {
    equal(engine.exportName(preset.id), preset.name, preset.id + " export name");
  });
});

/* ------------------------------------------------------------------- run */

(async function () {
  for (var i = 0; i < tests.length; i++) {
    var current = tests[i];
    try {
      await current.fn();
      passed++;
      console.log("ok    " + current.name);
    } catch (error) {
      failed++;
      failures.push(current.name + ": " + (error && error.message ? error.message : error));
      console.log("FAIL  " + current.name + "\n      " + (error && error.message ? error.message : error));
    }
  }

  console.log("");
  console.log(passed + " passed, " + failed + " failed, " + skipped.length + " skipped");
  if (failures.length) {
    console.log("");
    for (var f = 0; f < failures.length; f++) console.log("- " + failures[f]);
  }
  process.exit(failed ? 1 : 0);
})();
