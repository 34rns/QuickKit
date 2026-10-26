/*
 * QuickKit host adapter — ExtendScript (ES3).
 *
 * Everything QuickKit asks After Effects to do starts here. Panel code never
 * talks to the app directly, so a future UXP port replaces this file only.
 *
 * Local only: no network, no telemetry. The preset manager writes only under
 * %APPDATA%\QuickKit\presets, and only when the user saves, renames, deletes,
 * reorders, imports or exports a preset.
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
    tooShort: [],
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
      stats.tooShort.push(name + " (" + span.error + ")");
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
    if (stats.tooShort.length) message += " Too short: " + qkJoin(stats.tooShort) + ".";
    if (stats.skipped.length) message += " Skipped: " + qkJoin(stats.skipped) + ".";
    if (stats.failed.length) message += " Failed: " + qkJoin(stats.failed) + ".";
    return qkErr(message);
  }

  if (stats.locked.length) message += " Skipped locked: " + qkJoin(stats.locked) + ".";
  if (stats.notText.length) message += " Skipped, not a text layer: " + qkJoin(stats.notText) + ".";
  if (stats.tooShort.length) message += " Skipped, too short: " + qkJoin(stats.tooShort) + ".";
  if (stats.skipped.length) message += " Skipped: " + qkJoin(stats.skipped) + ".";
  if (stats.failed.length) message += " Failed: " + qkJoin(stats.failed) + ".";
  return qkOk(message);
}

/* ============================================================
 * Preset manager — JSON, files and storage
 * ============================================================ */

var QK_PRESET_FORMAT = "quickkit-preset";
var QK_PACK_FORMAT = "quickkit-pack";
var QK_FOLDERS_FORMAT = "quickkit-folders";
var QK_PRESET_VERSION = 1;
var QK_PRESET_LIMIT = 500;
var QK_PRESET_MAX_BYTES = 4194304;
var QK_PACK_MAX_BYTES = 8388608;
var QK_PRESET_MAX_LAYERS = 20;
var QK_PRESET_MAX_PROPS = 300;
var QK_PRESET_MAX_KEYS = 500;
var QK_PRESET_MAX_FOLDERS = 40;
var qkPresetIdCounter = 0;

/* Minimal JSON parser. ExtendScript has no JSON object, and imported packs
 * must never be evaluated as code. */
function qkJsonParse(text) {
  var source = qkStr(text);
  var index = 0;
  var depth = 0;

  function fail(message) {
    throw new Error(message + " at character " + index);
  }

  function skipSpace() {
    while (index < source.length) {
      var c = source.charAt(index);
      if (c === " " || c === "\t" || c === "\r" || c === "\n") index++;
      else break;
    }
  }

  function hexDigit(c) {
    if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
    if (c >= "a" && c <= "f") return c.charCodeAt(0) - 87;
    if (c >= "A" && c <= "F") return c.charCodeAt(0) - 55;
    return -1;
  }

  function parseString() {
    index++;
    var out = "";
    while (index < source.length) {
      var c = source.charAt(index);
      index++;
      if (c === "\"") return out;
      if (c === "\\") {
        var esc = source.charAt(index);
        index++;
        if (esc === "\"") out += "\"";
        else if (esc === "\\") out += "\\";
        else if (esc === "/") out += "/";
        else if (esc === "b") out += "\b";
        else if (esc === "f") out += "\f";
        else if (esc === "n") out += "\n";
        else if (esc === "r") out += "\r";
        else if (esc === "t") out += "\t";
        else if (esc === "u") {
          var h1 = hexDigit(source.charAt(index));
          var h2 = hexDigit(source.charAt(index + 1));
          var h3 = hexDigit(source.charAt(index + 2));
          var h4 = hexDigit(source.charAt(index + 3));
          if (h1 < 0 || h2 < 0 || h3 < 0 || h4 < 0) fail("Bad unicode escape");
          out += String.fromCharCode(h1 * 4096 + h2 * 256 + h3 * 16 + h4);
          index += 4;
        } else {
          fail("Bad string escape");
        }
      } else {
        if (c.charCodeAt(0) < 32) fail("Control character in string");
        out += c;
      }
    }
    fail("Unterminated string");
  }

  function parseNumber() {
    var start = index;
    var c = source.charAt(index);
    if (c === "-") index++;
    var digits = 0;
    while (index < source.length) {
      c = source.charAt(index);
      if (c >= "0" && c <= "9") {
        index++;
        digits++;
      } else break;
    }
    if (digits === 0) fail("Expected a number");
    if (source.charAt(index) === ".") {
      index++;
      var fraction = 0;
      while (index < source.length) {
        c = source.charAt(index);
        if (c >= "0" && c <= "9") {
          index++;
          fraction++;
        } else break;
      }
      if (fraction === 0) fail("Expected digits after the decimal point");
    }
    c = source.charAt(index);
    if (c === "e" || c === "E") {
      index++;
      c = source.charAt(index);
      if (c === "+" || c === "-") index++;
      var exponent = 0;
      while (index < source.length) {
        c = source.charAt(index);
        if (c >= "0" && c <= "9") {
          index++;
          exponent++;
        } else break;
      }
      if (exponent === 0) fail("Expected an exponent");
    }
    var raw = source.substring(start, index);
    var value = Number(raw);
    if (isNaN(value)) fail("Bad number");
    return value;
  }

  function parseArray() {
    depth++;
    if (depth > 60) fail("Too deeply nested");
    index++;
    var out = [];
    skipSpace();
    if (source.charAt(index) === "]") {
      index++;
      depth--;
      return out;
    }
    while (true) {
      out.push(parseValue());
      skipSpace();
      var c = source.charAt(index);
      if (c === ",") {
        index++;
        continue;
      }
      if (c === "]") {
        index++;
        depth--;
        return out;
      }
      fail("Expected a comma or closing bracket");
    }
  }

  function parseObject() {
    depth++;
    if (depth > 60) fail("Too deeply nested");
    index++;
    var out = {};
    skipSpace();
    if (source.charAt(index) === "}") {
      index++;
      depth--;
      return out;
    }
    while (true) {
      skipSpace();
      if (source.charAt(index) !== "\"") fail("Expected a property name");
      var key = parseString();
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        fail("Reserved property name");
      }
      skipSpace();
      if (source.charAt(index) !== ":") fail("Expected a colon");
      index++;
      out[key] = parseValue();
      skipSpace();
      var c = source.charAt(index);
      if (c === ",") {
        index++;
        continue;
      }
      if (c === "}") {
        index++;
        depth--;
        return out;
      }
      fail("Expected a comma or closing brace");
    }
  }

  function parseValue() {
    skipSpace();
    if (index >= source.length) fail("Unexpected end of file");
    var c = source.charAt(index);
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === "\"") return parseString();
    if (source.substr(index, 4) === "true") {
      index += 4;
      return true;
    }
    if (source.substr(index, 5) === "false") {
      index += 5;
      return false;
    }
    if (source.substr(index, 4) === "null") {
      index += 4;
      return null;
    }
    return parseNumber();
  }

  var result = parseValue();
  skipSpace();
  if (index !== source.length) fail("Unexpected text after the JSON value");
  return result;
}

function qkJsonStringify(value) {
  var type = typeof value;
  var i;
  var out;
  var key;
  var item;

  if (value === null || type === "undefined") return "null";
  if (type === "string") return "\"" + qkJsonEscape(value) + "\"";
  if (type === "number") return isFinite(value) ? String(value) : "0";
  if (type === "boolean") return value ? "true" : "false";

  if (qkPresetIsArray(value)) {
    out = "[";
    for (i = 0; i < value.length; i++) {
      if (i > 0) out += ",";
      out += qkJsonStringify(value[i]);
    }
    return out + "]";
  }

  if (type === "object") {
    out = "{";
    var first = true;
    for (key in value) {
      if (!value.hasOwnProperty(key)) continue;
      item = value[key];
      if (typeof item === "undefined" || typeof item === "function") continue;
      if (!first) out += ",";
      first = false;
      out += "\"" + qkJsonEscape(key) + "\":" + qkJsonStringify(item);
    }
    return out + "}";
  }

  return "null";
}

function qkPathName(path) {
  var text = qkStr(path);
  var slash = text.lastIndexOf("/");
  var back = text.lastIndexOf("\\");
  var cut = slash > back ? slash : back;
  return cut >= 0 ? text.substring(cut + 1) : text;
}

function qkFileRead(path, limit) {
  var file = null;
  try {
    file = new File(path);
  } catch (eFile) {
    return null;
  }
  if (!file) return null;
  try {
    if (!file.exists) return null;
  } catch (eExists) {
    return null;
  }
  try {
    if (file.length > limit) return null;
  } catch (eLength) {}
  try {
    file.encoding = "UTF-8";
  } catch (eEncoding) {}
  try {
    if (!file.open("r")) return null;
  } catch (eOpen) {
    return null;
  }
  var text = null;
  try {
    text = file.read();
  } catch (eRead) {
    text = null;
  }
  try {
    file.close();
  } catch (eClose) {}
  return text;
}

function qkFileWrite(path, text) {
  var file = null;
  try {
    file = new File(path);
  } catch (eFile) {
    return false;
  }
  if (!file) return false;
  try {
    file.encoding = "UTF-8";
  } catch (eEncoding) {}
  try {
    if (!file.open("w")) return false;
  } catch (eOpen) {
    return false;
  }
  var ok = false;
  try {
    ok = file.write(qkStr(text));
  } catch (eWrite) {
    ok = false;
  }
  try {
    file.close();
  } catch (eClose) {}
  return ok !== false;
}

function qkFileWriteSafe(path, text) {
  var tempPath = path + ".tmp";
  if (!qkFileWrite(tempPath, text)) return false;

  var oldFile = null;
  try {
    oldFile = new File(path);
  } catch (eOld) {}
  if (oldFile && oldFile.exists) {
    try {
      oldFile.remove();
    } catch (eRemove) {
      try {
        var leftover = new File(tempPath);
        if (leftover) leftover.remove();
      } catch (eCleanup) {}
      return false;
    }
  }

  var tempFile = null;
  try {
    tempFile = new File(tempPath);
  } catch (eTemp) {}
  if (tempFile) {
    try {
      if (tempFile.rename(qkPathName(path))) return true;
    } catch (eRename) {}
  }

  var data = qkFileRead(tempPath, QK_PRESET_MAX_BYTES);
  if (data === null) return false;
  if (qkFileWrite(path, data)) {
    try {
      var stillThere = new File(tempPath);
      if (stillThere) stillThere.remove();
    } catch (eCleanup2) {}
    return true;
  }
  return false;
}

function qkFileDelete(path) {
  var file = null;
  try {
    file = new File(path);
  } catch (eFile) {
    return false;
  }
  if (!file || !file.exists) return true;
  try {
    return file.remove();
  } catch (eRemove) {
    return false;
  }
}

function qkEnsureFolder(path) {
  var folder = null;
  try {
    folder = new Folder(path);
  } catch (eFolder) {
    return false;
  }
  if (!folder) return false;
  try {
    if (folder.exists) return true;
  } catch (eExists) {}

  var parentPath = "";
  try {
    parentPath = qkStr(folder.parent.fsName);
  } catch (eParent) {}

  var selfPath = "";
  try {
    selfPath = qkStr(folder.fsName);
  } catch (eSelf) {}

  if (parentPath === "" || parentPath === selfPath) return false;
  if (!qkEnsureFolder(parentPath)) return false;
  try {
    return folder.create();
  } catch (eCreate) {
    return false;
  }
}

function qkPresetRootPath() {
  var base = "";
  try {
    base = qkStr(Folder.userData.fsName);
  } catch (eUser) {}
  if (base === "") {
    try {
      base = qkStr(Folder.current.fsName);
    } catch (eCurrent) {}
  }
  base = qkReplaceAll(base, "\\", "/");
  if (base === "") return "";
  while (base.length > 1 && base.charAt(base.length - 1) === "/") {
    base = base.substring(0, base.length - 1);
  }
  return base + "/QuickKit/presets";
}

function qkDateText() {
  var now = new Date();
  return (
    now.getFullYear() +
    "-" + qkPad(now.getMonth() + 1, 2) +
    "-" + qkPad(now.getDate(), 2) +
    " " + qkPad(now.getHours(), 2) +
    ":" + qkPad(now.getMinutes(), 2)
  );
}

function qkPresetSafeId(value) {
  var text = qkStr(value);
  if (text.length < 1 || text.length > 80) return false;
  for (var i = 0; i < text.length; i++) {
    var c = text.charAt(i);
    var code = text.charCodeAt(i);
    var ok =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      c === "_" || c === "-";
    if (!ok) return false;
  }
  return true;
}

function qkPresetNewId() {
  qkPresetIdCounter++;
  return (
    "p" + qkStr(new Date().getTime()) +
    "-" + qkStr(qkPresetIdCounter) +
    "-" + qkStr(Math.floor(Math.random() * 100000))
  );
}

function qkPresetCleanText(value, maxLength) {
  var text = qkTrim(value);
  var out = "";
  var i;
  var ch;
  for (i = 0; i < text.length; i++) {
    ch = text.charAt(i);
    out += text.charCodeAt(i) < 32 ? " " : ch;
  }
  if (out.length > maxLength) out = out.substring(0, maxLength);
  return qkTrim(out);
}

function qkPresetNumber(value, fallback) {
  var number = Number(value);
  return isFinite(number) ? number : fallback;
}

function qkPresetBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function qkPresetIsArray(value) {
  return Object.prototype.toString.call(value) === "[object Array]";
}

function qkPresetCloneColor(value) {
  if (!qkPresetIsArray(value) || value.length < 3) return null;
  var out = [];
  for (var i = 0; i < 3; i++) {
    var number = Number(value[i]);
    if (!isFinite(number)) return null;
    if (number < 0) number = 0;
    if (number > 1) number = 1;
    out.push(number);
  }
  return out;
}

function qkPresetNormalizeValue(value, type) {
  var number;
  var i;
  var out;
  var source;
  var length;

  if (type === 1) {
    if (qkPresetIsArray(value)) number = Number(value[0]);
    else number = Number(value);
    return isFinite(number) ? number : 0;
  }

  source = qkPresetIsArray(value) ? value : [value];
  length = type === 4 ? 3 : type === 2 ? 2 : 3;
  out = [];
  for (i = 0; i < length; i++) {
    number = Number(source[i]);
    if (!isFinite(number)) number = type === 4 ? 1 : 0;
    if (type === 4) {
      if (number < 0) number = 0;
      if (number > 1) number = 1;
    }
    out.push(number);
  }
  return out;
}

function qkPresetValueOk(value, type) {
  var i;
  if (type === 1) {
    if (qkPresetIsArray(value)) return value.length > 0 && isFinite(Number(value[0]));
    return isFinite(Number(value));
  }
  if (type === 2 || type === 3 || type === 4) {
    var length = type === 4 ? 3 : type;
    if (!qkPresetIsArray(value) || value.length < length) return false;
    for (i = 0; i < length; i++) {
      if (!isFinite(Number(value[i]))) return false;
    }
    return true;
  }
  return false;
}

function qkPresetPropType(prop) {
  var type = 0;
  var value = null;
  try {
    type = prop.propertyValueType;
  } catch (eType) {}
  if (typeof type === "number" && type >= 1 && type <= 4) return type;

  try {
    value = prop.value;
  } catch (eValue) {}
  if (typeof value === "number") return 1;
  if (qkPresetIsArray(value)) {
    if (value.length === 2) return 2;
    if (value.length === 3) return 3;
  }
  return 0;
}

function qkPresetPropValueAt(prop, time) {
  try {
    if (typeof prop.valueAtTime === "function") return prop.valueAtTime(time, false);
  } catch (eAt) {}
  try {
    return prop.value;
  } catch (eValue) {
    return null;
  }
}

function qkPresetAddValue(left, right, type) {
  var a = qkPresetNormalizeValue(left, type);
  var b = qkPresetNormalizeValue(right, type);
  var out = [];
  var i;
  if (type === 1) return a + b;
  for (i = 0; i < a.length; i++) out.push(a[i] + b[i]);
  return out;
}

function qkPresetSubtractValue(left, right, type) {
  var a = qkPresetNormalizeValue(left, type);
  var b = qkPresetNormalizeValue(right, type);
  var out = [];
  var i;
  if (type === 1) return a - b;
  for (i = 0; i < a.length; i++) out.push(a[i] - b[i]);
  return out;
}

function qkPresetCoerceValue(value, type) {
  return qkPresetNormalizeValue(value, type);
}

function qkPresetReadEase(value) {
  if (!qkPresetIsArray(value)) return null;
  var out = [];
  for (var i = 0; i < value.length; i++) {
    var item = value[i];
    var speed = 0;
    var influence = 0;
    try {
      speed = Number(item.speed);
      influence = Number(item.influence);
    } catch (eItem) {
      return null;
    }
    if (!isFinite(speed) || !isFinite(influence)) return null;
    out.push([speed, influence]);
  }
  return out;
}

function qkPresetCaptureKeys(prop, layer, type, offsetBase) {
  var count = 0;
  var keys = [];
  var i;
  try {
    count = prop.numKeys;
  } catch (eCount) {
    return null;
  }
  if (!(count > 0)) return null;
  if (count > QK_PRESET_MAX_KEYS) count = QK_PRESET_MAX_KEYS;

  for (i = 1; i <= count; i++) {
    var time = 0;
    var rawValue = null;
    try {
      time = Number(prop.keyTime(i)) - Number(layer.inPoint);
      rawValue = prop.keyValue(i);
    } catch (eKey) {
      continue;
    }
    var value = qkPresetNormalizeValue(rawValue, type);
    if (offsetBase !== null && offsetBase !== undefined) {
      value = qkPresetSubtractValue(value, offsetBase, type);
    }
    var key = { t: isFinite(time) ? time : 0, v: value };
    try {
      key.inType = prop.keyInInterpolationType(i);
      key.outType = prop.keyOutInterpolationType(i);
    } catch (eInterp) {}
    try {
      var inEase = qkPresetReadEase(prop.keyInTemporalEase(i));
      if (inEase) key.inEase = inEase;
    } catch (eInEase) {}
    try {
      var outEase = qkPresetReadEase(prop.keyOutTemporalEase(i));
      if (outEase) key.outEase = outEase;
    } catch (eOutEase) {}
    keys.push(key);
  }

  return keys.length ? keys : null;
}

function qkPresetCaptureProp(prop, layer, scope, match, label, offset, extra) {
  if (!prop) return null;
  var type = qkPresetPropType(prop);
  if (type < 1 || type > 4) return null;

  var current = null;
  try {
    current = prop.value;
  } catch (eValue) {
    return null;
  }
  if (!qkPresetValueOk(current, type)) return null;

  var entry = {
    scope: scope,
    match: qkStr(match),
    label: qkPresetCleanText(label, 40) || qkStr(label),
    type: type,
    value: qkPresetNormalizeValue(current, type),
    offset: false
  };

  if (extra) {
    if (extra.effectMatch) entry.effectMatch = qkStr(extra.effectMatch);
    if (extra.effectName) entry.effectName = qkPresetCleanText(extra.effectName, 60);
    if (extra.path && extra.path.length) entry.path = extra.path.slice(0);
    if (extra.paramMatch) entry.paramMatch = qkStr(extra.paramMatch);
  }

  var base = null;
  if (offset) {
    base = qkPresetPropValueAt(prop, layer.inPoint);
    if (!qkPresetValueOk(base, type)) base = null;
  }

  var keys = qkPresetCaptureKeys(prop, layer, type, base);
  if (keys) {
    entry.keys = keys;
    if (base !== null) entry.offset = true;
  }

  return entry;
}

function qkPresetTransformProp(layer, match) {
  try {
    var group = layer.property("ADBE Transform Group");
    if (group) {
      var prop = group.property(match);
      if (prop) return prop;
    }
  } catch (eGroup) {}

  try {
    if (match === "ADBE Anchor Point") return layer.anchorPoint;
    if (match === "ADBE Position") return layer.position;
    if (match === "ADBE Scale") return layer.scale;
    if (match === "ADBE Rotate Z") return layer.rotation;
    if (match === "ADBE Opacity") return layer.opacity;
  } catch (eShortcut) {}
  return null;
}

var QK_PRESET_TRANSFORM = [
  ["ADBE Anchor Point", "Anchor point", true],
  ["ADBE Position", "Position", true],
  ["ADBE Scale", "Scale", false],
  ["ADBE Rotate Z", "Rotation", false],
  ["ADBE Opacity", "Opacity", false]
];

function qkPresetCaptureTransform(layer, props) {
  for (var i = 0; i < QK_PRESET_TRANSFORM.length; i++) {
    var def = QK_PRESET_TRANSFORM[i];
    var prop = qkPresetTransformProp(layer, def[0]);
    var entry = qkPresetCaptureProp(prop, layer, "transform", def[0], def[1], def[2], null);
    if (entry) props.push(entry);
  }
}

function qkPresetReadNumberField(source, key) {
  try {
    var value = source[key];
    return isFinite(Number(value)) ? Number(value) : null;
  } catch (eField) {
    return null;
  }
}

function qkPresetReadBoolField(source, key) {
  try {
    var value = source[key];
    return value === true ? true : value === false ? false : null;
  } catch (eField) {
    return null;
  }
}

function qkPresetCaptureText(layer) {
  var textProps = null;
  var docProp = null;
  var doc = null;
  try {
    textProps = layer.property("ADBE Text Properties");
  } catch (eProps) {}
  if (!textProps) return null;
  try {
    docProp = textProps.property("ADBE Text Document");
  } catch (eDocProp) {}
  if (!docProp) return null;
  try {
    doc = docProp.value;
  } catch (eDoc) {}
  if (!doc) return null;

  var style = {};
  var has = false;
  var font = "";
  try {
    font = qkStr(doc.font);
  } catch (eFont) {}
  if (font !== "") {
    style.font = font;
    has = true;
  }

  var numberFields = [
    "fontSize", "tracking", "leading", "baselineShift", "horizontalScale",
    "verticalScale", "strokeWidth"
  ];
  for (var i = 0; i < numberFields.length; i++) {
    var number = qkPresetReadNumberField(doc, numberFields[i]);
    if (number !== null) {
      style[numberFields[i]] = number;
      has = true;
    }
  }

  var boolFields = [
    "applyFill", "applyStroke", "fauxBold", "fauxItalic", "allCaps",
    "smallCaps", "strokeOverFill"
  ];
  for (var j = 0; j < boolFields.length; j++) {
    var bool = qkPresetReadBoolField(doc, boolFields[j]);
    if (bool !== null) {
      style[boolFields[j]] = bool;
      has = true;
    }
  }

  var justification = qkPresetReadNumberField(doc, "justification");
  if (justification !== null) {
    style.justification = justification;
    has = true;
  }

  var fill = null;
  try {
    fill = qkPresetCloneColor(doc.fillColor);
  } catch (eFill) {}
  if (fill) {
    style.fillColor = fill;
    has = true;
  }

  var stroke = null;
  try {
    stroke = qkPresetCloneColor(doc.strokeColor);
  } catch (eStroke) {}
  if (stroke) {
    style.strokeColor = stroke;
    has = true;
  }

  return has ? style : null;
}

function qkPresetCaptureEffectParams(group, layer, effectMatch, effectName, props, path, depth) {
  if (depth > 3) return;
  var count = 0;
  try {
    count = group.numProperties;
  } catch (eCount) {
    return;
  }
  for (var i = 1; i <= count; i++) {
    if (props.length >= QK_PRESET_MAX_PROPS) return;
    var prop = null;
    try {
      prop = group.property(i);
    } catch (eProp) {}
    if (!prop) continue;

    var isGroup = false;
    try {
      isGroup = prop.propertyType === 2;
    } catch (eType) {}
    if (isGroup) {
      path.push(i);
      qkPresetCaptureEffectParams(prop, layer, effectMatch, effectName, props, path, depth + 1);
      path.pop();
      continue;
    }

    var entry = qkPresetCaptureProp(
      prop,
      layer,
      "effect",
      qkStr(prop.matchName) || qkStr(prop.name),
      qkStr(prop.name),
      false,
      {
        effectMatch: effectMatch,
        effectName: effectName,
        path: path.concat([i]),
        paramMatch: qkStr(prop.matchName)
      }
    );
    if (entry) props.push(entry);
  }
}

function qkPresetCaptureEffects(layer, props) {
  var parade = null;
  try {
    parade = layer.property("ADBE Effect Parade");
  } catch (eParade) {}
  if (!parade) return;
  var count = 0;
  try {
    count = parade.numProperties;
  } catch (eCount) {
    return;
  }
  for (var i = 1; i <= count; i++) {
    var effect = null;
    try {
      effect = parade.property(i);
    } catch (eEffect) {}
    if (!effect) continue;
    var effectMatch = "";
    var effectName = "";
    try {
      effectMatch = qkStr(effect.matchName);
      effectName = qkStr(effect.name);
    } catch (eInfo) {}
    if (effectMatch === "") continue;
    qkPresetCaptureEffectParams(effect, layer, effectMatch, effectName, props, [], 0);
  }
}

function qkPresetLocateSelectedProp(layer, prop) {
  for (var i = 0; i < QK_PRESET_TRANSFORM.length; i++) {
    var def = QK_PRESET_TRANSFORM[i];
    var candidate = qkPresetTransformProp(layer, def[0]);
    var same = false;
    if (candidate === prop) same = true;
    else {
      try {
        if (qkStr(candidate.matchName) === def[0] && qkStr(prop.matchName) === def[0]) same = true;
      } catch (eMatch) {}
    }
    if (!same) continue;
    var entry = qkPresetCaptureProp(candidate, layer, "transform", def[0], def[1], def[2], null);
    return entry ? { entry: entry } : null;
  }

  try {
    var textProps = layer.property("ADBE Text Properties");
    if (textProps) {
      var docProp = textProps.property("ADBE Text Document");
      if (docProp && (docProp === prop || qkStr(prop.matchName) === "ADBE Text Document")) {
        return { text: true };
      }
    }
  } catch (eText) {}

  var parade = null;
  try {
    parade = layer.property("ADBE Effect Parade");
  } catch (eParade) {}
  if (!parade) return null;

  var effectCount = 0;
  try {
    effectCount = parade.numProperties;
  } catch (eCount) {
    return null;
  }
  for (var e = 1; e <= effectCount; e++) {
    var effect = null;
    try {
      effect = parade.property(e);
    } catch (eEffect) {}
    if (!effect) continue;
    var effectMatch = "";
    var effectName = "";
    try {
      effectMatch = qkStr(effect.matchName);
      effectName = qkStr(effect.name);
    } catch (eInfo) {}
    if (effectMatch === "") continue;
    var found = qkPresetLocateInEffect(effect, layer, prop, effectMatch, effectName, [], 0);
    if (found) return { entry: found };
  }

  return null;
}

function qkPresetLocateInEffect(group, layer, target, effectMatch, effectName, path, depth) {
  if (depth > 3) return null;
  var count = 0;
  try {
    count = group.numProperties;
  } catch (eCount) {
    return null;
  }
  for (var i = 1; i <= count; i++) {
    var prop = null;
    try {
      prop = group.property(i);
    } catch (eProp) {}
    if (!prop) continue;
    var isGroup = false;
    try {
      isGroup = prop.propertyType === 2;
    } catch (eType) {}
    if (isGroup) {
      path.push(i);
      var nested = qkPresetLocateInEffect(prop, layer, target, effectMatch, effectName, path, depth + 1);
      path.pop();
      if (nested) return nested;
      continue;
    }
    var same = prop === target;
    if (!same) {
      try {
        same = qkStr(prop.matchName) === qkStr(target.matchName) && qkStr(prop.name) === qkStr(target.name);
      } catch (eMatch) {}
    }
    if (!same) continue;
    return qkPresetCaptureProp(
      prop,
      layer,
      "effect",
      qkStr(prop.matchName) || qkStr(prop.name),
      qkStr(prop.name),
      false,
      {
        effectMatch: effectMatch,
        effectName: effectName,
        path: path.concat([i]),
        paramMatch: qkStr(prop.matchName)
      }
    );
  }
  return null;
}

function qkPresetCaptureSelected(layer) {
  var selected = null;
  try {
    selected = layer.selectedProperties;
  } catch (eSelected) {
    return null;
  }
  if (!qkPresetIsArray(selected) || selected.length === 0) return null;

  var props = [];
  var text = null;
  var seen = {};
  for (var i = 0; i < selected.length; i++) {
    var prop = selected[i];
    if (!prop) continue;
    var isGroup = false;
    try {
      isGroup = prop.propertyType === 2;
    } catch (eGroup) {}
    if (isGroup) continue;

    var located = qkPresetLocateSelectedProp(layer, prop);
    if (!located) continue;
    if (located.text) {
      if (!text) text = qkPresetCaptureText(layer);
      continue;
    }
    if (!located.entry) continue;
    var key = located.entry.scope + "|" + located.entry.match + "|" + qkStr(located.entry.effectMatch);
    if (seen[key]) continue;
    seen[key] = true;
    props.push(located.entry);
  }

  if (!props.length && !text) return null;
  return { props: props, text: text };
}

function qkPresetCaptureLayer(layer, selectedOnly) {
  var props = [];
  var text = null;

  if (selectedOnly) {
    var selected = qkPresetCaptureSelected(layer);
    if (selected) {
      props = selected.props;
      text = selected.text;
    }
  }

  if (!props.length && !text) {
    qkPresetCaptureTransform(layer, props);
    text = qkPresetCaptureText(layer);
    qkPresetCaptureEffects(layer, props);
  }

  if (!props.length && !text) return null;
  if (props.length > QK_PRESET_MAX_PROPS) props = props.slice(0, QK_PRESET_MAX_PROPS);

  return {
    name: qkPresetCleanText(layer.name, 60) || "Layer",
    kind: text ? "text" : "layer",
    props: props,
    text: text
  };
}

function qkPresetThumbnail(layers) {
  var color = [0.486, 0.361, 1];
  var glyph = "L";
  var motion = false;
  var hasText = false;

  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (layer.text) {
      hasText = true;
      if (layer.text.fillColor) color = qkPresetCloneColor(layer.text.fillColor) || color;
    }
    var props = layer.props || [];
    for (var j = 0; j < props.length; j++) {
      if (props[j].keys && props[j].keys.length) motion = true;
    }
  }

  if (hasText) glyph = "T";
  else if (motion) glyph = "M";

  return { glyph: glyph, color: color, motion: motion };
}

function qkPresetSummary(layers) {
  var text = false;
  var animated = false;
  var count = 0;
  for (var i = 0; i < layers.length; i++) {
    if (layers[i].text) text = true;
    var props = layers[i].props || [];
    for (var j = 0; j < props.length; j++) {
      count++;
      if (props[j].keys && props[j].keys.length) animated = true;
    }
  }
  var lead = text ? "Text style" : animated ? "Animated" : "Static look";
  var detail = count ? qkPlural(count, "property", "properties") + " · " : "";
  return qkPresetCleanText(lead + " · " + detail + qkPlural(layers.length, "layer", "layers"), 90);
}

/* ---------- validation ---------- */

function qkPresetNormalizeThumbnail(raw) {
  var source = raw && typeof raw === "object" ? raw : {};
  var glyph = qkPresetCleanText(source.glyph, 2).toUpperCase();
  if (glyph === "") glyph = "P";
  var color = qkPresetCloneColor(source.color);
  if (!color) color = [0.486, 0.361, 1];
  return { glyph: glyph, color: color, motion: source.motion === true };
}

function qkPresetNormalizeText(raw) {
  if (!raw || typeof raw !== "object" || qkPresetIsArray(raw)) return null;
  var style = {};
  var has = false;
  var i;

  var font = qkPresetCleanText(raw.font, 100);
  if (font !== "") {
    style.font = font;
    has = true;
  }

  var numbers = [
    "fontSize", "tracking", "leading", "baselineShift", "horizontalScale",
    "verticalScale", "strokeWidth", "justification"
  ];
  for (i = 0; i < numbers.length; i++) {
    if (typeof raw[numbers[i]] === "number" && isFinite(raw[numbers[i]])) {
      style[numbers[i]] = raw[numbers[i]];
      has = true;
    }
  }

  var bools = [
    "applyFill", "applyStroke", "fauxBold", "fauxItalic", "allCaps",
    "smallCaps", "strokeOverFill"
  ];
  for (i = 0; i < bools.length; i++) {
    if (typeof raw[bools[i]] === "boolean") {
      style[bools[i]] = raw[bools[i]];
      has = true;
    }
  }

  var fill = qkPresetCloneColor(raw.fillColor);
  if (fill) {
    style.fillColor = fill;
    has = true;
  }
  var stroke = qkPresetCloneColor(raw.strokeColor);
  if (stroke) {
    style.strokeColor = stroke;
    has = true;
  }

  return has ? style : null;
}

function qkPresetNormalizeEase(raw) {
  if (!qkPresetIsArray(raw)) return null;
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var pair = raw[i];
    if (!qkPresetIsArray(pair) || pair.length < 2) return null;
    var speed = Number(pair[0]);
    var influence = Number(pair[1]);
    if (!isFinite(speed) || !isFinite(influence)) return null;
    out.push([speed, influence]);
  }
  return out.length ? out : null;
}

function qkPresetNormalizeKey(raw, type) {
  if (!raw || typeof raw !== "object") return null;
  var time = Number(raw.t);
  if (!isFinite(time)) return null;
  if (!qkPresetValueOk(raw.v, type)) return null;
  var key = { t: time, v: qkPresetNormalizeValue(raw.v, type) };
  if (typeof raw.inType === "number") key.inType = raw.inType;
  if (typeof raw.outType === "number") key.outType = raw.outType;
  var inEase = qkPresetNormalizeEase(raw.inEase);
  if (inEase) key.inEase = inEase;
  var outEase = qkPresetNormalizeEase(raw.outEase);
  if (outEase) key.outEase = outEase;
  return key;
}

function qkPresetNormalizeProp(raw) {
  if (!raw || typeof raw !== "object" || qkPresetIsArray(raw)) return null;
  var scope = qkStr(raw.scope);
  if (scope !== "transform" && scope !== "effect") return null;
  var match = qkPresetCleanText(raw.match, 80);
  if (match === "") return null;
  var type = Number(raw.type);
  if (!(type === 1 || type === 2 || type === 3 || type === 4)) return null;
  if (!qkPresetValueOk(raw.value, type)) return null;

  var entry = {
    scope: scope,
    match: match,
    label: qkPresetCleanText(raw.label, 40) || match,
    type: type,
    value: qkPresetNormalizeValue(raw.value, type),
    offset: false
  };

  if (scope === "effect") {
    var effectMatch = qkPresetCleanText(raw.effectMatch, 80);
    if (effectMatch === "") return null;
    entry.effectMatch = effectMatch;
    entry.effectName = qkPresetCleanText(raw.effectName, 60);
    if (qkPresetIsArray(raw.path)) {
      var path = [];
      for (var i = 0; i < raw.path.length && i < 12; i++) {
        var index = Number(raw.path[i]);
        if (isFinite(index) && index > 0) path.push(Math.floor(index));
      }
      if (path.length) entry.path = path;
    }
    if (qkStr(raw.paramMatch) !== "") entry.paramMatch = qkPresetCleanText(raw.paramMatch, 80);
  }

  if (qkPresetIsArray(raw.keys)) {
    var keys = [];
    for (var k = 0; k < raw.keys.length && k < QK_PRESET_MAX_KEYS; k++) {
      var key = qkPresetNormalizeKey(raw.keys[k], type);
      if (key) keys.push(key);
    }
    if (keys.length) {
      entry.keys = keys;
      entry.offset = raw.offset === true;
    }
  }

  return entry;
}

function qkPresetNormalizeLayer(raw) {
  if (!raw || typeof raw !== "object" || qkPresetIsArray(raw)) return null;
  var props = [];
  if (qkPresetIsArray(raw.props)) {
    for (var i = 0; i < raw.props.length && props.length < QK_PRESET_MAX_PROPS; i++) {
      var entry = qkPresetNormalizeProp(raw.props[i]);
      if (entry) props.push(entry);
    }
  }
  var text = qkPresetNormalizeText(raw.text);
  if (!props.length && !text) return null;
  return {
    name: qkPresetCleanText(raw.name, 60) || "Layer",
    kind: text ? "text" : "layer",
    props: props,
    text: text
  };
}

function qkPresetNormalize(raw, id) {
  if (!raw || typeof raw !== "object" || qkPresetIsArray(raw)) {
    return { error: "not a preset object" };
  }
  if (qkStr(raw.format) !== QK_PRESET_FORMAT) {
    return { error: "not a QuickKit preset" };
  }

  var name = qkPresetCleanText(raw.name, 60);
  if (name === "") return { error: "missing preset name" };

  var safeId = qkStr(id);
  if (!qkPresetSafeId(safeId)) safeId = qkStr(raw.id);
  if (!qkPresetSafeId(safeId)) return { error: "missing preset id" };

  if (!qkPresetIsArray(raw.layers)) return { error: "missing layers" };
  var layers = [];
  for (var i = 0; i < raw.layers.length && i < QK_PRESET_MAX_LAYERS; i++) {
    var layer = qkPresetNormalizeLayer(raw.layers[i]);
    if (layer) layers.push(layer);
  }
  if (!layers.length) return { error: "no usable layers" };

  var preset = {
    format: QK_PRESET_FORMAT,
    version: QK_PRESET_VERSION,
    id: safeId,
    name: name,
    folder: qkPresetCleanText(raw.folder, 40),
    favorite: raw.favorite === true,
    order: qkPresetNumber(raw.order, 0),
    created: qkPresetCleanText(raw.created, 40) || qkDateText(),
    summary: qkPresetCleanText(raw.summary, 90) || qkPresetSummary(layers),
    thumbnail: qkPresetNormalizeThumbnail(raw.thumbnail),
    layers: layers
  };
  return { preset: preset };
}

/* ---------- apply ---------- */

function qkPresetFindEffect(parade, match) {
  var count = 0;
  try {
    count = parade.numProperties;
  } catch (eCount) {
    return null;
  }
  for (var i = 1; i <= count; i++) {
    var effect = null;
    try {
      effect = parade.property(i);
    } catch (eEffect) {}
    if (!effect) continue;
    try {
      if (qkStr(effect.matchName) === match) return effect;
    } catch (eMatch) {}
  }
  return null;
}

function qkPresetParamAtPath(effect, path) {
  if (!qkPresetIsArray(path) || !path.length) return null;
  var node = effect;
  for (var i = 0; i < path.length; i++) {
    var index = Number(path[i]);
    if (!(index > 0)) return null;
    try {
      node = node.property(index);
    } catch (eProp) {
      return null;
    }
    if (!node) return null;
  }
  var isGroup = false;
  try {
    isGroup = node.propertyType === 2;
  } catch (eType) {}
  return isGroup ? null : node;
}

function qkPresetFindParamByMatch(group, entry, depth) {
  if (depth > 3) return null;
  var count = 0;
  try {
    count = group.numProperties;
  } catch (eCount) {
    return null;
  }
  for (var i = 1; i <= count; i++) {
    var prop = null;
    try {
      prop = group.property(i);
    } catch (eProp) {}
    if (!prop) continue;
    var isGroup = false;
    try {
      isGroup = prop.propertyType === 2;
    } catch (eType) {}
    if (isGroup) {
      var nested = qkPresetFindParamByMatch(prop, entry, depth + 1);
      if (nested) return nested;
      continue;
    }
    var match = "";
    var name = "";
    try {
      match = qkStr(prop.matchName);
      name = qkStr(prop.name);
    } catch (eInfo) {}
    if (entry.paramMatch && match === entry.paramMatch) return prop;
    if (match === entry.match || name === entry.label) return prop;
  }
  return null;
}

function qkPresetResolveEffect(parade, entry, cache) {
  var key = "#" + qkStr(entry.effectMatch);
  if (cache[key]) return cache[key];
  var effect = qkPresetFindEffect(parade, entry.effectMatch);
  if (!effect) {
    try {
      effect = parade.addProperty(entry.effectMatch);
    } catch (eAdd) {
      effect = null;
    }
  }
  if (effect) cache[key] = effect;
  return effect;
}

function qkPresetApplyEaseAtKey(prop, index, key) {
  if (typeof key.inType === "number" && typeof key.outType === "number") {
    try {
      prop.setInterpolationTypeAtKey(index, key.inType, key.outType);
    } catch (eInterp) {}
  }
  if (!key.inEase || !key.outEase) return;
  if (typeof KeyframeEase === "undefined") return;
  try {
    var inList = [];
    var outList = [];
    var i;
    for (i = 0; i < key.inEase.length; i++) {
      inList.push(new KeyframeEase(key.inEase[i][0], key.inEase[i][1]));
    }
    for (i = 0; i < key.outEase.length; i++) {
      outList.push(new KeyframeEase(key.outEase[i][0], key.outEase[i][1]));
    }
    prop.setTemporalEaseAtKey(index, inList, outList);
  } catch (eEase) {}
}

function qkPresetApplyProp(prop, entry, layer) {
  if (!prop) return "property not found";
  var expression = false;
  try {
    expression = prop.expressionEnabled === true;
  } catch (eExpression) {}
  if (expression) return "expression is enabled";

  var type = qkPresetPropType(prop);
  if (type < 1 || type > 4) return "unsupported property";

  var base = null;
  if (entry.offset) {
    base = qkPresetPropValueAt(prop, layer.inPoint);
    if (!qkPresetValueOk(base, type)) base = null;
  }

  var count = 0;
  try {
    count = prop.numKeys;
  } catch (eCount) {}
  for (var i = count; i >= 1; i--) {
    try {
      prop.removeKey(i);
    } catch (eRemove) {
      return "existing keyframes could not be replaced";
    }
  }

  if (entry.keys && entry.keys.length) {
    for (var k = 0; k < entry.keys.length; k++) {
      var key = entry.keys[k];
      var value = qkPresetCoerceValue(key.v, type);
      if (base !== null) value = qkPresetAddValue(value, base, type);
      var time = Number(layer.inPoint) + Number(key.t);
      try {
        prop.setValueAtTime(time, value);
      } catch (eSet) {
        return "a keyframe could not be set";
      }
      qkPresetApplyEaseAtKey(prop, k + 1, key);
    }
    return "";
  }

  var staticValue = qkPresetCoerceValue(entry.value, type);
  if (base !== null) staticValue = qkPresetAddValue(staticValue, base, type);
  try {
    prop.setValue(staticValue);
  } catch (eStatic) {
    return "value could not be set";
  }
  return "";
}

function qkPresetApplyText(layer, style) {
  if (!style) return "no text style";
  var textProps = null;
  var docProp = null;
  var doc = null;
  try {
    textProps = layer.property("ADBE Text Properties");
  } catch (eProps) {}
  if (!textProps) return "not a text layer";
  try {
    docProp = textProps.property("ADBE Text Document");
  } catch (eDocProp) {}
  if (!docProp) return "not a text layer";
  try {
    doc = docProp.value;
  } catch (eDoc) {}
  if (!doc) return "text style is not readable";

  var applied = 0;
  var fields = [
    "fontSize", "tracking", "leading", "baselineShift", "horizontalScale",
    "verticalScale", "strokeWidth", "justification"
  ];
  var i;
  for (i = 0; i < fields.length; i++) {
    if (typeof style[fields[i]] !== "number") continue;
    try {
      doc[fields[i]] = style[fields[i]];
      applied++;
    } catch (eField) {}
  }

  var bools = [
    "applyFill", "applyStroke", "fauxBold", "fauxItalic", "allCaps",
    "smallCaps", "strokeOverFill"
  ];
  for (i = 0; i < bools.length; i++) {
    if (typeof style[bools[i]] !== "boolean") continue;
    try {
      doc[bools[i]] = style[bools[i]];
      applied++;
    } catch (eBool) {}
  }

  if (style.font) {
    try {
      doc.font = style.font;
      applied++;
    } catch (eFont) {}
  }
  if (style.fillColor) {
    try {
      doc.fillColor = qkPresetCloneColor(style.fillColor);
      applied++;
    } catch (eFill) {}
  }
  if (style.strokeColor) {
    try {
      doc.strokeColor = qkPresetCloneColor(style.strokeColor);
      applied++;
    } catch (eStroke) {}
  }

  if (!applied) return "text style could not be set";
  try {
    docProp.setValue(doc);
  } catch (eSet) {
    return "text style could not be written";
  }
  return "";
}

function qkPresetApply(id) {
  var presetId = qkStr(id);
  if (!qkPresetSafeId(presetId)) {
    return qkErr("Unknown preset. Reload the list and try again.");
  }

  var root = qkPresetRootPath();
  if (root === "") return qkErr("QuickKit could not find your AppData folder.");
  var loaded = qkPresetLoadOne(root, presetId);
  if (loaded.error) return qkErr(loaded.error);
  var preset = loaded.preset;

  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);
  var selection = qkSelectedLayers(ctx.comp);
  if (selection.error) return qkErr(selection.error);

  var selected = selection.layers;
  var saved = preset.layers;
  var targets = [];
  var i;
  if (saved.length === 1) {
    for (i = 0; i < selected.length; i++) targets.push(selected[i]);
  } else {
    for (i = 0; i < saved.length && i < selected.length; i++) targets.push(selected[i]);
  }

  var notes = [];
  if (saved.length > selected.length && saved.length > 1) {
    notes.push("only " + selected.length + " of " + saved.length + " saved layers were applied");
  }

  var appliedLayers = 0;
  var appliedProps = 0;
  var applyError = "";
  var started = qkBeginUndo("QuickKit: Apply preset");

  try {
  for (i = 0; i < targets.length; i++) {
    var target = targets[i];
    var savedLayer = saved[saved.length === 1 ? 0 : i];
    if (!savedLayer) continue;
    if (target.locked) {
      notes.push(qkStr(target.name) + " is locked");
      continue;
    }

    var changed = false;
    if (savedLayer.text) {
      var textProblem = qkPresetApplyText(target, savedLayer.text);
      if (textProblem === "") changed = true;
      else if (textProblem !== "not a text layer") notes.push(qkStr(target.name) + ": " + textProblem);
    }

    var effectCache = {};
    var props = savedLayer.props || [];
    for (var p = 0; p < props.length; p++) {
      var entry = props[p];
      var prop = null;
      if (entry.scope === "transform") {
        prop = qkPresetTransformProp(target, entry.match);
      } else {
        var parade = null;
        try {
          parade = target.property("ADBE Effect Parade");
        } catch (eParade) {}
        if (parade) {
          var effect = qkPresetResolveEffect(parade, entry, effectCache);
          if (effect) {
            prop = qkPresetParamAtPath(effect, entry.path);
            if (!prop) prop = qkPresetFindParamByMatch(effect, entry, 0);
          }
        }
      }

      var problem = qkPresetApplyProp(prop, entry, target);
      if (problem === "") {
        appliedProps++;
        changed = true;
      } else if (notes.length < 6) {
        notes.push(qkStr(target.name) + ": " + entry.label + " — " + problem);
      }
    }

    if (changed) appliedLayers++;
  }
  } catch (eApply) {
    applyError = qkErrText(eApply);
  }

  qkEndUndo(started);

  if (applyError !== "") {
    return qkErr("Applying the preset stopped: " + applyError + ".");
  }

  if (appliedLayers === 0) {
    var failed = "Nothing was applied from \"" + preset.name + "\".";
    if (notes.length) failed += " " + qkJoin(notes) + ".";
    return qkErr(failed);
  }

  var message =
    "Applied \"" + preset.name + "\" to " + qkPlural(appliedLayers, "layer", "layers") +
    " (" + qkPlural(appliedProps, "property", "properties") + ").";
  if (notes.length) message += " " + qkJoin(notes) + ".";
  return qkOk(message);
}

/* ---------- store ---------- */

function qkPresetFilePath(root, id) {
  return root + "/" + id + ".qkpreset";
}

function qkPresetLoadOne(root, id) {
  if (!qkPresetSafeId(id)) return { error: "Unknown preset." };
  var text = qkFileRead(qkPresetFilePath(root, id), QK_PRESET_MAX_BYTES);
  if (text === null) return { error: "That preset file is missing or unreadable." };
  var raw = null;
  try {
    raw = qkJsonParse(text);
  } catch (eParse) {
    return { error: "That preset file is damaged." };
  }
  var normalized = qkPresetNormalize(raw, id);
  if (normalized.error) return { error: "That preset file is damaged." };
  return { preset: normalized.preset };
}

function qkPresetListFiles(root) {
  var out = [];
  var folder = null;
  try {
    folder = new Folder(root);
  } catch (eFolder) {
    return out;
  }
  if (!folder) return out;
  var items = null;
  try {
    if (!folder.exists) return out;
    items = folder.getFiles("*.qkpreset");
  } catch (eFiles) {
    return out;
  }
  if (!items) return out;
  for (var i = 0; i < items.length; i++) {
    var path = "";
    try {
      path = qkStr(items[i].fsName);
    } catch (ePath) {}
    var name = qkPathName(path);
    if (name.length <= 9) continue;
    if (name.substring(name.length - 9) !== ".qkpreset") continue;
    var id = name.substring(0, name.length - 9);
    if (!qkPresetSafeId(id)) continue;
    out.push({ path: path, id: id, name: name });
  }
  return out;
}

function qkPresetFolderIndex(folders, name) {
  var needle = qkStr(name).toLowerCase();
  for (var i = 0; i < folders.length; i++) {
    if (folders[i].toLowerCase() === needle) return i;
  }
  return -1;
}

function qkPresetDeriveFolders(presets) {
  var folders = [];
  for (var i = 0; i < presets.length; i++) {
    var name = presets[i].folder;
    if (name === "") continue;
    if (qkPresetFolderIndex(folders, name) === -1) folders.push(name);
  }
  return folders;
}

function qkPresetFoldersWrite(root, folders) {
  var data = {
    format: QK_FOLDERS_FORMAT,
    version: QK_PRESET_VERSION,
    folders: folders
  };
  return qkFileWriteSafe(root + "/folders.json", qkJsonStringify(data));
}

function qkPresetFoldersRead(root, presets) {
  var folders = [];
  var note = "";
  var damaged = false;
  var text = qkFileRead(root + "/folders.json", 65536);

  if (text !== null) {
    var raw = null;
    try {
      raw = qkJsonParse(text);
    } catch (eParse) {
      raw = null;
    }
    if (raw && qkStr(raw.format) === QK_FOLDERS_FORMAT && qkPresetIsArray(raw.folders)) {
      for (var i = 0; i < raw.folders.length && folders.length < QK_PRESET_MAX_FOLDERS; i++) {
        var name = qkPresetCleanText(raw.folders[i], 40);
        if (name === "") continue;
        if (qkPresetFolderIndex(folders, name) === -1) folders.push(name);
      }
    } else {
      damaged = true;
    }
  }

  var derived = qkPresetDeriveFolders(presets);
  for (var j = 0; j < derived.length && folders.length < QK_PRESET_MAX_FOLDERS; j++) {
    if (qkPresetFolderIndex(folders, derived[j]) === -1) folders.push(derived[j]);
  }

  if (damaged) {
    note = "The folder list was damaged and was rebuilt from the saved presets.";
    qkPresetFoldersWrite(root, folders);
  } else if (text === null && folders.length) {
    qkPresetFoldersWrite(root, folders);
  }

  return { folders: folders, note: note, damaged: damaged };
}

function qkPresetSort(presets) {
  for (var i = 1; i < presets.length; i++) {
    var item = presets[i];
    var j = i - 1;
    while (j >= 0) {
      var before = presets[j];
      var after = item.order < before.order ||
        (item.order === before.order && item.name.toLowerCase() < before.name.toLowerCase());
      if (!after) break;
      presets[j + 1] = before;
      j--;
    }
    presets[j + 1] = item;
  }
  return presets;
}

function qkPresetMaxOrder(presets) {
  var max = -1;
  for (var i = 0; i < presets.length; i++) {
    if (presets[i].order > max) max = presets[i].order;
  }
  return max;
}

function qkPresetSeedStarters(root) {
  var starters = qkStarterPresets();
  var folders = ["Motion", "Styles", "Titles"];
  var presets = [];
  var failed = 0;

  for (var i = 0; i < starters.length; i++) {
    var preset = starters[i];
    preset.id = qkPresetNewId();
    preset.order = i;
    preset.created = qkDateText();
    preset.summary = qkPresetSummary(preset.layers);
    preset.thumbnail = qkPresetThumbnail(preset.layers);
    if (qkFileWriteSafe(qkPresetFilePath(root, preset.id), qkJsonStringify(preset))) {
      presets.push(preset);
    } else {
      failed++;
    }
  }

  if (failed === 0) {
    qkPresetFoldersWrite(root, folders);
  }

  return { presets: presets, folders: folders, failed: failed };
}

function qkPresetLoadStore(seedAllowed) {
  var root = qkPresetRootPath();
  if (root === "") return { error: "QuickKit could not find your AppData folder." };
  if (!qkEnsureFolder(root)) {
    return { error: "QuickKit could not create its preset folder. Check that this path is writable: " + root };
  }

  var files = qkPresetListFiles(root);
  var presets = [];
  var skipped = [];
  var seen = {};

  for (var i = 0; i < files.length; i++) {
    var loaded = qkPresetLoadOne(root, files[i].id);
    if (loaded.error) {
      if (skipped.length < 20) skipped.push(files[i].name);
      continue;
    }
    var key = "#" + files[i].id;
    if (seen[key]) {
      if (skipped.length < 20) skipped.push(files[i].name);
      continue;
    }
    seen[key] = true;
    presets.push(loaded.preset);
  }

  qkPresetSort(presets);
  var folderInfo = qkPresetFoldersRead(root, presets);
  var folders = folderInfo.folders;
  var notes = [];
  if (folderInfo.note) notes.push(folderInfo.note);

  var seeded = 0;
  var marker = qkFileRead(root + "/.seeded", 64);
  if (marker === null) {
    if (seedAllowed && presets.length === 0) {
      var seedResult = qkPresetSeedStarters(root);
      if (seedResult.presets.length) {
        presets = seedResult.presets;
        folders = seedResult.folders;
        seeded = seedResult.presets.length;
      }
      if (seedResult.failed) {
        notes.push("Some starter presets could not be written.");
      }
    }
    if (presets.length > 0) qkFileWrite(root + "/.seeded", "1");
  }

  if (skipped.length) {
    notes.push(qkPlural(skipped.length, "damaged preset file was", "damaged preset files were") + " skipped.");
  }

  return {
    root: root,
    presets: presets,
    folders: folders,
    skipped: skipped,
    seeded: seeded,
    note: qkJoin(notes)
  };
}

function qkPresetMeta(preset) {
  var props = 0;
  for (var i = 0; i < preset.layers.length; i++) {
    props += (preset.layers[i].props || []).length;
  }
  return {
    id: preset.id,
    name: preset.name,
    folder: preset.folder,
    favorite: preset.favorite,
    order: preset.order,
    created: preset.created,
    summary: preset.summary,
    thumbnail: preset.thumbnail,
    layerCount: preset.layers.length,
    propCount: props
  };
}

function qkPresetList() {
  var store = qkPresetLoadStore(true);
  if (store.error) return qkErr(store.error);

  var metas = [];
  for (var i = 0; i < store.presets.length; i++) metas.push(qkPresetMeta(store.presets[i]));

  var message = qkPlural(store.presets.length, "preset", "presets") + " in " + store.root;
  if (store.seeded) message += ". " + qkPlural(store.seeded, "starter preset was", "starter presets were") + " added";

  return qkJsonStringify({
    ok: true,
    message: message,
    root: store.root,
    folders: store.folders,
    presets: metas,
    skipped: store.skipped,
    seeded: store.seeded,
    note: store.note
  });
}

function qkPresetSave(name, folder) {
  var presetName = qkPresetCleanText(name, 60);
  if (presetName === "") return qkErr("Give the preset a name first.");
  var folderName = qkPresetCleanText(folder, 40);

  var store = qkPresetLoadStore(false);
  if (store.error) return qkErr(store.error);
  if (store.presets.length >= QK_PRESET_LIMIT) {
    return qkErr("QuickKit holds up to " + QK_PRESET_LIMIT + " presets. Delete a few before saving another.");
  }

  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);
  var selection = qkSelectedLayers(ctx.comp);
  if (selection.error) return qkErr(selection.error);

  var layers = [];
  var skipped = [];
  for (var i = 0; i < selection.layers.length && layers.length < QK_PRESET_MAX_LAYERS; i++) {
    var layer = qkPresetCaptureLayer(selection.layers[i], true);
    if (layer) layers.push(layer);
    else if (skipped.length < 6) skipped.push(qkStr(selection.layers[i].name));
  }

  if (!layers.length) {
    return qkErr("Nothing in the selection can be saved as a preset. Select a layer with transform, text or effect properties.");
  }

  var preset = {
    format: QK_PRESET_FORMAT,
    version: QK_PRESET_VERSION,
    id: qkPresetNewId(),
    name: presetName,
    folder: folderName,
    favorite: false,
    order: qkPresetMaxOrder(store.presets) + 1,
    created: qkDateText(),
    summary: qkPresetSummary(layers),
    thumbnail: qkPresetThumbnail(layers),
    layers: layers
  };

  if (folderName !== "" && qkPresetFolderIndex(store.folders, folderName) === -1) {
    if (store.folders.length >= QK_PRESET_MAX_FOLDERS) {
      preset.folder = "";
    } else {
      store.folders.push(folderName);
      qkPresetFoldersWrite(store.root, store.folders);
    }
  }

  if (!qkFileWriteSafe(qkPresetFilePath(store.root, preset.id), qkJsonStringify(preset))) {
    return qkErr("QuickKit could not write the preset. Check that this folder is writable: " + store.root);
  }

  var message = "Saved \"" + preset.name + "\"" + (preset.folder ? " in " + preset.folder : "") + ".";
  if (skipped.length) message += " Skipped: " + qkJoin(skipped) + ".";
  return qkOk(message);
}

function qkPresetRename(id, name) {
  var presetName = qkPresetCleanText(name, 60);
  if (presetName === "") return qkErr("Give the preset a name first.");
  var root = qkPresetRootPath();
  if (root === "") return qkErr("QuickKit could not find your AppData folder.");
  var loaded = qkPresetLoadOne(root, id);
  if (loaded.error) return qkErr(loaded.error);
  var preset = loaded.preset;
  preset.name = presetName;
  if (!qkFileWriteSafe(qkPresetFilePath(root, preset.id), qkJsonStringify(preset))) {
    return qkErr("QuickKit could not rename the preset. Check that the presets folder is writable.");
  }
  return qkOk("Renamed the preset to \"" + presetName + "\".");
}

function qkPresetDelete(id) {
  var root = qkPresetRootPath();
  if (root === "" || !qkPresetSafeId(id)) return qkErr("That preset could not be found.");
  var path = qkPresetFilePath(root, id);
  var loaded = qkPresetLoadOne(root, id);
  if (loaded.error) return qkErr(loaded.error);
  if (!qkFileDelete(path)) {
    return qkErr("QuickKit could not delete the preset. Close any app that is using the file and try again.");
  }
  return qkOk("Deleted \"" + loaded.preset.name + "\".");
}

function qkPresetFavorite(id, on) {
  var root = qkPresetRootPath();
  if (root === "") return qkErr("QuickKit could not find your AppData folder.");
  var loaded = qkPresetLoadOne(root, id);
  if (loaded.error) return qkErr(loaded.error);
  var preset = loaded.preset;
  preset.favorite = qkPresetBool(on);
  if (!qkFileWriteSafe(qkPresetFilePath(root, preset.id), qkJsonStringify(preset))) {
    return qkErr("QuickKit could not update the favourite. Check that the presets folder is writable.");
  }
  return qkOk(preset.favorite ? "Added \"" + preset.name + "\" to favourites." : "Removed \"" + preset.name + "\" from favourites.");
}

function qkPresetMove(id, folder) {
  var root = qkPresetRootPath();
  if (root === "") return qkErr("QuickKit could not find your AppData folder.");
  var loaded = qkPresetLoadOne(root, id);
  if (loaded.error) return qkErr(loaded.error);
  var preset = loaded.preset;
  var folderName = qkPresetCleanText(folder, 40);
  var store = qkPresetLoadStore(false);
  if (store.error) return qkErr(store.error);

  if (folderName !== "" && qkPresetFolderIndex(store.folders, folderName) === -1) {
    if (store.folders.length >= QK_PRESET_MAX_FOLDERS) {
      return qkErr("QuickKit holds up to " + QK_PRESET_MAX_FOLDERS + " folders. Delete one first.");
    }
    store.folders.push(folderName);
    qkPresetFoldersWrite(store.root, store.folders);
  }

  preset.folder = folderName;
  if (!qkFileWriteSafe(qkPresetFilePath(root, preset.id), qkJsonStringify(preset))) {
    return qkErr("QuickKit could not move the preset. Check that the presets folder is writable.");
  }
  return qkOk("Moved \"" + preset.name + "\"" + (folderName ? " to " + folderName : " to All") + ".");
}

function qkPresetReorder(idsJson) {
  var ids = null;
  try {
    ids = qkJsonParse(qkStr(idsJson));
  } catch (eParse) {
    return qkErr("The new order could not be read.");
  }
  if (!qkPresetIsArray(ids) || !ids.length) return qkErr("The new order is empty.");

  var root = qkPresetRootPath();
  if (root === "") return qkErr("QuickKit could not find your AppData folder.");
  var store = qkPresetLoadStore(false);
  if (store.error) return qkErr(store.error);

  var byId = {};
  for (var i = 0; i < store.presets.length; i++) byId["#" + store.presets[i].id] = store.presets[i];

  var changed = 0;
  var failed = 0;
  for (var j = 0; j < ids.length; j++) {
    var id = qkStr(ids[j]);
    if (!qkPresetSafeId(id)) continue;
    var preset = byId["#" + id];
    if (!preset) continue;
    preset.order = j;
    if (qkFileWriteSafe(qkPresetFilePath(root, preset.id), qkJsonStringify(preset))) changed++;
    else failed++;
  }

  if (!changed) return qkErr("The new order could not be saved.");
  var message = "Saved the new order for " + qkPlural(changed, "preset", "presets") + ".";
  if (failed) message += " " + qkPlural(failed, "file", "files") + " could not be written.";
  return qkOk(message);
}

function qkFolderCreate(name) {
  var folderName = qkPresetCleanText(name, 40);
  if (folderName === "") return qkErr("Give the folder a name first.");
  var store = qkPresetLoadStore(false);
  if (store.error) return qkErr(store.error);
  if (qkPresetFolderIndex(store.folders, folderName) !== -1) {
    return qkOk("The folder \"" + folderName + "\" already exists.");
  }
  if (store.folders.length >= QK_PRESET_MAX_FOLDERS) {
    return qkErr("QuickKit holds up to " + QK_PRESET_MAX_FOLDERS + " folders. Delete one first.");
  }
  store.folders.push(folderName);
  if (!qkPresetFoldersWrite(store.root, store.folders)) {
    return qkErr("QuickKit could not save the folder. Check that the presets folder is writable.");
  }
  return qkOk("Created the folder \"" + folderName + "\".");
}

function qkFolderDelete(name) {
  var folderName = qkPresetCleanText(name, 40);
  if (folderName === "") return qkErr("That folder could not be found.");
  var store = qkPresetLoadStore(false);
  if (store.error) return qkErr(store.error);
  var index = qkPresetFolderIndex(store.folders, folderName);
  if (index === -1) return qkErr("That folder could not be found.");
  var actual = store.folders[index];

  var moved = 0;
  var failed = 0;
  for (var i = 0; i < store.presets.length; i++) {
    var preset = store.presets[i];
    if (preset.folder.toLowerCase() !== actual.toLowerCase()) continue;
    preset.folder = "";
    if (qkFileWriteSafe(qkPresetFilePath(store.root, preset.id), qkJsonStringify(preset))) moved++;
    else failed++;
  }

  store.folders.splice(index, 1);
  qkPresetFoldersWrite(store.root, store.folders);

  var message = "Deleted the folder \"" + actual + "\".";
  if (moved) message += " Moved " + qkPlural(moved, "preset", "presets") + " to All.";
  if (failed) message += " " + qkPlural(failed, "preset", "presets") + " could not be moved.";
  return qkOk(message);
}

function qkPresetUniqueName(base, used) {
  var name = qkPresetCleanText(base, 60) || "Preset";
  if (!used["#" + name.toLowerCase()]) return name;
  var stem = name;
  if (stem.length > 54) stem = stem.substring(0, 54);
  for (var i = 2; i < 100; i++) {
    var candidate = stem + " " + i;
    if (!used["#" + candidate.toLowerCase()]) return candidate;
  }
  return stem + " copy";
}

function qkPresetExport(idsJson) {
  var store = qkPresetLoadStore(false);
  if (store.error) return qkErr(store.error);
  if (!store.presets.length) return qkErr("There are no presets to export yet.");

  var wanted = null;
  if (qkStr(idsJson) !== "" && qkStr(idsJson) !== "[]") {
    try {
      wanted = qkJsonParse(qkStr(idsJson));
    } catch (eParse) {
      wanted = null;
    }
  }

  var presets = [];
  if (qkPresetIsArray(wanted) && wanted.length) {
    var byId = {};
    for (var i = 0; i < store.presets.length; i++) byId["#" + store.presets[i].id] = store.presets[i];
    for (var j = 0; j < wanted.length; j++) {
      var found = byId["#" + qkStr(wanted[j])];
      if (found) presets.push(found);
    }
  } else {
    presets = store.presets;
  }

  if (!presets.length) return qkErr("There are no presets to export yet.");

  var file = null;
  try {
    file = File.saveDialog("Export QuickKit preset pack", "QuickKit preset pack:*.qkpack");
  } catch (eDialog) {
    file = null;
  }
  if (!file) return qkOk("Export cancelled. Nothing was written.");

  var path = qkStr(file.fsName);
  if (path === "") path = qkStr(file);
  if (path.length < 7 || path.substring(path.length - 7).toLowerCase() !== ".qkpack") {
    path += ".qkpack";
  }

  var pack = {
    format: QK_PACK_FORMAT,
    version: QK_PRESET_VERSION,
    created: qkDateText(),
    presets: presets
  };
  if (!qkFileWriteSafe(path, qkJsonStringify(pack))) {
    return qkErr("QuickKit could not write the pack file. Check the destination folder and try again.");
  }
  return qkOk("Exported " + qkPlural(presets.length, "preset", "presets") + " to " + qkPathName(path) + ".");
}

function qkPresetImport() {
  var file = null;
  try {
    file = File.openDialog("Choose a QuickKit preset pack", "QuickKit preset pack:*.qkpack");
  } catch (eDialog) {
    file = null;
  }
  if (!file) return qkOk("Import cancelled. Nothing was added.");

  var path = qkStr(file.fsName);
  if (path === "") path = qkStr(file);
  var text = qkFileRead(path, QK_PACK_MAX_BYTES);
  if (text === null) {
    return qkErr("That pack file is missing, unreadable, or larger than 8 MB. Nothing was imported.");
  }

  var pack = null;
  try {
    pack = qkJsonParse(text);
  } catch (eParse) {
    return qkErr("That file is not a QuickKit preset pack. Nothing was imported.");
  }
  if (!pack || qkStr(pack.format) !== QK_PACK_FORMAT || !qkPresetIsArray(pack.presets) || !pack.presets.length) {
    return qkErr("That file is not a QuickKit preset pack. Nothing was imported.");
  }

  var store = qkPresetLoadStore(false);
  if (store.error) return qkErr(store.error);

  var usedNames = {};
  var usedIds = {};
  var i;
  for (i = 0; i < store.presets.length; i++) {
    usedNames["#" + store.presets[i].name.toLowerCase()] = true;
    usedIds["#" + store.presets[i].id] = true;
  }

  var imported = 0;
  var skipped = 0;
  var failed = 0;
  var order = qkPresetMaxOrder(store.presets) + 1;

  for (i = 0; i < pack.presets.length && i < 200; i++) {
    var raw = pack.presets[i];
    var newId = qkPresetNewId();
    while (usedIds["#" + newId]) newId = qkPresetNewId();
    var normalized = qkPresetNormalize(raw, newId);
    if (normalized.error) {
      skipped++;
      continue;
    }
    var preset = normalized.preset;
    preset.id = newId;
    preset.name = qkPresetUniqueName(preset.name, usedNames);
    preset.favorite = false;
    preset.order = order++;
    preset.created = qkDateText();

    if (preset.folder !== "" && qkPresetFolderIndex(store.folders, preset.folder) === -1) {
      if (store.folders.length < QK_PRESET_MAX_FOLDERS) store.folders.push(preset.folder);
      else preset.folder = "";
    }

    if (qkFileWriteSafe(qkPresetFilePath(store.root, preset.id), qkJsonStringify(preset))) {
      usedNames["#" + preset.name.toLowerCase()] = true;
      usedIds["#" + preset.id] = true;
      imported++;
    } else {
      failed++;
    }
  }

  qkPresetFoldersWrite(store.root, store.folders);
  qkFileWrite(store.root + "/.seeded", "1");

  if (!imported) {
    var emptyMessage = "No presets were imported.";
    if (skipped) emptyMessage += " " + qkPlural(skipped, "entry was", "entries were") + " damaged.";
    if (failed) emptyMessage += " " + qkPlural(failed, "file", "files") + " could not be written.";
    return qkErr(emptyMessage);
  }

  var message = "Imported " + qkPlural(imported, "preset", "presets") + ".";
  if (skipped) message += " Skipped " + qkPlural(skipped, "damaged entry", "damaged entries") + ".";
  if (failed) message += " " + qkPlural(failed, "file", "files") + " could not be written.";
  return qkOk(message);
}

/* ---------- 15 original starter presets ---------- */

function qkStarterKey(time, value) {
  return { t: time, v: value, inType: 2, outType: 2 };
}

function qkStarterProp(match, label, type, value, keys, offset) {
  var prop = {
    scope: "transform",
    match: match,
    label: label,
    type: type,
    value: value,
    offset: offset === true
  };
  if (keys && keys.length) prop.keys = keys;
  return prop;
}

function qkStarterText(font, size, tracking, color, extra) {
  var style = {
    font: font,
    fontSize: size,
    tracking: tracking,
    applyFill: true,
    fillColor: color
  };
  if (extra) {
    for (var key in extra) {
      if (extra.hasOwnProperty(key)) style[key] = extra[key];
    }
  }
  return style;
}

function qkStarter(name, folder, text, props) {
  return {
    format: QK_PRESET_FORMAT,
    version: QK_PRESET_VERSION,
    id: "",
    name: name,
    folder: folder,
    favorite: false,
    order: 0,
    created: "",
    summary: "",
    thumbnail: { glyph: "P", color: [0.486, 0.361, 1], motion: false },
    layers: [
      {
        name: text ? "Title" : "Layer",
        kind: text ? "text" : "layer",
        props: props || [],
        text: text || null
      }
    ]
  };
}

function qkStarterPresets() {
  var list = [];

  list.push(qkStarter("Title Fade In", "Titles", null, [
    qkStarterProp("ADBE Opacity", "Opacity", 1, 100, [
      qkStarterKey(0, 0),
      qkStarterKey(0.45, 100)
    ], false)
  ]));

  list.push(qkStarter("Title Pop In", "Titles", null, [
    qkStarterProp("ADBE Scale", "Scale", 3, [100, 100, 100], [
      qkStarterKey(0, [70, 70, 100]),
      qkStarterKey(0.3, [108, 108, 100]),
      qkStarterKey(0.45, [100, 100, 100])
    ], false),
    qkStarterProp("ADBE Opacity", "Opacity", 1, 100, [
      qkStarterKey(0, 0),
      qkStarterKey(0.2, 100)
    ], false)
  ]));

  list.push(qkStarter("Title Rise", "Titles", null, [
    qkStarterProp("ADBE Position", "Position", 2, [0, 0], [
      qkStarterKey(0, [0, 60]),
      qkStarterKey(0.5, [0, 0])
    ], true),
    qkStarterProp("ADBE Opacity", "Opacity", 1, 100, [
      qkStarterKey(0, 0),
      qkStarterKey(0.3, 100)
    ], false)
  ]));

  list.push(qkStarter("Title Spin In", "Titles", null, [
    qkStarterProp("ADBE Rotate Z", "Rotation", 1, 0, [
      qkStarterKey(0, -90),
      qkStarterKey(0.6, 0)
    ], false),
    qkStarterProp("ADBE Opacity", "Opacity", 1, 100, [
      qkStarterKey(0, 0),
      qkStarterKey(0.25, 100)
    ], false)
  ]));

  list.push(qkStarter("Title Drift Up", "Titles", null, [
    qkStarterProp("ADBE Position", "Position", 2, [0, 0], [
      qkStarterKey(0, [0, 0]),
      qkStarterKey(4, [0, -80])
    ], true)
  ]));

  list.push(qkStarter("Clean Lower Third", "Styles", qkStarterText("ArialMT", 48, 20, [1, 1, 1], null), []));
  list.push(qkStarter("Bold Title", "Styles", qkStarterText("ArialMT", 96, -10, [1, 1, 1], { fauxBold: true }), []));
  list.push(qkStarter("Wide Tracker", "Styles", qkStarterText("ArialMT", 64, 150, [1, 1, 1], { allCaps: true }), []));
  list.push(qkStarter("Gold Accent", "Styles", qkStarterText("ArialMT", 84, 0, [0.949, 0.757, 0.306], null), []));
  list.push(qkStarter("Small Caption", "Styles", qkStarterText("ArialMT", 24, 10, [0.847, 0.863, 0.902], null), []));
  list.push(qkStarter("Mono Label", "Styles", qkStarterText("Consolas", 28, 60, [0.604, 0.639, 0.698], { allCaps: true }), []));

  list.push(qkStarter("Fade In", "Motion", null, [
    qkStarterProp("ADBE Opacity", "Opacity", 1, 100, [
      qkStarterKey(0, 0),
      qkStarterKey(0.4, 100)
    ], false)
  ]));

  list.push(qkStarter("Slow Push", "Motion", null, [
    qkStarterProp("ADBE Scale", "Scale", 3, [100, 100, 100], [
      qkStarterKey(0, [100, 100, 100]),
      qkStarterKey(5, [108, 108, 100])
    ], false)
  ]));

  list.push(qkStarter("Punch In", "Motion", null, [
    qkStarterProp("ADBE Scale", "Scale", 3, [100, 100, 100], [
      qkStarterKey(0, [100, 100, 100]),
      qkStarterKey(0.25, [112, 112, 100]),
      qkStarterKey(0.55, [100, 100, 100])
    ], false),
    qkStarterProp("ADBE Opacity", "Opacity", 1, 100, [
      qkStarterKey(0, 0),
      qkStarterKey(0.2, 100)
    ], false)
  ]));

  list.push(qkStarter("Settle", "Motion", null, [
    qkStarterProp("ADBE Rotate Z", "Rotation", 1, 0, [
      qkStarterKey(0, 8),
      qkStarterKey(0.8, 0)
    ], false),
    qkStarterProp("ADBE Scale", "Scale", 3, [100, 100, 100], [
      qkStarterKey(0, [104, 104, 100]),
      qkStarterKey(0.8, [100, 100, 100])
    ], false)
  ]));

  return list;
}

/* ============================================================
 * Silence cutter (Premiere Pro)
 * ------------------------------------------------------------
 * Premiere half of Part 5. The panel runs ffmpeg and sends back the silent
 * ranges of each media file; this side maps them onto the sequence timeline,
 * keeps only the ranges that are silent on *every* audio track, and applies
 * the edit the user picked.
 *
 * Premiere only: qkSilenceTargets() fails cleanly in After Effects.
 * ============================================================ */

var QK_SILENCE_EPS = 0.02;

function qkSilenceNumber(value, fallback) {
  var parsed = Number(value);
  if (!isFinite(parsed)) return fallback;
  return parsed;
}

function qkSilenceSequence() {
  var seq = null;
  try {
    seq = app.project ? app.project.activeSequence : null;
  } catch (eProject) {}

  if (!seq) {
    return {
      error:
        "No open sequence. Open the sequence you want to clean up in Premiere Pro, then scan again."
    };
  }

  var real = false;
  try {
    real = typeof seq.audioTracks !== "undefined" && typeof seq.name !== "undefined";
  } catch (eCheck) {}

  if (!real) {
    return { error: "The active item is not a Premiere Pro sequence. The Silence tool is Premiere only." };
  }

  return { seq: seq };
}

function qkSilenceClipPath(item) {
  var projectItem = null;
  var path = "";

  try {
    projectItem = item.projectItem;
  } catch (eItem) {}

  if (!projectItem) return "";

  try {
    path = qkStr(projectItem.getMediaPath());
  } catch (ePath) {
    path = "";
  }
  if (path === "") {
    try {
      path = qkStr(projectItem.filePath);
    } catch (eFile) {
      path = "";
    }
  }
  return path;
}

/* Sequence frame rate from the tick timebase (254016000000 ticks per second). */
function qkSilenceFrameRate(seq) {
  var timebase = 0;
  try {
    timebase = qkSilenceNumber(seq.timebase, 0);
  } catch (eTb) {}
  if (timebase <= 0) return 0;
  var rate = 254016000000 / timebase;
  return Math.round(rate * 1000) / 1000;
}

/* Every audio clip of the sequence as plain data, so the mapping code never
   touches the app again. */
function qkSilenceReadClips(seq) {
  var clips = [];
  var skipped = 0;
  var tracks = null;
  var trackCount = 0;
  var t;
  var i;
  var track;
  var count;
  var item;
  var path;
  var entry;

  try {
    tracks = seq.audioTracks;
    trackCount = tracks.numTracks;
  } catch (eTracks) {
    trackCount = 0;
  }

  for (t = 0; t < trackCount; t++) {
    track = null;
    try {
      track = tracks[t];
    } catch (eTrack) {}
    if (!track) continue;

    var trackName = "A" + (t + 1);
    try {
      if (track.name) trackName = qkStr(track.name);
    } catch (eName) {}

    try {
      count = track.clips.numItems;
    } catch (eCount) {
      count = 0;
    }

    for (i = 0; i < count; i++) {
      item = null;
      try {
        item = track.clips[i];
      } catch (eClip) {}
      if (!item) continue;

      path = qkSilenceClipPath(item);
      if (path === "" || path === "1") {
        skipped++;
        continue;
      }

      entry = {
        id: "t" + t + "i" + i,
        track: t,
        trackName: trackName,
        index: i,
        name: qkStr(item.name),
        path: path,
        start: qkSilenceNumber(item.start, 0),
        end: qkSilenceNumber(item.end, 0),
        inPoint: qkSilenceNumber(item.inPoint, 0),
        speed: 1
      };

      var speed = qkSilenceNumber(item.speed, 1);
      if (speed > 0) entry.speed = speed;

      if (entry.end <= entry.start) {
        skipped++;
        continue;
      }

      clips.push(entry);
    }
  }

  return { clips: clips, skipped: skipped, trackCount: trackCount };
}

/* nodeIds of the clips the user has selected, so "selected clip" can mean just
   that. Returns [] when the app does not answer. */
function qkSilenceSelectedNodeIds(seq) {
  var ids = [];
  var selection = null;
  var i;
  var entry;
  var nodeId;

  try {
    if (typeof seq.getSelection !== "function") return ids;
    selection = seq.getSelection();
  } catch (eSel) {
    return ids;
  }
  if (!selection || typeof selection.length === "undefined") return ids;

  for (i = 0; i < selection.length; i++) {
    entry = selection[i];
    if (!entry) continue;
    nodeId = "";
    try {
      nodeId = qkStr(entry.nodeId);
    } catch (eNode) {
      nodeId = "";
    }
    if (nodeId !== "") ids.push(nodeId);
  }
  return ids;
}

function qkSilenceTargets(scope) {
  var ctx = qkSilenceSequence();
  if (ctx.error) return qkErr(ctx.error);

  var seq = ctx.seq;
  var read = qkSilenceReadClips(seq);
  var clips = read.clips;
  var notes = [];

  if (!clips.length) {
    return qkErr(
      "This sequence has no audio clips QuickKit can read. Add audio, or check that the clips are not offline."
    );
  }

  var wanted = qkStr(scope) === "selection";
  if (wanted) {
    var ids = qkSilenceSelectedNodeIds(seq);
    if (!ids.length) {
      notes.push("Nothing was selected, so the whole sequence was scanned.");
      wanted = false;
    } else {
      var chosen = [];
      var k;
      var track;
      var trackClips;
      var hit;
      for (k = 0; k < clips.length; k++) {
        hit = false;
        try {
          track = seq.audioTracks[clips[k].track];
          trackClips = track.clips;
          var item = trackClips[clips[k].index];
          hit = qkInList(qkStr(item.nodeId), ids);
        } catch (eSel) {
          hit = false;
        }
        if (hit) chosen.push(clips[k]);
      }
      if (chosen.length) {
        clips = chosen;
      } else {
        notes.push("The selected clips have no readable audio, so the whole sequence was scanned.");
      }
    }
  }

  if (read.skipped > 0) {
    notes.push(
      qkPlural(read.skipped, "clip has", "clips have") + " no readable media path and " +
      (read.skipped === 1 ? "was" : "were") + " skipped."
    );
  }

  var payload = {
    ok: true,
    scope: wanted ? "selection" : "sequence",
    message: "Found " + qkPlural(clips.length, "audio clip", "audio clips") + " on " + qkPlural(read.trackCount, "audio track", "audio tracks") + ".",
    sequence: {
      name: qkStr(seq.name),
      start: 0,
      end: 0,
      frameRate: qkSilenceFrameRate(seq),
      audioTracks: read.trackCount
    },
    clips: clips,
    notes: notes
  };

  var longest = 0;
  for (var c = 0; c < clips.length; c++) {
    if (clips[c].end > longest) longest = clips[c].end;
  }
  payload.sequence.end = longest;

  return qkJsonStringify(payload);
}

/* ---------- interval maths (plain data, mock-tested) ---------- */

function qkSilenceMergeIntervals(list) {
  var sorted = [];
  var out = [];
  var i;
  var last;

  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].end > list[i].start) {
      sorted.push({ start: list[i].start, end: list[i].end });
    }
  }

  sorted.sort(function (a, b) {
    return a.start - b.start;
  });

  for (i = 0; i < sorted.length; i++) {
    if (!out.length) {
      out.push({ start: sorted[i].start, end: sorted[i].end });
      continue;
    }
    last = out[out.length - 1];
    if (sorted[i].start <= last.end + 0.0005) {
      if (sorted[i].end > last.end) last.end = sorted[i].end;
    } else {
      out.push({ start: sorted[i].start, end: sorted[i].end });
    }
  }

  return out;
}

function qkSilenceSubtractIntervals(base, cuts) {
  var out = [];
  var mergedBase = qkSilenceMergeIntervals(base);
  var mergedCuts = qkSilenceMergeIntervals(cuts);
  var i;
  var k;
  var start;
  var end;
  var cut;

  for (i = 0; i < mergedBase.length; i++) {
    start = mergedBase[i].start;
    end = mergedBase[i].end;

    for (k = 0; k < mergedCuts.length; k++) {
      cut = mergedCuts[k];
      if (cut.end <= start) continue;
      if (cut.start >= end) break;
      if (cut.start > start) out.push({ start: start, end: cut.start });
      start = cut.end;
      if (start >= end) break;
    }

    if (start < end) out.push({ start: start, end: end });
  }

  return out;
}

function qkSilenceRound(value) {
  return Math.round(value * 1000) / 1000;
}

/* Panel payload: {"clips":[{"id":"t0i0","silences":[{"start":1.2,"end":2.4}]}]}
   The silence times are source times inside the media file, so each one is
   mapped through the clip's in point, start and speed before anything else. */
function qkSilenceSegments(payloadJson) {
  var ctx = qkSilenceSequence();
  if (ctx.error) return qkErr(ctx.error);

  var payload = null;
  try {
    payload = qkJsonParse(payloadJson);
  } catch (eParse) {
    return qkErr("The silent ranges arrived damaged and were ignored. Scan again.");
  }

  if (!payload || !qkPresetIsArray(payload.clips) || !payload.clips.length) {
    return qkErr("No silent ranges arrived from the audio analysis. Scan again.");
  }

  var read = qkSilenceReadClips(ctx.seq);
  var byId = {};
  var i;
  var k;
  for (i = 0; i < read.clips.length; i++) byId[read.clips[i].id] = read.clips[i];

  var padBefore = qkSilenceNumber(payload.padBefore, 0);
  var padAfter = qkSilenceNumber(payload.padAfter, 0);
  var minLength = qkSilenceNumber(payload.minLength, 0);

  var coverage = [];
  var trackCoverage = {};
  var trackSilence = {};
  var matched = 0;

  for (i = 0; i < payload.clips.length; i++) {
    var entry = payload.clips[i];
    if (!entry || !entry.id) continue;
    var clip = byId[qkStr(entry.id)];
    if (!clip) continue;
    matched++;

    var span = { start: clip.start, end: clip.end };
    coverage.push(span);
    if (!trackCoverage[clip.track]) trackCoverage[clip.track] = [];
    trackCoverage[clip.track].push(span);
    if (!trackSilence[clip.track]) trackSilence[clip.track] = [];

    if (!qkPresetIsArray(entry.silences)) continue;
    for (k = 0; k < entry.silences.length; k++) {
      var pair = entry.silences[k];
      if (!pair) continue;
      var sourceStart = qkSilenceNumber(pair.start, -1);
      var sourceEnd = qkSilenceNumber(pair.end, -1);
      if (sourceStart < 0 || sourceEnd <= sourceStart) continue;

      var tlStart = clip.start + (sourceStart - clip.inPoint) / clip.speed;
      var tlEnd = clip.start + (sourceEnd - clip.inPoint) / clip.speed;
      if (tlStart < clip.start) tlStart = clip.start;
      if (tlEnd > clip.end) tlEnd = clip.end;
      if (tlEnd <= tlStart) continue;

      trackSilence[clip.track].push({ start: tlStart, end: tlEnd });
    }
  }

  if (!matched) {
    return qkErr("The sequence changed since the scan. Scan again before cutting.");
  }

  /* A range is only cut when every track that has sound there is silent. */
  var audible = [];
  var trackKey;
  for (trackKey in trackSilence) {
    if (!trackSilence.hasOwnProperty(trackKey)) continue;
    audible = audible.concat(
      qkSilenceSubtractIntervals(trackCoverage[trackKey] || [], trackSilence[trackKey])
    );
  }

  var cuttable = qkSilenceSubtractIntervals(coverage, audible);

  var padded = [];
  for (i = 0; i < cuttable.length; i++) {
    var start = cuttable[i].start + (padBefore > 0 ? padBefore : 0);
    var end = cuttable[i].end - (padAfter > 0 ? padAfter : 0);
    if (end - start <= 0.0005) continue;
    if (minLength > 0 && end - start < minLength) continue;
    padded.push({ start: qkSilenceRound(start), end: qkSilenceRound(end) });
  }

  var total = 0;
  for (i = 0; i < padded.length; i++) total += padded[i].end - padded[i].start;

  var sequence = null;
  try {
    sequence = { name: qkStr(ctx.seq.name), frameRate: qkSilenceFrameRate(ctx.seq) };
  } catch (eSeq) {
    sequence = { name: "", frameRate: 0 };
  }

  return qkJsonStringify({
    ok: true,
    segments: padded,
    count: padded.length,
    total: Math.round(total * 100) / 100,
    sequence: sequence,
    message:
      padded.length === 0
        ? "No cuttable silence was left after padding. Lower the threshold or the minimum length."
        : "Found " + qkPlural(padded.length, "silent gap", "silent gaps") + " - " + (Math.round(total * 100) / 100) + " s in total."
  });
}

/* ---------- markers ---------- */

function qkSilenceMarkersFor(seq, segments, label, colorIndex) {
  var markers = null;
  var created = 0;
  var i;
  var marker;
  var name;

  try {
    markers = seq.markers;
  } catch (eMarkers) {
    markers = null;
  }

  if (!markers) {
    return { error: "This Premiere Pro build does not expose sequence markers to scripts." };
  }

  name = qkStr(label) === "" ? "QuickKit silence" : qkStr(label);

  for (i = 0; i < segments.length; i++) {
    marker = null;
    try {
      marker = markers.createMarker(segments[i].start);
    } catch (eCreate) {
      marker = null;
    }
    if (!marker) continue;

    try {
      marker.name = name + " " + (i + 1);
    } catch (eName) {}
    try {
      marker.comments = "QuickKit silence " + (i + 1) + " of " + segments.length;
    } catch (eComment) {}
    try {
      marker.end = segments[i].end;
    } catch (eEnd) {}
    try {
      if (typeof marker.setColorByIndex === "function") marker.setColorByIndex(colorIndex);
    } catch (eColor) {}

    created++;
  }

  return { created: created };
}

function qkSilenceMarkers(payloadJson) {
  var ctx = qkSilenceSequence();
  if (ctx.error) return qkErr(ctx.error);

  var payload = null;
  try {
    payload = qkJsonParse(payloadJson);
  } catch (eParse) {
    return qkErr("The segment list arrived damaged and was ignored. Scan again.");
  }

  var segments = qkSilenceSanitizeSegments(payload ? payload.segments : null);
  if (!segments.length) return qkErr("No segments are switched on, so no markers were added.");

  var started = qkBeginUndo("QuickKit: Silence markers");
  var out = qkSilenceMarkersFor(
    ctx.seq,
    segments,
    payload ? payload.label : "",
    qkSilenceNumber(payload ? payload.colorIndex : 0, 0)
  );
  qkEndUndo(started);

  if (out.error) return qkErr(out.error);

  return qkOk(
    "Added " + qkPlural(out.created, "coloured marker", "coloured markers") +
    " to the sequence. One Ctrl+Z removes them."
  );
}

function qkSilenceClearMarkers() {
  var ctx = qkSilenceSequence();
  if (ctx.error) return qkErr(ctx.error);

  var seq = ctx.seq;
  var markers = null;
  var count = 0;
  var removed = 0;
  var i;
  var marker;

  try {
    markers = seq.markers;
    count = markers.numMarkers;
  } catch (eMarkers) {
    return qkErr("This Premiere Pro build does not expose sequence markers to scripts.");
  }

  var started = qkBeginUndo("QuickKit: Clear silence markers");

  for (i = count - 1; i >= 0; i--) {
    marker = null;
    try {
      marker = markers[i];
    } catch (eMarker) {}
    if (!marker) continue;
    var name = "";
    try {
      name = qkStr(marker.name);
    } catch (eName) {}
    if (name.indexOf("QuickKit") !== 0) continue;
    try {
      marker.remove();
      removed++;
    } catch (eRemove) {}
  }

  qkEndUndo(started);

  if (!removed) return qkOk("There were no QuickKit markers to remove.");
  return qkOk("Removed " + qkPlural(removed, "QuickKit marker", "QuickKit markers") + ".");
}

/* ---------- apply ---------- */

function qkSilenceSanitizeSegments(raw) {
  var out = [];
  var i;
  var entry;
  var start;
  var end;

  if (!qkPresetIsArray(raw)) return out;

  for (i = 0; i < raw.length; i++) {
    entry = raw[i];
    if (!entry) continue;
    start = qkSilenceNumber(entry.start, -1);
    end = qkSilenceNumber(entry.end, -1);
    if (start < 0 || end <= start) continue;
    out.push({ start: start, end: end });
  }

  out.sort(function (a, b) {
    return a.start - b.start;
  });
  return out;
}

function qkSilenceQe() {
  try {
    if (typeof app.enableQE !== "function") return null;
    app.enableQE();
    if (typeof qe === "undefined" || !qe || !qe.project) return null;
    return qe;
  } catch (eQe) {
    return null;
  }
}

function qkSilenceTrackCount(collection) {
  var count = 0;
  try {
    count = collection.numTracks;
  } catch (eCount) {
    count = 0;
  }
  return count;
}

function qkSilenceRazorAt(qeSeq, time, audioCount, videoCount) {
  var cuts = 0;
  var i;
  var track;

  for (i = 0; i < audioCount; i++) {
    track = null;
    try {
      track = qeSeq.getAudioTrackAt(i);
    } catch (eAudio) {}
    if (track && typeof track.razor === "function") {
      try {
        track.razor(time);
        cuts++;
      } catch (eRazor) {}
    }
  }

  for (i = 0; i < videoCount; i++) {
    track = null;
    try {
      track = qeSeq.getVideoTrackAt(i);
    } catch (eVideo) {}
    if (track && typeof track.razor === "function") {
      try {
        track.razor(time);
        cuts++;
      } catch (eRazorVideo) {}
    }
  }

  return cuts;
}

/* Items fully inside [start, end] on one track. */
function qkSilenceItemsInside(collection, start, end) {
  var found = [];
  var count = 0;
  var i;
  var item;
  var itemStart;
  var itemEnd;

  try {
    count = collection.clips.numItems;
  } catch (eCount) {
    count = 0;
  }

  for (i = 0; i < count; i++) {
    item = null;
    try {
      item = collection.clips[i];
    } catch (eItem) {}
    if (!item) continue;
    itemStart = qkSilenceNumber(item.start, -1);
    itemEnd = qkSilenceNumber(item.end, -1);
    if (itemStart < 0 || itemEnd <= itemStart) continue;
    if (itemStart >= start - QK_SILENCE_EPS && itemEnd <= end + QK_SILENCE_EPS) {
      found.push(item);
    }
  }

  return found;
}

/* Delete one silent segment: every audio piece inside it goes, and the picture
   pieces that were razored to the same edges go with them, otherwise the ripple
   would slide the picture over itself. Pieces after the first are removed
   without their own ripple and one piece carries the ripple for the segment,
   so the timeline shortens exactly once. */
function qkSilenceRemoveInside(seq, start, end) {
  var groups = [];
  var trackCount = 0;
  var tracks = null;
  var kind;
  var t;
  var track;
  var pieces;
  var i;
  var rippleFrom = null;
  var removed = 0;

  try {
    groups.push(seq.audioTracks);
    groups.push(seq.videoTracks);
  } catch (eGroups) {
    return 0;
  }

  for (kind = 0; kind < groups.length; kind++) {
    tracks = groups[kind];
    trackCount = 0;
    try {
      trackCount = tracks.numTracks;
    } catch (eCount) {
      trackCount = 0;
    }

    for (t = 0; t < trackCount; t++) {
      track = null;
      try {
        track = tracks[t];
      } catch (eTrack) {}
      if (!track) continue;

      pieces = qkSilenceItemsInside(track, start, end);
      for (i = 0; i < pieces.length; i++) {
        if (rippleFrom === null) {
          rippleFrom = pieces[i];
          continue;
        }
        try {
          pieces[i].remove(false, false);
          removed++;
        } catch (eRemove) {}
      }
    }
  }

  if (rippleFrom === null) return 0;

  try {
    rippleFrom.remove(true, true);
    removed++;
  } catch (eRipple) {}

  return removed;
}

function qkSilenceMuteItem(item) {
  var components = null;
  var count = 0;
  var i;
  var k;
  var component;
  var name;
  var params = null;
  var paramCount = 0;

  try {
    components = item.components;
    count = components.numItems;
  } catch (eComponents) {
    return false;
  }

  for (i = 0; i < count; i++) {
    component = null;
    try {
      component = components[i];
    } catch (eComponent) {}
    if (!component) continue;

    name = "";
    try {
      name = qkStr(component.displayName);
    } catch (eName) {}

    if (!/volume/i.test(name)) continue;

    params = null;
    paramCount = 0;
    try {
      params = component.properties;
      paramCount = params.numItems;
    } catch (eParams) {
      paramCount = 0;
    }

    for (k = 0; k < paramCount; k++) {
      try {
        params[k].setValue(-96, true);
        return true;
      } catch (eSet) {}
    }
  }

  return false;
}

function qkSilenceMuteInside(seq, start, end) {
  var tracks = null;
  var trackCount = 0;
  var t;
  var track;
  var pieces;
  var i;
  var muted = 0;

  try {
    tracks = seq.audioTracks;
    trackCount = tracks.numTracks;
  } catch (eTracks) {
    return 0;
  }

  for (t = 0; t < trackCount; t++) {
    track = null;
    try {
      track = tracks[t];
    } catch (eTrack) {}
    if (!track) continue;

    pieces = qkSilenceItemsInside(track, start, end);
    for (i = 0; i < pieces.length; i++) {
      if (qkSilenceMuteItem(pieces[i])) muted++;
    }
  }

  return muted;
}

function qkSilenceEdit(seq, segments, mode, payloadJson) {
  var qe = qkSilenceQe();
  if (!qe) {
    return {
      error:
        "Premiere's scripting razor is not available in this build of Premiere Pro. Nothing was changed. " +
        "Use the Only mark mode to place the markers, then cut by hand."
    };
  }

  var qeSeq = null;
  try {
    qeSeq = qe.project.getActiveSequence();
  } catch (eSeq) {
    qeSeq = null;
  }
  if (!qeSeq) {
    return { error: "Premiere did not return the active sequence to the razor. Nothing was changed." };
  }

  var audioCount = 0;
  var videoCount = 0;
  try {
    audioCount = qkSilenceTrackCount(seq.audioTracks);
  } catch (eAudio) {}
  try {
    videoCount = qkSilenceTrackCount(seq.videoTracks);
  } catch (eVideo) {}

  /* Mute mode keeps the picture where it is, so the video tracks are not
     razored: a cut that is never removed would only split the video clips. */
  if (mode === "mute") videoCount = 0;

  var order = segments.slice(0).sort(function (a, b) {
    return b.start - a.start;
  });

  var razors = 0;
  var removed = 0;
  var muted = 0;
  var i;

  for (i = 0; i < order.length; i++) {
    razors += qkSilenceRazorAt(qeSeq, order[i].start, audioCount, videoCount);
    razors += qkSilenceRazorAt(qeSeq, order[i].end, audioCount, videoCount);
  }

  if (razors === 0) {
    return {
      error:
        "Premiere refused every razor call, so nothing was cut. Use the Only mark mode and cut by hand, " +
        "then report this in the QuickKit issue list."
    };
  }

  var payload = null;
  try {
    payload = payloadJson ? qkJsonParse(payloadJson) : null;
  } catch (ePayload) {
    payload = null;
  }

  if (mode === "delete") {
    for (i = 0; i < order.length; i++) {
      if (qkSilenceRemoveInside(seq, order[i].start, order[i].end) > 0) removed++;
    }
    if (removed === 0) {
      return { error: "The razor cut the clips but no silent piece could be removed. Nothing was deleted." };
    }
    var left = order.length - removed;
    var message =
      "Cut out " + qkPlural(removed, "silent gap", "silent gaps") + " and ripple deleted them (one undo step).";
    if (left > 0) {
      message += " " + qkPlural(left, "gap was", "gaps were") + " left alone - check the timeline.";
    }
    return { message: message };
  }

  for (i = 0; i < order.length; i++) {
    muted += qkSilenceMuteInside(seq, order[i].start, order[i].end);
  }

  if (muted === 0) {
    return {
      error:
        "The clips were cut but no Volume control could be found to mute, so the timeline is unchanged apart from the cuts. " +
        "Undo, then use Delete instead."
    };
  }

  return {
    message:
      "Cut " + qkPlural(order.length, "gap", "gaps") + " and muted " + qkPlural(muted, "piece", "pieces") +
      " in place. Premiere's scripting cannot move clips to another track, so they stay where they are and are silenced. One undo step."
  };
}

function qkSilenceApply(payloadJson) {
  var ctx = qkSilenceSequence();
  if (ctx.error) return qkErr(ctx.error);

  var payload = null;
  try {
    payload = qkJsonParse(payloadJson);
  } catch (eParse) {
    return qkErr("The settings arrived damaged and nothing was changed. Scan again.");
  }

  var mode = payload && payload.mode ? qkStr(payload.mode) : "delete";
  if (!qkInList(mode, ["delete", "mark", "mute"])) {
    return qkErr("Unknown mode. Pick Delete, Only mark or Mute.");
  }

  var segments = qkSilenceSanitizeSegments(payload ? payload.segments : null);
  if (!segments.length) {
    return qkErr("No segments are switched on. Tick at least one gap first.");
  }

  var started = qkBeginUndo("QuickKit: Silence cutter");
  var out;

  try {
    if (mode === "mark") {
      out = qkSilenceMarkersFor(
        ctx.seq,
        segments,
        payload ? payload.label : "",
        qkSilenceNumber(payload ? payload.colorIndex : 0, 0)
      );
      if (!out.error) {
        out.message =
          "Added " + qkPlural(out.created, "coloured marker", "coloured markers") +
          ". Nothing else was changed. One undo step.";
      }
    } else {
      out = qkSilenceEdit(ctx.seq, segments, mode, payloadJson);
    }
  } catch (eApply) {
    qkEndUndo(started);
    return qkErr("The cut stopped part way: " + qkErrText(eApply) + ". Press Ctrl+Z to undo what was done.");
  }

  qkEndUndo(started);

  if (out.error) return qkErr(out.error);
  return qkOk(out.message);
}