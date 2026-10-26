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

/* Applies one normalized preset to the given layers. The undo group belongs to
   the caller: the preview generator must not add entries to the user's undo. */
function qkPresetApplyLayers(preset, selected) {
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

  return {
    appliedLayers: appliedLayers,
    appliedProps: appliedProps,
    notes: notes,
    error: applyError,
    targets: targets.length
  };
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

  var started = qkBeginUndo("QuickKit: Apply preset");
  var result = qkPresetApplyLayers(preset, selection.layers);
  qkEndUndo(started);

  if (result.error !== "") {
    return qkErr("Applying the preset stopped: " + result.error + ".");
  }

  if (result.appliedLayers === 0) {
    var failed = "Nothing was applied from \"" + preset.name + "\".";
    if (result.notes.length) failed += " " + qkJoin(result.notes) + ".";
    return qkErr(failed);
  }

  var message =
    "Applied \"" + preset.name + "\" to " + qkPlural(result.appliedLayers, "layer", "layers") +
    " (" + qkPlural(result.appliedProps, "property", "properties") + ").";
  if (result.notes.length) message += " " + qkJoin(result.notes) + ".";
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

/* ============================================================
 * Bridge (Premiere Pro <-> After Effects file handoff)
 * ------------------------------------------------------------
 * This is a FILE HANDOFF, not Dynamic Link. Nothing live crosses the two
 * apps: Premiere writes a JSON file, After Effects reads it and builds a comp,
 * After Effects renders a file, Premiere imports that file and overwrites the
 * original position.
 *
 * Why a file and not Dynamic Link:
 *   - Dynamic Link cannot be created from ExtendScript in either app.
 *   - A file survives closing either app, and the user can see and move it.
 *
 * Premiere: qkBridgeSendToAe, qkBridgePlaceReturn
 * After Effects: qkBridgeImport, qkBridgeCompInfo, qkBridgePrepareRender,
 *                qkBridgeFinishRender
 * Both: qkBridgeList, qkBridgeInfo
 * ============================================================ */

var QK_BRIDGE_HANDOFF = "quickkit-handoff";
var QK_BRIDGE_RETURN = "quickkit-return";
var QK_BRIDGE_VERSION = 1;
var QK_BRIDGE_MAX_BYTES = 2 * 1024 * 1024;

/* ---------- folders ---------- */

function qkBridgeBasePath() {
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
  while (base.length > 1 && base.charAt(base.length - 1) === "/") {
    base = base.substring(0, base.length - 1);
  }
  if (base === "") return "";
  return base + "/QuickKit/bridge";
}

/* pending    handoffs written by Premiere, waiting for After Effects
   imported   handoffs After Effects has already read
   imports    one record per comp QuickKit built, with its original position
   renders    the files aerender writes
   returns    renders waiting for Premiere
   placed     returns Premiere has already inserted */
function qkBridgeFolder(kind) {
  var root = qkBridgeBasePath();
  if (root === "") return "";
  var folder = root + "/" + kind;
  if (!qkEnsureFolder(folder)) return "";
  return folder;
}

function qkBridgeFile(kind, name) {
  var folder = qkBridgeFolder(kind);
  if (folder === "") return "";
  return folder + "/" + name;
}

function qkBridgeStamp() {
  var now = new Date();
  return (
    now.getFullYear() +
    qkPad(now.getMonth() + 1, 2) +
    qkPad(now.getDate(), 2) + "-" +
    qkPad(now.getHours(), 2) +
    qkPad(now.getMinutes(), 2) +
    qkPad(now.getSeconds(), 2) + "-" +
    qkPad(now.getMilliseconds(), 3)
  );
}

function qkBridgeNewId() {
  return qkBridgeStamp();
}

/* A comp name is also used as a file name for the import record, so it has to
   survive both. Windows forbids \ / : * ? " < > | in a name. */
function qkBridgeSafeName(value) {
  var text = qkStr(value);
  var out = "";
  var i;
  var c;
  for (i = 0; i < text.length; i++) {
    c = text.charAt(i);
    if (c === "\\" || c === "/" || c === ":" || c === "*" || c === "?" || c === "\"" || c === "<" || c === ">" || c === "|") {
      out += "_";
    } else if (c === "\r" || c === "\n" || c === "\t") {
      out += " ";
    } else {
      out += c;
    }
  }
  out = qkTrim(out);
  while (out.length > 1 && (out.charAt(out.length - 1) === "." || out.charAt(out.length - 1) === " ")) {
    out = out.substring(0, out.length - 1);
  }
  if (out === "") out = "QuickKit handoff";
  if (out.length > 80) out = out.substring(0, 80);
  return out;
}

function qkBridgeReadJson(path) {
  var text = qkFileRead(path, QK_BRIDGE_MAX_BYTES);
  if (text === null) return { error: "QuickKit could not read " + path + ". The file may be locked or was deleted." };
  var data = null;
  try {
    data = qkJsonParse(text);
  } catch (eParse) {
    return { error: "The handoff file is damaged (" + qkErrText(eParse) + "). Send it again from the other app." };
  }
  if (!data || typeof data !== "object") {
    return { error: "The handoff file does not contain a handoff. Send it again from the other app." };
  }
  return { data: data };
}

function qkBridgeMove(fromPath, toPath) {
  if (fromPath === "" || toPath === "") return false;
  if (fromPath === toPath) return true;
  var text = qkFileRead(fromPath, QK_BRIDGE_MAX_BYTES);
  if (text === null) return false;
  if (!qkFileWriteSafe(toPath, text)) return false;
  qkFileDelete(fromPath);
  return true;
}

/* ---------- steps ---------- */

/* Every bridge call answers with a list of steps. The panel draws them in
   order, so a failure says which step stopped and why. */
function qkBridgeStep(steps, id, label, state, detail) {
  steps.push({ id: qkStr(id), label: qkStr(label), state: qkStr(state), detail: qkStr(detail) });
}

function qkBridgeFailed(steps) {
  var i;
  for (i = 0; i < steps.length; i++) {
    if (steps[i].state === "fail") return true;
  }
  return false;
}

function qkBridgeReply(payload, steps) {
  payload.ok = !qkBridgeFailed(steps);
  payload.steps = steps;
  return qkJsonStringify(payload);
}

/* ---------- shared helpers ---------- */

function qkBridgeActiveSequence() {
  var seq = null;
  try {
    seq = app.project ? app.project.activeSequence : null;
  } catch (eProject) {}
  if (!seq) return null;
  try {
    if (typeof seq.videoTracks === "undefined") return null;
  } catch (eVideo) {
    return null;
  }
  return seq;
}

function qkBridgeSequenceSize(seq) {
  var width = 0;
  var height = 0;
  try {
    width = Math.round(qkSilenceNumber(seq.frameSizeHorizontal, 0));
  } catch (eWidth) {}
  try {
    height = Math.round(qkSilenceNumber(seq.frameSizeVertical, 0));
  } catch (eHeight) {}
  if (width <= 0) width = 1920;
  if (height <= 0) height = 1080;
  return { width: width, height: height };
}

/* Reads video clips first (that is what editors select); falls back to the
   audio tracks when the sequence has no video. */
function qkBridgeReadClips(seq, scope) {
  var groups = [];
  var clips = [];
  var skipped = 0;
  var offline = 0;
  var g;
  var t;
  var i;

  try {
    groups.push({ tracks: seq.videoTracks, video: true });
  } catch (eVideo) {}
  try {
    groups.push({ tracks: seq.audioTracks, video: false });
  } catch (eAudio) {}

  var ids = [];
  if (qkStr(scope) === "selection") ids = qkSilenceSelectedNodeIds(seq);
  var wanted = ids.length > 0;

  for (g = 0; g < groups.length; g++) {
    if (clips.length && g > 0) break; /* video clips found: stop before audio */
    var tracks = groups[g].tracks;
    var trackCount = 0;
    try {
      trackCount = tracks.numTracks;
    } catch (eCount) {
      trackCount = 0;
    }

    for (t = 0; t < trackCount; t++) {
      var track = null;
      try {
        track = tracks[t];
      } catch (eTrack) {}
      if (!track) continue;

      var trackName = (groups[g].video ? "V" : "A") + (t + 1);
      try {
        if (track.name) trackName = qkStr(track.name);
      } catch (eName) {}

      var count = 0;
      try {
        count = track.clips.numItems;
      } catch (eClips) {
        count = 0;
      }

      for (i = 0; i < count; i++) {
        var item = null;
        try {
          item = track.clips[i];
        } catch (eClip) {}
        if (!item) continue;

        if (wanted) {
          var nodeId = "";
          try {
            nodeId = qkStr(item.nodeId);
          } catch (eNode) {}
          if (nodeId === "" || !qkInList(nodeId, ids)) continue;
        }

        var path = qkSilenceClipPath(item);
        if (path === "" || path === "1") {
          skipped++;
          continue;
        }

        var start = qkSilenceNumber(item.start, 0);
        var end = qkSilenceNumber(item.end, 0);
        if (end <= start) {
          skipped++;
          continue;
        }

        var speed = qkSilenceNumber(item.speed, 1);
        if (speed <= 0) speed = 1;

        var inPoint = qkSilenceNumber(item.inPoint, 0);
        if (inPoint < 0) inPoint = 0;

        var exists = false;
        try {
          var media = new File(path);
          exists = media ? !!media.exists : false;
        } catch (eExists) {
          exists = false;
        }
        if (!exists) offline++;

        clips.push({
          name: qkStr(item.name),
          path: path,
          track: t,
          trackName: trackName,
          video: groups[g].video,
          sequenceStart: start,
          sequenceEnd: end,
          duration: end - start,
          inPoint: inPoint,
          outPoint: inPoint + (end - start) * speed,
          speed: speed,
          mediaExists: exists
        });
      }
    }
  }

  return { clips: clips, skipped: skipped, offline: offline, wantedSelection: wanted };
}

/* ---------- Premiere: send to After Effects ---------- */

function qkBridgeSendToAe(scope) {
  var steps = [];
  var seq = qkBridgeActiveSequence();

  if (!seq) {
    qkBridgeStep(steps, "sequence", "Read the active sequence", "fail",
      "No open sequence. Open the sequence with the clips you want to send in Premiere Pro, then press Send again.");
    return qkBridgeReply({ clips: 0, file: "", id: "" }, steps);
  }

  qkBridgeStep(steps, "sequence", "Read the active sequence", "ok", "Sequence: " + qkStr(seq.name));

  var read = qkBridgeReadClips(seq, scope);
  if (!read.clips.length) {
    qkBridgeStep(steps, "clips", "Find the clips to send", "fail",
      read.wantedSelection
        ? "The clips you selected have no media path QuickKit can read. Select a video clip on the timeline and try again."
        : "This sequence has no video or audio clips QuickKit can read. Add a clip, or select one on the timeline.");
    return qkBridgeReply({ clips: 0, file: "", id: "" }, steps);
  }

  qkBridgeStep(steps, "clips", "Find the clips to send", "ok",
    qkPlural(read.clips.length, "clip", "clips") + (read.wantedSelection ? " from the Timeline selection" : " from the whole sequence"));

  if (read.offline === read.clips.length) {
    qkBridgeStep(steps, "media", "Check the media files", "fail",
      "Every clip is offline: the files are not where Premiere expects them. Relink the media, then send again.");
    return qkBridgeReply({ clips: read.clips.length, file: "", id: "" }, steps);
  }
  if (read.offline > 0) {
    qkBridgeStep(steps, "media", "Check the media files", "note",
      qkPlural(read.offline, "clip is", "clips are") + " offline and will be reported when After Effects imports them.");
  } else {
    qkBridgeStep(steps, "media", "Check the media files", "ok",
      qkPlural(read.clips.length, "file exists", "files exist") + " on disk.");
  }

  var folder = qkBridgeFolder("pending");
  if (folder === "") {
    qkBridgeStep(steps, "folder", "Create the handoff folder", "fail",
      "QuickKit could not create %APPDATA%\\QuickKit\\bridge\\pending. Check that your Windows user can write to %APPDATA%.");
    return qkBridgeReply({ clips: read.clips.length, file: "", id: "" }, steps);
  }
  qkBridgeStep(steps, "folder", "Create the handoff folder", "ok", folder);

  var size = qkBridgeSequenceSize(seq);
  var id = qkBridgeNewId();
  var file = folder + "/" + id + ".qkhandoff";
  var base = read.clips[0].sequenceStart;
  var last = 0;
  var c;
  for (c = 0; c < read.clips.length; c++) {
    if (read.clips[c].sequenceStart < base) base = read.clips[c].sequenceStart;
    if (read.clips[c].sequenceEnd > last) last = read.clips[c].sequenceEnd;
  }

  var handoff = {
    format: QK_BRIDGE_HANDOFF,
    version: QK_BRIDGE_VERSION,
    id: id,
    created: qkDateText(),
    sequence: {
      name: qkStr(seq.name),
      frameRate: qkSilenceFrameRate(seq),
      width: size.width,
      height: size.height,
      start: base,
      duration: last - base
    },
    clips: read.clips,
    note: "Written by QuickKit in Premiere Pro. This is a file handoff, not Dynamic Link."
  };

  if (!qkFileWriteSafe(file, qkJsonStringify(handoff))) {
    qkBridgeStep(steps, "write", "Write the handoff file", "fail",
      "Windows refused to write " + file + ". Close the app that has it open, or check the folder permissions.");
    return qkBridgeReply({ clips: read.clips.length, file: "", id: "" }, steps);
  }
  qkBridgeStep(steps, "write", "Write the handoff file", "ok", file);

  qkBridgeStep(steps, "waiting", "Waiting for After Effects", "note",
    "Now open QuickKit in After Effects, Bridge tab: the handoff is listed there. Nothing has changed in either app yet.");

  return qkBridgeReply(
    {
      id: id,
      file: file,
      clips: read.clips.length,
      clipsNote: read.skipped > 0 ? qkPlural(read.skipped, "clip was", "clips were") + " skipped because they have no media path." : "",
      sequence: handoff.sequence,
      summary: read.clips[0].name + (read.clips.length > 1 ? " + " + (read.clips.length - 1) + " more" : ""),
      message:
        "Wrote a handoff for " + qkPlural(read.clips.length, "clip", "clips") + " (" +
        Math.round((last - base) * 100) / 100 + " s). Open the Bridge tab in After Effects to import it."
    },
    steps
  );
}

/* ---------- After Effects: import a handoff ---------- */

function qkBridgeUniqueCompName(name) {
  var base = qkBridgeSafeName(name);
  var taken = {};
  var count = 0;
  var i;

  try {
    count = app.project.numItems;
  } catch (eCount) {
    count = 0;
  }
  for (i = 1; i <= count; i++) {
    var item = null;
    try {
      item = app.project.item(i);
    } catch (eItem) {}
    if (!item) continue;
    var type = "";
    try {
      type = qkStr(item.typeName);
    } catch (eType) {}
    if (type !== "Composition") continue;
    try {
      taken[qkStr(item.name).toLowerCase()] = true;
    } catch (eName) {}
  }

  if (!taken[base.toLowerCase()]) return base;
  var n = 2;
  while (taken[(base + " " + n).toLowerCase()]) n++;
  return base + " " + n;
}

function qkBridgeImportFootage(path, cache) {
  var key = qkStr(path).toLowerCase();
  if (cache[key]) return { item: cache[key] };
  var file = null;
  try {
    file = new File(path);
  } catch (eFile) {}
  if (!file || !file.exists) {
    return { error: "The media file is not on disk: " + path + ". Premiere says it is linked; check the drive is connected." };
  }
  var options = null;
  try {
    options = new ImportOptions(file);
  } catch (eOptions) {
    return { error: "After Effects would not accept an import options object for " + path + ". Import the file by hand to check the format." };
  }
  var item = null;
  try {
    item = app.project.importFile(options);
  } catch (eImport) {
    return { error: "After Effects could not import " + path + ": " + qkErrText(eImport) };
  }
  if (!item) {
    return { error: "After Effects imported nothing for " + path + "." };
  }
  cache[key] = item;
  return { item: item };
}

function qkBridgeImport(id) {
  var started = qkBeginUndo("QuickKit: Bridge import");
  var steps = [];
  var handoffId = qkStr(id);
  var sourcePath = qkBridgeFile("pending", handoffId + ".qkhandoff");
  var out = qkBridgeImportRun(handoffId, sourcePath, steps);
  qkEndUndo(started);
  return qkBridgeReply(out, steps);
}

function qkBridgeImportRun(handoffId, sourcePath, steps) {
  var empty = { comp: null, layers: 0, id: handoffId };

  if (sourcePath === "") {
    qkBridgeStep(steps, "folder", "Find the handoff", "fail",
      "QuickKit could not build the handoff folder path. Check that %APPDATA% is writable.");
    return empty;
  }

  var read = qkBridgeReadJson(sourcePath);
  if (read.error) {
    qkBridgeStep(steps, "read", "Read the handoff file", "fail", read.error);
    return empty;
  }
  var handoff = read.data;
  qkBridgeStep(steps, "read", "Read the handoff file", "ok", qkPathName(sourcePath));

  if (qkStr(handoff.format) !== QK_BRIDGE_HANDOFF) {
    qkBridgeStep(steps, "format", "Check the handoff", "fail",
      "That file is not a QuickKit handoff. Send the clips again from Premiere Pro.");
    return empty;
  }
  var clips = qkPresetIsArray(handoff.clips) ? handoff.clips : [];
  if (!clips.length) {
    qkBridgeStep(steps, "format", "Check the handoff", "fail", "The handoff lists no clips. Send it again from Premiere Pro.");
    return empty;
  }
  qkBridgeStep(steps, "format", "Check the handoff", "ok", qkPlural(clips.length, "clip", "clips"));

  if (!app.project) {
    qkBridgeStep(steps, "project", "Find the After Effects project", "fail",
      "No project is open in After Effects. Open or create a project, then press Import again.");
    return empty;
  }
  qkBridgeStep(steps, "project", "Find the After Effects project", "ok", qkProjectName() || "untitled project");

  /* Import the footage once per file, then place each clip. */
  var cache = {};
  var imported = 0;
  var missing = [];
  var c;
  for (c = 0; c < clips.length; c++) {
    var got = qkBridgeImportFootage(qkStr(clips[c].path), cache);
    if (got.error) missing.push(got.error);
    else imported++;
  }

  if (imported === 0) {
    qkBridgeStep(steps, "footage", "Import the footage", "fail",
      missing.length ? missing[0] : "No footage could be imported.");
    return empty;
  }
  qkBridgeStep(steps, "footage", "Import the footage",
    missing.length ? "note" : "ok",
    missing.length
      ? qkPlural(imported, "file imported", "files imported") + "; " + missing[0]
      : qkPlural(imported, "file imported", "files imported") + ".");
  if (missing.length > 1) {
    qkBridgeStep(steps, "footage-more", "More offline clips", "note", qkJoin(missing.slice(1)));
  }

  var seqInfo = handoff.sequence || {};
  var width = Math.round(qkSilenceNumber(seqInfo.width, 1920)) || 1920;
  var height = Math.round(qkSilenceNumber(seqInfo.height, 1080)) || 1080;
  var frameRate = qkSilenceNumber(seqInfo.frameRate, 25);
  if (frameRate <= 0) frameRate = 25;

  var base = qkSilenceNumber(seqInfo.start, 0);
  var last = base;
  for (c = 0; c < clips.length; c++) {
    var clipEnd = qkSilenceNumber(clips[c].sequenceEnd, base);
    if (clipEnd > last) last = clipEnd;
  }
  var duration = last - base;
  if (duration <= 0) {
    for (c = 0; c < clips.length; c++) {
      duration += qkSilenceNumber(clips[c].duration, 0);
    }
  }
  if (duration <= 0) duration = 1;

  var comp = null;
  var compName = qkBridgeUniqueCompName(qkStr(seqInfo.name) || qkStr(clips[0].name) || "QuickKit handoff");
  try {
    comp = app.project.items.addComp(compName, width, height, 1, duration, frameRate);
  } catch (eComp) {
    qkBridgeStep(steps, "comp", "Create the composition", "fail",
      "After Effects could not create a composition: " + qkErrText(eComp));
    return empty;
  }
  if (!comp) {
    qkBridgeStep(steps, "comp", "Create the composition", "fail", "After Effects did not return the new composition.");
    return empty;
  }
  qkBridgeStep(steps, "comp", "Create the composition", "ok",
    compName + " - " + width + "x" + height + " at " + frameRate + " fps, " + (Math.round(duration * 100) / 100) + " s");

  var made = 0;
  var layerProblems = [];
  for (c = 0; c < clips.length; c++) {
    var clip = clips[c];
    var placed = qkBridgeImportFootage(qkStr(clip.path), cache);
    if (placed.error) continue;

    var offset = qkSilenceNumber(clip.sequenceStart, base) - base;
    var clipDuration = qkSilenceNumber(clip.duration, 0);
    var inPoint = qkSilenceNumber(clip.inPoint, 0);
    var speed = qkSilenceNumber(clip.speed, 1);
    if (speed <= 0) speed = 1;

    var layer = null;
    try {
      layer = comp.layers.add(placed.item);
    } catch (eAdd) {
      layerProblems.push("Layer for \"" + qkStr(clip.name) + "\" could not be added: " + qkErrText(eAdd));
      continue;
    }
    if (!layer) {
      layerProblems.push("Layer for \"" + qkStr(clip.name) + "\" came back empty.");
      continue;
    }

    /* Trim to the range Premiere actually uses, then move it to its place. */
    try {
      if (speed !== 1) layer.stretch = 100 / speed;
    } catch (eStretch) {
      layerProblems.push("Speed " + speed + "x could not be set on \"" + qkStr(clip.name) + "\"; it plays at normal speed.");
    }
    try {
      layer.startTime = -inPoint + offset;
    } catch (eStart) {}
    try {
      layer.inPoint = offset;
    } catch (eIn) {}
    try {
      layer.outPoint = offset + clipDuration;
    } catch (eOut) {}
    made++;
  }

  if (made === 0) {
    qkBridgeStep(steps, "layers", "Place the clips in the composition", "fail",
      layerProblems.length ? layerProblems[0] : "No clip could be placed in the composition.");
    return empty;
  }
  qkBridgeStep(steps, "layers", "Place the clips in the composition",
    layerProblems.length ? "note" : "ok",
    qkPlural(made, "layer trimmed to the used range", "layers trimmed to the used range") +
      (layerProblems.length ? "; " + layerProblems[0] : ""));
  if (layerProblems.length > 1) {
    qkBridgeStep(steps, "layers-more", "More layer notes", "note", qkJoin(layerProblems.slice(1)));
  }

  /* Remember where this comp came from, so Send back knows the time and track. */
  var record = {
    format: "quickkit-import",
    version: QK_BRIDGE_VERSION,
    handoffId: handoffId,
    comp: compName,
    created: qkDateText(),
    sequence: {
      name: qkStr(seqInfo.name),
      frameRate: frameRate,
      width: width,
      height: height
    },
    place: {
      start: qkSilenceNumber(clips[0].sequenceStart, 0),
      track: Math.round(qkSilenceNumber(clips[0].track, 0)),
      trackName: qkStr(clips[0].trackName)
    }
  };
  var recordPath = qkBridgeFile("imports", qkBridgeSafeName(compName).toLowerCase() + ".json");
  if (recordPath === "" || !qkFileWriteSafe(recordPath, qkJsonStringify(record))) {
    qkBridgeStep(steps, "record", "Remember the original position", "note",
      "The comp was built, but its original Premiere position could not be saved. Send back will not know where to put the render.");
  } else {
    qkBridgeStep(steps, "record", "Remember the original position", "ok",
      "Sequence time " + (Math.round(record.place.start * 100) / 100) + " s on " + record.place.trackName);
  }

  var archive = qkBridgeFile("imported", handoffId + ".qkhandoff");
  if (archive && qkBridgeMove(sourcePath, archive)) {
    qkBridgeStep(steps, "archive", "File the handoff away", "ok", "Moved to imported.");
  } else {
    qkBridgeStep(steps, "archive", "File the handoff away", "note",
      "The handoff file stayed in pending, so it will be listed again. Delete it by hand if that is annoying.");
  }

  try {
    comp.openInViewer();
  } catch (eOpen) {}

  qkBridgeStep(steps, "ready", "Ready to work", "note",
    "Composition \"" + compName + "\" is open. When it is finished, use Send back to Premiere on this tab.");

  return {
    id: handoffId,
    comp: {
      name: compName,
      width: width,
      height: height,
      frameRate: frameRate,
      duration: Math.round(duration * 100) / 100,
      layers: made
    },
    place: record.place,
    message: "Imported " + qkPlural(made, "clip", "clips") + " into \"" + compName + "\"."
  };
}

/* ---------- After Effects: render and send back ---------- */

function qkBridgeActiveComp() {
  var comp = null;
  try {
    comp = app.project ? app.project.activeItem : null;
  } catch (eProject) {}
  if (!comp) return null;
  try {
    if (qkStr(comp.typeName) !== "Composition") return null;
  } catch (eType) {
    return null;
  }
  return comp;
}

function qkBridgeAerenderPath() {
  var folder = "";
  try {
    folder = qkStr(app.path);
  } catch (ePath) {}
  folder = qkReplaceAll(folder, "\\", "/");
  while (folder.length > 1 && folder.charAt(folder.length - 1) === "/") {
    folder = folder.substring(0, folder.length - 1);
  }
  if (folder === "") return "";
  var candidate = folder + "/aerender.exe";
  try {
    var file = new File(candidate);
    if (file && file.exists) return candidate;
  } catch (eFile) {}
  /* Some builds report the parent folder instead of Support Files. */
  var alt = folder + "/Support Files/aerender.exe";
  try {
    var other = new File(alt);
    if (other && other.exists) return alt;
  } catch (eAlt) {}
  return "";
}

/* Templates differ per install and per language, so each candidate is applied
   and verified in the project before aerender is called. Passing a template
   name that does not exist is a hard aerender error, so we never guess. */
var QK_BRIDGE_TEMPLATES = [
  { choice: "auto", name: "QuickTime", extension: "mov" },
  { choice: "auto", name: "Lossless", extension: "avi" },
  { choice: "auto", name: "H.264 - Match Render Settings - 15 Mbps", extension: "mp4" },
  { choice: "prores", name: "Apple ProRes 422 HQ", extension: "mov" },
  { choice: "prores", name: "Apple ProRes 422", extension: "mov" },
  { choice: "prores", name: "QuickTime", extension: "mov" },
  { choice: "h264", name: "H.264 - Match Render Settings - 15 Mbps", extension: "mp4" },
  { choice: "h264", name: "H.264", extension: "mp4" },
  { choice: "lossless", name: "Lossless", extension: "avi" },
  { choice: "lossless", name: "Lossless with Alpha", extension: "avi" }
];

function qkBridgeTemplateList(choice) {
  var wanted = qkStr(choice) || "auto";
  var out = [];
  var i;
  for (i = 0; i < QK_BRIDGE_TEMPLATES.length; i++) {
    if (wanted === "auto" || QK_BRIDGE_TEMPLATES[i].choice === wanted) out.push(QK_BRIDGE_TEMPLATES[i]);
  }
  return out;
}

function qkBridgeQueueItem(comp) {
  var queue = null;
  try {
    queue = app.project.renderQueue.items;
  } catch (eQueue) {}
  if (!queue) return { error: "After Effects did not return its render queue." };

  var count = 0;
  try {
    count = queue.length;
  } catch (eLength) {
    count = 0;
  }

  var i;
  for (i = 1; i <= count; i++) {
    var existing = null;
    try {
      existing = queue[i];
    } catch (eItem) {}
    if (!existing) continue;
    var target = null;
    try {
      target = existing.comp;
    } catch (eComp) {}
    if (target && qkStr(target.name) === qkStr(comp.name)) {
      try {
        existing.remove();
      } catch (eRemove) {}
    }
  }

  try {
    return { item: app.project.renderQueue.items.add(comp) };
  } catch (eAdd) {
    return { error: "After Effects could not add the composition to the render queue: " + qkErrText(eAdd) };
  }
}

function qkBridgePrepareRender(choice) {
  var started = qkBeginUndo("QuickKit: Bridge render");
  var steps = [];
  var out = qkBridgePrepareRun(choice, steps);
  qkEndUndo(started);
  return qkBridgeReply(out, steps);
}

function qkBridgePrepareRun(choice, steps) {
  var comp = qkBridgeActiveComp();
  if (!comp) {
    qkBridgeStep(steps, "comp", "Find the composition", "fail",
      "Open the composition you want to send back in After Effects, then press Send back again.");
    return { plan: null };
  }

  var compName = "";
  var width = 0;
  var height = 0;
  var frameRate = 0;
  var duration = 0;
  try {
    compName = qkStr(comp.name);
    width = Math.round(qkSilenceNumber(comp.width, 0));
    height = Math.round(qkSilenceNumber(comp.height, 0));
    frameRate = qkSilenceNumber(comp.frameRate, 0);
    duration = qkSilenceNumber(comp.duration, 0);
  } catch (eInfo) {}
  qkBridgeStep(steps, "comp", "Find the composition", "ok", compName + " - " + width + "x" + height + " at " + frameRate + " fps");

  var projectPath = "";
  try {
    projectPath = app.project.file ? qkStr(app.project.file.fsName) : "";
  } catch (eFile) {}
  if (projectPath === "") {
    qkBridgeStep(steps, "project", "Find the saved project file", "fail",
      "This project has never been saved, so aerender has no file to open. Use File > Save As, then press Send back again.");
    return { plan: null };
  }
  qkBridgeStep(steps, "project", "Find the saved project file", "ok", projectPath);

  var aerender = qkBridgeAerenderPath();
  if (aerender === "") {
    qkBridgeStep(steps, "aerender", "Find aerender.exe", "note",
      "aerender.exe was not found next to After Effects. The panel will fall back to the Render Queue, which freezes the panel until it finishes.");
  } else {
    qkBridgeStep(steps, "aerender", "Find aerender.exe", "ok", aerender);
  }

  var queued = qkBridgeQueueItem(comp);
  if (queued.error) {
    qkBridgeStep(steps, "queue", "Add the composition to the render queue", "fail", queued.error);
    return { plan: null };
  }
  var item = queued.item;
  qkBridgeStep(steps, "queue", "Add the composition to the render queue", "ok", "Render queue item " + qkSilenceNumber(item.index, 0));

  try {
    item.applyTemplate("Best Settings");
    qkBridgeStep(steps, "settings", "Apply render settings", "ok", "Best Settings");
  } catch (eSettings) {
    qkBridgeStep(steps, "settings", "Apply render settings", "note",
      "The \"Best Settings\" template is not on this machine, so the current render settings are used.");
  }

  var outputModule = null;
  try {
    outputModule = item.outputModule(1);
  } catch (eModule) {}
  if (!outputModule) {
    qkBridgeStep(steps, "output", "Set the output module", "fail",
      "After Effects did not return an output module for that render queue item.");
    return { plan: null };
  }

  var candidates = qkBridgeTemplateList(choice);
  var chosen = null;
  var tried = [];
  var i;
  for (i = 0; i < candidates.length; i++) {
    try {
      outputModule.applyTemplate(candidates[i].name);
      chosen = candidates[i];
      break;
    } catch (eApply) {
      tried.push(candidates[i].name);
    }
  }

  if (!chosen) {
    qkBridgeStep(steps, "output", "Set the output module", "fail",
      "None of the output module templates QuickKit knows are on this machine (tried: " + qkJoin(tried) +
      "). Open the render queue, choose an output module once, and add a template named \"Lossless\", then try again.");
    return { plan: null };
  }

  var renderFolder = qkBridgeFolder("renders");
  if (renderFolder === "") {
    qkBridgeStep(steps, "output", "Set the output module", "fail",
      "QuickKit could not create %APPDATA%\\QuickKit\\bridge\\renders. Check that your Windows user can write to %APPDATA%.");
    return { plan: null };
  }

  var outputPath = renderFolder + "/" + qkBridgeSafeName(compName) + " " + qkBridgeStamp() + "." + chosen.extension;
  try {
    outputModule.file = new File(outputPath);
  } catch (eOutput) {
    qkBridgeStep(steps, "output", "Set the output module", "fail",
      "After Effects refused the output path " + outputPath + ": " + qkErrText(eOutput));
    return { plan: null };
  }
  if (!outputModule.file) {
    qkBridgeStep(steps, "output", "Set the output module", "fail",
      "After Effects did not accept " + outputPath + ". Pick a different folder or free some disk space.");
    return { plan: null };
  }
  qkBridgeStep(steps, "output", "Set the output module", "ok",
    chosen.name + " -> " + qkPathName(outputPath));

  try {
    app.project.save();
    qkBridgeStep(steps, "save", "Save the project", "ok", "Saved, so aerender opens the same render queue item.");
  } catch (eSave) {
    qkBridgeStep(steps, "save", "Save the project", "fail",
      "After Effects could not save the project: " + qkErrText(eSave) +
      ". Save it by hand (Ctrl+S), then press Send back again.");
    return { plan: null };
  }

  qkBridgeStep(steps, "ready", "Ready to render", "note",
    "aerender will render \"" + compName + "\" and QuickKit will then hand the file to Premiere.");

  return {
    plan: {
      comp: compName,
      project: projectPath,
      output: outputPath,
      template: chosen.name,
      extension: chosen.extension,
      aerender: aerender,
      width: width,
      height: height,
      frameRate: frameRate,
      duration: Math.round(duration * 100) / 100
    }
  };
}

function qkBridgeSendToPremiere(returnId) {
  var targets = [];
  try {
    targets = BridgeTalk.getTargets();
  } catch (eTargets) {
    return { ok: false, message: "BridgeTalk is not available in this app, so the file was left in the returns folder." };
  }

  var running = false;
  var i;
  for (i = 0; i < targets.length; i++) {
    if (qkStr(targets[i]).toLowerCase() === "premierepro") running = true;
  }
  if (!running) {
    return { ok: false, message: "Premiere Pro is not running. The render is waiting in the returns folder; open QuickKit in Premiere and press Place." };
  }

  try {
    var message = new BridgeTalk();
    message.target = "premierepro";
    message.body = "qkBridgePlaceReturn(" + qkJsonStringify(returnId) + ");";
    message.send(15);
    return { ok: true, message: "Sent to Premiere Pro. It imports and places the file; if nothing happens, open QuickKit in Premiere and press Place." };
  } catch (eSend) {
    return { ok: false, message: "BridgeTalk could not reach Premiere Pro (" + qkErrText(eSend) + "). The file is still in the returns folder." };
  }
}

function qkBridgeReadImportRecord(compName) {
  var path = qkBridgeFile("imports", qkBridgeSafeName(compName).toLowerCase() + ".json");
  if (path === "") return null;
  var read = qkBridgeReadJson(path);
  if (read.error) return null;
  return read.data;
}

function qkBridgeFinishRender(payloadJson) {
  var steps = [];
  var payload = null;
  try {
    payload = qkJsonParse(payloadJson);
  } catch (eParse) {
    qkBridgeStep(steps, "payload", "Read the render result", "fail",
      "The render result arrived damaged, so nothing was recorded. Render again.");
    return qkBridgeReply({ placed: false }, steps);
  }

  var output = qkStr(payload.output);
  var compName = qkStr(payload.comp);
  var bytes = 0;

  if (output === "") {
    qkBridgeStep(steps, "render", "Check the rendered file", "fail", "The panel did not report an output file.");
    return qkBridgeReply({ placed: false }, steps);
  }

  try {
    var file = new File(output);
    if (file && file.exists) bytes = qkSilenceNumber(file.length, 0);
  } catch (eFile) {}

  if (bytes <= 0) {
    qkBridgeStep(steps, "render", "Check the rendered file", "fail",
      "There is no file at " + output + ". The render did not finish; press Render again.");
    return qkBridgeReply({ placed: false }, steps);
  }
  qkBridgeStep(steps, "render", "Check the rendered file", "ok",
    qkPathName(output) + " (" + Math.round(bytes / 1048576 * 10) / 10 + " MB)");

  var record = qkBridgeReadImportRecord(compName);
  var place = null;
  if (record && record.place) {
    place = record.place;
    qkBridgeStep(steps, "place", "Find the original position", "ok",
      "Sequence \"" + qkStr(record.sequence ? record.sequence.name : "") + "\", " +
      (Math.round(qkSilenceNumber(place.start, 0) * 100) / 100) + " s on " + qkStr(place.trackName));
  } else {
    qkBridgeStep(steps, "place", "Find the original position", "note",
      "This comp was not built from a Premiere handoff, so there is no original position. Premiere will place it at 0 s.");
  }

  var returnId = qkBridgeNewId();
  var returnsFolder = qkBridgeFolder("returns");
  if (returnsFolder === "") {
    qkBridgeStep(steps, "write", "Write the return file", "fail",
      "QuickKit could not create %APPDATA%\\QuickKit\\bridge\\returns. Check that your Windows user can write to %APPDATA%.");
    return qkBridgeReply({ placed: false }, steps);
  }

  var recordReturn = {
    format: QK_BRIDGE_RETURN,
    version: QK_BRIDGE_VERSION,
    id: returnId,
    created: qkDateText(),
    comp: compName,
    render: output,
    bytes: bytes,
    duration: qkSilenceNumber(payload.duration, 0),
    width: qkSilenceNumber(payload.width, 0),
    height: qkSilenceNumber(payload.height, 0),
    frameRate: qkSilenceNumber(payload.frameRate, 0),
    place: place,
    sequence: record ? record.sequence : null,
    handoffId: record ? qkStr(record.handoffId) : "",
    note: "Rendered by QuickKit in After Effects. This is a file handoff, not Dynamic Link."
  };

  var returnPath = returnsFolder + "/" + returnId + ".qkreturn";
  if (!qkFileWriteSafe(returnPath, qkJsonStringify(recordReturn))) {
    qkBridgeStep(steps, "write", "Write the return file", "fail", "Windows refused to write " + returnPath + ".");
    return qkBridgeReply({ placed: false }, steps);
  }
  qkBridgeStep(steps, "write", "Write the return file", "ok", qkPathName(returnPath));

  var placed = false;
  if (payload.bridgeTalk === false) {
    qkBridgeStep(steps, "bridge", "Hand it to Premiere", "note",
      "Automatic hand-off was turned off. Open QuickKit in Premiere Pro, Bridge tab, and press Place.");
  } else {
    var sent = qkBridgeSendToPremiere(returnId);
    placed = !!sent.ok;
    qkBridgeStep(steps, "bridge", "Hand it to Premiere", sent.ok ? "ok" : "note", sent.message);
  }

  return qkBridgeReply(
    {
      placed: placed,
      file: returnPath,
      render: output,
      id: returnId,
      message: placed
        ? "Rendered and handed to Premiere Pro. Check the timeline position before you keep working."
        : "Rendered. The file is waiting for Premiere Pro in the returns folder."
    },
    steps
  );
}

/* ---------- Premiere: place a render back ---------- */

function qkBridgeFindProjectItem(path) {
  var root = null;
  try {
    root = app.project.rootItem;
  } catch (eRoot) {}
  if (!root) return null;

  var wanted = qkStr(path).toLowerCase();
  var name = qkPathName(path).toLowerCase();
  var stack = [root];
  var guard = 0;

  while (stack.length && guard < 4000) {
    guard++;
    var node = stack.pop();
    var children = null;
    try {
      children = node.children;
    } catch (eChildren) {}
    if (!children) continue;

    var count = 0;
    try {
      count = children.numItems;
    } catch (eCount) {
      count = 0;
    }

    for (var i = 0; i < count; i++) {
      var child = null;
      try {
        child = children[i];
      } catch (eChild) {}
      if (!child) continue;
      var childPath = "";
      try {
        childPath = qkStr(child.getMediaPath()).toLowerCase();
      } catch (ePath) {}
      if (childPath !== "" && childPath === wanted) return child;
      try {
        if (qkStr(child.name).toLowerCase() === name && childPath !== "") return child;
      } catch (eName) {}
      try {
        if (child.children && child.children.numItems > 0) stack.push(child);
      } catch (ePush) {}
    }
  }
  return null;
}

function qkBridgePlaceReturn(id) {
  var started = qkBeginUndo("QuickKit: Bridge place");
  var steps = [];
  var returnId = qkStr(id);
  var path = qkBridgeFile("returns", returnId + ".qkreturn");
  var out = qkBridgePlaceRun(returnId, path, steps);
  qkEndUndo(started);
  return qkBridgeReply(out, steps);
}

function qkBridgePlaceRun(returnId, path, steps) {
  var empty = { id: returnId, placed: false };

  if (path === "") {
    qkBridgeStep(steps, "folder", "Find the return file", "fail",
      "QuickKit could not build the returns folder path. Check that %APPDATA% is writable.");
    return empty;
  }

  var read = qkBridgeReadJson(path);
  if (read.error) {
    qkBridgeStep(steps, "read", "Read the return file", "fail", read.error);
    return empty;
  }
  var record = read.data;
  qkBridgeStep(steps, "read", "Read the return file", "ok", qkPathName(path));

  if (qkStr(record.format) !== QK_BRIDGE_RETURN) {
    qkBridgeStep(steps, "format", "Check the return file", "fail", "That is not a QuickKit return file. Render again from After Effects.");
    return empty;
  }

  var render = qkStr(record.render);
  var exists = false;
  try {
    var file = new File(render);
    exists = file ? !!file.exists : false;
  } catch (eFile) {}
  if (!exists) {
    qkBridgeStep(steps, "file", "Check the rendered file", "fail",
      "The render is not at " + render + ". It may have been moved or deleted; render again from After Effects.");
    return empty;
  }
  qkBridgeStep(steps, "file", "Check the rendered file", "ok", qkPathName(render));

  var seq = qkBridgeActiveSequence();
  if (!seq) {
    qkBridgeStep(steps, "sequence", "Find the destination sequence", "fail",
      "No open sequence. Open the sequence this came from, then press Place again.");
    return empty;
  }
  qkBridgeStep(steps, "sequence", "Find the destination sequence", "ok", qkStr(seq.name));

  try {
    app.project.importFiles([render], true, null, false);
  } catch (eImport) {
    qkBridgeStep(steps, "import", "Import the render", "fail",
      "Premiere could not import " + render + ": " + qkErrText(eImport));
    return empty;
  }

  var item = qkBridgeFindProjectItem(render);
  if (!item) {
    qkBridgeStep(steps, "import", "Import the render", "fail",
      "Premiere imported the file but QuickKit cannot find it in the project panel. Import it by hand from " + render + ".");
    return empty;
  }
  qkBridgeStep(steps, "import", "Import the render", "ok", qkStr(item.name));

  var place = record.place || null;
  var start = place ? qkSilenceNumber(place.start, 0) : 0;
  var trackIndex = place ? Math.round(qkSilenceNumber(place.track, 0)) : 0;
  if (trackIndex < 0) trackIndex = 0;

  var track = null;
  try {
    if (trackIndex < seq.videoTracks.numTracks) track = seq.videoTracks[trackIndex];
  } catch (eTrack) {}
  if (!track) {
    try {
      track = seq.videoTracks[0];
    } catch (eFirst) {}
  }
  if (!track) {
    qkBridgeStep(steps, "place", "Place it on the timeline", "fail",
      "The sequence has no video track QuickKit can write to. Add a video track, then press Place again.");
    return empty;
  }

  var placedOk = false;
  var where = start;
  try {
    if (typeof track.overwriteClip === "function") {
      placedOk = !!track.overwriteClip(item, start);
    }
  } catch (eOverwrite) {
    placedOk = false;
  }
  if (!placedOk) {
    /* insertClip ripples instead of overwriting, so it is the second choice. */
    try {
      placedOk = !!track.insertClip(item, start);
    } catch (eInsert) {
      placedOk = false;
    }
  }

  if (!placedOk) {
    qkBridgeStep(steps, "place", "Place it on the timeline", "fail",
      "Premiere did not accept the clip at " + start + " s on the first video track. The file is imported already: drag it onto the timeline yourself.");
    return empty;
  }

  var trackName = "V1";
  try {
    if (track.name) trackName = qkStr(track.name);
  } catch (eName) {}

  if (place) {
    qkBridgeStep(steps, "place", "Place it on the timeline", "ok",
      "Placed at " + (Math.round(start * 100) / 100) + " s on " + trackName + " (the original position).");
  } else {
    qkBridgeStep(steps, "place", "Place it on the timeline", "note",
      "Placed at 0 s on " + trackName + " because this comp was not built from a Premiere handoff, so its original position is unknown.");
    where = 0;
  }

  var archive = qkBridgeFile("placed", returnId + ".qkreturn");
  if (archive && qkBridgeMove(path, archive)) {
    qkBridgeStep(steps, "archive", "File the return away", "ok", "Moved to placed.");
  } else {
    qkBridgeStep(steps, "archive", "File the return away", "note",
      "The return file stayed in the returns folder, so it will be listed again.");
  }

  qkBridgeStep(steps, "check", "Check the result", "note",
    "This replaced whatever picture was under the clip. If the comp is longer than the original clip, check the frames after it.");

  return {
    id: returnId,
    placed: true,
    start: Math.round(where * 100) / 100,
    track: trackName,
    message: "Placed \"" + qkStr(record.comp) + "\" at " + (Math.round(where * 100) / 100) + " s on " + trackName + "."
  };
}

/* ---------- both apps: lists ---------- */

function qkBridgeListKind(kind, suffix, step) {
  var folder = qkBridgeFolder(kind);
  var out = [];
  var skipped = 0;
  if (folder === "") return { items: out, skipped: skipped, folder: "" };

  var entries = [];
  try {
    var dir = new Folder(folder);
    if (dir && dir.exists) entries = dir.getFiles("*" + suffix) || [];
  } catch (eList) {
    entries = [];
  }

  var i;
  for (i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var path = "";
    try {
      path = qkStr(entry.fsName);
    } catch (ePath) {}
    if (path === "") continue;

    var read = qkBridgeReadJson(path);
    if (read.error) {
      skipped++;
      continue;
    }
    var data = read.data;
    var row = {
      id: qkStr(data.id) || qkPathName(path).replace(/\.(qkhandoff|qkreturn)$/i, ""),
      file: path,
      created: qkStr(data.created)
    };

    if (step === "pending") {
      var clips = qkPresetIsArray(data.clips) ? data.clips : [];
      var seq = data.sequence || {};
      row.comp = qkStr(seq.name);
      row.clips = clips.length;
      row.frameRate = qkSilenceNumber(seq.frameRate, 0);
      row.width = Math.round(qkSilenceNumber(seq.width, 0));
      row.height = Math.round(qkSilenceNumber(seq.height, 0));
      row.duration = Math.round(qkSilenceNumber(seq.duration, 0) * 100) / 100;
      row.summary = clips.length ? qkStr(clips[0].name) + (clips.length > 1 ? " + " + (clips.length - 1) + " more" : "") : "no clips";
    } else {
      var place = data.place || null;
      row.comp = qkStr(data.comp);
      row.render = qkStr(data.render);
      row.duration = Math.round(qkSilenceNumber(data.duration, 0) * 100) / 100;
      row.at = place ? Math.round(qkSilenceNumber(place.start, 0) * 100) / 100 : 0;
      row.trackName = place ? qkStr(place.trackName) : "";
      row.summary = qkPathName(row.render);
      var present = false;
      try {
        var renderFile = new File(row.render);
        present = renderFile ? !!renderFile.exists : false;
      } catch (eRender) {}
      row.renderExists = present;
    }

    out.push(row);
  }

  return { items: out, skipped: skipped, folder: folder };
}

function qkBridgeList() {
  var pending = qkBridgeListKind("pending", ".qkhandoff", "pending");
  var returns = qkBridgeListKind("returns", ".qkreturn", "returns");

  return qkJsonStringify({
    ok: true,
    host: qkHostId(),
    pending: pending.items,
    returns: returns.items,
    skipped: pending.skipped + returns.skipped,
    folders: {
      pending: pending.folder,
      returns: returns.folder,
      renders: qkBridgeFolder("renders")
    },
    message:
      qkPlural(pending.items.length, "handoff", "handoffs") + " waiting for After Effects, " +
      qkPlural(returns.items.length, "render", "renders") + " waiting for Premiere Pro."
  });
}

function qkBridgeInfo() {
  var comp = qkBridgeActiveComp();
  var compInfo = null;
  if (comp) {
    compInfo = {
      name: qkStr(comp.name),
      width: Math.round(qkSilenceNumber(comp.width, 0)),
      height: Math.round(qkSilenceNumber(comp.height, 0)),
      frameRate: qkSilenceNumber(comp.frameRate, 0),
      duration: Math.round(qkSilenceNumber(comp.duration, 0) * 100) / 100
    };
  }

  var projectPath = "";
  try {
    projectPath = app.project && app.project.file ? qkStr(app.project.file.fsName) : "";
  } catch (eFile) {}

  return qkJsonStringify({
    ok: true,
    host: qkHostId(),
    root: qkBridgeBasePath(),
    project: projectPath,
    comp: compInfo,
    aerender: qkBridgeAerenderPath(),
    handoff: false,
    message: "File handoff, not Dynamic Link: nothing crosses the apps until you press a button."
  });
}
/* ============================================================
 * Library apply + preview generation (Part 6B)
 *
 * qkLibraryApply    — applies one library item to the current selection.
 * qkPreviewGenerate — renders a throwaway comp into PNG frames for ffmpeg.
 *
 * Why the Render Queue and not aerender: aerender only renders a saved .aep,
 * so using it would mean saving (or Save-As-ing) the user's project just to
 * throw that copy away afterwards. The queue renders the open, unsaved project
 * as it stands, the temp comp never leaves the project, and every other queue
 * item is switched off and restored in a finally block. The cost is that the
 * call blocks for one short render, so a batch can only be cancelled between
 * items.
 * ============================================================ */

var QK_PREVIEW_WIDTH = 1920;
var QK_PREVIEW_HEIGHT = 1080;
var QK_PREVIEW_FPS = 24;
var QK_PREVIEW_SECONDS = 2.5;
var QK_PREVIEW_MAX_FRAMES = 150;

function qkPreviewNumber(value, fallback, low, high) {
  var number = qkPresetNumber(value, fallback);
  if (number < low) number = low;
  if (number > high) number = high;
  return number;
}

/* Reads a .qkpreset straight from a library item folder. */
function qkPreviewReadPreset(filePath) {
  var text = qkFileRead(filePath, QK_PRESET_MAX_BYTES);
  if (text === null) return { error: "That preset file is missing from the library folder." };
  var raw = null;
  try {
    raw = qkJsonParse(text);
  } catch (eParse) {
    return { error: "That preset file is damaged." };
  }
  var normalized = qkPresetNormalize(raw, "");
  if (normalized.error) return { error: "That preset file is damaged." };
  return { preset: normalized.preset };
}

/* Applies a saved .ffx effect preset to the given layers. */
function qkPreviewApplyFfx(filePath, selected) {
  var file = new File(filePath);
  if (!file || !file.exists) return { error: "The .ffx file is missing from the library folder." };
  var applied = 0;
  var notes = [];
  for (var i = 0; i < selected.length; i++) {
    var layer = selected[i];
    if (layer.locked) {
      notes.push(qkStr(layer.name) + " is locked");
      continue;
    }
    try {
      layer.applyPreset(file);
      applied++;
    } catch (eApply) {
      notes.push(qkStr(layer.name) + ": " + qkErrText(eApply));
    }
  }
  return { applied: applied, notes: notes };
}

/* payload: { kind: "qkpreset"|"ffx", path, name } */
function qkLibraryApply(payloadJson) {
  if (qkHostId() !== "AEFT") return qkErr("Applying library items in Premiere Pro arrives in part 6D.");
  var payload = null;
  try {
    payload = qkJsonParse(qkStr(payloadJson));
  } catch (ePayload) {
    return qkErr("QuickKit could not read that item.");
  }
  if (!payload || typeof payload !== "object") return qkErr("QuickKit could not read that item.");

  var kind = qkStr(payload.kind);
  var filePath = qkStr(payload.path);
  var itemName = qkPresetCleanText(payload.name, 60) || "that item";
  if (filePath === "") return qkErr("The item file is missing from the library folder.");
  if (kind !== "qkpreset" && kind !== "ffx") {
    return qkErr("QuickKit cannot apply that kind of item in After Effects yet.");
  }

  var ctx = qkGetComp();
  if (ctx.error) return qkErr(ctx.error);
  var selection = qkSelectedLayers(ctx.comp);
  if (selection.error) return qkErr(selection.error);

  var started = qkBeginUndo("QuickKit: Apply library item");
  var applied = 0;
  var checked = 0;
  var notes = [];
  var failure = "";

  try {
    if (kind === "qkpreset") {
      var loaded = qkPreviewReadPreset(filePath);
      if (loaded.error) {
        failure = loaded.error;
      } else {
        var result = qkPresetApplyLayers(loaded.preset, selection.layers);
        applied = result.appliedLayers;
        checked = result.appliedProps;
        notes = result.notes;
        failure = result.error;
      }
    } else {
      var ffx = qkPreviewApplyFfx(filePath, selection.layers);
      if (ffx.error) failure = ffx.error;
      else {
        applied = ffx.applied;
        notes = ffx.notes;
      }
    }
  } catch (eApply2) {
    failure = qkErrText(eApply2);
  }

  qkEndUndo(started);

  if (failure !== "") return qkErr("Applying stopped: " + failure + ".");
  if (applied === 0) {
    var why = "Nothing was applied from \"" + itemName + "\".";
    if (notes.length) why += " " + qkJoin(notes) + ".";
    return qkErr(why);
  }

  var message = "Applied \"" + itemName + "\" to " + qkPlural(applied, "layer", "layers");
  if (checked > 0) message += " (" + qkPlural(checked, "property", "properties") + ")";
  message += ".";
  if (notes.length) message += " " + qkJoin(notes) + ".";
  return qkOk(message);
}

/* A real PNG check: a wrong output-module template can write JPEG bytes into
   a .png name, and those would fail silently in ffmpeg. */
function qkPreviewIsPng(file) {
  var handle = new File(file);
  if (!handle || !handle.exists) return false;
  var ok = false;
  try {
    handle.encoding = "BINARY";
    if (handle.open("r")) {
      var head = handle.read(4);
      handle.close();
      ok =
        head && head.length === 4 &&
        head.charCodeAt(0) === 137 && head.charCodeAt(1) === 80 &&
        head.charCodeAt(2) === 78 && head.charCodeAt(3) === 71;
    }
  } catch (eRead) {
    ok = false;
  }
  return ok;
}

function qkPreviewPngNames(dir) {
  var names = [];
  var folder = null;
  try {
    folder = new Folder(dir);
  } catch (eFolder) {
    return names;
  }
  if (!folder || !folder.exists) return names;
  var listed = null;
  try {
    listed = folder.getFiles("*.png");
  } catch (eList) {
    return names;
  }
  for (var i = 0; i < listed.length; i++) {
    if (listed[i] instanceof Folder) continue;
    names.push(qkStr(listed[i].name));
  }
  names.sort();

  var out = [];
  for (var k = 0; k < names.length; k++) {
    if (qkPreviewIsPng(dir + "/" + names[k])) out.push(names[k]);
  }
  return out;
}

/* Centres a text layer on its own box, so the word sits in the middle whatever
   the font metrics are. */
function qkPreviewCenterText(layer, comp) {
  try {
    var group = layer.property("ADBE Transform Group");
    var rect = layer.sourceRectAtTime(0, false);
    group.property("ADBE Anchor Point").setValue([rect.left + rect.width / 2, rect.top + rect.height / 2]);
    group.property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
  } catch (eCenter) {
    /* a preset without transform still renders; centring is best effort */
  }
}

/* payload: { name, kind, path, dir, width?, height?, fps?, seconds? }
   Returns the PNG frame names (not paths) so the JSON stays small. */
function qkPreviewGenerate(payloadJson) {
  if (qkHostId() !== "AEFT") {
    return qkErr("Preview generation runs in After Effects. In Premiere Pro the previews are read-only.");
  }
  var payload = null;
  try {
    payload = qkJsonParse(qkStr(payloadJson));
  } catch (ePayload) {
    return qkErr("QuickKit could not read that request.");
  }
  if (!payload || typeof payload !== "object") return qkErr("QuickKit could not read that request.");

  var name = qkPresetCleanText(payload.name, 60) || "QuickKit preview";
  var kind = qkStr(payload.kind);
  var filePath = qkStr(payload.path);
  var dir = qkTrim(qkStr(payload.dir));
  if (kind !== "qkpreset" && kind !== "ffx") return qkErr("That item cannot be previewed by rendering.");
  if (dir === "") return qkErr("QuickKit did not get a folder for the preview frames.");
  if (!app.project) return qkErr("Open a project in After Effects first.");

  if (kind === "qkpreset") {
    var loaded = qkPreviewReadPreset(filePath);
    if (loaded.error) return qkErr(loaded.error);
  } else {
    var ffxFile = new File(filePath);
    if (!ffxFile || !ffxFile.exists) return qkErr("The .ffx file is missing from the library folder.");
  }

  var folder = new Folder(dir);
  if (!folder.exists && !folder.create()) {
    return qkErr("QuickKit could not create the temp folder for the preview frames.");
  }

  var width = qkPreviewNumber(payload.width, QK_PREVIEW_WIDTH, 320, 3840);
  var height = qkPreviewNumber(payload.height, QK_PREVIEW_HEIGHT, 240, 2160);
  var fps = qkPreviewNumber(payload.fps, QK_PREVIEW_FPS, 6, 60);
  var seconds = qkPreviewNumber(payload.seconds, QK_PREVIEW_SECONDS, 2, 4);

  var queue = app.project.renderQueue;
  if (queue.queueInProgress) {
    return qkErr("After Effects is already rendering. Wait for that render to finish, then try again.");
  }

  var comp = null;
  var item = null;
  var restore = [];
  var frames = [];
  var method = "render-queue";
  var appliedLayers = 0;
  var appliedProps = 0;
  var applyNotes = [];
  var failure = "";

  try {
    comp = app.project.items.addComp("QuickKit preview - " + name, width, height, 1, seconds, fps);
    comp.bgColor = [0.055, 0.063, 0.078];

    comp.layers.addSolid([0.055, 0.063, 0.078], "Backdrop", width, height, 1);

    var textLayer = comp.layers.addText(name);
    var textProp = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
    var doc = textProp.value;
    doc.fontSize = Math.round(height * 0.1);
    doc.fillColor = [0.94, 0.95, 0.97];
    doc.applyFill = true;
    doc.applyStroke = false;
    textProp.setValue(doc);
    qkPreviewCenterText(textLayer, comp);

    if (kind === "qkpreset") {
      var applied = qkPresetApplyLayers(loaded.preset, [textLayer]);
      appliedLayers = applied.appliedLayers;
      appliedProps = applied.appliedProps;
      applyNotes = applied.notes;
      if (applied.error !== "") failure = applied.error;
    } else {
      var ffxApplied = qkPreviewApplyFfx(filePath, [textLayer]);
      if (ffxApplied.error) failure = ffxApplied.error;
      else appliedLayers = ffxApplied.applied;
    }
    if (failure === "" && appliedLayers === 0) {
      failure = "The preset changed nothing on a plain text layer.";
    }

    if (failure === "") {
      item = queue.items.add(comp);
      try {
        item.outputModule(1).applyTemplate("PNG Sequence");
      } catch (eTemplate) {
        /* English template missing: the .png extension below still picks PNG. */
      }
      item.outputModule(1).file = new File(dir + "/preview_00000.png");

      for (var q = 1; q <= queue.items.length; q++) {
        var other = queue.items[q];
        if (other === item) continue;
        restore.push({ item: other, render: other.render });
        other.render = false;
      }

      queue.render();
      frames = qkPreviewPngNames(dir);

      if (!frames.length) {
        method = "save-frame";
        var count = Math.round(seconds * fps);
        if (count > QK_PREVIEW_MAX_FRAMES) count = QK_PREVIEW_MAX_FRAMES;
        for (var f = 0; f < count; f++) {
          comp.saveFrameToPng(f / fps, new File(dir + "/frame_" + qkPad(f, 5) + ".png"));
        }
        frames = qkPreviewPngNames(dir);
      }
      if (!frames.length) failure = "After Effects rendered no frames for this preset.";
    }
  } catch (eGenerate) {
    failure = qkErrText(eGenerate);
  } finally {
    for (var r = 0; r < restore.length; r++) {
      try {
        restore[r].item.render = restore[r].render;
      } catch (eRestore) {}
    }
    if (item) {
      try {
        item.remove();
      } catch (eRemoveItem) {}
    }
    if (comp) {
      try {
        comp.remove();
      } catch (eRemoveComp) {}
    }
  }

  if (failure !== "") return qkErr("Preview generation stopped: " + failure + ".");

  return qkJsonStringify({
    ok: true,
    dir: dir,
    frames: frames,
    fps: fps,
    width: width,
    height: height,
    seconds: Math.round((frames.length / fps) * 100) / 100,
    method: method,
    appliedLayers: appliedLayers,
    appliedProps: appliedProps,
    notes: applyNotes,
    message:
      "Rendered " + qkPlural(frames.length, "frame", "frames") + " with the Render Queue" +
      (method === "save-frame" ? " (fallback: Save Frame as PNG)" : "") +
      (applyNotes.length ? ". " + qkJoin(applyNotes) + "." : ".")
  });
}
