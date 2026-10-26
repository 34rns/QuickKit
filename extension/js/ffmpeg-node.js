/* QuickKit — Node side of the Silence tool (Premiere Pro).
 *
 * Loaded with require() from panel.js inside CEP only. It is never added to
 * index.html with a <script> tag, so a browser preview never runs it.
 *
 * Everything that touches FFmpeg lives here:
 *   locate()   find a usable ffmpeg.exe (bundled, saved setting, PATH)
 *   probe()    duration + whether the file has an audio stream
 *   detect()   run silencedetect and stream progress back
 *   peaks()    decode to mono PCM and build waveform columns
 *
 * No shell is used: spawn() receives an argument array, so spaces and
 * non-English characters in a path never need quoting or escaping.
 *
 * No network access, ever. Only the local ffmpeg.exe is started.
 */

"use strict";

var fs = require("fs");
var path = require("path");
var cp = require("child_process");

var STDERR_KEEP = 400; /* lines kept for error messages */
var WAVE_RATE = 4000; /* Hz used to build the waveform columns */

/* ---------------------------------------------------------------- helpers */

function executableName() {
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

/* Accepts the values CEP returns ("file:///C:/..." with percent escapes) and
   plain Windows paths alike. */
function normalizePath(value) {
  var text = String(value === null || value === undefined ? "" : value);
  if (!text) return "";
  try {
    text = decodeURIComponent(text);
  } catch (e) {
    /* leave it alone */
  }
  if (/^file:\/\/\//i.test(text)) text = text.replace(/^file:\/\/\//i, "");
  else if (/^file:\/\//i.test(text)) text = text.replace(/^file:\/\//i, "");
  if (/^\/[a-zA-Z]:/.test(text)) text = text.slice(1);
  return text.replace(/[\\/]+$/, "");
}

function parseClock(value) {
  var text = String(value || "");
  var match = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (match) {
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
  var plain = Number(text);
  return isNaN(plain) ? -1 : plain;
}

/* "Duration: 00:01:23.45, start: 0.000000, bitrate: ..." */
function parseDuration(log) {
  var match = /Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/.exec(String(log || ""));
  if (!match) return -1;
  return parseClock(match[1]);
}

/* silencedetect writes two lines per gap:
     silence_start: 12.3456
     silence_end: 15.6789 | silence_duration: 3.3333
   A gap that runs to the end of the file has no silence_end line. */
function parseSilenceSegments(log, duration) {
  var text = String(log || "");
  var lines = text.split(/\r?\n/);
  var segments = [];
  var open = -1;
  var i;
  var line;
  var start;
  var end;
  var lastEnd = duration;

  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    start = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (start) {
      open = Number(start[1]);
      if (open < 0) open = 0;
      continue;
    }
    end = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (end && open >= 0) {
      segments.push({ start: open, end: Number(end[1]) });
      open = -1;
    }
  }

  if (open >= 0) {
    segments.push({ start: open, end: lastEnd > open ? lastEnd : open });
  }

  return segments.filter(function (segment) {
    return segment.end > segment.start;
  });
}

/* Merge gaps separated by less than `gap` seconds. Used for "cut through
   short breaths": a breath shorter than the gap is merged into the cut. */
function mergeSegments(segments, gap) {
  var sorted = segments.slice().sort(function (a, b) {
    return a.start - b.start;
  });
  var out = [];
  var i;
  var current;

  for (i = 0; i < sorted.length; i++) {
    current = sorted[i];
    if (!out.length || current.start - out[out.length - 1].end > gap) {
      out.push({ start: current.start, end: current.end });
    } else if (current.end > out[out.length - 1].end) {
      out[out.length - 1].end = current.end;
    }
  }
  return out;
}

/* Shrink each segment by the padding so speech keeps a margin. */
function padSegments(segments, before, after) {
  var out = [];
  var i;
  var start;
  var end;

  for (i = 0; i < segments.length; i++) {
    start = segments[i].start + (before > 0 ? before : 0);
    end = segments[i].end - (after > 0 ? after : 0);
    if (end - start > 0.0005) out.push({ start: start, end: end });
  }
  return out;
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

/* Panel values arrive as strings ("-35", "", "0.25"), so 0 and "" must not be
   mistaken for "missing" the way `value || fallback` would. */
function numberOr(value, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  var parsed = Number(value);
  return isFinite(parsed) ? parsed : fallback;
}

function cleanSegments(segments) {
  return segments.map(function (segment) {
    return { start: round3(segment.start), end: round3(segment.end) };
  });
}

/* "-progress pipe:1" lines look like out_time_us=1234567 / progress=continue */
function parseProgressLine(line) {
  var match = /^out_time_(?:us|ms)=(-?\d+)/.exec(String(line || "").trim());
  if (!match) return -1;
  var value = Number(match[1]);
  if (isNaN(value) || value < 0) return -1;
  return String(line).indexOf("out_time_us=") !== -1 ? value / 1e6 : value / 1e3;
}

/* PCM s16le mono -> one peak (0..1) per column. Streamed, so a one hour file
   never sits in memory as a whole. */
function PeakBuilder(columns, totalBytes) {
  this.columns = Math.max(1, Math.floor(columns || 600));
  this.totalBytes = Math.max(2, Number(totalBytes) || 2);
  this.bytesPerColumn = Math.max(2, Math.floor(this.totalBytes / this.columns));
  this.peaks = new Float32Array(this.columns);
  this.seen = 0;
  this.remainder = null;
  this.column = 0;
  this.columnPeak = 0;
  this.columnBytes = 0;
}

PeakBuilder.prototype.push = function (chunk) {
  var buffer = chunk;
  var i;
  var value;
  var column;

  if (this.remainder && this.remainder.length) {
    buffer = Buffer.concat([this.remainder, chunk]);
  }

  var usable = buffer.length - (buffer.length % 2);
  this.remainder = usable < buffer.length ? buffer.slice(usable) : null;

  for (i = 0; i < usable; i += 2) {
    value = buffer.readInt16LE(i);
    if (value < 0) value = -value;
    if (value > this.columnPeak) this.columnPeak = value;
    this.columnBytes += 2;
    this.seen += 2;

    if (this.columnBytes >= this.bytesPerColumn) {
      column = this.column;
      if (column < this.columns) this.peaks[column] = this.columnPeak / 32768;
      this.column++;
      this.columnPeak = 0;
      this.columnBytes = 0;
    }
  }
};

PeakBuilder.prototype.result = function () {
  var out = [];
  var i;
  for (i = 0; i < this.columns; i++) out.push(Math.round(this.peaks[i] * 1000) / 1000);
  return out;
};

/* ------------------------------------------------------------- processes */

function tail(lines) {
  var start = Math.max(0, lines.length - STDERR_KEEP);
  return lines.slice(start).join("\n");
}

/* One place that starts a child, so cancel always means the same thing. */
function startJob(ffmpegPath, args, handlers) {
  var child;
  var done = false;
  var stderrLines = [];
  var stderrTail = "";
  var handle = {
    cancelled: false,
    pid: 0,
    cancel: function () {
      if (done) return;
      handle.cancelled = true;
      try {
        child.kill();
      } catch (e) {
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
    child = cp.spawn(ffmpegPath, args, { windowsHide: true });
  } catch (e) {
    finish({ code: "spawn_failed", message: "Could not start ffmpeg: " + (e && e.message ? e.message : e) });
    return handle;
  }

  handle.pid = child.pid || 0;

  child.on("error", function (error) {
    finish({
      code: "spawn_failed",
      message:
        "Could not start ffmpeg at " +
        ffmpegPath +
        ". " +
        (error && error.message ? error.message : "")
    });
  });

  if (child.stdout && handlers && typeof handlers.onStdout === "function") {
    child.stdout.on("data", function (chunk) {
      handlers.onStdout(chunk);
    });
  } else if (child.stdout) {
    child.stdout.resume();
  }

  if (child.stderr) {
    var pending = "";
    child.stderr.on("data", function (chunk) {
      pending += chunk.toString("utf8");
      var parts = pending.split(/\r?\n/);
      pending = parts.pop();
      for (var i = 0; i < parts.length; i++) {
        if (parts[i]) {
          stderrLines.push(parts[i]);
          if (stderrLines.length > STDERR_KEEP * 2) stderrLines = stderrLines.slice(-STDERR_KEEP);
          if (handlers && typeof handlers.onStderrLine === "function") handlers.onStderrLine(parts[i]);
        }
      }
    });
  }

  child.on("close", function (code) {
    stderrTail = tail(stderrLines);
    if (handle.cancelled) {
      finish({ code: "cancelled", message: "Stopped." });
      return;
    }
    finish(null, { code: code, log: stderrTail });
  });

  return handle;
}

/* Errors FFmpeg reports as text; they decide which message the panel shows. */
function classifyFailure(log) {
  var text = String(log || "");
  if (/matches no streams|does not contain any stream|Stream map .* matches no streams/i.test(text)) {
    return {
      code: "no_audio",
      message: "This file has no audio stream, so there is nothing to detect. Pick a clip with sound."
    };
  }
  if (/No such file or directory|Invalid data found|No such file/i.test(text)) {
    return {
      code: "unreadable",
      message: "ffmpeg could not read this file. It may be offline, moved, or a format ffmpeg cannot open."
    };
  }
  if (/Permission denied/i.test(text)) {
    return { code: "denied", message: "Windows refused access to this file. Copy it somewhere writable and try again." };
  }
  return null;
}

function lastMeaningfulLine(log) {
  var lines = String(log || "").split(/\r?\n/);
  var i;
  for (i = lines.length - 1; i >= 0; i--) {
    if (lines[i] && lines[i].indexOf("Duration:") === -1 && lines[i].indexOf("built with") === -1) {
      return lines[i].slice(0, 200);
    }
  }
  return "";
}

/* ------------------------------------------------------------------ find */

function bundledPaths(extensionDir) {
  var root = normalizePath(extensionDir);
  var name = executableName();
  var list = [];
  if (!root) return list;
  list.push(path.join(root, "bin", "ffmpeg", name));
  list.push(path.join(root, "..", "..", "..", "..", "bin", "ffmpeg", name));
  return list;
}

function readVersion(ffmpegPath, done) {
  cp.execFile(ffmpegPath, ["-version"], { timeout: 8000, windowsHide: true }, function (error, stdout, stderr) {
    var text = String(stdout || "") + String(stderr || "");
    if (error && !text) {
      done({ ok: false, message: error.message || "no answer" });
      return;
    }
    var first = text.split(/\r?\n/)[0] || "";
    if (!/^ffmpeg version/i.test(first)) {
      done({ ok: false, message: "that file did not report an ffmpeg version" });
      return;
    }
    var config = text;
    var license = "unknown";
    if (/--enable-gpl/.test(config)) license = "GPL";
    else if (/--enable-lgpl|--disable-gpl/.test(config)) license = "LGPL";
    done({ ok: true, version: first.replace(/\s+/g, " ").trim().slice(0, 120), license: license });
  });
}

/* options: { extensionDir, savedPath, extra: [paths] }
   done(error, { ok, path, version, license, source, tried }) */
function locate(options, done) {
  var opts = options || {};
  var tried = [];
  var candidates = [];
  var name = executableName();
  var i;

  function add(candidate, source) {
    var clean = normalizePath(candidate);
    if (!clean) return;
    for (var k = 0; k < candidates.length; k++) {
      if (candidates[k].path.toLowerCase() === clean.toLowerCase()) return;
    }
    candidates.push({ path: clean, source: source });
  }

  add(opts.setting, "saved");
  var bundled = bundledPaths(opts.extensionDir);
  for (i = 0; i < bundled.length; i++) add(bundled[i], "bundled");
  (opts.extra || []).forEach(function (extra) {
    add(extra, "configured");
  });
  if (process.env.QK_FFMPEG) add(process.env.QK_FFMPEG, "environment");
  add(name, "path");

  function next(index) {
    if (index >= candidates.length) {
      done(
        {
          code: "not_found",
          tried: tried,
          message:
            "No ffmpeg found. QuickKit looked in the extension folder, %APPDATA%\\QuickKit and on PATH. " +
            "Run scripts\\fetch-ffmpeg.ps1, or pick ffmpeg.exe with the Browse button."
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

    readVersion(candidate.path, function (probe) {
      if (!probe.ok) {
        tried.push({ path: candidate.path, source: candidate.source, result: probe.message });
        next(index + 1);
        return;
      }
      tried.push({ path: candidate.path, source: candidate.source, result: "ok" });
      done(null, {
        ok: true,
        path: candidate.path,
        version: probe.version,
        license: probe.license,
        source: candidate.source,
        tried: tried
      });
    });
  }

  /* PATH lookup is the last resort; Windows resolves a bare command name
     against PATH, so this also covers a machine with ffmpeg installed. */
  next(0);
}

/* ----------------------------------------------------------------- probe */

function probe(ffmpegPath, file, done) {
  cp.execFile(ffmpegPath, ["-hide_banner", "-nostdin", "-i", file], { timeout: 20000, windowsHide: true }, function (error, stdout, stderr) {
    var text = String(stderr || "") + String(stdout || "");
    var duration = parseDuration(text);
    var hasAudio = /Stream #\d+:\d+.*: Audio:/.test(text);

    if (duration < 0 && !hasAudio) {
      var known = classifyFailure(text);
      done(
        known || {
          code: "unreadable",
          message: "ffmpeg could not open this file. " + lastMeaningfulLine(text)
        }
      );
      return;
    }

    done(null, {
      duration: duration > 0 ? duration : 0,
      hasAudio: hasAudio,
      log: text.slice(-2000)
    });
  });
}

/* ---------------------------------------------------------------- detect */

/* options: { noise: -35, minSilence: 0.5, breaths: false, breathMax: 0.25 }
   handlers: { onProgress(seconds, ratio), onDone(error, {segments, duration}) } */
function detect(ffmpegPath, file, options, handlers, knownDuration) {
  var opts = options || {};
  var events = [];
  var stderrLog = [];
  var duration = typeof knownDuration === "number" ? knownDuration : 0;
  var args = [
    "-hide_banner",
    "-nostdin",
    "-progress",
    "pipe:1",
    "-nostats",
    "-i",
    file,
    "-map",
    "0:a:0",
    "-af",
    "silencedetect=noise=" + numberOr(opts.noise, -35) + "dB:d=" + numberOr(opts.minSilence, 0.5),
    "-f",
    "null",
    "-"
  ];

  return startJob(ffmpegPath, args, {
    onStdout: function (chunk) {
      var lines = chunk.toString("utf8").split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var seconds = parseProgressLine(lines[i]);
        if (seconds >= 0 && handlers && typeof handlers.onProgress === "function") {
          handlers.onProgress(seconds, duration > 0 ? Math.min(1, seconds / duration) : -1);
        }
      }
    },
    onStderrLine: function (line) {
      if (/silence_(start|end)/.test(line)) events.push(line);
      if (/Duration:/.test(line)) {
        var parsed = parseDuration(line);
        if (parsed > 0) duration = parsed;
      }
      stderrLog.push(line);
      if (stderrLog.length > STDERR_KEEP) stderrLog.shift();
    },
    onDone: function (error, value) {
      if (error) {
        if (handlers && handlers.onDone) handlers.onDone(error, null);
        return;
      }

      var log = value.log || stderrLog.join("\n");
      if (value.code !== 0 && !events.length) {
        var known = classifyFailure(log);
        if (handlers && handlers.onDone) {
          handlers.onDone(
            known || {
              code: "ffmpeg_failed",
              message: "ffmpeg stopped with code " + value.code + ". " + lastMeaningfulLine(log)
            },
            null
          );
        }
        return;
      }

      var segments = parseSilenceSegments(events.join("\n"), duration);
      var merged = opts.breaths
        ? mergeSegments(segments, numberOr(opts.breathMax, 0.25))
        : mergeSegments(segments, 0.001);
      var padded = padSegments(
        merged,
        numberOr(opts.padBefore, 0),
        numberOr(opts.padAfter, 0)
      );

      if (handlers && handlers.onDone) {
        handlers.onDone(null, {
          segments: cleanSegments(padded),
          raw: cleanSegments(merged),
          duration: round3(duration),
          count: padded.length
        });
      }
    }
  });
}

/* ----------------------------------------------------------------- peaks */

/* Decode only the audio, at a low rate, and keep one peak per column.
   options: { start, duration, columns } — start/duration are the part of the
   media the timeline clip actually shows, so the waveform lines up with the
   gaps that silencedetect reported for the same clip. */
function peaks(ffmpegPath, file, options, handlers) {
  var opts = options || {};
  var start = numberOr(opts.start, 0);
  var duration = numberOr(opts.duration, 0);
  var columns = numberOr(opts.columns, 600);
  var builder = new PeakBuilder(columns, Math.max(2000, Math.round(duration * WAVE_RATE * 2)));
  var args = ["-hide_banner", "-nostdin", "-progress", "pipe:1", "-nostats"];

  if (start > 0) args.push("-ss", String(start));
  if (duration > 0) args.push("-t", String(duration));

  args = args.concat([
    "-i",
    file,
    "-map",
    "0:a:0",
    "-ac",
    "1",
    "-ar",
    String(WAVE_RATE),
    "-f",
    "s16le",
    "-"
  ]);

  return startJob(ffmpegPath, args, {
    onStdout: function (chunk) {
      builder.push(chunk);
    },
    onDone: function (error, value) {
      if (error) {
        if (handlers && handlers.onDone) handlers.onDone(error, null);
        return;
      }
      if (handlers && handlers.onDone) handlers.onDone(null, { peaks: builder.result(), columns: columns });
    }
  });
}

/* ------------------------------------------------------------------ misc */

function saveSetting(settingsPath, data) {
  var text = "";
  text += "{\n";
  var keys = Object.keys(data || {});
  keys.forEach(function (key, index) {
    text += '  "' + key + '": ' + JSON.stringify(data[key]) + (index < keys.length - 1 ? "," : "") + "\n";
  });
  text += "}\n";
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  } catch (eDir) {}
  try {
    fs.writeFileSync(settingsPath, text, "utf8");
    return true;
  } catch (eWrite) {
    return false;
  }
}

function loadSetting(settingsPath) {
  try {
    if (!fs.existsSync(settingsPath)) return null;
    var text = fs.readFileSync(settingsPath, "utf8");
    var parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (eRead) {
    return null;
  }
}

module.exports = {
  executableName: executableName,
  normalizePath: normalizePath,
  parseClock: parseClock,
  parseDuration: parseDuration,
  parseSilenceSegments: parseSilenceSegments,
  parseProgressLine: parseProgressLine,
  mergeSegments: mergeSegments,
  padSegments: padSegments,
  classifyFailure: classifyFailure,
  PeakBuilder: PeakBuilder,
  locate: locate,
  probe: probe,
  detect: detect,
  peaks: peaks,
  saveSetting: saveSetting,
  loadSetting: loadSetting
};
