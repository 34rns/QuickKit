/* QuickKit preview core (Part 6B).
 *
 * Pure playback and approximation maths, no DOM, no Node, no network:
 *   - the speed list and the play/pause/scrub helpers the preview pane uses;
 *   - the easing curves used by the canvas approximation;
 *   - which approximation fits an item (from its name, category and tags);
 *   - the pose of the sample word at a given progress, so the panel only has
 *     to paint numbers this file returns;
 *   - which items still need a rendered preview (batch planning).
 *
 * Loaded as a page script by the panel and by require() in tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QKPreviewCore = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var SPEEDS = [0.5, 1, 2];
  var LOOP_MIN = 0.4;
  var LOOP_MAX = 12;

  var KINDS = {
    fade: "Fade",
    slide: "Slide",
    scale: "Scale pop",
    type: "Type on",
    wipe: "Wipe",
    blur: "Blur in",
    rotate: "Rotate in"
  };

  /* Ordered: the first match wins, so "wipe" beats the generic "text". */
  var KIND_WORDS = [
    { kind: "wipe", test: /wipe|reveal|mask|curtain|shutter/ },
    { kind: "rotate", test: /rotate|spin|turn|flip/ },
    { kind: "blur", test: /blur|soft|focus|glow/ },
    /* Word order matters: "Caption pop" is a text animation that happens to
       pop, so the text kind is checked before the scale words. */
    { kind: "type", test: /type|kinetic|character|stagger|subtitle|caption|text/ },
    { kind: "scale", test: /scale|pop|punch|zoom|burst|bounce|bump|impact/ },
    { kind: "slide", test: /slide|push|move|drift|rise|drop|swoop|swipe/ },
    { kind: "fade", test: /fade|opacity|dissolve|appear|in\b/ }
  ];

  function num(value, fallback) {
    var parsed = Number(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function clampTime(time, duration) {
    var span = num(duration, 0);
    if (span <= 0) return 0;
    return clamp(num(time, 0), 0, span);
  }

  /* m:ss.t — previews are seconds long, so a plain "1:02" would read as a
     minute and two seconds. Always one decimal, always zero-padded. */
  function formatClock(seconds) {
    var value = Math.max(0, num(seconds, 0));
    var whole = Math.floor(value);
    var tenths = Math.floor((value - whole) * 10 + 0.0001);
    var minutes = Math.floor(whole / 60);
    var rest = whole % 60;
    return minutes + ":" + (rest < 10 ? "0" + rest : rest) + "." + tenths;
  }

  /* 0.5 -> 1 -> 2 -> 0.5, so one button cycles every speed. */
  function nextSpeed(speed) {
    var at = SPEEDS.indexOf(num(speed, 1));
    if (at < 0) return 1;
    return SPEEDS[(at + 1) % SPEEDS.length];
  }

  function easingFn(name) {
    if (name === "linear") {
      return function (t) {
        return clamp(t, 0, 1);
      };
    }
    if (name === "snap") {
      return function (t) {
        var x = clamp(t, 0, 1);
        return 1 - Math.pow(1 - x, 6);
      };
    }
    if (name === "bounce") {
      return function (t) {
        var x = clamp(t, 0, 1);
        var n1 = 7.5625;
        var d1 = 2.75;
        if (x < 1 / d1) return n1 * x * x;
        if (x < 2 / d1) {
          x -= 1.5 / d1;
          return n1 * x * x + 0.75;
        }
        if (x < 2.5 / d1) {
          x -= 2.25 / d1;
          return n1 * x * x + 0.9375;
        }
        x -= 2.625 / d1;
        return n1 * x * x + 0.984375;
      };
    }
    /* smooth: fast out, soft landing — the default everywhere in QuickKit */
    return function (t) {
      var x = clamp(t, 0, 1);
      return 1 - Math.pow(1 - x, 3);
    };
  }

  function itemWords(item) {
    if (!item) return "";
    var tags = item.tags && item.tags.length ? " " + item.tags.join(" ") : "";
    return String(item.name || "") + " " + String(item.category || "") + tags;
  }

  /* Which approximation to draw when no rendered preview exists. Every item
     gets one, so the pane is never empty for a selected item. */
  function approxFor(item) {
    if (!item) return null;
    var type = String(item.type || "");
    if (type === "pack") return null;

    var words = itemWords(item).toLowerCase();
    var kind = "fade";
    for (var i = 0; i < KIND_WORDS.length; i++) {
      if (KIND_WORDS[i].test.test(words)) {
        kind = KIND_WORDS[i].kind;
        break;
      }
    }

    var params = item.params && typeof item.params === "object" ? item.params : {};
    var easing = params.easing || "smooth";
    var direction = params.direction || "in";
    var distance = num(params.distance, 40);
    var duration = clamp(num(params.duration, 1.2), LOOP_MIN, LOOP_MAX);

    return {
      kind: kind,
      label: KINDS[kind] + " approximation",
      easing: easing,
      direction: direction,
      distance: distance,
      duration: duration
    };
  }

  /* Pose of the sample word for eased progress `t` (0..1) over one loop.
     Directions "left/right/up/down" name where the word comes FROM. */
  function sampleAt(kind, t, options) {
    var opts = options || {};
    var direction = opts.direction || "in";
    var distance = num(opts.distance, 40);
    var pose = { opacity: 1, dx: 0, dy: 0, scale: 1, blur: 0, clip: 1, rotate: 0 };

    /* "both" plays in and then out again inside the same loop. */
    var progress = clamp(t, 0, 1);
    if (direction === "both") {
      if (progress <= 0.5) {
        progress = progress * 2;
      } else {
        progress = 1;
        pose.opacity = clamp(1 - (t - 0.5) * 2, 0, 1);
      }
    }

    if (kind === "fade") {
      pose.opacity = Math.min(pose.opacity, progress);
      return pose;
    }
    if (kind === "scale") {
      pose.opacity = Math.min(pose.opacity, progress);
      pose.scale = 0.72 + 0.28 * progress;
      return pose;
    }
    if (kind === "blur") {
      pose.opacity = Math.min(pose.opacity, progress);
      pose.blur = (1 - progress) * 8;
      return pose;
    }
    if (kind === "rotate") {
      pose.opacity = Math.min(pose.opacity, progress);
      pose.rotate = (1 - progress) * -18;
      return pose;
    }
    if (kind === "type") {
      pose.clip = progress;
      return pose;
    }
    if (kind === "wipe") {
      pose.clip = progress;
      return pose;
    }
    /* slide */
    var shift = (1 - progress) * distance;
    if (direction === "right" || direction === "left") {
      pose.dx = direction === "right" ? -shift : shift;
    } else if (direction === "down" || direction === "up") {
      pose.dy = direction === "down" ? -shift : shift;
    } else {
      pose.dy = shift;
    }
    return pose;
  }

  /* Items the batch generator should work through: After Effects presets that
     claim After Effects support, carry a file the host can actually apply,
     and whose preview is missing or stale. */
  function planGeneration(items, stateOf) {
    var out = [];
    var list = items || [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item) continue;
      if (item.type !== "ae-preset") continue;
      if (!item.hostSupport || item.hostSupport.indexOf("AEFT") < 0) continue;
      if (!/\.(qkpreset|qktextpreset|ffx)$/.test(String(item.asset || "").toLowerCase())) continue;
      var state = typeof stateOf === "function" ? stateOf(item) : "none";
      if (state === "ready") continue;
      out.push(item);
    }
    return out;
  }

  return {
    SPEEDS: SPEEDS,
    KINDS: KINDS,
    easingFn: easingFn,
    nextSpeed: nextSpeed,
    clampTime: clampTime,
    formatClock: formatClock,
    approxFor: approxFor,
    sampleAt: sampleAt,
    planGeneration: planGeneration
  };
});
