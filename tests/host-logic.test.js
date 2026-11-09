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
  this.removedKeys = [];
  this.propertyType = 1;
  this.propertyValueType = opts.propertyValueType || 1;
  this.matchName = opts.matchName || "";
  this.name = opts.name || "";
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

MockKeyable.prototype.valueAtTime = function (time) {
  if (this.keys.length) {
    var found = this.keys[0].value;
    for (var i = 0; i < this.keys.length; i++) {
      if (this.keys[i].time <= time) found = this.keys[i].value;
    }
    return found;
  }
  return this.value;
};

MockKeyable.prototype.keyTime = function (index) {
  return this.keys[index - 1].time;
};

MockKeyable.prototype.keyValue = function (index) {
  return this.keys[index - 1].value;
};

MockKeyable.prototype.keyInInterpolationType = function () {
  return 2;
};

MockKeyable.prototype.keyOutInterpolationType = function () {
  return 2;
};

MockKeyable.prototype.keyInTemporalEase = function () {
  return [{ speed: 0, influence: 33.3 }];
};

MockKeyable.prototype.keyOutTemporalEase = function () {
  return [{ speed: 0, influence: 33.3 }];
};

MockKeyable.prototype.removeKey = function (index) {
  this.removedKeys.push(index);
  this.keys.splice(index - 1, 1);
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

function MockTextDocument() {
  this.text = "QuickKit";
  this.font = "ArialMT";
  this.fontSize = 48;
  this.tracking = 0;
  this.leading = 0;
  this.baselineShift = 0;
  this.horizontalScale = 100;
  this.verticalScale = 100;
  this.applyFill = true;
  this.fillColor = [1, 1, 1];
  this.applyStroke = false;
  this.strokeColor = [0, 0, 0];
  this.strokeWidth = 0;
  this.fauxBold = false;
  this.fauxItalic = false;
  this.allCaps = false;
  this.smallCaps = false;
  this.strokeOverFill = false;
  this.justification = 0;
}

function MockTextProperties() {
  this.animators = new MockAnimatorBag();
  this.document = new MockKeyable({
    value: new MockTextDocument(),
    propertyValueType: 6,
    matchName: "ADBE Text Document",
    name: "Source Text"
  });
}

MockTextProperties.prototype.property = function (key) {
  if (key === "ADBE Text Animators") return this.animators;
  if (key === "ADBE Text Document") return this.document;
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
  this.inPoint = opts.inPoint !== undefined ? opts.inPoint : 0;
  this.outPoint = opts.duration !== undefined ? opts.duration : (this.inPoint + 5);
  this.parent = null;
  this.numProperties = 0;
  this.groups = opts.groups || {};
  this.parentLookups = 0;
  this.selectedProperties = opts.selectedProperties || [];

  if (opts.text) this.groups["ADBE Text Properties"] = new MockTextProperties();
  if (!this.groups["ADBE Effect Parade"]) {
    this.groups["ADBE Effect Parade"] = new MockEffectParade(opts.effects || []);
  }

  this.transform = {
    anchor: (opts.anchor || [0, 0]).slice(),
    position: (opts.position || [200, 150]).slice(),
    scale: (opts.scale || [100, 100]).slice(),
    opacity: opts.opacity !== undefined ? opts.opacity : 100,
    rotation: opts.rotation || 0
  };

  this.anchorPoint = new MockKeyable({
    propertyValueType: 2,
    matchName: "ADBE Anchor Point",
    name: "Anchor Point",
    get: function () {
      return self.transform.anchor.slice();
    },
    set: function (value) {
      self.transform.anchor = value.slice();
    }
  });

  this.position = new MockKeyable({
    propertyValueType: 2,
    matchName: "ADBE Position",
    name: "Position",
    get: function () {
      return self.transform.position.slice();
    },
    set: function (value) {
      self.transform.position = value.slice();
    }
  });

  this.scale = new MockKeyable({
    propertyValueType: 2,
    matchName: "ADBE Scale",
    name: "Scale",
    get: function () {
      return self.transform.scale.slice();
    },
    set: function (value) {
      self.transform.scale = value.slice();
    }
  });

  this.opacity = new MockKeyable({
    propertyValueType: 1,
    matchName: "ADBE Opacity",
    name: "Opacity",
    get: function () {
      return self.transform.opacity;
    },
    set: function (value) {
      self.transform.opacity = value;
    }
  });

  this.rotation = new MockKeyable({
    propertyValueType: 1,
    matchName: "ADBE Rotate Z",
    name: "Rotation",
    get: function () {
      return self.transform.rotation;
    },
    set: function (value) {
      self.transform.rotation = value;
    }
  });

  if (!this.groups["ADBE Transform Group"]) {
    this.groups["ADBE Transform Group"] = new MockTransformGroup(this);
  }
}

function MockTransformGroup(layer) {
  this.layer = layer;
  this.children = [layer.anchorPoint, layer.position, layer.scale, layer.rotation, layer.opacity];
  this.numProperties = this.children.length;
  this.propertyType = 2;
}

MockTransformGroup.prototype.property = function (key) {
  if (typeof key === "number") return this.children[key - 1] || null;
  if (key === "ADBE Anchor Point") return this.layer.anchorPoint;
  if (key === "ADBE Position") return this.layer.position;
  if (key === "ADBE Scale") return this.layer.scale;
  if (key === "ADBE Rotate Z") return this.layer.rotation;
  if (key === "ADBE Opacity") return this.layer.opacity;
  return null;
};

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

function MockEffect(name, matchName, params) {
  this.name = name;
  this.matchName = matchName;
  this.propertyType = 2;
  this.children = [];
  for (var i = 0; i < (params || []).length; i++) {
    this.children.push(
      new MockKeyable({
        value: params[i].value,
        propertyValueType: params[i].type || 1,
        matchName: params[i].match,
        name: params[i].name
      })
    );
  }
  this.numProperties = this.children.length;
}

MockEffect.prototype.property = function (index) {
  if (typeof index !== "number") return null;
  return this.children[index - 1] || null;
};

function MockEffectParade(effects) {
  this.children = effects || [];
  this.numProperties = this.children.length;
}

MockEffectParade.prototype.property = function (index) {
  if (typeof index !== "number") return null;
  return this.children[index - 1] || null;
};

MockEffectParade.prototype.addProperty = function (matchName) {
  if (matchName !== "ADBE Drop Shadow") return null;
  var effect = new MockEffect("Drop Shadow", "ADBE Drop Shadow", [
    { name: "Opacity", match: "ADBE Drop Shadow Opacity", value: 50, type: 1 }
  ]);
  this.children.push(effect);
  this.numProperties = this.children.length;
  return effect;
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

/* ---------------- mock ExtendScript file system ---------------- */

function mockParentPath(path) {
  var clean = String(path).replace(/\\/g, "/");
  var cut = clean.lastIndexOf("/");
  if (cut <= 0) return clean;
  return clean.substring(0, cut);
}

function mockBaseName(path) {
  var clean = String(path).replace(/\\/g, "/");
  var cut = clean.lastIndexOf("/");
  return cut >= 0 ? clean.substring(cut + 1) : clean;
}

function MockFileSystem() {
  this.files = {};
  this.folders = {};
  this.folders["C:/Users/Test"] = true;
  this.folders["C:/Users/Test/AppData"] = true;
  this.folders["C:/Users/Test/AppData/Roaming"] = true;
  this.folders["C:/Users/Test/Desktop"] = true;
  this.dialogPath = "";
  this.openPath = "";
  this.cancelDialog = false;
  this.readOnly = false;
}

function MockFile(fs, path) {
  this.fs = fs;
  this.fsName = String(path).replace(/\\/g, "/");
  this.name = mockBaseName(this.fsName);
  this.encoding = "UTF-8";
}

Object.defineProperty(MockFile.prototype, "exists", {
  get: function () {
    return Object.prototype.hasOwnProperty.call(this.fs.files, this.fsName);
  }
});

Object.defineProperty(MockFile.prototype, "length", {
  get: function () {
    return this.exists ? this.fs.files[this.fsName].length : 0;
  }
});

MockFile.prototype.open = function (mode) {
  if (mode === "w") {
    if (this.fs.readOnly) return false;
    this.fs.folders[mockParentPath(this.fsName)] = true;
    this.fs.files[this.fsName] = "";
    return true;
  }
  if (mode === "r") return this.exists;
  return false;
};

MockFile.prototype.read = function () {
  return this.exists ? this.fs.files[this.fsName] : null;
};

MockFile.prototype.write = function (text) {
  if (this.fs.readOnly) return false;
  this.fs.files[this.fsName] = (this.fs.files[this.fsName] || "") + String(text);
  return true;
};

MockFile.prototype.close = function () {};

MockFile.prototype.remove = function () {
  if (!this.exists) return true;
  delete this.fs.files[this.fsName];
  return true;
};

MockFile.prototype.rename = function (newName) {
  var target = mockParentPath(this.fsName) + "/" + String(newName);
  if (Object.prototype.hasOwnProperty.call(this.fs.files, target)) return false;
  this.fs.files[target] = this.fs.files[this.fsName];
  delete this.fs.files[this.fsName];
  this.fsName = target;
  this.name = String(newName);
  return true;
};

function MockFolder(fs, path) {
  this.fs = fs;
  this.fsName = String(path).replace(/\\/g, "/").replace(/\/$/, "");
  this.name = mockBaseName(this.fsName);
}

Object.defineProperty(MockFolder.prototype, "exists", {
  get: function () {
    return this.fs.folders[this.fsName] === true;
  }
});

MockFolder.prototype.create = function () {
  this.fs.folders[this.fsName] = true;
  return true;
};

MockFolder.prototype.getFiles = function (mask) {
  var out = [];
  var suffix = String(mask || "").replace(/^\*/, "");
  var self = this;
  Object.keys(this.fs.files).forEach(function (path) {
    if (mockParentPath(path) !== self.fsName) return;
    if (suffix && path.substring(path.length - suffix.length) !== suffix) return;
    out.push(new MockFile(self.fs, path));
  });
  return out;
};

Object.defineProperty(MockFolder.prototype, "parent", {
  get: function () {
    return new MockFolder(this.fs, mockParentPath(this.fsName));
  }
});

/* Bridge stand-in for the After Effects project: just enough of the item model,
   render queue and output module for the bridge code to run. */
function installAeBridge(app, options) {
  var opts = options || {};
  var failTemplates = opts.failTemplates || [];
  var state = {
    items: [],
    comps: [],
    queue: [],
    imported: [],
    saves: 0,
    templates: [],
    settings: [],
    sent: [],
    outputFile: null
  };

  function makeComp(name, width, height, duration, frameRate) {
    var comp = {
      name: name,
      typeName: "Composition",
      width: width,
      height: height,
      duration: duration,
      frameRate: frameRate,
      opened: 0,
      layers: {
        added: [],
        add: function (item) {
          var layer = {
            name: item && item.name ? item.name : "Layer",
            source: item,
            startTime: 0,
            inPoint: 0,
            outPoint: 0,
            stretch: 100,
            index: this.added.length + 1
          };
          this.added.push(layer);
          return layer;
        }
      }
    };
    comp.openInViewer = function () {
      comp.opened++;
    };
    state.comps.push(comp);
    state.items.push(comp);
    return comp;
  }

  var items = (app.project.items = app.project.items || {});
  items.addComp = function (name, width, height, pixelAspect, duration, frameRate) {
    var comp = makeComp(name, width, height, duration, frameRate);
    app.project.activeItem = comp;
    return comp;
  };

  app.project.item = function (index) {
    return state.items[index - 1] || null;
  };

  Object.defineProperty(app.project, "numItems", {
    get: function () {
      return state.items.length;
    }
  });

  app.project.importFile = function (importOptions) {
    var file = importOptions && importOptions.file ? importOptions.file : null;
    var item = {
      name: file ? mockBaseName(file.fsName) : "footage",
      typeName: "Footage",
      file: file
    };
    state.items.push(item);
    state.imported.push(item);
    return item;
  };

  app.project.save = function () {
    state.saves++;
  };

  var queue = state.queue;
  var queueList = new Proxy(
    {},
    {
      get: function (target, prop) {
        if (prop === "length") return queue.length;
        if (prop === "add") {
          return function (comp) {
            var module = null;
            var item = {
              comp: comp,
              index: queue.length + 1,
              settings: "",
              applyTemplate: function (name) {
                this.settings = name;
                state.settings.push(name);
              },
              outputModule: function () {
                return module;
              },
              remove: function () {
                var at = queue.indexOf(item);
                if (at >= 0) queue.splice(at, 1);
              }
            };
            module = {
              template: "",
              file: null,
              applyTemplate: function (name) {
                if (failTemplates.indexOf(name) >= 0) throw new Error("template " + name + " is not available");
                this.template = name;
                state.templates.push(name);
              }
            };
            item.outputModule = function () {
              return module;
            };
            queue.push(item);
            return item;
          };
        }
        if (typeof prop === "string" && /^[0-9]+$/.test(prop)) return queue[Number(prop) - 1];
        return target[prop];
      }
    }
  );

  app.project.renderQueue = { items: queueList };
  return state;
}

function createWorld(comp, options) {
  var opts = options || {};
  var undo = { open: 0, close: 0, names: [] };
  var fs = opts.fs || new MockFileSystem();

  var app = {
    version: "26.5",
    build: "26.5.0",
    project: {
      activeItem: comp,
      file: opts.projectFile !== undefined ? opts.projectFile : { name: "test.aep", fsName: "C:/Projects/test.aep" }
    },
    beginUndoGroup: function (name) {
      undo.open++;
      undo.names.push(name);
    },
    endUndoGroup: function () {
      undo.close++;
    }
  };

  var aeBridge = null;
  if (opts.bridge) {
    app.path = opts.appPath || "C:/Program Files/Adobe/Adobe After Effects 2026/Support Files";
    aeBridge = installAeBridge(app, opts);
  }

  function FileCtor(path) {
    return new MockFile(fs, path);
  }
  FileCtor.saveDialog = function () {
    if (fs.cancelDialog || fs.dialogPath === "") return null;
    return new MockFile(fs, fs.dialogPath);
  };
  FileCtor.openDialog = function () {
    if (fs.cancelDialog || fs.openPath === "") return null;
    return new MockFile(fs, fs.openPath);
  };

  function FolderCtor(path) {
    return new MockFolder(fs, path);
  }
  FolderCtor.userData = new MockFolder(fs, "C:/Users/Test/AppData/Roaming");
  FolderCtor.current = new MockFolder(fs, "C:/Users/Test/Desktop");

  function BridgeTalkCtor() {
    this.target = "";
    this.body = "";
    this.sent = false;
  }
  BridgeTalkCtor.appName = "aftereffects";
  BridgeTalkCtor.getTargets = function () {
    return opts.premiereRunning ? ["aftereffects", "premierepro"] : ["aftereffects"];
  };
  BridgeTalkCtor.prototype.send = function () {
    this.sent = true;
    BridgeTalkCtor.instances.push(this);
    return true;
  };
  BridgeTalkCtor.instances = [];

  var sandbox = {
    app: app,
    BridgeTalk: opts.bridge ? BridgeTalkCtor : { appName: "aftereffects" },
    File: FileCtor,
    Folder: FolderCtor,
    ImportOptions: function (file) {
      this.file = file;
    },
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

  return {
    sandbox: sandbox,
    undo: undo,
    app: app,
    fs: fs,
    bridge: aeBridge,
    bridgeTalk: sandbox.BridgeTalk
  };
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

/* ---------------- presets ---------------- */

var PRESET_ROOT = "C:/Users/Test/AppData/Roaming/QuickKit/presets";

function listPresets(world) {
  var result = JSON.parse(world.sandbox.qkPresetList());
  assert.strictEqual(result.ok, true, result.error);
  return result;
}

function presetByName(list, name) {
  for (var i = 0; i < list.presets.length; i++) {
    if (list.presets[i].name === name) return list.presets[i];
  }
  return null;
}

function presetStored(world, id) {
  var path = PRESET_ROOT + "/" + id + ".qkpreset";
  assert.ok(world.fs.files[path], "preset file exists: " + path);
  return JSON.parse(world.fs.files[path]);
}

test("preset store seeds 15 original starters once", function () {
  var world = createWorld(new MockComp());
  var first = listPresets(world);

  assert.strictEqual(first.presets.length, 15, "15 starters");
  assert.strictEqual(first.seeded, 15, "reports the seed");
  assert.deepStrictEqual(first.folders, ["Motion", "Styles", "Titles"]);
  assert.ok(first.root.indexOf("QuickKit/presets") >= 0, first.root);

  var files = Object.keys(world.fs.files).filter(function (name) {
    return /\.qkpreset$/.test(name);
  });
  assert.strictEqual(files.length, 15, "15 files on disk");
  assert.ok(world.fs.files[PRESET_ROOT + "/.seeded"], "seed marker written");

  var second = listPresets(world);
  assert.strictEqual(second.presets.length, 15, "no duplicate seed");
  assert.strictEqual(second.seeded, 0);
});

test("deleting every preset leaves the empty state and does not reseed", function () {
  var world = createWorld(new MockComp());
  listPresets(world);
  Object.keys(world.fs.files).forEach(function (path) {
    if (/\.qkpreset$/.test(path)) delete world.fs.files[path];
  });

  var list = listPresets(world);
  assert.strictEqual(list.presets.length, 0);
  assert.strictEqual(list.seeded, 0);
  assert.strictEqual(
    Object.keys(world.fs.files).filter(function (path) { return /\.qkpreset$/.test(path); }).length,
    0
  );
});

test("save captures keyframes relative to the layer in point and apply rebases them", function () {
  var source = new MockLayer({ name: "Source", inPoint: 1, opacity: 40 });
  source.opacity.setValueAtTime(1, 0);
  source.opacity.setValueAtTime(1.5, 40);
  var sourceComp = new MockComp();
  sourceComp.selectedLayers = [source];
  var world = createWorld(sourceComp);

  var saved = JSON.parse(world.sandbox.qkPresetSave("Source Fade", "Custom"));
  assert.strictEqual(saved.ok, true, saved.error);

  var list = listPresets(world);
  assert.strictEqual(list.presets.length, 1);
  var stored = presetStored(world, list.presets[0].id);
  assert.strictEqual(stored.layers[0].props[4].keys[0].t, 0);
  assert.strictEqual(stored.layers[0].props[4].keys[1].t, 0.5);

  var target = new MockLayer({ name: "Target", inPoint: 3, opacity: 100 });
  var targetComp = new MockComp();
  targetComp.selectedLayers = [target];
  world.sandbox.app.project.activeItem = targetComp;

  var applied = JSON.parse(world.sandbox.qkPresetApply(list.presets[0].id));
  assert.strictEqual(applied.ok, true, applied.error);
  assert.strictEqual(target.opacity.keys.length, 2);
  close(target.opacity.keys[0].time, 3, "first key follows the target in point");
  close(target.opacity.keys[1].time, 3.5, "second key keeps its offset");
  assert.strictEqual(target.opacity.keys[0].value, 0);
  assert.strictEqual(target.opacity.keys[1].value, 40);
  assert.strictEqual(world.undo.open, 1, "one undo group");
  assert.strictEqual(world.undo.close, 1);
});

test("applying a text style preset keeps the target text and changes its style", function () {
  var comp = new MockComp();
  var layer = new MockLayer({ text: true, name: "Title" });
  comp.selectedLayers = [layer];
  var world = createWorld(comp);

  var list = listPresets(world);
  var starter = presetByName(list, "Clean Lower Third");
  assert.ok(starter, "starter exists");

  var doc = layer.groups["ADBE Text Properties"].document.value;
  doc.text = "Hello world";
  doc.fontSize = 20;
  doc.fillColor = [0, 0, 0];

  var result = JSON.parse(world.sandbox.qkPresetApply(starter.id));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(doc.text, "Hello world", "text content preserved");
  assert.strictEqual(doc.fontSize, 48);
  assert.strictEqual(JSON.stringify(doc.fillColor), JSON.stringify([1, 1, 1]));
  assert.strictEqual(world.undo.close, 1);
});

test("a text style preset reports a non-text layer instead of crashing", function () {
  var comp = new MockComp();
  comp.selectedLayers = [new MockLayer({ name: "Solid" })];
  var world = createWorld(comp);
  var list = listPresets(world);
  var starter = presetByName(list, "Clean Lower Third");

  var result = JSON.parse(world.sandbox.qkPresetApply(starter.id));
  assert.strictEqual(result.ok, false);
  assert.ok(/Nothing was applied/.test(result.error), result.error);
  assert.strictEqual(world.undo.close, 1, "undo closed even when nothing changed");
});

test("a position preset applies as an offset from the target layer", function () {
  var target = new MockLayer({ name: "Target", inPoint: 2, position: [500, 300] });
  var comp = new MockComp();
  comp.selectedLayers = [target];
  var world = createWorld(comp);
  var starter = presetByName(listPresets(world), "Title Rise");

  var result = JSON.parse(world.sandbox.qkPresetApply(starter.id));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(target.position.keys.length, 2);
  close(target.position.keys[0].time, 2, "in point");
  assert.strictEqual(JSON.stringify(target.position.keys[0].value), JSON.stringify([500, 360]));
  assert.strictEqual(JSON.stringify(target.position.keys[1].value), JSON.stringify([500, 300]));
});

test("selected properties are captured alone and leave other properties alone", function () {
  var source = new MockLayer({ name: "Source", opacity: 40, position: [900, 500] });
  source.selectedProperties = [source.opacity];
  var sourceComp = new MockComp();
  sourceComp.selectedLayers = [source];
  var world = createWorld(sourceComp);

  var saved = JSON.parse(world.sandbox.qkPresetSave("Opacity only", ""));
  assert.strictEqual(saved.ok, true, saved.error);
  var list = listPresets(world);
  var stored = presetStored(world, list.presets[0].id);
  assert.strictEqual(stored.layers[0].props.length, 1);
  assert.strictEqual(stored.layers[0].props[0].match, "ADBE Opacity");

  var target = new MockLayer({ name: "Target", opacity: 100, position: [10, 10] });
  var targetComp = new MockComp();
  targetComp.selectedLayers = [target];
  world.sandbox.app.project.activeItem = targetComp;
  var applied = JSON.parse(world.sandbox.qkPresetApply(list.presets[0].id));
  assert.strictEqual(applied.ok, true, applied.error);
  assert.strictEqual(target.opacity.value, 40);
  assert.deepStrictEqual(target.position.value, [10, 10], "position untouched");
});

test("presets rename, favourite, move between folders and delete", function () {
  var world = createWorld(new MockComp());
  var list = listPresets(world);
  var id = list.presets[0].id;

  assert.strictEqual(JSON.parse(world.sandbox.qkPresetRename(id, "Renamed look")).ok, true);
  assert.strictEqual(JSON.parse(world.sandbox.qkPresetFavorite(id, "1")).ok, true);
  assert.strictEqual(JSON.parse(world.sandbox.qkFolderCreate("Custom")).ok, true);
  assert.strictEqual(JSON.parse(world.sandbox.qkPresetMove(id, "Custom")).ok, true);

  var renamed = presetByName(listPresets(world), "Renamed look");
  assert.ok(renamed);
  assert.strictEqual(renamed.favorite, true);
  assert.strictEqual(renamed.folder, "Custom");

  assert.strictEqual(JSON.parse(world.sandbox.qkFolderDelete("Custom")).ok, true);
  assert.strictEqual(presetByName(listPresets(world), "Renamed look").folder, "");

  assert.strictEqual(JSON.parse(world.sandbox.qkPresetDelete(id)).ok, true);
  assert.strictEqual(listPresets(world).presets.length, 14);
});

test("reorder is persisted and reflected by the next list", function () {
  var world = createWorld(new MockComp());
  var first = listPresets(world);
  var ids = first.presets.map(function (preset) { return preset.id; }).reverse();

  var result = JSON.parse(world.sandbox.qkPresetReorder(JSON.stringify(ids)));
  assert.strictEqual(result.ok, true, result.error);
  var second = listPresets(world);
  assert.strictEqual(second.presets[0].id, ids[0]);
  assert.strictEqual(second.presets[14].id, ids[14]);
});

test("export writes one pack and import merges it with fresh ids", function () {
  var world = createWorld(new MockComp());
  listPresets(world);
  world.fs.dialogPath = "C:/Users/Test/Desktop/MyPack";

  var exported = JSON.parse(world.sandbox.qkPresetExport(""));
  assert.strictEqual(exported.ok, true, exported.error);
  assert.ok(world.fs.files["C:/Users/Test/Desktop/MyPack.qkpack"], "pack written");
  var pack = JSON.parse(world.fs.files["C:/Users/Test/Desktop/MyPack.qkpack"]);
  assert.strictEqual(pack.presets.length, 15);

  world.fs.openPath = "C:/Users/Test/Desktop/MyPack.qkpack";
  var imported = JSON.parse(world.sandbox.qkPresetImport());
  assert.strictEqual(imported.ok, true, imported.error);
  var after = listPresets(world);
  assert.strictEqual(after.presets.length, 30);
  assert.ok(presetByName(after, "Clean Lower Third 2"), "duplicate names are suffixed");
});

test("a corrupt preset and a corrupt folder file are skipped without crashing", function () {
  var world = createWorld(new MockComp());
  listPresets(world);
  world.fs.files[PRESET_ROOT + "/broken.qkpreset"] = "{not json";
  world.fs.files[PRESET_ROOT + "/folders.json"] = "[]";

  var list = listPresets(world);
  assert.strictEqual(list.presets.length, 15);
  assert.ok(list.skipped.indexOf("broken.qkpreset") >= 0, list.skipped.join(","));
  assert.ok(/damaged/i.test(list.note), list.note);
});

test("a corrupt pack is rejected with a readable message", function () {
  var world = createWorld(new MockComp());
  listPresets(world);
  world.fs.files["C:/Users/Test/Desktop/bad.qkpack"] = "not a pack";
  world.fs.openPath = "C:/Users/Test/Desktop/bad.qkpack";

  var result = JSON.parse(world.sandbox.qkPresetImport());
  assert.strictEqual(result.ok, false);
  assert.ok(/not a QuickKit preset pack/.test(result.error), result.error);
  assert.strictEqual(listPresets(world).presets.length, 15);
});

test("saving with no selection and writing to a read-only store fail cleanly", function () {
  var empty = new MockComp();
  var world = createWorld(empty);
  var noSelection = JSON.parse(world.sandbox.qkPresetSave("Empty", ""));
  assert.strictEqual(noSelection.ok, false);
  assert.ok(/Nothing selected/.test(noSelection.error), noSelection.error);

  var layer = new MockLayer();
  empty.selectedLayers = [layer];
  world.fs.readOnly = true;
  var readOnly = JSON.parse(world.sandbox.qkPresetSave("Blocked", ""));
  assert.strictEqual(readOnly.ok, false);
  assert.ok(/could not write/i.test(readOnly.error), readOnly.error);
});

test("effect parameters are captured by match name and added to a target layer", function () {
  var source = new MockLayer({
    name: "Source",
    effects: [new MockEffect("Drop Shadow", "ADBE Drop Shadow", [
      { name: "Opacity", match: "ADBE Drop Shadow Opacity", value: 25, type: 1 }
    ])]
  });
  var sourceComp = new MockComp();
  sourceComp.selectedLayers = [source];
  var world = createWorld(sourceComp);

  var saved = JSON.parse(world.sandbox.qkPresetSave("Shadow", ""));
  assert.strictEqual(saved.ok, true, saved.error);
  var preset = listPresets(world).presets[0];
  var stored = presetStored(world, preset.id);
  var effectProp = null;
  for (var i = 0; i < stored.layers[0].props.length; i++) {
    if (stored.layers[0].props[i].scope === "effect") effectProp = stored.layers[0].props[i];
  }
  assert.ok(effectProp, "effect parameter captured");
  assert.strictEqual(effectProp.effectMatch, "ADBE Drop Shadow");

  var target = new MockLayer({ name: "Target" });
  var targetComp = new MockComp();
  targetComp.selectedLayers = [target];
  world.sandbox.app.project.activeItem = targetComp;
  var applied = JSON.parse(world.sandbox.qkPresetApply(preset.id));
  assert.strictEqual(applied.ok, true, applied.error);

  var parade = target.property("ADBE Effect Parade");
  assert.ok(parade, "effect was added");
  assert.strictEqual(parade.property(1).matchName, "ADBE Drop Shadow");
  assert.strictEqual(parade.property(1).property(1).value, 25);
});

test("a static preset clears target keyframes and sets the captured value", function () {
  var source = new MockLayer({ name: "Source", opacity: 40 });
  var sourceComp = new MockComp();
  sourceComp.selectedLayers = [source];
  var world = createWorld(sourceComp);
  var saved = JSON.parse(world.sandbox.qkPresetSave("Static opacity", ""));
  assert.strictEqual(saved.ok, true, saved.error);
  var preset = listPresets(world).presets[0];

  var target = new MockLayer({ name: "Target", opacity: 100 });
  target.opacity.setValueAtTime(0, 100);
  target.opacity.setValueAtTime(1, 0);
  var targetComp = new MockComp();
  targetComp.selectedLayers = [target];
  world.sandbox.app.project.activeItem = targetComp;

  var applied = JSON.parse(world.sandbox.qkPresetApply(preset.id));
  assert.strictEqual(applied.ok, true, applied.error);
  assert.strictEqual(target.opacity.keys.length, 0, "old keys replaced");
  assert.strictEqual(target.opacity.value, 40);
});

test("one saved layer applies to every selected layer in one undo group", function () {
  var comp = new MockComp();
  var first = new MockLayer({ name: "One" });
  var second = new MockLayer({ name: "Two" });
  comp.selectedLayers = [first, second];
  var world = createWorld(comp);
  var starter = presetByName(listPresets(world), "Fade In");

  var applied = JSON.parse(world.sandbox.qkPresetApply(starter.id));
  assert.strictEqual(applied.ok, true, applied.error);
  assert.strictEqual(first.opacity.keys.length, 2);
  assert.strictEqual(second.opacity.keys.length, 2);
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);
});

test("a locked target is skipped with a readable message", function () {
  var comp = new MockComp();
  var locked = new MockLayer({ name: "Locked", locked: true });
  comp.selectedLayers = [locked];
  var world = createWorld(comp);
  var starter = presetByName(listPresets(world), "Fade In");

  var applied = JSON.parse(world.sandbox.qkPresetApply(starter.id));
  assert.strictEqual(applied.ok, false);
  assert.ok(/Locked is locked/.test(applied.error), applied.error);
  assert.strictEqual(locked.opacity.keys.length, 0);
  assert.strictEqual(world.undo.close, 1);
});

test("a multi-layer preset maps onto selected layers in order", function () {
  var first = new MockLayer({ name: "One", opacity: 10 });
  var second = new MockLayer({ name: "Two", opacity: 20 });
  var sourceComp = new MockComp();
  sourceComp.selectedLayers = [first, second];
  var world = createWorld(sourceComp);
  var saved = JSON.parse(world.sandbox.qkPresetSave("Pair", ""));
  assert.strictEqual(saved.ok, true, saved.error);
  var preset = listPresets(world).presets[0];

  var target = new MockLayer({ name: "Target", opacity: 100 });
  var targetComp = new MockComp();
  targetComp.selectedLayers = [target];
  world.sandbox.app.project.activeItem = targetComp;
  var applied = JSON.parse(world.sandbox.qkPresetApply(preset.id));
  assert.strictEqual(applied.ok, true, applied.error);
  assert.strictEqual(target.opacity.value, 10, "first saved layer wins");
  assert.ok(/only 1 of 2/.test(applied.message), applied.message);
});

/* ---------------- mock Premiere Pro ----------------
 * A small model of the Premiere object model used by the Silence tool:
 * sequence -> audioTracks -> clips, sequence markers, and the QE razor.
 * It is a model, not Premiere: it proves the mapping and control flow only.
 */

function createPremiereWorld(options) {
  var opts = options || {};
  var undo = { open: 0, close: 0, names: [] };
  var nodeCounter = 0;
  var fs = opts.fs || new MockFileSystem();

  function TimeCtor(seconds) {
    var time = {
      seconds: typeof seconds === "number" ? seconds : 0,
      get ticks() {
        return String(Math.round(this.seconds * 254016000000));
      }
    };
    return time;
  }

  var world = {
    undo: undo,
    audioTracks: [],
    videoTracks: [],
    razors: 0,
    razorTimes: [],
    selection: [],
    qeEnabled: false,
    markers: [],
    imported: [],
    placed: [],
    playhead: 0,
    mgt: [],
    insertedMgt: [],
    projectSelection: [],
    moved: [],
    bins: []
  };

  function makeKeyParam(name, value, keyable) {
    var param = {
      displayName: name,
      _value: value,
      _keys: [],
      _values: [],
      _interp: [],
      _timeVarying: false,
      getValue: function () {
        return param._value;
      },
      setValue: function (next) {
        param._value = next;
      },
      areKeyframesSupported: function () {
        return keyable !== false;
      },
      isTimeVarying: function () {
        return param._timeVarying;
      },
      setTimeVarying: function (on) {
        param._timeVarying = !!on;
      },
      addKey: function (time) {
        param._keys.push(time);
      },
      getKeys: function () {
        return param._keys.slice(0);
      },
      setValueAtKey: function (time, next) {
        param._values.push({ time: time, value: next });
      },
      setInterpolationTypeAtKey: function (time, type) {
        param._interp.push({ time: time, type: type });
      }
    };
    return param;
  }

  function makeMotion() {
    var position = makeKeyParam("Position", [960, 540]);
    var scale = makeKeyParam("Scale", 100);
    var rotation = makeKeyParam("Rotation", 0);
    var anchor = makeKeyParam("Anchor Point", [960, 540]);
    return {
      displayName: "Motion",
      matchName: "AE.ADBE Motion",
      _params: { position: position, scale: scale, rotation: rotation, anchor: anchor },
      properties: liveList([position, scale, rotation, anchor])
    };
  }

  function makeOpacity() {
    var opacity = makeKeyParam("Opacity", 100);
    return {
      displayName: "Opacity",
      matchName: "AE.ADBE Opacity",
      _params: { opacity: opacity },
      properties: liveList([opacity])
    };
  }

  function makeMogrtComponent() {
    var text = makeKeyParam("Text", JSON.stringify({ textEditValue: "Title", fontTextRunLength: [5] }));
    var size = makeKeyParam("Size", 72);
    var bold = makeKeyParam("Bold", true);
    return {
      displayName: "Essential Graphics",
      matchName: "AE.ADBE MOGRT",
      properties: liveList([text, size, bold]),
      _params: { text: text, size: size, bold: bold }
    };
  }

  function liveList(list) {
    return new Proxy(
      {},
      {
        get: function (target, prop) {
          if (prop === "numItems" || prop === "numTracks") return list.length;
          if (typeof prop === "string" && /^[0-9]+$/.test(prop)) return list[Number(prop)];
          return target[prop];
        }
      }
    );
  }

  function newClip(track, spec) {
    var components = [
      {
        displayName: "Volume",
        properties: liveList([
          {
            label: "Level",
            value: 0,
            setValue: function (value) {
              this.value = value;
            }
          }
        ])
      }
    ];

    nodeCounter++;
    var clip = {
      name: spec.name || "clip",
      start: spec.start,
      end: spec.end,
      type: spec.type || (track && track._mediaType === "Audio" ? 2 : 1),
      inPoint: typeof spec.inPoint === "number" ? spec.inPoint : 0,
      speed: typeof spec.speed === "number" ? spec.speed : 1,
      nodeId: spec.nodeId || "node" + nodeCounter,
      projectItem: {
        getMediaPath: function () {
          return spec.path || "";
        }
      },
      components: liveList(components),
      _track: track,
      _components: components,
      _path: spec.path || ""
    };

    if (track && track._mediaType === "Video") {
      clip._motion = makeMotion();
      clip._opacity = makeOpacity();
      components.push(clip._motion);
      components.push(clip._opacity);
    }

    clip.remove = function (ripple) {
      var list = track._clips;
      var at = list.indexOf(clip);
      if (at < 0) throw new Error("clip is not on its track");
      var from = clip.start;
      var length = clip.end - clip.start;
      list.splice(at, 1);
      if (!ripple) return;
      /* Premiere ripples the tracks that follow: everything starting at or
         after the removed piece moves left by its length. */
      world.audioTracks.concat(world.videoTracks).forEach(function (each) {
        each._clips.forEach(function (other) {
          if (other.start >= from + length - 0.001) {
            other.start -= length;
            other.end -= length;
          }
        });
      });
    };

    return clip;
  }

  function addClip(track, spec) {
    var clip = newClip(track, spec);
    track._clips.push(clip);
    track._clips.sort(function (a, b) {
      return a.start - b.start;
    });
    return clip;
  }

  function razorList(track, time) {
    var list = track._clips;
    var i;
    var clip;
    var right;

    for (i = 0; i < list.length; i++) {
      clip = list[i];
      if (time <= clip.start + 0.0001 || time >= clip.end - 0.0001) continue;

      right = newClip(track, {
        name: clip.name,
        path: clip._path,
        nodeId: clip.nodeId,
        start: time,
        end: clip.end,
        inPoint: clip.inPoint + (time - clip.start) * clip.speed,
        speed: clip.speed
      });
      clip.end = time;
      list.splice(i + 1, 0, right);
      world.razors++;
      world.razorTimes.push(time);
      return true;
    }

    return false;
  }

  var markers = new Proxy(
    {},
    {
      get: function (target, prop) {
        if (prop === "numMarkers") return world.markers.length;
        if (typeof prop === "string" && /^[0-9]+$/.test(prop)) return world.markers[Number(prop)];
        if (prop === "createMarker") {
          return function (time) {
            var marker = {
              name: "",
              comments: "",
              start: time,
              end: time,
              color: -1,
              setColorByIndex: function (index) {
                this.color = index;
              },
              remove: function () {
                var at = world.markers.indexOf(marker);
                if (at >= 0) world.markers.splice(at, 1);
              }
            };
            world.markers.push(marker);
            return marker;
          };
        }
        return target[prop];
      }
    }
  );

  var sequence = {
    name: opts.name || "Silence test sequence",
    timebase: 10160640000, /* 254016000000 / 25 = 25 fps */
    frameSizeHorizontal: opts.width || 1920,
    frameSizeVertical: opts.height || 1080,
    markers: markers,
    getSelection: function () {
      return world.selection;
    },
    getPlayerPosition: function () {
      return new TimeCtor(world.playhead);
    },
    importMGT: function (path, ticks, vidTrackOffset, audTrackOffset) {
      world.mgt.push({
        path: path,
        ticks: ticks,
        vidTrackOffset: vidTrackOffset,
        audTrackOffset: audTrackOffset
      });
      if (opts.mogrtFails) return 0;
      var track = world.videoTracks[vidTrackOffset];
      if (!track) return 0;
      var start = Number(ticks) / 254016000000;
      var clip = addClip(track, { name: opts.mogrtName || "MOGRT title", path: path, start: start, end: start + 3 });
      var component =
        opts.mogrtComponent === undefined ? makeMogrtComponent() : opts.mogrtComponent;
      clip.getMGTComponent = function () {
        return component;
      };
      world.insertedMgt.push(clip);
      return clip;
    }
  };

  if (opts.bridge) {
    sequence.frameSizeHorizontal = opts.width || 1920;
    sequence.frameSizeVertical = opts.height || 1080;
  }

  var rootChildren = [];
  var rootItem = {
    name: "root",
    type: "ROOT",
    children: liveList(rootChildren),
    createBin: function (name) {
      var bin = {
        name: name,
        type: "BIN",
        _children: [],
        children: null,
        moveBin: function (target) {
          var at = rootChildren.indexOf(bin);
          if (at >= 0) rootChildren.splice(at, 1);
          if (target && target._children) target._children.push(bin);
        }
      };
      bin.children = liveList(bin._children);
      rootChildren.push(bin);
      world.bins.push(bin);
      return bin;
    }
  };

  var qeSequence = {
    getAudioTrackAt: function (index) {
      return {
        razor: function (time) {
          return razorList(world.audioTracks[index], time);
        }
      };
    },
    getVideoTrackAt: function (index) {
      return {
        razor: function (time) {
          return razorList(world.videoTracks[index], time);
        }
      };
    }
  };

  var qe = opts.noQe ? null : {
    project: {
      getActiveSequence: function () {
        return qeSequence;
      }
    }
  };

  var app = {
    version: "26.0.2",
    project: {
      activeSequence: opts.noSequence ? null : sequence,
      file: { name: "silence.prproj" },
      rootItem: rootItem,
      importFiles: function (paths) {
        (paths || []).forEach(function (renderPath) {
          var item = {
            name: mockBaseName(renderPath),
            children: null,
            getMediaPath: function () {
              return renderPath;
            }
          };
          rootChildren.push(item);
          world.imported.push(item);
        });
        return true;
      }
    },
    enableQE: function () {
      world.qeEnabled = true;
    },
    getCurrentProjectViewSelection: function () {
      return world.projectSelection;
    },
    beginUndoGroup: function (name) {
      undo.open++;
      undo.names.push(name);
    },
    endUndoGroup: function () {
      undo.close++;
    }
  };

  function FileCtor(path) {
    return new MockFile(fs, path);
  }

  function FolderCtor(path) {
    return new MockFolder(fs, path);
  }
  FolderCtor.userData = new MockFolder(fs, "C:/Users/Test/AppData/Roaming");
  FolderCtor.current = new MockFolder(fs, "C:/Users/Test/Desktop");

  var sandbox = {
    app: app,
    qe: qe,
    Time: TimeCtor,
    BridgeTalk: { appName: "premierepro" },
    File: opts.bridge ? FileCtor : function () {},
    Folder: opts.bridge ? FolderCtor : function () {},
    parseFloat: parseFloat,
    parseInt: parseInt,
    isNaN: isNaN
  };

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "quickkit.jsx" });

  sequence.audioTracks = liveList(world.audioTracks);
  sequence.videoTracks = liveList(world.videoTracks);

  world.sandbox = sandbox;
  world.app = app;
  world.sequence = sequence;

  world.addAudioTrack = function (name) {
    var track = { name: name, _clips: [], _mediaType: "Audio", locked: false };
    track.clips = liveList(track._clips);
    track.isLocked = function () {
      return track.locked;
    };
    track.setLocked = function (on) {
      track.locked = !!on;
    };
    world.audioTracks.push(track);
    return track;
  };

  world.addVideoTrack = function (name) {
    var track = { name: name, _clips: [], _mediaType: "Video", locked: false };
    track.clips = liveList(track._clips);
    track.isLocked = function () {
      return track.locked;
    };
    track.setLocked = function (on) {
      track.locked = !!on;
    };
    track.overwriteClip = function (item, seconds) {
      world.placed.push({ item: item, at: seconds, track: name, mode: "overwrite" });
      return true;
    };
    track.insertClip = function (item, seconds) {
      world.placed.push({ item: item, at: seconds, track: name, mode: "insert" });
      return true;
    };
    world.videoTracks.push(track);
    return track;
  };

  world.addClip = addClip;

  return world;
}

function silencePayloadFor(world, extra) {
  var targets = JSON.parse(world.sandbox.qkSilenceTargets("sequence"));
  var payload = { clips: [], padBefore: 0, padAfter: 0, minLength: 0 };
  var key;
  for (key in extra || {}) {
    if (extra.hasOwnProperty(key)) payload[key] = extra[key];
  }
  return { targets: targets, payload: payload };
}

test("silence targets lists the sequence audio clips", function () {
  var world = createPremiereWorld();
  var a1 = world.addAudioTrack("A1");
  var a2 = world.addAudioTrack("Dialogue");
  world.addClip(a1, { name: "Take 1", path: "D:\\Clips\\Take 1.wav", start: 0, end: 10, inPoint: 2 });
  world.addClip(a2, { name: "Music", path: "D:\\??\\? ??.mp3", start: 5, end: 20 });

  var result = JSON.parse(world.sandbox.qkSilenceTargets("sequence"));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.clips.length, 2);
  assert.strictEqual(result.clips[0].path, "D:\\Clips\\Take 1.wav");
  assert.strictEqual(result.clips[0].trackName, "A1");
  assert.strictEqual(result.clips[0].inPoint, 2);
  assert.strictEqual(result.clips[1].track, 1);
  assert.strictEqual(result.clips[1].path, "D:\\??\\? ??.mp3");
  assert.strictEqual(result.sequence.frameRate, 25);
  assert.strictEqual(result.sequence.end, 20);
  assert.strictEqual(world.undo.open, 0, "listing must not open an undo group");
});

test("silence targets narrows to the selected clips", function () {
  var world = createPremiereWorld();
  var a1 = world.addAudioTrack("A1");
  var first = world.addClip(a1, { name: "Keep", path: "C:\\a.wav", start: 0, end: 5 });
  world.addClip(a1, { name: "Skip", path: "C:\\b.wav", start: 5, end: 10 });

  world.selection = [{ nodeId: first.nodeId }];
  var one = JSON.parse(world.sandbox.qkSilenceTargets("selection"));
  assert.strictEqual(one.ok, true, one.error);
  assert.strictEqual(one.scope, "selection");
  assert.strictEqual(one.clips.length, 1);
  assert.strictEqual(one.clips[0].name, "Keep");

  world.selection = [];
  var fallback = JSON.parse(world.sandbox.qkSilenceTargets("selection"));
  assert.strictEqual(fallback.scope, "sequence");
  assert.strictEqual(fallback.clips.length, 2);
  assert.ok(fallback.notes.length >= 1, "the fallback is explained");
});

test("silence targets explains itself outside a Premiere sequence", function () {
  var comp = new MockComp();
  var world = createWorld(comp);
  var result = JSON.parse(world.sandbox.qkSilenceTargets("sequence"));
  assert.strictEqual(result.ok, false);
  assert.ok(/No open sequence/.test(result.error), result.error);
});

test("silence segments map source time through in point and speed", function () {
  var world = createPremiereWorld();
  var track = world.addAudioTrack("A1");
  world.addClip(track, { name: "Fast", path: "C:\\a.wav", start: 4, end: 14, inPoint: 10, speed: 2 });

  var targets = JSON.parse(world.sandbox.qkSilenceTargets("sequence"));
  var payload = {
    clips: [{ id: targets.clips[0].id, silences: [{ start: 12, end: 16 }] }],
    padBefore: 0,
    padAfter: 0,
    minLength: 0
  };

  var result = JSON.parse(world.sandbox.qkSilenceSegments(JSON.stringify(payload)));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.segments.length, 1);
  assert.ok(Math.abs(result.segments[0].start - 5) < 0.001, "start " + result.segments[0].start);
  assert.ok(Math.abs(result.segments[0].end - 7) < 0.001, "end " + result.segments[0].end);
  assert.strictEqual(result.count, 1);
  assert.ok(/2 s in total/.test(result.message), result.message);
});

test("silence segments keeps a gap only when every sounding track is quiet", function () {
  var world = createPremiereWorld();
  var a1 = world.addAudioTrack("A1");
  var a2 = world.addAudioTrack("A2");
  world.addClip(a1, { name: "Voice", path: "C:\\voice.wav", start: 0, end: 10 });
  world.addClip(a2, { name: "Room", path: "C:\\room.wav", start: 0, end: 10 });

  var targets = JSON.parse(world.sandbox.qkSilenceTargets("sequence"));
  var busy = {
    clips: [
      { id: targets.clips[0].id, silences: [{ start: 2, end: 4 }] },
      { id: targets.clips[1].id, silences: [] }
    ],
    padBefore: 0,
    padAfter: 0,
    minLength: 0
  };

  var blocked = JSON.parse(world.sandbox.qkSilenceSegments(JSON.stringify(busy)));
  assert.strictEqual(blocked.ok, true, blocked.error);
  assert.strictEqual(blocked.segments.length, 0, "the second track still has sound there");

  busy.clips[1].silences = [{ start: 1.5, end: 5 }];
  var shared = JSON.parse(world.sandbox.qkSilenceSegments(JSON.stringify(busy)));
  assert.strictEqual(shared.segments.length, 1);
  assert.ok(Math.abs(shared.segments[0].start - 2) < 0.001, "intersection start");
  assert.ok(Math.abs(shared.segments[0].end - 4) < 0.001, "intersection end");
});

test("silence segments applies padding and the minimum length", function () {
  var world = createPremiereWorld();
  var track = world.addAudioTrack("A1");
  world.addClip(track, { name: "Voice", path: "C:\\voice.wav", start: 0, end: 10 });

  var targets = JSON.parse(world.sandbox.qkSilenceTargets("sequence"));
  var payload = {
    clips: [{ id: targets.clips[0].id, silences: [{ start: 2, end: 4 }] }],
    padBefore: 0.25,
    padAfter: 0.5,
    minLength: 0
  };

  var padded = JSON.parse(world.sandbox.qkSilenceSegments(JSON.stringify(payload)));
  assert.strictEqual(padded.segments.length, 1);
  assert.ok(Math.abs(padded.segments[0].start - 2.25) < 0.001, "padded start");
  assert.ok(Math.abs(padded.segments[0].end - 3.5) < 0.001, "padded end");

  payload.minLength = 2;
  var dropped = JSON.parse(world.sandbox.qkSilenceSegments(JSON.stringify(payload)));
  assert.strictEqual(dropped.segments.length, 0);
  assert.ok(/No cuttable silence/.test(dropped.message), dropped.message);
});

test("silence segments clamps a gap that starts before the clip in point", function () {
  var world = createPremiereWorld();
  var track = world.addAudioTrack("A1");
  world.addClip(track, { name: "Trimmed", path: "C:\\a.wav", start: 0, end: 10, inPoint: 5 });

  var targets = JSON.parse(world.sandbox.qkSilenceTargets("sequence"));
  var payload = {
    clips: [{ id: targets.clips[0].id, silences: [{ start: 2, end: 8 }] }],
    padBefore: 0,
    padAfter: 0,
    minLength: 0
  };

  var result = JSON.parse(world.sandbox.qkSilenceSegments(JSON.stringify(payload)));
  assert.strictEqual(result.segments.length, 1);
  assert.ok(Math.abs(result.segments[0].start - 0) < 0.001, "clamped to the clip start");
  assert.ok(Math.abs(result.segments[0].end - 3) < 0.001, "end follows the in point");
});

test("silence segments refuses a payload from an older scan", function () {
  var world = createPremiereWorld();
  var track = world.addAudioTrack("A1");
  world.addClip(track, { name: "Voice", path: "C:\\voice.wav", start: 0, end: 10 });

  var stale = JSON.stringify({ clips: [{ id: "t9i9", silences: [] }] });
  var result = JSON.parse(world.sandbox.qkSilenceSegments(stale));
  assert.strictEqual(result.ok, false);
  assert.ok(/Scan again/.test(result.error), result.error);
});

test("mark mode adds coloured markers and nothing else, in one undo step", function () {
  var world = createPremiereWorld();
  var track = world.addAudioTrack("A1");
  world.addClip(track, { name: "Voice", path: "C:\\voice.wav", start: 0, end: 20 });

  var payload = {
    mode: "mark",
    segments: [{ start: 2, end: 4 }, { start: 6, end: 7 }],
    label: "QuickKit silence",
    colorIndex: 4
  };

  var result = JSON.parse(world.sandbox.qkSilenceApply(JSON.stringify(payload)));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(world.markers.length, 2);
  assert.strictEqual(world.markers[0].name, "QuickKit silence 1");
  assert.ok(Math.abs(world.markers[0].end - 4) < 0.001, "marker spans the gap");
  assert.strictEqual(world.markers[1].color, 4);
  assert.strictEqual(world.razors, 0, "marking never razors");
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);
  assert.ok(/coloured markers/.test(result.message), result.message);
});

test("delete mode razors both edges and ripples once per segment", function () {
  var world = createPremiereWorld();
  var video = world.addVideoTrack("V1");
  var a1 = world.addAudioTrack("A1");
  var a2 = world.addAudioTrack("A2");
  world.addClip(video, { name: "Picture", path: "", start: 0, end: 20 });
  world.addClip(a1, { name: "Voice", path: "C:\\voice.wav", start: 0, end: 20 });
  world.addClip(a2, { name: "Room", path: "C:\\room.wav", start: 0, end: 20 });

  var payload = {
    mode: "delete",
    segments: [{ start: 2, end: 4 }, { start: 10, end: 12 }],
    label: "QuickKit silence",
    colorIndex: 4
  };

  var result = JSON.parse(world.sandbox.qkSilenceApply(JSON.stringify(payload)));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);

  /* 2 audio + 1 video track, 4 edge times. */
  assert.strictEqual(world.razors, 12, "razor every track at every edge");

  var voice = world.audioTracks[0]._clips;
  assert.strictEqual(voice.length, 3, "two gaps leave three pieces");
  assert.ok(Math.abs(voice[0].start - 0) < 0.001 && Math.abs(voice[0].end - 2) < 0.001, "first piece");
  assert.ok(Math.abs(voice[1].start - 2) < 0.001 && Math.abs(voice[1].end - 8) < 0.001, "middle piece");
  assert.ok(Math.abs(voice[2].start - 8) < 0.001 && Math.abs(voice[2].end - 16) < 0.001, "last piece");

  var room = world.audioTracks[1]._clips;
  assert.strictEqual(room.length, 3, "the second audio track loses its pieces too");

  var picture = world.videoTracks[0]._clips;
  assert.strictEqual(picture.length, 3, "linked video is cut to the same length");
  assert.ok(Math.abs(picture[2].end - 16) < 0.001, "the sequence is 16 s long now");

  assert.ok(/2 silent gaps/.test(result.message), result.message);
});

test("mute mode silences the cut pieces and leaves the length alone", function () {
  var world = createPremiereWorld();
  var video = world.addVideoTrack("V1");
  var a1 = world.addAudioTrack("A1");
  world.addClip(video, { name: "Picture", path: "", start: 0, end: 20 });
  world.addClip(a1, { name: "Voice", path: "C:\\voice.wav", start: 0, end: 20 });

  var payload = { mode: "mute", segments: [{ start: 2, end: 4 }], label: "QuickKit silence", colorIndex: 4 };
  var result = JSON.parse(world.sandbox.qkSilenceApply(JSON.stringify(payload)));
  assert.strictEqual(result.ok, true, result.error);

  var track = world.audioTracks[0]._clips;
  assert.strictEqual(track.length, 3, "the gap is a separate piece");
  var last = track[track.length - 1];
  assert.ok(Math.abs(last.end - 20) < 0.001, "the sequence keeps its length: " + last.end);

  assert.strictEqual(world.videoTracks[0]._clips.length, 1, "mute mode leaves the picture unsplit");
  var muted = track.filter(function (clip) {
    return clip._components[0].properties[0].value === -96;
  });
  assert.strictEqual(muted.length, 1, "exactly the gap is muted");
  assert.ok(Math.abs(muted[0].start - 2) < 0.001 && Math.abs(muted[0].end - 4) < 0.001, "the muted piece is the gap");
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);
});

test("apply refuses every mode when the QE razor is missing", function () {
  var world = createPremiereWorld({ noQe: true });
  var a1 = world.addAudioTrack("A1");
  world.addClip(a1, { name: "Voice", path: "C:\\voice.wav", start: 0, end: 10 });

  var payload = { mode: "delete", segments: [{ start: 2, end: 4 }] };
  var result = JSON.parse(world.sandbox.qkSilenceApply(JSON.stringify(payload)));
  assert.strictEqual(result.ok, false);
  assert.ok(/razor/i.test(result.error), result.error);
  assert.strictEqual(world.audioTracks[0]._clips.length, 1, "nothing was cut");
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1, "the undo group is still closed");
});

test("clear markers removes the QuickKit ones only", function () {
  var world = createPremiereWorld();
  var track = world.addAudioTrack("A1");
  world.addClip(track, { name: "Voice", path: "C:\\voice.wav", start: 0, end: 10 });

  world.sequence.markers.createMarker(1).name = "Chapter 1";
  world.sequence.markers.createMarker(2).name = "QuickKit silence 1";
  world.sequence.markers.createMarker(3).name = "QuickKit silence 2";

  var result = JSON.parse(world.sandbox.qkSilenceClearMarkers());
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(world.markers.length, 1);
  assert.strictEqual(world.markers[0].name, "Chapter 1");
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);
});

test("apply rejects an unknown mode and an empty segment list", function () {
  var world = createPremiereWorld();
  var track = world.addAudioTrack("A1");
  world.addClip(track, { name: "Voice", path: "C:\\voice.wav", start: 0, end: 10 });

  var wrongMode = JSON.parse(
    world.sandbox.qkSilenceApply(JSON.stringify({ mode: "explode", segments: [{ start: 1, end: 2 }] }))
  );
  assert.strictEqual(wrongMode.ok, false);
  assert.ok(/Unknown mode/.test(wrongMode.error), wrongMode.error);

  var empty = JSON.parse(world.sandbox.qkSilenceApply(JSON.stringify({ mode: "delete", segments: [] })));
  assert.strictEqual(empty.ok, false);
  assert.ok(/No segments/.test(empty.error), empty.error);

  assert.strictEqual(world.undo.open, 0, "a rejected request changes nothing");
});

/* ---------------- bridge ---------------- */

var BRIDGE_PENDING = "C:/Users/Test/AppData/Roaming/QuickKit/bridge/pending";
var BRIDGE_RETURNS = "C:/Users/Test/AppData/Roaming/QuickKit/bridge/returns";
var BRIDGE_IMPORTS = "C:/Users/Test/AppData/Roaming/QuickKit/bridge/imports";

function bridgeHandoff(overrides) {
  var base = {
    format: "quickkit-handoff",
    version: 1,
    id: "h1",
    created: "2026-10-26 12:00",
    sequence: { name: "My Sequence", frameRate: 25, width: 1920, height: 1080, start: 2, duration: 4 },
    clips: [
      {
        name: "Clip A",
        path: "C:/Media/a.mov",
        track: 0,
        trackName: "V1",
        video: true,
        sequenceStart: 2,
        sequenceEnd: 6,
        duration: 4,
        inPoint: 1.5,
        outPoint: 5.5,
        speed: 1,
        mediaExists: true
      }
    ]
  };
  var key;
  for (key in overrides || {}) {
    if (overrides.hasOwnProperty(key)) base[key] = overrides[key];
  }
  return base;
}

function writeBridgeFile(fs, folder, name, record) {
  fs.folders[folder] = true;
  fs.files[folder + "/" + name] = typeof record === "string" ? record : JSON.stringify(record);
}

test("bridge sends a handoff with the used range and sequence format", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Media/a.mov"] = "media";
  var world = createPremiereWorld({ bridge: true, fs: fs, name: "My Sequence" });
  var track = world.addVideoTrack("V1");
  world.addClip(track, { name: "Clip A", path: "C:/Media/a.mov", start: 2, end: 6, inPoint: 1.5 });

  var result = JSON.parse(world.sandbox.qkBridgeSendToAe("sequence"));

  assert.strictEqual(result.ok, true, JSON.stringify(result.steps));
  assert.strictEqual(result.clips, 1);
  assert.ok(result.file.indexOf("/QuickKit/bridge/pending/") >= 0, result.file);

  var handoff = JSON.parse(fs.files[result.file]);
  assert.strictEqual(handoff.format, "quickkit-handoff");
  assert.strictEqual(handoff.sequence.name, "My Sequence");
  assert.strictEqual(handoff.sequence.frameRate, 25);
  assert.strictEqual(handoff.sequence.width, 1920);
  assert.strictEqual(handoff.sequence.height, 1080);
  close(handoff.sequence.start, 2, "handoff start");
  close(handoff.sequence.duration, 4, "handoff duration");
  assert.strictEqual(handoff.clips[0].name, "Clip A");
  assert.strictEqual(handoff.clips[0].path, "C:/Media/a.mov");
  close(handoff.clips[0].inPoint, 1.5, "clip in point");
  close(handoff.clips[0].outPoint, 5.5, "clip out point");
  assert.ok(handoff.note.indexOf("not Dynamic Link") >= 0, "handoff says what it is");
});

test("bridge sends only the selected clips when a selection is asked for", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Media/a.mov"] = "media";
  fs.files["C:/Media/b.mov"] = "media";
  var world = createPremiereWorld({ bridge: true, fs: fs });
  var track = world.addVideoTrack("V1");
  world.addClip(track, { name: "Clip A", path: "C:/Media/a.mov", start: 0, end: 2 });
  var chosen = world.addClip(track, { name: "Clip B", path: "C:/Media/b.mov", start: 4, end: 7 });
  world.selection = [chosen];

  var result = JSON.parse(world.sandbox.qkBridgeSendToAe("selection"));

  assert.strictEqual(result.ok, true, JSON.stringify(result.steps));
  var handoff = JSON.parse(fs.files[result.file]);
  assert.strictEqual(handoff.clips.length, 1);
  assert.strictEqual(handoff.clips[0].name, "Clip B");
  close(handoff.sequence.start, 4, "handoff starts at the selected clip");
});

test("bridge send explains a missing sequence and missing media", function () {
  var noSequence = createPremiereWorld({ bridge: true, noSequence: true });
  var missing = JSON.parse(noSequence.sandbox.qkBridgeSendToAe("sequence"));
  assert.strictEqual(missing.ok, false);
  assert.ok(/No open sequence/.test(missing.steps[0].detail), missing.steps[0].detail);

  var fs = new MockFileSystem();
  var world = createPremiereWorld({ bridge: true, fs: fs });
  var track = world.addVideoTrack("V1");
  world.addClip(track, { name: "Offline", path: "C:/Media/gone.mov", start: 0, end: 2 });

  var offline = JSON.parse(world.sandbox.qkBridgeSendToAe("sequence"));
  assert.strictEqual(offline.ok, false);
  assert.ok(/Every clip is offline/.test(offline.steps[offline.steps.length - 1].detail), JSON.stringify(offline.steps));
  assert.strictEqual(Object.keys(fs.files).length, 0, "nothing was written");
});

test("bridge import builds a comp and trims the layer to the used range", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Media/a.mov"] = "media";
  writeBridgeFile(fs, BRIDGE_PENDING, "h1.qkhandoff", bridgeHandoff());

  var world = createWorld(null, { bridge: true, fs: fs });
  var result = JSON.parse(world.sandbox.qkBridgeImport("h1"));

  assert.strictEqual(result.ok, true, JSON.stringify(result.steps));
  assert.strictEqual(world.bridge.comps.length, 1);

  var comp = world.bridge.comps[0];
  assert.strictEqual(comp.name, "My Sequence");
  assert.strictEqual(comp.width, 1920);
  assert.strictEqual(comp.height, 1080);
  assert.strictEqual(comp.frameRate, 25);
  close(comp.duration, 4, "comp duration");

  var layer = comp.layers.added[0];
  close(layer.startTime, -1.5, "layer start time");
  close(layer.inPoint, 0, "layer in point");
  close(layer.outPoint, 4, "layer out point");

  var record = JSON.parse(fs.files[BRIDGE_IMPORTS + "/my sequence.json"]);
  assert.strictEqual(record.format, "quickkit-import");
  assert.strictEqual(record.comp, "My Sequence");
  close(record.place.start, 2, "remembered start");
  assert.strictEqual(record.place.track, 0);
  assert.strictEqual(record.place.trackName, "V1");

  assert.ok(fs.files[BRIDGE_PENDING + "/h1.qkhandoff"] === undefined, "handoff filed away");
  assert.ok(fs.files[BRIDGE_IMPORTS.replace("imports", "imported") + "/h1.qkhandoff"], "handoff archived");
});

test("bridge import keeps later clips on their timeline offsets and speed", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Media/a.mov"] = "media";
  fs.files["C:/Media/b.mov"] = "media";
  var handoff = bridgeHandoff();
  handoff.clips.push({
    name: "Clip B",
    path: "C:/Media/b.mov",
    track: 0,
    trackName: "V1",
    video: true,
    sequenceStart: 5,
    sequenceEnd: 7,
    duration: 2,
    inPoint: 0.5,
    outPoint: 4.5,
    speed: 2,
    mediaExists: true
  });
  handoff.sequence.duration = 5;
  writeBridgeFile(fs, BRIDGE_PENDING, "h2.qkhandoff", handoff);

  var world = createWorld(null, { bridge: true, fs: fs });
  var result = JSON.parse(world.sandbox.qkBridgeImport("h2"));

  assert.strictEqual(result.ok, true, JSON.stringify(result.steps));
  var comp = world.bridge.comps[0];
  close(comp.duration, 5, "comp duration covers the last clip");

  var second = comp.layers.added[1];
  close(second.startTime, 2.5, "second layer start time");
  close(second.inPoint, 3, "second layer in point");
  close(second.outPoint, 5, "second layer out point");
  close(second.stretch, 50, "2x speed means 50% stretch");
});

test("bridge import makes a unique comp name and refuses a bad handoff", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Media/a.mov"] = "media";
  writeBridgeFile(fs, BRIDGE_PENDING, "h1.qkhandoff", bridgeHandoff());
  writeBridgeFile(fs, BRIDGE_PENDING, "h3.qkhandoff", bridgeHandoff({ id: "h3" }));
  writeBridgeFile(fs, BRIDGE_PENDING, "bad.qkhandoff", { format: "something-else", clips: [] });

  var world = createWorld(null, { bridge: true, fs: fs });
  var first = JSON.parse(world.sandbox.qkBridgeImport("h1"));
  var second = JSON.parse(world.sandbox.qkBridgeImport("h3"));
  var bad = JSON.parse(world.sandbox.qkBridgeImport("bad"));

  assert.strictEqual(first.ok, true, JSON.stringify(first.steps));
  assert.strictEqual(second.ok, true, JSON.stringify(second.steps));
  assert.strictEqual(world.bridge.comps[1].name, "My Sequence 2");

  assert.strictEqual(bad.ok, false);
  assert.ok(
    /not a QuickKit handoff/.test(bad.steps[bad.steps.length - 1].detail),
    JSON.stringify(bad.steps)
  );
});

test("bridge import fails cleanly when the footage is offline", function () {
  var fs = new MockFileSystem();
  writeBridgeFile(fs, BRIDGE_PENDING, "h1.qkhandoff", bridgeHandoff());

  var world = createWorld(null, { bridge: true, fs: fs });
  var result = JSON.parse(world.sandbox.qkBridgeImport("h1"));

  assert.strictEqual(result.ok, false);
  assert.ok(/not on disk/.test(result.steps[result.steps.length - 1].detail), JSON.stringify(result.steps));
  assert.strictEqual(world.bridge.comps.length, 0, "no comp was built");
});

test("bridge prepare queues the comp, applies a template and returns a plan", function () {
  var fs = new MockFileSystem();
  var world = createWorld(null, { bridge: true, fs: fs });
  world.app.project.activeItem = {
    typeName: "Composition",
    name: "Send back",
    width: 1920,
    height: 1080,
    frameRate: 25,
    duration: 4
  };

  var result = JSON.parse(world.sandbox.qkBridgePrepareRender("auto"));

  assert.strictEqual(result.ok, true, JSON.stringify(result.steps));
  assert.ok(result.plan, "plan returned");
  assert.strictEqual(result.plan.comp, "Send back");
  assert.strictEqual(result.plan.project, "C:/Projects/test.aep");
  assert.ok(/\/QuickKit\/bridge\/renders\//.test(result.plan.output), result.plan.output);
  assert.ok(/\.mov$/.test(result.plan.output), "QuickTime fallback writes .mov");
  assert.strictEqual(result.plan.extension, "mov");
  assert.strictEqual(world.bridge.saves, 1, "project saved for aerender");
  assert.strictEqual(world.bridge.queue.length, 1, "one render queue item");
  assert.ok(result.plan.output.indexOf("Send back") >= 0, "output is named after the comp");
});

test("bridge prepare walks the template list and fails when none exists", function () {
  var fs = new MockFileSystem();
  var someMissing = [
    "QuickTime",
    "Lossless",
    "H.264 - Match Render Settings - 15 Mbps",
    "Apple ProRes 422",
    "H.264",
    "Lossless with Alpha"
  ];
  var world = createWorld(null, { bridge: true, fs: fs, failTemplates: someMissing });
  world.app.project.activeItem = { typeName: "Composition", name: "Fallback", width: 1280, height: 720, frameRate: 30, duration: 2 };

  var result = JSON.parse(world.sandbox.qkBridgePrepareRender("auto"));
  assert.strictEqual(result.ok, true, JSON.stringify(result.steps));
  assert.strictEqual(result.plan.template, "Apple ProRes 422 HQ");
  assert.ok(/\.mov$/.test(result.plan.output), result.plan.output);

  var none = createWorld(null, {
    bridge: true,
    fs: new MockFileSystem(),
    failTemplates: [
      "QuickTime",
      "Lossless",
      "H.264 - Match Render Settings - 15 Mbps",
      "Apple ProRes 422 HQ",
      "Apple ProRes 422",
      "H.264",
      "Lossless with Alpha"
    ]
  });
  none.app.project.activeItem = { typeName: "Composition", name: "Nothing", width: 1920, height: 1080, frameRate: 25, duration: 1 };

  var failed = JSON.parse(none.sandbox.qkBridgePrepareRender("auto"));
  assert.strictEqual(failed.ok, false);
  assert.ok(/None of the output module templates/.test(failed.steps[failed.steps.length - 1].detail), JSON.stringify(failed.steps));
});

test("bridge prepare refuses an unsaved project", function () {
  var world = createWorld(null, { bridge: true, projectFile: null });
  world.app.project.file = null;
  world.app.project.activeItem = { typeName: "Composition", name: "Unsaved", width: 1920, height: 1080, frameRate: 25, duration: 1 };

  var result = JSON.parse(world.sandbox.qkBridgePrepareRender("auto"));
  assert.strictEqual(result.ok, false);
  assert.ok(/never been saved/.test(result.steps[1].detail), JSON.stringify(result.steps));
});

test("bridge finish writes a return file and places it when Premiere is running", function () {
  function run(premiereRunning) {
    var fs = new MockFileSystem();
    fs.files["C:/Media/a.mov"] = "media";
    writeBridgeFile(fs, BRIDGE_PENDING, "h1.qkhandoff", bridgeHandoff());

    var world = createWorld(null, { bridge: true, fs: fs, premiereRunning: premiereRunning });
    world.sandbox.qkBridgeImport("h1");

    var output = "C:/Users/Test/AppData/Roaming/QuickKit/bridge/renders/My Sequence 1.mov";
    fs.files[output] = "rendered";

    var payload = JSON.stringify({
      output: output,
      comp: "My Sequence",
      duration: 4,
      width: 1920,
      height: 1080,
      frameRate: 25
    });
    var result = JSON.parse(world.sandbox.qkBridgeFinishRender(payload));
    return { result: result, fs: fs, world: world };
  }

  var quiet = run(false);
  assert.strictEqual(quiet.result.ok, true, JSON.stringify(quiet.result.steps));
  assert.strictEqual(quiet.result.placed, false);
  var returnId = quiet.result.id;
  var record = JSON.parse(quiet.fs.files[BRIDGE_RETURNS + "/" + returnId + ".qkreturn"]);
  assert.strictEqual(record.format, "quickkit-return");
  assert.strictEqual(record.comp, "My Sequence");
  close(record.place.start, 2, "return remembers the start");
  assert.strictEqual(record.note.indexOf("not Dynamic Link") >= 0, true);

  var live = run(true);
  assert.strictEqual(live.result.placed, true);
  assert.strictEqual(live.world.bridgeTalk.instances.length, 1, "BridgeTalk was used");
  assert.ok(/qkBridgePlaceReturn/.test(live.world.bridgeTalk.instances[0].body), live.world.bridgeTalk.instances[0].body);
});

test("bridge finish refuses a missing render file", function () {
  var fs = new MockFileSystem();
  var world = createWorld(null, { bridge: true, fs: fs });

  var result = JSON.parse(
    world.sandbox.qkBridgeFinishRender(JSON.stringify({ output: "C:/nowhere/out.mov", comp: "Gone" }))
  );
  assert.strictEqual(result.ok, false);
  assert.ok(/no file at/i.test(result.steps[0].detail), result.steps[0].detail);
});

test("bridge place imports the render and puts it back at the original position", function () {
  var fs = new MockFileSystem();
  var render = "C:/Users/Test/AppData/Roaming/QuickKit/bridge/renders/My Sequence.mov";
  fs.files[render] = "rendered";
  writeBridgeFile(fs, BRIDGE_RETURNS, "r1.qkreturn", {
    format: "quickkit-return",
    version: 1,
    id: "r1",
    comp: "My Sequence",
    render: render,
    bytes: 8,
    duration: 4,
    place: { start: 2, track: 0, trackName: "V1" }
  });

  var world = createPremiereWorld({ bridge: true, fs: fs });
  world.addVideoTrack("V1");
  var result = JSON.parse(world.sandbox.qkBridgePlaceReturn("r1"));

  assert.strictEqual(result.ok, true, JSON.stringify(result.steps));
  assert.strictEqual(world.imported.length, 1, "render imported");
  assert.strictEqual(world.placed.length, 1, "render placed");
  close(world.placed[0].at, 2, "placed at the original start");
  assert.strictEqual(world.placed[0].track, "V1");
  assert.strictEqual(world.placed[0].mode, "overwrite");
  assert.ok(fs.files["C:/Users/Test/AppData/Roaming/QuickKit/bridge/placed/r1.qkreturn"], "return archived");
});

test("bridge place reports a missing render and honours a positionless comp", function () {
  var fs = new MockFileSystem();
  writeBridgeFile(fs, BRIDGE_RETURNS, "gone.qkreturn", {
    format: "quickkit-return",
    id: "gone",
    comp: "Missing",
    render: "C:/nowhere/missing.mov"
  });

  var world = createPremiereWorld({ bridge: true, fs: fs });
  world.addVideoTrack("V1");
  var missing = JSON.parse(world.sandbox.qkBridgePlaceReturn("gone"));
  assert.strictEqual(missing.ok, false);
  assert.ok(/is not at/.test(missing.steps[1].detail), JSON.stringify(missing.steps));
  assert.strictEqual(world.placed.length, 0);

  var render = "C:/Users/Test/AppData/Roaming/QuickKit/bridge/renders/No Position.mov";
  fs.files[render] = "rendered";
  writeBridgeFile(fs, BRIDGE_RETURNS, "nopos.qkreturn", {
    format: "quickkit-return",
    id: "nopos",
    comp: "No Position",
    render: render,
    place: null
  });

  var placed = JSON.parse(world.sandbox.qkBridgePlaceReturn("nopos"));
  assert.strictEqual(placed.ok, true, JSON.stringify(placed.steps));
  close(world.placed[0].at, 0, "positionless comp lands at 0");
});

test("bridge list reports handoffs and returns waiting", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Media/a.mov"] = "media";
  writeBridgeFile(fs, BRIDGE_PENDING, "h1.qkhandoff", bridgeHandoff());
  writeBridgeFile(fs, BRIDGE_RETURNS, "r1.qkreturn", {
    format: "quickkit-return",
    id: "r1",
    comp: "My Sequence",
    render: "C:/nowhere/My Sequence.mov",
    duration: 4,
    place: { start: 2, track: 0, trackName: "V1" }
  });

  var world = createWorld(null, { bridge: true, fs: fs });
  var result = JSON.parse(world.sandbox.qkBridgeList());

  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.pending.length, 1);
  assert.strictEqual(result.returns.length, 1);
  assert.strictEqual(result.pending[0].comp, "My Sequence");
  assert.strictEqual(result.pending[0].clips, 1);
  assert.strictEqual(result.returns[0].comp, "My Sequence");
  assert.strictEqual(result.returns[0].renderExists, false);
});

/* ---------------- Part 6D: Premiere library ---------------- */

function prPlan(channels, extra) {
  var plan = {
    version: 1,
    id: "test-recipe",
    name: "Test recipe",
    easing: "smooth",
    duration: 0.5,
    channels: channels
  };
  var key;
  for (key in extra || {}) {
    if (extra.hasOwnProperty(key)) plan[key] = extra[key];
  }
  return plan;
}

function prItem(world, name, mediaPath, type) {
  var item = {
    name: name,
    type: type || "CLIP",
    getMediaPath: function () {
      return mediaPath;
    },
    isSequence: function () {
      return false;
    },
    moveBin: function (bin) {
      world.moved.push({ item: item, bin: bin.name });
    }
  };
  return item;
}

test("premiere context reports the sequence, playhead and tracks", function () {
  var world = createPremiereWorld();
  var v1 = world.addVideoTrack("V1");
  world.addVideoTrack("Titles");
  world.addClip(v1, { name: "Shot", start: 0, end: 4 });
  world.playhead = 1.5;

  var result = JSON.parse(world.sandbox.qkPrContext());
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.sequence, "Silence test sequence");
  close(result.playhead, 1.5, "playhead");
  assert.strictEqual(result.ticks, String(Math.round(1.5 * 254016000000)));
  assert.strictEqual(result.tracks.length, 2);
  assert.strictEqual(result.tracks[1].name, "Titles");
  assert.strictEqual(result.tracks[0].clips, 1);
  assert.strictEqual(result.tracks[0].locked, false);
});

test("premiere context fails cleanly with no open sequence", function () {
  var world = createPremiereWorld({ noSequence: true });
  var result = JSON.parse(world.sandbox.qkPrContext());
  assert.strictEqual(result.ok, false);
  assert.ok(/No open sequence/.test(result.error), result.error);
});

test("a recipe keys Opacity on the selected clip in one undo group", function () {
  var world = createPremiereWorld();
  var v1 = world.addVideoTrack("V1");
  var clip = world.addClip(v1, { name: "Shot", start: 2, end: 6 });
  world.selection = [clip];

  var plan = prPlan({
    opacity: [
      { edge: "in", at: 0, value: 0 },
      { edge: "in", at: 1, value: "base" }
    ]
  });
  var result = JSON.parse(
    world.sandbox.qkPrRecipeApply(JSON.stringify({ plan: plan, target: "selected" }))
  );

  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.clips, 1);
  assert.strictEqual(result.keys, 2);
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);
  assert.ok(/Apply Test recipe/.test(world.undo.names[0]));

  var param = clip._opacity._params.opacity;
  assert.strictEqual(param._timeVarying, true);
  assert.strictEqual(param._values.length, 2);
  close(param._values[0].time.seconds, 2, "first key at the clip start");
  close(param._values[1].time.seconds, 2.5, "second key at the end of the window");
  close(param._values[0].value, 0, "starts transparent");
  close(param._values[1].value, 100, "settles on the clip's own opacity");
  assert.strictEqual(param._interp[0].type, 5, "smooth maps to bezier");
});

test("a slide recipe offsets Position by a fraction of the frame", function () {
  var world = createPremiereWorld();
  var v1 = world.addVideoTrack("V1");
  var clip = world.addClip(v1, { name: "Shot", start: 0, end: 4 });
  world.selection = [clip];

  var plan = prPlan({
    position: [
      { edge: "in", at: 0, dx: -0.4, dy: 0 },
      { edge: "in", at: 1, dx: 0, dy: 0 }
    ]
  });
  var result = JSON.parse(
    world.sandbox.qkPrRecipeApply(JSON.stringify({ plan: plan, target: "selected" }))
  );

  assert.strictEqual(result.ok, true, result.error);
  var values = clip._motion._params.position._values;
  assert.strictEqual(values.length, 2);
  close(values[0].value[0], 960 - 0.4 * 1920, "starts 40% left of base");
  close(values[0].value[1], 540, "vertical stays at base");
  close(values[1].value[0], 960, "settles at base x");
});

test("a recipe can target the clip under the playhead", function () {
  var world = createPremiereWorld();
  var v1 = world.addVideoTrack("V1");
  var clip = world.addClip(v1, { name: "Shot", start: 2, end: 6 });
  world.playhead = 3;

  var plan = prPlan({
    rotation: [
      { edge: "in", at: 0, value: -90 },
      { edge: "in", at: 1, value: "base" }
    ]
  });
  var result = JSON.parse(
    world.sandbox.qkPrRecipeApply(
      JSON.stringify({ plan: plan, target: "playhead", trackIndex: 0 })
    )
  );

  assert.strictEqual(result.ok, true, result.error);
  var values = clip._motion._params.rotation._values;
  close(values[0].value, -90, "rotation offset is added to base");
  close(values[1].value, 0, "settles at the base rotation");
});

test("a recipe fails clearly when nothing is selected", function () {
  var world = createPremiereWorld();
  world.addVideoTrack("V1");
  var plan = prPlan({ opacity: [{ edge: "in", at: 0, value: 0 }, { edge: "in", at: 1, value: 100 }] });
  var result = JSON.parse(
    world.sandbox.qkPrRecipeApply(JSON.stringify({ plan: plan, target: "selected" }))
  );
  assert.strictEqual(result.ok, false);
  assert.ok(/Nothing is selected/.test(result.error), result.error);
});

test("a recipe refuses a clip on a locked track", function () {
  var world = createPremiereWorld();
  var v1 = world.addVideoTrack("V1");
  var clip = world.addClip(v1, { name: "Shot", start: 0, end: 4 });
  v1.setLocked(1);
  world.selection = [clip];

  var plan = prPlan({ opacity: [{ edge: "in", at: 0, value: 0 }, { edge: "in", at: 1, value: 100 }] });
  var result = JSON.parse(
    world.sandbox.qkPrRecipeApply(JSON.stringify({ plan: plan, target: "selected" }))
  );

  assert.strictEqual(result.ok, false);
  assert.ok(/locked/.test(result.error), result.error);
  assert.strictEqual(clip._opacity._params.opacity._values.length, 0, "nothing was keyed");
  assert.strictEqual(world.undo.open, world.undo.close, "undo closed on the error path");
});

test("a recipe skips an audio-only selection with a reason", function () {
  var world = createPremiereWorld();
  var a1 = world.addAudioTrack("A1");
  var clip = world.addClip(a1, { name: "Take", start: 0, end: 4, path: "D:\\a.wav" });
  world.selection = [clip];

  var plan = prPlan({ opacity: [{ edge: "in", at: 0, value: 0 }, { edge: "in", at: 1, value: 100 }] });
  var result = JSON.parse(
    world.sandbox.qkPrRecipeApply(JSON.stringify({ plan: plan, target: "selected" }))
  );

  assert.strictEqual(result.ok, false);
  assert.ok(/Only audio clips/.test(result.error), result.error);
});

test("a recipe skips a channel that already has keyframes", function () {
  var world = createPremiereWorld();
  var v1 = world.addVideoTrack("V1");
  var clip = world.addClip(v1, { name: "Shot", start: 0, end: 4 });
  world.selection = [clip];

  var opacity = clip._opacity._params.opacity;
  opacity._timeVarying = true;
  opacity._keys.push({ seconds: 1 });

  var plan = prPlan({ opacity: [{ edge: "in", at: 0, value: 0 }, { edge: "in", at: 1, value: 100 }] });
  var result = JSON.parse(
    world.sandbox.qkPrRecipeApply(JSON.stringify({ plan: plan, target: "selected" }))
  );

  assert.strictEqual(result.ok, false);
  assert.ok(/already has keyframes/.test(result.error), result.error);
  assert.strictEqual(opacity._values.length, 0, "the existing keys were left alone");
});

test("the host re-clamps a hand-edited recipe plan", function () {
  var world = createPremiereWorld();
  var v1 = world.addVideoTrack("V1");
  var clip = world.addClip(v1, { name: "Shot", start: 0, end: 4 });
  world.selection = [clip];

  var plan = prPlan(
    {
      opacity: [{ edge: "in", at: 0, value: 500 }],
      position: [{ edge: "in", at: 0, dx: 9, dy: -9 }]
    },
    { duration: 99 }
  );
  var result = JSON.parse(
    world.sandbox.qkPrRecipeApply(JSON.stringify({ plan: plan, target: "selected" }))
  );

  assert.strictEqual(result.ok, true, result.error);
  var opacity = clip._opacity._params.opacity;
  close(opacity._values[0].value, 100, "opacity clamped to 100");
  var position = clip._motion._params.position._values[0].value;
  close(position[0], 960 + 2 * 1920, "dx clamped to 2 frames wide");
  close(position[1], 540 - 2 * 1080, "dy clamped to 2 frames high");
});

test("a MOGRT inserts at the playhead on the chosen track", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Library/title.mogrt"] = "mogrt";
  var world = createPremiereWorld({ bridge: true, fs: fs });
  world.addVideoTrack("V1");
  world.addVideoTrack("V2");
  world.playhead = 4;

  var result = JSON.parse(
    world.sandbox.qkPrMogrtInsert(
      JSON.stringify({ path: "C:/Library/title.mogrt", trackIndex: 1 })
    )
  );

  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(world.mgt.length, 1);
  assert.strictEqual(world.mgt[0].vidTrackOffset, 1, "inserted on the chosen track");
  assert.strictEqual(world.mgt[0].ticks, String(Math.round(4 * 254016000000)));
  assert.strictEqual(world.insertedMgt.length, 1);
  close(world.insertedMgt[0].start, 4, "starts at the playhead");
  assert.strictEqual(result.params.length, 3);
  assert.strictEqual(result.params[0].kind, "text");
  assert.strictEqual(result.params[0].text, "Title");
  assert.strictEqual(result.params[1].kind, "number");
  assert.strictEqual(result.params[2].kind, "checkbox");
  assert.strictEqual(world.undo.open, world.undo.close, "undo closed");
});

test("a MOGRT insert fails cleanly when Premiere refuses", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Library/title.mogrt"] = "mogrt";
  var world = createPremiereWorld({ bridge: true, fs: fs, mogrtFails: true });
  world.addVideoTrack("V1");

  var result = JSON.parse(
    world.sandbox.qkPrMogrtInsert(JSON.stringify({ path: "C:/Library/title.mogrt", trackIndex: 0 }))
  );
  assert.strictEqual(result.ok, false);
  assert.ok(/did not insert/.test(result.error), result.error);
});

test("MOGRT text is written back as the JSON payload", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Library/title.mogrt"] = "mogrt";
  var world = createPremiereWorld({ bridge: true, fs: fs });
  world.addVideoTrack("V1");
  var inserted = JSON.parse(
    world.sandbox.qkPrMogrtInsert(JSON.stringify({ path: "C:/Library/title.mogrt", trackIndex: 0 }))
  );

  var result = JSON.parse(
    world.sandbox.qkPrMogrtSetText(
      JSON.stringify({ nodeId: inserted.nodeId, index: 0, text: "Hello\nWorld" })
    )
  );

  assert.strictEqual(result.ok, true, result.error);
  var payload = JSON.parse(world.insertedMgt[0].getMGTComponent()._params.text.getValue());
  assert.strictEqual(payload.textEditValue, "Hello\nWorld");
  assert.deepStrictEqual(payload.fontTextRunLength, [11]);
});

test("MOGRT text refuses a control that does not hold text", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Library/title.mogrt"] = "mogrt";
  var world = createPremiereWorld({ bridge: true, fs: fs });
  world.addVideoTrack("V1");
  var inserted = JSON.parse(
    world.sandbox.qkPrMogrtInsert(JSON.stringify({ path: "C:/Library/title.mogrt", trackIndex: 0 }))
  );

  var result = JSON.parse(
    world.sandbox.qkPrMogrtSetText(
      JSON.stringify({ nodeId: inserted.nodeId, index: 1, text: "nope" })
    )
  );
  assert.strictEqual(result.ok, false);
  assert.ok(/does not hold text/.test(result.error), result.error);
});

test("MOGRT parameters can be re-read by node id", function () {
  var fs = new MockFileSystem();
  fs.files["C:/Library/title.mogrt"] = "mogrt";
  var world = createPremiereWorld({ bridge: true, fs: fs });
  world.addVideoTrack("V1");
  var inserted = JSON.parse(
    world.sandbox.qkPrMogrtInsert(JSON.stringify({ path: "C:/Library/title.mogrt", trackIndex: 0 }))
  );

  var result = JSON.parse(
    world.sandbox.qkPrMogrtParams(JSON.stringify({ nodeId: inserted.nodeId }))
  );
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.params.length, 3);
  assert.strictEqual(result.params[1].value, 72);
});

test("the bin organizer creates the four standard bins once", function () {
  var world = createPremiereWorld();
  var first = JSON.parse(world.sandbox.qkPrBins(JSON.stringify({ action: "create" })));
  assert.strictEqual(first.ok, true, first.error);
  assert.deepStrictEqual(first.created, ["Footage", "Audio", "Graphics", "Exports"]);

  var second = JSON.parse(world.sandbox.qkPrBins(JSON.stringify({ action: "create" })));
  assert.strictEqual(second.created.length, 0);
  assert.deepStrictEqual(second.existing, ["Footage", "Audio", "Graphics", "Exports"]);
  assert.strictEqual(world.bins.length, 4, "no duplicate bins");
});

test("the bin organizer sorts the project selection by type", function () {
  var world = createPremiereWorld();
  var footage = prItem(world, "A001.mov", "C:/Media/A001.mov");
  var audio = prItem(world, "Take.wav", "C:/Media/Take.wav");
  var still = prItem(world, "Card.png", "C:/Media/Card.png");
  var sequence = prItem(world, "Cut 1", "", "CLIP");
  sequence.isSequence = function () {
    return true;
  };
  world.projectSelection = [footage, audio, still, sequence];

  var result = JSON.parse(world.sandbox.qkPrBins(JSON.stringify({ action: "sort" })));
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.moved, 4);
  assert.deepStrictEqual(world.moved.map(function (entry) {
    return entry.item.name + ">" + entry.bin;
  }), ["A001.mov>Footage", "Take.wav>Audio", "Card.png>Graphics", "Cut 1>Exports"]);
});

test("the bin organizer renames the selection in one undo step", function () {
  var world = createPremiereWorld();
  var one = prItem(world, "Shot 1", "C:/Media/one.mov");
  var two = prItem(world, "Shot 2", "C:/Media/two.mov");
  world.projectSelection = [one, two];

  var result = JSON.parse(
    world.sandbox.qkPrBins(
      JSON.stringify({ action: "rename", mode: "replace", find: "Shot", replace: "Scene" })
    )
  );
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.renamed, 2);
  assert.strictEqual(one.name, "Scene 1");
  assert.strictEqual(two.name, "Scene 2");
  assert.strictEqual(world.undo.open, 1);
  assert.strictEqual(world.undo.close, 1);
});

test("the bin organizer fails clearly with nothing selected in the project", function () {
  var world = createPremiereWorld();
  var result = JSON.parse(world.sandbox.qkPrBins(JSON.stringify({ action: "sort" })));
  assert.strictEqual(result.ok, false);
  assert.ok(/Nothing is selected in the Project panel/.test(result.error), result.error);
  assert.strictEqual(world.undo.open, world.undo.close, "undo closed on the error path");
});

/* ---------------- report ---------------- */

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
