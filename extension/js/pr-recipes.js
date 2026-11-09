/* QuickKit Premiere keyframe recipe engine (Part 6D).
 *
 * Recipes are plain data: which channels move, over which edge of the clip,
 * and how far. plan() compiles a recipe plus the user's parameters into
 * concrete key lists in a small, host-validated vocabulary. Nothing here
 * touches Premiere, the DOM or the network, so the same file runs as a page
 * script and under require() in the tests.
 *
 * Channel vocabulary (what the host knows how to key):
 *   opacity   number 0..100 or "base" (the clip's current opacity)
 *   position  {dx,dy} fractions of the frame size, or "base"
 *   scale     multiplier of the clip's current scale, or "base"
 *   rotation  degrees added to the clip's current rotation, or "base"
 *
 * A key is { edge: "in"|"out", at: 0..1, value|dx|dy }. The host maps `at`
 * into the clip's in or out window, so the engine never needs a frame rate.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QKRecipes = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var VERSION = 1;

  var CATEGORIES = ["Fade", "Slide", "Scale", "Motion"];

  var PARAMS = {
    duration: { key: "duration", label: "Duration", kind: "number", min: 0.2, max: 3, step: 0.1, unit: " s", value: 0.6 },
    easing: { key: "easing", label: "Easing", kind: "choice", value: "smooth",
      options: [
        { value: "smooth", label: "Smooth" },
        { value: "linear", label: "Linear" },
        { value: "hold", label: "Hold" }
      ] },
    amount: { key: "amount", label: "Amount", kind: "number", min: 0, max: 200, step: 5, unit: " %", value: 100 },
    direction: { key: "direction", label: "From / to", kind: "choice", value: "left",
      options: [
        { value: "left", label: "Left" },
        { value: "right", label: "Right" },
        { value: "up", label: "Top" },
        { value: "down", label: "Bottom" }
      ] }
  };

  var PARAM_ORDER = ["duration", "easing", "amount", "direction"];

  /* A recipe's `motion` is data. `from`/`to` are either a channel value or
     "base"; `keys` is a list of stops. `side` means "the side named by the
     direction parameter". Every number is scaled by `amount`. */
  var RECIPES = [
    {
      id: "fade-in", name: "Fade In", category: "Fade", edges: "in",
      params: ["duration", "easing", "amount"],
      note: "Opacity rises from transparent to the clip's own opacity.",
      motion: { opacity: { in: { from: 0, to: "base" } } }
    },
    {
      id: "fade-out", name: "Fade Out", category: "Fade", edges: "out",
      params: ["duration", "easing", "amount"],
      note: "Opacity falls from the clip's own opacity to transparent.",
      motion: { opacity: { out: { from: "base", to: 0 } } }
    },
    {
      id: "fade-both", name: "Fade In and Out", category: "Fade", edges: "both",
      params: ["duration", "easing", "amount"],
      note: "Fades in at the clip's in point and out at its out point.",
      motion: {
        opacity: {
          in: { from: 0, to: "base" },
          out: { from: "base", to: 0 }
        }
      }
    },
    {
      id: "slide-in-left", name: "Slide In From Left", category: "Slide", edges: "in",
      params: ["duration", "easing", "amount", "direction"],
      note: "The clip enters from the chosen side and settles where it was.",
      motion: { position: { in: { from: "side", to: "base" } } }
    },
    {
      id: "slide-in-right", name: "Slide In From Right", category: "Slide", edges: "in",
      params: ["duration", "easing", "amount", "direction"],
      note: "The clip enters from the chosen side and settles where it was.",
      motion: { position: { in: { from: "side", to: "base" } } }
    },
    {
      id: "slide-in-up", name: "Slide In From Top", category: "Slide", edges: "in",
      params: ["duration", "easing", "amount", "direction"],
      note: "The clip enters from the chosen side and settles where it was.",
      motion: { position: { in: { from: "side", to: "base" } } }
    },
    {
      id: "slide-in-down", name: "Slide In From Bottom", category: "Slide", edges: "in",
      params: ["duration", "easing", "amount", "direction"],
      note: "The clip enters from the chosen side and settles where it was.",
      motion: { position: { in: { from: "side", to: "base" } } }
    },
    {
      id: "slide-out-left", name: "Slide Out To Left", category: "Slide", edges: "out",
      params: ["duration", "easing", "amount", "direction"],
      note: "The clip leaves towards the chosen side.",
      motion: { position: { out: { from: "base", to: "side" } } }
    },
    {
      id: "slide-out-right", name: "Slide Out To Right", category: "Slide", edges: "out",
      params: ["duration", "easing", "amount", "direction"],
      note: "The clip leaves towards the chosen side.",
      motion: { position: { out: { from: "base", to: "side" } } }
    },
    {
      id: "slide-out-up", name: "Slide Out To Top", category: "Slide", edges: "out",
      params: ["duration", "easing", "amount", "direction"],
      note: "The clip leaves towards the chosen side.",
      motion: { position: { out: { from: "base", to: "side" } } }
    },
    {
      id: "slide-out-down", name: "Slide Out To Bottom", category: "Slide", edges: "out",
      params: ["duration", "easing", "amount", "direction"],
      note: "The clip leaves towards the chosen side.",
      motion: { position: { out: { from: "base", to: "side" } } }
    },
    {
      id: "scale-pop", name: "Scale Pop", category: "Scale", edges: "in",
      params: ["duration", "easing", "amount"],
      note: "Scales up from 60% with a small overshoot, and fades in.",
      motion: {
        opacity: { in: { from: 0, to: "base" } },
        scale: { in: { keys: [{ at: 0, v: 0.6 }, { at: 0.65, v: 1.08 }, { at: 1, v: "base" }] } }
      }
    },
    {
      id: "scale-pop-out", name: "Scale Pop Out", category: "Scale", edges: "out",
      params: ["duration", "easing", "amount"],
      note: "Pushes past full size, then shrinks away and fades out.",
      motion: {
        opacity: { out: { from: "base", to: 0 } },
        scale: { out: { keys: [{ at: 0, v: "base" }, { at: 0.35, v: 1.08 }, { at: 1, v: 0.6 }] } }
      }
    },
    {
      id: "zoom-in", name: "Zoom In", category: "Scale", edges: "in",
      params: ["duration", "easing", "amount"],
      note: "Slowly pushes in from the clip's own scale over the in window.",
      motion: { scale: { in: { from: "base", to: 1.25 } } }
    },
    {
      id: "zoom-out", name: "Zoom Out", category: "Scale", edges: "out",
      params: ["duration", "easing", "amount"],
      note: "Pulls back from the clip's own scale over the out window.",
      motion: { scale: { out: { from: "base", to: 0.8 } } }
    },
    {
      id: "shake", name: "Shake", category: "Motion", edges: "in",
      params: ["duration", "easing", "amount"],
      note: "A short horizontal and vertical shake that settles on the clip.",
      motion: {
        position: {
          in: {
            keys: [
              { at: 0, dx: 0, dy: 0 },
              { at: 0.12, dx: -0.035, dy: 0.02 },
              { at: 0.28, dx: 0.03, dy: -0.022 },
              { at: 0.46, dx: -0.024, dy: 0.016 },
              { at: 0.64, dx: 0.018, dy: -0.012 },
              { at: 0.82, dx: -0.01, dy: 0.007 },
              { at: 1, dx: 0, dy: 0 }
            ]
          }
        }
      }
    },
    {
      id: "spin", name: "Spin In", category: "Motion", edges: "in",
      params: ["duration", "easing", "amount"],
      note: "Rotates the clip into place from the chosen offset.",
      motion: { rotation: { in: { from: -180, to: "base" } } }
    },
    {
      id: "flicker", name: "Flicker In", category: "Motion", edges: "in",
      params: ["duration", "easing", "amount"],
      note: "Rapid opacity dips that lock on at the end of the window.",
      motion: {
        opacity: {
          in: {
            keys: [
              { at: 0, v: 0 },
              { at: 0.1, v: 100 },
              { at: 0.2, v: 15 },
              { at: 0.32, v: 100 },
              { at: 0.44, v: 35 },
              { at: 0.58, v: 100 },
              { at: 0.7, v: 60 },
              { at: 0.84, v: 100 },
              { at: 1, v: "base" }
            ]
          }
        }
      }
    }
  ];

  function clamp(value, low, high) {
    var number = Number(value);
    if (isNaN(number)) number = low;
    if (number < low) return low;
    if (number > high) return high;
    return number;
  }

  function num(value, fallback) {
    var number = Number(value);
    return isNaN(number) ? fallback : number;
  }

  function copy(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function byId(id) {
    var wanted = String(id || "");
    for (var i = 0; i < RECIPES.length; i++) {
      if (RECIPES[i].id === wanted) return RECIPES[i];
    }
    return null;
  }

  function paramDef(key) {
    return PARAMS[key] || null;
  }

  function defaultDirection(recipe) {
    if (!recipe) return "left";
    var id = recipe.id;
    if (/right$/.test(id)) return "right";
    if (/-up$/.test(id)) return "up";
    if (/-down$/.test(id)) return "down";
    return "left";
  }

  /* Normalized parameters for one recipe. Unknown keys are dropped, numbers
     are clamped, and a direction only exists when the recipe exposes one. */
  function recipeParams(recipe, input) {
    var source = input || {};
    var out = {};
    var exposed = recipe && recipe.params ? recipe.params : PARAM_ORDER;
    for (var i = 0; i < PARAM_ORDER.length; i++) {
      var key = PARAM_ORDER[i];
      if (exposed.indexOf(key) < 0) continue;
      var def = PARAMS[key];
      if (def.kind === "number") {
        out[key] = clamp(source[key] === undefined ? def.value : source[key], def.min, def.max);
      } else if (key === "easing") {
        out.easing = "smooth";
        for (var e = 0; e < def.options.length; e++) {
          if (def.options[e].value === source.easing) out.easing = source.easing;
        }
      } else if (key === "direction") {
        out.direction = defaultDirection(recipe);
        for (var d = 0; d < def.options.length; d++) {
          if (def.options[d].value === source.direction) out.direction = source.direction;
        }
      }
    }
    return out;
  }

  function sideVector(direction, distance) {
    if (direction === "right") return { dx: distance, dy: 0 };
    if (direction === "up") return { dx: 0, dy: -distance };
    if (direction === "down") return { dx: 0, dy: distance };
    return { dx: -distance, dy: 0 };
  }

  function scaledOpacity(value, amount) {
    if (value === "base") return value;
    var base = 100 - (100 - num(value, 0)) * (amount / 100);
    return clamp(base, 0, 100);
  }

  function scaledPosition(point, amount) {
    return { dx: num(point.dx, 0) * (amount / 100), dy: num(point.dy, 0) * (amount / 100) };
  }

  function scaledScale(value, amount) {
    if (value === "base") return value;
    var multiplier = num(value, 1);
    return 1 + (multiplier - 1) * (amount / 100);
  }

  function scaledRotation(value, amount) {
    if (value === "base") return value;
    return num(value, 0) * (amount / 100);
  }

  function edgeKeys(channel, spec, params) {
    var keys = [];
    var amount = params.amount;
    var distance = 0.4 * (amount / 100);
    var edges = ["in", "out"];
    for (var e = 0; e < edges.length; e++) {
      var edge = edges[e];
      var part = spec[edge];
      if (!part) continue;
      if (part.keys && part.keys.length) {
        for (var k = 0; k < part.keys.length; k++) {
          var stop = part.keys[k];
          var key = { edge: edge, at: clamp(stop.at, 0, 1) };
          if (channel === "position") {
            key.dx = num(stop.dx, 0) * (amount / 100);
            key.dy = num(stop.dy, 0) * (amount / 100);
          } else if (channel === "opacity") {
            key.value = scaledOpacity(stop.v, amount);
          } else if (channel === "scale") {
            key.value = scaledScale(stop.v, amount);
          } else {
            key.value = scaledRotation(stop.v, amount);
          }
          keys.push(key);
        }
        continue;
      }
      var from = part.from;
      var to = part.to;
      if (channel === "position") {
        var startPoint = from === "side" ? sideVector(params.direction, distance) : scaledPosition(from, amount);
        var endPoint = to === "side" ? sideVector(params.direction, distance) : scaledPosition(to, amount);
        keys.push({ edge: edge, at: 0, dx: startPoint.dx, dy: startPoint.dy });
        keys.push({ edge: edge, at: 1, dx: endPoint.dx, dy: endPoint.dy });
      } else if (channel === "opacity") {
        keys.push({ edge: edge, at: 0, value: scaledOpacity(from, amount) });
        keys.push({ edge: edge, at: 1, value: scaledOpacity(to, amount) });
      } else if (channel === "scale") {
        keys.push({ edge: edge, at: 0, value: scaledScale(from, amount) });
        keys.push({ edge: edge, at: 1, value: scaledScale(to, amount) });
      } else if (channel === "rotation") {
        keys.push({ edge: edge, at: 0, value: scaledRotation(from, amount) });
        keys.push({ edge: edge, at: 1, value: scaledRotation(to, amount) });
      }
    }
    keys.sort(function (a, b) {
      if (a.edge !== b.edge) return a.edge === "in" ? -1 : 1;
      return a.at - b.at;
    });
    return keys;
  }

  /* Compiles a recipe + parameters into a JSON-safe plan. */
  function plan(recipe, input) {
    var def = typeof recipe === "string" ? byId(recipe) : recipe;
    if (!def) return null;
    var params = recipeParams(def, input);
    var channels = {};
    var names = ["opacity", "position", "scale", "rotation"];
    var any = false;
    for (var i = 0; i < names.length; i++) {
      var spec = def.motion ? def.motion[names[i]] : null;
      if (!spec) continue;
      var keys = edgeKeys(names[i], spec, params);
      if (keys.length) {
        channels[names[i]] = keys;
        any = true;
      }
    }
    if (!any) return null;
    return {
      version: VERSION,
      id: def.id,
      name: def.name,
      category: def.category,
      edges: def.edges,
      easing: params.easing,
      duration: params.duration,
      amount: params.amount,
      direction: params.direction || "",
      channels: channels
    };
  }

  function defaultPlan(id) {
    var recipe = byId(id);
    if (!recipe) return null;
    return plan(recipe, recipeParams(recipe, {}));
  }

  function categories() {
    var out = [];
    for (var i = 0; i < CATEGORIES.length; i++) {
      var name = CATEGORIES[i];
      var count = 0;
      for (var j = 0; j < RECIPES.length; j++) {
        if (RECIPES[j].category === name) count++;
      }
      out.push({ name: name, count: count });
    }
    return out;
  }

  function inCategory(name) {
    var out = [];
    for (var i = 0; i < RECIPES.length; i++) {
      if (RECIPES[i].category === name) out.push(RECIPES[i]);
    }
    return out;
  }

  function exportedName(recipe) {
    var value = typeof recipe === "string" ? byId(recipe) : recipe;
    return value ? value.name : "QuickKit Premiere Recipe";
  }

  return {
    VERSION: VERSION,
    CATEGORIES: CATEGORIES,
    PARAMS: PARAMS,
    PARAM_ORDER: PARAM_ORDER,
    RECIPES: RECIPES,
    recipeParams: recipeParams,
    plan: plan,
    defaultPlan: defaultPlan,
    byId: byId,
    categories: categories,
    inCategory: inCategory,
    exportedName: exportedName,
    defaultDirection: defaultDirection,
    num: num,
    clamp: clamp,
    copy: copy
  };
});
