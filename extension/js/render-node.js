/* QuickKit — Node side of the Bridge render (After Effects).
 *
 * Loaded with require() from panel.js inside CEP only. Never a <script> tag,
 * so a browser preview never runs it. This is the second and last file that
 * starts a process (`extension/js/ffmpeg-node.js` is the other).
 *
 * Why aerender and not app.project.renderQueue.render():
 *   - renderQueue.render() runs inside ExtendScript. While it runs, the app
 *     cannot answer evalScript, so the panel freezes, cannot show progress and
 *     cannot cancel. aerender is a separate process: progress arrives on
 *     stdout, Cancel kills the child, and the panel stays alive.
 *   - renderQueue.render() also pops modal dialogs (missing footage, overwrite)
 *     which a panel cannot dismiss; aerender has flags for those cases.
 *   - The render queue keeps working as a fallback when aerender is missing,
 *     but it is the slower, riskier path and the panel says so.
 *
 * Flags used (checked against `aerender -help` on AE 26.5x89):
 *   -project <aep>  -comp "<name>"  -output <file>
 *   The output module and render settings are configured in the project by the
 *   host first, so -comp reuses that render queue item instead of guessing a
 *   template name that may not exist on this machine.
 *
 * No shell: spawn() gets an argument array, so spaces and non-English
 * characters in paths need no quoting. No network access, ever.
 */

"use strict";

var fs = require("fs");
var path = require("path");
var cp = require("child_process");

var LOG_KEEP = 400; /* lines kept for error messages */

/* ---------------------------------------------------------------- helpers */

function executableName() {
  return process.platform === "win32" ? "aerender.exe" : "aerender";
}

function normalizePath(value) {
  var text = String(value === null || value === undefined ? "" : value);
  if (!text) return "";
  try {
    text = decodeURIComponent(text);
  } catch (eDecode) {
    /* leave it alone */
  }
  if (/^file:\/\/\//i.test(text)) text = text.replace(/^file:\/\/\//i, "");
  else if (/^file:\/\//i.test(text)) text = text.replace(/^file:\/\//i, "");
  if (/^\/[a-zA-Z]:/.test(text)) text = text.slice(1);
  return text.replace(/[\\/]+$/, "");
}

/* "aerender version 26.5x89" -> "26.5x89" */
function parseVersion(text) {
  var match = /aerender version\s+([^\s]+)/i.exec(String(text || ""));
  return match ? match[1] : "";
}

/* Progress lines look like:  PROGRESS:  0:00:00:12 (12%)   */
function parseProgress(text) {
  var source = String(text || "");
  var matches = source.match(/PROGRESS:[^\r\n]*\((\d+)%\)/g);
  if (!matches || !matches.length) return null;
  var last = matches[matches.length - 1];
  var percent = /\((\d+)%\)/.exec(last);
  var clock = /PROGRESS:\s*([0-9:.]+)/.exec(last);
  return {
    percent: percent ? Number(percent[1]) : -1,
    clock: clock ? clock[1] : "",
    line: last.replace(/\s+/g, " ").trim()
  };
}

function tail(lines) {
  var start = Math.max(0, lines.length - LOG_KEEP);
  return lines.slice(start).join("\n");
}

function lastMeaningfulLine(log) {
  var lines = String(log || "").split(/\r?\n/);
  var i;
  for (i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].replace(/\s+$/, "");
    if (!line) continue;
    if (/^aerender version/i.test(line)) continue;
    return line.slice(0, 240);
  }
  return "";
}

/* aerender reports problems as text. Each branch gets a message that says what
   the user can do, because "render failed" helps nobody. */
function classifyFailure(log, code) {
  var text = String(log || "");

  /* Real text from aerender 26.5 for a bad project path:
     aerender Error: After Effects error: Unable to call "openFast" because
     of parameter 1. Path is not valid. Path: "C:\nope\nothing.aep" */
  if (/openFast|Path is not valid/i.test(text) ||
      (/could not be opened|cannot be opened|could not open|unable to open|does not exist/i.test(text) &&
        /project|\.aep/i.test(text))) {
    return {
      code: "project",
      message:
        "After Effects could not open the saved project file. Save the project again (File > Save As) and check the path still exists."
    };
  }
  if (/no comp|comp .* not found|could not find .*comp|cannot find.*comp/i.test(text)) {
    return {
      code: "comp",
      message:
        "aerender could not find that composition in the saved project. Rename it back, or save the project again from After Effects."
    };
  }
  if (/permission denied|access is denied|EACCES|read-only|cannot write|unable to write/i.test(text)) {
    return {
      code: "output",
      message:
        "Windows refused to write the render file. Pick a different output folder in the panel, or close the app that has the file open."
    };
  }
  if (/not activated|licen[cs]e|sign in|serial/i.test(text)) {
    return {
      code: "licence",
      message: "After Effects is not signed in or not activated on this machine, so aerender cannot render."
    };
  }
  if (/another instance|already rendering|is busy/i.test(text)) {
    return {
      code: "busy",
      message: "After Effects is busy rendering something else. Wait for it to finish, then press Render again."
    };
  }
  if (/missing footage|footage.*not found/i.test(text)) {
    return {
      code: "footage",
      message: "A footage file in the composition is offline. Relink it in After Effects, then render again."
    };
  }
  return null;
}

/* ------------------------------------------------------------- processes */

/* One place that starts a child, so Cancel always means the same thing. */
function spawnJob(file, args, handlers) {
  var child;
  var done = false;
  var handle = {
    cancelled: false,
    pid: 0,
    cancel: function () {
      if (done) return;
      handle.cancelled = true;
      try {
        child.kill();
      } catch (eKill) {
        /* already gone */
      }
    }
  };

  function finish(error, value) {
    if (done) return;
    done = true;
    if (handlers && typeof handlers.onDone === "function") handlers.onDone(error, value);
  }

  try {
    child = cp.spawn(file, args, { windowsHide: true });
  } catch (eSpawn) {
    finish({ code: "spawn_failed", message: "Could not start aerender: " + (eSpawn && eSpawn.message ? eSpawn.message : eSpawn) });
    return handle;
  }

  handle.pid = child.pid || 0;

  child.on("error", function (error) {
    finish({
      code: "spawn_failed",
      message:
        "Could not start aerender at " + file + ". " + (error && error.message ? error.message : "") +
        " Run scripts\\install.bat again, or render from the Render Queue."
    });
  });

  var pending = "";
  function consume(chunk) {
    pending += chunk.toString("utf8");
    var parts = pending.split(/\r?\n/);
    pending = parts.pop();
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] && handlers && typeof handlers.onLine === "function") handlers.onLine(parts[i]);
    }
  }

  if (child.stdout) child.stdout.on("data", consume);
  if (child.stderr) child.stderr.on("data", consume);

  child.on("close", function (code) {
    if (pending && handlers && typeof handlers.onLine === "function") handlers.onLine(pending);
    if (handle.cancelled) {
      finish({ code: "cancelled", message: "Stopped. The partial render file, if any, was left alone." });
      return;
    }
    finish(null, { code: code });
  });

  return handle;
}

/* ---------------------------------------------------------------- locate */

function adobeAfterEffectsFolders() {
  var roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]];
  var out = [];
  var r;
  var names;
  var i;

  for (r = 0; r < roots.length; r++) {
    if (!roots[r]) continue;
    var base = path.join(roots[r], "Adobe");
    try {
      names = fs.readdirSync(base);
    } catch (eRead) {
      continue;
    }
    for (i = 0; i < names.length; i++) {
      if (/^Adobe After Effects/i.test(names[i])) out.push(path.join(base, names[i], "Support Files", executableName()));
    }
  }
  return out;
}

/* options: { afterEffectsPath, setting }
   `afterEffectsPath` is app.path from the AE host — the folder AfterFX.exe and
   aerender.exe live in.
   done(error, { ok, path, version, source, tried }) */
function locate(options, done) {
  var opts = options || {};
  var name = executableName();
  var tried = [];
  var candidates = [];
  var i;

  function add(candidate, source) {
    var clean = normalizePath(candidate);
    if (!clean) return;
    for (var k = 0; k < candidates.length; k++) {
      if (candidates[k].path.toLowerCase() === clean.toLowerCase()) return;
    }
    candidates.push({ path: clean, source: source });
  }

  if (opts.afterEffectsPath) {
    add(path.join(normalizePath(opts.afterEffectsPath), name), "after effects");
    add(normalizePath(opts.afterEffectsPath).replace(/[\\/]Support Files$/i, "\\Support Files\\" + name), "after effects");
  }
  add(opts.setting, "saved");
  if (process.env.QK_AERENDER) add(process.env.QK_AERENDER, "environment");
  var installed = adobeAfterEffectsFolders();
  for (i = 0; i < installed.length; i++) add(installed[i], "install folder");
  add(name, "path");

  function next(index) {
    if (index >= candidates.length) {
      done(
        {
          code: "not_found",
          tried: tried,
          message:
            "aerender.exe was not found. It ships in \"...\\Adobe After Effects 20xx\\Support Files\". " +
            "Without it QuickKit can still use the Render Queue, but that path freezes the panel while it renders."
        },
        null
      );
      return;
    }

    var candidate = candidates[index];
    var exists = candidate.source === "path" ? true : fs.existsSync(candidate.path);
    if (!exists) {
      tried.push({ path: candidate.path, source: candidate.source, result: "missing" });
      next(index + 1);
      return;
    }

    probe(candidate.path, function (error, info) {
      if (error) {
        tried.push({ path: candidate.path, source: candidate.source, result: error.message });
        next(index + 1);
        return;
      }
      tried.push({ path: candidate.path, source: candidate.source, result: "ok" });
      done(null, { ok: true, path: candidate.path, version: info.version, source: candidate.source, tried: tried });
    });
  }

  next(0);
}

/* "-version" prints one line and does not render. */
function probe(aerenderPath, done) {
  cp.execFile(aerenderPath, ["-version"], { timeout: 30000, windowsHide: true }, function (error, stdout, stderr) {
    var text = String(stdout || "") + String(stderr || "");
    var version = parseVersion(text);
    if (!version) {
      done({ code: "not_aerender", message: "that file did not report an aerender version" }, null);
      return;
    }
    done(null, { version: version, text: text.slice(0, 500) });
  });
}

/* ----------------------------------------------------------------- render */

/* options: { aerender, project, comp, output }
   handlers: { onProgress(percent, line), onLine(line), onDone(error, {path, bytes}) } */
function render(options, handlers) {
  var opts = options || {};
  var lines = [];
  var started = Date.now();

  if (!opts.aerender) {
    if (handlers && handlers.onDone) {
      handlers.onDone({ code: "not_found", message: "No aerender path was given to the renderer." }, null);
    }
    return { cancel: function () {}, pid: 0 };
  }
  if (!opts.project) {
    if (handlers && handlers.onDone) {
      handlers.onDone(
        { code: "no_project", message: "The After Effects project has never been saved, so there is no file for aerender to open. Use File > Save As first." },
        null
      );
    }
    return { cancel: function () {}, pid: 0 };
  }
  if (!opts.comp) {
    if (handlers && handlers.onDone) {
      handlers.onDone({ code: "no_comp", message: "Open the composition you want to send back, then render again." }, null);
    }
    return { cancel: function () {}, pid: 0 };
  }
  if (!opts.output) {
    if (handlers && handlers.onDone) {
      handlers.onDone({ code: "no_output", message: "QuickKit could not build the output file name. Check the handoff folder is writable." }, null);
    }
    return { cancel: function () {}, pid: 0 };
  }

  var args = [
    "-project",
    opts.project,
    "-comp",
    opts.comp,
    "-output",
    opts.output,
    "-v",
    "ERRORS_AND_PROGRESS"
  ];

  return spawnJob(opts.aerender, args, {
    onLine: function (line) {
      lines.push(line);
      if (lines.length > LOG_KEEP * 2) lines = lines.slice(-LOG_KEEP);
      var progress = parseProgress(line);
      if (progress && handlers && typeof handlers.onProgress === "function") {
        handlers.onProgress(progress.percent, progress.line);
      }
      if (handlers && typeof handlers.onLine === "function") handlers.onLine(line);
    },
    onDone: function (error, value) {
      if (error) {
        if (handlers && handlers.onDone) handlers.onDone(error, null);
        return;
      }

      var log = tail(lines);
      if (value.code !== 0) {
        var known = classifyFailure(log, value.code);
        if (handlers && handlers.onDone) {
          handlers.onDone(
            known || {
              code: "render_failed",
              message: "aerender stopped with code " + value.code + ". " + lastMeaningfulLine(log)
            },
            null
          );
        }
        return;
      }

      var size = 0;
      try {
        size = fs.statSync(opts.output).size;
      } catch (eStat) {
        size = 0;
      }
      if (!size) {
        var empty = classifyFailure(log, 0);
        if (handlers && handlers.onDone) {
          handlers.onDone(
            empty || {
              code: "no_output",
              message:
                "aerender finished but wrote no file at that path. Check the output module's format and the folder permissions."
            },
            null
          );
        }
        return;
      }

      if (handlers && handlers.onDone) {
        handlers.onDone(null, {
          path: opts.output,
          bytes: size,
          seconds: Math.round((Date.now() - started) / 1000),
          log: log
        });
      }
    }
  });
}

module.exports = {
  executableName: executableName,
  normalizePath: normalizePath,
  parseVersion: parseVersion,
  parseProgress: parseProgress,
  lastMeaningfulLine: lastMeaningfulLine,
  classifyFailure: classifyFailure,
  locate: locate,
  probe: probe,
  spawnJob: spawnJob,
  render: render
};
