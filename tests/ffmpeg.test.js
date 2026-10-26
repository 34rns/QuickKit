#!/usr/bin/env node
/* QuickKit FFmpeg tests.
 *
 * Two halves:
 *   1. pure parsing/gear maths — always runs, no ffmpeg needed
 *   2. real ffmpeg runs — generate a sample WAV with known silences, then
 *      check detection, waveform peaks, cancellation and a path that contains
 *      spaces plus non-English characters. Skipped with a clear SKIP line when
 *      no ffmpeg is installed on this machine.
 *
 * This is NOT Premiere Pro: it proves the Node side and the FFmpeg calls.
 * Run: node tests/ffmpeg.test.js */

"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var execFileSync = require("child_process").execFileSync;

var ROOT = path.resolve(__dirname, "..");
var FF = require(path.join(ROOT, "extension/js/ffmpeg-node.js"));

var passed = 0;
var failed = 0;
var skipped = [];
var tests = [];
var skippedNow = false;

function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

function skip(name, why) {
  skippedNow = true;
  skipped.push(name + " — " + why);
  console.log("SKIP  " + name + " — " + why);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function near(actual, expected, tolerance, label) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    label + ": expected " + expected + " ±" + tolerance + ", got " + actual
  );
}

function callAsync(fn /* , args..., */) {
  var args = Array.prototype.slice.call(arguments, 1);
  return new Promise(function (resolve) {
    fn.apply(null, args.concat([function (error, value) {
      resolve({ error: error, value: value });
    }]));
  });
}

/* detect/peaks take (path, file, options, handlers) — the callback lives inside
   handlers, so a plain callAsync would never resolve. */
function detectAsync(ffmpeg, file, options) {
  return new Promise(function (resolve) {
    FF.detect(ffmpeg, file, options, {
      onDone: function (error, value) {
        resolve({ error: error, value: value });
      }
    });
  });
}

function peaksAsync(ffmpeg, file, options) {
  return new Promise(function (resolve) {
    FF.peaks(ffmpeg, file, options, {
      onDone: function (error, value) {
        resolve({ error: error, value: value });
      }
    });
  });
}

/* ------------------------------------------------------- generated sample */

var SAMPLE = null; /* { dir, file, ffmpeg, ffmpegVersion } */

function findFfmpeg() {
  var exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  var bundled = path.join(ROOT, "bin/ffmpeg", exe);
  if (fs.existsSync(bundled)) return { path: bundled, source: "bundled" };
  try {
    var out = execFileSync(process.platform === "win32" ? "where" : "which", [exe], {
      stdio: "pipe",
      encoding: "utf8"
    }).split(/\r?\n/)[0].trim();
    if (out) return { path: out, source: "PATH" };
  } catch (e) {
    /* not on PATH */
  }
  return null;
}

function makeSample(ffmpeg) {
  var dir = path.join(os.tmpdir(), "qk silence 测试 äöü");
  fs.mkdirSync(dir, { recursive: true });
  var file = path.join(dir, "samp le 音声.wav");

  /* 2 s tone, 2 s silence, 2 s tone = 6 s, one gap at 2.0-4.0 */
  execFileSync(
    ffmpeg,
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1",
      "-ar", "48000", "-ac", "1", file
    ],
    { stdio: "pipe" }
  );

  return { dir: dir, file: file };
}

function makeLongSample(ffmpeg) {
  var dir = path.join(os.tmpdir(), "qk silence long");
  fs.mkdirSync(dir, { recursive: true });
  var file = path.join(dir, "one hour silence.wav");
  if (fs.existsSync(file) && fs.statSync(file).size > 50 * 1024 * 1024) return file;

  /* One hour of silence at 8 kHz mono — the "long file" case. Small enough to
     generate in a couple of seconds, long enough that ffmpeg cannot finish
     before a cancel arrives. */
  execFileSync(
    ffmpeg,
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono:d=3600",
      "-ar", "8000", "-ac", "1", file
    ],
    { stdio: "pipe" }
  );
  return file;
}

/* ------------------------------------------------------------ pure tests */

test("parses the Duration line ffmpeg prints", function () {
  var log = "  Duration: 00:01:23.45, start: 0.000000, bitrate: 1536 kb/s";
  near(FF.parseDuration(log), 83.45, 1e-6, "duration");
  assert(FF.parseDuration("no duration here") === -1, "missing duration must be -1");
});

test("reads progress lines in microseconds and milliseconds", function () {
  near(FF.parseProgressLine("out_time_us=1234567"), 1.234567, 1e-6, "us");
  near(FF.parseProgressLine("out_time_ms=5000"), 5, 1e-6, "ms");
  assert(FF.parseProgressLine("progress=continue") === -1, "non progress line");
});

test("parses silencedetect start/end pairs", function () {
  var log = [
    "[silencedetect @ 000001f4] silence_start: 2.0000",
    "[silencedetect @ 000001f4] silence_end: 4.0000 | silence_duration: 2.0000"
  ].join("\n");
  var segments = FF.parseSilenceSegments(log, 10);
  assert(segments.length === 1, "one gap");
  near(segments[0].start, 2, 1e-6, "start");
  near(segments[0].end, 4, 1e-6, "end");
});

test("closes a silence that runs to the end of the file", function () {
  var log = "[silencedetect @ 1] silence_start: 8.000";
  var segments = FF.parseSilenceSegments(log, 10);
  assert(segments.length === 1, "one gap");
  near(segments[0].end, 10, 1e-6, "end equals duration");
});

test("merges gaps for short breaths but keeps long ones", function () {
  var merged = FF.mergeSegments([
    { start: 1, end: 2 },
    { start: 2.1, end: 3 },      /* 0.1 s breath */
    { start: 4.5, end: 5 }       /* 1.5 s speech */
  ], 0.25);
  assert(merged.length === 2, "breath merged, speech kept");
  near(merged[0].start, 1, 1e-6, "first start");
  near(merged[0].end, 3, 1e-6, "first end");
});

test("padding shrinks segments and drops ones that vanish", function () {
  var out = FF.padSegments([
    { start: 1, end: 3 },
    { start: 10, end: 10.1 }
  ], 0.25, 0.5);
  assert(out.length === 1, "second segment is eaten by padding");
  near(out[0].start, 1.25, 1e-6, "padded start");
  near(out[0].end, 2.5, 1e-6, "padded end");
});

test("recognises a file with no audio stream", function () {
  var known = FF.classifyFailure("Stream map '0:a:0' matches no streams.");
  assert(known && known.code === "no_audio", "no_audio code");
  assert(/no audio stream/i.test(known.message), "readable message");
});

test("builds one peak per column from raw PCM", function () {
  var builder = new FF.PeakBuilder(4, 8); /* 8 bytes = 4 samples = 4 columns */
  var buffer = Buffer.alloc(8);
  buffer.writeInt16LE(1000, 0);
  buffer.writeInt16LE(-20000, 2);
  buffer.writeInt16LE(0, 4);
  buffer.writeInt16LE(30000, 6);
  builder.push(buffer);
  var peaks = builder.result();
  assert(peaks.length === 4, "four columns");
  near(peaks[0], 1000 / 32768, 0.001, "column 0");
  near(peaks[1], 20000 / 32768, 0.001, "column 1 uses the absolute value");
  near(peaks[3], 30000 / 32768, 0.001, "column 3");
});

test("keeps a split sample across two chunks", function () {
  var builder = new FF.PeakBuilder(2, 4);
  var first = Buffer.alloc(3);
  first.writeInt16LE(100, 0);
  first[2] = 0x10; /* half of the next sample */
  builder.push(first);
  var second = Buffer.alloc(3);
  second[0] = 0x20;
  second.writeInt16LE(200, 1);
  builder.push(second);
  var peaks = builder.result();
  assert(peaks.length === 2, "two columns");
  assert(peaks[0] > 0 && peaks[1] > 0, "both columns saw audio");
});

test("normalizes file:// paths and keeps non-English characters", function () {
  assert(FF.normalizePath("file:///C:/Users/Test/My%20Clips") === "C:/Users/Test/My Clips", "file url");
  assert(FF.normalizePath("C:\\剪辑\\啪 啪\\") === "C:\\剪辑\\啪 啪", "windows path");
  assert(FF.normalizePath("") === "", "empty");
});

/* ------------------------------------------------------------- real runs */

test("locate() finds ffmpeg and reports its build", async function () {
  var found = findFfmpeg();
  if (!found) {
    skip("locate() finds ffmpeg and reports its build", "no ffmpeg on this machine");
    return;
  }
  var result = await callAsync(FF.locate, { extensionDir: ROOT });
  assert(result.error === null, "locate failed: " + (result.error && result.error.message));
  assert(result.value.ok === true, "not ok");
  assert(/^ffmpeg version/i.test(result.value.version), "version line: " + result.value.version);
  assert(result.value.license === "GPL" || result.value.license === "LGPL", "licence: " + result.value.license);
  SAMPLE = SAMPLE || {};
  SAMPLE.ffmpeg = result.value.path;
  SAMPLE.ffmpegVersion = result.value.version;
  SAMPLE.ffmpegSource = result.value.source;
});

test("locate() explains itself when nothing is found", async function () {
  var result = await callAsync(FF.locate, {
    extensionDir: path.join(os.tmpdir(), "qk-no-extension-here"),
    savedPath: "",
    extra: []
  });
  /* On a machine with ffmpeg on PATH this succeeds legitimately. */
  if (result.value && result.value.ok) {
    assert(result.value.source === "path" || result.value.source === "environment", "unexpected source");
    return;
  }
  assert(/No ffmpeg found/.test(result.error.message), "message: " + result.error.message);
  assert(Array.isArray(result.error.tried) && result.error.tried.length > 0, "tried list");
});

test("probe() reads duration and finds the audio stream", async function () {
  if (!SAMPLE || !SAMPLE.ffmpeg) {
    skip("probe() reads duration and finds the audio stream", "no ffmpeg available");
    return;
  }
  var sample = makeSample(SAMPLE.ffmpeg);
  SAMPLE.sample = sample;
  var result = await callAsync(FF.probe, SAMPLE.ffmpeg, sample.file);
  assert(result.error === null, "probe error: " + (result.error && result.error.message));
  near(result.value.duration, 6, 0.1, "duration");
  assert(result.value.hasAudio === true, "audio stream found");
});

test("detect() finds the generated gap in a path with spaces and 中文", async function () {
  if (!SAMPLE || !SAMPLE.sample) {
    skip("detect() finds the generated gap in a path with spaces and 中文", "sample not generated");
    return;
  }
  var result = await detectAsync(SAMPLE.ffmpeg, SAMPLE.sample.file, {
    noise: -40,
    minSilence: 0.5,
    breaths: false,
    padBefore: 0,
    padAfter: 0
  });
  assert(result.error === null, "detect error: " + (result.error && result.error.message));
  var segments = result.value.segments;
  assert(segments.length === 1, "expected 1 gap, got " + segments.length + " (" + JSON.stringify(segments) + ")");
  near(segments[0].start, 2, 0.2, "gap start");
  near(segments[0].end, 4, 0.2, "gap end");
  near(result.value.duration, 6, 0.1, "reported duration");
});

test("detect() applies padding and keeps the gap silent-safe", async function () {
  if (!SAMPLE || !SAMPLE.sample) {
    skip("detect() applies padding and keeps the gap silent-safe", "sample not generated");
    return;
  }
  var result = await detectAsync(SAMPLE.ffmpeg, SAMPLE.sample.file, {
    noise: -40,
    minSilence: 0.5,
    padBefore: 0.25,
    padAfter: 0.25
  });
  assert(result.error === null, "detect error");
  var segments = result.value.segments;
  assert(segments.length === 1, "one padded gap");
  near(segments[0].start, 2.25, 0.2, "padded start");
  near(segments[0].end, 3.75, 0.2, "padded end");
});

test("detect() reports a threshold above the tone as silence everywhere", async function () {
  if (!SAMPLE || !SAMPLE.sample) {
    skip("detect() reports a threshold above the tone as silence everywhere", "sample not generated");
    return;
  }
  var result = await detectAsync(SAMPLE.ffmpeg, SAMPLE.sample.file, {
    noise: 0,          /* everything is below 0 dBFS tone of -6 dB */
    minSilence: 0.5
  });
  assert(result.error === null, "detect error");
  assert(result.value.segments.length >= 1, "a 0 dB threshold marks the tone as silence too");
});

test("detect() explains a file with no audio instead of hanging", async function () {
  if (!SAMPLE || !SAMPLE.ffmpeg) {
    skip("detect() explains a file with no audio instead of hanging", "no ffmpeg available");
    return;
  }
  var silentMovie = path.join(SAMPLE.sample.dir, "video only.mp4");
  if (!fs.existsSync(silentMovie)) {
    execFileSync(SAMPLE.ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=black:s=64x64:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", silentMovie
    ], { stdio: "pipe" });
  }
  var result = await detectAsync(SAMPLE.ffmpeg, silentMovie, { noise: -35, minSilence: 0.5 });
  assert(result.error !== null, "must fail, not succeed");
  assert(result.error.code === "no_audio", "code was " + result.error.code);
});

test("peaks() returns one value per column and follows the audio", async function () {
  if (!SAMPLE || !SAMPLE.sample) {
    skip("peaks() returns one value per column and follows the audio", "sample not generated");
    return;
  }
  var result = await peaksAsync(SAMPLE.ffmpeg, SAMPLE.sample.file, {
    duration: 6,
    columns: 60
  });
  assert(result.error === null, "peaks error");
  var peaks = result.value.peaks;
  assert(peaks.length === 60, "60 columns, got " + peaks.length);
  assert(peaks[5] > 0.1, "tone at the start has a peak: " + peaks[5]);
  assert(peaks[30] < 0.01, "middle is silence: " + peaks[30]);
  assert(peaks[55] > 0.1, "tone at the end has a peak: " + peaks[55]);
  SAMPLE.peaks = peaks;
});

test("cancel() stops a long run and says so", async function () {
  if (!SAMPLE || !SAMPLE.ffmpeg) {
    skip("cancel() stops a long run and says so", "no ffmpeg available");
    return;
  }
  var longFile = makeLongSample(SAMPLE.ffmpeg);
  var outcome = await new Promise(function (resolve) {
    var done = false;
    var handle = FF.detect(SAMPLE.ffmpeg, longFile, { noise: -35, minSilence: 0.5 }, {
      onDone: function (error) {
        if (done) return;
        done = true;
        resolve({ error: error });
      }
    });
    setTimeout(function () {
      handle.cancel();
    }, 0);
    setTimeout(function () {
      if (done) return;
      done = true;
      resolve({ error: { code: "timeout", message: "the run never reported back" } });
    }, 8000);
  });
  assert(outcome.error !== null, "a cancelled run must not report success");
  assert(outcome.error.code === "cancelled", "code was " + outcome.error.code);
});

test("peaks() honours start and duration so a trimmed clip lines up", async function () {
  if (!SAMPLE || !SAMPLE.sample) {
    skip("peaks() honours start and duration so a trimmed clip lines up", "sample not generated");
    return;
  }
  /* The sample is 2 s tone, 2 s silence, 2 s tone. Asking for 2 s - 4 s must
     return the silent part only. */
  var middle = await peaksAsync(SAMPLE.ffmpeg, SAMPLE.sample.file, { start: 2, duration: 2, columns: 40 });
  assert(middle.error === null, "peaks error");
  var loudest = middle.value.peaks.reduce(function (max, value) {
    return value > max ? value : max;
  }, 0);
  assert(loudest < 0.02, "the middle window should be silent, loudest was " + loudest);

  var head = await peaksAsync(SAMPLE.ffmpeg, SAMPLE.sample.file, { start: 0, duration: 2, columns: 40 });
  assert(head.value.peaks[10] > 0.1, "the first window is the tone: " + head.value.peaks[10]);
});
/* ------------------------------------------------------------- reporting */

(async function run() {
  for (var i = 0; i < tests.length; i++) {
    var entry = tests[i];
    skippedNow = false;
    try {
      /* A callback that never fires must fail loudly, not let Node exit 0
         because the event loop ran dry. */
      await Promise.race([
        entry.fn(),
        new Promise(function (resolve, reject) {
          var timer = setTimeout(function () {
            reject(new Error("test did not finish within 90 s"));
          }, 90000);
          timer.unref();
        })
      ]);
      if (!skippedNow) {
        console.log("PASS  " + entry.name);
        passed++;
      }
    } catch (error) {
      console.log("FAIL  " + entry.name + " — " + (error && error.message ? error.message : error));
      failed++;
    }
  }

  console.log("");
  if (SAMPLE && SAMPLE.ffmpegVersion) {
    console.log("ffmpeg used: " + SAMPLE.ffmpegVersion + " (" + SAMPLE.ffmpegSource + ")");
  } else {
    console.log("ffmpeg used: none found — the real-run tests were skipped");
  }
  console.log(passed + " passed, " + failed + " failed, " + skipped.length + " skipped");
  process.exit(failed ? 1 : 0);
})();
