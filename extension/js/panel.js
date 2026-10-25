/* QuickKit panel controller.
   Plain browser + CEP. Every host call goes through the ExtendScript adapter;
   nothing here talks to the network. */
(function (window, document) {
  "use strict";

  var VERSION = "0.3.0";
  var WELCOME_KEY = "qk.welcome.v1";
  var HOST_TEST_TIMEOUT = 8000;
  var ACTION_TIMEOUT = 15000;
  var TIP_GAP = 6;
  var TIP_MARGIN = 8;

  var HOST_NAMES = { AEFT: "After Effects", PPRO: "Premiere Pro", UNKNOWN: "Adobe app" };

  var EASING = {
    easy: {
      path: "M 4 96 C 28 96 30 4 96 4",
      note: "Smooth acceleration in and out. The everyday default."
    },
    strong: {
      path: "M 4 96 C 12 96 14 4 96 4",
      note: "Sharper hold at both ends, faster through the middle."
    },
    overshoot: {
      path: "M 4 96 C 32 96 46 26 62 8 C 74 3 86 12 96 18",
      note: "Slides past the end value, then settles. Adds two keyframes."
    },
    bounce: {
      path: "M 4 96 C 26 96 42 24 58 18 C 64 34 70 18 78 24 C 84 30 88 18 96 18",
      note: "Springs back a few times before settling. Adds four keyframes."
    }
  };

  var TEXT_PRESETS = {
    fade: {
      note: "Fades the layer's own opacity from 0 to its current value, then back to 0.",
      chars: false
    },
    slide: {
      note: "Moves the layer's own position in from the chosen side, then back out.",
      chars: false
    },
    pop: {
      note: "Scales the layer from 80 per cent up to its current scale, eased at both ends.",
      chars: false
    },
    typewriter: {
      note: "Adds a named QuickKit Typewriter animator. Characters are revealed by a range selector, so the text stays editable.",
      chars: true
    },
    stagger: {
      note: "Adds a named QuickKit Character Stagger animator: characters fade in with a rising offset, then fade out.",
      chars: true
    },
    blur: {
      note: "Adds a named QuickKit Blur Reveal animator: characters sharpen out of a blur, then soften again.",
      chars: true
    }
  };

  var TEXT_EASING = {
    smooth: "cubic-bezier(0.33, 0, 0.67, 1)",
    snappy: "cubic-bezier(0.2, 0.9, 0.1, 1)",
    linear: "linear"
  };

  var TEXT_PREVIEW_HOLD = 0.35;

  var TABS = [
    {
      id: "anchor",
      label: "Anchor",
      icon: "anchor",
      host: "AEFT",
      panelId: "anchor",
      body: "Center or offset an anchor point without moving the layer.",
      hostNote: "Anchor tools use After Effects layer geometry."
    },
    {
      id: "presets",
      label: "Presets",
      icon: "presets",
      host: "AEFT",
      body: "Save your own animation presets and apply them in one click.",
      hostNote: "Presets rely on After Effects .ffx files."
    },
    {
      id: "text",
      label: "Text",
      icon: "text",
      host: "AEFT",
      panelId: "text",
      body: "Text tools for titles, captions and lower thirds.",
      hostNote: "Text animations use After Effects text layers and animators."
    },
    {
      id: "easing",
      label: "Easing",
      icon: "easing",
      host: "AEFT",
      panelId: "easing",
      body: "Apply and fine-tune easing curves on keyframes.",
      hostNote: "Easing writes keyframe interpolation in After Effects."
    },
    {
      id: "layers",
      label: "Layers",
      icon: "layers",
      host: "AEFT",
      panelId: "layers",
      body: "Layer utilities: rename, stagger, parent, sequence and precompose.",
      hostNote: "Layer tools act on the After Effects Timeline selection."
    },
    {
      id: "silence",
      label: "Silence",
      icon: "silence",
      host: "PPRO",
      body: "Find silent gaps and cut them out of a sequence.",
      hostNote: "Silence detection runs on Premiere Pro sequences."
    },
    {
      id: "bridge",
      label: "Bridge",
      icon: "bridge",
      host: null,
      body: "Send selected work between After Effects and Premiere Pro."
    }
  ];

  var state = {
    hostId: null,
    hostVersion: "",
    hosted: false,
    preview: false,
    activeTab: "anchor",
    easing: "easy",
    textPreset: "fade",
    textAnimations: [],
    textTimer: null,
    textResetTimer: null,
    busy: false,
    undoHinted: false
  };

  var els = {};
  var lastFocused = null;

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function tabById(id) {
    for (var i = 0; i < TABS.length; i++) {
      if (TABS[i].id === id) return TABS[i];
    }
    return null;
  }

  function tabIndex(id) {
    for (var i = 0; i < TABS.length; i++) {
      if (TABS[i].id === id) return i;
    }
    return 0;
  }

  function normalizeHost(name) {
    var value = String(name || "").toUpperCase();
    if (value === "AEFT" || value === "PPRO") return value;
    return "UNKNOWN";
  }

  function currentHostLabel() {
    if (state.hosted) {
      var name = HOST_NAMES[state.hostId] || "Adobe app";
      return state.hostVersion ? name + " " + state.hostVersion : name;
    }
    if (state.hostId) return HOST_NAMES[state.hostId] + " (preview)";
    return "browser preview";
  }

  /* ---------- boot ---------- */

  function boot() {
    els.tabs = document.getElementById("qk-tabs");
    els.content = document.getElementById("qk-content");
    els.hostState = document.getElementById("qk-host-state");
    els.hostValue = document.getElementById("qk-host-value");
    els.hostDetail = document.getElementById("qk-host-detail");
    els.tip = document.getElementById("qk-tooltip");
    els.lastAction = document.getElementById("qk-last-action");
    els.test = document.getElementById("qk-test-host");
    els.undo = document.getElementById("qk-undo");
    els.welcome = document.getElementById("qk-welcome");
    els.welcomeOk = document.getElementById("qk-welcome-ok");
    els.welcomeClose = document.getElementById("qk-welcome-close");
    els.help = document.getElementById("qk-help");
    els.version = document.getElementById("qk-version");
    els.message = document.getElementById("qk-message");
    els.messageIcon = document.getElementById("qk-message-icon");
    els.messageText = document.getElementById("qk-message-text");
    els.empty = document.getElementById("qk-empty-slot");
    els.curvePath = document.getElementById("qk-curve-path");
    els.curveNote = document.getElementById("qk-curve-note");
    els.textSample = document.getElementById("qk-text-sample");
    els.textNote = document.getElementById("qk-text-note");
    els.textSlideControls = document.getElementById("qk-text-slide-controls");

    els.panels = {
      anchor: document.getElementById("qk-panel-anchor"),
      text: document.getElementById("qk-panel-text"),
      layers: document.getElementById("qk-panel-layers"),
      easing: document.getElementById("qk-panel-easing")
    };

    if (els.version) els.version.textContent = "v" + VERSION;

    fillStaticIcons();
    readHost();
    renderTabs();
    selectTab(defaultTab());
    renderHostCard();
    setStatus("Ready");
    bindControls();
    bindTools();
    bindTooltips();
    initWelcome();
    setEasingPreset("easy");
    setTextPreset("fade", false);
  }

  function fillStaticIcons() {
    qsa("[data-icon]").forEach(function (el) {
      var name = el.getAttribute("data-icon");
      if (window.QKIcons && window.QKIcons.has(name)) {
        el.innerHTML = window.QKIcons.svg(name, 16);
      }
    });
  }

  function readHost() {
    var bridge = window.CSInterfaceLite;
    var env = bridge && bridge.isHosted ? bridge.getHostEnvironment() : null;

    if (env && env.appName) {
      state.hosted = true;
      state.hostId = normalizeHost(env.appName);
      state.hostVersion = String(env.appVersion || "");
      return;
    }

    state.preview = true;
    var forced = /[?&]host=(AEFT|PPRO)\b/i.exec(window.location.search);
    if (forced) state.hostId = forced[1].toUpperCase();
  }

  function isApplicable(tab) {
    if (!tab.host) return true;
    if (!state.hostId || state.hostId === "UNKNOWN") return true;
    return tab.host === state.hostId;
  }

  function defaultTab() {
    for (var i = 0; i < TABS.length; i++) {
      if (isApplicable(TABS[i])) return TABS[i].id;
    }
    return TABS[0].id;
  }

  /* ---------- tabs ---------- */

  function tabTip(tab) {
    if (tab.host && state.hostId && tab.host !== state.hostId) {
      return tab.label + " — available in " + HOST_NAMES[tab.host];
    }
    if (tab.host) return tab.label + " — " + HOST_NAMES[tab.host] + " only";
    return tab.label + " — works in both apps";
  }

  function renderTabs() {
    var html = TABS.map(function (tab) {
      var locked = !isApplicable(tab);
      return (
        '<button type="button" class="qk-tab' +
        (locked ? " is-other-host" : "") +
        '" role="tab" id="qk-tab-' +
        tab.id +
        '" data-tab="' +
        tab.id +
        '" aria-controls="qk-content" aria-selected="false" tabindex="-1">' +
        window.QKIcons.svg(tab.icon, 16) +
        '<span class="qk-tab__label">' +
        tab.label +
        "</span></button>"
      );
    }).join("");

    els.tabs.innerHTML = html;

    qsa(".qk-tab", els.tabs).forEach(function (btn) {
      var tab = tabById(btn.getAttribute("data-tab"));
      if (tab) btn.setAttribute("data-tip", tabTip(tab));
    });
  }

  function selectTab(id, focusTab) {
    var tab = tabById(id);
    if (!tab) return;

    state.activeTab = id;
    qsa(".qk-tab", els.tabs).forEach(function (btn) {
      var on = btn.getAttribute("data-tab") === id;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
      if (on) {
        btn.classList.add("is-active");
        if (focusTab) btn.focus();
        if (btn.scrollIntoView) {
          try {
            btn.scrollIntoView({ block: "nearest", inline: "nearest" });
          } catch (e) {
            /* older engines: ignore */
          }
        }
      } else {
        btn.classList.remove("is-active");
      }
    });

    renderContent();
    if (id === "text") scheduleTextPreview();
  }

  function renderContent() {
    var tab = tabById(state.activeTab);
    if (!tab) return;

    var locked = !isApplicable(tab);
    var panel = tab.panelId ? els.panels[tab.panelId] : null;

    qsa(".qk-panel", els.content).forEach(function (node) {
      node.hidden = true;
    });

    if (!locked && panel) {
      panel.hidden = false;
      els.empty.hidden = true;
      els.empty.innerHTML = "";
      return;
    }

    els.empty.hidden = false;
    els.empty.innerHTML = emptyState(tab, locked);
  }

  function emptyState(tab, locked) {
    var title = locked ? "Available in " + HOST_NAMES[tab.host] : tab.label;
    var body = locked
      ? tab.hostNote || "This tool needs " + HOST_NAMES[tab.host] + "."
      : tab.body;
    var hint = locked
      ? "You are in " + currentHostLabel() + ". Every other tab still works here."
      : "Coming in a later part of the build.";

    return (
      '<section class="qk-empty' +
      (locked ? " qk-empty--locked" : "") +
      '" aria-labelledby="qk-empty-title">' +
      '<div class="qk-empty__icon">' +
      window.QKIcons.svg(tab.icon, 24) +
      "</div>" +
      '<h2 class="qk-empty__title" id="qk-empty-title">' +
      title +
      "</h2>" +
      '<p class="qk-empty__body">' +
      body +
      "</p>" +
      '<p class="qk-empty__hint">' +
      hint +
      "</p>" +
      "</section>"
    );
  }

  function onTabKeydown(event) {
    var keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (keys.indexOf(event.key) === -1) return;
    event.preventDefault();

    var index = tabIndex(state.activeTab);
    if (event.key === "ArrowRight") index = (index + 1) % TABS.length;
    if (event.key === "ArrowLeft") index = (index - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") index = 0;
    if (event.key === "End") index = TABS.length - 1;

    selectTab(TABS[index].id, true);
  }

  /* ---------- host card ---------- */

  function setHostCard(chipText, chipKind, value, detail) {
    els.hostState.textContent = chipText;
    els.hostState.className = "qk-chip" + (chipKind ? " is-" + chipKind : "");
    els.hostValue.textContent = value;
    els.hostDetail.textContent = detail;
  }

  function renderHostCard() {
    if (state.hosted) {
      var name = HOST_NAMES[state.hostId] || "Adobe app";
      var version = state.hostVersion ? " " + state.hostVersion : "";
      setHostCard(
        "Host detected",
        "ok",
        name + version,
        "Press Test host connection to confirm the ExtendScript bridge."
      );
      return;
    }

    if (state.hostId) {
      setHostCard(
        "Preview",
        "",
        HOST_NAMES[state.hostId] + " preview",
        "Browser preview only — open the panel inside the app to talk to it."
      );
      return;
    }

    setHostCard(
      "Preview",
      "",
      "Not inside Adobe",
      "This is a browser preview. The panel talks to the app only inside After Effects or Premiere Pro."
    );
  }

  function setBusy(busy, button) {
    state.busy = busy;
    qsa(".qk-action").forEach(function (node) {
      node.disabled = busy;
    });
    if (els.test) els.test.disabled = busy;

    if (button) {
      button.classList.toggle("is-loading", busy);
      button.setAttribute("aria-busy", busy ? "true" : "false");
    }
  }

  function setStatus(text) {
    els.lastAction.textContent = text;
    els.lastAction.setAttribute("data-tip", text);
  }

  function showMessage(kind, text) {
    if (!els.message) return;
    els.message.hidden = false;
    els.message.className = "qk-msg" + (kind === "ok" ? " is-ok" : " is-error");
    els.messageText.textContent = text;
    if (els.messageIcon && window.QKIcons) {
      els.messageIcon.innerHTML = window.QKIcons.svg(kind === "ok" ? "check" : "info", 14);
    }
  }

  function rememberUndoHint() {
    if (state.undoHinted || !els.undo) return;
    state.undoHinted = true;
    els.undo.setAttribute(
      "data-tip",
      "Each QuickKit action is one undo step. Press Ctrl+Z in After Effects to reverse it."
    );
  }

  /* ---------- host test ---------- */

  function testHost() {
    if (state.busy) return;

    var bridge = window.CSInterfaceLite;
    if (!bridge || !bridge.isHosted) {
      setHostCard(
        "Preview",
        "",
        "Not inside Adobe",
        "QuickKit is running in a browser preview, so there is no app to ask. Open the panel with Window > Extensions inside After Effects or Premiere Pro, then press Test again."
      );
      setStatus("Preview mode — no Adobe host");
      return;
    }

    setBusy(true, els.test);
    var settled = false;
    var timer = window.setTimeout(function () {
      if (settled) return;
      settled = true;
      setBusy(false, els.test);
      setHostCard(
        "Not connected",
        "error",
        "The app did not answer",
        "ExtendScript took longer than 8 seconds. Try again, or restart the app and reopen the panel."
      );
      setStatus("Host check timed out");
    }, HOST_TEST_TIMEOUT);

    bridge.evalScript("qkHostInfo()", function (raw) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      setBusy(false, els.test);
      handleHostResult(raw);
    });
  }

  function handleHostResult(raw) {
    if (raw === null || raw === undefined || raw === "") {
      failHost("The app returned nothing. Restart After Effects or Premiere Pro, reopen QuickKit and try again.");
      return;
    }

    if (String(raw) === "EvalScript error.") {
      failHost("ExtendScript could not run the QuickKit host script. Make sure host\\quickkit.jsx is inside the installed QuickKit folder, then reopen the panel.");
      return;
    }

    var data = null;
    try {
      data = JSON.parse(String(raw));
    } catch (e) {
      data = null;
    }

    if (!data || data.ok !== true) {
      var reason = data && data.error ? String(data.error) : String(raw).slice(0, 160);
      failHost("The app answered with something QuickKit did not understand: " + reason);
      return;
    }

    var hostId = normalizeHost(data.host);
    if (hostId !== "UNKNOWN") state.hostId = hostId;
    if (data.version) state.hostVersion = String(data.version);

    var name = data.hostName || HOST_NAMES[state.hostId] || "Adobe app";
    var version = state.hostVersion || "version not reported";

    var detail = [];
    if (data.build && String(data.build) !== String(state.hostVersion)) detail.push("build " + data.build);
    detail.push(data.engine || "ExtendScript");
    if (data.project) detail.push("project: " + data.project);

    setHostCard("Connected", "ok", name + " " + version, detail.join(" · "));
    setStatus("Checked host: " + name + " " + version);

    renderTabs();
    selectTab(state.activeTab);
  }

  function failHost(message) {
    setHostCard("Not connected", "error", "Can't reach the app", message);
    setStatus("Host check failed");
  }

  /* ---------- tool actions ---------- */

  function qkQuote(value) {
    return JSON.stringify(String(value === null || value === undefined ? "" : value));
  }

  function fieldValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "").replace(/^\s+|\s+$/g, "") : "";
  }

  function runHostCall(script, button) {
    if (state.busy) return;

    var bridge = window.CSInterfaceLite;
    if (!bridge || !bridge.isHosted) {
      showMessage(
        "error",
        "QuickKit is not connected to After Effects. Open the panel from Window > Extensions inside the app, then press the button again."
      );
      setStatus("Not connected — nothing changed");
      return;
    }

    setBusy(true, button);
    var settled = false;
    var timer = window.setTimeout(function () {
      if (settled) return;
      settled = true;
      setBusy(false, button);
      showMessage("error", "After Effects did not answer within 15 seconds. Try again, or restart the app if it is busy.");
      setStatus("Action timed out");
    }, ACTION_TIMEOUT);

    bridge.evalScript(script, function (raw) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      setBusy(false, button);
      handleActionResult(raw);
    });
  }

  function handleActionResult(raw) {
    if (raw === null || raw === undefined || raw === "") {
      showMessage("error", "After Effects returned nothing. Reopen the panel and try again.");
      setStatus("Action failed — no answer");
      return;
    }

    if (String(raw) === "EvalScript error.") {
      showMessage(
        "error",
        "After Effects could not run the QuickKit script. Run scripts\\install.bat again, then reopen the panel."
      );
      setStatus("Action failed — script error");
      return;
    }

    var data = null;
    try {
      data = JSON.parse(String(raw));
    } catch (e) {
      data = null;
    }

    if (!data) {
      showMessage("error", "QuickKit could not read the answer from After Effects: " + String(raw).slice(0, 120));
      setStatus("Action failed — unreadable answer");
      return;
    }

    if (data.ok) {
      var message = data.message || "Done.";
      showMessage("ok", message);
      setStatus("Last action: " + message);
      rememberUndoHint();
      return;
    }

    showMessage("error", data.error || "After Effects reported a problem without details.");
    setStatus("Action failed");
  }

  function bindTools() {
    document.getElementById("qk-anchor-center").addEventListener("click", function () {
      runHostCall("qkAnchorCenter()", this);
    });

    document.getElementById("qk-rename-apply").addEventListener("click", function () {
      var args = [
        fieldValue("qk-rename-prefix"),
        fieldValue("qk-rename-suffix"),
        fieldValue("qk-rename-find"),
        fieldValue("qk-rename-replace"),
        fieldValue("qk-rename-start") || "1",
        fieldValue("qk-rename-pad") || "2",
        document.getElementById("qk-rename-numbering").checked ? "1" : "0"
      ].map(qkQuote);
      runHostCall("qkLayersRename(" + args.join(", ") + ")", this);
    });

    document.getElementById("qk-stagger-apply").addEventListener("click", function () {
      var offset = fieldValue("qk-stagger-offset") || "0";
      var unit = document.getElementById("qk-stagger-unit").value;
      runHostCall("qkLayersStagger(" + qkQuote(offset) + ", " + qkQuote(unit) + ")", this);
    });

    document.getElementById("qk-null-apply").addEventListener("click", function () {
      runHostCall("qkLayersNull()", this);
    });

    document.getElementById("qk-sequence-apply").addEventListener("click", function () {
      runHostCall("qkLayersSequence()", this);
    });

    document.getElementById("qk-precompose-apply").addEventListener("click", function () {
      runHostCall("qkLayersPrecompose(" + qkQuote(fieldValue("qk-precompose-name")) + ")", this);
    });

    document.getElementById("qk-easing-apply").addEventListener("click", function () {
      runHostCall("qkEasingApply(" + qkQuote(state.easing) + ")", this);
    });

    document.getElementById("qk-text-apply").addEventListener("click", function () {
      var args = [
        qkQuote(state.textPreset),
        qkQuote(fieldValue("qk-text-duration") || "0.6"),
        qkQuote(fieldValue("qk-text-delay") || "0"),
        qkQuote(document.getElementById("qk-text-easing").value),
        qkQuote(document.getElementById("qk-text-in").checked ? "1" : "0"),
        qkQuote(document.getElementById("qk-text-out").checked ? "1" : "0"),
        qkQuote(document.getElementById("qk-text-direction").value),
        qkQuote(fieldValue("qk-text-distance") || "80")
      ];
      runHostCall("qkTextApply(" + args.join(", ") + ")", this);
    });

    [
      "qk-text-duration",
      "qk-text-delay",
      "qk-text-distance",
      "qk-text-easing",
      "qk-text-direction",
      "qk-text-in",
      "qk-text-out"
    ].forEach(function (id) {
      var field = document.getElementById(id);
      if (!field) return;
      field.addEventListener("input", scheduleTextPreview);
      field.addEventListener("change", scheduleTextPreview);
    });

    els.content.addEventListener("click", function (event) {
      var cell = event.target.closest("[data-anchor]");
      if (cell) {
        runHostCall("qkAnchorMove(" + qkQuote(cell.getAttribute("data-anchor")) + ")", cell);
        return;
      }

      var preset = event.target.closest("[data-easing]");
      if (preset) {
        setEasingPreset(preset.getAttribute("data-easing"));
        return;
      }

      var textPreset = event.target.closest("[data-text-preset]");
      if (textPreset) setTextPreset(textPreset.getAttribute("data-text-preset"));
    });
  }

  function setEasingPreset(kind) {
    if (!EASING[kind]) return;
    state.easing = kind;

    qsa("[data-easing]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-easing") === kind ? "true" : "false");
    });

    if (els.curvePath) els.curvePath.setAttribute("d", EASING[kind].path);
    if (els.curveNote) els.curveNote.textContent = EASING[kind].note;
  }

  /* ---------- text preview ---------- */

  function cssNumber(name, fallback) {
    var raw = "";
    try {
      raw = window.getComputedStyle(document.documentElement).getPropertyValue(name);
    } catch (eStyle) {}
    var value = parseFloat(raw);
    return isNaN(value) ? fallback : value;
  }

  function textTiming() {
    var duration = parseFloat(fieldValue("qk-text-duration"));
    if (!(duration > 0)) duration = 0.6;
    var delay = parseFloat(fieldValue("qk-text-delay"));
    if (!(delay >= 0)) delay = 0;

    return {
      duration: duration,
      delay: delay,
      easing: TEXT_EASING[document.getElementById("qk-text-easing").value] || TEXT_EASING.smooth,
      inOn: document.getElementById("qk-text-in").checked,
      outOn: document.getElementById("qk-text-out").checked
    };
  }

  function textStageLook(preset) {
    var shift = cssNumber("--qk-text-shift", 14);
    var blur = cssNumber("--qk-text-blur", 6);
    var pop = cssNumber("--qk-text-pop", 0.82);
    var direction = document.getElementById("qk-text-direction").value;
    var move = "translateX(-" + shift + "px)";
    if (direction === "right") move = "translateX(" + shift + "px)";
    else if (direction === "up") move = "translateY(-" + shift + "px)";
    else if (direction === "down") move = "translateY(" + shift + "px)";

    var base = { opacity: 1, transform: "translate(0, 0)", filter: "blur(0px)" };
    var hidden = { opacity: 0, transform: "translate(0, 0)", filter: "blur(0px)" };

    if (preset === "slide") hidden.transform = move;
    if (preset === "pop") hidden.transform = "scale(" + pop + ")";
    if (preset === "stagger") hidden.transform = "translateY(" + shift * 0.5 + "px)";
    if (preset === "blur") hidden.filter = "blur(" + blur + "px)";

    return { base: base, hidden: hidden };
  }

  function textTimeline(timing) {
    var inStart = timing.delay;
    var inEnd = inStart + timing.duration;
    var outStart = 0;
    var total = 0;

    if (timing.inOn) total = inEnd;
    if (timing.outOn) {
      outStart = timing.inOn ? inEnd + TEXT_PREVIEW_HOLD : timing.delay;
      total = outStart + timing.duration;
    }
    if (total <= 0) total = 1;

    return { total: total, inStart: inStart, inEnd: inEnd, outStart: outStart };
  }

  function previewFrame(offset, look) {
    return {
      offset: offset,
      opacity: look.opacity,
      transform: look.transform,
      filter: look.filter
    };
  }

  function pushFrame(frames, time, total, look) {
    var offset = Math.max(0, Math.min(1, time / total));
    var last = frames.length ? frames[frames.length - 1] : null;
    if (last && Math.abs(last.offset - offset) < 0.0001) {
      frames[frames.length - 1] = previewFrame(offset, look);
      return;
    }
    frames.push(previewFrame(offset, look));
  }

  function wholeFrames(preset, timing, timeline) {
    var look = textStageLook(preset);
    var frames = [];

    if (timing.inOn) {
      pushFrame(frames, 0, timeline.total, look.hidden);
      pushFrame(frames, timeline.inStart, timeline.total, look.hidden);
      pushFrame(frames, timeline.inEnd, timeline.total, look.base);
    } else {
      pushFrame(frames, 0, timeline.total, look.base);
    }

    if (timing.outOn) {
      pushFrame(frames, timeline.outStart, timeline.total, look.base);
      pushFrame(frames, timeline.total, timeline.total, look.hidden);
    } else {
      pushFrame(frames, timeline.total, timeline.total, look.base);
    }

    return frames;
  }

  function charFrames(preset, index, count, timing, timeline) {
    var look = textStageLook(preset);
    var spread = 0.85;
    var fade = preset === "typewriter" ? 0.02 : Math.min(0.18, timing.duration * 0.3);
    var reveal = timeline.inStart + (count > 1 ? (index / count) * timing.duration * spread : 0);
    var hide = timeline.outStart + (count > 1 ? ((count - 1 - index) / count) * timing.duration * spread : 0);
    var frames = [];

    if (timing.inOn) {
      pushFrame(frames, 0, timeline.total, look.hidden);
      pushFrame(frames, reveal, timeline.total, look.hidden);
      pushFrame(frames, Math.min(reveal + fade, timeline.total), timeline.total, look.base);
      if (!timing.outOn) pushFrame(frames, timeline.total, timeline.total, look.base);
    } else {
      pushFrame(frames, 0, timeline.total, look.base);
    }

    if (timing.outOn) {
      pushFrame(frames, hide, timeline.total, look.base);
      pushFrame(frames, Math.min(hide + fade, timeline.total), timeline.total, look.hidden);
      pushFrame(frames, timeline.total, timeline.total, look.hidden);
    }

    return frames;
  }

  function cancelTextPreview() {
    state.textAnimations.forEach(function (animation) {
      try {
        animation.cancel();
      } catch (eCancel) {}
    });
    state.textAnimations = [];

    if (state.textResetTimer) {
      window.clearTimeout(state.textResetTimer);
      state.textResetTimer = null;
    }
  }

  function resetTextStage() {
    cancelTextPreview();
    if (!els.textSample) return;
    els.textSample.textContent = "QuickKit";
    els.textSample.style.opacity = "";
    els.textSample.style.transform = "";
    els.textSample.style.filter = "";
  }

  function splitTextStage() {
    var text = "QuickKit";
    var sample = els.textSample;
    sample.textContent = "";

    for (var i = 0; i < text.length; i++) {
      var char = document.createElement("span");
      char.className = "qk-text-stage__char";
      char.textContent = text.charAt(i);
      sample.appendChild(char);
    }

    return qsa(".qk-text-stage__char", sample);
  }

  function applyTextBase(preset, chars) {
    var look = textStageLook(preset);
    var targets = chars || [els.textSample];
    targets.forEach(function (node) {
      node.style.opacity = String(look.base.opacity);
      node.style.transform = look.base.transform;
      node.style.filter = look.base.filter;
    });
  }

  function playTextPreview() {
    if (!els.textSample) return;
    resetTextStage();

    var preset = state.textPreset;
    var timing = textTiming();
    if (!timing.inOn && !timing.outOn) return;

    var timeline = textTimeline(timing);
    var chars = TEXT_PRESETS[preset].chars ? splitTextStage() : null;
    var reduced = false;
    try {
      reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (eMedia) {}

    if (reduced || typeof els.textSample.animate !== "function") {
      applyTextBase(preset, chars);
      return;
    }

    var options = {
      duration: Math.round(timeline.total * 1000),
      easing: timing.easing,
      fill: "both"
    };

    if (chars) {
      for (var i = 0; i < chars.length; i++) {
        state.textAnimations.push(chars[i].animate(charFrames(preset, i, chars.length, timing, timeline), options));
      }
    } else {
      state.textAnimations.push(els.textSample.animate(wholeFrames(preset, timing, timeline), options));
    }

    state.textResetTimer = window.setTimeout(function () {
      state.textResetTimer = null;
      resetTextStage();
    }, options.duration + 80);
  }

  function scheduleTextPreview() {
    if (state.textTimer) window.clearTimeout(state.textTimer);
    state.textTimer = window.setTimeout(function () {
      state.textTimer = null;
      playTextPreview();
    }, 260);
  }

  function setTextPreset(kind, animate) {
    if (!TEXT_PRESETS[kind]) return;
    state.textPreset = kind;

    qsa("[data-text-preset]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-text-preset") === kind ? "true" : "false");
    });

    if (els.textNote) els.textNote.textContent = TEXT_PRESETS[kind].note;
    if (els.textSlideControls) els.textSlideControls.hidden = kind !== "slide";
    if (animate === false) return;
    playTextPreview();
  }

  /* ---------- welcome ---------- */

  function welcomeSeen() {
    try {
      return window.localStorage.getItem(WELCOME_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function rememberWelcome() {
    try {
      window.localStorage.setItem(WELCOME_KEY, "1");
    } catch (e) {
      /* storage can be blocked in the host; the overlay simply reappears */
    }
  }

  function initWelcome() {
    if (!welcomeSeen()) {
      showWelcome();
    }
  }

  function showWelcome() {
    if (!els.welcome || !els.welcome.hidden) return;
    lastFocused = document.activeElement;
    els.welcome.hidden = false;
    if (els.welcomeOk) els.welcomeOk.focus();
  }

  function hideWelcome(markSeen) {
    if (!els.welcome || els.welcome.hidden) return;
    els.welcome.hidden = true;
    if (markSeen) rememberWelcome();
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  /* ---------- controls ---------- */

  function bindControls() {
    els.test.addEventListener("click", testHost);

    els.tabs.addEventListener("click", function (event) {
      var btn = event.target.closest(".qk-tab");
      if (btn) selectTab(btn.getAttribute("data-tab"));
    });

    els.tabs.addEventListener("keydown", onTabKeydown);

    els.help.addEventListener("click", showWelcome);
    els.welcomeOk.addEventListener("click", function () {
      hideWelcome(true);
    });
    els.welcomeClose.addEventListener("click", function () {
      hideWelcome(true);
    });
    els.welcome.addEventListener("click", function (event) {
      if (event.target === els.welcome) hideWelcome(true);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && els.welcome && !els.welcome.hidden) {
        hideWelcome(true);
      }
    });
  }

  /* ---------- tooltips ---------- */

  function bindTooltips() {
    var active = null;

    function show(el) {
      var text = el.getAttribute("data-tip");
      if (!text || !els.tip) return;
      if (active && active !== el) active.removeAttribute("aria-describedby");

      active = el;
      els.tip.textContent = text;
      els.tip.hidden = false;
      el.setAttribute("aria-describedby", "qk-tooltip");

      var box = el.getBoundingClientRect();
      var tip = els.tip.getBoundingClientRect();
      var maxLeft = Math.max(TIP_MARGIN, window.innerWidth - tip.width - TIP_MARGIN);
      var left = Math.min(Math.max(TIP_MARGIN, box.left), maxLeft);
      var top = box.bottom + TIP_GAP;
      if (top + tip.height > window.innerHeight - TIP_MARGIN) {
        top = Math.max(TIP_MARGIN, box.top - tip.height - TIP_GAP);
      }

      els.tip.style.left = Math.round(left) + "px";
      els.tip.style.top = Math.round(top) + "px";
    }

    function hide() {
      if (!active) return;
      active.removeAttribute("aria-describedby");
      active = null;
      if (els.tip) els.tip.hidden = true;
    }

    document.addEventListener("mouseover", function (event) {
      var el = event.target.closest("[data-tip]");
      if (el) show(el);
      else hide();
    });

    document.addEventListener("mouseout", function (event) {
      var el = event.target.closest("[data-tip]");
      if (el && !el.contains(event.relatedTarget)) hide();
    });

    document.addEventListener("focusin", function (event) {
      var el = event.target.closest("[data-tip]");
      if (el) show(el);
    });

    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") hide();
    });
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window, document);
