/* Temporary UI test harness. Not shipped. */
(function (window) {
  "use strict";

  var root = "C:/Users/Test/AppData/Roaming/QuickKit/presets";
  var folders = ["Motion", "Styles", "Titles"];
  var seeded = 15;
  var order = 0;

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
        reply = {
          ok: true,
          host: "AEFT",
          hostName: "After Effects",
          version: "26.5",
          build: "26.5.0",
          project: "QuickKit test.aep",
          engine: "ExtendScript"
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

  window.__fakeCalls = [];
  window.__adobe_cep__ = {
    getHostEnvironment: function () {
      return JSON.stringify({ appName: "AEFT", appVersion: "26.5" });
    },
    evalScript: evalScript
  };
})(window);
