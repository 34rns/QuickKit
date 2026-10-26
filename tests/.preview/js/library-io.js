/* QuickKit library store (Part 6A): real disk + zip, Node side.
 *
 * Loaded with require() from panel.js inside CEP only, and from the Node
 * tests. Never a <script> tag, so a browser preview never runs it.
 *
 * The rules live in extension/js/library-core.js (pure, dependency-free).
 * This file only touches the disk:
 *   - a small fs adapter (read/write text and buffers, list, copy, remove);
 *   - a hand-written zip writer/reader (deflateRaw + CRC32 from `zlib`), so a
 *     .qkpack needs no dependency and no network;
 *   - the public calls the panel makes. Every call re-reads library.json,
 *     applies one change and writes it straight back: one writer, no stale
 *     cache, and an external edit can never be silently overwritten by an
 *     old copy held in the panel.
 *
 * A corrupt or missing library.json is repaired from the item folders before
 * any change is applied, so a damaged index cannot throw away the library.
 */

"use strict";

var fs = require("fs");
var path = require("path");
var os = require("os");
var zlib = require("zlib");
var core = require("./library-core.js");

var MAX_INDEX_BYTES = 8 * 1024 * 1024;
var MAX_ITEM_JSON_BYTES = 512 * 1024;
var MAX_PACK_BYTES = 512 * 1024 * 1024;
var MAX_PACK_ENTRY_BYTES = 128 * 1024 * 1024;
var MAX_PACK_ENTRIES = 5000;

/* ---------------------------------------------------------------- helpers */

function toSlash(value) {
  return String(value === null || value === undefined ? "" : value).replace(/\\/g, "/");
}

function trimSlash(value) {
  return toSlash(value).replace(/\/+$/, "");
}

function joinPath() {
  var parts = [];
  for (var i = 0; i < arguments.length; i++) {
    var piece = String(arguments[i] === null || arguments[i] === undefined ? "" : arguments[i]);
    if (piece !== "") parts.push(piece);
  }
  if (!parts.length) return "";
  return path.join.apply(path, parts);
}

function appDataRoot() {
  var base = "";
  try {
    base = process.env.APPDATA || "";
  } catch (eEnv) {
    base = "";
  }
  if (!base) {
    try {
      base = path.join(os.homedir(), "AppData", "Roaming");
    } catch (eHome) {
      base = "";
    }
  }
  return base;
}

function defaultRoot() {
  var base = appDataRoot();
  if (!base) return "";
  return joinPath(base, "QuickKit", "library");
}

function defaultLegacyRoot() {
  var base = appDataRoot();
  if (!base) return "";
  return joinPath(base, "QuickKit", "presets");
}

/* A safe absolute path for a file inside the store: no traversal, no drive
   change, and always under `root`. Returns "" when the input is not safe. */
function insideRoot(root, parts) {
  var base = trimSlash(root);
  if (!base) return "";
  var out = base;
  for (var i = 0; i < parts.length; i++) {
    var piece = String(parts[i] === null || parts[i] === undefined ? "" : parts[i]);
    if (piece === "" || piece === ".") continue;
    if (piece === ".." || /[\\/]/.test(piece) || /^[A-Za-z]:/.test(piece)) return "";
    out += "/" + piece;
  }
  return out;
}

function fileUrl(fullPath) {
  var text = toSlash(fullPath);
  if (text === "") return "";
  if (text.charAt(0) !== "/") text = "/" + text;
  return "file://" + encodeURI(text).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

/* --------------------------------------------------------------- fs layer */

function exists(target) {
  try {
    return fs.existsSync(target);
  } catch (eExists) {
    return false;
  }
}

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch (eStat) {
    return false;
  }
}

function mkdirp(target) {
  var wanted = trimSlash(target);
  if (!wanted) return false;
  try {
    if (isDir(wanted)) return true;
  } catch (eDir) {
    /* fall through and try to create it */
  }
  var parent = "";
  try {
    parent = path.dirname(wanted);
  } catch (eParent) {
    parent = "";
  }
  if (parent && parent !== wanted && parent !== ".") mkdirp(parent);
  try {
    fs.mkdirSync(wanted);
    return true;
  } catch (eMake) {
    return isDir(wanted);
  }
}

function readBuffer(target, limit) {
  var size = 0;
  try {
    size = fs.statSync(target).size;
  } catch (eStat) {
    return null;
  }
  if (limit && size > limit) return null;
  try {
    return fs.readFileSync(target);
  } catch (eRead) {
    return null;
  }
}

function readText(target, limit) {
  var buffer = readBuffer(target, limit || MAX_INDEX_BYTES);
  if (!buffer) return null;
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

/* Write to a sibling temp file, then rename: a crash mid-write leaves the old
   file intact instead of a half-written index. Falls back to a direct write
   when rename is refused (file locked by a sync client). */
function writeBuffer(target, buffer) {
  mkdirp(path.dirname(target));
  var temp = target + ".qktmp";
  var wrote = false;
  try {
    fs.writeFileSync(temp, buffer);
    wrote = true;
  } catch (eTemp) {
    wrote = false;
  }
  if (wrote) {
    try {
      fs.renameSync(temp, target);
      return true;
    } catch (eRename) {
      try {
        fs.unlinkSync(temp);
      } catch (eUnlink) {}
    }
  }
  try {
    fs.writeFileSync(target, buffer);
    return true;
  } catch (eDirect) {
    return false;
  }
}

function writeText(target, text) {
  return writeBuffer(target, Buffer.from(String(text), "utf8"));
}

/* Files and folders, names only. Never throws: an unreadable folder is empty. */
function list(target) {
  var out = [];
  var names = null;
  try {
    names = fs.readdirSync(target);
  } catch (eRead) {
    return out;
  }
  for (var i = 0; i < names.length; i++) {
    var name = String(names[i]);
    var full = joinPath(target, name);
    var dir = false;
    try {
      dir = fs.statSync(full).isDirectory();
    } catch (eStat) {
      continue;
    }
    out.push({ name: name, path: toSlash(full), isDir: dir });
  }
  out.sort(function (a, b) {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
  });
  return out;
}

function copyFile(from, to) {
  var buffer = readBuffer(from, 0);
  if (!buffer) return false;
  return writeBuffer(to, buffer);
}

function removeTree(target) {
  var stat = null;
  try {
    stat = fs.lstatSync(target);
  } catch (eStat) {
    return true;
  }
  if (stat.isDirectory()) {
    var names = null;
    try {
      names = fs.readdirSync(target);
    } catch (eRead) {
      names = [];
    }
    for (var i = 0; i < names.length; i++) removeTree(joinPath(target, names[i]));
    try {
      fs.rmdirSync(target);
      return true;
    } catch (eRemove) {
      return false;
    }
  }
  try {
    fs.unlinkSync(target);
    return true;
  } catch (eUnlink) {
    return false;
  }
}

function sizeOf(target) {
  try {
    return fs.statSync(target).size;
  } catch (eStat) {
    return 0;
  }
}

/* Recursive file list with sizes, used by pack export. */
function walkFiles(target, prefix, out) {
  var found = list(target);
  for (var i = 0; i < found.length; i++) {
    var entry = found[i];
    var name = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDir) walkFiles(entry.path, name, out);
    else out.push({ name: name, path: entry.path, bytes: sizeOf(entry.path) });
  }
  return out;
}

/* The adapter library-core.js expects. */
var disk = {
  exists: exists,
  mkdirp: mkdirp,
  readText: readText,
  writeText: writeText,
  list: list
};

/* ------------------------------------------------------------------- crc */

var CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  var table = new Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(buffer) {
  var table = crcTable();
  var c = 0xffffffff;
  for (var i = 0; i < buffer.length; i++) c = table[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------- zip */

function dosTime(date) {
  return ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff;
}

function dosDate(date) {
  var year = date.getFullYear();
  if (year < 1980) year = 1980;
  return (((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
}

/* Stored or deflated, whichever is smaller. Small files are stored raw: the
   deflate header costs more than it saves. */
function writeZip(target, entries) {
  var now = new Date();
  var time = dosTime(now);
  var date = dosDate(now);
  var chunks = [];
  var central = [];
  var offset = 0;
  var i;

  for (i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var nameBuffer = Buffer.from(String(entry.name), "utf8");
    var data = entry.data;
    var crc = crc32(data);
    var method = 0;
    var stored = data;
    if (data.length > 64) {
      try {
        var deflated = zlib.deflateRawSync(data, { level: 9 });
        if (deflated.length < data.length) {
          stored = deflated;
          method = 8;
        }
      } catch (eDeflate) {
        method = 0;
        stored = data;
      }
    }

    var local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); /* bit 11: names are UTF-8 */
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuffer, stored);
    central.push({
      name: nameBuffer,
      method: method,
      crc: crc,
      stored: stored.length,
      size: data.length,
      offset: offset
    });
    offset += 30 + nameBuffer.length + stored.length;
  }

  var centralStart = offset;
  for (i = 0; i < central.length; i++) {
    var row = central[i];
    var head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(row.method, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(row.crc, 16);
    head.writeUInt32LE(row.stored, 20);
    head.writeUInt32LE(row.size, 24);
    head.writeUInt16LE(row.name.length, 28);
    head.writeUInt32LE(row.offset, 42);
    chunks.push(head, row.name);
    offset += 46 + row.name.length;
  }

  var eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  chunks.push(eocd);

  return writeBuffer(target, Buffer.concat(chunks));
}

/* A zip entry name that can only ever land inside the item folder. */
function safeZipName(name) {
  var text = toSlash(name).replace(/^\.\//, "").replace(/^\/+/, "");
  var parts = text.split("/");
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var piece = parts[i];
    if (piece === "" || piece === ".") continue;
    if (piece === ".." || /^[A-Za-z]:/.test(piece)) {
      throw new Error("That pack tries to write outside the library.");
    }
    out.push(piece);
  }
  return out.join("/");
}

function findEocd(buffer) {
  var lowest = Math.max(0, buffer.length - 66000);
  for (var i = buffer.length - 22; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/* Returns [{name, data}]. Throws a short, readable message on anything odd:
   the caller turns it into a panel message, never a stack trace. */
function readZip(buffer) {
  if (!buffer || buffer.length < 22) throw new Error("That file is too small to be a QuickKit pack.");
  var eocd = findEocd(buffer);
  if (eocd < 0) throw new Error("That file is not a QuickKit pack (no zip index found).");

  var count = buffer.readUInt16LE(eocd + 10);
  var centralSize = buffer.readUInt32LE(eocd + 12);
  var centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_PACK_ENTRIES) throw new Error("That pack holds too many files.");
  if (centralOffset + centralSize > buffer.length) throw new Error("That pack is damaged (index out of range).");

  var entries = [];
  var total = 0;
  var at = centralOffset;

  for (var i = 0; i < count; i++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014b50) {
      throw new Error("That pack is damaged (bad entry header).");
    }
    var method = buffer.readUInt16LE(at + 10);
    var crc = buffer.readUInt32LE(at + 16);
    var packedSize = buffer.readUInt32LE(at + 20);
    var plainSize = buffer.readUInt32LE(at + 24);
    var nameLength = buffer.readUInt16LE(at + 28);
    var extraLength = buffer.readUInt16LE(at + 30);
    var commentLength = buffer.readUInt16LE(at + 32);
    var localOffset = buffer.readUInt32LE(at + 42);
    var name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    if (plainSize > MAX_PACK_ENTRY_BYTES) throw new Error("That pack holds a file that is too large.");
    total += plainSize;
    if (total > MAX_PACK_BYTES) throw new Error("That pack is too large to import.");

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("That pack is damaged (missing file data).");
    }
    var localName = buffer.readUInt16LE(localOffset + 26);
    var localExtra = buffer.readUInt16LE(localOffset + 28);
    var start = localOffset + 30 + localName + localExtra;
    if (start + packedSize > buffer.length) throw new Error("That pack is damaged (truncated file data).");

    var raw = buffer.slice(start, start + packedSize);
    var data = null;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_PACK_ENTRY_BYTES });
      } catch (eInflate) {
        throw new Error("That pack is damaged (a file could not be unpacked).");
      }
    } else {
      throw new Error("That pack uses a compression QuickKit does not read.");
    }
    if (crc32(data) !== crc) throw new Error("That pack is damaged (checksum mismatch).");

    entries.push({ name: safeZipName(name), data: data });
  }

  return entries;
}

/* ------------------------------------------------------------ the store */

function create(options) {
  var opts = options || {};
  var root = trimSlash(opts.root || defaultRoot());
  var legacyRoot = trimSlash(opts.legacyRoot === undefined ? defaultLegacyRoot() : opts.legacyRoot);
  var lastLoad = null;

  function ready() {
    if (!root) {
      return { error: "QuickKit could not find your AppData folder, so the library has nowhere to live." };
    }
    return null;
  }

  function itemDirectory(id) {
    var safe = core.safeId(id);
    if (!safe) return "";
    return insideRoot(root, ["items", safe]);
  }

  /* Re-read, apply one change, write back. A failed change never writes. */
  function withIndex(change) {
    var guard = ready();
    if (guard) return { ok: false, error: guard.error };

    var loaded = core.readIndex(disk, root);
    var index = null;
    var repaired = false;
    if (loaded.corrupt) {
      index = core.repair(disk, root).index;
      repaired = true;
    } else if (!loaded.index) {
      index = core.createIndex();
    } else if (loaded.newer) {
      return {
        ok: false,
        error: "This library was saved by a newer QuickKit. Update QuickKit before changing it."
      };
    } else {
      index = loaded.index;
    }

    var result = change(index) || {};
    if (result.error) {
      result.ok = false;
      return result;
    }

    core.saveIndex(disk, root, index);
    lastLoad = index;
    result.ok = true;
    result.index = index;
    if (repaired) result.repaired = true;
    return result;
  }

  /* Missing assets are reported, never fatal: the item stays in the library. */
  function missingIds(index) {
    var out = [];
    for (var i = 0; i < index.items.length; i++) {
      var item = index.items[i];
      var dir = itemDirectory(item.id);
      var asset = dir ? insideRoot(dir, [item.asset]) : "";
      if (!asset || !exists(asset)) out.push(item.id);
    }
    return out;
  }

  /* A preview can be recorded and still be gone (cleared folder, antivirus,
     a crash mid-generate). Reported separately from a missing asset so the
     panel can say "generate it again" instead of "the item is broken". */
  function previewGoneIds(index) {
    var out = [];
    for (var i = 0; i < index.items.length; i++) {
      var item = index.items[i];
      if (!item.previewVideo && !item.previewThumb) continue;
      var dir = itemDirectory(item.id);
      if (!dir) {
        out.push(item.id);
        continue;
      }
      var video = item.previewVideo ? insideRoot(dir, [item.previewVideo]) : "";
      var thumb = item.previewThumb ? insideRoot(dir, [item.previewThumb]) : "";
      if ((video && !exists(video)) || (thumb && !exists(thumb))) out.push(item.id);
    }
    return out;
  }

  function load() {
    var guard = ready();
    if (guard) return { ok: false, error: guard.error };

    var state = core.ensureStore(disk, root, legacyRoot);
    lastLoad = state.index;
    return {
      ok: true,
      root: root,
      index: state.index,
      missing: missingIds(state.index),
      previewsGone: previewGoneIds(state.index),
      status: {
        created: state.created,
        repaired: state.repaired,
        newer: state.newer,
        migrated: state.migrated,
        skipped: state.skipped
      }
    };
  }

  function repair() {
    var guard = ready();
    if (guard) return { ok: false, error: guard.error };
    var fixed = core.repair(disk, root);
    lastLoad = fixed.index;
    return {
      ok: true,
      root: root,
      index: fixed.index,
      missing: missingIds(fixed.index),
      previewsGone: previewGoneIds(fixed.index),
      skipped: fixed.skipped,
      missingAssets: fixed.missingAssets
    };
  }

  function folderCreate(payload) {
    return withIndex(function (index) {
      return core.folderCreate(index, payload || {});
    });
  }

  function folderRename(payload) {
    return withIndex(function (index) {
      return core.folderRename(index, payload || {});
    });
  }

  function folderMove(payload) {
    return withIndex(function (index) {
      return core.folderMove(index, payload || {});
    });
  }

  function folderDelete(payload) {
    return withIndex(function (index) {
      return core.folderDelete(index, payload || {});
    });
  }

  function itemUpdate(payload) {
    return withIndex(function (index) {
      var result = core.itemUpdate(index, payload || {});
      if (result.error) return result;
      if (!core.writeItem(disk, root, result.item)) {
        return { error: "QuickKit could not write that item to disk. Check that the folder is not read-only." };
      }
      return result;
    });
  }

  function itemsMove(payload) {
    var touched = null;
    var result = withIndex(function (index) {
      var moved = core.itemsMove(index, payload || {});
      if (moved.error) return moved;
      touched = [];
      for (var i = 0; i < moved.moved.length; i++) {
        var item = core.itemById(index, moved.moved[i]);
        if (item) touched.push(item);
      }
      return moved;
    });
    if (result.ok && touched) {
      for (var i = 0; i < touched.length; i++) core.writeItem(disk, root, touched[i]);
    }
    return result;
  }

  function itemsDelete(payload) {
    var removed = null;
    var result = withIndex(function (index) {
      var gone = core.itemsDelete(index, payload || {});
      if (gone.error) return gone;
      removed = gone.removed;
      return gone;
    });
    if (result.ok && removed) {
      for (var i = 0; i < removed.length; i++) {
        var dir = itemDirectory(removed[i].id);
        if (dir) removeTree(dir);
      }
    }
    return result;
  }

  function touch(id, when) {
    var item = null;
    var result = withIndex(function (index) {
      var hit = core.touchItem(index, id, when);
      if (hit.error) return hit;
      item = hit.item;
      return hit;
    });
    if (result.ok && item) core.writeItem(disk, root, item);
    return result;
  }

  /* Adds one item from bytes or text. Used by tests today and by the 6B/6C
     "save to library" buttons next; the panel does not call it yet. */
  function itemAdd(payload) {
    var data = payload || {};
    var type = data.type;
    if (core.TYPES.indexOf(type) < 0) return { ok: false, error: "QuickKit does not know that item type." };

    var assetName = core.safeFileName(data.asset, core.TYPE_ASSET[type]);
    var text = typeof data.text === "string" ? Buffer.from(data.text, "utf8") : data.buffer;
    if (!text || !text.length) return { ok: false, error: "There is nothing to save into the library." };

    var made = null;
    var result = withIndex(function (index) {
      if (index.items.length >= core.MAX_ITEMS) {
        return { error: "The library holds up to " + core.MAX_ITEMS + " items." };
      }
      var item = core.normalizeItem(
        {
          id: core.safeId(data.id) || core.safeId("i" + Date.now() + "-" + Math.floor(Math.random() * 90000 + 10000)),
          name: data.name,
          type: type,
          category: data.category,
          tags: data.tags,
          favorite: data.favorite,
          hostSupport: data.hostSupport,
          createdAt: data.createdAt,
          notes: data.notes,
          author: data.author,
          license: data.license,
          folderId: data.folderId,
          asset: assetName,
          assetName: core.safeFileName(data.assetName, core.safeFileName(data.name, "asset")),
          bytes: text.length,
          order: data.order
        },
        ""
      );
      if (!item) return { error: "QuickKit could not build an item from that." };
      if (core.itemById(index, item.id)) return { error: "An item with that id is already in the library." };

      var dir = itemDirectory(item.id);
      if (!dir) return { error: "That item id is not safe to store." };
      disk.mkdirp(dir);
      if (!writeBuffer(insideRoot(dir, [item.asset]), text)) {
        return { error: "QuickKit could not write the asset into the library folder." };
      }
      if (!core.writeItem(disk, root, item)) {
        removeTree(dir);
        return { error: "QuickKit could not write the item file." };
      }
      index.items.push(item);
      core.refreshFolderPaths(index);
      made = item;
      return { item: item };
    });
    if (!result.ok && !result.item && made) removeTree(itemDirectory(made.id));
    return result;
  }

  /* ----------------------------------------------------------- previews */

  function previewPaths(id) {
    var dir = itemDirectory(id);
    if (!dir) return null;
    return {
      dir: dir,
      video: insideRoot(dir, [core.PREVIEW_VIDEO]),
      thumb: insideRoot(dir, [core.PREVIEW_THUMB])
    };
  }

  /* Copies the encoded files into the item folder, then records them with the
     signature of the params they were made for. Files first, index second: a
     crash in between leaves the old preview in place rather than a record
     pointing at nothing. */
  function previewsSave(payload) {
    var data = payload || {};
    var id = core.safeId(data.id);
    if (!id) return { ok: false, error: "That item is no longer in the library." };
    var paths = previewPaths(id);
    if (!paths) return { ok: false, error: "That item id is not safe to store." };

    var videoFrom = String(data.videoPath || "");
    var thumbFrom = String(data.thumbPath || "");
    if (!videoFrom && !thumbFrom) return { ok: false, error: "There is no preview file to save." };

    if (videoFrom && !exists(videoFrom)) return { ok: false, error: "The encoded video is missing." };
    if (thumbFrom && !exists(thumbFrom)) return { ok: false, error: "The encoded thumbnail is missing." };

    if (!mkdirp(paths.dir)) return { ok: false, error: "QuickKit could not create the item folder." };
    if (videoFrom && !copyFile(videoFrom, paths.video)) {
      return { ok: false, error: "QuickKit could not copy the preview video into the library." };
    }
    if (thumbFrom && !copyFile(thumbFrom, paths.thumb)) {
      return { ok: false, error: "QuickKit could not copy the preview thumbnail into the library." };
    }

    var saved = null;
    var result = withIndex(function (index) {
      var item = core.itemById(index, id);
      if (!item) return { error: "That item is no longer in the library." };
      var set = core.itemPreviewSet(index, id, {
        video: videoFrom ? core.PREVIEW_VIDEO : item.previewVideo,
        thumb: thumbFrom ? core.PREVIEW_THUMB : item.previewThumb,
        key: core.previewSignature(item)
      });
      if (set.error) return set;
      if (!core.writeItem(disk, root, set.item)) {
        return { error: "QuickKit could not write the item file. Check that the folder is not read-only." };
      }
      saved = set.item;
      return set;
    });
    if (result.ok) {
      result.item = saved;
      result.videoUrl = fileUrl(paths.video);
      result.thumbUrl = fileUrl(paths.thumb);
      result.key = saved ? saved.previewKey : "";
    }
    return result;
  }

  /* ids omitted -> every item. Files go first so a locked video cannot leave
     the index claiming a preview that is already deleted. */
  function previewsClear(payload) {
    var wanted = payload && payload.ids;
    var targets = [];
    var guard = ready();
    if (guard) return { ok: false, error: guard.error };

    if (wanted && wanted.length) {
      for (var i = 0; i < wanted.length; i++) {
        var safe = core.safeId(wanted[i]);
        if (safe) targets.push(safe);
      }
    } else {
      var current = lastLoad || core.readIndex(disk, root).index || core.createIndex();
      for (var j = 0; j < current.items.length; j++) {
        if (current.items[j].previewVideo || current.items[j].previewThumb) targets.push(current.items[j].id);
      }
    }
    if (!targets.length) return { ok: true, cleared: 0, index: lastLoad };

    var cleared = 0;
    var result = withIndex(function (index) {
      for (var k = 0; k < targets.length; k++) {
        var paths = previewPaths(targets[k]);
        if (paths) {
          if (exists(paths.video)) removeTree(paths.video);
          if (exists(paths.thumb)) removeTree(paths.thumb);
        }
        var item = core.itemById(index, targets[k]);
        if (!item) continue;
        if (!item.previewVideo && !item.previewThumb) continue;
        core.itemPreviewClear(index, targets[k]);
        core.writeItem(disk, root, item);
        cleared++;
      }
      return {};
    });
    result.cleared = cleared;
    return result;
  }

  /* What the settings row shows: how many previews exist, how many are stale,
     and how much disk they take. Cheap enough to call on every load. */
  function previewsInfo() {
    var guard = ready();
    if (guard) return { ok: false, error: guard.error };
    var index = lastLoad || core.readIndex(disk, root).index || core.createIndex();
    var info = { ok: true, total: index.items.length, ready: 0, stale: 0, none: 0, bytes: 0, clearable: 0 };
    for (var i = 0; i < index.items.length; i++) {
      var item = index.items[i];
      var state = core.previewState(item);
      if (state === "ready") info.ready++;
      else if (state === "stale") info.stale++;
      else info.none++;
      if (!item.previewVideo && !item.previewThumb) continue;
      info.clearable++;
      var paths = previewPaths(item.id);
      if (!paths) continue;
      info.bytes += sizeOf(paths.video) + sizeOf(paths.thumb);
    }
    return info;
  }

  /* ---------------------------------------------------------------- packs */

  function defaultPackName(index, ids) {
    var wanted = {};
    var i;
    for (i = 0; i < ids.length; i++) wanted[core.safeId(ids[i])] = true;
    var folders = {};
    for (i = 0; i < index.items.length; i++) {
      var item = index.items[i];
      if (wanted[item.id] && item.folderId) folders[item.folderId] = true;
    }
    var keys = [];
    for (var key in folders) {
      if (Object.prototype.hasOwnProperty.call(folders, key)) keys.push(key);
    }
    if (keys.length === 1) {
      var folder = core.folderById(index, keys[0]);
      if (folder) return folder.name;
    }
    return "QuickKit pack";
  }

  /* ids: item ids (a folder export is computed by the panel with the same
     query it shows on screen, so the pack matches exactly what was seen). */
  function exportPack(payload) {
    var guard = ready();
    if (guard) return { ok: false, error: guard.error };

    var data = payload || {};
    var ids = [];
    if (Object.prototype.toString.call(data.ids) === "[object Array]") ids = data.ids;
    if (!ids.length) return { ok: false, error: "Select at least one item to export." };

    var loaded = core.readIndex(disk, root);
    if (!loaded.index) return { ok: false, error: "The library index is missing. Press Repair library, then try again." };
    var index = loaded.index;

    var wanted = {};
    var i;
    for (i = 0; i < ids.length; i++) wanted[core.safeId(ids[i])] = true;

    var real = [];
    for (i = 0; i < index.items.length; i++) {
      if (wanted[index.items[i].id]) real.push(index.items[i]);
    }
    if (!real.length) return { ok: false, error: "None of those items are in the library any more." };

    var name = core.cleanText(data.name, 80) || defaultPackName(index, ids);
    var target = String(data.target || "").trim();
    if (!target) return { ok: false, error: "Choose where to save the pack first." };
    if (!/\.qkpack$/i.test(target)) target += ".qkpack";

    var manifest = core.packManifest(
      index,
      real.map(function (item) {
        return item.id;
      }),
      name
    );

    var entries = [
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") }
    ];
    var skipped = [];

    for (i = 0; i < real.length; i++) {
      var item = real[i];
      var dir = itemDirectory(item.id);
      if (!dir || !exists(dir)) {
        skipped.push(item.name);
        continue;
      }
      var files = walkFiles(dir, "items/" + item.id, []);
      for (var f = 0; f < files.length; f++) {
        var buffer = readBuffer(files[f].path, MAX_PACK_ENTRY_BYTES);
        if (!buffer) {
          skipped.push(item.name);
          continue;
        }
        /* item.json is regenerated on import from the normalised record. */
        if (files[f].name.slice(-10) === "/item.json") continue;
        entries.push({ name: files[f].name, data: buffer });
      }
    }

    if (entries.length < 2) {
      return { ok: false, error: "Those items have no files on disk to export. Press Repair library, then try again." };
    }

    mkdirp(path.dirname(target));
    if (!writeZip(target, entries)) {
      return { ok: false, error: "QuickKit could not write the pack. Check the destination folder." };
    }

    return {
      ok: true,
      path: target,
      name: name,
      count: real.length,
      skipped: skipped,
      bytes: sizeOf(target)
    };
  }

  /* Reads a pack and reports what is inside, without touching the library. */
  function inspectPack(file) {
    var guard = ready();
    if (guard) return { ok: false, error: guard.error };
    var target = String(file || "").trim();
    if (!target) return { ok: false, error: "Choose a .qkpack file first." };

    var buffer = readBuffer(target, MAX_PACK_BYTES);
    if (!buffer) return { ok: false, error: "QuickKit could not read that file." };

    var entries = null;
    try {
      entries = readZip(buffer);
    } catch (eZip) {
      return { ok: false, error: eZip && eZip.message ? eZip.message : "That pack could not be read." };
    }

    var manifest = null;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].name !== "manifest.json") continue;
      try {
        manifest = JSON.parse(entries[i].data.toString("utf8"));
      } catch (eManifest) {
        return { ok: false, error: "That pack's manifest is damaged." };
      }
      break;
    }
    if (!manifest || manifest.format !== core.PACK_FORMAT) {
      return { ok: false, error: "That file is not a QuickKit pack." };
    }
    if (Number(manifest.schemaVersion || 1) > core.SCHEMA) {
      return { ok: false, error: "That pack was made by a newer QuickKit. Update QuickKit and try again." };
    }
    var items = Object.prototype.toString.call(manifest.items) === "[object Array]" ? manifest.items : [];

    return {
      ok: true,
      path: target,
      name: core.cleanText(manifest.name, 80) || "QuickKit pack",
      createdAt: String(manifest.createdAt || ""),
      count: items.length,
      names: items.slice(0, 40).map(function (entry) {
        return core.cleanText(entry && entry.name, 80);
      })
    };
  }

  function entryMap(entries, dirName) {
    var prefix = "items/" + dirName + "/";
    var out = {};
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i].name;
      if (name.indexOf(prefix) !== 0) continue;
      var rest = name.slice(prefix.length);
      if (!rest || rest.indexOf("/") >= 0) continue;
      out[rest] = entries[i].data;
    }
    return out;
  }

  /* mode: "skip" | "replace" | "both" */
  function importPack(payload) {
    var guard = ready();
    if (guard) return { ok: false, error: guard.error };
    var data = payload || {};
    var target = String(data.file || "").trim();
    var mode = data.mode === "replace" || data.mode === "both" ? data.mode : data.mode === "skip" ? "skip" : "";
    if (!target) return { ok: false, error: "Choose a .qkpack file first." };
    if (!mode) return { ok: false, error: "Choose what to do when an item is already in the library." };

    var buffer = readBuffer(target, MAX_PACK_BYTES);
    if (!buffer) return { ok: false, error: "QuickKit could not read that file." };

    var entries = null;
    try {
      entries = readZip(buffer);
    } catch (eZip) {
      return { ok: false, error: eZip && eZip.message ? eZip.message : "That pack could not be read." };
    }

    var manifest = null;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].name !== "manifest.json") continue;
      try {
        manifest = JSON.parse(entries[i].data.toString("utf8"));
      } catch (eManifest) {
        return { ok: false, error: "That pack's manifest is damaged." };
      }
      break;
    }
    if (!manifest || manifest.format !== core.PACK_FORMAT) {
      return { ok: false, error: "That file is not a QuickKit pack." };
    }
    if (Number(manifest.schemaVersion || 1) > core.SCHEMA) {
      return { ok: false, error: "That pack was made by a newer QuickKit. Update QuickKit and try again." };
    }

    var listed = Object.prototype.toString.call(manifest.items) === "[object Array]" ? manifest.items : [];
    var incoming = [];
    var unreadable = [];
    var files = {};

    for (i = 0; i < listed.length; i++) {
      var entry = listed[i] || {};
      var id = core.safeId(entry.id);
      if (!id) {
        unreadable.push(core.cleanText(entry.name, 80) || "unnamed item");
        continue;
      }
      var dirEntries = entryMap(entries, id);
      var jsonBuffer = dirEntries["item.json"];
      var item = null;
      if (jsonBuffer) {
        try {
          item = core.normalizeItem(JSON.parse(jsonBuffer.toString("utf8")), id);
        } catch (eItem) {
          item = null;
        }
      }
      if (!item) {
        item = core.normalizeItem(
          {
            id: id,
            name: entry.name,
            type: entry.type,
            hostSupport: entry.hostSupport,
            asset: entry.asset,
            folderId: entry.folderId,
            folderPath: entry.folderPath
          },
          id
        );
      }
      if (!item) {
        unreadable.push(core.cleanText(entry.name, 80) || "unnamed item");
        continue;
      }
      item.id = id;
      files[id] = dirEntries;
      incoming.push(item);
    }

    if (!incoming.length) {
      return { ok: false, error: "That pack holds no items QuickKit can read." };
    }

    var counts = null;
    var applied = [];
    var result = withIndex(function (index) {
      var decisions = core.planImport(index, incoming, mode);
      counts = core.applyImport(index, decisions, manifest.folders, mode);
      applied = decisions;
      return {};
    });
    if (!result.ok) return result;

    /* Write files only after the index change succeeded. A failed copy marks
       the item missing; it never half-overwrites the old one silently. */
    var wrote = 0;
    var failed = [];
    for (i = 0; i < applied.length; i++) {
      var decision = applied[i];
      if (decision.action === "skip" || !decision.targetId) continue;
      var live = core.itemById(result.index, decision.targetId);
      if (!live) continue;

      var dir = itemDirectory(live.id);
      if (!dir) continue;
      disk.mkdirp(dir);
      var source = files[decision.item.id] || {};
      var okFiles = true;
      for (var fileName in source) {
        if (!Object.prototype.hasOwnProperty.call(source, fileName)) continue;
        if (fileName === "item.json") continue;
        var safe = core.safeFileName(fileName, "");
        if (!safe) continue;
        if (!writeBuffer(insideRoot(dir, [safe]), source[fileName])) okFiles = false;
      }
      if (!core.writeItem(disk, root, live)) okFiles = false;
      if (okFiles) wrote++;
      else failed.push(live.name);
    }

    core.saveIndex(disk, root, result.index);
    lastLoad = result.index;

    return {
      ok: true,
      index: result.index,
      missing: missingIds(result.index),
      counts: counts,
      mode: mode,
      wrote: wrote,
      failed: failed,
      unreadable: unreadable,
      pack: core.cleanText(manifest.name, 80) || "QuickKit pack",
      message:
        "Added " +
        counts.added +
        ", replaced " +
        counts.replaced +
        ", kept both " +
        counts.renamed +
        ", skipped " +
        counts.skipped +
        "."
    };
  }

  return {
    root: root,
    legacyRoot: legacyRoot,
    load: load,
    repair: repair,
    folderCreate: folderCreate,
    folderRename: folderRename,
    folderMove: folderMove,
    folderDelete: folderDelete,
    itemAdd: itemAdd,
    itemUpdate: itemUpdate,
    itemsMove: itemsMove,
    itemsDelete: itemsDelete,
    touch: touch,
    exportPack: exportPack,
    inspectPack: inspectPack,
    importPack: importPack,
    itemDirectory: itemDirectory,
    itemFileUrl: function (id, fileName) {
      var dir = itemDirectory(id);
      if (!dir) return "";
      var safe = core.safeFileName(fileName, "");
      if (!safe) return "";
      return fileUrl(insideRoot(dir, [safe]));
    },
    itemAssetUrl: function (id) {
      var item = lastLoad ? core.itemById(lastLoad, core.safeId(id)) : null;
      if (!item) return "";
      return fileUrl(insideRoot(itemDirectory(id), [item.asset]));
    },
    /* Native path, for the host app (ExtendScript File takes "/" on Windows). */
    itemAssetPath: function (id) {
      var item = lastLoad ? core.itemById(lastLoad, core.safeId(id)) : null;
      if (!item) return "";
      return insideRoot(itemDirectory(id), [item.asset]);
    },
    previewsSave: previewsSave,
    previewsClear: previewsClear,
    previewsInfo: previewsInfo,
    rootUrl: function () {
      return fileUrl(root);
    },
    lastIndex: function () {
      return lastLoad;
    },
    defaultRoot: defaultRoot,
    defaultLegacyRoot: defaultLegacyRoot
  };
}

module.exports = {
  create: create,
  defaultRoot: defaultRoot,
  defaultLegacyRoot: defaultLegacyRoot,
  disk: disk,
  fileUrl: fileUrl,
  /* `zip` is exported for the tests: they unpack a pack with PowerShell. */
  zip: { write: writeZip, read: readZip, crc32: crc32 }
};
