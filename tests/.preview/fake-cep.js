/* Temporary UI test harness. Not shipped. */
(function (window) {
  "use strict";

  var root = "C:/Users/Test/AppData/Roaming/QuickKit/presets";
  var folders = ["Motion", "Styles", "Titles"];
  var seeded = 15;
  var order = 0;

  /* ?host=PPRO pretends to be Premiere Pro; anything else is After Effects. */
  var query = String((window.location && window.location.search) || "");
  var premiere = query.indexOf("host=PPRO") !== -1;
  var host = premiere
    ? { appName: "PPRO", appVersion: "26.0.2" }
    : { appName: "AEFT", appVersion: "26.5" };

  function color(hex) {
    var value = parseInt(hex, 16);
    return [
      ((value >> 16) & 255) / 255,
      ((value >> 8) & 255) / 255,
      (value & 255) / 255
    ];
  }

  function make(id, name, folder, glyph, hex, motion, summary) {
    order++;
    return {
      id: id,
      name: name,
      folder: folder,
      favorite: false,
      order: order,
      created: "2026-10-26 10:00",
      summary: summary,
      thumbnail: { glyph: glyph, color: color(hex), motion: motion },
      layerCount: 1,
      propCount: motion ? 2 : 1
    };
  }

  var presets = [
    make("s1", "Title Fade In", "Titles", "M", "f2c14e", true, "Animated · 1 layer"),
    make("s2", "Title Pop In", "Titles", "M", "f2c14e", true, "Animated · 2 properties · 1 layer"),
    make("s3", "Title Rise", "Titles", "M", "f2c14e", true, "Animated · 2 properties · 1 layer"),
    make("s4", "Title Spin In", "Titles", "M", "f2c14e", true, "Animated · 2 properties · 1 layer"),
    make("s5", "Title Drift Up", "Titles", "M", "f2c14e", true, "Animated · 1 property · 1 layer"),
    make("s6", "Clean Lower Third", "Styles", "T", "ffffff", false, "Text style · 1 layer"),
    make("s7", "Bold Title", "Styles", "T", "ffffff", false, "Text style · 1 layer"),
    make("s8", "Wide Tracker", "Styles", "T", "ffffff", false, "Text style · 1 layer"),
    make("s9", "Gold Accent", "Styles", "T", "f2c14e", false, "Text style · 1 layer"),
    make("s10", "Small Caption", "Styles", "T", "d8dce6", false, "Text style · 1 layer"),
    make("s11", "Mono Label", "Styles", "T", "9aa3b2", false, "Text style · 1 layer"),
    make("s12", "Fade In", "Motion", "M", "7c5cff", true, "Animated · 1 property · 1 layer"),
    make("s13", "Slow Push", "Motion", "M", "7c5cff", true, "Animated · 1 property · 1 layer"),
    make("s14", "Punch In", "Motion", "M", "7c5cff", true, "Animated · 2 properties · 1 layer"),
    make("s15", "Settle", "Motion", "M", "7c5cff", true, "Animated · 2 properties · 1 layer")
  ];

  function args(script) {
    var start = script.indexOf("(");
    var end = script.lastIndexOf(")");
    if (start === -1 || end <= start) return [];
    var raw = script.substring(start + 1, end).replace(/^\s+|\s+$/g, "");
    if (raw === "") return [];
    try {
      return JSON.parse("[" + raw + "]");
    } catch (e) {
      return [];
    }
  }

  function find(id) {
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].id === id) return presets[i];
    }
    return null;
  }

  function meta(preset) {
    return {
      id: preset.id,
      name: preset.name,
      folder: preset.folder,
      favorite: preset.favorite,
      order: preset.order,
      created: preset.created,
      summary: preset.summary,
      thumbnail: preset.thumbnail,
      layerCount: preset.layerCount,
      propCount: preset.propCount
    };
  }

  function listReply() {
    var list = presets.slice(0).sort(function (a, b) {
      return a.order - b.order;
    });
    return {
      ok: true,
      message: list.length + " presets in " + root,
      root: root,
      folders: folders,
      presets: list.map(meta),
      skipped: [],
      seeded: seeded,
      note: ""
    };
  }

  function ok(message) {
    return { ok: true, message: message };
  }

  function evalScript(script, callback) {
    window.__fakeCalls.push(script);
    window.setTimeout(function () {
      var values = args(script);
      var reply = { ok: true, message: "Done." };
      var preset;

      if (script.indexOf("qkHostInfo") === 0) {
        reply = premiere
          ? {
              ok: true,
              host: "PPRO",
              hostName: "Premiere Pro",
              version: "26.0.2",
              build: "26.0.2",
              project: "QuickKit test.prproj",
              engine: "ExtendScript"
            }
          : {
              ok: true,
              host: "AEFT",
              hostName: "After Effects",
              version: "26.5",
              build: "26.5.0",
              project: "QuickKit test.aep",
              engine: "ExtendScript"
            };
      } else if (script.indexOf("qkSilenceTargets") === 0) {
        /* A stand-in sequence so the panel can lay itself out. There is no Node
           in a browser, so a scan stops at "Node is not available" — which is
           the path this preview is meant to check. */
        reply = {
          ok: true,
          scope: values[0] || "sequence",
          clips: [
            {
              id: "t0i0",
              name: "Take 1",
              path: "C:/Media/Take 1.wav",
              track: 0,
              trackName: "A1",
              start: 0,
              end: 12,
              inPoint: 0,
              outPoint: 12,
              duration: 12,
              speed: 1,
              hasAudio: true
            }
          ],
          sequence: { name: "QuickKit test sequence", frameRate: 25, end: 12 },
          notes: [],
          message: "1 audio clip"
        };
      } else if (script.indexOf("qkBridgeList") === 0) {
        /* Layout stand-in: one handoff and one render so both lists can be
           seen. Nothing touches disk in a browser. */
        reply = {
          ok: true,
          host: premiere ? "PPRO" : "AEFT",
          pending: [
            {
              id: "preview-handoff",
              file: "C:/Users/Test/AppData/Roaming/QuickKit/bridge/pending/preview-handoff.qkhandoff",
              created: "2026-10-26 12:00",
              comp: "QuickKit test sequence",
              clips: 2,
              frameRate: 25,
              width: 1920,
              height: 1080,
              duration: 8.5,
              summary: "Take 1 + 1 more"
            }
          ],
          returns: [
            {
              id: "preview-return",
              file: "C:/Users/Test/AppData/Roaming/QuickKit/bridge/returns/preview-return.qkreturn",
              created: "2026-10-26 12:05",
              comp: "QuickKit test sequence",
              render: "C:/Users/Test/AppData/Roaming/QuickKit/bridge/renders/QuickKit test sequence.mov",
              duration: 8.5,
              at: 2,
              trackName: "V1",
              summary: "QuickKit test sequence.mov",
              renderExists: true
            }
          ],
          skipped: 0,
          folders: {
            pending: "C:/Users/Test/AppData/Roaming/QuickKit/bridge/pending",
            returns: "C:/Users/Test/AppData/Roaming/QuickKit/bridge/returns",
            renders: "C:/Users/Test/AppData/Roaming/QuickKit/bridge/renders"
          },
          message: "1 handoff waiting for After Effects, 1 render waiting for Premiere Pro."
        };
      } else if (script.indexOf("qkBridgeInfo") === 0) {
        reply = {
          ok: true,
          host: "AEFT",
          root: "C:/Users/Test/AppData/Roaming/QuickKit/bridge",
          project: "C:/Projects/QuickKit test.aep",
          comp: { name: "QuickKit test sequence", width: 1920, height: 1080, frameRate: 25, duration: 8.5 },
          aerender: "C:/Program Files/Adobe/Adobe After Effects 2026/Support Files/aerender.exe",
          handoff: false,
          message: "File handoff, not Dynamic Link."
        };
      } else if (script.indexOf("qkBridgeSendToAe") === 0) {
        reply = {
          ok: true,
          id: "preview-handoff",
          file: "C:/Users/Test/AppData/Roaming/QuickKit/bridge/pending/preview-handoff.qkhandoff",
          clips: 2,
          summary: "Take 1 + 1 more",
          sequence: { name: "QuickKit test sequence", frameRate: 25, width: 1920, height: 1080, start: 2, duration: 8.5 },
          message: "Wrote a handoff for 2 clips (8.5 s). Open the Bridge tab in After Effects to import it.",
          steps: [
            { id: "sequence", label: "Read the active sequence", state: "ok", detail: "Sequence: QuickKit test sequence" },
            { id: "clips", label: "Find the clips to send", state: "ok", detail: "2 clips from the Timeline selection" },
            { id: "media", label: "Check the media files", state: "ok", detail: "2 files exist on disk." },
            { id: "folder", label: "Create the handoff folder", state: "ok", detail: "C:/Users/Test/AppData/Roaming/QuickKit/bridge/pending" },
            { id: "write", label: "Write the handoff file", state: "ok", detail: "preview-handoff.qkhandoff" },
            { id: "waiting", label: "Waiting for After Effects", state: "note", detail: "Preview only: nothing was written." }
          ]
        };
      } else if (script.indexOf("qkPresetList") === 0) {
        reply = listReply();
      } else if (script.indexOf("qkPresetFavorite") === 0) {
        preset = find(values[0]);
        if (preset) preset.favorite = values[1] === "1";
        reply = ok(preset && preset.favorite ? "Added to favourites." : "Removed from favourites.");
      } else if (script.indexOf("qkPresetRename") === 0) {
        preset = find(values[0]);
        if (preset) preset.name = values[1];
        reply = ok("Renamed the preset.");
      } else if (script.indexOf("qkPresetDelete") === 0) {
        preset = find(values[0]);
        if (preset) presets.splice(presets.indexOf(preset), 1);
        reply = ok("Deleted the preset.");
      } else if (script.indexOf("qkPresetMove") === 0) {
        preset = find(values[0]);
        if (preset) preset.folder = values[1];
        reply = ok("Moved the preset.");
      } else if (script.indexOf("qkFolderCreate") === 0) {
        if (folders.indexOf(values[0]) === -1) folders.push(values[0]);
        reply = ok("Created the folder.");
      } else if (script.indexOf("qkFolderDelete") === 0) {
        for (var i = 0; i < presets.length; i++) {
          if (presets[i].folder === values[0]) presets[i].folder = "";
        }
        var at = folders.indexOf(values[0]);
        if (at >= 0) folders.splice(at, 1);
        reply = ok("Deleted the folder.");
      } else if (script.indexOf("qkPresetReorder") === 0) {
        var ids = [];
        try {
          ids = JSON.parse(values[0]);
        } catch (e) {}
        for (var j = 0; j < ids.length; j++) {
          preset = find(ids[j]);
          if (preset) preset.order = j;
        }
        reply = ok("Saved the new order.");
      } else if (script.indexOf("qkPresetSave") === 0) {
        order++;
        presets.push({
          id: "s" + (order + 100),
          name: values[0],
          folder: values[1],
          favorite: false,
          order: order,
          created: "2026-10-26 10:10",
          summary: "Static look · 1 property · 1 layer",
          thumbnail: { glyph: "L", color: [0.486, 0.361, 1], motion: false },
          layerCount: 1,
          propCount: 1
        });
        reply = ok("Saved \"" + values[0] + "\".");
      } else if (script.indexOf("qkPresetApply") === 0) {
        preset = find(values[0]);
        reply = ok("Applied \"" + (preset ? preset.name : "preset") + "\" to 1 layer (1 property).");
      } else if (script.indexOf("qkPresetExport") === 0) {
        reply = ok("Exported presets to QuickKit-Presets.qkpack.");
      } else if (script.indexOf("qkPresetImport") === 0) {
        reply = ok("Imported 3 presets.");
      }

      callback(JSON.stringify(reply));
    }, 8);
  }

  /* ---------------------------------------------------------- fake library
     In-memory stand-in for extension/js/library-io.js so the Library tab can
     be exercised in a browser. Same shape of return values; no disk. */

  var libRoot = "C:/Users/Test/AppData/Roaming/QuickKit/library";
  var libFolders = [
    { id: "f-titles", name: "Titles", parentId: "", order: 1 },
    { id: "f-lower", name: "Lower thirds", parentId: "f-titles", order: 1 },
    { id: "f-motion", name: "Motion", parentId: "", order: 2 },
    { id: "f-trans", name: "Transitions", parentId: "", order: 3 },
    { id: "f-archive", name: "Archive", parentId: "", order: 4 }
  ];

  function libItem(id, name, type, category, tags, folderId, extra) {
    var base = {
      id: id,
      name: name,
      type: type,
      category: category,
      tags: tags,
      folderId: folderId,
      author: "You",
      license: "",
      notes: "",
      createdAt: "2026-10-2" + (id.length % 8) + " 10:00:00",
      usageCount: 0,
      lastUsed: ""
    };
    for (var key in extra || {}) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) base[key] = extra[key];
    }
    return base;
  }

  var libItems = [
    libItem("l1", "Glow title", "ae-preset", "Titles", ["intro", "glow"], "f-titles", { favorite: true, usageCount: 12, lastUsed: "2026-10-25 18:20:00" }),
    libItem("l2", "Type on", "ae-preset", "Titles", ["text", "typewriter"], "f-titles", { usageCount: 4, lastUsed: "2026-10-24 11:00:00" }),
    libItem("l3", "Lower third bar", "ae-preset", "Lower thirds", ["lower third", "clean"], "f-lower", { usageCount: 9, lastUsed: "2026-10-26 09:10:00" }),
    libItem("l4", "Wipe left", "ae-preset", "Transitions", ["transition", "wipe"], "f-trans"),
    libItem("l5", "Slide up", "ae-preset", "Transitions", ["transition", "slide"], "f-trans"),
    libItem("l6", "Soft push", "ae-preset", "Motion", ["move", "slow"], "f-motion", { usageCount: 2, lastUsed: "2026-10-22 16:00:00" }),
    libItem("l7", "Punch in", "ae-preset", "Motion", ["move", "fast"], "f-motion"),
    libItem("l8", "Circle burst", "ae-preset", "Shapes", ["shape", "circle"], "", { favorite: true }),
    libItem("l9", "Title card", "mogrt", "Titles", ["title", "mogrt"], "f-titles", { previewThumb: "thumb.png" }),
    libItem("l10", "Logo sting", "mogrt", "Brand", ["logo", "intro"], "", { usageCount: 6, lastUsed: "2026-10-23 14:05:00" }),
    libItem("l11", "Caption pop", "pr-recipe", "Captions", ["caption", "text"], ""),
    libItem("l12", "Zoom transition", "pr-recipe", "Transitions", ["transition", "zoom"], "f-trans", { usageCount: 3, lastUsed: "2026-10-25 08:00:00" }),
    libItem("l13", "Shape wipe", "pr-recipe", "Shapes", ["shape", "mask"], ""),
    libItem("l14", "Team pack", "pack", "Brand", ["pack", "brand"], "f-archive")
  ];

  var libMissing = ["l7"];

  /* ?empty=1 proves the first-run empty state without touching the seeds. */
  if (query.indexOf("empty=1") !== -1) {
    libItems = [];
    libMissing = [];
  }

  function libNormalized() {
    var core = window.QKLibraryCore;
    return core.normalizeIndex({ schemaVersion: 1, folders: libFolders, items: libItems });
  }

  function libRemember(index) {
    libFolders = index.folders;
    libItems = index.items;
  }

  function libReply(index, extra) {
    var reply = {
      ok: true,
      root: libRoot,
      index: index,
      missing: libMissing.slice(0),
      status: { created: false, repaired: false, newer: false, migrated: null, skipped: [] }
    };
    for (var key in extra || {}) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) reply[key] = extra[key];
    }
    return reply;
  }

  function libChange(change) {
    var core = window.QKLibraryCore;
    var index = libNormalized();
    var result = change(index, core) || {};
    if (result.error) {
      result.ok = false;
      return result;
    }
    libRemember(index);
    return libReply(index, result);
  }

  window.QKFakeLibrary = {
    load: function () {
      var index = libNormalized();
      return libReply(index, {
        status: {
          created: false,
          repaired: false,
          newer: false,
          migrated: { from: "presets", at: "2026-10-26 10:00", count: 9, skippedCount: 1 },
          skipped: []
        }
      });
    },
    repair: function () {
      var index = libNormalized();
      return libReply(index, { skipped: [], missingAssets: libMissing.length });
    },
    folderCreate: function (payload) {
      return libChange(function (index, core) {
        return core.folderCreate(index, payload || {});
      });
    },
    folderRename: function (payload) {
      return libChange(function (index, core) {
        return core.folderRename(index, payload || {});
      });
    },
    folderMove: function (payload) {
      return libChange(function (index, core) {
        return core.folderMove(index, payload || {});
      });
    },
    folderDelete: function (payload) {
      return libChange(function (index, core) {
        return core.folderDelete(index, payload || {});
      });
    },
    itemUpdate: function (payload) {
      return libChange(function (index, core) {
        return core.itemUpdate(index, payload || {});
      });
    },
    itemsMove: function (payload) {
      return libChange(function (index, core) {
        return core.itemsMove(index, payload || {});
      });
    },
    itemsDelete: function (payload) {
      return libChange(function (index, core) {
        return core.itemsDelete(index, payload || {});
      });
    },
    touch: function (id) {
      return libChange(function (index, core) {
        return core.touchItem(index, id);
      });
    },
    exportPack: function (payload) {
      return {
        ok: true,
        path: "C:/Users/Test/Desktop/QuickKit pack.qkpack",
        name: (payload && payload.name) || "QuickKit pack",
        count: (payload && payload.ids ? payload.ids.length : 0),
        skipped: [],
        bytes: 4096
      };
    },
    inspectPack: function () {
      return {
        ok: true,
        path: "C:/Users/Test/Desktop/QuickKit pack.qkpack",
        name: "Shared looks",
        createdAt: "2026-10-24 09:12",
        count: 3,
        names: ["Glow title", "Soft push", "Title card"]
      };
    },
    importPack: function (payload) {
      var mode = (payload && payload.mode) || "skip";
      var counts = { added: 0, replaced: 0, renamed: 0, skipped: 0 };
      var index = libNormalized();
      var core = window.QKLibraryCore;
      var incoming = [
        core.normalizeItem({ id: "l1", name: "Glow title", type: "ae-preset", tags: ["intro"] }),
        core.normalizeItem({ id: "px2", name: "Soft push", type: "ae-preset" }),
        core.normalizeItem({ id: "px3", name: "Title card", type: "mogrt" })
      ];
      var decisions = core.planImport(index, incoming, mode);
      counts = core.applyImport(index, decisions, [], mode);
      libRemember(index);
      return libReply(index, {
        counts: counts,
        mode: mode,
        wrote: counts.added + counts.replaced + counts.renamed,
        failed: [],
        unreadable: [],
        pack: "Shared looks",
        message:
          "Added " + counts.added + ", replaced " + counts.replaced + ", kept both " + counts.renamed + ", skipped " + counts.skipped + "."
      });
    },
    itemAdd: function () {
      return { ok: false, error: "The preview library cannot add files." };
    },
    itemDirectory: function () {
      return "";
    },
    itemFileUrl: function () {
      /* Deliberately undecodable, so the card must fall back to its type
         glyph. A file:// URL would be blocked by the browser and fill the
         console; this fails quietly in the <img> only. */
      return "data:image/png;base64,Qk9ndXM=";
    },
    itemAssetUrl: function () {
      return "";
    },
    rootUrl: function () {
      return "";
    }
  };

  window.cep = {
    fs: {
      showSaveDialogEx: function () {
        return { err: 0, data: "C:/Users/Test/Desktop/QuickKit pack.qkpack" };
      },
      showOpenDialogEx: function () {
        return { err: 0, data: ["C:/Users/Test/Desktop/Shared looks.qkpack"] };
      }
    }
  };

  window.__fakeCalls = [];
  window.__adobe_cep__ = {
    getHostEnvironment: function () {
      return JSON.stringify(host);
    },
    evalScript: evalScript
  };
})(window);
