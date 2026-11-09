#!/usr/bin/env node
/* QuickKit Premiere recipe tests (Part 6D).
 *
 * Everything here is real: extension/js/pr-recipes.js is required and its
 * compiled plans are inspected, the host source is read for the Premiere API
 * the engine relies on, and the panel is checked for the library convention.
 *
 * NOT tested here (they need Premiere Pro, so they stay UNTESTED in the
 * checklist): real keyframe writes on Motion/Opacity, MOGRT import and text
 * payloads, track locking, the Project-panel selection and bin moves.
 *
 * Run: node tests/pr-recipes.test.js */

"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var engine = require(path.join(ROOT, "extension/js/pr-recipes.js"));
var library = require(path.join(ROOT, "extension/js/library-core.js"));

var host = fs.readFileSync(path.join(ROOT, "host/quickkit.jsx"), "utf8");
var panel = fs.readFileSync(path.join(ROOT, "extension/js/panel.js"), "utf8");
var html = fs.readFileSync(path.join(ROOT, "extension/index.html"), "utf8");

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

function contains(text, needle, label) {
  assert(text.indexOf(needle) !== -1, label + ": missing " + JSON.stringify(needle));
}

/* --------------------------------------------------------------- catalogue */

test("the catalogue has 18 unique recipes", function () {
  equal(engine.RECIPES.length, 18, "recipe count");
  var ids = {};
  var names = {};
  engine.RECIPES.forEach(function (recipe) {
    assert(!ids[recipe.id], "duplicate id " + recipe.id);
    assert(!names[recipe.name], "duplicate name " + recipe.name);
    ids[recipe.id] = true;
    names[recipe.name] = true;
  });
});

test("the four categories carry the expected counts", function () {
  var counts = engine.categories().map(function (entry) {
    return entry.name + ":" + entry.count;
  });
  equal(counts.join(","), "Fade:3,Slide:8,Scale:4,Motion:3", "category counts");
});

test("every recipe has a note, a category and at least one edge", function () {
  engine.RECIPES.forEach(function (recipe) {
    assert(recipe.note && recipe.note.length > 10, recipe.id + " has no note");
    has(engine.CATEGORIES, recipe.category, recipe.id + " category");
    assert(recipe.edges === "in" || recipe.edges === "out" || recipe.edges === "both", recipe.id + " edges");
  });
});

test("the required recipe set exists", function () {
  var ids = engine.RECIPES.map(function (recipe) {
    return recipe.id;
  });
  [
    "fade-in",
    "fade-out",
    "slide-in-left",
    "slide-in-right",
    "slide-in-up",
    "slide-in-down",
    "slide-out-left",
    "slide-out-right",
    "slide-out-up",
    "slide-out-down",
    "scale-pop",
    "zoom-in",
    "zoom-out",
    "shake",
    "spin",
    "flicker"
  ].forEach(function (id) {
    has(ids, id, "required recipe");
  });
});

/* ------------------------------------------------------------------- plans */

test("every recipe compiles to a JSON-safe default plan", function () {
  engine.RECIPES.forEach(function (recipe) {
    var plan = engine.defaultPlan(recipe.id);
    assert(plan, recipe.id + " produced no plan");
    var round = JSON.parse(JSON.stringify(plan));
    equal(round.id, recipe.id, recipe.id + " survives JSON");
    assert(Object.keys(plan.channels).length > 0, recipe.id + " has no channels");
  });
});

test("plan() does not mutate its input and is repeatable", function () {
  var input = { duration: 0.9, easing: "linear", amount: 80, direction: "right" };
  var copy = JSON.stringify(input);
  var first = engine.plan("slide-in-left", input);
  var second = engine.plan("slide-in-left", input);
  equal(JSON.stringify(input), copy, "input unchanged");
  equal(JSON.stringify(first), JSON.stringify(second), "same input, same plan");
  assert(first !== second, "plan() returns a fresh object");
});

test("numbers are clamped to the documented ranges", function () {
  var low = engine.plan("fade-in", { duration: 0, amount: -50 });
  near(low.duration, 0.2, 1e-9, "duration floor");
  near(low.amount, 0, 1e-9, "amount floor");

  var high = engine.plan("fade-in", { duration: 99, amount: 999 });
  near(high.duration, 3, 1e-9, "duration ceiling");
  near(high.amount, 200, 1e-9, "amount ceiling");
});

test("unknown easing falls back to smooth and known easing is kept", function () {
  equal(engine.plan("fade-in", { easing: "wobble" }).easing, "smooth", "unknown easing");
  equal(engine.plan("fade-in", { easing: "linear" }).easing, "linear", "linear kept");
  equal(engine.plan("fade-in", { easing: "hold" }).easing, "hold", "hold kept");
});

test("a recipe only exposes the parameters it uses", function () {
  var fade = engine.recipeParams(engine.byId("fade-in"), { direction: "right" });
  assert(!fade.hasOwnProperty("direction"), "fade must not expose a direction");
  var slide = engine.recipeParams(engine.byId("slide-in-left"), {});
  equal(slide.direction, "left", "slide-in-left defaults to the left side");
  var unknown = engine.recipeParams(engine.byId("fade-in"), { nope: 1 });
  assert(!unknown.hasOwnProperty("nope"), "unknown keys are dropped");
});

test("a fade-in goes from 0 to the clip's own opacity", function () {
  var plan = engine.plan("fade-in", {});
  var keys = plan.channels.opacity;
  equal(keys.length, 2, "two opacity keys");
  near(keys[0].value, 0, 1e-9, "starts transparent");
  equal(keys[1].value, "base", "ends on the base opacity");
  equal(plan.edges, "in", "in edge");
});

test("a fade-out goes from the clip's own opacity to 0", function () {
  var keys = engine.plan("fade-out", {}).channels.opacity;
  equal(keys[0].value, "base", "starts on base");
  near(keys[1].value, 0, 1e-9, "ends transparent");
  equal(keys[0].edge, "out", "out edge");
});

test("fade-both keys both edges, in order", function () {
  var keys = engine.plan("fade-both", {}).channels.opacity;
  equal(keys.length, 4, "four keys");
  equal(keys[0].edge, "in", "first edge");
  equal(keys[2].edge, "out", "second edge");
  near(keys[0].at, 0, 1e-9, "in starts at 0");
  near(keys[3].at, 1, 1e-9, "out ends at 1");
});

test("slide-in-left starts left of the frame and settles on base", function () {
  var keys = engine.plan("slide-in-left", {}).channels.position;
  equal(keys.length, 2, "two position keys");
  assert(keys[0].dx < 0, "left offset is negative");
  near(keys[0].dy, 0, 1e-9, "no vertical offset");
  near(keys[1].dx, 0, 1e-9, "settles at base x");
});

test("the direction parameter flips the slide side", function () {
  var right = engine.plan("slide-in-left", { direction: "right" }).channels.position;
  assert(right[0].dx > 0, "right offset is positive");
  var down = engine.plan("slide-in-left", { direction: "down" }).channels.position;
  assert(down[0].dy > 0, "down offset is positive");
  var up = engine.plan("slide-in-left", { direction: "up" }).channels.position;
  assert(up[0].dy < 0, "up offset is negative");
});

test("slide-out sends the clip to the chosen side", function () {
  var keys = engine.plan("slide-out-left", {}).channels.position;
  near(keys[0].dx, 0, 1e-9, "starts at base");
  assert(keys[1].dx < 0, "leaves to the left");
  equal(keys[0].edge, "out", "out edge");
});

test("amount scales the slide distance", function () {
  var full = engine.plan("slide-in-left", { amount: 100 }).channels.position;
  var half = engine.plan("slide-in-left", { amount: 50 }).channels.position;
  near(full[0].dx, -0.4, 1e-9, "full distance");
  near(half[0].dx, -0.2, 1e-9, "half distance");
});

test("scale-pop overshoots before settling", function () {
  var keys = engine.plan("scale-pop", {}).channels.scale;
  equal(keys.length, 3, "three scale keys");
  near(keys[0].value, 0.6, 1e-9, "starts small");
  near(keys[1].value, 1.08, 1e-9, "overshoots");
  equal(keys[2].value, "base", "settles on the base scale");
  assert(keys[1].at > keys[0].at && keys[1].at < keys[2].at, "overshoot sits between");
});

test("amount scales the pop distance around the base scale", function () {
  var keys = engine.plan("scale-pop", { amount: 50 }).channels.scale;
  near(keys[0].value, 0.8, 1e-9, "half pop from 0.6");
  near(keys[1].value, 1.04, 1e-9, "half overshoot from 1.08");
});

test("zoom-in and zoom-out move from the base scale", function () {
  var inKeys = engine.plan("zoom-in", {}).channels.scale;
  equal(inKeys[0].value, "base", "zoom-in starts at base");
  near(inKeys[1].value, 1.25, 1e-9, "zoom-in pushes to 125%");
  var outKeys = engine.plan("zoom-out", {}).channels.scale;
  equal(outKeys[0].value, "base", "zoom-out starts at base");
  near(outKeys[1].value, 0.8, 1e-9, "zoom-out pulls to 80%");
  equal(outKeys[0].edge, "out", "zoom-out runs on the out edge");
});

test("shake is a seven-key settle that ends on base", function () {
  var keys = engine.plan("shake", {}).channels.position;
  equal(keys.length, 7, "seven shake keys");
  near(keys[0].dx, 0, 1e-9, "starts at base x");
  near(keys[0].dy, 0, 1e-9, "starts at base y");
  near(keys[6].dx, 0, 1e-9, "ends at base x");
  near(keys[6].dy, 0, 1e-9, "ends at base y");
  var moved = keys.some(function (key) {
    return Math.abs(key.dx) > 0.01 || Math.abs(key.dy) > 0.01;
  });
  assert(moved, "shake actually moves");
});

test("spin rotates in from -180 degrees to the base rotation", function () {
  var keys = engine.plan("spin", {}).channels.rotation;
  near(keys[0].value, -180, 1e-9, "starts at -180");
  equal(keys[1].value, "base", "ends on the base rotation");
});

test("flicker dips opacity and locks on at the end", function () {
  var keys = engine.plan("flicker", {}).channels.opacity;
  equal(keys.length, 9, "nine flicker keys");
  near(keys[0].value, 0, 1e-9, "starts transparent");
  equal(keys[8].value, "base", "locks on at base");
  var dips = keys.filter(function (key) {
    return typeof key.value === "number" && key.value < 100;
  });
  assert(dips.length >= 3, "several dips");
});

test("amount scales the flicker dips", function () {
  var keys = engine.plan("flicker", { amount: 50 }).channels.opacity;
  near(keys[0].value, 50, 1e-9, "half-strength first dip");
  near(keys[2].value, 57.5, 1e-9, "half-strength mid dip");
});

test("keys are ordered by edge and then by time", function () {
  var keys = engine.plan("fade-both", {}).channels.opacity;
  for (var i = 1; i < keys.length; i++) {
    var previous = keys[i - 1];
    var current = keys[i];
    if (previous.edge !== current.edge) {
      equal(previous.edge, "in", "in edge comes first");
      equal(current.edge, "out", "out edge comes second");
      continue;
    }
    assert(current.at >= previous.at, "keys ascend within an edge");
  }
});

test("a plan only carries the channels the recipe uses", function () {
  var fade = engine.plan("fade-in", {});
  equal(Object.keys(fade.channels).join(","), "opacity", "fade only uses opacity");
  var pop = engine.plan("scale-pop", {});
  equal(Object.keys(pop.channels).join(","), "opacity,scale", "pop uses opacity and scale");
});

test("unknown ids and empty plans fail cleanly", function () {
  equal(engine.byId("nope"), null, "unknown id");
  equal(engine.plan("nope", {}), null, "unknown plan");
  equal(engine.defaultPlan("nope"), null, "unknown default plan");
  equal(engine.exportedName("nope"), "QuickKit Premiere Recipe", "fallback name");
});

test("every recipe default plan stays inside the host's clamps", function () {
  engine.RECIPES.forEach(function (recipe) {
    var plan = engine.defaultPlan(recipe.id);
    assert(plan.duration >= 0.2 && plan.duration <= 3, recipe.id + " duration");
    Object.keys(plan.channels).forEach(function (channel) {
      plan.channels[channel].forEach(function (key) {
        assert(key.at >= 0 && key.at <= 1, recipe.id + " key position");
        if (channel === "position") {
          assert(Math.abs(key.dx) <= 2 && Math.abs(key.dy) <= 2, recipe.id + " offset");
        } else if (key.value !== "base") {
          assert(typeof key.value === "number", recipe.id + " value type");
        }
      });
    });
  });
});

/* --------------------------------------------------------- host + panel */

test("the host uses the documented Premiere methods", function () {
  contains(host, "importMGT(", "MOGRT insert");
  contains(host, "getMGTComponent", "MOGRT component");
  contains(host, "AE.ADBE Motion", "Motion match name");
  contains(host, "AE.ADBE Opacity", "Opacity match name");
  contains(host, "areKeyframesSupported", "keyframe support check");
  contains(host, "setTimeVarying", "stopwatch");
  contains(host, "addKey(", "key add");
  contains(host, "setValueAtKey", "key value");
  contains(host, "setInterpolationTypeAtKey", "key easing");
  contains(host, "getKeys", "existing keys");
  contains(host, "isLocked", "track lock check");
  contains(host, "createBin", "bin creation");
  contains(host, "moveBin", "bin moves");
  contains(host, "getCurrentProjectViewSelection", "project selection");
});

test("the host exposes all seven 6D entry points", function () {
  [
    "function qkPrContext(",
    "function qkPrRecipeApply(",
    "function qkPrMogrtInsert(",
    "function qkPrMogrtParams(",
    "function qkPrMogrtSetText(",
    "function qkPrMogrtSetParam(",
    "function qkPrBins("
  ].forEach(function (name) {
    contains(host, name, "host entry point");
  });
});

test("the panel calls every Premiere entry point and seeds recipes", function () {
  contains(panel, "qkPrContext(", "context call");
  contains(panel, "qkPrRecipeApply(", "recipe call");
  contains(panel, "qkPrMogrtInsert(", "MOGRT insert call");
  contains(panel, "qkPrMogrtParams(", "MOGRT params call");
  contains(panel, "qkPrMogrtSetText(", "MOGRT text call");
  contains(panel, "qkPrMogrtSetParam(", "MOGRT param call");
  contains(panel, "qkPrBins(", "bin call");
  contains(panel, "qk.recipes.seeded", "seed key");
  contains(panel, ".qkrecipe.json", "recipe asset extension");
});

test("index.html loads the recipe engine", function () {
  contains(html, "js/pr-recipes.js", "recipe script tag");
});

test("library-core marks recipes as Premiere-only", function () {
  var hosts = library.TYPE_HOSTS["pr-recipe"];
  equal(hosts.join(","), "PPRO", "recipe host support");
});

test("the API report documents the version floors", function () {
  var doc = fs.readFileSync(path.join(ROOT, "docs/premiere-6d-api.md"), "utf8");
  contains(doc, "importMGT", "importMGT documented");
  contains(doc, "getMGTComponent", "getMGTComponent documented");
  contains(doc, "13.x", "version floor documented");
  contains(doc, "getCurrentProjectViewSelection", "selection floor documented");
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
