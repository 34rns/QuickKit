/* QuickKit library core (Part 6A).
 *
 * Pure logic for the unified library: index schema, item and folder records,
 * migration of the Part 4 presets, nested folders, smart collections,
 * search/filter/sort, pack manifests and import conflict handling.
 *
 * No Node, no DOM, no network. Storage is an adapter passed in by
 * extension/js/library-io.js (real disk) or by tests (a temp folder).
 * The panel loads this file as a page script and uses it for querying only.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QKLibraryCore = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var SCHEMA = 1;
  var FORMAT = "quickkit-library";
  var ITEM_FORMAT = "quickkit-library-item";
  var FOLDERS_FORMAT = "quickkit-library-folders";
  var PACK_FORMAT = "quickkit-pack";

  var TYPES = ["ae-preset", "mogrt", "pr-recipe", "pack"];
  var TYPE_LABEL = {
    "ae-preset": "After Effects preset",
    mogrt: "MOGRT",
    "pr-recipe": "Premiere recipe",
    pack: "Pack"
  };
  var TYPE_HOSTS = {
    "ae-preset": ["AEFT"],
    mogrt: ["PPRO"],
    "pr-recipe": ["PPRO"],
    pack: ["AEFT", "PPRO"]
  };
  var TYPE_ASSET = {
    "ae-preset": "asset.qkpreset",
    mogrt: "asset.mogrt",
    "pr-recipe": "asset.qkrecipe.json",
    pack: "asset.qkpack"
  };

  var COLLECTIONS = [
    { id: "all", label: "All items" },
    { id: "favorites", label: "Favorites" },
    { id: "recent", label: "Recently used" },
    { id: "most-used", label: "Most used" },
    { id: "untagged", label: "Untagged" },
    { id: "text", label: "Text" },
    { id: "transitions", label: "Transitions" },
    { id: "shapes", label: "Shapes" }
  ];

  var COLLECTION_WORDS = {
    text: /text|title|lower\s?third|kinetic|subtitle|caption/,
    transitions: /transition|wipe|slide|zoom|dissolve|fade in|fade out/,
    shapes: /shape|mask|geometric|circle|rect|ellipse|polygon|star/
  };

  var MAX_ITEMS = 2000;
  var MAX_FOLDERS = 200;
  var MAX_NAME = 80;
  var MAX_NOTES = 400;
  var MAX_CATEGORY = 40;
  var MAX_TAGS = 24;
  var MAX_TAG = 24;
  var MAX_FOLDER_NAME = 60;

  var HOSTS = ["AEFT", "PPRO"];

  /* ------------------------------------------------------------ helpers */

  function str(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function bool(value) {
    return value === true || value === "true" || value === 1 || value === "1";
  }

  function isArray(value) {
    return Object.prototype.toString.call(value) === "[object Array]";
  }

  function pad(value, width) {
    var text = str(value);
    while (text.length < width) text = "0" + text;
    return text;
  }

  function nowText(date) {
    var d = date || new Date();
    return (
      d.getFullYear() +
      "-" + pad(d.getMonth() + 1, 2) +
      "-" + pad(d.getDate(), 2) +
      " " + pad(d.getHours(), 2) +
      ":" + pad(d.getMinutes(), 2) +
      ":" + pad(d.getSeconds(), 2)
    );
  }

  /* Control characters out, trim, hard length cap. */
  function cleanText(value, maxLength) {
    var text = str(value);
    var out = "";
    var i;
    for (i = 0; i < text.length; i++) {
      out += text.charCodeAt(i) < 32 ? " " : text.charAt(i);
    }
    out = out.replace(/\s+/g, " ").replace(/^ | $/g, "");
    if (maxLength && out.length > maxLength) out = out.substring(0, maxLength);
    return out;
  }

  function safeId(value) {
    var text = str(value);
    if (!text || text.length > 80) return "";
    if (!/^[A-Za-z0-9_-]+$/.test(text)) return "";
    return text;
  }

  /* A single file name: no separators, no traversal, no control characters. */
  function safeFileName(value, fallback) {
    var text = cleanText(value, 120).replace(/[\\/:*?"<>|]/g, "-");
    if (text === "." || text === ".." || text === "") text = str(fallback);
    return text;
  }

  function cleanTags(value) {
    var list = [];
    var out = [];
    var i;
    var tag;
    if (isArray(value)) list = value;
    else if (typeof value === "string") list = value.split(",");
    for (i = 0; i < list.length && out.length < MAX_TAGS; i++) {
      tag = cleanText(list[i], MAX_TAG).toLowerCase().replace(/^#/, "");
      if (tag === "" || out.indexOf(tag) >= 0) continue;
      out.push(tag);
    }
    return out;
  }

  function cleanHosts(value, type) {
    var out = [];
    var i;
    if (isArray(value)) {
      for (i = 0; i < value.length; i++) {
        var host = str(value[i]).toUpperCase();
        if (HOSTS.indexOf(host) >= 0 && out.indexOf(host) < 0) out.push(host);
      }
    }
    if (!out.length) return (TYPE_HOSTS[type] || HOSTS).slice(0);
    return out;
  }

  function normalizeType(value) {
    var type = str(value).toLowerCase();
    return TYPES.indexOf(type) >= 0 ? type : "ae-preset";
  }

  function uniqueName(taken, name, suffix) {
    var base = name;
    var candidate = suffix ? name + " (" + suffix + ")" : name;
    var n = suffix || 2;
    while (taken[candidate.toLowerCase()]) {
      candidate = base + " (" + n + ")";
      n++;
    }
    return candidate;
  }

  function idFromClock(prefix, seed) {
    var stamp = seed === undefined ? Date.now() : seed;
    return (
      (prefix || "i") + stamp +
      "-" + Math.floor(Math.random() * 90000 + 10000)
    );
  }

  /* ------------------------------------------------------------- records */

  function normalizeFolder(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = safeId(raw.id);
    if (!id) return null;
    return {
      id: id,
      name: cleanText(raw.name, MAX_FOLDER_NAME) || "Folder",
      parentId: safeId(raw.parentId) || "",
      order: num(raw.order, 0)
    };
  }

  function normalizeItem(raw, fallbackId) {
    if (!raw || typeof raw !== "object") return null;
    var id = safeId(raw.id) || safeId(fallbackId);
    if (!id) return null;
    var type = normalizeType(raw.type);
    var name = cleanText(raw.name, MAX_NAME);
    if (!name) name = "Untitled " + (TYPE_LABEL[type] || "item");

    var folderPath = [];
    if (isArray(raw.folderPath)) {
      for (var p = 0; p < raw.folderPath.length && p < 12; p++) {
        var step = cleanText(raw.folderPath[p], MAX_FOLDER_NAME);
        if (step) folderPath.push(step);
      }
    }

    return {
      id: id,
      name: name,
      type: type,
      category: cleanText(raw.category, MAX_CATEGORY),
      tags: cleanTags(raw.tags),
      favorite: bool(raw.favorite),
      hostSupport: cleanHosts(raw.hostSupport, type),
      createdAt: str(raw.createdAt) || nowText(),
      usageCount: Math.max(0, Math.floor(num(raw.usageCount, 0))),
      lastUsed: str(raw.lastUsed),
      previewVideo: str(raw.previewVideo),
      previewThumb: str(raw.previewThumb),
      author: cleanText(raw.author, 60) || "You",
      license: cleanText(raw.license, 80),
      notes: cleanText(raw.notes, MAX_NOTES),
      folderId: safeId(raw.folderId),
      folderPath: folderPath,
      asset: safeFileName(raw.asset, TYPE_ASSET[type]),
      assetName: safeFileName(raw.assetName, name),
      bytes: Math.max(0, num(raw.bytes, 0)),
      order: num(raw.order, 0),
      updatedAt: str(raw.updatedAt) || str(raw.createdAt) || nowText()
    };
  }

  function createIndex() {
    return {
      format: FORMAT,
      schemaVersion: SCHEMA,
      updatedAt: nowText(),
      migrated: null,
      folders: [],
      items: []
    };
  }

  function dedupe(list, key) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var value = str(list[i][key]).toLowerCase();
      if (seen[value]) continue;
      seen[value] = true;
      out.push(list[i]);
    }
    return out;
  }

  function normalizeIndex(raw) {
    var index = createIndex();
    var i;
    if (!raw || typeof raw !== "object") return index;

    index.schemaVersion = Math.max(1, Math.floor(num(raw.schemaVersion, SCHEMA)));
    index.updatedAt = str(raw.updatedAt);
    index.migrated = raw.migrated && typeof raw.migrated === "object" ? raw.migrated : null;

    if (isArray(raw.folders)) {
      for (i = 0; i < raw.folders.length && index.folders.length < MAX_FOLDERS; i++) {
        var folder = normalizeFolder(raw.folders[i]);
        if (folder) index.folders.push(folder);
      }
      index.folders = dedupe(index.folders, "id");
    }

    if (isArray(raw.items)) {
      for (i = 0; i < raw.items.length && index.items.length < MAX_ITEMS; i++) {
        var item = normalizeItem(raw.items[i], "");
        if (item) index.items.push(item);
      }
      index.items = dedupe(index.items, "id");
    }

    /* Parent references must point at a real folder, and the chain must end. */
    var byId = {};
    for (i = 0; i < index.folders.length; i++) byId[index.folders[i].id] = true;
    for (i = 0; i < index.folders.length; i++) {
      var f = index.folders[i];
      if (f.parentId && !byId[f.parentId]) f.parentId = "";
      if (f.parentId === f.id) f.parentId = "";
    }
    var guard;
    for (i = 0; i < index.folders.length; i++) {
      guard = 0;
      var cursor = index.folders[i];
      while (cursor && cursor.parentId && guard < 40) {
        var next = folderById(index, cursor.parentId);
        if (!next || next.id === index.folders[i].id) {
          cursor.parentId = "";
          break;
        }
        cursor = next;
        guard++;
      }
    }
    refreshFolderPaths(index);
    return index;
  }

  /* ------------------------------------------------------------- folders */

  function folderById(index, id) {
    for (var i = 0; i < index.folders.length; i++) {
      if (index.folders[i].id === id) return index.folders[i];
    }
    return null;
  }

  function folderPathOf(index, folderId) {
    var names = [];
    var guard = 0;
    var folder = folderById(index, folderId);
    while (folder && guard < 40) {
      names.unshift(folder.name);
      folder = folder.parentId ? folderById(index, folder.parentId) : null;
      guard++;
    }
    return names;
  }

  function descendantIds(index, folderId) {
    var out = [folderId];
    var grew = true;
    while (grew) {
      grew = false;
      for (var i = 0; i < index.folders.length; i++) {
        var f = index.folders[i];
        if (out.indexOf(f.parentId) >= 0 && out.indexOf(f.id) < 0) {
          out.push(f.id);
          grew = true;
        }
      }
    }
    return out;
  }

  function refreshFolderPaths(index) {
    for (var i = 0; i < index.items.length; i++) {
      var item = index.items[i];
      if (item.folderId && !folderById(index, item.folderId)) item.folderId = "";
      item.folderPath = item.folderId ? folderPathOf(index, item.folderId) : [];
    }
  }

  function siblingNames(index, parentId, exceptId) {
    var taken = {};
    for (var i = 0; i < index.folders.length; i++) {
      var f = index.folders[i];
      if (f.parentId !== parentId || f.id === exceptId) continue;
      taken[f.name.toLowerCase()] = true;
    }
    return taken;
  }

  function maxOrder(index, parentId) {
    var top = -1;
    for (var i = 0; i < index.folders.length; i++) {
      var f = index.folders[i];
      if (f.parentId !== parentId) continue;
      if (f.order > top) top = f.order;
    }
    return top;
  }

  function folderCreate(index, payload, options) {
    var opts = options || {};
    var name = cleanText(payload && payload.name, MAX_FOLDER_NAME);
    if (!name) return { error: "Give the folder a name first." };
    var parentId = safeId(payload && payload.parentId);
    if (parentId && !folderById(index, parentId)) {
      return { error: "That parent folder no longer exists. Refresh the library and try again." };
    }
    if (index.folders.length >= MAX_FOLDERS) {
      return { error: "The library holds up to " + MAX_FOLDERS + " folders." };
    }
    if (siblingNames(index, parentId)[name.toLowerCase()]) {
      return { error: "A folder called \"" + name + "\" already exists here." };
    }
    var folder = {
      id: safeId(opts.id) || idFromClock("f", opts.seed),
      name: name,
      parentId: parentId,
      order: maxOrder(index, parentId) + 1
    };
    index.folders.push(folder);
    refreshFolderPaths(index);
    return { folder: folder };
  }

  function folderRename(index, payload) {
    var folder = folderById(index, safeId(payload && payload.id));
    if (!folder) return { error: "That folder no longer exists. Refresh the library and try again." };
    var name = cleanText(payload && payload.name, MAX_FOLDER_NAME);
    if (!name) return { error: "A folder needs a name." };
    if (siblingNames(index, folder.parentId, folder.id)[name.toLowerCase()]) {
      return { error: "A folder called \"" + name + "\" already exists here." };
    }
    folder.name = name;
    refreshFolderPaths(index);
    return { folder: folder };
  }

  function folderMove(index, payload) {
    var folder = folderById(index, safeId(payload && payload.id));
    if (!folder) return { error: "That folder no longer exists. Refresh the library and try again." };
    var parentId = safeId(payload && payload.parentId);
    if (parentId && !folderById(index, parentId)) {
      return { error: "The destination folder no longer exists." };
    }
    if (parentId === folder.id || descendantIds(index, folder.id).indexOf(parentId) >= 0) {
      return { error: "A folder cannot be moved inside itself." };
    }
    if (siblingNames(index, parentId, folder.id)[folder.name.toLowerCase()]) {
      return { error: "A folder called \"" + folder.name + "\" already exists there." };
    }
    folder.parentId = parentId;
    folder.order = maxOrder(index, parentId) + 1;
    refreshFolderPaths(index);
    return { folder: folder };
  }

  /* Deleting a folder never deletes items: its children and items move up one
     level, so nothing can be lost by a mis-click. */
  function folderDelete(index, payload) {
    var folder = folderById(index, safeId(payload && payload.id));
    if (!folder) return { error: "That folder no longer exists. Refresh the library and try again." };
    var at = index.folders.indexOf(folder);
    var parentId = folder.parentId;
    var movedFolders = 0;
    var movedItems = 0;
    var i;

    for (i = 0; i < index.folders.length; i++) {
      if (index.folders[i].parentId === folder.id) {
        index.folders[i].parentId = parentId;
        index.folders[i].order = maxOrder(index, parentId) + 1;
        movedFolders++;
      }
    }
    for (i = 0; i < index.items.length; i++) {
      if (index.items[i].folderId === folder.id) {
        index.items[i].folderId = parentId;
        movedItems++;
      }
    }
    if (at >= 0) index.folders.splice(at, 1);
    refreshFolderPaths(index);
    return { movedFolders: movedFolders, movedItems: movedItems, parentId: parentId };
  }

  /* --------------------------------------------------------------- items */

  function itemById(index, id) {
    for (var i = 0; i < index.items.length; i++) {
      if (index.items[i].id === id) return index.items[i];
    }
    return null;
  }

  function itemUpdate(index, payload) {
    var item = itemById(index, safeId(payload && payload.id));
    if (!item) return { error: "That item is no longer in the library. Refresh and try again." };
    var patch = payload || {};

    if (patch.name !== undefined) {
      var name = cleanText(patch.name, MAX_NAME);
      if (!name) return { error: "An item needs a name." };
      item.name = name;
      if (!patch.assetName) item.assetName = safeFileName(name, "asset");
    }
    if (patch.category !== undefined) item.category = cleanText(patch.category, MAX_CATEGORY);
    if (patch.tags !== undefined) item.tags = cleanTags(patch.tags);
    if (patch.favorite !== undefined) item.favorite = bool(patch.favorite);
    if (patch.notes !== undefined) item.notes = cleanText(patch.notes, MAX_NOTES);
    if (patch.hostSupport !== undefined) item.hostSupport = cleanHosts(patch.hostSupport, item.type);
    if (patch.folderId !== undefined) {
      var folderId = safeId(patch.folderId);
      if (folderId && !folderById(index, folderId)) {
        return { error: "The destination folder no longer exists." };
      }
      item.folderId = folderId;
    }
    item.updatedAt = nowText();
    refreshFolderPaths(index);
    return { item: item };
  }

  function itemsMove(index, payload) {
    var ids = isArray(payload && payload.ids) ? payload.ids : [];
    var folderId = safeId(payload && payload.folderId);
    if (folderId && !folderById(index, folderId)) {
      return { error: "The destination folder no longer exists." };
    }
    var moved = [];
    var missing = [];
    for (var i = 0; i < ids.length; i++) {
      var item = itemById(index, safeId(ids[i]));
      if (!item) {
        missing.push(str(ids[i]));
        continue;
      }
      item.folderId = folderId;
      item.updatedAt = nowText();
      moved.push(item.id);
    }
    refreshFolderPaths(index);
    if (!moved.length) return { error: "None of those items are in the library any more." };
    return { moved: moved, missing: missing, folderId: folderId };
  }

  function itemsDelete(index, payload) {
    var ids = isArray(payload && payload.ids) ? payload.ids : [];
    var removed = [];
    var missing = [];
    for (var i = 0; i < ids.length; i++) {
      var id = safeId(ids[i]);
      var item = id ? itemById(index, id) : null;
      if (!item) {
        missing.push(str(ids[i]));
        continue;
      }
      removed.push(item);
      index.items.splice(index.items.indexOf(item), 1);
    }
    if (!removed.length) return { error: "None of those items are in the library any more." };
    return { removed: removed, missing: missing };
  }

  function touchItem(index, id, when) {
    var item = itemById(index, safeId(id));
    if (!item) return { error: "That item is no longer in the library." };
    item.usageCount += 1;
    item.lastUsed = str(when) || nowText();
    item.updatedAt = item.lastUsed;
    return { item: item };
  }

  /* ------------------------------------------------------- search + sort */

  function itemText(item) {
    return [
      item.name,
      item.category,
      item.tags.join(" "),
      item.notes,
      item.author,
      TYPE_LABEL[item.type] || item.type
    ].join(" ").toLowerCase();
  }

  function matchesCollection(item, collection) {
    if (!collection || collection === "all") return true;
    if (collection === "favorites") return item.favorite;
    if (collection === "recent") return item.lastUsed !== "";
    if (collection === "most-used") return item.usageCount > 0;
    if (collection === "untagged") return item.tags.length === 0;
    if (collection === "text") return COLLECTION_WORDS.text.test(itemText(item));
    if (collection === "transitions") return COLLECTION_WORDS.transitions.test(itemText(item));
    if (collection === "shapes") return COLLECTION_WORDS.shapes.test(itemText(item));
    return true;
  }

  function compareText(a, b) {
    var left = a.toLowerCase();
    var right = b.toLowerCase();
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  function query(index, options) {
    var opts = options || {};
    var search = cleanText(opts.search, 120).toLowerCase();
    var tokens = search ? search.split(" ").filter(function (t) { return t !== ""; }) : [];
    var folderId = opts.folderId === null || opts.folderId === undefined ? "" : safeId(opts.folderId);
    var includeSub = opts.includeSubfolders !== false;
    var allowed = null;
    var out = [];
    var i;

    if (folderId) {
      allowed = includeSub ? descendantIds(index, folderId) : [folderId];
    }

    for (i = 0; i < index.items.length; i++) {
      var item = index.items[i];
      if (opts.type && opts.type !== "all" && item.type !== opts.type) continue;
      if (opts.host && opts.host !== "all" && item.hostSupport.indexOf(opts.host) < 0) continue;
      if (opts.category && opts.category !== "all" && item.category !== opts.category) continue;
      if (allowed && allowed.indexOf(item.folderId) < 0) continue;
      if (!matchesCollection(item, opts.collection)) continue;
      if (tokens.length) {
        var haystack = itemText(item);
        var ok = true;
        for (var t = 0; t < tokens.length; t++) {
          if (haystack.indexOf(tokens[t]) < 0) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      out.push(item);
    }

    var sort = opts.sort || "name";
    var recentSort = opts.collection === "recent";
    var mostUsedSort = opts.collection === "most-used";
    out.sort(function (a, b) {
      if (recentSort) return compareText(b.lastUsed, a.lastUsed);
      if (mostUsedSort) return b.usageCount - a.usageCount;
      if (sort === "date") return compareText(b.createdAt, a.createdAt);
      if (sort === "usage") {
        if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
        return compareText(a.name, b.name);
      }
      if (sort === "order") {
        if (a.order !== b.order) return a.order - b.order;
        return compareText(a.name, b.name);
      }
      return compareText(a.name, b.name);
    });

    return out;
  }

  function counts(index) {
    var byType = {};
    var byHost = { AEFT: 0, PPRO: 0 };
    var missing = 0;
    var tagged = 0;
    var i;
    for (i = 0; i < TYPES.length; i++) byType[TYPES[i]] = 0;
    var all = {
      all: index.items.length,
      favorites: 0,
      recent: 0,
      "most-used": 0,
      untagged: 0,
      text: 0,
      transitions: 0,
      shapes: 0
    };

    for (i = 0; i < index.items.length; i++) {
      var item = index.items[i];
      byType[item.type] = (byType[item.type] || 0) + 1;
      if (item.hostSupport.indexOf("AEFT") >= 0) byHost.AEFT++;
      if (item.hostSupport.indexOf("PPRO") >= 0) byHost.PPRO++;
      if (item.missingAsset) missing++;
      if (item.tags.length) tagged++;
      if (item.favorite) all.favorites++;
      if (item.lastUsed) all.recent++;
      if (item.usageCount > 0) all["most-used"]++;
      if (!item.tags.length) all.untagged++;
      if (matchesCollection(item, "text")) all.text++;
      if (matchesCollection(item, "transitions")) all.transitions++;
      if (matchesCollection(item, "shapes")) all.shapes++;
    }

    return {
      items: index.items.length,
      folders: index.folders.length,
      byType: byType,
      byHost: byHost,
      missingAssets: missing,
      tagged: tagged,
      collections: all
    };
  }

  function categories(index) {
    var out = [];
    var seen = {};
    for (var i = 0; i < index.items.length; i++) {
      var name = index.items[i].category;
      if (!name || seen[name.toLowerCase()]) continue;
      seen[name.toLowerCase()] = true;
      out.push(name);
    }
    out.sort(compareText);
    return out;
  }

  /* ------------------------------------------------------------- storage */

  function readIndex(io, root) {
    var path = root + "/library.json";
    var text = io.readText(path);
    if (text === null || text === undefined) return { exists: false, index: null, corrupt: false };
    var raw = null;
    try {
      raw = JSON.parse(text);
    } catch (eParse) {
      return { exists: true, index: null, corrupt: true };
    }
    if (!raw || typeof raw !== "object") return { exists: true, index: null, corrupt: true };
    return {
      exists: true,
      corrupt: false,
      raw: raw,
      newer: num(raw.schemaVersion, SCHEMA) > SCHEMA,
      index: normalizeIndex(raw)
    };
  }

  /* Only schema fields are ever written: a transient flag added by a caller
     (for example `missingAsset`) can never leak into library.json. */
  function saveIndex(io, root, index) {
    index.format = FORMAT;
    index.schemaVersion = SCHEMA;
    index.updatedAt = nowText();
    refreshFolderPaths(index);

    var items = [];
    var folders = [];
    var i;
    for (i = 0; i < index.items.length && items.length < MAX_ITEMS; i++) {
      var item = normalizeItem(index.items[i], index.items[i].id);
      if (item) items.push(item);
    }
    for (i = 0; i < index.folders.length && folders.length < MAX_FOLDERS; i++) {
      var folder = normalizeFolder(index.folders[i]);
      if (folder) folders.push(folder);
    }

    var ok = io.writeText(
      root + "/library.json",
      JSON.stringify(
        {
          format: FORMAT,
          schemaVersion: SCHEMA,
          updatedAt: index.updatedAt,
          migrated: index.migrated,
          folders: folders,
          items: items
        },
        null,
        2
      )
    );
    io.writeText(
      root + "/folders.json",
      JSON.stringify(
        {
          format: FOLDERS_FORMAT,
          schemaVersion: SCHEMA,
          updatedAt: index.updatedAt,
          folders: folders
        },
        null,
        2
      )
    );
    return ok;
  }

  function itemJson(item) {
    var copy = {};
    for (var key in item) {
      if (Object.prototype.hasOwnProperty.call(item, key)) copy[key] = item[key];
    }
    copy.format = ITEM_FORMAT;
    copy.schemaVersion = SCHEMA;
    return JSON.stringify(copy, null, 2);
  }

  function itemDir(root, id) {
    return root + "/items/" + id;
  }

  function writeItem(io, root, item) {
    io.mkdirp(itemDir(root, item.id));
    return io.writeText(itemDir(root, item.id) + "/item.json", itemJson(item));
  }

  /* ----------------------------------------------------------- migration */

  function ensureFolderPath(index, names) {
    var parentId = "";
    var folder = null;
    var path = isArray(names) ? names : [];
    for (var i = 0; i < path.length; i++) {
      var wanted = cleanText(path[i], MAX_FOLDER_NAME);
      if (!wanted) continue;
      folder = null;
      for (var f = 0; f < index.folders.length; f++) {
        if (index.folders[f].parentId === parentId && index.folders[f].name.toLowerCase() === wanted.toLowerCase()) {
          folder = index.folders[f];
          break;
        }
      }
      if (!folder) {
        var made = folderCreate(index, { name: wanted, parentId: parentId });
        if (made.error) return "";
        folder = made.folder;
      }
      parentId = folder.id;
    }
    return parentId;
  }

  /* Copies every Part 4 preset into the library. The old store is only read,
     never moved or deleted, so a failed migration cannot lose anything. */
  function migratePresets(io, root, legacyRoot, index, when) {
    var result = { count: 0, skipped: [], folders: 0, error: "" };
    if (!legacyRoot) return result;

    var folderNames = [];
    var foldersText = io.readText(legacyRoot + "/folders.json");
    if (foldersText) {
      try {
        var foldersRaw = JSON.parse(foldersText);
        if (foldersRaw && isArray(foldersRaw.folders)) folderNames = foldersRaw.folders;
      } catch (eFolders) {}
    }

    for (var n = 0; n < folderNames.length; n++) {
      if (ensureFolderPath(index, [folderNames[n]])) result.folders++;
    }

    var entries = io.list(legacyRoot) || [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.isDir) continue;
      if (str(entry.name).slice(-9) !== ".qkpreset") continue;

      var text = io.readText(entry.path);
      if (!text) {
        result.skipped.push(entry.name);
        continue;
      }
      var raw = null;
      try {
        raw = JSON.parse(text);
      } catch (ePreset) {
        result.skipped.push(entry.name);
        continue;
      }
      if (!raw || typeof raw !== "object" || !isArray(raw.layers)) {
        result.skipped.push(entry.name);
        continue;
      }

      var baseId = safeId(raw.id) || safeId(str(entry.name).slice(0, -9));
      if (!baseId) baseId = idFromClock("p", Date.now() + result.count);
      var id = baseId;
      var bump = 2;
      while (itemById(index, id)) {
        id = baseId + "-" + bump;
        bump++;
      }

      var folderName = cleanText(raw.folder, MAX_FOLDER_NAME);
      var folderId = folderName ? ensureFolderPath(index, [folderName]) : "";
      var name = cleanText(raw.name, MAX_NAME) || "Untitled preset";
      var item = normalizeItem(
        {
          id: id,
          name: name,
          type: "ae-preset",
          category: folderName,
          tags: [],
          favorite: bool(raw.favorite),
          hostSupport: ["AEFT"],
          createdAt: str(raw.created),
          usageCount: 0,
          lastUsed: "",
          author: "You",
          license: "",
          notes: cleanText(raw.summary, MAX_NOTES),
          folderId: folderId,
          asset: "asset.qkpreset",
          assetName: safeFileName(name + ".qkpreset", "preset.qkpreset"),
          bytes: text.length,
          order: num(raw.order, 0)
        },
        id
      );
      if (!item) {
        result.skipped.push(entry.name);
        continue;
      }

      io.mkdirp(itemDir(root, item.id));
      if (!io.writeText(itemDir(root, item.id) + "/" + item.asset, text)) {
        result.skipped.push(entry.name);
        continue;
      }
      if (!writeItem(io, root, item)) {
        result.skipped.push(entry.name);
        continue;
      }
      index.items.push(item);
      result.count++;
    }

    if (result.count || result.folders) {
      index.migrated = {
        from: "presets",
        at: str(when) || nowText(),
        count: result.count,
        skipped: result.skipped.length
      };
    }
    result.skippedCount = result.skipped.length;
    refreshFolderPaths(index);
    return result;
  }

  /* -------------------------------------------------------------- repair */

  function repair(io, root, when) {
    var index = createIndex();
    var skipped = [];
    var missing = 0;
    var entries = io.list(root + "/items") || [];

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry.isDir) continue;
      var id = safeId(entry.name);
      if (!id) {
        skipped.push(entry.name);
        continue;
      }
      var text = io.readText(entry.path + "/item.json");
      if (!text) {
        skipped.push(entry.name);
        continue;
      }
      var raw = null;
      try {
        raw = JSON.parse(text);
      } catch (eItem) {
        skipped.push(entry.name);
        continue;
      }
      var item = normalizeItem(raw, id);
      if (!item) {
        skipped.push(entry.name);
        continue;
      }
      item.id = id;
      if (!io.exists(entry.path + "/" + item.asset)) {
        item.missingAsset = true;
        missing++;
      }
      index.items.push(item);
      if (item.folderPath.length) ensureFolderPath(index, item.folderPath);
    }

    /* Empty folders survive through the mirror; item paths rebuild the rest. */
    var mirror = null;
    var mirrorText = io.readText(root + "/folders.json");
    if (mirrorText) {
      try {
        mirror = JSON.parse(mirrorText);
      } catch (eMirror) {}
    }
    if (mirror && isArray(mirror.folders)) {
      for (var m = 0; m < mirror.folders.length; m++) {
        var wanted = normalizeFolder(mirror.folders[m]);
        if (!wanted || folderById(index, wanted.id)) continue;
        if (wanted.parentId && !folderById(index, wanted.parentId)) wanted.parentId = "";
        index.folders.push(wanted);
      }
      refreshFolderPaths(index);
    }

    for (var r = 0; r < index.items.length; r++) {
      var current = index.items[r];
      if (current.folderId && !folderById(index, current.folderId)) {
        current.folderId = ensureFolderPath(index, current.folderPath);
      }
    }
    refreshFolderPaths(index);
    index.updatedAt = str(when) || nowText();
    saveIndex(io, root, index);
    return { index: index, skipped: skipped, missingAssets: missing };
  }

  /* Load or create the store, migrating the old presets exactly once. */
  function ensureStore(io, root, legacyRoot) {
    io.mkdirp(root);
    io.mkdirp(root + "/items");

    var loaded = readIndex(io, root);
    var created = false;
    var repaired = false;
    var skipped = [];
    var index;

    if (loaded.corrupt) {
      var fixed = repair(io, root);
      index = fixed.index;
      repaired = true;
      skipped = fixed.skipped;
    } else if (loaded.index) {
      index = loaded.index;
    } else {
      index = createIndex();
      created = true;
    }

    var migrated = null;
    if (created) {
      migrated = migratePresets(io, root, legacyRoot, index, nowText());
      skipped = skipped.concat(migrated.skipped);
    }

    if (created || migrated || repaired) saveIndex(io, root, index);
    return {
      index: index,
      created: created,
      repaired: repaired,
      migrated: migrated,
      newer: !!loaded.newer,
      skipped: skipped
    };
  }

  /* ---------------------------------------------------------------- packs */

  function packManifest(index, ids, name, when) {
    var wanted = {};
    var items = [];
    var folders = {};
    var i;
    for (i = 0; i < ids.length; i++) wanted[safeId(ids[i])] = true;
    for (i = 0; i < index.items.length; i++) {
      var item = index.items[i];
      if (!wanted[item.id]) continue;
      items.push({
        id: item.id,
        type: item.type,
        name: item.name,
        folderId: item.folderId,
        folderPath: item.folderPath,
        path: "items/" + item.id
      });
      if (item.folderId) folders[item.folderId] = true;
    }

    var folderList = [];
    for (i = 0; i < index.folders.length; i++) {
      var folder = index.folders[i];
      if (!folders[folder.id]) continue;
      folderList.push({ id: folder.id, name: folder.name, parentId: folder.parentId });
    }

    return {
      format: PACK_FORMAT,
      schemaVersion: SCHEMA,
      name: cleanText(name, MAX_NAME) || "QuickKit pack",
      createdAt: str(when) || nowText(),
      itemCount: items.length,
      folders: folderList,
      items: items
    };
  }

  function sameItem(existing, incoming) {
    if (existing.id === incoming.id) return true;
    return (
      existing.type === incoming.type &&
      existing.name.toLowerCase() === incoming.name.toLowerCase()
    );
  }

  function planImport(index, incoming, mode) {
    var decisions = [];
    var takenNames = {};
    var takenIds = {};
    var i;
    for (i = 0; i < index.items.length; i++) {
      takenNames[index.items[i].name.toLowerCase()] = true;
      takenIds[index.items[i].id] = true;
    }

    for (i = 0; i < incoming.length; i++) {
      var item = incoming[i];
      var existing = null;
      for (var e = 0; e < index.items.length; e++) {
        if (sameItem(index.items[e], item)) {
          existing = index.items[e];
          break;
        }
      }
      if (!existing) {
        decisions.push({ action: "add", item: item });
        takenNames[item.name.toLowerCase()] = true;
        takenIds[item.id] = true;
        continue;
      }
      if (mode === "skip") {
        decisions.push({ action: "skip", item: item, existing: existing });
        continue;
      }
      if (mode === "replace") {
        decisions.push({ action: "replace", item: item, existing: existing });
        continue;
      }

      var named = uniqueName(takenNames, item.name, 2);
      var id = item.id;
      var bump = 2;
      while (takenIds[id]) {
        id = item.id + "-" + bump;
        bump++;
      }
      takenNames[named.toLowerCase()] = true;
      takenIds[id] = true;
      var copy = {};
      for (var key in item) {
        if (Object.prototype.hasOwnProperty.call(item, key)) copy[key] = item[key];
      }
      copy.name = named;
      copy.id = id;
      decisions.push({ action: "rename", item: copy, existing: existing });
    }
    return decisions;
  }

  function applyImport(index, decisions, manifestFolders, mode) {
    var counts = { added: 0, replaced: 0, renamed: 0, skipped: 0 };
    var folderMap = {};
    var i;

    if (isArray(manifestFolders)) {
      for (i = 0; i < manifestFolders.length; i++) {
        var source = manifestFolders[i];
        if (!source || !safeId(source.id)) continue;
        var parentId = folderMap[source.parentId] !== undefined ? folderMap[source.parentId] : "";
        var target = null;
        for (var f = 0; f < index.folders.length; f++) {
          if (
            index.folders[f].parentId === parentId &&
            index.folders[f].name.toLowerCase() === cleanText(source.name, MAX_FOLDER_NAME).toLowerCase()
          ) {
            target = index.folders[f];
            break;
          }
        }
        if (!target) {
          var made = folderCreate(index, { name: source.name, parentId: parentId });
          target = made.folder || null;
        }
        if (target) folderMap[source.id] = target.id;
      }
    }

    for (i = 0; i < decisions.length; i++) {
      var decision = decisions[i];
      var item = decision.item;
      var mappedFolder = item.folderId && folderMap[item.folderId] !== undefined ? folderMap[item.folderId] : item.folderId;

      if (decision.action === "skip") {
        counts.skipped++;
        continue;
      }

      if (decision.action === "replace") {
        var live = decision.existing;
        var keepId = live.id;
        for (var key in item) {
          if (Object.prototype.hasOwnProperty.call(item, key)) live[key] = item[key];
        }
        live.id = keepId;
        live.folderId = mappedFolder || "";
        live.updatedAt = nowText();
        decision.targetId = keepId;
        counts.replaced++;
        continue;
      }

      item.folderId = mappedFolder || "";
      item.updatedAt = nowText();
      decision.targetId = item.id;
      index.items.push(item);
      if (decision.action === "rename") counts.renamed++;
      else counts.added++;
    }

    refreshFolderPaths(index);
    return counts;
  }

  return {
    SCHEMA: SCHEMA,
    FORMAT: FORMAT,
    ITEM_FORMAT: ITEM_FORMAT,
    FOLDERS_FORMAT: FOLDERS_FORMAT,
    PACK_FORMAT: PACK_FORMAT,
    TYPES: TYPES,
    TYPE_LABEL: TYPE_LABEL,
    TYPE_HOSTS: TYPE_HOSTS,
    TYPE_ASSET: TYPE_ASSET,
    COLLECTIONS: COLLECTIONS,
    HOSTS: HOSTS,
    MAX_ITEMS: MAX_ITEMS,
    MAX_FOLDERS: MAX_FOLDERS,
    MAX_TAGS: MAX_TAGS,
    nowText: nowText,
    cleanText: cleanText,
    cleanTags: cleanTags,
    safeId: safeId,
    safeFileName: safeFileName,
    normalizeItem: normalizeItem,
    normalizeFolder: normalizeFolder,
    normalizeIndex: normalizeIndex,
    createIndex: createIndex,
    folderById: folderById,
    folderPathOf: folderPathOf,
    folderCreate: folderCreate,
    folderRename: folderRename,
    folderMove: folderMove,
    folderDelete: folderDelete,
    descendantIds: descendantIds,
    refreshFolderPaths: refreshFolderPaths,
    itemById: itemById,
    itemUpdate: itemUpdate,
    itemsMove: itemsMove,
    itemsDelete: itemsDelete,
    touchItem: touchItem,
    query: query,
    counts: counts,
    categories: categories,
    matchesCollection: matchesCollection,
    readIndex: readIndex,
    saveIndex: saveIndex,
    itemJson: itemJson,
    itemDir: itemDir,
    writeItem: writeItem,
    ensureFolderPath: ensureFolderPath,
    migratePresets: migratePresets,
    repair: repair,
    ensureStore: ensureStore,
    packManifest: packManifest,
    planImport: planImport,
    applyImport: applyImport
  };
});
