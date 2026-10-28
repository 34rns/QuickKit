/* QuickKit text preset engine (Part 6C).
 *
 * Presets are plain data: a preset describes which channels move, in which
 * direction, over which edge, with which selector. plan() compiles that data
 * plus the user's parameters into concrete numeric key lists. Nothing here
 * touches After Effects, the DOM or the network, so the same file runs as a
 * page script and under require() in the tests.
 *
 * Channel vocabulary (what the host knows how to key):
 *   layer  opacity   number 0..100 or "base"
 *          position  {dx,dy} pixels or "base"
 *          scale     {mx,my} multipliers of the layer's own scale or "base"
 *          rotation  {deg} degrees added to the layer's own rotation or "base"
 *   animator opacity / blur / tracking  number
 *            position  [x,y] in em
 *            scale     [sx,sy] percent
 *            rotation  degrees
 *
 * A preset's `layer` steps and `animator.selector` keys are JSON. The
 * compiler below is the only code that turns them into keyframes.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QKTextPresets = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var VERSION = 1;

  var CATEGORIES = [
    "Fade",
    "Slide",
    "Scale/Pop",
    "Typewriter",
    "Per-character",
    "Per-word",
    "Blur/Reveal",
    "Rotate/Flip",
    "Glitch",
    "Wave/Bounce",
    "Loop/Idle",
    "Out animations"
  ];

  /* Every exposed parameter, its control and its safe range. Presets choose
     which of these they show; the compiler accepts all of them. */
  var PARAMS = {
    duration: { label: "Duration (s)", type: "number", min: 0.05, max: 60, step: 0.05, fallback: 0.6 },
    delay: { label: "Delay (s)", type: "number", min: 0, max: 60, step: 0.05, fallback: 0 },
    easing: {
      label: "Easing",
      type: "select",
      options: [
        { value: "smooth", label: "Smooth" },
        { value: "snappy", label: "Snappy" },
        { value: "linear", label: "Linear" }
      ],
      fallback: "smooth"
    },
    direction: {
      label: "From",
      type: "select",
      options: [
        { value: "left", label: "Left" },
        { value: "right", label: "Right" },
        { value: "up", label: "Above" },
        { value: "down", label: "Below" }
      ],
      fallback: "up"
    },
    stagger: { label: "Stagger", type: "range", min: 0, max: 100, step: 1, fallback: 0, suffix: "%" },
    overshoot: { label: "Overshoot", type: "range", min: 0, max: 60, step: 1, fallback: 0, suffix: "%" },
    distance: { label: "Distance (px)", type: "number", min: 1, max: 4000, step: 10, fallback: 80 }
  };

  var PARAM_ORDER = ["duration", "delay", "easing", "direction", "stagger", "overshoot", "distance"];

  function num(value, fallback) {
    var parsed = Number(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function copy(value) {
    if (value instanceof Array) {
      var out = [];
      for (var i = 0; i < value.length; i++) out.push(copy(value[i]));
      return out;
    }
    if (value && typeof value === "object") {
      var obj = {};
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) obj[key] = copy(value[key]);
      }
      return obj;
    }
    return value;
  }

  function slug(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function has(items, value) {
    for (var i = 0; i < items.length; i++) if (items[i] === value) return true;
    return false;
  }

  /* --------------------------------------------------------------- presets */

  var IN_FADE = { channel: "opacity", when: "in", keys: [[0, 0], [1, "base"]] };
  var OUT_FADE = { channel: "opacity", when: "out", keys: [[0, "base"], [1, 0]] };

  var PRESETS = [
    /* ------------------------------------------------------------- Fade */
    {
      id: "fade-soft",
      name: "Soft Fade",
      category: "Fade",
      edges: "both",
      note: "Fades the layer's own opacity in, then back out. Works with any text, size or anchor.",
      expose: ["duration", "delay", "easing"],
      preview: { kind: "fade" },
      layer: [IN_FADE, OUT_FADE]
    },
    {
      id: "fade-in",
      name: "Fade In",
      category: "Fade",
      edges: "in",
      note: "A single eased fade from invisible to the layer's current opacity.",
      expose: ["duration", "delay", "easing"],
      preview: { kind: "fade" },
      layer: [IN_FADE]
    },
    {
      id: "fade-late",
      name: "Late Fade",
      category: "Fade",
      edges: "in",
      note: "Holds the layer invisible for a longer delay, then fades it in. Good for staggering whole layers.",
      params: { delay: 0.6, duration: 0.9 },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "fade" },
      layer: [IN_FADE]
    },
    {
      id: "fade-dissolve",
      name: "Dissolve",
      category: "Fade",
      edges: "both",
      note: "A slow smooth dissolve with a longer duration, in and out.",
      params: { duration: 1.2, easing: "smooth" },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "fade" },
      layer: [IN_FADE, OUT_FADE]
    },

    /* ------------------------------------------------------------ Slide */
    {
      id: "slide-left",
      name: "Slide From Left",
      category: "Slide",
      edges: "both",
      note: "Moves the layer in from the left of its own position, then back out the same way.",
      params: { direction: "left" },
      expose: ["duration", "delay", "direction", "distance", "easing"],
      preview: { kind: "slide" },
      layer: [
        { channel: "position", when: "in", keys: [[0, { direction: true }], [1, "base"]] },
        { channel: "position", when: "out", keys: [[0, "base"], [1, { direction: true }]] }
      ]
    },
    {
      id: "slide-right",
      name: "Slide From Right",
      category: "Slide",
      edges: "both",
      note: "Moves the layer in from the right, then back out to the right.",
      params: { direction: "right" },
      expose: ["duration", "delay", "direction", "distance", "easing"],
      preview: { kind: "slide" },
      layer: [
        { channel: "position", when: "in", keys: [[0, { direction: true }], [1, "base"]] },
        { channel: "position", when: "out", keys: [[0, "base"], [1, { direction: true }]] }
      ]
    },
    {
      id: "slide-up",
      name: "Rise Up",
      category: "Slide",
      edges: "both",
      note: "The layer rises into place from below and sinks away again.",
      params: { direction: "down", distance: 50 },
      expose: ["duration", "delay", "direction", "distance", "easing"],
      preview: { kind: "slide" },
      layer: [
        { channel: "position", when: "in", keys: [[0, { direction: true }], [1, "base"]] },
        { channel: "position", when: "out", keys: [[0, "base"], [1, { direction: true }]] }
      ]
    },
    {
      id: "slide-down",
      name: "Drop Down",
      category: "Slide",
      edges: "both",
      note: "The layer drops in from above and lifts away again.",
      params: { direction: "up", distance: 50 },
      expose: ["duration", "delay", "direction", "distance", "easing"],
      preview: { kind: "slide" },
      layer: [
        { channel: "position", when: "in", keys: [[0, { direction: true }], [1, "base"]] },
        { channel: "position", when: "out", keys: [[0, "base"], [1, { direction: true }]] }
      ]
    },
    {
      id: "slide-diagonal",
      name: "Diagonal Drift",
      category: "Slide",
      edges: "in",
      note: "Drifts in on a diagonal, a little further horizontally than vertically.",
      params: { distance: 90 },
      expose: ["duration", "delay", "distance", "easing"],
      preview: { kind: "slide" },
      layer: [{ channel: "position", when: "in", keys: [[0, { move: [-1, 0.6] }], [1, "base"]] }]
    },

    /* -------------------------------------------------------- Scale/Pop */
    {
      id: "pop-soft",
      name: "Soft Pop",
      category: "Scale/Pop",
      edges: "both",
      note: "Scales up from just under full size with a soft landing, then back down.",
      params: { duration: 0.45, overshoot: 4 },
      expose: ["duration", "delay", "easing", "overshoot"],
      preview: { kind: "pop" },
      layer: [
        { channel: "scale", when: "in", keys: [[0, { mul: 0.82 }], [1, "base"]] },
        { channel: "scale", when: "out", keys: [[0, "base"], [1, { mul: 0.82 }]] },
        IN_FADE,
        OUT_FADE
      ]
    },
    {
      id: "pop-punch",
      name: "Punch In",
      category: "Scale/Pop",
      edges: "in",
      note: "Snaps in from 60 per cent with a visible overshoot at the end.",
      params: { duration: 0.3, easing: "snappy", overshoot: 12 },
      expose: ["duration", "delay", "easing", "overshoot"],
      preview: { kind: "pop" },
      layer: [{ channel: "scale", when: "in", keys: [[0, { mul: 0.6 }], [1, "base"]] }, IN_FADE]
    },
    {
      id: "pop-slam",
      name: "Slam Down",
      category: "Scale/Pop",
      edges: "in",
      note: "Falls in from above at full size and slams to the layer's scale.",
      params: { duration: 0.35, easing: "snappy", overshoot: 8, distance: 120 },
      expose: ["duration", "delay", "easing", "overshoot", "distance"],
      preview: { kind: "pop" },
      layer: [
        { channel: "position", when: "in", keys: [[0, { move: [0, -1] }], [1, "base"]] },
        { channel: "scale", when: "in", keys: [[0, { mul: 1.25 }], [1, "base"]] },
        IN_FADE
      ]
    },
    {
      id: "pop-breathe",
      name: "Breathing Scale",
      category: "Scale/Pop",
      edges: "both",
      note: "Grows in from 90 per cent, then shrinks away at the out point.",
      params: { duration: 0.8, easing: "smooth" },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "pop" },
      layer: [
        { channel: "scale", when: "in", keys: [[0, { mul: 0.9 }], [1, "base"]] },
        { channel: "scale", when: "out", keys: [[0, "base"], [1, { mul: 0.9 }]] },
        IN_FADE,
        OUT_FADE
      ]
    },
    {
      id: "pop-shrink",
      name: "Shrink Away",
      category: "Scale/Pop",
      edges: "out",
      note: "Shrinks to 70 per cent while fading out.",
      params: { duration: 0.5, easing: "snappy" },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "pop" },
      layer: [
        { channel: "scale", when: "out", keys: [[0, "base"], [1, { mul: 0.7 }]] },
        OUT_FADE
      ]
    },

    /* -------------------------------------------------------- Typewriter */
    {
      id: "type-classic",
      name: "Typewriter",
      category: "Typewriter",
      edges: "in",
      note: "Reveals characters one at a time with a named, editable text animator.",
      params: { duration: 1.2, easing: "linear" },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "type", chars: true, word: false },
      animator: {
        suffix: "Typewriter",
        basedOn: "characters",
        smoothness: 0,
        props: [{ channel: "opacity", value: 0 }],
        selector: {
          in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] }
        }
      }
    },
    {
      id: "type-soft",
      name: "Soft Type",
      category: "Typewriter",
      edges: "both",
      note: "Types on with a soft edge, then untypes at the out point.",
      params: { duration: 1.4, stagger: 35 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "type", chars: true },
      animator: {
        suffix: "Soft Type",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "blur", value: 10 }],
        selector: {
          in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] },
          out: { start: [[0, 100], [1, 0]], end: [[0, 100], [1, 100]] }
        }
      }
    },
    {
      id: "type-cursor",
      name: "Cursor Type",
      category: "Typewriter",
      edges: "in",
      note: "Hard per-character reveal with no soft edge, like a terminal cursor.",
      params: { duration: 0.9, easing: "linear" },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "type", chars: true },
      animator: {
        suffix: "Cursor Type",
        basedOn: "characters",
        smoothness: 0,
        props: [{ channel: "opacity", value: 0 }],
        selector: { in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] } }
      }
    },
    {
      id: "type-backspace",
      name: "Backspace Out",
      category: "Typewriter",
      edges: "out",
      note: "Deletes characters one by one at the layer's out point.",
      params: { duration: 0.8, easing: "linear" },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "type", chars: true },
      animator: {
        suffix: "Backspace",
        basedOn: "characters",
        smoothness: 0,
        props: [{ channel: "opacity", value: 0 }],
        selector: { out: { start: [[0, 100], [1, 0]], end: [[0, 100], [1, 100]] } }
      }
    },

    /* ----------------------------------------------------- Per-character */
    {
      id: "char-rise",
      name: "Character Rise",
      category: "Per-character",
      edges: "both",
      note: "Characters rise into place one after another, then drop away.",
      params: { duration: 0.7, stagger: 40, distance: 40 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", chars: true },
      animator: {
        suffix: "Character Rise",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "position", em: [0, 0.45] }],
        selector: {
          in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] },
          out: { start: [[0, 100], [1, 0]], end: [[0, 100], [1, 100]] }
        }
      }
    },
    {
      id: "char-cascade",
      name: "Cascade",
      category: "Per-character",
      edges: "in",
      note: "A long staggered cascade from the left, using per-character offsets.",
      params: { duration: 1.1, stagger: 70, distance: 30 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", chars: true },
      animator: {
        suffix: "Cascade",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "position", em: [-0.4, 0.3] }],
        selector: { in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] } }
      }
    },
    {
      id: "char-scatter",
      name: "Scatter In",
      category: "Per-character",
      edges: "in",
      note: "Characters drift in from random-looking offsets and settle.",
      params: { duration: 0.8, stagger: 60, distance: 45 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", chars: true },
      animator: {
        suffix: "Scatter",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "position", em: [0.5, 0.5] }, { channel: "rotation", value: 16 }],
        selector: { in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] } }
      }
    },
    {
      id: "char-spin",
      name: "Character Spin",
      category: "Per-character",
      edges: "in",
      note: "Every character spins into place as it appears.",
      params: { duration: 0.8, stagger: 35 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", chars: true },
      animator: {
        suffix: "Character Spin",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "rotation", value: 45 }, { channel: "position", em: [0, 0.2] }],
        selector: { in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] } }
      }
    },
    {
      id: "char-flip",
      name: "Character Flip",
      category: "Per-character",
      edges: "both",
      note: "Characters flip up into place, then flip away at the out point.",
      params: { duration: 0.9, stagger: 30 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", chars: true },
      animator: {
        suffix: "Character Flip",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "rotation", value: 80 }, { channel: "scale", value: 40 }],
        selector: {
          in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] },
          out: { start: [[0, 100], [1, 0]], end: [[0, 100], [1, 100]] }
        }
      }
    },

    /* --------------------------------------------------------- Per-word */
    {
      id: "word-slide",
      name: "Word Slide",
      category: "Per-word",
      edges: "both",
      note: "Whole words slide in from below, one after another.",
      params: { duration: 0.8, stagger: 45, distance: 35 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", word: true },
      animator: {
        suffix: "Word Slide",
        basedOn: "words",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "position", em: [0, 0.4] }],
        selector: {
          in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] },
          out: { start: [[0, 100], [1, 0]], end: [[0, 100], [1, 100]] }
        }
      }
    },
    {
      id: "word-pop",
      name: "Word Pop",
      category: "Per-word",
      edges: "in",
      note: "Each word pops in at full strength, one word at a time.",
      params: { duration: 0.7, stagger: 30, easing: "snappy" },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", word: true },
      animator: {
        suffix: "Word Pop",
        basedOn: "words",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "scale", value: 55 }],
        selector: { in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] } }
      }
    },
    {
      id: "word-fade",
      name: "Word Fade",
      category: "Per-word",
      edges: "both",
      note: "A gentle word-by-word fade, in and out.",
      params: { duration: 1, stagger: 55 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", word: true },
      animator: {
        suffix: "Word Fade",
        basedOn: "words",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }],
        selector: {
          in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] },
          out: { start: [[0, 100], [1, 0]], end: [[0, 100], [1, 100]] }
        }
      }
    },
    {
      id: "word-shuffle",
      name: "Word Shuffle",
      category: "Per-word",
      edges: "in",
      note: "Words arrive slightly rotated and rise into place.",
      params: { duration: 0.9, stagger: 50 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", word: true },
      animator: {
        suffix: "Word Shuffle",
        basedOn: "words",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "rotation", value: 12 }, { channel: "position", em: [0, 0.25] }],
        selector: { in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] } }
      }
    },

    /* ------------------------------------------------------ Blur/Reveal */
    {
      id: "blur-in",
      name: "Blur In",
      category: "Blur/Reveal",
      edges: "in",
      note: "Characters sharpen out of a blur with a named text animator.",
      params: { duration: 0.7, stagger: 55 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "blur", chars: true },
      animator: {
        suffix: "Blur In",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "blur", value: 18 }],
        selector: { in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] } }
      }
    },
    {
      id: "blur-focus",
      name: "Focus Pull",
      category: "Blur/Reveal",
      edges: "both",
      note: "Pulls focus from soft to sharp, then lets it go soft again.",
      params: { duration: 0.9, stagger: 40 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "blur" },
      layer: [
        { channel: "opacity", when: "in", keys: [[0, 0], [1, "base"]] },
        { channel: "opacity", when: "out", keys: [[0, "base"], [1, 0]] }
      ]
    },
    {
      id: "blur-wipe",
      name: "Blur Wipe",
      category: "Blur/Reveal",
      edges: "in",
      note: "A per-character blur wipe that travels across the line.",
      params: { duration: 1, stagger: 65 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "blur", chars: true },
      animator: {
        suffix: "Blur Wipe",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "blur", value: 26 }, { channel: "position", em: [-0.2, 0] }],
        selector: { in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] } }
      }
    },
    {
      id: "blur-vertical",
      name: "Vertical Reveal",
      category: "Blur/Reveal",
      edges: "in",
      note: "Characters rise out of a vertical blur, so the reveal reads from the baseline.",
      params: { duration: 0.8, stagger: 45 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "blur", chars: true },
      animator: {
        suffix: "Vertical Reveal",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "blur", value: 18 }, { channel: "position", em: [0, 0.3] }],
        selector: { in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] } }
      }
    },
    {
      id: "blur-out",
      name: "Blur Out",
      category: "Blur/Reveal",
      edges: "out",
      note: "Softens and fades the layer away at the out point.",
      params: { duration: 0.7 },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "blur" },
      layer: [OUT_FADE]
    },

    /* -------------------------------------------------------- Rotate/Flip */
    {
      id: "rotate-in",
      name: "Tilt In",
      category: "Rotate/Flip",
      edges: "both",
      note: "Tilts the layer in from an angle and tilts it away again.",
      params: { duration: 0.7, overshoot: 5 },
      expose: ["duration", "delay", "easing", "overshoot"],
      preview: { kind: "rotate" },
      layer: [
        { channel: "rotation", when: "in", keys: [[0, { deg: -14 }], [1, "base"]] },
        { channel: "rotation", when: "out", keys: [[0, "base"], [1, { deg: 14 }]] },
        IN_FADE,
        OUT_FADE
      ]
    },
    {
      id: "flip-y",
      name: "Card Flip",
      category: "Rotate/Flip",
      edges: "in",
      note: "Scales horizontally from zero while tilting, so the text reads like a card flip.",
      params: { duration: 0.55, overshoot: 6 },
      expose: ["duration", "delay", "easing", "overshoot"],
      preview: { kind: "rotate" },
      layer: [
        { channel: "scale", when: "in", keys: [[0, { mulXY: [0, 1] }], [1, "base"]] },
        { channel: "rotation", when: "in", keys: [[0, { deg: -8 }], [1, "base"]] },
        IN_FADE
      ]
    },
    {
      id: "flip-x",
      name: "Vertical Flip",
      category: "Rotate/Flip",
      edges: "in",
      note: "Scales vertically from zero, so the line unfolds upwards.",
      params: { duration: 0.55, overshoot: 6 },
      expose: ["duration", "delay", "easing", "overshoot"],
      preview: { kind: "rotate" },
      layer: [
        { channel: "scale", when: "in", keys: [[0, { mulXY: [1, 0] }], [1, "base"]] },
        IN_FADE
      ]
    },
    {
      id: "spin-out",
      name: "Spin Out",
      category: "Rotate/Flip",
      edges: "out",
      note: "Spins and fades away at the out point.",
      params: { duration: 0.6, easing: "snappy" },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "rotate" },
      layer: [
        { channel: "rotation", when: "out", keys: [[0, "base"], [1, { deg: 30 }]] },
        OUT_FADE
      ]
    },
    {
      id: "rotate-settle",
      name: "Settle Rotate",
      category: "Rotate/Flip",
      edges: "both",
      note: "A slow tilt with an overshoot that settles back to level.",
      params: { duration: 1, overshoot: 10 },
      expose: ["duration", "delay", "easing", "overshoot"],
      preview: { kind: "rotate" },
      layer: [
        { channel: "rotation", when: "in", keys: [[0, { deg: -22 }], [1, "base"]] },
        { channel: "rotation", when: "out", keys: [[0, "base"], [1, { deg: 10 }]] },
        IN_FADE,
        OUT_FADE
      ]
    },

    /* ------------------------------------------------------------ Glitch */
    {
      id: "glitch-rgb",
      name: "RGB Split",
      category: "Glitch",
      edges: "in",
      note: "A short horizontal jitter with hard switches, like a signal locking on.",
      params: { duration: 0.4, easing: "linear", distance: 30 },
      expose: ["duration", "delay", "easing", "distance"],
      preview: { kind: "glitch" },
      layer: [
        {
          channel: "position",
          when: "in",
          ease: "linear",
          keys: [
            [0, { move: [-0.6, 0] }],
            [0.18, { move: [0.6, 0] }],
            [0.34, { move: [-0.3, 0] }],
            [0.52, { move: [0.2, 0] }],
            [1, "base"]
          ]
        },
        {
          channel: "opacity",
          when: "in",
          ease: "linear",
          keys: [[0, 0], [0.12, "base"], [0.2, 30], [0.3, "base"], [0.45, 60], [1, "base"]]
        }
      ]
    },
    {
      id: "glitch-jitter",
      name: "Jitter In",
      category: "Glitch",
      edges: "both",
      note: "Rapid small rotations and opacity flickers on the way in, plus a glitch out.",
      params: { duration: 0.55, easing: "linear" },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "glitch" },
      layer: [
        {
          channel: "rotation",
          when: "in",
          ease: "linear",
          keys: [[0, { deg: -6 }], [0.2, { deg: 4 }], [0.4, { deg: -2 }], [0.6, { deg: 1 }], [1, "base"]]
        },
        {
          channel: "opacity",
          when: "in",
          ease: "linear",
          keys: [[0, 0], [0.1, "base"], [0.18, 25], [0.28, "base"], [0.4, 55], [1, "base"]]
        },
        {
          channel: "rotation",
          when: "out",
          ease: "linear",
          keys: [[0, "base"], [0.3, { deg: 8 }], [0.5, { deg: -5 }], [0.7, { deg: 3 }], [1, { deg: 0 }]]
        },
        { channel: "opacity", when: "out", ease: "linear", keys: [[0, "base"], [0.6, 40], [0.8, "base"], [1, 0]] }
      ]
    },
    {
      id: "glitch-scan",
      name: "Scanline Slip",
      category: "Glitch",
      edges: "in",
      note: "The layer slips vertically in three quick steps before locking into place.",
      params: { duration: 0.5, easing: "linear", distance: 22 },
      expose: ["duration", "delay", "easing", "distance"],
      preview: { kind: "glitch" },
      layer: [
        {
          channel: "position",
          when: "in",
          ease: "linear",
          keys: [
            [0, { move: [0, 0.8] }],
            [0.22, { move: [0, -0.5] }],
            [0.44, { move: [0, 0.3] }],
            [0.66, { move: [0, -0.15] }],
            [1, "base"]
          ]
        },
        { channel: "opacity", when: "in", ease: "linear", keys: [[0, 0], [0.15, "base"], [0.3, 45], [0.5, "base"], [1, "base"]] }
      ]
    },
    {
      id: "glitch-out",
      name: "Signal Loss",
      category: "Glitch",
      edges: "out",
      note: "Breaks the layer apart with jitter and flicker at the out point.",
      params: { duration: 0.45, easing: "linear", distance: 26 },
      expose: ["duration", "delay", "easing", "distance"],
      preview: { kind: "glitch" },
      layer: [
        {
          channel: "position",
          when: "out",
          ease: "linear",
          keys: [
            [0, "base"],
            [0.2, { move: [0.6, 0] }],
            [0.4, { move: [-0.4, 0.1] }],
            [0.6, { move: [0.3, -0.1] }],
            [1, { move: [-0.7, 0] }]
          ]
        },
        {
          channel: "opacity",
          when: "out",
          ease: "linear",
          keys: [[0, "base"], [0.25, 35], [0.4, "base"], [0.6, 20], [0.8, 70], [1, 0]]
        }
      ]
    },

    /* ------------------------------------------------------- Wave/Bounce */
    {
      id: "wave-ripple",
      name: "Ripple",
      category: "Wave/Bounce",
      edges: "both",
      note: "A per-character ripple that travels through the line, in and out.",
      params: { duration: 1, stagger: 60 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", chars: true },
      animator: {
        suffix: "Ripple",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "position", em: [0, -0.35] }],
        selector: {
          in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] },
          out: { start: [[0, 100], [1, 0]], end: [[0, 100], [1, 100]] }
        }
      }
    },
    {
      id: "wave-bounce",
      name: "Bounce Drop",
      category: "Wave/Bounce",
      edges: "in",
      note: "Characters fall in and bounce once before settling.",
      params: { duration: 0.9, stagger: 35, distance: 60 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", chars: true },
      animator: {
        suffix: "Bounce Drop",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "position", em: [0, -0.6] }],
        selector: { in: { start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] } }
      }
    },
    {
      id: "wave-sway",
      name: "Sway Loop",
      category: "Wave/Bounce",
      edges: "both",
      note: "A travelling sway that keeps moving for the layer's whole duration.",
      params: { duration: 1.4, stagger: 70 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "stagger", chars: true },
      animator: {
        suffix: "Sway",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "position", em: [0.18, 0] }],
        selector: {
          loop: { period: 1.6, start: [[0, 0], [1, 100]], end: [[0, 100], [1, 100]] }
        }
      }
    },

    /* --------------------------------------------------------- Loop/Idle */
    {
      id: "loop-float",
      name: "Float Idle",
      category: "Loop/Idle",
      edges: "both",
      note: "A slow vertical float that repeats for the layer's whole duration.",
      params: { duration: 1.6, easing: "smooth", distance: 6 },
      expose: ["duration", "delay", "easing", "distance"],
      preview: { kind: "slide" },
      layer: [
        {
          channel: "position",
          when: "loop",
          period: 1.6,
          keys: [[0, "base"], [0.5, { move: [0, -0.08] }], [1, "base"]]
        }
      ]
    },
    {
      id: "loop-pulse",
      name: "Pulse Idle",
      category: "Loop/Idle",
      edges: "both",
      note: "A gentle repeating scale pulse around the layer's own scale.",
      params: { duration: 1.2, easing: "smooth" },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "pop" },
      layer: [
        {
          channel: "scale",
          when: "loop",
          period: 1.2,
          keys: [[0, "base"], [0.5, { mul: 1.03 }], [1, "base"]]
        }
      ]
    },
    {
      id: "loop-wobble",
      name: "Wobble Idle",
      category: "Loop/Idle",
      edges: "both",
      note: "A small repeating rotation wobble, useful for stickers and badges.",
      params: { duration: 1.8, easing: "smooth" },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "rotate" },
      layer: [
        {
          channel: "rotation",
          when: "loop",
          period: 1.8,
          keys: [[0, "base"], [0.25, { deg: -1.5 }], [0.75, { deg: 1.5 }], [1, "base"]]
        }
      ]
    },
    {
      id: "loop-drift",
      name: "Drift Loop",
      category: "Loop/Idle",
      edges: "both",
      note: "A repeating diagonal drift with a soft fade at the turn.",
      params: { duration: 2.2, easing: "smooth", distance: 10 },
      expose: ["duration", "delay", "easing", "distance"],
      preview: { kind: "slide" },
      layer: [
        {
          channel: "position",
          when: "loop",
          period: 2.2,
          keys: [[0, "base"], [0.5, { move: [0.06, -0.06] }], [1, "base"]]
        }
      ]
    },

    /* ---------------------------------------------------- Out animations */
    {
      id: "out-fade",
      name: "Fade Out",
      category: "Out animations",
      edges: "out",
      note: "Fades the layer out at its out point. No in animation.",
      params: { duration: 0.6 },
      expose: ["duration", "delay", "easing"],
      preview: { kind: "fade" },
      layer: [OUT_FADE]
    },
    {
      id: "out-slide-left",
      name: "Slide Out Left",
      category: "Out animations",
      edges: "out",
      note: "Pushes the layer off to the left at its out point.",
      params: { duration: 0.6, direction: "left", distance: 120 },
      expose: ["duration", "delay", "direction", "distance", "easing"],
      preview: { kind: "slide" },
      layer: [{ channel: "position", when: "out", keys: [[0, "base"], [1, { direction: true }]] }]
    },
    {
      id: "out-drop",
      name: "Drop Away",
      category: "Out animations",
      edges: "out",
      note: "Drops the layer down and fades it out.",
      params: { duration: 0.55, distance: 90 },
      expose: ["duration", "delay", "distance", "easing"],
      preview: { kind: "slide" },
      layer: [
        { channel: "position", when: "out", keys: [[0, "base"], [1, { move: [0, 1] }]] },
        OUT_FADE
      ]
    },
    {
      id: "out-pop",
      name: "Pop Out",
      category: "Out animations",
      edges: "out",
      note: "Snaps up and shrinks away at the out point.",
      params: { duration: 0.4, easing: "snappy", overshoot: 6 },
      expose: ["duration", "delay", "easing", "overshoot"],
      preview: { kind: "pop" },
      layer: [
        { channel: "scale", when: "out", keys: [[0, "base"], [0.6, { mul: 1.08 }], [1, { mul: 0.5 }]] },
        OUT_FADE
      ]
    },
    {
      id: "out-blur",
      name: "Blur Out Soft",
      category: "Out animations",
      edges: "out",
      note: "A slow soft fade with a per-character blur, no in animation.",
      params: { duration: 0.9, stagger: 50 },
      expose: ["duration", "delay", "easing", "stagger"],
      preview: { kind: "blur", chars: true },
      animator: {
        suffix: "Blur Out Soft",
        basedOn: "characters",
        smoothness: "stagger",
        props: [{ channel: "opacity", value: 0 }, { channel: "blur", value: 16 }],
        selector: { out: { start: [[0, 100], [1, 0]], end: [[0, 100], [1, 100]] } }
      }
    },
    {
      id: "out-glitch",
      name: "Glitch Out",
      category: "Out animations",
      edges: "out",
      note: "A short signal-loss exit with hard jitter keyframes.",
      params: { duration: 0.4, easing: "linear", distance: 30 },
      expose: ["duration", "delay", "easing", "distance"],
      preview: { kind: "glitch" },
      layer: [
        {
          channel: "position",
          when: "out",
          ease: "linear",
          keys: [[0, "base"], [0.25, { move: [0.5, 0] }], [0.5, { move: [-0.5, 0] }], [0.75, { move: [0.2, 0] }], [1, { move: [0, 0.4] }]]
        },
        { channel: "opacity", when: "out", ease: "linear", keys: [[0, "base"], [0.4, 30], [0.7, "base"], [1, 0]] }
      ]
    }
  ];

  var BY_ID = {};
  for (var pi = 0; pi < PRESETS.length; pi++) BY_ID[PRESETS[pi].id] = PRESETS[pi];

  /* ------------------------------------------------------------- compile */

  function presetParams(preset, overrides) {
    var out = {};
    var source = preset.params || {};
    var i;
    for (i = 0; i < PARAM_ORDER.length; i++) {
      var key = PARAM_ORDER[i];
      var value = source[key];
      if (value === undefined) value = PARAMS[key].fallback;
      if (overrides && overrides[key] !== undefined && overrides[key] !== null && overrides[key] !== "") {
        value = overrides[key];
      }
      if (key === "duration") value = clamp(num(value, 0.6), 0.05, 60);
      else if (key === "delay") value = clamp(num(value, 0), 0, 60);
      else if (key === "distance") value = clamp(num(value, 80), 1, 4000);
      else if (key === "stagger") value = clamp(num(value, 0), 0, 100);
      else if (key === "overshoot") value = clamp(num(value, 0), 0, 60);
      else if (key === "easing") {
        value = String(value || "smooth");
        if (value !== "smooth" && value !== "snappy" && value !== "linear") value = "smooth";
      } else if (key === "direction") {
        value = String(value || "up");
        if (!has(["left", "right", "up", "down"], value)) value = "up";
      }
      out[key] = value;
    }
    return out;
  }

  function resolveLayerValue(channel, spec, p) {
    if (spec === "base" || spec === undefined) return "base";
    if (channel === "opacity") return clamp(num(spec, 0), 0, 100);
    if (channel === "position") {
      if (spec && spec.direction) {
        var axis = p.direction === "right" ? 1 : p.direction === "left" ? -1 : 0;
        var vertical = p.direction === "down" ? 1 : p.direction === "up" ? -1 : 0;
        return { dx: axis * p.distance, dy: vertical * p.distance };
      }
      var move = spec && spec.move ? spec.move : [0, 0];
      return { dx: num(move[0], 0) * p.distance, dy: num(move[1], 0) * p.distance };
    }
    if (channel === "scale") {
      if (spec && spec.mulXY) return { mx: num(spec.mulXY[0], 1), my: num(spec.mulXY[1], 1) };
      var mul = spec && spec.mul !== undefined ? num(spec.mul, 1) : 1;
      return { mx: mul, my: mul };
    }
    if (channel === "rotation") return { deg: num(spec && spec.deg, 0) };
    return spec;
  }

  /* Adds one overshoot key just before the settled value. Only the simple
     two-key in programs use it, so glitch step patterns stay untouched. */
  function layerKeys(program, p, edges) {
    var keys = [];
    var source = program.keys || [];
    for (var i = 0; i < source.length; i++) {
      keys.push({ at: clamp(num(source[i][0], 0), 0, 1), v: resolveLayerValue(program.channel, source[i][1], p) });
    }
    var overshoot = p.overshoot;
    if (overshoot > 0 && program.when === "in" && edges !== "out" && source.length === 2) {
      var last = keys[keys.length - 1];
      if (last.v === "base") {
        var at = 0.72;
        var v = null;
        if (program.channel === "scale") {
          v = { mx: 1 + overshoot / 100, my: 1 + overshoot / 100 };
        } else if (program.channel === "rotation") {
          var first = keys[0].v;
          var from = first && first.deg !== undefined ? first.deg : 0;
          v = { deg: from < 0 ? overshoot * 0.5 : -overshoot * 0.5 };
        }
        if (v !== null) keys.splice(keys.length - 1, 0, { at: at, v: v });
      }
    }
    return keys;
  }

  function selectorKeys(source, p) {
    var out = [];
    var list = source || [];
    for (var i = 0; i < list.length; i++) {
      out.push({ at: clamp(num(list[i][0], 0), 0, 1), v: clamp(num(list[i][1], 0), 0, 100) });
    }
    return out;
  }

  function plan(presetOrId, overrides) {
    var preset = typeof presetOrId === "string" ? BY_ID[presetOrId] : presetOrId;
    if (!preset) return null;

    var p = presetParams(preset, overrides);
    var edges = preset.edges;
    if (overrides && (overrides.edges === "in" || overrides.edges === "out" || overrides.edges === "both")) {
      edges = overrides.edges;
    }
    if (edges === "in" && preset.edges === "out") edges = "out";
    if (edges === "out" && preset.edges === "in") edges = "in";
    if (preset.edges !== "both") edges = preset.edges;

    var layer = [];
    var steps = preset.layer || [];
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (step.when === "in" && edges === "out") continue;
      if (step.when === "out" && edges === "in") continue;
      layer.push({
        channel: step.channel,
        when: step.when,
        ease: step.ease || p.easing,
        period: step.period || 0,
        keys: layerKeys(step, p, edges)
      });
    }

    var animator = null;
    if (preset.animator) {
      var def = preset.animator;
      var smoothness = def.smoothness === "stagger" ? clamp(p.stagger, 0, 100) : clamp(num(def.smoothness, 0), 0, 100);
      var selectors = [];
      var sIn = def.selector && def.selector.in;
      var sOut = def.selector && def.selector.out;
      var sLoop = def.selector && def.selector.loop;

      if (sLoop && (edges === "in" || edges === "out" || edges === "both")) {
        selectors.push({
          when: "loop",
          period: num(sLoop.period, 1.2),
          ease: p.easing,
          start: selectorKeys(sLoop.start, p),
          end: selectorKeys(sLoop.end, p)
        });
      } else {
        if (sIn && edges !== "out") {
          selectors.push({ when: "in", period: 0, ease: p.easing, start: selectorKeys(sIn.start, p), end: selectorKeys(sIn.end, p) });
        }
        if (sOut && edges !== "in") {
          selectors.push({ when: "out", period: 0, ease: p.easing, start: selectorKeys(sOut.start, p), end: selectorKeys(sOut.end, p) });
        }
      }

      if (selectors.length) {
        var props = [];
        var defProps = def.props || [];
        for (var k = 0; k < defProps.length; k++) {
          var prop = defProps[k];
          var value = prop.value;
          if (prop.em) value = [num(prop.em[0], 0), num(prop.em[1], 0)];
          if (prop.scale !== undefined) value = [num(prop.scale, 100), num(prop.scale, 100)];
          props.push({ channel: prop.channel, value: value, unit: prop.em ? "em" : "" });
        }
        animator = {
          name: "QuickKit " + (def.suffix || preset.name),
          basedOn: def.basedOn || "characters",
          smoothness: smoothness,
          props: props,
          selectors: selectors
        };
      }
    }

    if (!layer.length && !animator) return null;

    return {
      v: VERSION,
      id: preset.id,
      name: preset.name,
      category: preset.category,
      note: preset.note,
      edges: edges,
      params: p,
      inDuration: p.duration,
      outDuration: p.duration,
      layer: layer,
      animator: animator
    };
  }

  function defaultPlan(id) {
    return plan(id, null);
  }

  function byId(id) {
    return BY_ID[id] || null;
  }

  function categories() {
    var out = [];
    for (var i = 0; i < CATEGORIES.length; i++) {
      var name = CATEGORIES[i];
      var count = 0;
      for (var k = 0; k < PRESETS.length; k++) if (PRESETS[k].category === name) count++;
      out.push({ name: name, count: count });
    }
    return out;
  }

  function inCategory(name) {
    var out = [];
    for (var i = 0; i < PRESETS.length; i++) {
      if (!name || name === "all" || PRESETS[i].category === name) out.push(PRESETS[i]);
    }
    return out;
  }

  /* For the DOM stage preview: what kind of pose to paint and whether the
     sample should be split. */
  function previewLook(id) {
    var preset = byId(id) || PRESETS[0];
    var preview = preset.preview || { kind: "fade" };
    return {
      kind: preview.kind || "fade",
      chars: !!preview.chars,
      word: !!preview.word,
      direction: (preset.params && preset.params.direction) || "up"
    };
  }

  function exportName(preset) {
    var value = typeof preset === "string" ? byId(preset) : preset;
    if (!value) return "QuickKit Text Preset";
    return value.name;
  }

  return {
    VERSION: VERSION,
    CATEGORIES: CATEGORIES,
    PARAMS: PARAMS,
    PARAM_ORDER: PARAM_ORDER,
    PRESETS: PRESETS,
    presetParams: presetParams,
    plan: plan,
    defaultPlan: defaultPlan,
    byId: byId,
    categories: categories,
    inCategory: inCategory,
    previewLook: previewLook,
    exportName: exportName,
    slug: slug,
    num: num,
    clamp: clamp,
    copy: copy
  };
});
