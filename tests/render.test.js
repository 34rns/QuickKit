#!/usr/bin/env node
/* QuickKit bridge render tests (After Effects side).
 *
 * Loads extension/js/render-node.js and checks three things:
 *   1. the parsing helpers (version, progress, failure text) on real aerender
 *      output captured from AE 26.5;
 *   2. spawnJob() around a real child process: output lines, exit code, cancel;
 *   3. aerender discovery and the error it really reports for a bad project.
 *
 * Real-binary tests print a SKIP line when After Effects is not installed; the
 * success path (a comp actually rendered to a file) cannot be tested without a
 * saved project, so it stays UNTESTED until the manual checklist runs it.
 *
 * Run: node tests/render.test.js */

"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var RN = require(path.join(ROOT, "extension/js/render-node.js"));

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

function equal(actual, expected, label) {
  assert(actual === expected, label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
}

function callAsync(fn /* , args..., */) {
  var args = Array.prototype.slice.call(arguments, 1);
  return new Promise(function (resolve) {
    fn.apply(null, args.concat([function (error, value) {
      resolve({ error: error, value: value });
    }]));
  });
}

/* ---------------------------------------------------------------- parsing */

test("parseVersion reads the real aerender banner", function () {
  equal(RN.parseVersion("aerender version 26.5x89\nUSAGE:"), "26.5x89", "version");
  equal(RN.parseVersion("no banner here"), "", "missing banner");
});

test("parseProgress keeps the last PROGRESS line", function () {
  var log = [
    "aerender version 26.5x89",
    "PROGRESS: Launching After Effects...",
    "PROGRESS:  0:00:00:00 (0%)",
    "PROGRESS:  0:00:00:12 (25%)",
    "PROGRESS:  0:00:00:24 (50%)"
  ].join("\n");

  var progress = RN.parseProgress(log);
  assert(progress, "progress was not parsed");
  equal(progress.percent, 50, "percent");
  equal(progress.clock, "0:00:00:24", "clock");
  equal(RN.parseProgress("PROGRESS: Launching After Effects..."), null, "launch line is not a percentage");
});

test("normalizePath cleans file URLs and trailing slashes", function () {
  equal(RN.normalizePath("file:///C:/Media/a.mov"), "C:/Media/a.mov", "file URL");
  equal(RN.normalizePath("C:\\Media\\a.mov\\"), "C:\\Media\\a.mov", "trailing slash");
  equal(RN.normalizePath("/C:/Media/a.mov"), "C:/Media/a.mov", "leading slash");
  equal(RN.normalizePath(null), "", "null");
});

test("classifyFailure turns real aerender errors into advice", function () {
  var realProjectError =
    'aerender Error: After Effects error: Unable to call "openFast" because of parameter 1. ' +
    'Path is not valid. Path: "C:\\nope\\nothing.aep"';
  equal(RN.classifyFailure(realProjectError, 1).code, "project", "bad project path");

  equal(RN.classifyFailure("Permission denied writing the output", 1).code, "output", "permission");
  equal(RN.classifyFailure("Error: missing footage in composition", 1).code, "footage", "missing footage");
  equal(RN.classifyFailure("this app is not activated", 1).code, "licence", "licence");
  equal(RN.classifyFailure("another instance is busy rendering", 1).code, "busy", "busy");
  equal(RN.classifyFailure("something unexpected", 1), null, "unknown text is left alone");
});

test("classifyFailure messages say what to do", function () {
  var failure = RN.classifyFailure('Unable to call "openFast". Path is not valid.', 1);
  assert(/Save the project/.test(failure.message), failure.message);
  assert(/different output folder|Permissions/i.test(RN.classifyFailure("Access is denied", 1).message), "output advice");
});

/* -------------------------------------------------------------- processes */

test("spawnJob streams lines and reports the exit code", function () {
  var script =
    "process.stdout.write('first\\n');" +
    "setTimeout(function(){ process.stdout.write('PROGRESS:  0:00:00:12 (50%)\\n'); process.exit(0); }, 30);";

  return new Promise(function (resolve, reject) {
    var lines = [];
    RN.spawnJob(process.execPath, ["-e", script], {
      onLine: function (line) {
        lines.push(line);
      },
      onDone: function (error, value) {
        try {
          assert(!error, "unexpected error: " + JSON.stringify(error));
          equal(value.code, 0, "exit code");
          assert(lines.indexOf("first") >= 0, "first line was not captured: " + lines.join(" | "));
          assert(RN.parseProgress(lines.join("\n")), "progress line was not captured");
          resolve();
        } catch (eCheck) {
          reject(eCheck);
        }
      }
    });
  });
});

test("spawnJob cancel stops the child and says so", function () {
  return new Promise(function (resolve, reject) {
    var handle = RN.spawnJob(process.execPath, ["-e", "setTimeout(function(){}, 30000);"], {
      onDone: function (error) {
        try {
          assert(error, "cancel should report an error");
          equal(error.code, "cancelled", "error code");
          assert(/left alone/.test(error.message), error.message);
          resolve();
        } catch (eCheck) {
          reject(eCheck);
        }
      }
    });

    setTimeout(function () {
      handle.cancel();
    }, 60);
  });
});

test("spawnJob explains a missing executable", function () {
  return new Promise(function (resolve, reject) {
    RN.spawnJob(path.join(os.tmpdir(), "qk-no-such-aerender.exe"), ["-version"], {
      onDone: function (error) {
        try {
          assert(error, "missing executable should fail");
          equal(error.code, "spawn_failed", "error code");
          assert(/aerender/.test(error.message), error.message);
          resolve();
        } catch (eCheck) {
          reject(eCheck);
        }
      }
    });
  });
});

/* ----------------------------------------------------------------- render */

test("render refuses a missing path, project, comp or output", function () {
  function run(options) {
    return new Promise(function (resolve) {
      RN.render(options, {
        onDone: function (error) {
          resolve(error);
        }
      });
    });
  }

  return Promise.all([
    run({ aerender: "", project: "p", comp: "c", output: "o" }),
    run({ aerender: "a", project: "", comp: "c", output: "o" }),
    run({ aerender: "a", project: "p", comp: "", output: "o" }),
    run({ aerender: "a", project: "p", comp: "c", output: "" })
  ]).then(function (errors) {
    equal(errors[0].code, "not_found", "aerender path");
    equal(errors[1].code, "no_project", "project");
    equal(errors[2].code, "no_comp", "comp");
    equal(errors[3].code, "no_output", "output");
  });
});

/* ---------------------------------------------------------- real aerender */

var found = null;

test("locate finds aerender on this machine", function () {
  return callAsync(RN.locate, { afterEffectsPath: "" }).then(function (result) {
    if (result.error || !result.value || !result.value.ok) {
      skip("locate finds aerender on this machine", "After Effects is not installed here");
      return;
    }
    found = result.value;
    assert(/aerender\.exe$/i.test(found.path), "unexpected path: " + found.path);
    assert(/\d/.test(found.version), "no version: " + found.version);
    assert(found.tried.length > 0, "no candidates were tried");
  });
});

test("probe rejects a file that is not aerender", function () {
  return callAsync(RN.probe, process.execPath).then(function (result) {
    assert(result.error, "node.exe should not report an aerender version");
    equal(result.error.code, "not_aerender", "error code");
  });
});

test("a real aerender run reports a bad project in plain words", function () {
  if (!found) {
    skip("a real aerender run reports a bad project in plain words", "After Effects is not installed here");
    return;
  }

  var output = path.join(os.tmpdir(), "qk-bridge-test-out.mov");
  try {
    fs.unlinkSync(output);
  } catch (eRemove) {}

  return new Promise(function (resolve, reject) {
    var progressSeen = false;
    RN.render(
      {
        aerender: found.path,
        project: path.join(os.tmpdir(), "qk-no-such-project.aep"),
        comp: "QuickKit test",
        output: output
      },
      {
        onProgress: function () {
          progressSeen = true;
        },
        onDone: function (error) {
          try {
            assert(error, "the run should fail");
            equal(error.code, "project", "error code");
            assert(/Save the project/.test(error.message), error.message);
            assert(!fs.existsSync(output), "no output file should be left behind");
            assert(progressSeen || true, "progress is best-effort");
            resolve();
          } catch (eCheck) {
            reject(eCheck);
          }
        }
      }
    );
  });
});

/* ------------------------------------------------------------------- run */

(async function run() {
  for (var i = 0; i < tests.length; i++) {
    var entry = tests[i];
    skippedNow = false;
    try {
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
  if (found) console.log("aerender used: " + found.version + " (" + found.path + ")");
  else console.log("aerender used: none found - the real-run tests were skipped");
  console.log(passed + " passed, " + failed + " failed, " + skipped.length + " skipped");
  process.exit(failed ? 1 : 0);
})();
