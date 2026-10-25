#!/usr/bin/env node
/* QuickKit host logic tests.
 *
 * Loads host/quickkit.jsx in a Node VM with a mock After Effects object model
 * (2D transform maths, keyframes, undo counter) and checks the tool logic.
 * This is NOT After Effects: it proves the maths and the control flow, not the
 * real app. Run: node tests/host-logic.test.js */

"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var assert = require("assert");

var ROOT = path.resolve(__dirname, "..");
var SOURCE = fs.readFileSync(path.join(ROOT, "host/quickkit.jsx"), "utf8");

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
    passed++;
  } catch (error) {
    console.log("FAIL  " + name + " — " + error.message);
    failed++;
  }
}

function close(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    label + ": expected " + expected + ", got " + actual
  );
}

/* ---------------- mock After Effects ---------------- */

function MockProperty(spec) {
  spec = spec || {};
  this.propertyType = 1;
  this.isSpatial = !!spec.isSpatial;
  this.selectedKeys = spec.selectedKeys ? spec.selectedKeys.slice() : [];
  this.expressionEnabled = !!spec.expressionEnabled;
  this.keys = (spec.keys || []).map(function (entry) {
    return { time: entry[0], value: entry[1] };
  });
  this.value = spec.value !== undefined ? spec.value : 0;
  this.easeCalls = [];
  this.interpolationCalls = [];
  this.inserted = [];
}

Object.defineProperty(MockProperty.prototype, "numKeys", {
  get: function () {
    return this.keys.length;
  }
});

MockProperty.prototype.keyTime = function (index) {
  return this.keys[index - 1].time;
};

MockProperty.prototype.keyValue = function (index) {
  return this.keys[index - 1].value;
};

MockProperty.prototype.setInterpolationTypeAtKey = function (index, inType, outType) {
  this.interpolationCalls.push({ index: index, inType: inType, outType: outType });
};

MockProperty.prototype.setTemporalEaseAtKey = function (index, inEase, outEase) {
  this.easeCalls.push({ index: index, inEase: inEase, outEase: outEase });
};

MockProperty.prototype.setValueAtTime = function (time, value) {
  this.inserted.push({ time: time, value: value });
  this.keys.push({ time: time, value: value });
  this.keys.sort(function (a, b) {
    return a.time - b.time;
  });
};

function MockGroup(children) {
  this.propertyType = 2;
  this.children = children || [];
}

Object.defineProperty(MockGroup.prototype, "numProperties", {
  get: function () {
    return this.children.length;
  }
});

MockGroup.prototype.property = function (index) {
  if (typeof index !== "number") return null;
  return this.children[index - 1] || null;
};

/* Keyframe-capable property. A layer transform property can read and write the
   live transform through get/set; text animator values simply keep a store. */
function MockKeyable(opts) {
  opts = opts || {};
  this.store = opts.value !== undefined ? opts.value : 0;
  this.getter = opts.get || null;
  this.setter = opts.set || null;
  this.keys = [];
  this.expressionEnabled = !!opts.expressionEnabled;
  this.easeCalls = [];
  this.interpolationCalls = [];
}

Object.defineProperty(MockKeyable.prototype, "value", {
  get: function () {
    return this.getter ? this.getter() : this.store;
  }
});

Object.defineProperty(MockKeyable.prototype, "numKeys", {
  get: function () {
    return this.keys.length;
  }
});

MockKeyable.prototype.setValue = function (value) {
  if (this.setter) this.setter(value);
  else this.store = value;
};

MockKeyable.prototype.setValueAtTime = function (time, value) {
  this.keys.push({ time: time, value: value });
  this.keys.sort(function (a, b) {
    return a.time - b.time;
  });
  if (this.setter) this.setter(value);
  else this.store = value;
};

MockKeyable.prototype.setInterpolationTypeAtKey = function (index, inType, outType) {
  this.interpolationCalls.push({ index: index, inType: inType, outType: outType });
};

MockKeyable.prototype.setTemporalEaseAtKey = function (index, inEase, outEase) {
  this.easeCalls.push({ index: index, inEase: inEase, outEase: outEase });
};

/* ---------------- mock text animator model ---------------- */

function MockAnimatorBag() {
  this.children = [];
}

Object.defineProperty(MockAnimatorBag.prototype, "numProperties", {
  get: function () {
    return this.children.length;
  }
});

MockAnimatorBag.prototype.property = function (index) {
  if (typeof index !== "number") return null;
  return this.children[index - 1] || null;
};

MockAnimatorBag.prototype.addProperty = function (matchName) {
  if (matchName !== "ADBE Text Animator") return null;
  var animator = new MockAnimator(this);
  this.children.push(animator);
  return animator;
};

function MockTextProperties() {
  this.animators = new MockAnimatorBag();
}

MockTextProperties.prototype.property = function (key) {
  if (key === "ADBE Text Animators") return this.animators;
  return null;
};

function MockAnimator(bag) {
  this.bag = bag;
  this.name = "";
  this.removed = false;
  this.properties = new MockAnimatorProperties();
  this.selectors = new MockSelectorBag();
}

MockAnimator.prototype.property = function (key) {
  if (key === "ADBE Text Animator Properties") return this.properties;
  if (key === "ADBE Text Selectors") return this.selectors;
  return null;
};

MockAnimator.prototype.remove = function () {
  this.removed = true;
  var index = this.bag.children.indexOf(this);
  if (index >= 0) this.bag.children.splice(index, 1);
};

function MockAnimatorProperties() {
  this.children = {};
}

MockAnimatorProperties.prototype.addProperty = function (matchName) {
  var value = matchName === "ADBE Text Position 3D" ? [0, 0] : 0;
  var prop = new MockKeyable({ value: value });
  this.children[matchName] = prop;
  return prop;
};

function MockSelectorBag() {
  this.children = [];
}

MockSelectorBag.prototype.addProperty = function (matchName) {
  if (matchName !== "ADBE Text Selector") return null;
  var selector = new MockSelector();
  this.children.push(selector);
  return selector;
};

function MockSelector() {
  this.start = new MockKeyable({ value: 0 });
  this.end = new MockKeyable({ value: 100 });
  this.advanced = new MockAdvancedSelector();
}

MockSelector.prototype.property = function (key) {
  if (key === "ADBE Text Percent Start") return this.start;
  if (key === "ADBE Text Percent End") return this.end;
  if (key === "ADBE Text Range Advanced") return this.advanced;
  return null;
};

function MockAdvancedSelector() {
  this.units = new MockKeyable({ value: 0 });
  this.type = new MockKeyable({ value: 0 });
}

MockAdvancedSelector.prototype.property = function (key) {
  if (key === "ADBE Text Range Units") return this.units;
  if (key === "ADBE Text Range Type2") return this.type;
  return null;
};

function MockLayer(opts) {
  var self = this;
  opts = opts || {};

  this.name = opts.name || "Layer";
  this.index = opts.index || 1;
  this.id = opts.id || this.index;
  this.locked = !!opts.locked;
  this.rect = opts.rect === null ? null : opts.rect || { left: 0, top: 0, width: 100, height: 50 };
  this.startTime = opts.startTime || 0;
  this.inPoint = 0;
  this.outPoint = opts.duration !== undefined ? opts.duration : 5;
  this.parent = null;
  this.numProperties = 0;
  this.groups = opts.groups || {};
  this.parentLookups = 0;

  if (opts.text) this.groups["ADBE Text Properties"] = new MockTextProperties();

  this.transform = {
    anchor: (opts.anchor || [0, 0]).slice(),
    position: (opts.position || [200, 150]).slice(),
    scale: (opts.scale || [100, 100]).slice(),
    opacity: opts.opacity !== undefined ? opts.opacity : 100,
    rotation: opts.rotation || 0
  };

  this.anchorPoint = new MockKeyable({
    get: function () {
      return self.transform.anchor.slice();
    },
    set: function (value) {
      self.transform.anchor = value.slice();
    }
  });

  this.position = new MockKeyable({
    get: function () {
      return self.transform.position.slice();
    },
    set: function (value) {
      self.transform.position = value.slice();
    }
  });

  this.scale = new MockKeyable({
    get: function () {
      return self.transform.scale.slice();
    },
    set: function (value) {
      self.transform.scale = value.slice();
    }
  });

  this.opacity = new MockKeyable({
    get: function () {
      return self.transform.opacity;
    },
    set: function (value) {
      self.transform.opacity = value;
    }
  });
}

MockLayer.prototype.property = function (key) {
  if (typeof key === "number") return null;
  return this.groups[key] || null;
};

MockLayer.prototype.sourceRectAtTime = function () {
  if (!this.rect) return { left: 0, top: 0, width: 0, height: 0 };
  return {
    left: this.rect.left,
    top: this.rect.top,
    width: this.rect.width,
    height: this.rect.height
  };
};

MockLayer.prototype.sourcePointToComp = function (point) {
  var angle = (this.transform.rotation * Math.PI) / 180;
  var scaleX = this.transform.scale[0] / 100;
  var scaleY = this.transform.scale[1] / 100;
  var dx = (point[0] - this.transform.anchor[0]) * scaleX;
  var dy = (point[1] - this.transform.anchor[1]) * scaleY;
  return [
    this.transform.position[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
    this.transform.position[1] + dx * Math.sin(angle) + dy * Math.cos(angle)
  ];
};

MockLayer.prototype.compPointToSource = function (point) {
  var angle = (this.transform.rotation * Math.PI) / 180;
  var scaleX = this.transform.scale[0] / 100;
  var scaleY = this.transform.scale[1] / 100;
  var dx = point[0] - this.transform.position[0];
  var dy = point[1] - this.transform.position[1];
  var rotatedX = dx * Math.cos(angle) + dy * Math.sin(angle);
  var rotatedY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return [
    this.transform.anchor[0] + rotatedX / scaleX,
    this.transform.anchor[1] + rotatedY / scaleY
  ];
};

function MockComp() {
  this.frameRate = 25;
  this.duration = 10;
  this.width = 1920;
  this.height = 1080;
  this.time = 0;
  this.selectedLayers = [];
  this.layers = new MockLayerCollection(this);
}

function MockLayerCollection(comp) {
  this.comp = comp;
  this.addNullCalls = 0;
  this.precomposeCall = null;
}

MockLayerCollection.prototype.addNull = function () {
  this.addNullCalls++;
  var layer = new MockLayer({ name: "Null 1", index: 99, id: 999, rect: null, position: [0, 0] });
  layer.isNull = true;
  this.comp.selectedLayers.push(layer);
  return layer;
};

MockLayerCollection.prototype.precompose = function (indices, name, moveAllAttributes) {
  this.precomposeCall = {
    indices: indices.slice(),
    name: name,
    moveAllAttributes: moveAllAttributes
  };
  return { name: name };
};

function createWorld(comp) {
  var undo = { open: 0, close: 0, names: [] };

  var app = {
    version: "26.5",
    build: "26.5.0",
    project: { activeItem: comp, file: { name: "test.aep" } },
    beginUndoGroup: function (name) {
      undo.open++;
      undo.names.push(name);
    },
    endUndoGroup: function () {
      undo.close++;
    }
  };

  var sandbox = {
    app: app,
    BridgeTalk: { appName: "aftereffects" },
    KeyframeEase: function (speed, influence) {
      this.speed = speed;
      this.influence = influence;
    },
    KeyframeInterpolationType: { LINEAR: 1, BEZIER: 2, HOLD: 3 },
    PropertyType: { PROPERTY: 1, GROUP: 2 },
    parseFloat: parseFloat,
    parseInt: parseInt,
    isNaN: isNaN
  };

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "quickkit.jsx" });

  return { sandbox: sandbox, undo: undo, app: app };
}

function expectPoint(rect, cell) {
  var x = cell.indexOf("left") >= 0
    ? rect.left
    : cell.indexOf("right") >= 0
      ? rect.left + rect.width
      : rect.left + rect.width / 2;
  var y = cell.indexOf("top") >= 0
    ? rect.top
    : cell.indexOf("bottom") >= 0
      ? rect.top + rect.height
      : rect.top + rect.height / 2;
  return [x, y];
}

/* ---------------- anchor ---------------- */

var CELLS = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right"
];

CELLS.forEach(function (cell) {
  test("anchor " + cell + " keeps the layer still under scale and rotation", function () {
    var layer = new MockLayer({
      rect: { left: 10, top: 20, width: 100, height: 60 },
      position: [300, 200],
      anchor: [50, 40],
      scale: [50, 50],
      rotation: 30
    });
    var comp = new MockComp();
    comp.selectedLayers = [layer];
    var world = createWorld(comp);

    var reference = layer.sourcePointToComp([10, 20]);
    var result = JSON.parse(world.sandbox.qkAnchorMove(cell));

    assert.strictEqual(result.ok, true, result.error);
    var after = layer.sourcePointToComp([10, 20]);
    close(after[0], reference[0], "x drift");
    close(after[1], reference[1], "y drift");

    var expected = expectPoint(layer.rect, cell);
    close(layer.transform.anchor[0], expected[0], "anchor x");
    close(layer.transform.anchor[1], expected[1], "anchor y");

    assert.strictEqual(world.undo.open, 1, "one undo group opened");
    assert.strictEqual(world.undo.close, 1, "one undo group closed");
    assert.ok(world.undo.names[0].indexOf("QuickKit") === 0, "undo group is named");
  });
});

test("anchor moves every selected layer", function () {
  var first = new MockLayer({ name: "A", index: 1, rect: { left: 0, top: 0, width: 80, height: 40 }, position: [100, 100] });
  var second = new MockLayer({ name: "B", index: 2, rect: { left: 5, top: 5, width: 200, height: 100 }, position: [500, 400], scale: [80, 120], rotation: -15 });
  var comp = new MockComp();
  comp.selectedLayers = [first, second];
  var world = createWorld(comp);

  var firstRef = first.sourcePointToComp([0, 0]);
  var secondRef = second.sourcePointToComp([5, 5]);
  var result = JSON.parse(world.sandbox.qkAnchorMove("middle-center"));

  assert.strictEqual(result.ok, true, result.error);
  close(first.sourcePointToComp([0, 0])[0], firstRef[0], "first x drift");
  close(second.sourcePointToComp([5, 5])[1], secondRef[1], "second y drift");
  assert.ok(result.message.indexOf("2 layers") >= 0, result.message);
});

test("anchor compensates through a parent chain", function () {
  var parent = new MockLayer({ name: "Parent", index: 5, rect: null, position: [0, 0] });
  var child = new MockLayer({ name: "Child", index: 6, rect: { left: 0, top: 0, width: 100, height: 100 }, position: [300, 300], scale: [150, 150], rotation: 45 });
  child.parent = parent;

  var comp = new MockComp();
  comp.selectedLayers = [child];
  var world = createWorld(comp);
  var reference = child.sourcePointToComp([50, 50]);

  var originalParentConvert = parent.compPointToSource.bind(parent);
  var parentCalls = 0;
  parent.compPointToSource = function (point) {
    parentCalls++;
    return originalParentConvert(point);
  };

  var result = JSON.parse(world.sandbox.qkAnchorMove("top-left"));
  assert.strictEqual(result.ok, true, result.error);
  assert.ok(parentCalls > 0, "parent space conversion was used");
  close(child.sourcePointToComp([50, 50])[0], reference[0], "x drift");
  close(child.sourcePointToComp([50, 50])[1], reference[1], "y drift");
});

test("center anchor uses the selection centre and keeps content still", function () {
  var first = new MockLayer({ name: "A", index: 1, rect: { left: 0, top: 0, width: 100, height: 100 }, position: [100, 100] });
  var second = new MockLayer({ name: "B", index: 2, rect: { left: 0, top: 0, width: 50, height: 50 }, position: [500, 300] });
  var comp = new MockComp();
  comp.selectedLayers = [first, second];
  var world = createWorld(comp);

  var cornersA = [[0, 0], [100, 0], [0, 100], [100, 100]].map(function (p) { return first.sourcePointToComp(p); });
  var cornersB = [[0, 0], [50, 0], [0, 50], [50, 50]].map(function (p) { return second.sourcePointToComp(p); });
  var all = cornersA.concat(cornersB);
  var minX = Math.min.apply(null, all.map(function (p) { return p[0]; }));
  var maxX = Math.max.apply(null, all.map(function (p) { return p[0]; }));
  var minY = Math.min.apply(null, all.map(function (p) { return p[1]; }));
  var maxY = Math.max.apply(null, all.map(function (p) { return p[1]; }));
  var centerX = (minX + maxX) / 2;
  var centerY = (minY + maxY) / 2;

  var refA = first.sourcePointToComp([0, 0]);
  var result = JSON.parse(world.sandbox.qkAnchorCenter());

  assert.strictEqual(result.ok, true, result.error);
  close(first.sourcePointToComp(first.transform.anchor)[0], centerX, "layer A anchor at centre x");
  close(second.sourcePointToComp(second.transform.anchor)[1], centerY, "layer B anchor at centre y");
  close(first.sourcePointToComp([0, 0])[0], refA[0], "content still");
});

test("anchor reports a missing composition", function () {
  var world = createWorld(null);
  var result = JSON.parse(world.sandbox.qkAnchorMove("top-left"));
  assert.strictEqual(result.ok, false);
  assert.ok(/No active composition/.test(result.error), result.error);
  assert.strictEqual(world.undo.open, 0, "no undo group on early error");
});

test("anchor reports an active item that is not a composition", function () {
  var world = createWorld({ name: "footage" });
  var result = JSON.parse(world.sandbox.qkAnchorMove("top-left"));
  assert.strictEqual(result.ok, false);
  assert.ok(/not a composition/.test(result.error), result.error);
});

test("anchor reports an empty selection", function () {
  var comp = new MockComp();
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkAnchorMove("top-left"));
  assert.strictEqual(result.ok, false);
  assert.ok(/Nothing selected/.test(result.error), result.error);
});

test("anchor refuses an unknown cell", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer()];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkAnchorMove("over-here"));
  assert.strictEqual(result.ok, false);
  assert.ok(/Unknown anchor position/.test(result.error), result.error);
});

test("anchor skips locked layers and reports them", function () {
  var locked = new MockLayer({ name: "Locked one", index: 1, locked: true });
  var free = new MockLayer({ name: "Free", index: 2 });
  var comp = new MockComp();
  comp.selectedLayers = [locked, free];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkAnchorMove("top-right"));
  assert.strictEqual(result.ok, true, result.error);
  assert.ok(/Locked one/.test(result.message), result.message);
  assert.ok(/1 layer/.test(result.message), result.message);
});

test("anchor fails when every layer is locked", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer({ name: "Locked", locked: true })];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkAnchorMove("top-left"));
  assert.strictEqual(result.ok, false);
  assert.ok(/Locked/.test(result.error), result.error);
  assert.strictEqual(world.undo.close, 1, "undo group still closed");
});

test("anchor reports layers without visible bounds", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer({ name: "Null", rect: null })];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkAnchorMove("bottom-right"));
  assert.strictEqual(result.ok, false);
  assert.ok(/No visible bounds/.test(result.error), result.error);
});

/* ---------------- layers ---------------- */

test("rename applies prefix, suffix and numbering", function () {
  var comp = new MockComp();
  comp.selectedLayers = [
    new MockLayer({ name: "Title", index: 1 }),
    new MockLayer({ name: "Body", index: 2 }),
    new MockLayer({ name: "CTA", index: 3 })
  ];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkLayersRename("UI_", "_v2", "", "", "1", "2", "1"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(comp.selectedLayers[0].name, "UI_Title_v2 01");
  assert.strictEqual(comp.selectedLayers[2].name, "UI_CTA_v2 03");
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);
});

test("rename does find and replace without numbering", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer({ name: "Layer 1 copy", index: 1 })];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkLayersRename("", "", "copy", "final", "1", "2", "0"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(comp.selectedLayers[0].name, "Layer 1 final");
});

test("rename supports the {n} token in the prefix", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer({ name: "Beat", index: 1 })];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkLayersRename("L_{n}_", "", "", "", "7", "3", "1"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(comp.selectedLayers[0].name, "L_007_Beat");
});

test("rename without settings explains what to do", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer()];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkLayersRename("", "", "", "", "1", "2", "0"));
  assert.strictEqual(result.ok, false);
  assert.ok(/Nothing to rename/.test(result.error), result.error);
});

test("stagger in frames uses the composition frame rate", function () {
  var first = new MockLayer({ name: "A", index: 1, startTime: 0 });
  var second = new MockLayer({ name: "B", index: 2, startTime: 1 });
  var third = new MockLayer({ name: "C", index: 3, startTime: 2 });
  var comp = new MockComp();
  comp.selectedLayers = [third, first, second];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkLayersStagger("5", "frames"));
  assert.strictEqual(result.ok, true, result.error);
  close(first.startTime, 0, "first");
  close(second.startTime, 0.2, "second");
  close(third.startTime, 0.4, "third");
});

test("stagger in seconds uses the raw value", function () {
  var first = new MockLayer({ name: "A", startTime: 2 });
  var second = new MockLayer({ name: "B", startTime: 3 });
  var comp = new MockComp();
  comp.selectedLayers = [first, second];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkLayersStagger("1.5", "seconds"));
  assert.strictEqual(result.ok, true, result.error);
  close(second.startTime, 3.5, "second start");
});

test("stagger rejects a zero offset", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer()];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkLayersStagger("0", "frames"));
  assert.strictEqual(result.ok, false);
  assert.ok(/greater than zero/.test(result.error), result.error);
});

test("null is created at the selection centre and parents the layers", function () {
  var first = new MockLayer({ name: "A", index: 1, rect: { left: 0, top: 0, width: 100, height: 100 }, position: [100, 100] });
  var second = new MockLayer({ name: "B", index: 2, rect: { left: 0, top: 0, width: 100, height: 100 }, position: [300, 300] });
  var comp = new MockComp();
  comp.selectedLayers = [first, second];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkLayersNull());
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(comp.layers.addNullCalls, 1);
  var nullLayer = comp.selectedLayers[2];
  assert.strictEqual(nullLayer.name, "QuickKit Null");
  close(nullLayer.transform.position[0], 250, "null x");
  close(nullLayer.transform.position[1], 250, "null y");
  assert.strictEqual(first.parent, nullLayer);
  assert.strictEqual(second.parent, nullLayer);
  assert.ok(/2 layers/.test(result.message), result.message);
});

test("sequence lays layers end to start", function () {
  var first = new MockLayer({ name: "A", index: 1, startTime: 0, duration: 2 });
  var second = new MockLayer({ name: "B", index: 2, startTime: 5, duration: 1 });
  var third = new MockLayer({ name: "C", index: 3, startTime: 9, duration: 3 });
  var comp = new MockComp();
  comp.selectedLayers = [third, first, second];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkLayersSequence());
  assert.strictEqual(result.ok, true, result.error);
  close(first.startTime, 0, "first");
  close(second.startTime, 2, "second");
  close(third.startTime, 3, "third");
});

test("sequence reports zero length layers", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer({ name: "Empty", startTime: 0, duration: 0 })];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkLayersSequence());
  assert.strictEqual(result.ok, false);
  assert.ok(/Zero length/.test(result.error), result.error);
});

test("precompose uses 1-based indices, a default name and moveAllAttributes", function () {
  var first = new MockLayer({ name: "A", index: 7 });
  var second = new MockLayer({ name: "B", index: 3 });
  var comp = new MockComp();
  comp.selectedLayers = [first, second];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkLayersPrecompose(""));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(comp.layers.precomposeCall.indices.join(","), "3,7");
  assert.strictEqual(comp.layers.precomposeCall.name, "QuickKit Precomp");
  assert.strictEqual(comp.layers.precomposeCall.moveAllAttributes, true);
  assert.ok(/QuickKit Precomp/.test(result.message), result.message);
});

test("precompose accepts a custom name", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer({ index: 2 })];
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkLayersPrecompose("  Hero build  "));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(comp.layers.precomposeCall.name, "Hero build");
});

/* ---------------- easing ---------------- */

function makeEaseLayer(property) {
  var layer = new MockLayer({ name: "Keyed", index: 1 });
  layer.groups.Transform = new MockGroup([property]);
  return layer;
}

test("easy ease sets bezier interpolation with 33.33 influence", function () {
  var property = new MockProperty({
    isSpatial: true,
    selectedKeys: [2],
    keys: [[0, [0, 0]], [1, [100, 100]]],
    value: [100, 100]
  });
  var comp = new MockComp();
  comp.selectedLayers = [makeEaseLayer(property)];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkEasingApply("easy"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(property.easeCalls.length, 1);
  assert.strictEqual(property.easeCalls[0].inEase.length, 1, "spatial properties take one ease object");
  close(property.easeCalls[0].inEase[0].influence, 33.33, "influence");
  assert.strictEqual(property.interpolationCalls[0].inType, 2, "bezier in");
  assert.strictEqual(property.interpolationCalls[0].outType, 2, "bezier out");
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);
});

test("strong ease uses 85 influence", function () {
  var property = new MockProperty({ selectedKeys: [1], keys: [[0, [0, 0]], [1, [10, 10]]], value: [10, 10] });
  var comp = new MockComp();
  comp.selectedLayers = [makeEaseLayer(property)];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkEasingApply("strong"));
  assert.strictEqual(result.ok, true, result.error);
  close(property.easeCalls[0].inEase[0].influence, 85, "influence");
});

test("2D non-spatial properties get one ease per dimension", function () {
  var property = new MockProperty({ selectedKeys: [1], keys: [[0, [100, 100]], [1, [200, 200]]], value: [200, 200], isSpatial: false });
  var comp = new MockComp();
  comp.selectedLayers = [makeEaseLayer(property)];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkEasingApply("easy"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(property.easeCalls[0].inEase.length, 2);
});

test("overshoot adds two keys after the destination", function () {
  var property = new MockProperty({
    isSpatial: true,
    selectedKeys: [2],
    keys: [[0, [0, 0]], [1, [100, 100]]],
    value: [100, 100]
  });
  var comp = new MockComp();
  comp.selectedLayers = [makeEaseLayer(property)];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkEasingApply("overshoot"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(property.inserted.length, 2, "two keys inserted");
  close(property.inserted[0].time, 1.08, "overshoot time");
  close(property.inserted[1].time, 1.2, "settle time");
  close(property.inserted[0].value[0], 112, "overshoot value");
  assert.deepStrictEqual(property.inserted[1].value, [100, 100]);
  assert.ok(/Added 2 keyframes/.test(result.message), result.message);
});

test("bounce adds four keys and settles on the value", function () {
  var property = new MockProperty({
    isSpatial: true,
    selectedKeys: [2],
    keys: [[0, [0, 0]], [1, [100, 100]]],
    value: [100, 100]
  });
  var comp = new MockComp();
  comp.selectedLayers = [makeEaseLayer(property)];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkEasingApply("bounce"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(property.inserted.length, 4);
  close(property.inserted[0].value[0], 92, "first bounce");
  close(property.inserted[1].value[0], 104, "second bounce");
  assert.deepStrictEqual(property.inserted[3].value, [100, 100]);
});

test("overshoot without a previous key explains the problem", function () {
  var property = new MockProperty({ selectedKeys: [1], keys: [[0, [0, 0]]], value: [0, 0] });
  var comp = new MockComp();
  comp.selectedLayers = [makeEaseLayer(property)];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkEasingApply("overshoot"));
  assert.strictEqual(result.ok, false);
  assert.ok(/previous key/.test(result.error), result.error);
});

test("overshoot refuses when the next keyframe leaves no room", function () {
  var property = new MockProperty({
    isSpatial: true,
    selectedKeys: [2],
    keys: [[0, [0, 0]], [1, [100, 100]], [1.1, [0, 0]]],
    value: [0, 0]
  });
  var comp = new MockComp();
  comp.selectedLayers = [makeEaseLayer(property)];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkEasingApply("overshoot"));
  assert.strictEqual(result.ok, false);
  assert.ok(/no room/.test(result.error), result.error);
});

test("easing reports an empty keyframe selection", function () {
  var property = new MockProperty({ selectedKeys: [], keys: [[0, [0, 0]]], value: [0, 0] });
  var comp = new MockComp();
  comp.selectedLayers = [makeEaseLayer(property)];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkEasingApply("easy"));
  assert.strictEqual(result.ok, false);
  assert.ok(/Select at least one keyframe/.test(result.error), result.error);
});

/* ---------------- text animations ---------------- */

function textAnimators(layer) {
  return layer.groups["ADBE Text Properties"].animators.children;
}

function textLayer(opts) {
  opts = opts || {};
  opts.text = true;
  return new MockLayer(opts);
}

test("fade keys opacity at both edges in one undo group", function () {
  var layer = new MockLayer({ name: "Title", duration: 5 });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("fade", "0.5", "0.25", "smooth", "1", "1", "left", "80"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(layer.opacity.keys.length, 4);
  close(layer.opacity.keys[0].time, 0.25, "in start");
  close(layer.opacity.keys[1].time, 0.75, "in end");
  close(layer.opacity.keys[2].time, 4.25, "out start");
  close(layer.opacity.keys[3].time, 4.75, "out end");
  assert.strictEqual(layer.opacity.keys[0].value, 0);
  assert.strictEqual(layer.opacity.keys[1].value, 100);
  assert.strictEqual(layer.opacity.keys[3].value, 0);
  assert.strictEqual(layer.opacity.easeCalls.length, 4, "every key gets an ease");
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);
  assert.ok(/fade in and out/.test(result.message), result.message);
});

test("slide moves position by the distance and returns to the original value", function () {
  var layer = new MockLayer({ name: "Cap", duration: 4, position: [300, 200] });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("slide", "1", "0", "linear", "1", "0", "left", "120"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(layer.position.keys.length, 2);
  assert.strictEqual(JSON.stringify(layer.position.keys[0].value), JSON.stringify([180, 200]));
  assert.strictEqual(JSON.stringify(layer.position.keys[1].value), JSON.stringify([300, 200]));
  close(layer.position.keys[0].time, 0, "in start");
  close(layer.position.keys[1].time, 1, "in end");
  assert.strictEqual(layer.position.interpolationCalls[0].inType, 1, "linear interpolation");
});

test("slide from above uses a vertical offset", function () {
  var layer = new MockLayer({ name: "Cap", duration: 4, position: [300, 200] });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("slide", "1", "0", "smooth", "1", "0", "up", "75"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(JSON.stringify(layer.position.keys[0].value), JSON.stringify([300, 125]));
});

test("pop scales from 80 per cent of the current scale", function () {
  var layer = new MockLayer({ name: "Cap", duration: 4, scale: [200, 150] });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("pop", "0.4", "0", "smooth", "1", "0", "left", "80"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(layer.scale.keys.length, 2);
  assert.strictEqual(JSON.stringify(layer.scale.keys[0].value), JSON.stringify([160, 120]));
  assert.strictEqual(JSON.stringify(layer.scale.keys[1].value), JSON.stringify([200, 150]));
});

test("only the in edge keys two values", function () {
  var layer = new MockLayer({ name: "Cap", duration: 4 });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("fade", "0.5", "0", "smooth", "1", "0", "left", "80"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(layer.opacity.keys.length, 2);
  close(layer.opacity.keys[0].time, 0, "in start");
  close(layer.opacity.keys[1].time, 0.5, "in end");
  assert.ok(/fade in to/.test(result.message), result.message);
});

test("only the out edge starts at the layer out point", function () {
  var layer = new MockLayer({ name: "Cap", duration: 4 });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("fade", "0.5", "0", "smooth", "0", "1", "left", "80"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(layer.opacity.keys.length, 2);
  close(layer.opacity.keys[0].time, 3.5, "out start");
  close(layer.opacity.keys[1].time, 4, "out end");
});

test("fade refuses a property that already has keys or an expression", function () {
  var keyed = new MockLayer({ name: "Keyed", duration: 4 });
  keyed.opacity.setValueAtTime(0, 100);
  var keyedComp = new MockComp();
  keyedComp.selectedLayers = [keyed];
  var keyedWorld = createWorld(keyedComp);
  var keyedResult = JSON.parse(keyedWorld.sandbox.qkTextApply("fade", "0.5", "0", "smooth", "1", "0", "left", "80"));
  assert.strictEqual(keyedResult.ok, false);
  assert.ok(/already has opacity keyframes/.test(keyedResult.error), keyedResult.error);

  var expressed = new MockLayer({ name: "Expressed", duration: 4 });
  expressed.opacity.expressionEnabled = true;
  var expressedComp = new MockComp();
  expressedComp.selectedLayers = [expressed];
  var expressedWorld = createWorld(expressedComp);
  var expressedResult = JSON.parse(expressedWorld.sandbox.qkTextApply("fade", "0.5", "0", "smooth", "1", "0", "left", "80"));
  assert.strictEqual(expressedResult.ok, false);
  assert.ok(/has an expression on opacity/.test(expressedResult.error), expressedResult.error);
});

test("typewriter builds a named animator with a keyed range selector", function () {
  var layer = textLayer({ name: "Title", duration: 4 });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("typewriter", "0.8", "0.2", "smooth", "1", "1", "left", "80"));
  assert.strictEqual(result.ok, true, result.error);

  var animators = textAnimators(layer);
  assert.strictEqual(animators.length, 1);
  var animator = animators[0];
  assert.strictEqual(animator.name, "QuickKit Typewriter");
  assert.strictEqual(animator.properties.children["ADBE Text Opacity"].value, 0);

  var selector = animator.selectors.children[0];
  assert.strictEqual(selector.end.value, 100);
  assert.strictEqual(selector.start.keys.length, 4);
  close(selector.start.keys[0].time, 0.2, "in start");
  close(selector.start.keys[1].time, 1, "in end");
  close(selector.start.keys[2].time, 3, "out start");
  close(selector.start.keys[3].time, 3.8, "out end");
  assert.strictEqual(selector.start.keys[0].value, 0);
  assert.strictEqual(selector.start.keys[1].value, 100);
  close(selector.start.keys[3].value, 0, "out end percentage");
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);
});

test("stagger adds the opacity and a rising position offset", function () {
  var layer = textLayer({ name: "Title", duration: 4 });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("stagger", "0.6", "0", "smooth", "1", "1", "left", "80"));
  assert.strictEqual(result.ok, true, result.error);
  var animator = textAnimators(layer)[0];
  assert.strictEqual(animator.name, "QuickKit Character Stagger");
  assert.strictEqual(
    JSON.stringify(animator.properties.children["ADBE Text Position 3D"].value),
    JSON.stringify([0, 40])
  );
});

test("blur adds a text blur amount", function () {
  var layer = textLayer({ name: "Title", duration: 4 });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("blur", "0.6", "0", "linear", "1", "0", "left", "80"));
  assert.strictEqual(result.ok, true, result.error);
  var animator = textAnimators(layer)[0];
  assert.strictEqual(animator.name, "QuickKit Blur Reveal");
  assert.strictEqual(animator.properties.children["ADBE Text Blur"].value, 20);
  assert.strictEqual(animator.selectors.children[0].start.interpolationCalls.length, 2);
});

test("applying the same animator twice replaces it instead of stacking", function () {
  var layer = textLayer({ name: "Title", duration: 4 });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  world.sandbox.qkTextApply("typewriter", "0.5", "0", "smooth", "1", "0", "left", "80");
  var first = textAnimators(layer)[0];
  var result = JSON.parse(world.sandbox.qkTextApply("typewriter", "0.5", "0", "smooth", "1", "0", "left", "80"));

  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(textAnimators(layer).length, 1);
  assert.strictEqual(first.removed, true);
  assert.strictEqual(world.undo.open, 2, "one undo group per press");
});

test("animator presets refuse non-text layers with a readable message", function () {
  var solid = new MockLayer({ name: "Solid", duration: 4 });
  var comp = new MockComp();
  comp.selectedLayers = [solid];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("typewriter", "0.5", "0", "smooth", "1", "0", "left", "80"));
  assert.strictEqual(result.ok, false);
  assert.ok(/needs text layers/.test(result.error), result.error);
  assert.ok(/Solid/.test(result.error), result.error);
});

test("fade still works on a non-text layer", function () {
  var solid = new MockLayer({ name: "Solid", duration: 4 });
  var comp = new MockComp();
  comp.selectedLayers = [solid];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("fade", "0.5", "0", "smooth", "1", "0", "left", "80"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(solid.opacity.keys.length, 2);
});

test("a mixed selection animates text and reports the rest", function () {
  var title = textLayer({ name: "Title", duration: 4 });
  var solid = new MockLayer({ name: "Solid", duration: 4 });
  var comp = new MockComp();
  comp.selectedLayers = [title, solid];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("typewriter", "0.5", "0", "smooth", "1", "0", "left", "80"));
  assert.strictEqual(result.ok, true, result.error);
  assert.ok(/1 layer/.test(result.message), result.message);
  assert.ok(/not a text layer: Solid/.test(result.message), result.message);
});

test("text animations skip locked layers", function () {
  var locked = textLayer({ name: "Locked title", duration: 4, locked: true });
  var comp = new MockComp();
  comp.selectedLayers = [locked];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("typewriter", "0.5", "0", "smooth", "1", "0", "left", "80"));
  assert.strictEqual(result.ok, false);
  assert.ok(/Locked title/.test(result.error), result.error);
  assert.strictEqual(textAnimators(locked).length, 0);
});

test("a layer shorter than both animations is skipped with the reason", function () {
  var layer = new MockLayer({ name: "Tiny", duration: 1 });
  var comp = new MockComp();
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var result = JSON.parse(world.sandbox.qkTextApply("fade", "0.6", "0", "smooth", "1", "1", "left", "80"));
  assert.strictEqual(result.ok, false);
  assert.ok(/too short for both animations/.test(result.error), result.error);
  assert.strictEqual(layer.opacity.keys.length, 0);
  assert.strictEqual(world.undo.close, 1, "undo group still closed");
});

test("text animation validates duration, kind and edges before touching layers", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer()];
  var world = createWorld(comp);

  var badKind = JSON.parse(world.sandbox.qkTextApply("wiggle", "0.5", "0", "smooth", "1", "0", "left", "80"));
  assert.strictEqual(badKind.ok, false);
  assert.ok(/Unknown text animation/.test(badKind.error), badKind.error);

  var badDuration = JSON.parse(world.sandbox.qkTextApply("fade", "0", "0", "smooth", "1", "0", "left", "80"));
  assert.strictEqual(badDuration.ok, false);
  assert.ok(/greater than zero/.test(badDuration.error), badDuration.error);

  var noEdges = JSON.parse(world.sandbox.qkTextApply("fade", "0.5", "0", "smooth", "0", "0", "left", "80"));
  assert.strictEqual(noEdges.ok, false);
  assert.ok(/Turn on Animate in/.test(noEdges.error), noEdges.error);
  assert.strictEqual(world.undo.open, 0, "nothing opened before validation");
});

/* ---------------- host info ---------------- */

test("host info still reports the adapter identity", function () {
  var comp = new MockComp();
  var world = createWorld(comp);
  var info = JSON.parse(world.sandbox.qkHostInfo());
  assert.strictEqual(info.ok, true);
  assert.strictEqual(info.host, "AEFT");
  assert.strictEqual(info.version, "26.5");
  assert.strictEqual(world.sandbox.qkPing(), "pong");
});

/* ---------------- report ---------------- */

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
