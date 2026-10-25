/*
 * QuickKit host adapter — ExtendScript (ES3).
 *
 * Everything QuickKit asks After Effects to do starts here. Panel code never
 * talks to the app directly, so a future UXP port replaces this file only.
 *
 * Local only: no file writes, no network, no telemetry.
 */

/* ============================================================
 * Shared helpers
 * ============================================================ */

function qkStr(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function qkJsonEscape(value) {
  var text = qkStr(value);
  var out = "";
  var i;
  var ch;
  var code;

  for (i = 0; i < text.length; i++) {
    ch = text.charAt(i);
    code = text.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 32) out += " ";
    else out += ch;
  }
  return out;
}

function qkOk(message) {
  return '{"ok":true,"message":"' + qkJsonEscape(message) + '"}';
}

function qkErr(message) {
  return '{"ok":false,"error":"' + qkJsonEscape(message) + '"}';
}

function qkErrText(error) {
  var text = "";
  try {
    if (error && error.message) text = qkStr(error.message);
    else text = qkStr(error);
  } catch (e) {
    text = "unknown error";
  }
  return text === "" ? "unknown error" : text;
}

function qkTrim(text) {
  var value = qkStr(text);
  var start = 0;
  var end = value.length;
  while (start < end && value.charAt(start) === " ") start++;
  while (end > start && value.charAt(end - 1) === " ") end--;
  return value.substring(start, end);
}

function qkJoin(list) {
  var out = "";
  var i;
  for (i = 0; i < list.length; i++) {
    if (i > 0) out += ", ";
    out += qkStr(list[i]);
  }
  return out;
}

function qkPlural(count, one, many) {
  return count + " " + (count === 1 ? one : many);
}

function qkReplaceAll(text, find, replace) {
  if (find === "") return text;
  var out = "";
  var rest = qkStr(text);
  var index = rest.indexOf(find);
  while (index >= 0) {
    out += rest.substring(0, index) + replace;
    rest = rest.substring(index + find.length);
    index = rest.indexOf(find);
  }
  return out + rest;
}

function qkPad(number, width) {
  var text = qkStr(number);
  while (text.length < width) text = "0" + text;
  return text;
}

function qkInList(value, list) {
  for (var i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

function qkBeginUndo(label) {
  try {
    app.beginUndoGroup(label);
    return true;
  } catch (e) {
    return false;
  }
}

function qkEndUndo(started) {
  if (!started) return;
  try {
    app.endUndoGroup();
  } catch (e) {}
}

/* ============================================================
 * Host identity
 * ============================================================ */

function qkHostId() {
  var raw = "";
  var lower;

  try {
    if (typeof BridgeTalk !== "undefined" && BridgeTalk && BridgeTalk.appName) {
      raw = qkStr(BridgeTalk.appName);
    }
  } catch (eBridge) {}

  if (raw === "") {
    try {
      raw = qkStr(app.name);
    } catch (eAppName) {}
  }

  lower = raw.toLowerCase();
  if (lower.indexOf("premiere") >= 0) return "PPRO";
  if (lower.indexOf("after") >= 0 || lower.indexOf("aeft") >= 0) return "AEFT";

  try {
    if (app.project && typeof app.project.activeSequence !== "undefined") {
      return "PPRO";
    }
  } catch (ePpro) {}

  try {
    if (app.project && typeof app.project.numItems !== "undefined") {
      return "AEFT";
    }
  } catch (eAeft) {}

  return "UNKNOWN";
}

function qkHostDisplayName(hostId) {
  if (hostId === "AEFT") return "After Effects";
  if (hostId === "PPRO") return "Premiere Pro";
  return "Adobe app";
}

function qkProjectName() {
  var name = "";
  try {
    if (app.project && app.project.file && app.project.file.name) {
      name = qkStr(app.project.file.name);
    } else if (app.project && app.project.name) {
      name = qkStr(app.project.name);
    }
  } catch (eProject) {}
  return name;
}

function qkPing() {
  return "pong";
}

function qkHostInfo() {
  var hostId = "UNKNOWN";
  var version = "";
  var build = "";
  var name = "";

  try {
    hostId = qkHostId();
  } catch (eHost) {}

  try {
    version = qkStr(app.version);
  } catch (eVersion) {}

  try {
    if (typeof app.build !== "undefined" && app.build !== null) {
      build = qkStr(app.build);
    }
  } catch (eBuild) {}

  name = qkHostDisplayName(hostId);

  return (
    '{"ok":true' +
    ',"host":"' + qkJsonEscape(hostId) + '"' +
    ',"hostName":"' + qkJsonEscape(name) + '"' +
    ',"version":"' + qkJsonEscape(version) + '"' +
    ',"build":"' + qkJsonEscape(build) + '"' +
    ',"project":"' + qkJsonEscape(qkProjectName()) + '"' +
    ',"engine":"ExtendScript"' +
    "}"
  );
}

/* ============================================================
 * Composition context
 * ============================================================ */

function qkGetComp() {
  var item = null;

  try {
    item = app.project ? app.project.activeItem : null;
  } catch (eApp) {}

  if (!item) {
    return { error: "No active composition. Open a composition in the Timeline and try again." };
  }

  var looksLikeComp = false;
  try {
    looksLikeComp = !!(item.layers && typeof item.frameRate !== "undefined" && typeof item.duration !== "undefined");
  } catch (eComp) {}

  if (!looksLikeComp) {
    return { error: "The active item is not a composition. Open a composition and try again." };
  }

  return { comp: item };
}

function qkSelectedLayers(comp) {
  var layers = [];
  try {
    layers = comp.selectedLayers || [];
  } catch (eSel) {}
  if (!layers.length) {
    return { error: "Nothing selected. Select at least one layer in the Timeline." };
  }
  return { layers: layers };
}

/* ============================================================
 * Anchor point
 * ============================================================ */

function qkLayerRect(layer, time) {
  try {
    if (typeof layer.sourceRectAtTime !== "function") return null;
    var rect = layer.sourceRectAtTime(time, true);
    if (!rect) return null;
    if (!(rect.width > 0) && !(rect.height > 0)) return null;
    return rect;
  } catch (eRect) {
    return null;
  }
}

function qkCellAnchor(rect, cell) {
  var x;
  var y;

  if (cell.indexOf("left") >= 0) x = rect.left;
  else if (cell.indexOf("right") >= 0) x = rect.left + rect.width;
  else x = rect.left + rect.width / 2;

  if (cell.indexOf("top") >= 0) y = rect.top;
  else if (cell.indexOf("bottom") >= 0) y = rect.top + rect.height;
  else y = rect.top + rect.height / 2;

  return [x, y];
}

function qkCellLabel(cell) {
  return cell.split("-").join(" ");
}

/* Comp-space delta -> position (parent) space delta. */
function qkDeltaToPositionSpace(layer, beforeComp, afterComp) {
  var parent = null;
  try {
    parent = layer.parent;
  } catch (eParent) {}

  if (parent) {
    try {
      var beforeParent = parent.compPointToSource([beforeComp[0], beforeComp[1]]);
      var afterParent = parent.compPointToSource([afterComp[0], afterComp[1]]);
      return [beforeParent[0] - afterParent[0], beforeParent[1] - afterParent[1]];
    } catch (eConvert) {}
  }

  return [beforeComp[0] - afterComp[0], beforeComp[1] - afterComp[1]];
}

/* Move the anchor to a layer-space point while keeping the content still. */
function qkSetAnchorKeepPlace(layer, x, y) {
  var point = [x, y];
  var anchor = layer.anchorPoint.value;
  var before = layer.sourcePointToComp(point);

  var newAnchor = anchor.length > 2 ? [x, y, anchor[2]] : [x, y];
  layer.anchorPoint.setValue(newAnchor);

  var after = layer.sourcePointToComp(point);
  var delta = qkDeltaToPositionSpace(layer, before, after);

  var position = layer.position.value;
  if (!position || position.length < 2) {
    return false;
  }

  var next = [];
  var i;
  for (i = 0; i < position.length; i++) next.push(position[i]);
  next[0] = position[0] + delta[0];
  next[1] = position[1] + delta[1];

  layer.position.setValue(next);
  return true;
}

function qkSelectionBounds(layers, time) {
  var minX = null;
  var minY = null;
  var maxX = null;
  var maxY = null;
  var found = false;
  var i;
  var j;

  for (i = 0; i < layers.length; i++) {
    var rect = qkLayerRect(layers[i], time);
    if (!rect) continue;

    var corners = [
      [rect.left, rect.top],
      [rect.left + rect.width, rect.top],
      [rect.left, rect.top + rect.height],
      [rect.left + rect.width, rect.top + rect.height]
    ];

    for (j = 0; j < corners.length; j++) {
      var compPoint = null;
      try {
        compPoint = layers[i].sourcePointToComp(corners[j]);
      } catch (ePoint) {
        compPoint = null;
      }
      if (!compPoint) continue;
      found = true;
      if (minX === null || compPoint[0] < minX) minX = compPoint[0];
      if (maxX === null || compPoint[0] > maxX) maxX = compPoint[0];
      if (minY === null || compPoint[1] < minY) minY = compPoint[1];
      if (maxY === null || compPoint[1] > maxY) maxY = compPoint[1];
    }
  }

  if (!found) return null;
  return { left: minX, top: minY, right: maxX, bottom: maxY };
}

function qkAnchorMove(cell) {
  var cells = [
    "top-left", "top-center", "top-right",
    "middle-left", "middle-center", "middle-right",
    "bottom-left", "bottom-center", "bottom-right"
  ];

  if (!qkInList(cell, cells)) {
    return qkErr("Unknown anchor position. Pick one of the nine cells.");
  }

  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);

  var comp = ctx.comp;
  var selection = qkSelectedLayers(comp);
  if (selection.error) return qkErr(selection.error);

  var layers = selection.layers;
  var time = 0;
  try {
    time = comp.time;
  } catch (eTime) {}

  var started = false;
  var moved = 0;
  var locked = [];
  var noBounds = [];
  var failed = [];
  var i;

  started = qkBeginUndo("QuickKit: Move anchor point");

  for (i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (layer.locked) {
      locked.push(qkStr(layer.name));
      continue;
    }
    var rect = qkLayerRect(layer, time);
    if (!rect) {
      noBounds.push(qkStr(layer.name));
      continue;
    }
    var point = qkCellAnchor(rect, cell);
    try {
      if (qkSetAnchorKeepPlace(layer, point[0], point[1])) moved++;
      else failed.push(qkStr(layer.name) + " (position is separated)");
    } catch (eMove) {
      failed.push(qkStr(layer.name) + " (" + qkErrText(eMove) + ")");
    }
  }

  qkEndUndo(started);

  if (moved === 0) {
    var reason = "QuickKit could not move the anchor point.";
    if (locked.length) reason += " Locked: " + qkJoin(locked) + ".";
    if (noBounds.length) reason += " No visible bounds: " + qkJoin(noBounds) + ".";
    if (failed.length) reason += " Failed: " + qkJoin(failed) + ".";
    return qkErr(reason);
  }

  var message = "Moved the anchor point to the " + qkCellLabel(cell) + " on " + qkPlural(moved, "layer", "layers") + ".";
  if (locked.length) message += " Skipped locked: " + qkJoin(locked) + ".";
  if (noBounds.length) message += " Skipped without bounds: " + qkJoin(noBounds) + ".";
  if (failed.length) message += " Could not change: " + qkJoin(failed) + ".";
  return qkOk(message);
}

function qkAnchorCenter() {
  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);

  var comp = ctx.comp;
  var selection = qkSelectedLayers(comp);
  if (selection.error) return qkErr(selection.error);

  var layers = selection.layers;
  var time = 0;
  try {
    time = comp.time;
  } catch (eTime) {}

  var bounds = qkSelectionBounds(layers, time);
  if (!bounds) {
    return qkErr("No visible layer bounds to measure. Select a layer with content, text or shapes.");
  }

  var centerX = (bounds.left + bounds.right) / 2;
  var centerY = (bounds.top + bounds.bottom) / 2;

  var started = qkBeginUndo("QuickKit: Center anchor on selection");
  var moved = 0;
  var locked = [];
  var failed = [];
  var i;

  for (i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (layer.locked) {
      locked.push(qkStr(layer.name));
      continue;
    }
    try {
      var local = layer.compPointToSource([centerX, centerY]);
      if (qkSetAnchorKeepPlace(layer, local[0], local[1])) moved++;
      else failed.push(qkStr(layer.name) + " (position is separated)");
    } catch (eCenter) {
      failed.push(qkStr(layer.name) + " (" + qkErrText(eCenter) + ")");
    }
  }

  qkEndUndo(started);

  if (moved === 0) {
    var reason = "QuickKit could not center the anchor point.";
    if (locked.length) reason += " Locked: " + qkJoin(locked) + ".";
    if (failed.length) reason += " Failed: " + qkJoin(failed) + ".";
    return qkErr(reason);
  }

  var message = "Centered the anchor point on " + qkPlural(moved, "layer", "layers") + " at the middle of the selection.";
  if (locked.length) message += " Skipped locked: " + qkJoin(locked) + ".";
  if (failed.length) message += " Could not change: " + qkJoin(failed) + ".";
  return qkOk(message);
}

/* ============================================================
 * Layers
 * ============================================================ */

function qkLayersRename(prefix, suffix, find, replace, startNumber, padWidth, numbering) {
  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);

  var selection = qkSelectedLayers(ctx.comp);
  if (selection.error) return qkErr(selection.error);

  var prefixText = qkStr(prefix);
  var suffixText = qkStr(suffix);
  var findText = qkStr(find);
  var replaceText = qkStr(replace);
  var useNumber = qkStr(numbering) === "1" || qkStr(numbering) === "true";

  var start = parseInt(qkStr(startNumber), 10);
  if (isNaN(start)) start = 1;

  var pad = parseInt(qkStr(padWidth), 10);
  if (isNaN(pad) || pad < 1) pad = 2;
  if (pad > 6) pad = 6;

  if (prefixText === "" && suffixText === "" && findText === "" && !useNumber) {
    return qkErr("Nothing to rename with. Add a prefix or suffix, a find/replace, or turn on numbering.");
  }

  var layers = selection.layers;
  var started = qkBeginUndo("QuickKit: Rename layers");
  var renamed = 0;
  var locked = [];
  var failed = [];
  var i;

  for (i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (layer.locked) {
      locked.push(qkStr(layer.name));
      continue;
    }

    var base = qkStr(layer.name);
    if (findText !== "") base = qkReplaceAll(base, findText, replaceText);

    var next = prefixText + base + suffixText;
    if (useNumber) {
      var numberText = qkPad(start + renamed, pad);
      if (next.indexOf("{n}") >= 0) next = qkReplaceAll(next, "{n}", numberText);
      else next = next + " " + numberText;
    }

    try {
      layer.name = next;
      renamed++;
    } catch (eRename) {
      failed.push(qkStr(layer.name) + " (" + qkErrText(eRename) + ")");
    }
  }

  qkEndUndo(started);

  if (renamed === 0) {
    var reason = "No layers were renamed.";
    if (locked.length) reason += " Locked: " + qkJoin(locked) + ".";
    if (failed.length) reason += " Failed: " + qkJoin(failed) + ".";
    return qkErr(reason);
  }

  var message = "Renamed " + qkPlural(renamed, "layer", "layers") + ".";
  if (locked.length) message += " Skipped locked: " + qkJoin(locked) + ".";
  if (failed.length) message += " Could not rename: " + qkJoin(failed) + ".";
  return qkOk(message);
}

function qkLayersStagger(offset, unit) {
  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);

  var comp = ctx.comp;
  var selection = qkSelectedLayers(comp);
  if (selection.error) return qkErr(selection.error);

  var amount = parseFloat(qkStr(offset));
  if (isNaN(amount) || amount <= 0) {
    return qkErr("Enter an offset greater than zero.");
  }

  var step = qkStr(unit) === "seconds" ? amount : amount / comp.frameRate;
  if (!(step > 0)) return qkErr("The offset is too small to apply.");

  var layers = selection.layers.slice(0);
  layers.sort(function (a, b) {
    return a.startTime - b.startTime;
  });

  var base = layers[0].startTime;
  var started = qkBeginUndo("QuickKit: Stagger layers");
  var staggered = 0;
  var locked = [];
  var i;

  for (i = 0; i < layers.length; i++) {
    if (layers[i].locked) {
      locked.push(qkStr(layers[i].name));
      continue;
    }
    try {
      layers[i].startTime = base + i * step;
      staggered++;
    } catch (eStagger) {
      locked.push(qkStr(layers[i].name));
    }
  }

  qkEndUndo(started);

  if (staggered === 0) {
    return qkErr("No layers were staggered. Locked: " + qkJoin(locked) + ".");
  }

  var unitLabel = qkStr(unit) === "seconds" ? "second" : "frame";
  var message = "Staggered " + qkPlural(staggered, "layer", "layers") + " by " + amount + " " + unitLabel + (amount === 1 ? "" : "s") + " each.";
  if (locked.length) message += " Skipped locked: " + qkJoin(locked) + ".";
  return qkOk(message);
}

function qkLayersNull() {
  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);

  var comp = ctx.comp;
  var selection = qkSelectedLayers(comp);
  if (selection.error) return qkErr(selection.error);

  var layers = selection.layers;
  var time = 0;
  try {
    time = comp.time;
  } catch (eTime) {}

  var bounds = qkSelectionBounds(layers, time);
  var centerX = bounds ? (bounds.left + bounds.right) / 2 : comp.width / 2;
  var centerY = bounds ? (bounds.top + bounds.bottom) / 2 : comp.height / 2;

  var started = qkBeginUndo("QuickKit: Create null and parent");
  var nullLayer = null;
  var parented = 0;
  var failed = [];
  var i;

  try {
    nullLayer = comp.layers.addNull(comp.duration);
    nullLayer.name = "QuickKit Null";
    nullLayer.position.setValue([centerX, centerY]);
  } catch (eNull) {
    qkEndUndo(started);
    return qkErr("Could not create the null layer: " + qkErrText(eNull));
  }

  for (i = 0; i < layers.length; i++) {
    if (layers[i].id === nullLayer.id) continue;
    try {
      layers[i].parent = nullLayer;
      parented++;
    } catch (eParent) {
      failed.push(qkStr(layers[i].name) + " (" + qkErrText(eParent) + ")");
    }
  }

  qkEndUndo(started);

  if (parented === 0) {
    return qkErr("The null was created but no layers could be parented." + (failed.length ? " Failed: " + qkJoin(failed) + "." : ""));
  }

  var message = "Created \"QuickKit Null\" at the middle of the selection and parented " + qkPlural(parented, "layer", "layers") + " to it.";
  if (failed.length) message += " Could not parent: " + qkJoin(failed) + ".";
  return qkOk(message);
}

function qkLayersSequence() {
  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);

  var comp = ctx.comp;
  var selection = qkSelectedLayers(comp);
  if (selection.error) return qkErr(selection.error);

  var layers = selection.layers.slice(0);
  layers.sort(function (a, b) {
    return a.startTime - b.startTime;
  });

  var cursor = layers[0].startTime;
  var started = qkBeginUndo("QuickKit: Sequence layers");
  var sequenced = 0;
  var skipped = [];
  var locked = [];
  var i;

  for (i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (layer.locked) {
      locked.push(qkStr(layer.name));
      continue;
    }

    var duration = layer.outPoint - layer.inPoint;
    if (!(duration > 0)) {
      skipped.push(qkStr(layer.name));
      continue;
    }

    try {
      layer.startTime = cursor;
      cursor += duration;
      sequenced++;
    } catch (eSeq) {
      locked.push(qkStr(layer.name));
    }
  }

  qkEndUndo(started);

  if (sequenced === 0) {
    var reason = "No layers were sequenced.";
    if (locked.length) reason += " Locked: " + qkJoin(locked) + ".";
    if (skipped.length) reason += " Zero length: " + qkJoin(skipped) + ".";
    return qkErr(reason);
  }

  var message = "Sequenced " + qkPlural(sequenced, "layer", "layers") + " end to start.";
  if (skipped.length) message += " Skipped zero length: " + qkJoin(skipped) + ".";
  if (locked.length) message += " Skipped locked: " + qkJoin(locked) + ".";
  return qkOk(message);
}

function qkLayersPrecompose(name) {
  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);

  var comp = ctx.comp;
  var selection = qkSelectedLayers(comp);
  if (selection.error) return qkErr(selection.error);

  var compName = qkTrim(qkStr(name));
  if (compName === "") compName = "QuickKit Precomp";

  var layers = selection.layers;
  var indices = [];
  var i;
  for (i = 0; i < layers.length; i++) indices.push(layers[i].index);
  indices.sort(function (a, b) {
    return a - b;
  });

  var started = qkBeginUndo("QuickKit: Precompose layers");
  var created = null;
  try {
    created = comp.layers.precompose(indices, compName, true);
  } catch (ePre) {
    qkEndUndo(started);
    return qkErr("Precompose failed: " + qkErrText(ePre) + ".");
  }
  qkEndUndo(started);

  if (!created) {
    return qkErr("Precompose did not return a composition. Nothing was changed.");
  }

  return qkOk("Precomposed " + qkPlural(indices.length, "layer", "layers") + " into \"" + qkStr(created.name) + "\".");
}

/* ============================================================
 * Easing
 * ============================================================ */

function qkCollectKeyTargets(layers) {
  var groupNames = [
    "Transform", "Text", "Contents", "Masks", "Effects", "Motion Trackers",
    "Audio", "Camera Options", "Light Options", "Geometry Options", "Material Options"
  ];

  var targets = [];
  var i;
  var j;

  for (i = 0; i < layers.length; i++) {
    var layer = layers[i];
    var groups = [];

    for (j = 0; j < groupNames.length; j++) {
      var named = null;
      try {
        named = layer.property(groupNames[j]);
      } catch (eNamed) {
        named = null;
      }
      if (named) groups.push(named);
    }

    try {
      var count = layer.numProperties;
      for (j = 1; j <= count; j++) {
        var child = layer.property(j);
        if (child && child.propertyType === PropertyType.GROUP) groups.push(child);
      }
    } catch (eRoot) {}

    for (j = 0; j < groups.length; j++) {
      qkWalkGroup(groups[j], targets, 0);
    }
  }

  return targets;
}

function qkWalkGroup(group, targets, depth) {
  if (!group || depth > 10) return;

  var count = 0;
  try {
    count = group.numProperties;
  } catch (eCount) {
    return;
  }

  for (var i = 1; i <= count; i++) {
    var child = null;
    try {
      child = group.property(i);
    } catch (eChild) {
      continue;
    }
    if (!child) continue;

    if (child.propertyType === PropertyType.PROPERTY) {
      var keys = [];
      try {
        keys = child.selectedKeys || [];
      } catch (eKeys) {}
      if (keys.length) targets.push({ prop: child, keys: keys });
    } else {
      qkWalkGroup(child, targets, depth + 1);
    }
  }
}

function qkValueDimension(prop) {
  if (prop.isSpatial) return 1;

  var value = null;
  try {
    value = prop.value;
  } catch (eValue) {
    return 1;
  }

  if (value && typeof value.length !== "undefined" && value.length > 0) return value.length;
  return 1;
}

function qkSetKeyEase(prop, keyIndex, influence) {
  var dimension = qkValueDimension(prop);
  var inEase = [];
  var outEase = [];
  var i;

  for (i = 0; i < dimension; i++) {
    inEase.push(new KeyframeEase(0, influence));
    outEase.push(new KeyframeEase(0, influence));
  }

  prop.setInterpolationTypeAtKey(
    keyIndex,
    KeyframeInterpolationType.BEZIER,
    KeyframeInterpolationType.BEZIER
  );
  prop.setTemporalEaseAtKey(keyIndex, inEase, outEase);
}

function qkNumericValue(value) {
  if (typeof value === "number") return true;
  if (!value || typeof value.length === "undefined") return false;
  for (var i = 0; i < value.length; i++) {
    if (typeof value[i] !== "number") return false;
  }
  return value.length > 0;
}

/* end + factor * (end - start), element-wise. */
function qkBlendValue(end, start, factor) {
  var i;
  if (typeof end === "number") {
    return end + factor * (end - start);
  }
  var out = [];
  for (i = 0; i < end.length; i++) out.push(end[i] + factor * (end[i] - start[i]));
  return out;
}

function qkRebound(prop, keyIndex, kind, comp, stats) {
  if (keyIndex <= 1 || prop.numKeys < 2) {
    stats.skippedFirst++;
    return;
  }

  try {
    if (prop.expressionEnabled) {
      stats.skippedExpression++;
      return;
    }
  } catch (eExpr) {}

  var startValue = prop.keyValue(keyIndex - 1);
  var endValue = prop.keyValue(keyIndex);

  if (!qkNumericValue(startValue) || !qkNumericValue(endValue)) {
    stats.skippedType++;
    return;
  }

  var baseTime = prop.keyTime(keyIndex);
  var frameStep = 1 / comp.frameRate;
  var offsets = kind === "overshoot" ? [2, 5] : [2, 4, 6, 8];
  var lastTime = baseTime + offsets[offsets.length - 1] * frameStep;

  if (lastTime > comp.duration - frameStep) {
    stats.skippedRoom++;
    return;
  }

  if (keyIndex < prop.numKeys && lastTime + frameStep * 0.5 > prop.keyTime(keyIndex + 1)) {
    stats.skippedRoom++;
    return;
  }

  var values = [];
  if (kind === "overshoot") {
    values.push(qkBlendValue(endValue, startValue, 0.12));
    values.push(endValue);
  } else {
    values.push(qkBlendValue(endValue, startValue, -0.08));
    values.push(qkBlendValue(endValue, startValue, 0.04));
    values.push(qkBlendValue(endValue, startValue, -0.015));
    values.push(endValue);
  }

  try {
    qkSetKeyEase(prop, keyIndex, 33.33);

    for (var i = 0; i < offsets.length; i++) {
      var time = baseTime + offsets[i] * frameStep;
      prop.setValueAtTime(time, values[i]);
      var newIndex = keyIndex + 1 + i;

      if (kind === "overshoot") {
        qkSetKeyEase(prop, newIndex, 30);
      } else {
        prop.setInterpolationTypeAtKey(
          newIndex,
          KeyframeInterpolationType.LINEAR,
          KeyframeInterpolationType.LINEAR
        );
      }
      stats.inserted++;
    }
  } catch (eRebound) {
    stats.failed++;
    return;
  }

  stats.applied++;
}

function qkEasingApply(kind) {
  var kinds = ["easy", "strong", "overshoot", "bounce"];
  if (!qkInList(kind, kinds)) {
    return qkErr("Unknown easing preset. Pick easy ease, strong ease, overshoot or bounce.");
  }

  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);

  var comp = ctx.comp;
  var selection = qkSelectedLayers(comp);
  if (selection.error) return qkErr(selection.error);

  var targets = qkCollectKeyTargets(selection.layers);
  if (!targets.length) {
    return qkErr("Select at least one keyframe in the Timeline, then apply easing.");
  }

  var influence = kind === "strong" ? 85 : 33.33;
  var stats = {
    applied: 0,
    inserted: 0,
    skippedFirst: 0,
    skippedType: 0,
    skippedRoom: 0,
    skippedExpression: 0,
    failed: 0
  };

  var started = qkBeginUndo("QuickKit: Apply " + kind + " easing");
  var t;
  var k;

  for (t = 0; t < targets.length; t++) {
    var prop = targets[t].prop;
    var keys = targets[t].keys;
    for (k = 0; k < keys.length; k++) {
      if (kind === "overshoot" || kind === "bounce") {
        qkRebound(prop, keys[k], kind, comp, stats);
      } else {
        try {
          qkSetKeyEase(prop, keys[k], influence);
          stats.applied++;
        } catch (eEase) {
          stats.failed++;
        }
      }
    }
  }

  qkEndUndo(started);

  if (stats.applied === 0) {
    var reason = "No keyframes could take that easing.";
    if (stats.skippedFirst) reason += " " + stats.skippedFirst + " without a previous key.";
    if (stats.skippedType) reason += " " + stats.skippedType + " on properties that are not numeric.";
    if (stats.skippedRoom) reason += " " + stats.skippedRoom + " with no room after them (next keyframe or end of comp).";
    if (stats.skippedExpression) reason += " " + stats.skippedExpression + " on properties with an expression.";
    if (stats.failed) reason += " " + stats.failed + " failed.";
    return qkErr(reason);
  }

  var label = kind === "easy" ? "easy ease" : kind === "strong" ? "strong ease" : kind;
  var message = "Applied " + label + " to " + qkPlural(stats.applied, "keyframe", "keyframes") + ".";
  if (stats.inserted) message += " Added " + qkPlural(stats.inserted, "keyframe", "keyframes") + ".";
  if (stats.skippedFirst) message += " Skipped " + stats.skippedFirst + " without a previous key.";
  if (stats.skippedType) message += " Skipped " + stats.skippedType + " non-numeric.";
  if (stats.skippedRoom) message += " Skipped " + stats.skippedRoom + " with no room after them.";
  if (stats.skippedExpression) message += " Skipped " + stats.skippedExpression + " with expressions.";
  if (stats.failed) message += " " + stats.failed + " failed.";
  return qkOk(message);
}

/* ============================================================
 * Text animations
 * ============================================================ */

var QK_TEXT_KINDS = ["fade", "slide", "pop", "typewriter", "stagger", "blur"];
var QK_TEXT_EASINGS = ["smooth", "snappy", "linear"];
var QK_TEXT_DIRECTIONS = ["left", "right", "up", "down"];

function qkTextKindLabel(kind) {
  if (kind === "fade") return "fade";
  if (kind === "slide") return "slide";
  if (kind === "pop") return "scale pop";
  if (kind === "typewriter") return "typewriter";
  if (kind === "stagger") return "character stagger";
  if (kind === "blur") return "blur reveal";
  return kind;
}

function qkTextAnimatorLabel(kind) {
  if (kind === "typewriter") return "Typewriter";
  if (kind === "stagger") return "Character Stagger";
  if (kind === "blur") return "Blur Reveal";
  return "Text Animation";
}

function qkTextUsesAnimator(kind) {
  return kind === "typewriter" || kind === "stagger" || kind === "blur";
}

function qkTextIsOn(value) {
  var text = qkStr(value).toLowerCase();
  return text === "1" || text === "true" || text === "on";
}

function qkTextNumber(value, fallback) {
  var number = parseFloat(qkStr(value));
  if (isNaN(number)) return fallback;
  return number;
}

function qkTextCopy(value) {
  if (typeof value === "number") return value;
  if (!value || typeof value.length === "undefined") return value;
  var out = [];
  for (var i = 0; i < value.length; i++) out.push(value[i]);
  return out;
}

function qkTextIsTextLayer(layer) {
  var props = null;
  try {
    props = layer.property("ADBE Text Properties");
  } catch (eText) {
    props = null;
  }
  return !!props;
}

/* Why a transform property cannot take new keys. Empty string means it can. */
function qkTextPropertyProblem(prop, label) {
  if (!prop) return "has no " + label;
  try {
    if (prop.numKeys > 0) return "already has " + label + " keyframes";
  } catch (eKeys) {}
  try {
    if (prop.expressionEnabled) return "has an expression on " + label;
  } catch (eExpression) {}
  return "";
}

/* Key times for the in and out halves, or a human reason when the layer is short. */
function qkTextSpan(layer, options) {
  var inPoint = 0;
  var outPoint = 0;

  try {
    inPoint = layer.inPoint;
    outPoint = layer.outPoint;
  } catch (ePoints) {
    return { error: "has no in or out point" };
  }

  if (!(outPoint > inPoint)) {
    return { error: "has no duration" };
  }

  var inStart = inPoint + options.delay;
  var inEnd = inStart + options.duration;
  var outEnd = outPoint - options.delay;
  var outStart = outEnd - options.duration;

  if (options.animateIn && inEnd > outPoint + 0.0001) {
    return { error: "is shorter than the " + options.duration + " s in animation" };
  }
  if (options.animateOut && outStart < inPoint - 0.0001) {
    return { error: "is shorter than the " + options.duration + " s out animation" };
  }
  if (options.animateIn && options.animateOut && inEnd > outStart + 0.0001) {
    return {
      error: "is too short for both animations (needs about " + (options.duration * 2 + options.delay * 2) + " s)"
    };
  }

  return { inStart: inStart, inEnd: inEnd, outStart: outStart, outEnd: outEnd };
}

function qkTextRemoveKeys(prop) {
  try {
    for (var i = prop.numKeys; i >= 1; i--) prop.removeKey(i);
  } catch (eRemove) {}
}

function qkTextApplyEase(prop, easing) {
  var count = 0;
  try {
    count = prop.numKeys;
  } catch (eCount) {
    return;
  }

  for (var i = 1; i <= count; i++) {
    if (easing === "linear") {
      try {
        prop.setInterpolationTypeAtKey(
          i,
          KeyframeInterpolationType.LINEAR,
          KeyframeInterpolationType.LINEAR
        );
      } catch (eLinear) {}
    } else {
      qkSetKeyEase(prop, i, easing === "snappy" ? 80 : 33.33);
    }
  }
}

/* The off-screen value for a transform animation, relative to the layer's own value. */
function qkTextHiddenValue(base, kind, options) {
  if (kind === "fade") return 0;

  if (kind === "slide") {
    var offset = [0, 0];
    if (options.direction === "left") offset = [-options.distance, 0];
    else if (options.direction === "right") offset = [options.distance, 0];
    else if (options.direction === "up") offset = [0, -options.distance];
    else offset = [0, options.distance];

    var moved = qkTextCopy(base);
    moved[0] = base[0] + offset[0];
    moved[1] = base[1] + offset[1];
    return moved;
  }

  var factor = options.popScale / 100;
  if (typeof base === "number") return base * factor;

  var scaled = qkTextCopy(base);
  scaled[0] = base[0] * factor;
  scaled[1] = base[1] * factor;
  return scaled;
}

function qkTextTransform(layer, kind, span, options) {
  var prop = null;
  var label = "";

  if (kind === "fade") {
    prop = layer.opacity;
    label = "opacity";
  } else if (kind === "slide") {
    prop = layer.position;
    label = "position";
  } else {
    prop = layer.scale;
    label = "scale";
  }

  var problem = qkTextPropertyProblem(prop, label);
  if (problem !== "") return { error: problem };

  if (kind === "slide") {
    try {
      if (prop.dimensionsSeparated) return { error: "has separated position dimensions" };
    } catch (eSeparated) {}
  }

  var base = null;
  try {
    base = qkTextCopy(prop.value);
  } catch (eBase) {
    return { error: "has no readable " + label };
  }

  if (kind === "slide" && (!base || typeof base.length === "undefined" || base.length < 2)) {
    return { error: "has no usable position" };
  }
  if (kind === "pop" && (!base || typeof base.length === "undefined" || base.length < 2)) {
    return { error: "has no usable scale" };
  }

  var hidden = qkTextHiddenValue(base, kind, options);

  try {
    if (options.animateIn) {
      prop.setValueAtTime(span.inStart, hidden);
      prop.setValueAtTime(span.inEnd, base);
    }
    if (options.animateOut) {
      prop.setValueAtTime(span.outStart, base);
      prop.setValueAtTime(span.outEnd, hidden);
    }
    qkTextApplyEase(prop, options.easing);
    return { ok: true };
  } catch (eKeys) {
    qkTextRemoveKeys(prop);
    return { error: "could not add " + label + " keyframes (" + qkErrText(eKeys) + ")" };
  }
}

/* Text animator values can be scalar or per-dimension arrays depending on the property. */
function qkTextSetAmount(prop, amount) {
  var current = null;
  try {
    current = prop.value;
  } catch (eValue) {
    current = null;
  }

  if (current && typeof current.length !== "undefined") {
    var next = [];
    for (var i = 0; i < current.length; i++) next.push(amount);
    prop.setValue(next);
    return;
  }
  prop.setValue(amount);
}

function qkTextSetStaggerOffset(prop, amount) {
  var current = null;
  try {
    current = prop.value;
  } catch (eValue) {
    current = null;
  }

  if (!current || typeof current.length === "undefined") {
    prop.setValue(amount);
    return;
  }

  var next = [0, amount];
  while (next.length < current.length) next.push(0);
  prop.setValue(next);
}

function qkTextConfigureSelector(selector) {
  var advanced = null;
  try {
    advanced = selector.property("ADBE Text Range Advanced");
  } catch (eAdvanced) {
    advanced = null;
  }
  if (!advanced) return;

  try {
    advanced.property("ADBE Text Range Units").setValue(1);
  } catch (eUnits) {}
  try {
    advanced.property("ADBE Text Range Type2").setValue(1);
  } catch (eType) {}
}

function qkTextSweepSelector(selector, span, options) {
  var endProp = null;
  var startProp = null;

  try {
    endProp = selector.property("ADBE Text Percent End");
    startProp = selector.property("ADBE Text Percent Start");
  } catch (eProps) {
    endProp = null;
    startProp = null;
  }

  if (!endProp || !startProp) {
    throw new Error("the range selector is missing its percentage properties");
  }

  endProp.setValue(100);

  if (options.animateIn) {
    startProp.setValueAtTime(span.inStart, 0);
    startProp.setValueAtTime(span.inEnd, 100);
  }
  if (options.animateOut) {
    startProp.setValueAtTime(span.outStart, 100);
    startProp.setValueAtTime(span.outEnd, 0);
  }

  qkTextApplyEase(startProp, options.easing);
}

function qkTextAnimator(layer, kind, span, options) {
  var textProps = null;
  try {
    textProps = layer.property("ADBE Text Properties");
  } catch (eText) {
    textProps = null;
  }
  if (!textProps) return { error: "is not a text layer" };

  var animators = null;
  try {
    animators = textProps.property("ADBE Text Animators");
  } catch (eAnimators) {
    animators = null;
  }
  if (!animators) return { error: "has no text animators" };

  var animatorName = "QuickKit " + qkTextAnimatorLabel(kind);
  var i;

  for (i = animators.numProperties; i >= 1; i--) {
    var previous = null;
    try {
      previous = animators.property(i);
    } catch (ePrevious) {
      previous = null;
    }
    if (previous && qkStr(previous.name) === animatorName) {
      try {
        previous.remove();
      } catch (eRemove) {
        return { error: "could not replace its previous " + animatorName + " animator" };
      }
    }
  }

  var animator = null;
  try {
    animator = animators.addProperty("ADBE Text Animator");
  } catch (eAdd) {
    return { error: "could not add a text animator (" + qkErrText(eAdd) + ")" };
  }
  if (!animator) return { error: "could not add a text animator" };

  try {
    animator.name = animatorName;
  } catch (eRename) {}

  try {
    var props = animator.property("ADBE Text Animator Properties");
    if (!props) throw new Error("the animator has no properties group");

    var opacity = props.addProperty("ADBE Text Opacity");
    if (!opacity) throw new Error("opacity is not available");
    opacity.setValue(0);

    if (kind === "stagger") {
      var position = props.addProperty("ADBE Text Position 3D");
      if (!position) throw new Error("text position is not available");
      qkTextSetStaggerOffset(position, options.staggerOffset);
    }

    if (kind === "blur") {
      var blur = props.addProperty("ADBE Text Blur");
      if (!blur) throw new Error("text blur is not available");
      qkTextSetAmount(blur, options.blurAmount);
    }

    var selectors = animator.property("ADBE Text Selectors");
    if (!selectors) throw new Error("the animator has no selectors group");

    var selector = selectors.addProperty("ADBE Text Selector");
    if (!selector) throw new Error("a range selector could not be added");

    qkTextConfigureSelector(selector);
    qkTextSweepSelector(selector, span, options);
    return { ok: true };
  } catch (eBuild) {
    try {
      animator.remove();
    } catch (eCleanup) {}
    return { error: "could not build the animator (" + qkErrText(eBuild) + ")" };
  }
}

function qkTextNote(name, reason) {
  return "\"" + name + "\" " + reason;
}

function qkTextApply(kind, duration, delay, easing, animateIn, animateOut, direction, distance) {
  if (!qkInList(kind, QK_TEXT_KINDS)) {
    return qkErr("Unknown text animation. Pick one of the six presets.");
  }
  if (!qkInList(easing, QK_TEXT_EASINGS)) {
    return qkErr("Unknown easing. Pick smooth, snappy or linear.");
  }

  var durationValue = qkTextNumber(duration, NaN);
  if (isNaN(durationValue) || durationValue <= 0) {
    return qkErr("Enter a duration greater than zero seconds.");
  }
  if (durationValue > 60) {
    return qkErr("Keep the duration at 60 seconds or less.");
  }

  var delayValue = qkTextNumber(delay, NaN);
  if (isNaN(delayValue) || delayValue < 0) {
    return qkErr("Enter a delay of zero or more seconds.");
  }

  var distanceValue = qkTextNumber(distance, 80);
  if (isNaN(distanceValue) || distanceValue <= 0) distanceValue = 80;
  if (distanceValue > 4000) distanceValue = 4000;

  var inOn = qkTextIsOn(animateIn);
  var outOn = qkTextIsOn(animateOut);
  if (!inOn && !outOn) {
    return qkErr("Turn on Animate in, Animate out, or both.");
  }

  var directionValue = qkStr(direction);
  if (!qkInList(directionValue, QK_TEXT_DIRECTIONS)) directionValue = "left";

  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);

  var comp = ctx.comp;
  var selection = qkSelectedLayers(comp);
  if (selection.error) return qkErr(selection.error);

  var options = {
    duration: durationValue,
    delay: delayValue,
    easing: easing,
    animateIn: inOn,
    animateOut: outOn,
    direction: directionValue,
    distance: distanceValue,
    popScale: 80,
    staggerOffset: 40,
    blurAmount: 20
  };

  var layers = selection.layers;
  var stats = {
    applied: 0,
    locked: [],
    notText: [],
    short: [],
    skipped: [],
    failed: []
  };

  var started = qkBeginUndo("QuickKit: Text animation");
  var i;

  for (i = 0; i < layers.length; i++) {
    var layer = layers[i];
    var name = qkStr(layer.name);

    if (layer.locked) {
      stats.locked.push(name);
      continue;
    }

    if (qkTextUsesAnimator(kind) && !qkTextIsTextLayer(layer)) {
      stats.notText.push(name);
      continue;
    }

    var span = qkTextSpan(layer, options);
    if (span.error) {
      stats.short.push(name + " (" + span.error + ")");
      continue;
    }

    var result = qkTextUsesAnimator(kind)
      ? qkTextAnimator(layer, kind, span, options)
      : qkTextTransform(layer, kind, span, options);

    if (result.error) {
      stats.skipped.push(qkTextNote(name, result.error));
      continue;
    }
    stats.applied++;
  }

  qkEndUndo(started);

  var edges = options.animateIn && options.animateOut ? "in and out" : options.animateIn ? "in" : "out";
  var message = "Applied " + qkTextKindLabel(kind) + " " + edges + " to " + qkPlural(stats.applied, "layer", "layers") + ".";

  if (stats.applied === 0) {
    message = "No layers were animated.";
    if (stats.notText.length) {
      message += " " + qkTextKindLabel(kind) + " needs text layers; skipped: " + qkJoin(stats.notText) + ".";
    }
    if (stats.locked.length) message += " Locked: " + qkJoin(stats.locked) + ".";
    if (stats.short.length) message += " Too short: " + qkJoin(stats.short) + ".";
    if (stats.skipped.length) message += " Skipped: " + qkJoin(stats.skipped) + ".";
    if (stats.failed.length) message += " Failed: " + qkJoin(stats.failed) + ".";
    return qkErr(message);
  }

  if (stats.locked.length) message += " Skipped locked: " + qkJoin(stats.locked) + ".";
  if (stats.notText.length) message += " Skipped, not a text layer: " + qkJoin(stats.notText) + ".";
  if (stats.short.length) message += " Skipped, too short: " + qkJoin(stats.short) + ".";
  if (stats.skipped.length) message += " Skipped: " + qkJoin(stats.skipped) + ".";
  if (stats.failed.length) message += " Failed: " + qkJoin(stats.failed) + ".";
  return qkOk(message);
}
