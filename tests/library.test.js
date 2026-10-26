#!/usr/bin/env node
/* QuickKit library tests (Part 6A).
 *
 * Two layers, both real:
 *   1. extension/js/library-core.js on plain objects: records, folders,
 *      search/filter/sort, collections, import planning.
 *   2. extension/js/library-io.js on a real temp folder: schema files,
 *      migration of the Part 4 presets, item/folder changes on disk, repair
 *      after a corrupt index, and a .qkpack round trip through a real zip
 *      (the pack is also unpacked by PowerShell Expand-Archive to prove it is
 *      a zip other tools can read).
 *
 * No Adobe app is involved, so anything that needs CEP, After Effects or
 * Premiere is NOT tested here and stays UNTESTED in the checklist.
 *
 * Run: node tests/library.test.js */

"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var cp = require("child_process");

var ROOT = path.resolve(__dirname, "..");
var core = require(path.join(ROOT, "extension/js/library-core.js"));
var libio = require(path.join(ROOT, "extension/js/library-io.js"));

var passed = 0;
var failed = 0;
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

function has(list, value, label) {
  assert(list.indexOf(value) >= 0, label + ": expected to find " + JSON.stringify(value));
}

function lacks(list, value, label) {
  assert(list.indexOf(value) < 0, label + ": expected NOT to find " + JSON.stringify(value));
}

var tempDirs = [];

function tempDir(tag) {
  var dir = path.join(
    os.tmpdir(),
    "qk-lib-" + (tag || "t") + "-" + Date.now() + "-" + Math.floor(Math.random() * 100000)
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

/* A Part 4 preset store, exactly the shape the host writes. */
function legacyPreset(id, name, folder, layers) {
  return {
    format: "quickkit-preset",
    version: 1,
    id: id,
    name: name,
    folder: folder || "",
    favorite: false,
    order: 0,
    created: "2026-10-01 10:00:00",
    summary: "saved look",
    thumbnail: "",
    layers: layers || [{ name: "Layer", props: [] }]
  };
}

function seedLegacy(dir) {
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "folders.json"), {
    format: "quickkit-preset-folders",
    version: 1,
    folders: ["Titles", "Transitions"]
  });
  fs.writeFileSync(
    path.join(dir, "p100-1-500.qkpreset"),
    JSON.stringify(legacyPreset("p100-1-500", "Glow title", "Titles")),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "p100-2-600.qkpreset"),
    JSON.stringify(legacyPreset("p100-2-600", "Slide wipe", "Transitions")),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "p100-3-700.qkpreset"),
    JSON.stringify(legacyPreset("p100-3-700", "Plain zoom", "")),
    "utf8"
  );
  /* One damaged file: it must be skipped, never crash the migration. */
  fs.writeFileSync(path.join(dir, "p100-4-800.qkpreset"), "{not json", "utf8");
}

/* ------------------------------------------------------------------ core */

test("normalizeItem fills defaults and cleans its fields", function () {
  var item = core.normalizeItem({
    id: "abc-1",
    name: "  My   Preset  ",
    type: "MOGRT",
    tags: "Logo, logo, #intro",
    hostSupport: ["ppro", "XX"]
  });

  equal(item.id, "abc-1", "id kept");
  equal(item.name, "My Preset", "name collapsed");
  equal(item.type, "mogrt", "type lowercased");
  equal(item.tags.join(","), "logo,intro", "tags deduped and unhashed");
  equal(item.hostSupport.join(","), "PPRO", "hosts filtered");
  equal(item.author, "You", "author default");
  equal(item.usageCount, 0, "usage default");
  assert(item.createdAt.length >= 19, "createdAt stamped");
});

test("normalizeItem rejects unsafe ids and falls back to the type hosts", function () {
  equal(core.normalizeItem({ id: "../evil" }), null, "traversal id rejected");
  var item = core.normalizeItem({ id: "ok_1", type: "pr-recipe" });
  equal(item.hostSupport.join(","), "PPRO", "pr-recipe defaults to Premiere");
  assert(item.name.indexOf("Untitled") === 0, "unnamed item gets a label");
});

test("normalizeIndex drops duplicates, orphan parents and cycles", function () {
  var index = core.normalizeIndex({
    schemaVersion: 1,
    folders: [
      { id: "f1", name: "A", parentId: "f2" },
      { id: "f2", name: "B", parentId: "f1" },
      { id: "f1", name: "A again", parentId: "" },
      { id: "f3", name: "Orphan", parentId: "gone" }
    ],
    items: [
      { id: "i1", name: "One", folderId: "f1" },
      { id: "i1", name: "One again", folderId: "f1" },
      { id: "../bad", name: "Bad" }
    ]
  });

  equal(index.folders.length, 3, "duplicate folder id dropped");
  equal(index.items.length, 1, "duplicate item id dropped");
  equal(core.folderById(index, "f3").parentId, "", "orphan parent cleared");
  var first = core.folderById(index, "f1");
  assert(first.parentId === "" || first.parentId === "f2", "cycle broken at a safe link");
  var guard = 0;
  var cursor = first;
  while (cursor && cursor.parentId && guard < 10) {
    cursor = core.folderById(index, cursor.parentId);
    guard++;
  }
  assert(guard < 10, "parent chain terminates");
});

test("folders: create, rename, duplicate guard, delete keeps items", function () {
  var index = core.createIndex();
  var a = core.folderCreate(index, { name: "Looks" }, { id: "fa", seed: 1 });
  assert(!a.error, "folder created");
  var b = core.folderCreate(index, { name: "Titles", parentId: "fa" }, { id: "fb", seed: 2 });
  assert(!b.error, "nested folder created");
  equal(core.folderPathOf(index, "fb").join("/"), "Looks/Titles", "path is nested");

  assert(!!core.folderCreate(index, { name: "Titles", parentId: "fa" }, { id: "fc" }).error, "duplicate sibling refused");
  assert(!!core.folderCreate(index, { name: "Loose", parentId: "nope" }).error, "unknown parent refused");
  assert(!!core.folderCreate(index, { name: "   " }).error, "empty name refused");

  assert(!core.folderRename(index, { id: "fb", name: "Type" }).error, "renamed");
  equal(core.folderById(index, "fb").name, "Type", "new name stored");
  core.folderCreate(index, { name: "Other", parentId: "fa" }, { id: "fo", seed: 4 });
  assert(!!core.folderRename(index, { id: "fb", name: "Other" }).error, "rename to a sibling name refused");

  var deep = core.folderCreate(index, { name: "Inside", parentId: "fb" }, { id: "fd", seed: 3 });
  assert(!deep.error, "third level created");
  assert(!!core.folderMove(index, { id: "fa", parentId: "fd" }).error, "folder cannot move inside itself");

  index.items.push(core.normalizeItem({ id: "i1", name: "Item", folderId: "fb" }));
  var gone = core.folderDelete(index, { id: "fb" });
  assert(!gone.error, "folder deleted");
  equal(core.folderById(index, "fb"), null, "folder gone");
  equal(core.itemById(index, "i1").folderId, "fa", "item moved up one level, not deleted");
  equal(core.folderById(index, "fd").parentId, "fa", "child folder moved up one level");
});

test("query: search, filters, collections and sort", function () {
  var index = core.createIndex();
  var folder = core.folderCreate(index, { name: "Reels" }, { id: "f1", seed: 1 }).folder;
  index.items.push(
    core.normalizeItem({
      id: "i1",
      name: "Glow title",
      type: "ae-preset",
      category: "Titles",
      tags: ["intro"],
      favorite: true,
      createdAt: "2026-10-01 10:00:00",
      usageCount: 5,
      lastUsed: "2026-10-20 10:00:00",
      folderId: folder.id
    }),
    core.normalizeItem({
      id: "i2",
      name: "Slide wipe",
      type: "mogrt",
      category: "Transitions",
      tags: ["wipe", "intro"],
      createdAt: "2026-10-05 10:00:00",
      usageCount: 0
    }),
    core.normalizeItem({
      id: "i3",
      name: "Circle burst",
      type: "pr-recipe",
      category: "Shapes",
      tags: [],
      createdAt: "2026-10-03 10:00:00",
      usageCount: 2
    })
  );

  function ids(list) {
    return list
      .map(function (item) {
        return item.id;
      })
      .join(",");
  }

  equal(ids(core.query(index, {})), "i3,i1,i2", "name sort by default");
  equal(ids(core.query(index, { search: "intro" })), "i1,i2", "tag search");
  equal(ids(core.query(index, { search: "glow intro" })), "i1", "every token must match");
  equal(ids(core.query(index, { type: "mogrt" })), "i2", "type filter");
  equal(ids(core.query(index, { host: "AEFT" })), "i1", "host filter");
  equal(ids(core.query(index, { category: "Shapes" })), "i3", "category filter");
  equal(ids(core.query(index, { collection: "favorites" })), "i1", "favorites collection");
  equal(ids(core.query(index, { collection: "untagged" })), "i3", "untagged collection");
  equal(ids(core.query(index, { collection: "text" })), "i1", "text collection");
  equal(ids(core.query(index, { collection: "transitions" })), "i2", "transitions collection");
  equal(ids(core.query(index, { collection: "shapes" })), "i3", "shapes collection");
  equal(ids(core.query(index, { folderId: "f1" })), "i1", "folder scope");
  equal(ids(core.query(index, { folderId: "f1", includeSubfolders: false })), "i1", "direct folder scope");
  equal(ids(core.query(index, { sort: "date" })), "i2,i3,i1", "date sort, newest first");
  equal(ids(core.query(index, { sort: "usage" })), "i1,i3,i2", "usage sort");
  equal(ids(core.query(index, { search: "nothing-here" })), "", "no false matches");

  var counts = core.counts(index);
  equal(counts.items, 3, "item count");
  equal(counts.folders, 1, "folder count");
  equal(counts.byType["ae-preset"], 1, "type count");
  equal(counts.collections.favorites, 1, "favorite count");
  equal(counts.collections.untagged, 1, "untagged count");
});

test("ensureFolderPath reuses an existing chain instead of duplicating it", function () {
  var index = core.createIndex();
  var first = core.ensureFolderPath(index, ["A", "B", "C"]);
  var second = core.ensureFolderPath(index, ["A", "B", "C"]);
  equal(first, second, "same folder id");
  equal(index.folders.length, 3, "only one chain created");
  equal(core.folderPathOf(index, first).join("/"), "A/B/C", "path rebuilt");
  equal(core.ensureFolderPath(index, []), "", "empty path is the root");
});

test("planImport: skip, replace and keep both", function () {
  var index = core.createIndex();
  index.items.push(core.normalizeItem({ id: "i1", name: "Glow", type: "ae-preset" }));

  var sameId = core.normalizeItem({ id: "i1", name: "Renamed in pack", type: "ae-preset" });
  var sameName = core.normalizeItem({ id: "i9", name: "glow", type: "ae-preset" });
  var fresh = core.normalizeItem({ id: "i10", name: "Brand new", type: "mogrt" });

  var skip = core.planImport(index, [sameId, sameName, fresh], "skip");
  equal(skip[0].action, "skip", "same id skipped");
  equal(skip[1].action, "skip", "same name skipped");
  equal(skip[2].action, "add", "new item added");

  var replace = core.planImport(index, [sameId, sameName], "replace");
  equal(replace[0].action, "replace", "same id replaced");
  equal(replace[1].action, "replace", "same name replaced");

  var both = core.planImport(index, [sameId, sameName], "both");
  equal(both[0].action, "rename", "same id kept both");
  equal(both[0].item.id === "i1", false, "kept copy gets a new id");
  equal(both[0].item.name, "Renamed in pack (2)", "kept copy gets a numbered name");
  equal(both[1].item.name, "glow (2)", "second kept copy counted");
});

test("applyImport maps pack folders and reports counts", function () {
  var index = core.createIndex();
  var existing = core.folderCreate(index, { name: "Takes" }, { id: "local-takes", seed: 1 }).folder;
  index.items.push(core.normalizeItem({ id: "i1", name: "Glow", type: "ae-preset", folderId: existing.id }));

  var incoming = core.normalizeItem({ id: "i2", name: "New", type: "ae-preset", folderId: "pack-folder" });
  var decisions = core.planImport(index, [incoming], "replace");
  var counts = core.applyImport(
    index,
    decisions,
    [{ id: "pack-folder", name: "Takes", parentId: "" }],
    "replace"
  );

  equal(counts.added, 1, "one added");
  var added = core.itemById(index, "i2");
  equal(added.folderId, "local-takes", "pack folder matched by name, not duplicated");
  equal(index.folders.length, 1, "no second Takes folder");
});

/* -------------------------------------------------------------------- io */

test("load creates the store files once and never loses them", function () {
  var dir = tempDir("fresh");
  var legacy = tempDir("legacy-empty");
  var api = libio.create({ root: dir, legacyRoot: legacy });

  var first = api.load();
  assert(first.ok, "load ok");
  equal(first.index.items.length, 0, "empty library");
  assert(fs.existsSync(path.join(dir, "library.json")), "library.json written");
  assert(fs.existsSync(path.join(dir, "folders.json")), "folders.json written");
  assert(fs.existsSync(path.join(dir, "items")), "items folder created");
  var stat = fs.statSync(path.join(dir, "library.json")).mtimeMs;

  var second = api.load();
  equal(second.status.created, false, "second load does not recreate the index");
  equal(fs.statSync(path.join(dir, "library.json")).mtimeMs, stat, "index untouched on a clean load");
});

test("migration imports every Part 4 preset and leaves the old store alone", function () {
  var dir = tempDir("migrate");
  var legacy = tempDir("legacy");
  seedLegacy(legacy);

  var api = libio.create({ root: dir, legacyRoot: legacy });
  var loaded = api.load();
  assert(loaded.ok, "load ok");
  assert(!!loaded.status.migrated, "migration recorded");
  equal(loaded.index.items.length, 3, "three valid presets imported");
  equal(loaded.status.migrated.count, 3, "migration count");
  equal(loaded.status.migrated.skippedCount, 1, "damaged preset skipped");

  var ids = loaded.index.items
    .map(function (item) {
      return item.id;
    })
    .sort();
  equal(ids.join(","), "p100-1-500,p100-2-600,p100-3-700", "preset ids kept for qkPresetApply");

  var glow = core.itemById(loaded.index, "p100-1-500");
  equal(glow.type, "ae-preset", "type is ae-preset");
  equal(glow.name, "Glow title", "name kept");
  equal(glow.category, "Titles", "legacy folder became the category");
  equal(glow.folderPath.join("/"), "Titles", "legacy folder became a real folder");
  equal(glow.hostSupport.join(","), "AEFT", "available in After Effects");

  var assetFile = path.join(dir, "items", "p100-1-500", glow.asset);
  assert(fs.existsSync(assetFile), "asset copied into the item folder");
  equal(
    fs.readFileSync(assetFile, "utf8"),
    fs.readFileSync(path.join(legacy, "p100-1-500.qkpreset"), "utf8"),
    "asset is byte-identical"
  );
  assert(fs.existsSync(path.join(legacy, "p100-1-500.qkpreset")), "old preset file still there");
  assert(fs.existsSync(path.join(legacy, "p100-4-800.qkpreset")), "damaged preset still there");

  var itemJson = readJson(path.join(dir, "items", "p100-1-500", "item.json"));
  equal(itemJson.format, "quickkit-library-item", "item.json format");
  equal(itemJson.schemaVersion, core.SCHEMA, "item.json schema version");
  equal(itemJson.id, "p100-1-500", "item.json id");

  var again = api.load();
  equal(again.index.items.length, 3, "second load does not import twice");
  equal(again.status.created, false, "store exists");
});

test("item add, touch, update, move and delete hit the disk", function () {
  var dir = tempDir("crud");
  var api = libio.create({ root: dir, legacyRoot: "" });
  api.load();

  var added = api.itemAdd({
    id: "i1",
    name: "Glow",
    type: "ae-preset",
    tags: ["intro"],
    text: JSON.stringify(legacyPreset("i1", "Glow"))
  });
  assert(added.ok, "item added: " + (added.error || ""));
  assert(fs.existsSync(path.join(dir, "items", "i1", "asset.qkpreset")), "asset written");
  assert(fs.existsSync(path.join(dir, "items", "i1", "item.json")), "item.json written");

  var touched = api.touch("i1");
  assert(touched.ok, "touch ok");
  equal(core.itemById(touched.index, "i1").usageCount, 1, "usage counted");
  assert(core.itemById(touched.index, "i1").lastUsed !== "", "lastUsed stamped");
  equal(readJson(path.join(dir, "items", "i1", "item.json")).usageCount, 1, "usage persisted to item.json");

  var folder = api.folderCreate({ name: "Titles" });
  assert(folder.ok, "folder created");
  var folderId = folder.folder.id;

  var updated = api.itemUpdate({ id: "i1", name: "Glow v2", folderId: folderId, tags: ["intro", "title"] });
  assert(updated.ok, "item updated: " + (updated.error || ""));
  var item = core.itemById(updated.index, "i1");
  equal(item.folderPath.join("/"), "Titles", "folder path refreshed");
  equal(readJson(path.join(dir, "items", "i1", "item.json")).name, "Glow v2", "name persisted");

  var moved = api.itemsMove({ ids: ["i1"], folderId: "" });
  assert(moved.ok, "item moved to root");
  equal(core.itemById(moved.index, "i1").folderId, "", "folderId cleared");
  equal(readJson(path.join(dir, "items", "i1", "item.json")).folderId, "", "move persisted");

  var deleted = api.itemsDelete({ ids: ["i1"] });
  assert(deleted.ok, "item deleted");
  equal(deleted.index.items.length, 0, "index empty");
  assert(!fs.existsSync(path.join(dir, "items", "i1")), "item folder removed from disk");
});

test("a corrupt library.json is rebuilt from the item folders", function () {
  var dir = tempDir("corrupt");
  var legacy = tempDir("legacy-corrupt");
  seedLegacy(legacy);
  var api = libio.create({ root: dir, legacyRoot: legacy });
  api.load();
  var folder = api.folderCreate({ name: "Empty folder that must survive" });
  assert(folder.ok, "folder created");

  fs.writeFileSync(path.join(dir, "library.json"), "{ this is not json", "utf8");

  var repaired = api.load();
  assert(repaired.ok, "load recovered");
  equal(repaired.status.repaired, true, "repair reported");
  equal(repaired.index.items.length, 3, "all items recovered");
  equal(repaired.index.items[0].name.length > 0, true, "item record rebuilt");
  assert(
    !!core.folderById(repaired.index, folder.folder.id),
    "empty folder survived through folders.json"
  );
  equal(repaired.index.items[0].folderPath.length > 0, true, "folder path rebuilt from item.json");
  assert(
    fs.readFileSync(path.join(dir, "library.json"), "utf8").indexOf("quickkit-library") > 0,
    "library.json written again"
  );
});

test("a missing asset is reported and never blocks the library", function () {
  var dir = tempDir("missing");
  var api = libio.create({ root: dir, legacyRoot: "" });
  api.load();
  api.itemAdd({ id: "i1", name: "Gone", type: "ae-preset", text: "{}" });
  fs.unlinkSync(path.join(dir, "items", "i1", "asset.qkpreset"));

  var loaded = api.load();
  assert(loaded.ok, "library still loads");
  equal(loaded.index.items.length, 1, "item still listed");
  equal(loaded.missing.join(","), "i1", "missing asset reported");

  var repaired = api.repair();
  assert(repaired.ok, "repair ok");
  equal(repaired.index.items.length, 1, "repair keeps an item with a missing asset");
});

test("a newer schema is refused instead of downgraded", function () {
  var dir = tempDir("newer");
  var api = libio.create({ root: dir, legacyRoot: "" });
  api.load();
  var raw = readJson(path.join(dir, "library.json"));
  raw.schemaVersion = core.SCHEMA + 5;
  writeJson(path.join(dir, "library.json"), raw);

  var loaded = api.load();
  assert(loaded.ok, "load still renders it");
  equal(loaded.status.newer, true, "newer flagged");
  var change = api.folderCreate({ name: "Nope" });
  equal(change.ok, false, "change refused");
  assert(change.error.indexOf("newer QuickKit") > 0, "clear message: " + change.error);
});

/* ---------------------------------------------------------------- packs */

test("export then import a pack round trips items and folders", function () {
  var sourceDir = tempDir("pack-src");
  var legacy = tempDir("legacy-pack");
  seedLegacy(legacy);
  var source = libio.create({ root: sourceDir, legacyRoot: legacy });
  source.load();

  var folder = source.folderCreate({ name: "Share me" });
  var ids = source.lastIndex().items.map(function (item) {
    return item.id;
  });
  source.itemsMove({ ids: [ids[0]], folderId: folder.folder.id });

  var packFile = path.join(tempDir("pack-out"), "Looks.qkpack");
  var exported = source.exportPack({ ids: ids, name: "Looks", target: packFile });
  assert(exported.ok, "export ok: " + (exported.error || ""));
  equal(exported.count, 3, "three items exported");
  assert(fs.existsSync(packFile), "pack file written");
  equal(fs.readFileSync(packFile).slice(0, 2).toString("latin1"), "PK", "pack is a zip");

  var entries = libio.zip.read(fs.readFileSync(packFile));
  var names = entries.map(function (entry) {
    return entry.name;
  });
  has(names, "manifest.json", "manifest in pack");
  has(names, "items/" + ids[0] + "/asset.qkpreset", "asset in pack");
  lacks(names, "items/" + ids[0] + "/item.json", "item.json regenerated rather than shipped twice");

  var manifest = JSON.parse(entries[0].data.toString("utf8"));
  equal(manifest.format, "quickkit-pack", "manifest format");
  equal(manifest.itemCount, 3, "manifest count");
  var folderNames = manifest.folders.map(function (folder) {
    return folder.name;
  });
  has(folderNames, "Share me", "manifest carries the shared folder");
  has(folderNames, "Transitions", "manifest carries a migrated folder");

  var targetDir = tempDir("pack-dst");
  var target = libio.create({ root: targetDir, legacyRoot: "" });
  target.load();
  var inspected = target.inspectPack(packFile);
  assert(inspected.ok, "inspect ok: " + (inspected.error || ""));
  equal(inspected.count, 3, "inspect count");

  var imported = target.importPack({ file: packFile, mode: "skip" });
  assert(imported.ok, "import ok: " + (imported.error || ""));
  equal(imported.counts.added, 3, "three items added");
  equal(imported.index.items.length, 3, "library holds them");

  var copied = core.itemById(imported.index, ids[0]);
  equal(copied.folderPath.join("/"), "Share me", "folder recreated on import");
  equal(
    fs.readFileSync(path.join(targetDir, "items", ids[0], copied.asset), "utf8"),
    fs.readFileSync(path.join(sourceDir, "items", ids[0], core.itemById(source.lastIndex(), ids[0]).asset), "utf8"),
    "asset bytes match"
  );

  var skipAgain = target.importPack({ file: packFile, mode: "skip" });
  assert(skipAgain.ok, "second import ok");
  equal(skipAgain.counts.skipped, 3, "all three skipped");
  equal(skipAgain.index.items.length, 3, "library unchanged");

  var replaced = target.importPack({ file: packFile, mode: "replace" });
  assert(replaced.ok, "replace import ok");
  equal(replaced.counts.replaced, 3, "all three replaced");
  equal(replaced.index.items.length, 3, "no duplicates on replace");

  var kept = target.importPack({ file: packFile, mode: "both" });
  assert(kept.ok, "keep-both import ok");
  equal(kept.counts.renamed, 3, "all three kept as copies");
  equal(kept.index.items.length, 6, "six items now");
  var extra = kept.index.items.filter(function (item) {
    return item.name.indexOf(" (2)") > 0;
  });
  equal(extra.length, 3, "copies are numbered");
});

test("a pack is a real zip: PowerShell can unpack it", function () {
  if (process.platform !== "win32") {
    console.log("SKIP  Expand-Archive (not Windows)");
    return;
  }
  var dir = tempDir("zip");
  var api = libio.create({ root: dir, legacyRoot: "" });
  api.load();
  api.itemAdd({ id: "i1", name: "Glow", type: "ae-preset", text: JSON.stringify(legacyPreset("i1", "Glow")) });
  var packFile = path.join(tempDir("zip-out"), "One.qkpack");
  var exported = api.exportPack({ ids: ["i1"], target: packFile });
  assert(exported.ok, "export ok");

  var unpacked = tempDir("zip-unpacked");
  /* Expand-Archive only accepts a .zip name, so prove the bytes with a copy. */
  var asZip = path.join(tempDir("zip-copy"), "One.zip");
  fs.copyFileSync(packFile, asZip);
  var result = cp.spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Expand-Archive -LiteralPath '" + asZip.replace(/'/g, "''") + "' -DestinationPath '" + unpacked.replace(/'/g, "''") + "' -Force"
    ],
    { encoding: "utf8" }
  );
  equal(result.status, 0, "Expand-Archive exit code (stderr: " + String(result.stderr || "").slice(0, 300) + ")");
  assert(fs.existsSync(path.join(unpacked, "manifest.json")), "manifest unpacked");
  assert(fs.existsSync(path.join(unpacked, "items", "i1", "asset.qkpreset")), "asset unpacked");
  equal(
    fs.readFileSync(path.join(unpacked, "items", "i1", "asset.qkpreset"), "utf8"),
    fs.readFileSync(path.join(dir, "items", "i1", "asset.qkpreset"), "utf8"),
    "unpacked bytes match"
  );
});

test("packs that are damaged or hostile are refused with a message", function () {
  var dir = tempDir("bad-pack");
  var api = libio.create({ root: dir, legacyRoot: "" });
  api.load();

  var notZip = path.join(tempDir("bad-pack-in"), "not-a-pack.qkpack");
  fs.writeFileSync(notZip, "just text", "utf8");
  var bad = api.importPack({ file: notZip, mode: "skip" });
  equal(bad.ok, false, "plain text refused");
  assert(bad.error.length > 10, "readable error: " + bad.error);

  var traversalZip = path.join(tempDir("bad-pack-in"), "traversal.qkpack");
  libio.zip.write(traversalZip, [
    { name: "manifest.json", data: Buffer.from(JSON.stringify({ format: "quickkit-pack", schemaVersion: 1, items: [] })) },
    { name: "../escape.txt", data: Buffer.from("nope") }
  ]);
  var traversal = api.importPack({ file: traversalZip, mode: "skip" });
  equal(traversal.ok, false, "path traversal refused");
  assert(traversal.error.indexOf("outside the library") > 0, "clear message: " + traversal.error);
  assert(!fs.existsSync(path.join(dir, "..", "escape.txt")), "nothing written outside the store");

  var truncated = path.join(tempDir("bad-pack-in"), "truncated.qkpack");
  fs.writeFileSync(truncated, fs.readFileSync(traversalZip).slice(0, 40));
  var cut = api.importPack({ file: truncated, mode: "skip" });
  equal(cut.ok, false, "truncated pack refused");

  var emptyPack = path.join(tempDir("bad-pack-in"), "empty.qkpack");
  libio.zip.write(emptyPack, [
    { name: "manifest.json", data: Buffer.from(JSON.stringify({ format: "quickkit-pack", schemaVersion: 1, items: [] })) }
  ]);
  var empty = api.importPack({ file: emptyPack, mode: "skip" });
  equal(empty.ok, false, "pack with no items refused");

  equal(api.load().index.items.length, 0, "library untouched by every failed import");
});

test("export refuses an empty selection and a missing target", function () {
  var dir = tempDir("export-guard");
  var api = libio.create({ root: dir, legacyRoot: "" });
  api.load();
  equal(api.exportPack({ ids: [], target: "x" }).ok, false, "empty selection refused");
  api.itemAdd({ id: "i1", name: "One", type: "ae-preset", text: "{}" });
  equal(api.exportPack({ ids: ["i1"] }).ok, false, "missing target refused");
  equal(api.exportPack({ ids: ["nope"], target: path.join(dir, "a.qkpack") }).ok, false, "unknown id refused");
});

/* --------------------------------------------------------------- runner */

(async function run() {
  for (var i = 0; i < tests.length; i++) {
    var current = tests[i];
    try {
      await current.fn();
      passed++;
      console.log("ok    " + current.name);
    } catch (error) {
      failed++;
      failures.push(current.name + ": " + (error && error.message ? error.message : error));
      console.log("FAIL  " + current.name + "\n      " + (error && error.stack ? error.stack.split("\n").slice(0, 3).join("\n      ") : error));
    }
  }

  cleanTemp();

  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  if (failures.length) {
    console.log("");
    for (var f = 0; f < failures.length; f++) console.log("- " + failures[f]);
  }
  process.exit(failed ? 1 : 0);
})();
