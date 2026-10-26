/* QuickKit preview encoder (Part 6B). ffmpeg side, Node only.
 *
 * After Effects renders a short PNG sequence into a temp folder; this module
 * turns that sequence into the two files the library keeps per item:
 *
 *   preview.mp4   H.264, muted, at most 480 px wide, 2-4 s
 *   thumb.webp    one frame from the middle of the clip
 *
 * No shell and no string concatenation: spawn() gets an argument array, so
 * spaces and non-English folder names are safe. The thumbnail is taken from
 * the finished mp4, so it always matches what the pane plays.
 *
 * Pure helpers (framePattern, videoArgs, thumbArgs) are exported and tested
 * without a process; encode() is the only part that spawns ffmpeg.
 */

"use strict";

var cp = require("child_process");
var fs = require("fs");
var path = require("path");

var MAX_WIDTH = 480;
var MIN_WIDTH = 160;
var THUMB_WIDTH = 320;
var MIN_SECONDS = 2;
var MAX_SECONDS = 4;

function num(value, fallback) {
  var parsed = Number(value);
  return isFinite(parsed) ? parsed : fallback;
}

function toSlash(value) {
  return String(value === null || value === undefined ? "" : value).replace(/\\/g, "/");
}

/* "Comp 1_00007.png" -> { prefix: "Comp 1_", digits: 5, value: 7, suffix: ".png" }
   Uses the LAST digit run, which is what AE, Media Encoder and most render
   tools append. Returns null when the name has no number at all. */
function splitFrameName(fileName) {
  var name = path.basename(String(fileName || ""));
  var match = /^(.*?)(\d+)(\D*)$/.exec(name);
  if (!match) return null;
  return {
    prefix: match[1],
    digits: match[2].length,
    value: parseInt(match[2], 10),
    suffix: match[3],
    name: name
  };
}

/* Do the files form one evenly numbered sequence? Then ffmpeg can read them
   with a single -i pattern, which is faster and survives odd frame counts.
   Otherwise the caller falls back to a concat list. */
function framePattern(files) {
  var list = files || [];
  if (!list.length) return null;
  var first = splitFrameName(list[0]);
  if (!first) return null;

  var lowest = first.value;
  for (var i = 0; i < list.length; i++) {
    var part = splitFrameName(list[i]);
    if (!part) return null;
    if (part.prefix !== first.prefix || part.suffix !== first.suffix) return null;
    if (part.digits !== first.digits) return null;
    if (part.value !== first.value + i) return null;
    if (part.value < lowest) lowest = part.value;
  }

  var padded = String(first.value);
  while (padded.length < first.digits) padded = "0" + padded;

  return {
    pattern: toSlash(path.join(path.dirname(String(list[0])), first.prefix + "%0" + first.digits + "d" + first.suffix)),
    start: first.value,
    digits: first.digits,
    count: list.length
  };
}

/* Concat-demuxer script for the rare gap case (a frame failed to write).
   Each entry carries its own duration and the last file is repeated, which is
   what the concat demuxer expects for still images. */
function concatText(files, fps) {
  var rate = num(fps, 24) > 0 ? num(fps, 24) : 24;
  var lines = [];
  var list = files || [];
  if (!list.length) return "";
  for (var i = 0; i < list.length; i++) {
    lines.push("file '" + toSlash(list[i]).replace(/'/g, "'\\''") + "'");
    lines.push("duration " + (1 / rate).toFixed(5));
  }
  if (list.length) {
    lines.push("file '" + toSlash(list[list.length - 1]).replace(/'/g, "'\\''") + "'");
  }
  return lines.join("\n") + "\n";
}

function clampWidth(width) {
  var wanted = Math.round(num(width, MAX_WIDTH));
  if (wanted < MIN_WIDTH) wanted = MIN_WIDTH;
  if (wanted > MAX_WIDTH) wanted = MAX_WIDTH;
  return wanted;
}

/* Every frame of the temp comp is welcome, but a preview is 2-4 s: the render
   caller trims the comp to that length, and -t is a second guard. */
function clampSeconds(seconds) {
  var value = num(seconds, MIN_SECONDS);
  if (value < MIN_SECONDS) value = MIN_SECONDS;
  if (value > MAX_SECONDS) value = MAX_SECONDS;
  return Math.round(value * 100) / 100;
}

function inputArgs(source) {
  var args = [];
  if (source.pattern) {
    args.push("-framerate", String(num(source.fps, 24)));
    if (source.start > 0) args.push("-start_number", String(source.start));
    args.push("-i", source.pattern);
  } else {
    args.push("-f", "concat", "-safe", "0");
    args.push("-i", source.listPath);
  }
  return args;
}

/* options: { ffmpeg, frames: [paths], fps, width, seconds, outVideo, listPath }
   Deterministic, so the tests compare argument arrays instead of running. */
function videoArgs(options) {
  var opts = options || {};
  var width = clampWidth(opts.width);
  var seconds = clampSeconds(opts.seconds);
  var fps = num(opts.fps, 24);
  if (fps <= 0) fps = 24;

  var args = ["-hide_banner", "-y"];
  args = args.concat(inputArgs({ pattern: opts.pattern, listPath: opts.listPath, fps: fps, start: opts.start || 0 }));
  args.push("-t", String(seconds));
  args.push("-vf", "scale=w='min(" + width + ",iw)':h=-2:flags=lanczos,fps=" + fps);
  args.push("-an");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p");
  args.push("-movflags", "+faststart");
  args.push(toSlash(opts.outVideo));
  return args;
}

/* The middle of the clip, so a fade-in does not give a black thumbnail. */
function thumbArgs(options) {
  var opts = options || {};
  var seconds = clampSeconds(opts.seconds);
  var width = clampWidth(opts.width);
  var at = Math.round(seconds * 0.4 * 100) / 100;
  var args = ["-hide_banner", "-y", "-ss", String(at), "-i", toSlash(opts.outVideo)];
  args.push("-frames:v", "1");
  args.push("-vf", "scale=w='min(" + width + ",iw)':h=-2:flags=lanczos");
  args.push("-c:v", "libwebp", "-quality", "82");
  args.push("-f", "webp");
  args.push(toSlash(opts.outThumb));
  return args;
}

function removeQuietly(target) {
  try {
    if (target && fs.existsSync(target)) fs.unlinkSync(target);
  } catch (eRemove) {
    /* the temp folder is cleared later anyway */
  }
}

/* Runs one ffmpeg command. `next(error)` continues the chain. The handle is
   the job itself, so cancel() always reaches the child that is running. */
function run(file, args, handle, next) {
  var child = null;
  var done = false;

  function finish(error) {
    if (done) return;
    done = true;
    handle.child = null;
    next(error);
  }

  try {
    child = cp.spawn(file, args, { windowsHide: true });
  } catch (eSpawn) {
    finish({ code: "spawn_failed", message: "Could not start ffmpeg: " + (eSpawn && eSpawn.message ? eSpawn.message : eSpawn) });
    return;
  }
  handle.child = child;

  var log = "";
  function consume(chunk) {
    var text = chunk.toString("utf8");
    log += text;
    if (log.length > 8000) log = log.slice(-8000);
    if (typeof handle.onLine === "function") handle.onLine(text);
  }
  if (child.stdout) child.stdout.on("data", consume);
  if (child.stderr) child.stderr.on("data", consume);

  child.on("error", function (error) {
    finish({
      code: "spawn_failed",
      message: "Could not start ffmpeg at " + file + ". " + (error && error.message ? error.message : "")
    });
  });

  child.on("close", function (code) {
    if (handle.cancelled) {
      finish({ code: "cancelled", message: "Preview generation stopped." });
      return;
    }
    if (code === 0) {
      finish(null);
      return;
    }
    finish({ code: "encode_failed", message: describeFailure(log, code) });
  });
}

function describeFailure(log, code) {
  var text = String(log || "");
  if (/Unknown encoder/i.test(text)) {
    return "This ffmpeg build cannot encode H.264. Run scripts\\fetch-ffmpeg.ps1 to get the bundled build.";
  }
  if (/No such file or directory|could not open/i.test(text)) {
    return "ffmpeg could not open the rendered frames. The temp render may have failed.";
  }
  var lines = text.split(/\r?\n/).filter(function (line) {
    return line && !/^(frame=|size=)/.test(line);
  });
  var last = lines.length ? lines[lines.length - 1] : "";
  return "ffmpeg stopped with code " + code + (last ? ": " + last.slice(0, 200) : ".");
}

/* options: { ffmpeg, frames: [paths], fps, width, seconds, outVideo, outThumb, listPath }
   handlers: { onStage(stage, label), onLine(text), onDone(error, result) }
   result: { video, thumb, frames, seconds, width, usedPattern } */
function encode(options, handlers) {
  var opts = options || {};
  var hooks = handlers || {};
  var handle = {
    cancelled: false,
    stage: "",
    child: null,
    onLine: typeof hooks.onLine === "function" ? hooks.onLine : null,
    cancel: function () {
      if (handle.cancelled) return;
      handle.cancelled = true;
      if (handle.child) {
        try {
          handle.child.kill();
        } catch (eKill) {
          /* already gone */
        }
      }
    }
  };

  var frames = opts.frames && opts.frames.length ? opts.frames : [];
  var done = false;

  function finish(error, value) {
    if (done) return;
    done = true;
    if (error) {
      removeQuietly(opts.outVideo);
      removeQuietly(opts.outThumb);
      if (error.code === "cancelled") {
        if (opts.listPath) removeQuietly(opts.listPath);
      }
    } else if (opts.listPath) {
      removeQuietly(opts.listPath);
    }
    if (typeof hooks.onDone === "function") hooks.onDone(error, value);
  }

  function stage(name, label) {
    handle.stage = name;
    if (typeof hooks.onStage === "function") hooks.onStage(name, label);
  }

  if (!opts.ffmpeg) {
    finish({ code: "not_found", message: "No ffmpeg is configured." });
    return handle;
  }
  if (!frames.length) {
    finish({ code: "no_frames", message: "The render produced no frames, so there is nothing to encode." });
    return handle;
  }

  var fps = num(opts.fps, 24);
  if (fps <= 0) fps = 24;
  var seconds = clampSeconds(num(opts.seconds, frames.length / fps));
  var width = clampWidth(opts.width);

  var pattern = framePattern(frames);
  var source = { pattern: "", listPath: "", fps: fps, start: 0 };
  if (pattern) {
    source.pattern = pattern.pattern;
    source.start = pattern.start;
  } else {
    source.listPath = opts.listPath || path.join(path.dirname(frames[0]), "frames.txt");
    try {
      fs.writeFileSync(source.listPath, concatText(frames, fps), "utf8");
    } catch (eWrite) {
      finish({ code: "no_list", message: "QuickKit could not write the frame list for ffmpeg." });
      return handle;
    }
  }

  var videoOpts = {
    pattern: source.pattern,
    listPath: source.listPath,
    start: source.start,
    fps: fps,
    width: width,
    seconds: seconds,
    outVideo: opts.outVideo
  };

  stage("video", "Encoding the video");
  run(opts.ffmpeg, videoArgs(videoOpts), handle, function (error) {
    if (error) {
      finish(error);
      return;
    }
    if (handle.cancelled) {
      finish({ code: "cancelled", message: "Preview generation stopped." });
      return;
    }
    stage("thumb", "Making the thumbnail");
    var thumbOpts = { outVideo: opts.outVideo, outThumb: opts.outThumb, width: width, seconds: seconds };
    run(opts.ffmpeg, thumbArgs(thumbOpts), handle, function (thumbError) {
      if (thumbError) {
        finish(thumbError);
        return;
      }
      finish(null, {
        video: toSlash(opts.outVideo),
        thumb: toSlash(opts.outThumb),
        frames: frames.length,
        seconds: seconds,
        width: width,
        usedPattern: !!source.pattern
      });
    });
  });

  return handle;
}

module.exports = {
  MAX_WIDTH: MAX_WIDTH,
  MIN_WIDTH: MIN_WIDTH,
  MIN_SECONDS: MIN_SECONDS,
  MAX_SECONDS: MAX_SECONDS,
  splitFrameName: splitFrameName,
  framePattern: framePattern,
  concatText: concatText,
  clampWidth: clampWidth,
  clampSeconds: clampSeconds,
  videoArgs: videoArgs,
  thumbArgs: thumbArgs,
  encode: encode
};
