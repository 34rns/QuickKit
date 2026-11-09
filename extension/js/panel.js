/* QuickKit panel controller.
   Plain browser + CEP. Every host call goes through the ExtendScript adapter;
   nothing here talks to the network. */
(function (window, document) {
  "use strict";

  var VERSION = "0.10.0";
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
      panelId: "presets",
      body: "Save the selected layers as a reusable look and apply it in one click.",
      hostNote: "Presets apply layer and text properties inside After Effects."
    },
    {
      id: "library",
      label: "Library",
      icon: "library",
      host: null,
      panelId: "library",
      body: "One library for presets, MOGRTs and recipes, with nested folders and packs.",
      hostNote: "The library is shared by both apps; items for the other app are dimmed."
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
      panelId: "silence",
      body: "Find silent gaps and cut them out of a sequence.",
      hostNote: "Silence detection runs on Premiere Pro sequences."
    },
    {
      id: "bridge",
      label: "Bridge",
      icon: "bridge",
      host: null,
      panelId: "bridge",
      body: "Send selected work between After Effects and Premiere Pro.",
      hostNote: "Bridge works in both apps, but each half needs the other app to send something first."
    }
  ];

  var state = {
    hostId: null,
    hostVersion: "",
    hosted: false,
    preview: false,
    activeTab: "anchor",
    easing: "easy",
    textPreset: "fade-soft",
    textAnimations: [],
    textTimer: null,
    textResetTimer: null,
    textApplyTimer: null,
    textApplying: false,
    textLive: false,
    textMogrtPending: null,
    textMogrtJob: null,
    textSeeded: 0,
    busy: false,
    undoHinted: false,
    presets: [],
    presetFolders: [],
    presetRoot: "",
    presetNote: "",
    presetSkipped: [],
    presetSeeded: 0,
    presetLoaded: false,
    presetLoading: false,
    presetLoadError: "",
    presetQuery: "",
    presetFolder: "",
    presetFavorites: false,
    presetDragId: null,
    presetDragAfter: false,
    presetMenuId: null,
    presetDialogOnConfirm: null,
    presetDialogOnCancel: null,
    presetDialogReturnFocus: null,
    presetDialogFields: []
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
    els.textCategory = document.getElementById("qk-text-category");
    els.textPresets = document.getElementById("qk-text-presets");
    els.textDuration = document.getElementById("qk-text-duration");
    els.textDelay = document.getElementById("qk-text-delay");
    els.textEasing = document.getElementById("qk-text-easing");
    els.textDirection = document.getElementById("qk-text-direction");
    els.textDistance = document.getElementById("qk-text-distance");
    els.textStagger = document.getElementById("qk-text-stagger");
    els.textStaggerValue = document.getElementById("qk-text-stagger-value");
    els.textOvershoot = document.getElementById("qk-text-overshoot");
    els.textOvershootValue = document.getElementById("qk-text-overshoot-value");
    els.textMoveRow = document.getElementById("qk-text-move-row");
    els.textTuneRow = document.getElementById("qk-text-tune-row");
    els.textStaggerRow = document.getElementById("qk-text-stagger-row");
    els.textOvershootRow = document.getElementById("qk-text-overshoot-row");
    els.textIn = document.getElementById("qk-text-in");
    els.textOut = document.getElementById("qk-text-out");
    els.textApply = document.getElementById("qk-text-apply");
    els.textMogrt = document.getElementById("qk-text-mogrt");
    els.textMogrtAll = document.getElementById("qk-text-mogrt-all");
    els.textCancel = document.getElementById("qk-text-cancel");
    els.textProgress = document.getElementById("qk-text-progress");
    els.presetSearch = document.getElementById("qk-preset-search");
    els.presetSave = document.getElementById("qk-preset-save");
    els.presetFilters = document.getElementById("qk-preset-filters");
    els.presetNewFolder = document.getElementById("qk-preset-new-folder");
    els.presetDeleteFolder = document.getElementById("qk-preset-delete-folder");
    els.presetNote = document.getElementById("qk-preset-note");
    els.presetList = document.getElementById("qk-preset-list");
    els.presetEmpty = document.getElementById("qk-preset-empty");
    els.presetEmptyMark = document.getElementById("qk-preset-empty-mark");
    els.presetEmptyTitle = document.getElementById("qk-preset-empty-title");
    els.presetEmptyBody = document.getElementById("qk-preset-empty-body");
    els.presetEmptyActions = document.getElementById("qk-preset-empty-actions");
    els.presetImport = document.getElementById("qk-preset-import");
    els.presetExport = document.getElementById("qk-preset-export");
    els.presetPath = document.getElementById("qk-preset-path");
    els.presetDialog = document.getElementById("qk-preset-dialog");
    els.presetDialogTitle = document.getElementById("qk-preset-dialog-title");
    els.presetDialogBody = document.getElementById("qk-preset-dialog-body");
    els.presetDialogOk = document.getElementById("qk-preset-dialog-ok");
    els.presetDialogCancel = document.getElementById("qk-preset-dialog-cancel");
    els.presetDialogClose = document.getElementById("qk-preset-dialog-close");

    els.libSearch = document.getElementById("qk-lib-search");
    els.libSearchClear = document.getElementById("qk-lib-search-clear");
    els.libType = document.getElementById("qk-lib-type");
    els.libHost = document.getElementById("qk-lib-host");
    els.libCategory = document.getElementById("qk-lib-category");
    els.libSort = document.getElementById("qk-lib-sort");
    els.libCrumbs = document.getElementById("qk-lib-crumbs");
    els.libCollections = document.getElementById("qk-lib-collections");
    els.libNewFolder = document.getElementById("qk-lib-new-folder");
    els.libFolders = document.getElementById("qk-lib-folders");
    els.libCount = document.getElementById("qk-lib-count");
    els.libViewGrid = document.getElementById("qk-lib-view-grid");
    els.libViewList = document.getElementById("qk-lib-view-list");
    els.libSizeWrap = document.getElementById("qk-lib-size-wrap");
    els.libThumb = document.getElementById("qk-lib-thumb");
    els.libItems = document.getElementById("qk-lib-items");
    els.libEmpty = document.getElementById("qk-lib-empty");
    els.libEmptyMark = document.getElementById("qk-lib-empty-mark");
    els.libEmptyTitle = document.getElementById("qk-lib-empty-title");
    els.libEmptyBody = document.getElementById("qk-lib-empty-body");
    els.libEmptyActions = document.getElementById("qk-lib-empty-actions");
    els.libNote = document.getElementById("qk-lib-note");
    els.libExport = document.getElementById("qk-lib-export");
    els.libImport = document.getElementById("qk-lib-import");
    els.libRepair = document.getElementById("qk-lib-repair");
    els.libPath = document.getElementById("qk-lib-path");
    els.libMenu = document.getElementById("qk-lib-menu");
    els.libDialog = document.getElementById("qk-lib-dialog");
    els.libDialogTitle = document.getElementById("qk-lib-dialog-title");
    els.libDialogLead = document.getElementById("qk-lib-dialog-lead");
    els.libDialogBody = document.getElementById("qk-lib-dialog-body");
    els.libDialogOk = document.getElementById("qk-lib-dialog-ok");
    els.libDialogCancel = document.getElementById("qk-lib-dialog-cancel");
    els.libDialogClose = document.getElementById("qk-lib-dialog-close");

    els.libPreview = document.getElementById("qk-lib-preview");
    els.libPreviewKicker = document.getElementById("qk-lib-preview-kicker");
    els.libPreviewMode = document.getElementById("qk-lib-preview-mode");
    els.libPreviewSettings = document.getElementById("qk-lib-preview-settings");
    els.libPreviewCollapse = document.getElementById("qk-lib-preview-collapse");
    els.libPreviewBody = document.getElementById("qk-lib-preview-body");
    els.libPreviewStage = document.getElementById("qk-lib-preview-stage");
    els.libPreviewVideo = document.getElementById("qk-lib-preview-video");
    els.libPreviewCanvas = document.getElementById("qk-lib-preview-canvas");
    els.libPreviewEmpty = document.getElementById("qk-lib-preview-empty");
    els.libPreviewEmptyIcon = document.getElementById("qk-lib-preview-empty-icon");
    els.libPreviewEmptyText = document.getElementById("qk-lib-preview-empty-text");
    els.libPreviewGenerate = document.getElementById("qk-lib-preview-generate");
    els.libPreviewBusy = document.getElementById("qk-lib-preview-busy");
    els.libPreviewBusyText = document.getElementById("qk-lib-preview-busy-text");
    els.libPreviewCancel = document.getElementById("qk-lib-preview-cancel");
    els.libPreviewPlay = document.getElementById("qk-lib-preview-play");
    els.libPreviewLoop = document.getElementById("qk-lib-preview-loop");
    els.libPreviewSpeed = document.getElementById("qk-lib-preview-speed");
    els.libPreviewScrub = document.getElementById("qk-lib-preview-scrub");
    els.libPreviewClock = document.getElementById("qk-lib-preview-clock");
    els.libPreviewName = document.getElementById("qk-lib-preview-name");
    els.libPreviewBadge = document.getElementById("qk-lib-preview-badge");
    els.libPreviewHost = document.getElementById("qk-lib-preview-host");
    els.libPreviewTags = document.getElementById("qk-lib-preview-tags");
    els.libPreviewApply = document.getElementById("qk-lib-preview-apply");
    els.libPreviewFav = document.getElementById("qk-lib-preview-fav");
    els.libPreviewNote = document.getElementById("qk-lib-preview-note");
    els.libPreviewParams = document.getElementById("qk-lib-preview-params");
    els.libPreviewTarget = document.getElementById("qk-lib-preview-target");
    els.libPreviewMogrt = document.getElementById("qk-lib-preview-mogrt");
    els.libPreviewRegen = document.getElementById("qk-lib-preview-regen");
    els.libPreviewRegenBtn = document.getElementById("qk-lib-preview-regen-btn");
    els.libPreviewResize = document.getElementById("qk-lib-preview-resize");
    els.libBins = document.getElementById("qk-lib-bins");
    els.libBinsCreate = document.getElementById("qk-lib-bins-create");
    els.libBinsSort = document.getElementById("qk-lib-bins-sort");
    els.libBinsRename = document.getElementById("qk-lib-bins-rename");
    els.libBinsMode = document.getElementById("qk-lib-bins-mode");
    els.libBinsFind = document.getElementById("qk-lib-bins-find");
    els.libBinsReplace = document.getElementById("qk-lib-bins-replace");
    els.libBinsPrefix = document.getElementById("qk-lib-bins-prefix");
    els.libBinsSuffix = document.getElementById("qk-lib-bins-suffix");
    els.libBinsNote = document.getElementById("qk-lib-bins-note");

    els.panels = {
      anchor: document.getElementById("qk-panel-anchor"),
      presets: document.getElementById("qk-panel-presets"),
      library: document.getElementById("qk-panel-library"),
      text: document.getElementById("qk-panel-text"),
      layers: document.getElementById("qk-panel-layers"),
      easing: document.getElementById("qk-panel-easing"),
      silence: document.getElementById("qk-panel-silence"),
      bridge: document.getElementById("qk-panel-bridge")
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
    textPresetInit();
    bindPresets();
    bindLibrary();
    bindSilence();
    bindBridge();
    renderPresets();
    renderLibrary();
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
    if (id === "text") textOnShow();
    if (id === "silence") silenceOnShow();
    if (id === "bridge") bridgeOnShow();
    if (id === "presets") {
      if (state.hosted && !state.presetLoaded) loadPresets();
      else renderPresets();
    }
    if (id === "library") libOnShow();
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
      textApplyNow(this);
    });

    [
      "qk-text-duration",
      "qk-text-delay",
      "qk-text-distance",
      "qk-text-easing",
      "qk-text-direction",
      "qk-text-stagger",
      "qk-text-overshoot",
      "qk-text-in",
      "qk-text-out"
    ].forEach(function (id) {
      var field = document.getElementById(id);
      if (!field) return;
      field.addEventListener("input", textParamChanged);
      field.addEventListener("change", textParamChanged);
    });

    if (els.textCategory) els.textCategory.addEventListener("change", function () {
      textRenderGrid();
    });
    if (els.textMogrt) els.textMogrt.addEventListener("click", textMogrtClick);
    if (els.textMogrtAll) els.textMogrtAll.addEventListener("click", textMogrtExportAll);
    if (els.textCancel) els.textCancel.addEventListener("click", textMogrtCancel);

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
      if (textPreset) textSelectPreset(textPreset.getAttribute("data-text-preset"));
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
    var look = textPreviewInfo(preset);
    var shift = cssNumber("--qk-text-shift", 14);
    var blur = cssNumber("--qk-text-blur", 6);
    var pop = cssNumber("--qk-text-pop", 0.82);
    var direction = els.textDirection ? els.textDirection.value : "up";
    var move = "translateX(-" + shift + "px)";
    if (direction === "right") move = "translateX(" + shift + "px)";
    else if (direction === "up") move = "translateY(-" + shift + "px)";
    else if (direction === "down") move = "translateY(" + shift + "px)";

    var base = { opacity: 1, transform: "translate(0, 0)", filter: "blur(0px)" };
    var hidden = { opacity: 0, transform: "translate(0, 0)", filter: "blur(0px)" };

    if (look.kind === "slide") hidden.transform = move;
    else if (look.kind === "pop") hidden.transform = "scale(" + pop + ")";
    else if (look.kind === "stagger") hidden.transform = "translateY(" + shift * 0.5 + "px)";
    else if (look.kind === "blur") hidden.filter = "blur(" + blur + "px)";
    else if (look.kind === "rotate") hidden.transform = "rotate(-12deg)";
    else if (look.kind === "glitch") {
      hidden.transform = "translateX(" + shift * 0.7 + "px)";
      hidden.opacity = 0.4;
    }

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
    var fade = look.kind === "type" ? 0.02 : Math.min(0.18, timing.duration * 0.3);
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
    var chars = textPreviewInfo(preset).chars ? splitTextStage() : null;
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
    textSelectPreset(kind, animate);
  }

  /* ---------- text preset engine (Part 6C) ---------- */

  function textEngine() {
    return window.QKTextPresets || null;
  }

  function textPreviewInfo(id) {
    var engine = textEngine();
    if (!engine) return { kind: "fade", chars: false };
    return engine.previewLook(id);
  }

  function textPresetDef(id) {
    var engine = textEngine();
    return engine ? engine.byId(id) : null;
  }

  function textHas(list, value) {
    for (var i = 0; i < list.length; i++) if (list[i] === value) return true;
    return false;
  }

  function textParamValues() {
    var engine = textEngine();
    var duration = parseFloat(els.textDuration ? els.textDuration.value : "0.6");
    if (!(duration > 0)) duration = 0.6;
    var delay = parseFloat(els.textDelay ? els.textDelay.value : "0");
    if (!(delay >= 0)) delay = 0;
    var distance = parseFloat(els.textDistance ? els.textDistance.value : "80");
    if (!(distance > 0)) distance = 80;
    var stagger = parseFloat(els.textStagger ? els.textStagger.value : "0");
    if (!(stagger >= 0)) stagger = 0;
    var overshoot = parseFloat(els.textOvershoot ? els.textOvershoot.value : "0");
    if (!(overshoot >= 0)) overshoot = 0;

    return {
      duration: duration,
      delay: delay,
      easing: els.textEasing ? els.textEasing.value : "smooth",
      direction: els.textDirection ? els.textDirection.value : "up",
      distance: distance,
      stagger: stagger,
      overshoot: overshoot
    };
  }

  function textEdgeMode() {
    var inOn = els.textIn ? els.textIn.checked : true;
    var outOn = els.textOut ? els.textOut.checked : true;
    if (inOn && outOn) return "both";
    if (inOn) return "in";
    if (outOn) return "out";
    return "";
  }

  function textBuildPlan() {
    var engine = textEngine();
    var def = textPresetDef(state.textPreset);
    if (!engine || !def) return null;
    var edges = textEdgeMode();
    if (edges === "") return null;

    var values = textParamValues();
    values.edges = edges;
    return engine.plan(def.id, values);
  }

  function textUpdateSliderLabels() {
    if (els.textStaggerValue && els.textStagger) {
      els.textStaggerValue.textContent = String(Math.round(Number(els.textStagger.value) || 0)) + "%";
    }
    if (els.textOvershootValue && els.textOvershoot) {
      els.textOvershootValue.textContent = String(Math.round(Number(els.textOvershoot.value) || 0)) + "%";
    }
  }

  function textRenderParams(def) {
    var expose = def && def.expose ? def.expose : [];
    var hasStagger = textHas(expose, "stagger");
    var hasOvershoot = textHas(expose, "overshoot");
    var hasDirection = textHas(expose, "direction");
    var hasDistance = textHas(expose, "distance");

    if (els.textMoveRow) els.textMoveRow.hidden = !(hasDirection || hasDistance);
    if (els.textStaggerRow) els.textStaggerRow.hidden = !hasStagger;
    if (els.textOvershootRow) els.textOvershootRow.hidden = !hasOvershoot;
    if (els.textTuneRow) els.textTuneRow.hidden = !(hasStagger || hasOvershoot);
  }

  function textApplyPresetDefaults(def) {
    var engine = textEngine();
    if (!engine || !def) return;
    var values = engine.presetParams(def, null);

    if (els.textDuration) els.textDuration.value = String(values.duration);
    if (els.textDelay) els.textDelay.value = String(values.delay);
    if (els.textEasing) els.textEasing.value = values.easing;
    if (els.textDirection) els.textDirection.value = values.direction;
    if (els.textDistance) els.textDistance.value = String(values.distance);
    if (els.textStagger) els.textStagger.value = String(values.stagger);
    if (els.textOvershoot) els.textOvershoot.value = String(values.overshoot);
    textUpdateSliderLabels();
  }

  function textApplyEdges(def) {
    var canIn = !def || def.edges !== "out";
    var canOut = !def || def.edges !== "in";
    if (els.textIn) {
      els.textIn.disabled = !canIn;
      els.textIn.checked = canIn;
    }
    if (els.textOut) {
      els.textOut.disabled = !canOut;
      els.textOut.checked = canOut;
    }
  }

  function textRenderGrid() {
    var engine = textEngine();
    if (!engine || !els.textPresets) return;

    var category = els.textCategory ? els.textCategory.value : "all";
    var list = engine.inCategory(category);
    els.textPresets.textContent = "";

    for (var i = 0; i < list.length; i++) {
      var def = list[i];
      var button = document.createElement("button");
      button.type = "button";
      button.className = "qk-preset";
      button.setAttribute("data-text-preset", def.id);
      button.setAttribute("aria-pressed", def.id === state.textPreset ? "true" : "false");
      button.setAttribute("data-tip", def.note);
      button.textContent = def.name;
      els.textPresets.appendChild(button);
    }
  }

  function textSelectPreset(id, animate) {
    var engine = textEngine();
    var def = engine ? engine.byId(id) : null;
    if (!def) return;

    state.textPreset = id;
    qsa("[data-text-preset]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-text-preset") === id ? "true" : "false");
    });

    if (els.textNote) els.textNote.textContent = def.note;
    textApplyPresetDefaults(def);
    textRenderParams(def);
    textApplyEdges(def);

    if (animate !== false) playTextPreview();
    if (state.textLive) scheduleTextApply();
  }

  function textPresetInit() {
    var engine = textEngine();
    if (!engine || !els.textPresets) return;

    if (els.textCategory) {
      els.textCategory.textContent = "";
      var all = document.createElement("option");
      all.value = "all";
      all.textContent = "All categories (" + engine.PRESETS.length + ")";
      els.textCategory.appendChild(all);

      var categories = engine.categories();
      for (var i = 0; i < categories.length; i++) {
        if (!categories[i].count) continue;
        var option = document.createElement("option");
        option.value = categories[i].name;
        option.textContent = categories[i].name + " (" + categories[i].count + ")";
        els.textCategory.appendChild(option);
      }
    }

    textRenderGrid();
    textSelectPreset(engine.PRESETS[0].id, false);
  }

  function textParamChanged() {
    textUpdateSliderLabels();
    scheduleTextPreview();
    scheduleTextApply();
  }

  function scheduleTextApply() {
    if (!state.textLive) return;
    if (state.textApplyTimer) window.clearTimeout(state.textApplyTimer);
    state.textApplyTimer = window.setTimeout(function () {
      state.textApplyTimer = null;
      textApplyLive();
    }, 420);
  }

  function textApplyNow(button) {
    if (state.busy) return;
    var plan = textBuildPlan();
    if (!plan) {
      showMessage("error", "Turn on Animate in, Animate out, or both.");
      return;
    }

    var bridge = window.CSInterfaceLite;
    if (!bridge || !bridge.isHosted) {
      showMessage("error", "Open the panel from Window > Extensions inside After Effects, then apply.");
      return;
    }

    setBusy(true, button);
    setStatus("Applying " + plan.name + "\u2026");
    bridgeCall("qkTextPresetApply(" + qkQuote(JSON.stringify({ plan: plan })) + ")", function (data) {
      setBusy(false, button);
      if (!data || !data.ok) {
        showMessage("error", (data && data.error) || "The text preset was not applied.");
        setStatus("Nothing applied");
        return;
      }
      state.textLive = true;
      showMessage("ok", data.message || "Text preset applied.");
      setStatus("Text preset applied");
    });
  }

  function textApplyLive() {
    if (state.textApplying || !state.textLive) return;
    var plan = textBuildPlan();
    if (!plan) return;

    state.textApplying = true;
    bridgeCall("qkTextPresetApply(" + qkQuote(JSON.stringify({ plan: plan })) + ")", function (data) {
      state.textApplying = false;
      if (!data || !data.ok) {
        state.textLive = false;
        showMessage("error", "Live update stopped: " + ((data && data.error) || "the layers did not take it.") + " Press Apply again after fixing the selection.");
        setStatus("Live update stopped");
        return;
      }
      setStatus("Updated " + plan.name);
    });
  }

  /* ---------- text MOGRT export (Part 6C) ---------- */

  function textNodeModule(name) {
    try {
      if (typeof require === "function") return require(name);
    } catch (eRequire) {}
    try {
      if (typeof window !== "undefined" && typeof window.require === "function") return window.require(name);
    } catch (eWindowRequire) {}
    return null;
  }

  function textMogrtFolder() {
    var os = textNodeModule("os");
    var path = textNodeModule("path");
    if (!os || !path) return "";
    var dir = path.join(os.tmpdir(), "QuickKit", "mogrt");
    try {
      var fs = textNodeModule("fs");
      if (fs && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (eMkdir) {}
    return dir;
  }

  function textSetProgress(message) {
    if (!els.textProgress) return;
    if (!message) {
      els.textProgress.hidden = true;
      els.textProgress.textContent = "";
      return;
    }
    els.textProgress.hidden = false;
    els.textProgress.textContent = message;
  }

  function textMogrtSetBusy(busy) {
    if (els.textMogrt) els.textMogrt.disabled = !!busy && !state.textMogrtJob;
    if (els.textMogrtAll) els.textMogrtAll.disabled = !!busy;
    if (els.textCancel) els.textCancel.hidden = !busy;
  }

  function textMogrtExport(plan, done) {
    var dir = textMogrtFolder();
    if (!dir) {
      done({ ok: false, error: "QuickKit could not reach a temp folder for the .mogrt file." });
      return;
    }
    bridgeCall("qkTextPresetMogrt(" + qkQuote(JSON.stringify({ plan: plan, dir: dir })) + ")", done);
  }

  function textMogrtExists(name) {
    if (!lib.index || !lib.index.items) return false;
    for (var i = 0; i < lib.index.items.length; i++) {
      if (lib.index.items[i].name === name) return true;
    }
    return false;
  }

  function textMogrtSaveFile(data, plan) {
    var fs = textNodeModule("fs");
    var api = libApiGet();
    if (!fs) return { ok: false, error: "QuickKit could not read the exported .mogrt file." };
    if (!api || !api.itemAdd) return { ok: false, error: lib.apiError || "The library is not available, so the .mogrt was not saved." };

    var name = data.name + " (MOGRT)";
    if (textMogrtExists(name)) return { ok: true, skipped: true, name: name };

    var buffer = null;
    try {
      buffer = fs.readFileSync(data.file);
    } catch (eRead) {
      return { ok: false, error: "QuickKit could not read the exported .mogrt file." };
    }

    var engine = textEngine();
    var slug = engine ? engine.slug(data.name) : "quickkit-text-preset";
    var result = api.itemAdd({
      type: "mogrt",
      name: name,
      category: "Text / " + plan.category,
      tags: ["text", "text-preset", "mogrt", engine ? engine.slug(plan.category) : "text"],
      hostSupport: ["AEFT", "PPRO"],
      asset: slug + ".mogrt",
      assetName: slug + ".mogrt",
      buffer: buffer,
      notes: plan.note,
      author: "QuickKit"
    });

    if (result && result.ok) libRefresh();
    return result || { ok: false, error: "The .mogrt was not saved into the library." };
  }

  function textMogrtManual(data, plan) {
    state.textMogrtPending = { data: data, plan: plan };
    if (els.textMogrt) els.textMogrt.textContent = "Finish MOGRT export";
    textSetProgress("");
    showMessage(
      "error",
      "After Effects kept the template comp \"" + data.comp + "\" open in Essential Graphics. Press Export Motion Graphics Template there and save it to " +
        data.dir + " then press Finish MOGRT export. The save prompt on the next try: choose Don't Save."
    );
    setStatus("MOGRT export needs one manual step");
  }

  function textMogrtClick() {
    if (state.textMogrtPending) {
      textMogrtFinish();
      return;
    }
    if (state.textMogrtJob && state.textMogrtJob.active) return;

    var plan = textBuildPlan();
    if (!plan) {
      showMessage("error", "Turn on Animate in, Animate out, or both.");
      return;
    }

    textMogrtSetBusy(true);
    textSetProgress("Building and exporting \"" + plan.name + "\u2026");
    setStatus("Exporting MOGRT\u2026");

    textMogrtExport(plan, function (data) {
      textMogrtSetBusy(false);
      textSetProgress("");

      if (data && data.manual) {
        textMogrtManual(data, plan);
        return;
      }
      if (!data || !data.ok) {
        showMessage("error", (data && data.error) || "The MOGRT was not exported.");
        setStatus("MOGRT export failed");
        return;
      }

      var saved = textMogrtSaveFile(data, plan);
      if (!saved.ok) {
        showMessage("error", saved.error || "The .mogrt was exported but not saved into the library.");
        setStatus("MOGRT exported, not saved");
        return;
      }

      showMessage(
        "ok",
        saved.skipped
          ? "\"" + plan.name + "\" is already in the library as a MOGRT."
          : "Exported \"" + plan.name + "\" and saved it in the library as a MOGRT."
      );
      setStatus("MOGRT saved in the library");
    });
  }

  function textMogrtFinish() {
    var pending = state.textMogrtPending;
    if (!pending) return;

    var fs = textNodeModule("fs");
    if (!fs || !pending.data.file || !fs.existsSync(pending.data.file)) {
      showMessage("error", "After Effects has not written " + pending.data.file + " yet. Export it from Essential Graphics, then press Finish MOGRT export again.");
      return;
    }

    var saved = textMogrtSaveFile(pending.data, pending.plan);
    if (!saved.ok) {
      showMessage("error", saved.error || "The .mogrt could not be saved into the library.");
      return;
    }

    state.textMogrtPending = null;
    if (els.textMogrt) els.textMogrt.textContent = "Export MOGRT";
    showMessage("ok", "Saved \"" + pending.plan.name + "\" into the library as a MOGRT.");
    setStatus("MOGRT saved in the library");
  }

  function textMogrtExportAll() {
    if (state.textMogrtJob && state.textMogrtJob.active) return;
    if (state.textMogrtPending) {
      showMessage("error", "Finish the MOGRT that is waiting in Essential Graphics first.");
      return;
    }

    var engine = textEngine();
    if (!engine) return;
    if (libCurrentHost() !== "AEFT") {
      showMessage("error", "MOGRTs are built in After Effects. Open the panel there to export.");
      return;
    }

    var queue = [];
    for (var i = 0; i < engine.PRESETS.length; i++) queue.push(engine.PRESETS[i].id);

    state.textMogrtJob = {
      active: true,
      cancel: false,
      queue: queue,
      done: 0,
      total: queue.length,
      added: 0,
      failed: 0
    };
    textMogrtSetBusy(true);
    textSetProgress("Starting 0 of " + queue.length + "\u2026");
    textMogrtNext();
  }

  function textMogrtNext() {
    var job = state.textMogrtJob;
    if (!job || !job.active) return;
    var engine = textEngine();

    if (job.cancel) {
      textMogrtEnd();
      return;
    }
    if (!job.queue.length) {
      textMogrtEnd();
      return;
    }

    var id = job.queue.shift();
    var plan = engine.plan(id, null);
    if (!plan) {
      job.done++;
      job.failed++;
      textMogrtNext();
      return;
    }

    textSetProgress(
      "MOGRT " + (job.done + 1) + " of " + job.total + " \u2014 " + plan.name
    );

    textMogrtExport(plan, function (data) {
      if (!state.textMogrtJob || !state.textMogrtJob.active) return;
      job.done++;

      if (data && data.manual) {
        textMogrtManual(data, plan);
        job.cancel = true;
        textMogrtEnd();
        return;
      }
      if (!data || !data.ok) {
        job.failed++;
        textMogrtNext();
        return;
      }

      var saved = textMogrtSaveFile(data, plan);
      if (!saved.ok) job.failed++;
      else job.added++;
      textMogrtNext();
    });
  }

  function textMogrtCancel() {
    var job = state.textMogrtJob;
    if (!job || !job.active) return;
    job.cancel = true;
    textSetProgress("Stopping after this preset\u2026");
    setStatus("Stopping MOGRT export");
  }

  function textMogrtEnd() {
    var job = state.textMogrtJob;
    var added = job ? job.added : 0;
    var failed = job ? job.failed : 0;
    var total = job ? job.total : 0;
    state.textMogrtJob = null;
    textMogrtSetBusy(false);
    textSetProgress("");
    libRefresh();
    showMessage(
      failed ? "error" : "ok",
      "MOGRT export finished: " + added + " added, " + failed + " failed, " + total + " tried."
    );
    setStatus("MOGRT export finished");
  }

  /* ---------- seeding + previews (Part 6C) ---------- */

  function textSeedLibrary() {
    var engine = textEngine();
    if (!engine) return 0;
    var api = libApiGet();
    if (!api || !api.itemAdd) return 0;

    var key = "qk.textpresets.seeded";
    var want = engine.VERSION + ":" + engine.PRESETS.length;
    if (libStore(key) === want) return 0;

    var added = 0;
    for (var i = 0; i < engine.PRESETS.length; i++) {
      var def = engine.PRESETS[i];
      var plan = engine.plan(def.id, null);
      if (!plan) continue;
      var text = JSON.stringify({
        format: "quickkit-text-preset",
        version: engine.VERSION,
        id: def.id,
        plan: plan
      });
      var result = api.itemAdd({
        id: "qk-text-" + def.id,
        type: "ae-preset",
        name: def.name,
        category: "Text / " + def.category,
        tags: ["text", "text-preset", engine.slug(def.category)],
        hostSupport: ["AEFT"],
        asset: def.id + ".qktextpreset",
        assetName: def.name + ".qktextpreset",
        text: text,
        notes: def.note,
        author: "QuickKit"
      });
      if (result && result.ok) added++;
    }

    libStore(key, want);
    state.textSeeded = added;
    libRefresh();
    return added;
  }

  function textOnShow() {
    var added = textSeedLibrary();
    if (!added) return;
    if (libCurrentHost() !== "AEFT") return;
    setStatus("Added " + added + " text presets to the library; generating previews");

    /* Part 6B batch: renders each new item through the same preview pipeline
       and can be cancelled from the preview pane or the Text tab. */
    window.setTimeout(function () {
      libGenerateMissing();
    }, 400);
  }

  /* ---------- presets ---------- */

  var PRESET_LIST_TIMEOUT = 15000;
  var PRESET_ACTION_TIMEOUT = 20000;
  var PRESET_DIALOG_TIMEOUT = 120000;
  var PRESET_NEW_FOLDER = "__new__";

  function presetColorCss(color) {
    if (!color || !color.length) return "";
    var parts = [];
    for (var i = 0; i < 3; i++) {
      var value = Number(color[i]);
      if (!isFinite(value)) return "";
      value = Math.round(Math.max(0, Math.min(1, value)) * 255);
      var hex = value.toString(16);
      parts.push(hex.length < 2 ? "0" + hex : hex);
    }
    return "#" + parts.join("");
  }

  function presetGlyph(preset) {
    var glyph = preset.thumbnail && preset.thumbnail.glyph ? String(preset.thumbnail.glyph) : "";
    if (!glyph) glyph = String(preset.name || "P").charAt(0).toUpperCase();
    return glyph.substring(0, 2);
  }

  function presetMeta(preset) {
    var folder = preset.folder ? preset.folder : "All";
    var summary = preset.summary || (preset.layerCount + " layers");
    return folder + " · " + summary;
  }

  function visiblePresets() {
    var query = state.presetQuery.toLowerCase().replace(/^\s+|\s+$/g, "");
    var folder = state.presetFolder.toLowerCase();
    var out = [];

    for (var i = 0; i < state.presets.length; i++) {
      var preset = state.presets[i];
      if (state.presetFavorites && !preset.favorite) continue;
      if (!state.presetFavorites && folder !== "" && String(preset.folder || "").toLowerCase() !== folder) continue;
      if (query !== "") {
        var haystack = (String(preset.name || "") + " " + String(preset.folder || "") + " " + String(preset.summary || "")).toLowerCase();
        if (haystack.indexOf(query) === -1) continue;
      }
      out.push(preset);
    }
    return out;
  }

  function presetCanReorder() {
    return state.presetQuery === "" && !state.presetFavorites && state.presetFolder === "";
  }

  function presetInFolder(name) {
    var count = 0;
    for (var i = 0; i < state.presets.length; i++) {
      if (String(state.presets[i].folder || "").toLowerCase() === String(name).toLowerCase()) count++;
    }
    return count;
  }

  function presetFavoriteCount() {
    var count = 0;
    for (var i = 0; i < state.presets.length; i++) {
      if (state.presets[i].favorite) count++;
    }
    return count;
  }

  function setPresetControls() {
    var hosted = state.hosted;
    if (els.presetSave) els.presetSave.disabled = !hosted;
    if (els.presetImport) els.presetImport.disabled = !hosted;
    if (els.presetNewFolder) els.presetNewFolder.disabled = !hosted;
    if (els.presetSearch) els.presetSearch.disabled = !hosted;

    var visible = visiblePresets();
    if (els.presetExport) {
      els.presetExport.disabled = !hosted || visible.length === 0;
      els.presetExport.setAttribute(
        "data-tip",
        visible.length ? "Write " + visible.length + " visible preset(s) to one .qkpack file" : "There are no presets to export"
      );
    }

    var folderActive = state.presetFolder !== "" && !state.presetFavorites;
    if (els.presetDeleteFolder) {
      els.presetDeleteFolder.hidden = !hosted || !folderActive;
      els.presetDeleteFolder.disabled = !hosted;
    }
  }

  function updatePresetNote() {
    if (!els.presetNote) return;
    var parts = [];
    if (state.presetNote) parts.push(state.presetNote);
    if (state.presetSkipped && state.presetSkipped.length) {
      parts.push(
        state.presetSkipped.length +
          (state.presetSkipped.length === 1 ? " damaged preset file was skipped." : " damaged preset files were skipped.")
      );
    }
    if (state.presetSeeded) {
      parts.push(state.presetSeeded + " starter presets were added.");
    }
    if (state.presets.length && !presetCanReorder()) {
      parts.push("Clear the search or filter to drag presets into a new order.");
    }
    if (!state.hosted) {
      parts.push("Open QuickKit inside After Effects to load and save presets.");
    }

    els.presetNote.textContent = parts.join(" ");
    els.presetNote.hidden = parts.length === 0;
  }

  function renderPresetFilters() {
    if (!els.presetFilters) return;
    els.presetFilters.innerHTML = "";
    els.presetFilters.hidden = !state.hosted || state.presets.length === 0;

    function addChip(label, count, pressed, handler, tip) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "qk-preset-chip";
      button.setAttribute("aria-pressed", pressed ? "true" : "false");
      button.setAttribute("data-tip", tip || label);
      button.appendChild(document.createTextNode(label));
      if (typeof count === "number") {
        var badge = document.createElement("span");
        badge.className = "qk-preset-chip__count";
        badge.textContent = String(count);
        button.appendChild(badge);
      }
      button.addEventListener("click", handler);
      els.presetFilters.appendChild(button);
    }

    addChip(
      "All",
      state.presets.length,
      !state.presetFavorites && state.presetFolder === "",
      function () {
        state.presetFolder = "";
        state.presetFavorites = false;
        renderPresets();
      },
      "Show every preset"
    );

    addChip(
      "Favourites",
      presetFavoriteCount(),
      state.presetFavorites,
      function () {
        state.presetFavorites = true;
        state.presetFolder = "";
        renderPresets();
      },
      "Show favourite presets"
    );

    for (var i = 0; i < state.presetFolders.length; i++) {
      (function (folder) {
        addChip(
          folder,
          presetInFolder(folder),
          !state.presetFavorites && state.presetFolder === folder,
          function () {
            state.presetFolder = folder;
            state.presetFavorites = false;
            renderPresets();
          },
          "Show presets in " + folder
        );
      })(state.presetFolders[i]);
    }
  }

  function showPresetEmpty(title, body, actions) {
    if (!els.presetEmpty) return;
    els.presetEmpty.hidden = false;
    els.presetEmptyTitle.textContent = title;
    els.presetEmptyBody.textContent = body;
    if (els.presetEmptyMark) {
      els.presetEmptyMark.innerHTML = window.QKIcons.svg("presets", 24);
    }
    if (els.presetEmptyActions) {
      els.presetEmptyActions.innerHTML = "";
      for (var i = 0; i < actions.length; i++) {
        (function (action) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "qk-btn qk-btn--sm qk-action " + (action.primary ? "qk-btn--primary" : "qk-btn--secondary");
          button.textContent = action.label;
          button.setAttribute("data-tip", action.tip || action.label);
          button.disabled = !state.hosted && !action.allowPreview;
          button.addEventListener("click", action.onClick);
          els.presetEmptyActions.appendChild(button);
        })(actions[i]);
      }
    }
  }

  function hidePresetEmpty() {
    if (els.presetEmpty) els.presetEmpty.hidden = true;
    if (els.presetEmptyActions) els.presetEmptyActions.innerHTML = "";
  }

  function renderPresets() {
    if (!els.presetList) return;

    renderPresetFilters();
    updatePresetNote();

    if (els.presetPath) {
      els.presetPath.textContent = state.presetRoot
        ? "Stored in " + state.presetRoot
        : "Stored locally in %APPDATA%\\QuickKit\\presets";
      els.presetPath.setAttribute("data-tip", els.presetPath.textContent);
    }

    while (els.presetList.firstChild) els.presetList.removeChild(els.presetList.firstChild);
    els.presetList.hidden = false;
    hidePresetEmpty();

    if (!state.hosted) {
      els.presetList.hidden = true;
      showPresetEmpty(
        "Presets need After Effects",
        "Open QuickKit from Window > Extensions inside After Effects. The browser preview cannot read or write your preset folder.",
        []
      );
      setPresetControls();
      return;
    }

    if (state.presetLoading) {
      var loading = document.createElement("div");
      loading.className = "qk-preset-loading";
      loading.textContent = "Loading presets…";
      els.presetList.appendChild(loading);
      setPresetControls();
      return;
    }

    if (state.presetLoadError) {
      els.presetList.hidden = true;
      showPresetEmpty(
        "Could not load presets",
        state.presetLoadError,
        [
          {
            label: "Try again",
            primary: true,
            tip: "Ask After Effects for the preset list again",
            onClick: function () {
              state.presetLoadError = "";
              loadPresets();
            }
          }
        ]
      );
      setPresetControls();
      return;
    }

    if (!state.presets.length) {
      els.presetList.hidden = true;
      showPresetEmpty(
        "No presets yet",
        "Select layers in After Effects and save their look. You can also import a .qkpack file from another QuickKit install.",
        [
          { label: "Save selection", primary: true, tip: "Capture the selected layers", onClick: savePreset },
          { label: "Import pack", primary: false, tip: "Merge a .qkpack file", onClick: importPack }
        ]
      );
      setPresetControls();
      return;
    }

    var visible = visiblePresets();
    if (!visible.length) {
      els.presetList.hidden = true;
      var clearFilters = function () {
        state.presetQuery = "";
        state.presetFolder = "";
        state.presetFavorites = false;
        if (els.presetSearch) els.presetSearch.value = "";
        renderPresets();
      };
      var emptyActions = [
        { label: "Clear filters", primary: true, tip: "Show every preset", onClick: clearFilters }
      ];
      var emptyTitle = "No presets match";
      var emptyBody = "Try a different search, or show every preset again.";

      if (!state.presetQuery && state.presetFavorites) {
        emptyTitle = "No favourites yet";
        emptyBody = "Star a preset to keep it close. Favourites stay in their folders.";
      } else if (!state.presetQuery && state.presetFolder) {
        emptyTitle = "This folder is empty";
        emptyBody = "Save the current selection here, or move an existing preset into this folder.";
        emptyActions = [
          { label: "Save here", primary: true, tip: "Save the selected layers into this folder", onClick: savePreset },
          { label: "Show all presets", primary: false, tip: "Show every preset", onClick: clearFilters }
        ];
      }

      showPresetEmpty(emptyTitle, emptyBody, emptyActions);
      setPresetControls();
      return;
    }

    for (var i = 0; i < visible.length; i++) {
      els.presetList.appendChild(createPresetCard(visible[i]));
    }
    setPresetControls();
  }

  function createPresetCard(preset) {
    var card = document.createElement("article");
    card.className = "qk-preset-card";
    card.setAttribute("role", "listitem");
    card.setAttribute("data-id", preset.id);
    card.draggable = presetCanReorder();

    var main = document.createElement("button");
    main.type = "button";
    main.className = "qk-preset-card__main qk-action";
    main.setAttribute("data-tip", "Apply " + preset.name + " to the selected layers");
    main.addEventListener("click", function () {
      applyPreset(preset.id, main);
    });

    var thumb = document.createElement("span");
    thumb.className = "qk-preset-thumb";
    var color = presetColorCss(preset.thumbnail && preset.thumbnail.color);
    if (color) thumb.style.setProperty("--qk-preset-color", color);

    var glyph = document.createElement("span");
    glyph.className = "qk-preset-thumb__glyph";
    glyph.textContent = presetGlyph(preset);
    thumb.appendChild(glyph);

    if (preset.thumbnail && preset.thumbnail.motion) {
      var motion = document.createElement("span");
      motion.className = "qk-preset-thumb__motion";
      motion.setAttribute("aria-hidden", "true");
      thumb.appendChild(motion);
    }

    var copy = document.createElement("span");
    copy.className = "qk-preset-copy";
    var name = document.createElement("span");
    name.className = "qk-preset-name";
    name.textContent = preset.name;
    var meta = document.createElement("span");
    meta.className = "qk-preset-meta";
    meta.textContent = presetMeta(preset);
    copy.appendChild(name);
    copy.appendChild(meta);

    main.appendChild(thumb);
    main.appendChild(copy);

    var star = document.createElement("button");
    star.type = "button";
    star.className = "qk-preset-card__icon qk-preset-card__icon--star qk-action";
    star.setAttribute("aria-pressed", preset.favorite ? "true" : "false");
    star.setAttribute("aria-label", preset.favorite ? "Remove from favourites" : "Add to favourites");
    star.setAttribute("data-tip", preset.favorite ? "Remove from favourites" : "Add to favourites");
    star.textContent = preset.favorite ? "★" : "☆";
    star.addEventListener("click", function (event) {
      event.stopPropagation();
      toggleFavorite(preset, star);
    });

    var menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "qk-preset-card__icon qk-preset-card__icon--menu qk-action";
    menuButton.setAttribute("aria-label", "Preset actions");
    menuButton.setAttribute("aria-haspopup", "true");
    menuButton.setAttribute("aria-expanded", state.presetMenuId === preset.id ? "true" : "false");
    menuButton.setAttribute("data-tip", "Rename, move, export or delete this preset");
    menuButton.textContent = "⋯";
    menuButton.addEventListener("click", function (event) {
      event.stopPropagation();
      state.presetMenuId = state.presetMenuId === preset.id ? null : preset.id;
      renderPresets();
    });

    card.appendChild(main);
    card.appendChild(star);
    card.appendChild(menuButton);

    if (state.presetMenuId === preset.id) {
      card.appendChild(createPresetMenu(preset));
    }

    if (presetCanReorder()) {
      card.addEventListener("dragstart", function (event) {
        state.presetDragId = preset.id;
        state.presetDragAfter = false;
        card.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          try {
            event.dataTransfer.setData("text/plain", preset.id);
          } catch (eData) {}
        }
      });
      card.addEventListener("dragend", function () {
        state.presetDragId = null;
        clearPresetDropMarks();
      });
      card.addEventListener("dragover", function (event) {
        if (!state.presetDragId || state.presetDragId === preset.id) return;
        event.preventDefault();
        var box = card.getBoundingClientRect();
        var after = event.clientX > box.left + box.width / 2;
        state.presetDragAfter = after;
        clearPresetDropMarks();
        card.classList.add(after ? "is-drop-after" : "is-drop-before");
      });
      card.addEventListener("dragleave", function (event) {
        if (event.relatedTarget && card.contains(event.relatedTarget)) return;
        card.classList.remove("is-drop-before");
        card.classList.remove("is-drop-after");
      });
      card.addEventListener("drop", function (event) {
        event.preventDefault();
        if (!state.presetDragId || state.presetDragId === preset.id) return;
        reorderPresets(state.presetDragId, preset.id, state.presetDragAfter);
      });
    }

    return card;
  }

  function createPresetMenu(preset) {
    var menu = document.createElement("div");
    menu.className = "qk-preset-menu";
    menu.setAttribute("role", "menu");
    menu.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    function item(label, handler) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "qk-action";
      button.setAttribute("role", "menuitem");
      button.textContent = label;
      button.addEventListener("click", function () {
        closePresetMenus();
        handler();
      });
      menu.appendChild(button);
    }

    item("Rename", function () {
      renamePreset(preset);
    });
    item("Move to folder", function () {
      movePreset(preset);
    });
    item("Export this preset", function () {
      exportPresets([preset.id], els.presetExport);
    });
    item("Delete", function () {
      deletePreset(preset);
    });
    return menu;
  }

  function clearPresetDropMarks() {
    qsa(".qk-preset-card", els.presetList).forEach(function (card) {
      card.classList.remove("is-dragging");
      card.classList.remove("is-drop-before");
      card.classList.remove("is-drop-after");
    });
  }

  function reorderPresets(dragId, targetId, after) {
    var ids = [];
    for (var i = 0; i < state.presets.length; i++) ids.push(state.presets[i].id);
    var from = ids.indexOf(dragId);
    if (from === -1) return;
    ids.splice(from, 1);
    var to = ids.indexOf(targetId);
    if (to === -1) to = ids.length;
    if (after) to++;
    ids.splice(to, 0, dragId);

    state.presetDragId = null;
    clearPresetDropMarks();

    presetRequest(
      "qkPresetReorder(" + qkQuote(JSON.stringify(ids)) + ")",
      null,
      PRESET_ACTION_TIMEOUT,
      function (data) {
        showMessage("ok", data.message || "Saved the new order.");
        setStatus("Presets: order saved");
        loadPresets();
      },
      function () {
        renderPresets();
      }
    );
  }

  function presetRequest(script, button, timeout, onSuccess, onError) {
    if (state.busy) return;
    var bridge = window.CSInterfaceLite;
    if (!bridge || !bridge.isHosted) {
      var previewMessage = "QuickKit is not connected to After Effects. Open the panel inside the app and try again.";
      showMessage("error", previewMessage);
      setStatus("Preset action skipped");
      if (onError) onError(previewMessage);
      return;
    }

    setBusy(true, button);
    var settled = false;
    var timer = window.setTimeout(function () {
      if (settled) return;
      settled = true;
      setBusy(false, button);
      var timedOut = "After Effects did not answer in time. If a file dialog is open, finish or cancel it and try again.";
      showMessage("error", timedOut);
      setStatus("Preset action timed out");
      if (onError) onError(timedOut);
    }, timeout);

    bridge.evalScript(script, function (raw) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      setBusy(false, button);

      var problem = "";
      if (raw === null || raw === undefined || raw === "") {
        problem = "The app returned nothing. If After Effects showed a script error, the QuickKit host file did not load. Run scripts\\install.bat again, restart the app and reopen the panel.";
      } else if (String(raw) === "EvalScript error.") {
        problem = "After Effects could not run the QuickKit preset script. Reinstall the panel and reopen it.";
      }

      var data = null;
      if (!problem) {
        try {
          data = JSON.parse(String(raw));
        } catch (eParse) {
          data = null;
        }
        if (!data) problem = "QuickKit could not read the answer from After Effects: " + String(raw).slice(0, 120);
        else if (!data.ok) problem = data.error || "After Effects reported a problem without details.";
      }

      if (problem) {
        showMessage("error", problem);
        setStatus("Preset action failed");
        if (onError) onError(problem);
        return;
      }

      if (onSuccess) onSuccess(data);
    });
  }

  function loadPresets() {
    if (!state.hosted || !els.presetList) {
      renderPresets();
      return;
    }
    if (state.presetLoading || state.busy) return;

    state.presetLoading = true;
    state.presetLoadError = "";
    renderPresets();

    presetRequest(
      "qkPresetList()",
      null,
      PRESET_LIST_TIMEOUT,
      function (data) {
        state.presetLoading = false;
        state.presets = data.presets instanceof Array ? data.presets : [];
        state.presetFolders = data.folders instanceof Array ? data.folders : [];
        state.presetRoot = data.root ? String(data.root) : "";
        state.presetNote = data.note ? String(data.note) : "";
        state.presetSkipped = data.skipped instanceof Array ? data.skipped : [];
        state.presetSeeded = Number(data.seeded) || 0;
        state.presetLoaded = true;
        renderPresets();
      },
      function (message) {
        state.presetLoading = false;
        state.presetLoadError = message;
        renderPresets();
      }
    );
  }

  function applyPreset(id, button) {
    presetRequest(
      "qkPresetApply(" + qkQuote(id) + ")",
      button,
      PRESET_ACTION_TIMEOUT,
      function (data) {
        var message = data.message || "Preset applied.";
        showMessage("ok", message);
        setStatus("Last action: " + message);
        rememberUndoHint();
      },
      null
    );
  }

  function toggleFavorite(preset, button) {
    var next = !preset.favorite;
    presetRequest(
      "qkPresetFavorite(" + qkQuote(preset.id) + ", " + qkQuote(next ? "1" : "0") + ")",
      button,
      PRESET_ACTION_TIMEOUT,
      function (data) {
        preset.favorite = next;
        showMessage("ok", data.message || "Favourite updated.");
        setStatus("Presets: favourite updated");
        renderPresets();
      },
      null
    );
  }

  function presetFolderOptions() {
    var options = [{ value: "", label: "All presets" }];
    for (var i = 0; i < state.presetFolders.length; i++) {
      options.push({ value: state.presetFolders[i], label: state.presetFolders[i] });
    }
    options.push({ value: PRESET_NEW_FOLDER, label: "New folder…" });
    return options;
  }

  function savePreset() {
    if (!state.hosted) {
      showMessage("error", "Open QuickKit inside After Effects to save a preset.");
      return;
    }
    var defaultFolder = !state.presetFavorites ? state.presetFolder : "";
    openPresetDialog({
      title: "Save selection as a preset",
      okLabel: "Save preset",
      fields: [
        {
          key: "name",
          type: "text",
          label: "Preset name",
          value: "Preset " + (state.presets.length + 1),
          placeholder: "e.g. Clean lower third",
          maxlength: 60
        },
        { key: "folder", type: "select", label: "Folder", value: defaultFolder, options: presetFolderOptions() },
        { key: "newFolder", type: "text", label: "New folder name", value: "", placeholder: "Only if you chose New folder…", maxlength: 40 }
      ],
      onConfirm: function (values) {
        var name = qkTrimText(values.name);
        var folder = values.folder;
        if (!name) {
          showMessage("error", "Give the preset a name first.");
          return false;
        }
        if (folder === PRESET_NEW_FOLDER) {
          folder = qkTrimText(values.newFolder);
          if (!folder) {
            showMessage("error", "Name the new folder or choose an existing one.");
            return false;
          }
        }
        closePresetDialog();
        presetRequest(
          "qkPresetSave(" + qkQuote(name) + ", " + qkQuote(folder) + ")",
          els.presetSave,
          PRESET_ACTION_TIMEOUT,
          function (data) {
            showMessage("ok", data.message || "Preset saved.");
            setStatus("Presets: saved");
            if (folder) {
              state.presetFolder = folder;
              state.presetFavorites = false;
            }
            loadPresets();
          },
          null
        );
        return true;
      }
    });
  }

  function renamePreset(preset) {
    openPresetDialog({
      title: "Rename preset",
      okLabel: "Rename",
      fields: [
        { key: "name", type: "text", label: "Preset name", value: preset.name, maxlength: 60 }
      ],
      onConfirm: function (values) {
        var name = qkTrimText(values.name);
        if (!name) {
          showMessage("error", "Give the preset a name first.");
          return false;
        }
        closePresetDialog();
        presetRequest(
          "qkPresetRename(" + qkQuote(preset.id) + ", " + qkQuote(name) + ")",
          null,
          PRESET_ACTION_TIMEOUT,
          function (data) {
            showMessage("ok", data.message || "Preset renamed.");
            setStatus("Presets: renamed");
            loadPresets();
          },
          null
        );
        return true;
      }
    });
  }

  function movePreset(preset) {
    openPresetDialog({
      title: "Move preset",
      okLabel: "Move",
      fields: [
        { key: "folder", type: "select", label: "Folder", value: preset.folder || "", options: presetFolderOptions() },
        { key: "newFolder", type: "text", label: "New folder name", value: "", placeholder: "Only if you chose New folder…", maxlength: 40 }
      ],
      onConfirm: function (values) {
        var folder = values.folder;
        if (folder === PRESET_NEW_FOLDER) {
          folder = qkTrimText(values.newFolder);
          if (!folder) {
            showMessage("error", "Name the new folder or choose All presets.");
            return false;
          }
        }
        closePresetDialog();
        presetRequest(
          "qkPresetMove(" + qkQuote(preset.id) + ", " + qkQuote(folder) + ")",
          null,
          PRESET_ACTION_TIMEOUT,
          function (data) {
            showMessage("ok", data.message || "Preset moved.");
            setStatus("Presets: moved");
            loadPresets();
          },
          null
        );
        return true;
      }
    });
  }

  function deletePreset(preset) {
    openPresetDialog({
      title: "Delete preset?",
      okLabel: "Delete",
      message: "Delete \"" + preset.name + "\"? This removes its local file. It cannot be undone from QuickKit.",
      fields: [],
      onConfirm: function () {
        closePresetDialog();
        presetRequest(
          "qkPresetDelete(" + qkQuote(preset.id) + ")",
          null,
          PRESET_ACTION_TIMEOUT,
          function (data) {
            showMessage("ok", data.message || "Preset deleted.");
            setStatus("Presets: deleted");
            loadPresets();
          },
          null
        );
        return true;
      }
    });
  }

  function createFolder() {
    if (!state.hosted) return;
    openPresetDialog({
      title: "New folder",
      okLabel: "Create folder",
      fields: [{ key: "name", type: "text", label: "Folder name", value: "", maxlength: 40 }],
      onConfirm: function (values) {
        var name = qkTrimText(values.name);
        if (!name) {
          showMessage("error", "Give the folder a name first.");
          return false;
        }
        closePresetDialog();
        presetRequest(
          "qkFolderCreate(" + qkQuote(name) + ")",
          els.presetNewFolder,
          PRESET_ACTION_TIMEOUT,
          function (data) {
            showMessage("ok", data.message || "Folder created.");
            setStatus("Presets: folder created");
            state.presetFolder = name;
            state.presetFavorites = false;
            loadPresets();
          },
          null
        );
        return true;
      }
    });
  }

  function deleteFolder() {
    var folder = state.presetFolder;
    if (!folder) return;
    openPresetDialog({
      title: "Delete folder?",
      okLabel: "Delete folder",
      message: "Delete \"" + folder + "\"? Its presets are moved to All, not deleted.",
      fields: [],
      onConfirm: function () {
        closePresetDialog();
        presetRequest(
          "qkFolderDelete(" + qkQuote(folder) + ")",
          els.presetDeleteFolder,
          PRESET_ACTION_TIMEOUT,
          function (data) {
            showMessage("ok", data.message || "Folder deleted.");
            setStatus("Presets: folder deleted");
            state.presetFolder = "";
            state.presetFavorites = false;
            loadPresets();
          },
          null
        );
        return true;
      }
    });
  }

  function importPack() {
    presetRequest(
      "qkPresetImport()",
      els.presetImport,
      PRESET_DIALOG_TIMEOUT,
      function (data) {
        showMessage("ok", data.message || "Pack imported.");
        setStatus("Presets: imported");
        loadPresets();
      },
      null
    );
  }

  function exportPresets(ids, button) {
    if (!ids || !ids.length) {
      showMessage("error", "There are no presets to export in this view.");
      return;
    }
    presetRequest(
      "qkPresetExport(" + qkQuote(JSON.stringify(ids)) + ")",
      button,
      PRESET_DIALOG_TIMEOUT,
      function (data) {
        showMessage("ok", data.message || "Pack exported.");
        setStatus("Presets: exported");
      },
      null
    );
  }

  function exportVisiblePresets() {
    var visible = visiblePresets();
    var ids = [];
    for (var i = 0; i < visible.length; i++) ids.push(visible[i].id);
    exportPresets(ids, els.presetExport);
  }

  function qkTrimText(value) {
    return String(value === null || value === undefined ? "" : value).replace(/^\s+|\s+$/g, "");
  }

  function openPresetDialog(options) {
    if (!els.presetDialog) return;
    state.presetDialogReturnFocus = document.activeElement;
    state.presetDialogFields = [];
    state.presetDialogOnConfirm = options.onConfirm || null;
    state.presetDialogOnCancel = options.onCancel || null;

    els.presetDialogTitle.textContent = options.title || "Preset";
    els.presetDialogOk.textContent = options.okLabel || "Save";
    els.presetDialogBody.innerHTML = "";

    if (options.message) {
      var message = document.createElement("p");
      message.className = "qk-preset-dialog__message";
      message.textContent = options.message;
      els.presetDialogBody.appendChild(message);
    }

    var fields = options.fields || [];
    for (var i = 0; i < fields.length; i++) {
      (function (field) {
        var label = document.createElement("label");
        label.className = "qk-preset-dialog__field";
        var caption = document.createElement("span");
        caption.className = "qk-label";
        caption.textContent = field.label;
        label.appendChild(caption);

        var input = null;
        if (field.type === "select") {
          input = document.createElement("select");
          input.className = "qk-select";
          var choices = field.options || [];
          for (var j = 0; j < choices.length; j++) {
            var option = document.createElement("option");
            option.value = choices[j].value;
            option.textContent = choices[j].label;
            if (choices[j].value === field.value) option.selected = true;
            input.appendChild(option);
          }
        } else {
          input = document.createElement("input");
          input.className = "qk-input";
          input.type = "text";
          input.value = field.value || "";
          input.placeholder = field.placeholder || "";
          if (field.maxlength) input.maxLength = field.maxlength;
          input.autocomplete = "off";
        }

        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            confirmPresetDialog();
          }
        });

        label.appendChild(input);
        els.presetDialogBody.appendChild(label);
        state.presetDialogFields.push({ key: field.key, input: input });
      })(fields[i]);
    }

    els.presetDialog.hidden = false;
    var first = state.presetDialogFields.length ? state.presetDialogFields[0].input : null;
    if (first) first.focus();
    else els.presetDialogOk.focus();
  }

  function confirmPresetDialog() {
    if (!els.presetDialog || els.presetDialog.hidden) return;
    var values = {};
    for (var i = 0; i < state.presetDialogFields.length; i++) {
      values[state.presetDialogFields[i].key] = state.presetDialogFields[i].input.value;
    }
    var callback = state.presetDialogOnConfirm;
    if (callback) {
      var keepOpen = callback(values);
      if (keepOpen === false) return;
    }
    closePresetDialog();
  }

  function closePresetDialog() {
    if (!els.presetDialog || els.presetDialog.hidden) return;
    els.presetDialog.hidden = true;
    els.presetDialogBody.innerHTML = "";
    state.presetDialogFields = [];
    state.presetDialogOnConfirm = null;
    state.presetDialogOnCancel = null;
    if (state.presetDialogReturnFocus && typeof state.presetDialogReturnFocus.focus === "function") {
      state.presetDialogReturnFocus.focus();
    }
    state.presetDialogReturnFocus = null;
  }

  function closePresetMenus() {
    state.presetMenuId = null;
    qsa(".qk-preset-menu", els.presetList).forEach(function (menu) {
      menu.hidden = true;
    });
    qsa(".qk-preset-card__icon--menu", els.presetList).forEach(function (button) {
      button.setAttribute("aria-expanded", "false");
    });
  }

  function bindPresets() {
    if (els.presetSearch) {
      els.presetSearch.addEventListener("input", function () {
        state.presetQuery = this.value || "";
        state.presetMenuId = null;
        renderPresets();
      });
    }

    if (els.presetSave) els.presetSave.addEventListener("click", savePreset);
    if (els.presetNewFolder) els.presetNewFolder.addEventListener("click", createFolder);
    if (els.presetDeleteFolder) els.presetDeleteFolder.addEventListener("click", deleteFolder);
    if (els.presetImport) els.presetImport.addEventListener("click", importPack);
    if (els.presetExport) els.presetExport.addEventListener("click", exportVisiblePresets);

    if (els.presetDialogOk) els.presetDialogOk.addEventListener("click", confirmPresetDialog);
    if (els.presetDialogCancel) {
      els.presetDialogCancel.addEventListener("click", function () {
        closePresetDialog();
      });
    }
    if (els.presetDialogClose) {
      els.presetDialogClose.addEventListener("click", function () {
        closePresetDialog();
      });
    }
    if (els.presetDialog) {
      els.presetDialog.addEventListener("click", function (event) {
        if (event.target === els.presetDialog) closePresetDialog();
      });
    }

    document.addEventListener("click", function (event) {
      if (!state.presetMenuId) return;
      if (event.target.closest(".qk-preset-menu")) return;
      if (event.target.closest(".qk-preset-card__icon--menu")) return;
      closePresetMenus();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (els.presetDialog && !els.presetDialog.hidden) closePresetDialog();
        else closePresetMenus();
      }
    });
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


  /* ---------- silence cutter (Premiere, Part 5) ---------- */

  var SILENCE_COLUMNS = 600;
  var SILENCE_COLOR_INDEX = 4;

  var silence = {
    module: null,
    moduleError: "",
    ffmpeg: null,
    ffmpegError: "",
    locating: false,
    status: "idle",
    job: null,
    clips: [],
    sequence: null,
    notes: [],
    segments: [],
    peaks: null,
    duration: 0,
    error: "",
    message: ""
  };

  function silenceNode() {
    try {
      return (
        typeof require === "function" &&
        typeof process !== "undefined" &&
        !!process.versions &&
        !!process.versions.node
      );
    } catch (e) {
      return false;
    }
  }

  /* panel.js runs inside CEP with Node enabled; in a browser preview require is
     missing and the tab says so instead of failing. */
  function silenceLoadModule() {
    if (silence.module) return silence.module;
    if (silence.moduleError) return null;
    if (!silenceNode()) {
      silence.moduleError =
        "Node is not available in this panel, so FFmpeg cannot start. Open QuickKit from Window > Extensions inside Premiere Pro.";
      return null;
    }

    var bridge = window.CSInterfaceLite;
    var root = bridge && bridge.getSystemPath ? String(bridge.getSystemPath("extension") || "") : "";
    var path;
    try {
      path = require("path");
    } catch (ePath) {
      path = null;
    }

    try {
      root = root.replace(/^file:\/\/\//i, "").replace(/^file:\/\//i, "");
      try {
        root = decodeURIComponent(root);
      } catch (eDecode) {}
      var file = root && path ? path.join(root, "js", "ffmpeg-node.js") : "./js/ffmpeg-node.js";
      silence.module = require(file);
      return silence.module;
    } catch (eLoad) {
      silence.moduleError = "Could not load the FFmpeg helper: " + (eLoad && eLoad.message ? eLoad.message : eLoad);
      return null;
    }
  }

  function silenceSettingsFile() {
    var appData = "";
    try {
      appData = String(process.env.APPDATA || "");
    } catch (e) {
      appData = "";
    }
    if (!appData) return "";
    return appData + "\\QuickKit\\settings.json";
  }

  function silenceChip(text, kind) {
    var chip = document.getElementById("qk-silence-ffmpeg-state");
    if (!chip) return;
    chip.textContent = text;
    chip.className = "qk-chip" + (kind ? " is-" + kind : "");
  }

  function silenceStatusText(text) {
    var line = document.getElementById("qk-silence-ffmpeg");
    if (line) line.textContent = text;
  }

  function silenceLocate(then) {
    if (silence.locating) return;
    var mod = silenceLoadModule();
    if (!mod) {
      silenceChip("ffmpeg unavailable", "error");
      silenceStatusText(silence.moduleError);
      if (then) then(false);
      return;
    }

    silence.locating = true;
    silenceChip("Looking for ffmpeg", "");
    silenceStatusText("Checking the extension folder, %APPDATA%\QuickKit and PATH…");

    var bridge = window.CSInterfaceLite;
    var extensionDir = bridge && bridge.getSystemPath ? String(bridge.getSystemPath("extension") || "") : "";
    var saved = "";
    var settings = silenceSettingsFile();
    try {
      var stored = settings ? mod.loadSetting(settings) : null;
      saved = stored && stored.ffmpegPath ? String(stored.ffmpegPath) : "";
    } catch (eSettings) {
      saved = "";
    }

    mod.locate({ extensionDir: extensionDir, savedPath: saved }, function (error, found) {
      silence.locating = false;

      if (error) {
        silence.ffmpeg = null;
        silence.ffmpegError = error.message;
        silenceChip("ffmpeg missing", "error");
        var tried = error.tried || [];
        silenceStatusText(
          error.message + " Places checked: " + tried.length + "."
        );
        if (then) then(false);
        return;
      }

      silence.ffmpeg = found;
      silence.ffmpegError = "";
      silenceChip("ffmpeg ready" + (found.license && found.license !== "unknown" ? " · " + found.license : ""), "ok");
      silenceStatusText(
        found.version + " — from the " + found.source + " location. Audio analysis by FFmpeg, used under its own licence."
      );
      if (then) then(true);
    });
  }

  function silenceChooseFfmpeg() {
    if (!silenceNode()) {
      showMessage("error", "Picking a file needs the panel to run inside Premiere Pro.");
      return;
    }
    var cep = window.__adobe_cep__;
    if (!cep || typeof cep.invokeSync !== "function") {
      showMessage("error", "This panel cannot open a file dialog. Run scripts\\fetch-ffmpeg.ps1 instead.");
      return;
    }

    var chosen = "";
    try {
      var result = cep.invokeSync("browseFile", JSON.stringify({ mode: "openFile", filters: ["exe"] }));
      var parsed = result ? JSON.parse(String(result)) : null;
      if (parsed && parsed.filePaths && parsed.filePaths.length) chosen = String(parsed.filePaths[0]);
    } catch (eBrowse) {
      chosen = "";
    }

    if (!chosen) {
      showMessage("error", "No file was picked. Run scripts\\fetch-ffmpeg.ps1, or leave ffmpeg on PATH.");
      return;
    }

    var mod = silenceLoadModule();
    var settings = silenceSettingsFile();
    if (mod && settings) {
      try {
        var current = mod.loadSetting(settings) || {};
        current.ffmpegPath = chosen;
        mod.saveSetting(settings, current);
      } catch (eSave) {}
    }
    silence.ffmpeg = null;
    silenceLocate();
  }

  function silenceScope() {
    var field = document.getElementById("qk-silence-scope");
    return field ? String(field.value || "sequence") : "sequence";
  }

  function silenceOptions() {
    var threshold = fieldValue("qk-silence-threshold") || "-35";
    return {
      noise: Number(threshold),
      minSilence: Number(fieldValue("qk-silence-min") || "0.5"),
      padBefore: Number(fieldValue("qk-silence-pad-before") || "0"),
      padAfter: Number(fieldValue("qk-silence-pad-after") || "0"),
      breaths: !!document.getElementById("qk-silence-breaths").checked,
      breathMax: Number(fieldValue("qk-silence-breath-max") || "0.25")
    };
  }

  function silenceHostCall(script, done) {
    var bridge = window.CSInterfaceLite;
    if (!bridge || !bridge.isHosted) {
      done({ ok: false, error: "QuickKit is not connected to Premiere Pro. Open the panel from Window > Extensions." });
      return;
    }
    bridge.evalScript(script, function (raw) {
      var data = null;
      try {
        data = JSON.parse(String(raw));
      } catch (eParse) {
        data = null;
      }
      if (!data) {
        done({ ok: false, error: "Premiere did not answer in a way QuickKit could read. Reopen the panel and try again." });
        return;
      }
      done(data);
    });
  }

  function silenceSetBusy(busy) {
    ["qk-silence-scan", "qk-silence-apply", "qk-silence-markers", "qk-silence-clear-markers", "qk-silence-find"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.disabled = busy;
    });
    var cancel = document.getElementById("qk-silence-cancel");
    if (cancel) cancel.hidden = !busy;
  }

  function silenceProgress(ratio, text) {
    var wrap = document.getElementById("qk-silence-progress-wrap");
    var bar = document.getElementById("qk-silence-progress");
    var label = document.getElementById("qk-silence-progress-text");
    if (wrap) wrap.hidden = false;
    if (bar) bar.style.width = Math.max(0, Math.min(100, Math.round(ratio * 100))) + "%";
    if (label) label.textContent = text;
  }

  function silenceFail(message) {
    silence.status = "error";
    silence.error = message;
    silence.job = null;
    silenceSetBusy(false);
    var wrap = document.getElementById("qk-silence-progress-wrap");
    if (wrap) wrap.hidden = true;
    showMessage("error", message);
    setStatus("Silence: nothing changed");
    silenceRender();
  }

  function silenceScan() {
    if (silence.status === "scanning") return;

    if (!state.hosted || state.hostId !== "PPRO") {
      showMessage("error", "The Silence cutter runs in Premiere Pro. Open the panel from Window > Extensions inside Premiere Pro.");
      return;
    }

    if (!silenceLoadModule()) {
      showMessage("error", silence.moduleError);
      return;
    }

    if (!silence.ffmpeg) {
      silenceLocate(function (ok) {
        if (ok) silenceScan();
      });
      return;
    }

    silence.status = "scanning";
    silence.clips = [];
    silence.sequence = null;
    silence.notes = [];
    silence.segments = [];
    silence.peaks = null;
    silence.duration = 0;
    silence.error = "";
    silence.message = "";
    silenceSetBusy(true);
    silenceRender();
    silenceProgress(0.02, "Asking Premiere which audio to analyse…");

    silenceHostCall("qkSilenceTargets(" + qkQuote(silenceScope()) + ")", function (data) {
      if (silence.status !== "scanning") return;
      if (!data.ok) {
        silenceFail(data.error || "Premiere could not read the sequence.");
        return;
      }
      silence.clips = data.clips || [];
      silence.sequence = data.sequence || null;
      silence.notes = data.notes || [];
      silence.duration = silence.sequence && silence.sequence.end ? Number(silence.sequence.end) : 0;

      if (!silence.clips.length) {
        silenceFail("This sequence has no audio clips QuickKit can read. Check that the clips are not offline.");
        return;
      }
      silenceAnalyse(0, {});
    });
  }

  /* One clip at a time: ffmpeg runs out of process, so the panel stays live and
     Cancel can kill the child between two clips or during one. */
  function silenceAnalyse(index, cache) {
    if (silence.status !== "scanning") return;

    if (index >= silence.clips.length) {
      silenceMapResults(cache);
      return;
    }

    var mod = silence.module;
    var clip = silence.clips[index];
    var key = String(clip.path).toLowerCase();
    var share = 1 / silence.clips.length;
    var base = index * share;
    var options = silenceOptions();

    function next() {
      window.setTimeout(function () {
        silenceAnalyse(index + 1, cache);
      }, 0);
    }

    if (cache[key]) {
      silenceProgress(base + share, "Clip " + (index + 1) + " of " + silence.clips.length + " — reused an earlier result");
      next();
      return;
    }

    silenceProgress(base + share * 0.05, "Clip " + (index + 1) + " of " + silence.clips.length + " — " + clip.name);

    mod.probe(silence.ffmpeg.path, clip.path, function (probeError, info) {
      if (silence.status !== "scanning") return;

      if (probeError) {
        cache[key] = {
          silences: [],
          peaks: null,
          problem: probeError.message
        };
        next();
        return;
      }

      if (!info.hasAudio) {
        cache[key] = { silences: [], peaks: null, problem: "no audio stream" };
        next();
        return;
      }

      silence.job = mod.detect(
        silence.ffmpeg.path,
        clip.path,
        options,
        {
          onProgress: function (seconds, ratio) {
            var part = ratio >= 0 ? ratio : 0;
            silenceProgress(
              base + share * (0.1 + part * 0.7),
              "Analysing " + clip.name + " — " + Math.round(part * 100) + "%"
            );
          },
          onDone: function (error, result) {
            silence.job = null;
            if (silence.status !== "scanning") return;

            if (error && error.code === "cancelled") return;
            if (error) {
              cache[key] = { silences: [], peaks: null, problem: error.message };
              next();
              return;
            }

            var span = Math.max(0.05, Number(clip.end) - Number(clip.start));
            var columns = Math.max(8, Math.min(SILENCE_COLUMNS, Math.round((SILENCE_COLUMNS * span) / Math.max(1, silence.duration))));

            silence.job = mod.peaks(
              silence.ffmpeg.path,
              clip.path,
              {
                start: Number(clip.inPoint) || 0,
                duration: span,
                columns: columns
              },
              {
                onDone: function (peakError, wave) {
                  silence.job = null;
                  if (silence.status !== "scanning") return;
                  cache[key] = {
                    silences: result.segments,
                    peaks: peakError ? null : wave.peaks,
                    columns: columns,
                    problem: ""
                  };
                  next();
                }
              }
            );
          }
        },
        info.duration
      );
    });
  }

  function silenceMapResults(cache) {
    var problems = [];
    var payloadClips = silence.clips.map(function (clip) {
      var hit = cache[String(clip.path).toLowerCase()];
      if (!hit) {
        problems.push(clip.name + " was not analysed");
        return { id: clip.id, silences: [] };
      }
      if (hit.problem) problems.push(clip.name + ": " + hit.problem);
      return { id: clip.id, silences: hit.silences || [] };
    });

    silence.composePeaks(cache);
    var options = silenceOptions();

    var payload = {
      clips: payloadClips,
      padBefore: options.padBefore,
      padAfter: options.padAfter,
      minLength: options.minSilence
    };

    silenceProgress(0.96, "Mapping the gaps onto the timeline…");

    silenceHostCall("qkSilenceSegments(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      if (silence.status !== "scanning") return;

      if (!data.ok) {
        silenceFail(data.error || "The gaps could not be mapped onto the timeline.");
        return;
      }

      silence.segments = (data.segments || []).map(function (segment) {
        return { start: Number(segment.start), end: Number(segment.end), on: true };
      });
      silence.message = data.message || "";
      silence.status = "ready";
      silenceSetBusy(false);

      if (problems.length) {
        silence.notes = silence.notes.concat(problems);
      }

      var wrap = document.getElementById("qk-silence-progress-wrap");
      if (wrap) wrap.hidden = Boolean(silence.segments.length) === false && !silence.message;

      silenceProgress(1, "Done — " + (silence.message || "no gaps found"));
      window.setTimeout(function () {
        var track = document.getElementById("qk-silence-progress-wrap");
        if (track) track.hidden = true;
      }, 1200);

      silenceRender();
      setStatus("Silence: " + (silence.message || "scan finished"));
      if (silence.segments.length) silenceSendMarkers(false);
    });
  }

  function silenceComposePeaks(cache) {
    if (!silence.duration) {
      silence.peaks = null;
      return;
    }

    var columns = SILENCE_COLUMNS;
    var out = new Float32Array(columns);
    var any = false;

    silence.clips.forEach(function (clip) {
      var hit = cache[String(clip.path).toLowerCase()];
      if (!hit || !hit.peaks || !hit.peaks.length) return;
      any = true;
      var clipStart = Number(clip.start);
      var clipEnd = Number(clip.end);
      var count = hit.peaks.length;

      for (var i = 0; i < count; i++) {
        var time = clipStart + ((clipEnd - clipStart) * i) / count;
        var column = Math.round((time / silence.duration) * (columns - 1));
        if (column < 0) column = 0;
        if (column >= columns) column = columns - 1;
        if (hit.peaks[i] > out[column]) out[column] = hit.peaks[i];
      }
    });

    silence.peaks = any ? out : null;
  }

  function silenceCancel() {
    if (silence.status !== "scanning") return;
    silence.status = "idle";
    if (silence.job) {
      try {
        silence.job.cancel();
      } catch (e) {}
      silence.job = null;
    }
    silenceSetBusy(false);
    var wrap = document.getElementById("qk-silence-progress-wrap");
    if (wrap) wrap.hidden = true;
    showMessage("error", "Scan stopped. Nothing was changed in the sequence.");
    setStatus("Silence: scan cancelled");
    silenceRender();
  }

  function silenceMode() {
    var chosen = "delete";
    ["delete", "mark", "mute"].forEach(function (mode) {
      var field = document.getElementById("qk-silence-mode-" + mode);
      if (field && field.checked) chosen = mode;
    });
    return chosen;
  }

  function silenceTicked() {
    return silence.segments.filter(function (segment) {
      return segment.on;
    });
  }

  function silencePayload() {
    var ticked = silenceTicked();
    return {
      mode: silenceMode(),
      segments: ticked.map(function (segment) {
        return { start: segment.start, end: segment.end };
      }),
      label: "QuickKit silence",
      colorIndex: SILENCE_COLOR_INDEX
    };
  }

  function silenceSendMarkers(quiet) {
    var ticked = silenceTicked();
    if (!ticked.length) {
      if (!quiet) showMessage("error", "Nothing is ticked, so no markers were added.");
      return;
    }

    var payload = silencePayload();
    payload.mode = "mark";

    silenceHostCall("qkSilenceApply(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      if (!data.ok) {
        if (!quiet) showMessage("error", data.error || "Premiere refused to add the markers.");
        return;
      }
      if (!quiet) {
        showMessage("ok", data.message);
        setStatus("Silence: markers added");
      }
    });
  }

  function silenceApply() {
    if (silence.status === "scanning") return;

    if (!silenceTicked().length) {
      showMessage("error", "No gap is ticked. Switch at least one on before applying.");
      return;
    }

    var payload = silencePayload();
    silenceSetBusy(true);
    setStatus("Silence: applying…");

    silenceHostCall("qkSilenceApply(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      silenceSetBusy(false);
      if (!data.ok) {
        showMessage("error", data.error || "Premiere refused the edit. Nothing was changed after that point.");
        setStatus("Silence: not applied");
        return;
      }
      showMessage("ok", data.message);
      setStatus("Silence: applied");
      rememberUndoHint();
      silence.segments = [];
      silence.peaks = null;
      silence.status = "idle";
      silenceRender();
    });
  }

  function silenceClearMarkers() {
    silenceHostCall("qkSilenceClearMarkers()", function (data) {
      if (!data.ok) {
        showMessage("error", data.error || "Premiere refused to remove the markers.");
        return;
      }
      showMessage("ok", data.message);
      setStatus("Silence: markers cleared");
    });
  }

  function silenceTime(seconds) {
    var value = Number(seconds);
    if (!isFinite(value) || value < 0) value = 0;
    var minutes = Math.floor(value / 60);
    var rest = value - minutes * 60;
    var whole = Math.floor(rest);
    var cents = Math.round((rest - whole) * 100);
    if (cents === 100) {
      cents = 0;
      whole++;
    }
    if (whole === 60) {
      whole = 0;
      minutes++;
    }
    return minutes + ":" + (whole < 10 ? "0" : "") + whole + "." + (cents < 10 ? "0" : "") + cents;
  }

  function silenceToken(name) {
    try {
      var value = window.getComputedStyle(document.documentElement).getPropertyValue(name);
      return String(value || "").replace(/^\s+|\s+$/g, "");
    } catch (e) {
      return "";
    }
  }

  function silenceDraw() {
    var canvas = document.getElementById("qk-silence-wave");
    var wrap = document.getElementById("qk-silence-wave-wrap");
    if (!canvas || !wrap) return;

    if (!silence.peaks || !silence.duration) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;

    var width = canvas.clientWidth || 300;
    var height = canvas.clientHeight || 96;
    var ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));

    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    var bandOn = silenceToken("--qk-wave-hit-soft");
    var bandOff = silenceToken("--qk-wave-off");
    var waveFill = silenceToken("--qk-wave-fill");
    var mid = height / 2;

    silence.segments.forEach(function (segment) {
      var x = (segment.start / silence.duration) * width;
      var w = Math.max(1, ((segment.end - segment.start) / silence.duration) * width);
      ctx.fillStyle = segment.on ? bandOn : bandOff;
      ctx.fillRect(x, 0, w, height);
    });

    ctx.fillStyle = waveFill;
    var peaks = silence.peaks;
    var step = width / peaks.length;
    for (var i = 0; i < peaks.length; i++) {
      var value = peaks[i];
      if (value <= 0.004) continue;
      var barHeight = Math.max(1, value * (height - 4));
      ctx.fillRect(i * step, mid - barHeight / 2, Math.max(1, step * 0.8), barHeight);
    }
  }

  function silenceRenderList() {
    var list = document.getElementById("qk-silence-segments");
    if (!list) return;

    list.innerHTML = "";
    silence.segments.forEach(function (segment, index) {
      var row = document.createElement("li");
      row.className = "qk-seg" + (segment.on ? "" : " is-off");
      row.setAttribute("data-seg", String(index));
      row.setAttribute("role", "checkbox");
      row.setAttribute("aria-checked", segment.on ? "true" : "false");
      row.tabIndex = 0;

      var dot = document.createElement("span");
      dot.className = "qk-seg__dot";

      var time = document.createElement("span");
      time.className = "qk-seg__time";
      time.textContent = silenceTime(segment.start) + " – " + silenceTime(segment.end);

      var len = document.createElement("span");
      len.className = "qk-seg__len";
      len.textContent = Math.round((segment.end - segment.start) * 10) / 10 + " s";

      row.appendChild(dot);
      row.appendChild(time);
      row.appendChild(len);
      list.appendChild(row);
    });
  }

  function silenceNoteText() {
    if (silence.status === "scanning") return "Scanning. Nothing is changed until you press Apply.";
    if (silence.status === "error") return silence.error;
    if (!silence.segments.length) {
      if (silence.message) return silence.message;
      return "Scan to see the waveform and the gaps it found. Nothing is cut until you press Apply.";
    }

    var total = 0;
    var ticked = 0;
    var tickedTotal = 0;
    silence.segments.forEach(function (segment) {
      var length = segment.end - segment.start;
      total += length;
      if (segment.on) {
        ticked++;
        tickedTotal += length;
      }
    });

    var text =
      silence.segments.length +
      (silence.segments.length === 1 ? " gap" : " gaps") +
      ", " +
      Math.round(total * 10) / 10 +
      " s — " +
      ticked +
      " ticked (" +
      Math.round(tickedTotal * 10) / 10 +
      " s).";

    if (silence.notes.length) text += " " + silence.notes.join(" ");
    return text;
  }

  function silenceRender() {
    var note = document.getElementById("qk-silence-note");
    if (note) note.textContent = silenceNoteText();
    silenceRenderList();
    silenceDraw();
  }

  function silenceOnShow() {
    silenceRender();
    if (!silence.module && !silence.moduleError && state.hostId === "PPRO") {
      silenceLocate();
    }
  }

  function bindSilence() {
    var threshold = document.getElementById("qk-silence-threshold");
    var readout = document.getElementById("qk-silence-threshold-value");
    if (threshold) {
      var updateReadout = function () {
        if (readout) readout.textContent = String(threshold.value) + " dB";
      };
      threshold.addEventListener("input", updateReadout);
      updateReadout();
    }

    var find = document.getElementById("qk-silence-find");
    if (find) {
      find.addEventListener("click", function () {
        silence.ffmpeg = null;
        silence.moduleError = "";
        silenceLocate();
      });
    }

    var scan = document.getElementById("qk-silence-scan");
    if (scan) scan.addEventListener("click", silenceScan);

    var cancel = document.getElementById("qk-silence-cancel");
    if (cancel) cancel.addEventListener("click", silenceCancel);

    var markers = document.getElementById("qk-silence-markers");
    if (markers) markers.addEventListener("click", function () {
      silenceSendMarkers(false);
    });

    var apply = document.getElementById("qk-silence-apply");
    if (apply) apply.addEventListener("click", silenceApply);

    var clear = document.getElementById("qk-silence-clear-markers");
    if (clear) clear.addEventListener("click", silenceClearMarkers);

    var list = document.getElementById("qk-silence-segments");
    if (list) {
      var toggle = function (node) {
        var index = Number(node.getAttribute("data-seg"));
        if (!silence.segments[index]) return;
        silence.segments[index].on = !silence.segments[index].on;
        silenceRender();
      };

      list.addEventListener("click", function (event) {
        var row = event.target.closest("[data-seg]");
        if (row) toggle(row);
      });

      list.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        var row = event.target.closest("[data-seg]");
        if (!row) return;
        event.preventDefault();
        toggle(row);
      });
    }

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        resizeTimer = null;
        silenceDraw();
      }, 120);
    });
  }
  /* ---------- bridge (Part 6) ---------- */

  var bridge = {
    module: null,
    moduleError: "",
    pending: [],
    returns: [],
    busy: false,
    job: null
  };

  function bridgeNode() {
    try {
      return (
        typeof require === "function" &&
        typeof process !== "undefined" &&
        !!process.versions &&
        !!process.versions.node
      );
    } catch (eNode) {
      return false;
    }
  }

  /* render-node.js is required from panel.js, never loaded as a page script. */
  function bridgeLoadModule() {
    if (bridge.module) return bridge.module;
    if (bridge.moduleError) return null;
    if (!bridgeNode()) {
      bridge.moduleError =
        "Node is not available in this panel, so aerender cannot start. Open QuickKit from Window > Extensions inside After Effects.";
      return null;
    }

    var api = window.CSInterfaceLite;
    var root = api && api.getSystemPath ? String(api.getSystemPath("extension") || "") : "";
    var path = null;
    try {
      path = require("path");
    } catch (ePath) {
      path = null;
    }

    try {
      root = root.replace(/^file:\/\/\//i, "").replace(/^file:\/\//i, "");
      try {
        root = decodeURIComponent(root);
      } catch (eDecode) {}
      var file = root && path ? path.join(root, "js", "render-node.js") : "./js/render-node.js";
      bridge.module = require(file);
      return bridge.module;
    } catch (eLoad) {
      bridge.moduleError = "Could not load the render helper: " + (eLoad && eLoad.message ? eLoad.message : eLoad);
      return null;
    }
  }

  function bridgeCall(expr, done) {
    var api = window.CSInterfaceLite;
    if (!api || !api.isHosted) {
      done({
        ok: false,
        steps: [],
        error: "QuickKit is not connected to an Adobe app. Open the panel from Window > Extensions inside After Effects or Premiere Pro."
      });
      return;
    }
    api.evalScript(expr, function (raw) {
      var data = null;
      try {
        data = JSON.parse(String(raw));
      } catch (eParse) {
        data = null;
      }
      if (!data) {
        done({
          ok: false,
          steps: [],
          error: "The app did not answer in a way QuickKit could read. Reopen the panel and try again."
        });
        return;
      }
      done(data);
    });
  }

  function bridgeFirstFail(data) {
    var steps = data && data.steps ? data.steps : [];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].state === "fail") return String(steps[i].detail || steps[i].label || "");
    }
    return data && data.error ? String(data.error) : "";
  }

  function bridgeShowSteps(steps, fallback) {
    var wrap = document.getElementById("qk-bridge-steps-wrap");
    var list = document.getElementById("qk-bridge-steps");
    if (!wrap || !list) return;

    var rows = Array.isArray(steps) ? steps.filter(function (step) {
      return step && (step.label || step.detail);
    }) : [];
    if (!rows.length && fallback) {
      rows = [{ label: "QuickKit could not start", state: "fail", detail: String(fallback) }];
    }

    while (list.firstChild) list.removeChild(list.firstChild);

    if (!rows.length) {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    rows.forEach(function (step) {
      var state = step.state === "ok" || step.state === "fail" || step.state === "note" ? step.state : "note";
      var li = document.createElement("li");
      li.className = "qk-bridge-step is-" + state;

      var dot = document.createElement("span");
      dot.className = "qk-bridge-step__dot";
      dot.setAttribute("aria-hidden", "true");

      var body = document.createElement("span");
      var label = document.createElement("span");
      label.className = "qk-bridge-step__label";
      label.textContent = String(step.label || "");
      var detail = document.createElement("span");
      detail.className = "qk-bridge-step__detail";
      detail.textContent = String(step.detail || "");
      if (!step.detail) detail.hidden = true;

      body.appendChild(label);
      body.appendChild(detail);
      li.appendChild(dot);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  function bridgeSetBusy(busy) {
    ["qk-bridge-send", "qk-bridge-refresh", "qk-bridge-refresh-aeft", "qk-bridge-render"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.disabled = !!busy;
    });
    var cancel = document.getElementById("qk-bridge-cancel");
    if (cancel) cancel.hidden = !busy || !bridge.job;
    bridge.busy = !!busy;
  }

  function bridgeProgress(percent, text) {
    var wrap = document.getElementById("qk-bridge-progress-wrap");
    var bar = document.getElementById("qk-bridge-progress");
    var line = document.getElementById("qk-bridge-progress-text");
    if (wrap) wrap.hidden = false;
    var value = Number(percent);
    if (!isFinite(value) || value < 0) value = 0;
    if (value > 100) value = 100;
    if (bar) bar.style.width = String(Math.round(value)) + "%";
    if (line) line.textContent = String(text || "Rendering");
  }

  function bridgeProgressHide() {
    var wrap = document.getElementById("qk-bridge-progress-wrap");
    var bar = document.getElementById("qk-bridge-progress");
    if (wrap) wrap.hidden = true;
    if (bar) bar.style.width = "0%";
  }

  function bridgeNote(id, text) {
    var node = document.getElementById(id);
    if (node) node.textContent = String(text || "");
  }

  function bridgeSeconds(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) n = 0;
    return (Math.round(n * 100) / 100) + " s";
  }

  function bridgeClearList(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function bridgeRow(title, meta, action, tip, handler, disabled) {
    var li = document.createElement("li");
    li.className = "qk-bridge-row";

    var name = document.createElement("span");
    name.className = "qk-bridge-row__name";
    name.textContent = String(title || "");

    var foot = document.createElement("div");
    foot.className = "qk-bridge-row__foot";

    var info = document.createElement("span");
    info.className = "qk-bridge-row__meta";
    info.textContent = String(meta || "");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "qk-btn qk-btn--primary qk-btn--xs";
    btn.textContent = action;
    btn.setAttribute("data-tip", tip);
    btn.disabled = !!disabled;
    if (!disabled) btn.addEventListener("click", handler);

    foot.appendChild(info);
    foot.appendChild(btn);
    li.appendChild(name);
    li.appendChild(foot);
    return li;
  }

  function bridgeDrawPending() {
    var list = document.getElementById("qk-bridge-pending");
    if (!list) return;
    bridgeClearList(list);

    if (!bridge.pending.length) {
      bridgeNote("qk-bridge-pending-note", "No handoffs waiting yet. Send clips from Premiere Pro first.");
      return;
    }

    bridge.pending.forEach(function (row) {
      var meta =
        String(row.summary || "") + " - " +
        String(row.width || 0) + "x" + String(row.height || 0) + " at " +
        String(Math.round(Number(row.frameRate) * 100) / 100) + " fps, " +
        bridgeSeconds(row.duration);
      list.appendChild(
        bridgeRow(
          row.comp || "Untitled handoff",
          meta,
          "Import",
          "Build a matching composition from this handoff and trim the layers to the used range",
          function () {
            bridgeImport(String(row.id), this);
          }
        )
      );
    });

    bridgeNote(
      "qk-bridge-pending-note",
      bridge.pending.length === 1 ? "1 handoff waiting." : bridge.pending.length + " handoffs waiting."
    );
  }

  function bridgeDrawReturns() {
    var list = document.getElementById("qk-bridge-returns");
    if (!list) return;
    bridgeClearList(list);

    if (!bridge.returns.length) {
      bridgeNote("qk-bridge-returns-note", "No renders waiting yet. Send a composition back from After Effects.");
      return;
    }

    bridge.returns.forEach(function (row) {
      var meta = (row.renderExists ? "" : "file missing - ") + "at " + bridgeSeconds(row.at) + (row.trackName ? " on " + row.trackName : "");
      list.appendChild(
        bridgeRow(
          row.comp || "Untitled render",
          meta,
          "Place",
          row.renderExists
            ? "Import the render and overwrite the clip at its original position"
            : "The rendered file is missing, so QuickKit cannot place it. Render again in After Effects.",
          function () {
            bridgePlace(String(row.id), this);
          },
          !row.renderExists
        )
      );
    });

    var missing = bridge.returns.filter(function (row) {
      return !row.renderExists;
    }).length;
    bridgeNote(
      "qk-bridge-returns-note",
      (bridge.returns.length === 1 ? "1 render waiting" : bridge.returns.length + " renders waiting") +
        (missing ? " - " + (missing === 1 ? "1 file is" : missing + " files are") + " missing on disk." : ".")
    );
  }

  function bridgeCompInfo(info) {
    var line = document.getElementById("qk-bridge-comp");
    if (!line) return;
    if (!info || !info.comp) {
      line.textContent = "No composition open. Open the composition you want to send back.";
      return;
    }
    var comp = info.comp;
    line.textContent =
      comp.name + " - " + comp.width + "x" + comp.height + " at " +
      (Math.round(Number(comp.frameRate) * 100) / 100) + " fps, " + bridgeSeconds(comp.duration);
  }

  function bridgeRefresh() {
    if (!state.hosted) {
      bridge.pending = [];
      bridge.returns = [];
      bridgeDrawPending();
      bridgeDrawReturns();
      bridgeNote(
        "qk-bridge-pending-note",
        "Preview only: open QuickKit inside After Effects to read handoffs."
      );
      bridgeNote(
        "qk-bridge-returns-note",
        "Preview only: open QuickKit inside Premiere Pro to place renders."
      );
      bridgeCompInfo(null);
      return;
    }

    bridgeCall("qkBridgeList()", function (data) {
      if (!data.ok) {
        bridgeShowSteps(data.steps, data.error);
        return;
      }
      bridge.pending = Array.isArray(data.pending) ? data.pending : [];
      bridge.returns = Array.isArray(data.returns) ? data.returns : [];
      bridgeDrawPending();
      bridgeDrawReturns();
    });

    if (state.hostId === "AEFT") {
      bridgeCall("qkBridgeInfo()", function (info) {
        if (!info || !info.ok) return;
        bridgeCompInfo(info);
      });
    }
  }

  function bridgeOnShow() {
    var ppro = document.getElementById("qk-bridge-for-ppro");
    var aeft = document.getElementById("qk-bridge-for-aeft");
    if (ppro) ppro.hidden = state.hostId !== "PPRO";
    if (aeft) aeft.hidden = state.hostId !== "AEFT";
    bridgeRefresh();
  }

  function bridgeSend(button) {
    if (bridge.busy) return;
    var scope = fieldValue("qk-bridge-scope") || "selection";

    bridgeSetBusy(true);
    if (button) button.classList.add("is-loading");
    setStatus("Writing the handoff...");

    bridgeCall("qkBridgeSendToAe(" + qkQuote(scope) + ")", function (data) {
      bridgeSetBusy(false);
      if (button) button.classList.remove("is-loading");
      bridgeShowSteps(data.steps, data.error);

      if (data.ok) {
        showMessage("ok", data.message || "Handoff written. Open the Bridge tab in After Effects to import it.");
        setStatus("Handoff written - open After Effects");
      } else {
        showMessage("error", bridgeFirstFail(data) || "The handoff could not be written. Nothing changed.");
        setStatus("Send failed - nothing changed");
      }
      bridgeRefresh();
    });
  }

  function bridgeImport(id, button) {
    if (bridge.busy) return;

    bridgeSetBusy(true);
    if (button) button.classList.add("is-loading");
    setStatus("Building the composition...");

    bridgeCall("qkBridgeImport(" + qkQuote(id) + ")", function (data) {
      bridgeSetBusy(false);
      if (button) button.classList.remove("is-loading");
      bridgeShowSteps(data.steps, data.error);

      if (data.ok) {
        showMessage("ok", data.message || "Handoff imported. The composition is open.");
        setStatus("Handoff imported - composition open");
      } else {
        showMessage("error", bridgeFirstFail(data) || "The handoff could not be imported.");
        setStatus("Import failed - nothing was built");
      }
      bridgeRefresh();
    });
  }

  function bridgeCancel() {
    if (!bridge.job) return;
    var job = bridge.job;
    bridge.job = null;
    try {
      job.cancel();
    } catch (eCancel) {}
    bridgeSetBusy(false);
    bridgeProgressHide();
    showMessage("error", "Render stopped. Any partial file was left alone; nothing was handed to Premiere Pro.");
    setStatus("Render stopped");
  }

  function bridgeFinishRender(plan) {
    var payload = {
      output: plan.output,
      comp: plan.comp,
      duration: plan.duration,
      width: plan.width,
      height: plan.height,
      frameRate: plan.frameRate,
      bridgeTalk: true
    };

    bridgeCall("qkBridgeFinishRender(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      bridgeShowSteps(data.steps, data.error);
      if (data.ok) {
        showMessage("ok", data.message || "Rendered. Check the timeline position in Premiere Pro.");
        setStatus(data.placed ? "Rendered and handed to Premiere Pro" : "Rendered - waiting in returns");
      } else {
        showMessage("error", bridgeFirstFail(data) || "The render finished, but the return file could not be written.");
        setStatus("Render finished - handoff failed");
      }
      bridgeRefresh();
    });
  }

  function bridgeStartRender(plan) {
    var mod = bridgeLoadModule();
    if (!mod) {
      bridgeSetBusy(false);
      bridgeProgressHide();
      showMessage("error", bridge.moduleError);
      setStatus("Render not started");
      return;
    }

    function start(aerenderPath) {
      if (!aerenderPath) {
        bridgeSetBusy(false);
        bridgeProgressHide();
        showMessage(
          "error",
          "aerender.exe was not found on this machine, so QuickKit cannot render in the background. " +
            "The composition is already queued with its output set: use Composition > Add to Render Queue in After Effects, render it, then import the file in Premiere Pro."
        );
        setStatus("No aerender - render it in the Render Queue");
        return;
      }

      bridgeProgress(0, "Starting aerender...");
      setStatus("Rendering...");

      var settled = false;
      var job = mod.render(
        { aerender: aerenderPath, project: plan.project, comp: plan.comp, output: plan.output },
        {
          onProgress: function (percent) {
            var value = Number(percent);
            if (!isFinite(value) || value < 0) return;
            bridgeProgress(value, "Rendering " + Math.round(value) + "%");
            setStatus("Rendering " + Math.round(value) + "%");
          },
          onDone: function (error) {
            settled = true;
            bridge.job = null;
            bridgeSetBusy(false);

            if (error) {
              bridgeProgressHide();
              if (error.code === "cancelled") {
                showMessage("error", "Render stopped. Any partial file was left alone; nothing was handed to Premiere Pro.");
                setStatus("Render stopped");
                return;
              }
              showMessage("error", error.message || "The render failed.");
              setStatus("Render failed - nothing was handed over");
              return;
            }

            bridgeProgress(100, "Render finished. Handing the file to Premiere Pro...");
            setStatus("Render finished - handing over");
            bridgeFinishRender(plan);
          }
        }
      );

      if (settled) return;
      bridge.job = job;
      bridgeSetBusy(true);
    }

    if (plan.aerender) {
      start(plan.aerender);
      return;
    }

    mod.locate({ afterEffectsPath: "" }, function (error, info) {
      if (error || !info || !info.ok) {
        start("");
        return;
      }
      start(String(info.path || ""));
    });
  }

  function bridgeRender(button) {
    if (bridge.busy) return;
    var format = fieldValue("qk-bridge-format") || "auto";

    bridgeSetBusy(true);
    if (button) button.classList.add("is-loading");
    bridgeProgress(0, "Preparing the render...");
    setStatus("Preparing the render...");

    bridgeCall("qkBridgePrepareRender(" + qkQuote(format) + ")", function (data) {
      if (button) button.classList.remove("is-loading");
      bridgeShowSteps(data.steps, data.error);

      if (!data.ok || !data.plan) {
        bridgeSetBusy(false);
        bridgeProgressHide();
        showMessage("error", bridgeFirstFail(data) || "The render could not be prepared. Nothing was rendered.");
        setStatus("Render not started - nothing was rendered");
        return;
      }

      bridgeStartRender(data.plan);
    });
  }

  function bridgePlace(id, button) {
    if (bridge.busy) return;

    bridgeSetBusy(true);
    if (button) button.classList.add("is-loading");
    setStatus("Placing the render...");

    bridgeCall("qkBridgePlaceReturn(" + qkQuote(id) + ")", function (data) {
      bridgeSetBusy(false);
      if (button) button.classList.remove("is-loading");
      bridgeShowSteps(data.steps, data.error);

      if (data.ok) {
        showMessage("ok", data.message || "Placed on the timeline.");
        setStatus("Render placed on the timeline");
      } else {
        showMessage("error", bridgeFirstFail(data) || "The render could not be placed.");
        setStatus("Place failed - the file is still imported");
      }
      bridgeRefresh();
    });
  }

  function bindBridge() {
    var send = document.getElementById("qk-bridge-send");
    if (send) {
      send.addEventListener("click", function () {
        bridgeSend(send);
      });
    }

    var render = document.getElementById("qk-bridge-render");
    if (render) {
      render.addEventListener("click", function () {
        bridgeRender(render);
      });
    }

    var cancel = document.getElementById("qk-bridge-cancel");
    if (cancel) cancel.addEventListener("click", bridgeCancel);

    var refresh = document.getElementById("qk-bridge-refresh");
    if (refresh) refresh.addEventListener("click", bridgeRefresh);

    var refreshAe = document.getElementById("qk-bridge-refresh-aeft");
    if (refreshAe) refreshAe.addEventListener("click", bridgeRefresh);
  }

  /* ---------- library (Part 6A) ---------- */

  var LIB_VIEW_KEY = "qk.library.view";
  var LIB_THUMB_KEY = "qk.library.thumb";
  var LIB_RENDER_MAX = 400;

  var lib = {
    api: null,
    apiError: "",
    loaded: false,
    loading: false,
    error: "",
    index: null,
    root: "",
    missing: [],
    previewsGone: [],
    status: null,
    search: "",
    collection: "all",
    folderId: "",
    type: "all",
    host: "all",
    category: "all",
    sort: "name",
    view: "grid",
    thumb: 112,
    selected: [],
    anchor: "",
    focusId: "",
    dragIds: null,
    menu: null,
    dialog: null,
    dialogError: null,
    returnFocus: null,
    note: ""
  };

  function libCore() {
    return window.QKLibraryCore || null;
  }

  function libStore(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, String(value));
    } catch (eStore) {
      /* storage can be blocked; the setting simply does not persist */
    }
    return null;
  }

  function libNode() {
    try {
      return (
        typeof require === "function" &&
        typeof process !== "undefined" &&
        !!process.versions &&
        !!process.versions.node
      );
    } catch (eNode) {
      return false;
    }
  }

  /* library-io.js is required from here, never loaded as a page script.
     A browser preview can provide window.QKFakeLibrary instead. */
  function libApiGet() {
    if (lib.api) return lib.api;
    if (lib.apiError) return null;
    if (window.QKFakeLibrary) {
      lib.api = window.QKFakeLibrary;
      return lib.api;
    }
    if (!libNode()) {
      lib.apiError =
        "The library is a folder on your disk, so it needs the panel opened from Window > Extensions inside After Effects or Premiere Pro.";
      return null;
    }

    var api = window.CSInterfaceLite;
    var root = api && api.getSystemPath ? String(api.getSystemPath("extension") || "") : "";
    var path = null;
    try {
      path = require("path");
    } catch (ePath) {
      path = null;
    }

    try {
      root = root.replace(/^file:\/\/\//i, "").replace(/^file:\/\//i, "");
      try {
        root = decodeURIComponent(root);
      } catch (eDecode) {}
      var file = root && path ? path.join(root, "js", "library-io.js") : "./js/library-io.js";
      lib.api = require(file).create({});
      return lib.api;
    } catch (eLoad) {
      lib.apiError =
        "Could not load the library helper: " + (eLoad && eLoad.message ? eLoad.message : eLoad);
      return null;
    }
  }

  function libOnShow() {
    recipeSeedLibrary();
    if (!lib.loaded && !lib.loading) libRefresh();
    else renderLibrary();
  }

  function libRefresh() {
    if (lib.loading) return;
    var api = libApiGet();
    if (!api) {
      lib.loaded = true;
      lib.error = lib.apiError;
      renderLibrary();
      return;
    }

    lib.loading = true;
    try {
      var result = api.load();
      if (!result || !result.ok) {
        lib.error = (result && result.error) || "The library could not be opened.";
      } else {
        var first = !lib.loaded;
        lib.error = "";
        lib.index = result.index;
        lib.root = result.root || lib.root;
        lib.missing = result.missing || [];
        lib.previewsGone = result.previewsGone || [];
        lib.status = result.status || null;
        if (first && lib.status && lib.status.migrated && lib.status.migrated.count) {
          var migrated = lib.status.migrated;
          lib.note =
            "Imported " +
            migrated.count +
            " saved presets into the library." +
            (migrated.skippedCount ? " " + migrated.skippedCount + " damaged preset file(s) were left alone." : "");
        }
      }
    } catch (eLoad) {
      lib.error = "The library could not be read: " + (eLoad && eLoad.message ? eLoad.message : eLoad);
    }

    lib.loading = false;
    lib.loaded = true;
    libPruneSelection();
    renderLibrary();
  }

  function libPruneSelection() {
    if (!lib.index) {
      lib.selected = [];
      lib.anchor = "";
      lib.focusId = "";
      return;
    }
    var keep = [];
    for (var i = 0; i < lib.selected.length; i++) {
      if (window.QKLibraryCore.itemById(lib.index, lib.selected[i])) keep.push(lib.selected[i]);
    }
    lib.selected = keep;
    if (lib.anchor && !window.QKLibraryCore.itemById(lib.index, lib.anchor)) lib.anchor = "";
    if (lib.focusId && !window.QKLibraryCore.itemById(lib.index, lib.focusId)) lib.focusId = "";
  }

  function libApply(result, message) {
    if (!result || !result.ok) {
      showMessage("error", (result && result.error) || "The library could not be changed.");
      setStatus("Library unchanged");
      renderLibrary();
      return false;
    }
    if (result.index) lib.index = result.index;
    if (result.missing) lib.missing = result.missing;
    if (result.previewsGone) lib.previewsGone = result.previewsGone;
    if (message) {
      showMessage("ok", message);
      setStatus(message);
    }
    libPruneSelection();
    libRefresh();
    return true;
  }

  function libVisibleItems() {
    var core = libCore();
    if (!core || !lib.index) return [];
    return core.query(lib.index, {
      search: lib.search,
      type: lib.type,
      host: lib.host,
      category: lib.category,
      collection: lib.collection,
      folderId: lib.folderId,
      sort: lib.sort
    });
  }

  function libSelectedItems() {
    var core = libCore();
    var out = [];
    if (!core || !lib.index) return out;
    for (var i = 0; i < lib.selected.length; i++) {
      var item = core.itemById(lib.index, lib.selected[i]);
      if (item) out.push(item);
    }
    return out;
  }

  function libIsMissing(id) {
    return lib.missing.indexOf(id) >= 0;
  }

  function libCurrentHost() {
    if (state.hostId === "AEFT" || state.hostId === "PPRO") return state.hostId;
    return null;
  }

  function libWorksHere(item) {
    var host = libCurrentHost();
    if (!host) return true;
    return item.hostSupport.indexOf(host) >= 0;
  }

  function libHostText(item) {
    if (item.hostSupport.length === 2) return "Both apps";
    if (item.hostSupport[0] === "PPRO") return "Premiere Pro only";
    return "After Effects only";
  }

  function libTypeLabel(type) {
    var core = libCore();
    if (core && core.TYPE_LABEL[type]) return core.TYPE_LABEL[type];
    return type;
  }

  function libTypeIcon(type) {
    if (type === "mogrt") return "layers";
    if (type === "pr-recipe") return "easing";
    if (type === "pack") return "library";
    return "presets";
  }

  function libIconEl(name, size, className) {
    var span = document.createElement("span");
    span.className = className || "qk-icon";
    if (window.QKIcons && window.QKIcons.has(name)) {
      span.innerHTML = window.QKIcons.svg(name, size || 16);
    }
    return span;
  }

  function libClear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function libEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function libPlural(count, one, many) {
    return count + " " + (count === 1 ? one : many);
  }

  /* ---------------------------------------------------------- rendering */

  function renderLibrary() {
    if (!els.libItems || !els.libCollections) return;
    var core = libCore();
    libBinsVisible();

    els.libPath.textContent = lib.root
      ? "Stored locally in " + lib.root
      : "Stored locally in %APPDATA%\\QuickKit\\library";

    if (els.libSearch && els.libSearch.value !== lib.search) els.libSearch.value = lib.search;
    if (els.libSearchClear) els.libSearchClear.hidden = lib.search === "";

    if (els.libType) els.libType.value = lib.type;
    if (els.libHost) els.libHost.value = lib.host;
    if (els.libSort) els.libSort.value = lib.sort;

    if (!core) {
      renderLibCollections([]);
      renderLibFolders([]);
      libShowEmpty(
        "The library script did not load",
        "QuickKit could not find its library engine. Reinstall the panel and reopen it.",
        []
      );
      els.libItems.innerHTML = "";
      els.libCount.textContent = "";
      renderPreview();
      return;
    }

    if (!lib.index) {
      renderLibCollections([]);
      renderLibFolders([]);
      if (lib.error) {
        libShowEmpty("The library could not be opened", lib.error, [
          { label: "Try again", primary: true, onClick: function () { lib.loaded = false; lib.error = ""; libRefresh(); } }
        ]);
      } else {
        libShowEmpty("Opening the library", "Reading your items from disk.", []);
      }
      els.libItems.innerHTML = "";
      els.libCount.textContent = lib.loading ? "Loading" : "";
      renderPreview();
      return;
    }

    renderLibCategories();
    renderLibCrumbs();
    renderLibCollections(core.counts(lib.index));
    renderLibFolders(core);

    var all = libVisibleItems();
    var total = lib.index.items.length;
    var shown = all.slice(0, LIB_RENDER_MAX);

    /* The cap note describes this render only; the migration note lives on. */
    if (lib.note && lib.note.indexOf("Showing the first ") === 0) lib.note = "";

    if (els.libCount) {
      var countText = all.length === total ? libPlural(total, "item", "items") : all.length + " of " + total + " items";
      if (lib.selected.length) countText += " · " + lib.selected.length + " selected";
      els.libCount.textContent = countText;
    }

    renderLibItems(shown);
    if (all.length > LIB_RENDER_MAX) {
      lib.note = "Showing the first " + LIB_RENDER_MAX + " of " + all.length + " items. Narrow the search to see the rest.";
    }
    renderLibNote();

    if (!all.length) {
      if (!total) {
        libShowEmpty(
          "Your library is empty",
          "Presets saved in the Presets tab appear here on the next load. You can also import a .qkpack from another machine.",
          [
            { label: "Import pack", primary: true, onClick: function () { libImportPack(); } },
            { label: "New folder", onClick: function () { libNewFolder(); } }
          ]
        );
      } else if (lib.search || lib.type !== "all" || lib.host !== "all" || lib.category !== "all" || lib.collection !== "all") {
        libShowEmpty("Nothing matches", "No item fits the search and filters. Loosen one of them, or clear them all.", [
          { label: "Clear filters", primary: true, onClick: libClearFilters }
        ]);
      } else {
        libShowEmpty(
          "This folder is empty",
          "Drop items onto it from All items, or save a new preset in the Presets tab.",
          [
            {
              label: "Show all items",
              onClick: function () {
                lib.folderId = "";
                renderLibrary();
              }
            }
          ]
        );
      }
    } else {
      els.libEmpty.hidden = true;
    }

    renderLibViewButtons();
    renderPreview();
  }

  function renderLibViewButtons() {
    if (els.libItems) {
      els.libItems.className = "qk-lib-items is-" + lib.view;
    }
    if (els.libViewGrid) els.libViewGrid.setAttribute("aria-pressed", lib.view === "grid" ? "true" : "false");
    if (els.libViewList) els.libViewList.setAttribute("aria-pressed", lib.view === "list" ? "true" : "false");
    if (els.libThumb) els.libThumb.value = String(lib.thumb);
    if (els.libItems) els.libItems.style.setProperty("--qk-lib-thumb", lib.thumb + "px");
  }

  function renderLibCategories() {
    if (!els.libCategory || !lib.index) return;
    var core = libCore();
    var names = core.categories(lib.index);
    var wanted = lib.category;
    var keep = wanted;
    libClear(els.libCategory);

    var first = libEl("option", "", "All categories");
    first.value = "all";
    els.libCategory.appendChild(first);

    var seen = wanted === "all" || wanted === "";
    for (var i = 0; i < names.length; i++) {
      var option = libEl("option", "", names[i]);
      option.value = names[i];
      if (names[i] === wanted) seen = true;
      els.libCategory.appendChild(option);
    }
    if (!seen) {
      keep = "all";
      lib.category = "all";
    }
    els.libCategory.value = keep;
  }

  function renderLibCrumbs() {
    if (!els.libCrumbs || !lib.index) return;
    var core = libCore();
    libClear(els.libCrumbs);

    var rootBtn = libEl("button", "qk-lib-crumb", "All items");
    rootBtn.type = "button";
    rootBtn.setAttribute("data-folder", "");
    rootBtn.setAttribute("data-tip", "Show every folder");
    if (!lib.folderId) rootBtn.setAttribute("aria-current", "page");
    els.libCrumbs.appendChild(rootBtn);

    var path = lib.folderId ? core.folderPathOf(lib.index, lib.folderId) : [];
    var ids = [];
    var cursor = lib.folderId ? core.folderById(lib.index, lib.folderId) : null;
    while (cursor && ids.length < 20) {
      ids.unshift(cursor.id);
      cursor = cursor.parentId ? core.folderById(lib.index, cursor.parentId) : null;
    }

    for (var i = 0; i < ids.length; i++) {
      els.libCrumbs.appendChild(libEl("span", "qk-lib-crumb__sep", "/"));

      var btn = libEl("button", "qk-lib-crumb", path[i] || "Folder");
      btn.type = "button";
      btn.setAttribute("data-folder", ids[i]);
      btn.setAttribute("data-tip", "Open " + (path[i] || "folder"));
      if (i === ids.length - 1) btn.setAttribute("aria-current", "page");
      els.libCrumbs.appendChild(btn);
    }
  }

  function renderLibCollections(counts) {
    if (!els.libCollections) return;
    var core = libCore();
    libClear(els.libCollections);
    if (!core) return;

    var list = core.COLLECTIONS;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      var btn = libEl("button", "qk-lib-collection");
      btn.type = "button";
      btn.setAttribute("data-collection", entry.id);
      btn.setAttribute("aria-pressed", lib.collection === entry.id ? "true" : "false");
      btn.setAttribute("data-tip", libCollectionTip(entry.id));
      btn.appendChild(document.createTextNode(entry.label));

      if (counts && counts.collections) {
        var count = counts.collections[entry.id];
        if (typeof count === "number") {
          var badge = libEl("span", "qk-lib-collection__count", String(count));
          btn.appendChild(badge);
        }
      }
      els.libCollections.appendChild(btn);
    }
  }

  function libCollectionTip(id) {
    if (id === "favorites") return "Items you starred";
    if (id === "recent") return "Items used at least once, newest first";
    if (id === "most-used") return "Items you use the most, highest first";
    if (id === "untagged") return "Items with no tags yet";
    if (id === "text") return "Text, titles, captions and kinetic type";
    if (id === "transitions") return "Transitions, wipes and moves";
    if (id === "shapes") return "Shape and mask presets";
    return "Every item in the library";
  }

  function renderLibFolders(core) {
    if (!els.libFolders) return;
    libClear(els.libFolders);
    if (!core || !lib.index) return;

    var counts = {};
    for (var i = 0; i < lib.index.items.length; i++) {
      var folderId = lib.index.items[i].folderId;
      counts[folderId] = (counts[folderId] || 0) + 1;
    }

    var rootRow = libFolderRow("", "All items", lib.index.items.length, 0, true);
    els.libFolders.appendChild(rootRow);

    var byParent = {};
    for (var f = 0; f < lib.index.folders.length; f++) {
      var folder = lib.index.folders[f];
      var key = folder.parentId || "";
      if (!byParent[key]) byParent[key] = [];
      byParent[key].push(folder);
    }
    for (var k in byParent) {
      if (!Object.prototype.hasOwnProperty.call(byParent, k)) continue;
      byParent[k].sort(function (a, b) {
        return a.order - b.order || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
      });
    }

    function addChildren(parentId, depth) {
      var list = byParent[parentId] || [];
      for (var j = 0; j < list.length; j++) {
        var child = list[j];
        var total = 0;
        var span = core.descendantIds(lib.index, child.id);
        for (var s = 0; s < span.length; s++) total += counts[span[s]] || 0;
        els.libFolders.appendChild(libFolderRow(child.id, child.name, total, depth, false));
        if (depth < 10) addChildren(child.id, depth + 1);
      }
    }
    addChildren("", 0);
  }

  function libFolderRow(id, name, count, depth, isRoot) {
    var row = libEl("button", "qk-lib-folder" + (isRoot ? " qk-lib-folder--root" : ""));
    row.type = "button";
    row.setAttribute("data-folder", id);
    row.setAttribute("aria-current", lib.folderId === id ? "true" : "false");
    row.style.setProperty("--qk-lib-depth", String(depth));
    row.setAttribute(
      "data-tip",
      isRoot ? "Items that are not in a folder" : "Show " + name + " and its subfolders. Drop items here to move them."
    );

    row.appendChild(libIconEl(isRoot ? "library" : "folder", 14, "qk-lib-folder__icon"));
    row.appendChild(libEl("span", "qk-lib-folder__name", name));
    row.appendChild(libEl("span", "qk-lib-folder__count", String(count)));
    return row;
  }

  function renderLibNote() {
    if (!els.libNote) return;
    if (lib.note) {
      els.libNote.textContent = lib.note;
      els.libNote.hidden = false;
    } else {
      els.libNote.textContent = "";
      els.libNote.hidden = true;
    }
  }

  function libShowEmpty(title, body, actions) {
    if (!els.libEmpty) return;
    els.libEmpty.hidden = false;
    els.libEmptyTitle.textContent = title;
    els.libEmptyBody.textContent = body;
    libClear(els.libEmptyActions);
    for (var i = 0; i < actions.length; i++) {
      var action = actions[i];
      var btn = libEl("button", "qk-btn " + (action.primary ? "qk-btn--primary" : "qk-btn--secondary") + " qk-btn--sm", action.label);
      btn.type = "button";
      btn.addEventListener("click", action.onClick);
      els.libEmptyActions.appendChild(btn);
    }
    if (els.libEmptyMark) {
      libClear(els.libEmptyMark);
      els.libEmptyMark.appendChild(libIconEl("library", 28));
    }
  }

  function renderLibItems(items) {
    if (!els.libItems) return;
    libClear(els.libItems);

    for (var i = 0; i < items.length; i++) {
      els.libItems.appendChild(libCard(items[i]));
    }

    if (items.length && !lib.focusId) lib.focusId = items[0].id;
    if (lib.focusId) {
      var focusCard = els.libItems.querySelector('[data-id="' + lib.focusId + '"]');
      if (focusCard) focusCard.setAttribute("tabindex", "0");
    }
  }

  /* Part 6D: the 18 built-in Premiere recipes live in the shared library, so
     both apps see them and Favorites/Recents stay in sync. */
  function recipeSeedLibrary() {
    var engine = prEngine();
    if (!engine) return 0;
    var api = libApiGet();
    if (!api || !api.itemAdd) return 0;

    var key = "qk.recipes.seeded";
    var want = engine.VERSION + ":" + engine.RECIPES.length;
    if (libStore(key) === want) return 0;

    var added = 0;
    for (var i = 0; i < engine.RECIPES.length; i++) {
      var def = engine.RECIPES[i];
      var plan = engine.defaultPlan(def.id);
      if (!plan) continue;
      var text = JSON.stringify({
        format: "quickkit-pr-recipe",
        version: engine.VERSION,
        id: def.id,
        plan: plan
      });
      var tag = String(def.category || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      var result = api.itemAdd({
        id: "qk-recipe-" + def.id,
        type: "pr-recipe",
        name: def.name,
        category: "Recipe / " + def.category,
        tags: ["recipe", "premiere", tag],
        hostSupport: ["PPRO"],
        asset: def.id + ".qkrecipe.json",
        assetName: def.name + ".qkrecipe.json",
        text: text,
        notes: def.note,
        author: "QuickKit"
      });
      if (result && result.ok) added++;
    }

    libStore(key, want);
    if (added) {
      libRefresh();
      setStatus("Added " + libPlural(added, "Premiere recipe", "Premiere recipes") + " to the library");
    }
    return added;
  }

  /* Part 6D: optional bin organizer. Premiere only, so the section is hidden
     everywhere else instead of failing on a click. */
  function libBinsVisible() {
    if (!els.libBins) return;
    els.libBins.hidden = libCurrentHost() !== "PPRO";
  }

  function libBinsNote(text) {
    if (!els.libBinsNote) return;
    els.libBinsNote.textContent = text || "";
    els.libBinsNote.hidden = !text;
  }

  function libBinsValue(el) {
    return el ? String(el.value || "") : "";
  }

  function libBinsRun(action) {
    var payload = { action: action };
    if (action === "rename") {
      payload.mode = libBinsValue(els.libBinsMode) || "replace";
      payload.find = libBinsValue(els.libBinsFind);
      payload.replace = libBinsValue(els.libBinsReplace);
      payload.prefix = libBinsValue(els.libBinsPrefix);
      payload.suffix = libBinsValue(els.libBinsSuffix);
      payload.start = 1;
      payload.padding = 2;
    }
    libBinsNote("");
    setStatus(
      action === "create"
        ? "Creating the standard bins\u2026"
        : action === "sort"
        ? "Sorting the Project-panel selection\u2026"
        : "Renaming the Project-panel selection\u2026"
    );
    bridgeCall("qkPrBins(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      if (!data || !data.ok) {
        showMessage("error", (data && data.error) || "Nothing changed.");
        setStatus("Nothing changed");
        return;
      }
      showMessage("ok", data.message || "Done.");
      setStatus(data.message || "Done");
      libBinsNote(data.message || "");
    });
  }

  function libCard(item) {
    var missing = libIsMissing(item.id);
    var works = libWorksHere(item);
    var selected = lib.selected.indexOf(item.id) >= 0;

    var card = libEl("div", "qk-lib-card");
    card.setAttribute("role", "option");
    card.setAttribute("data-id", item.id);
    card.setAttribute("aria-selected", selected ? "true" : "false");
    card.setAttribute("tabindex", "-1");
    card.setAttribute("draggable", "true");
    card.setAttribute(
      "aria-label",
      item.name + ", " + libTypeLabel(item.type) + ", " + libHostText(item) + (missing ? ", file missing" : "")
    );

    var tip = libTypeLabel(item.type) + " · " + libHostText(item) + (missing ? " · the file is missing on disk" : "");
    if (!works) {
      card.className += " is-other-host";
      card.setAttribute("aria-disabled", "true");
      tip = "Only works in " + (item.hostSupport[0] === "PPRO" ? "Premiere Pro" : "After Effects") + ". It stays in the library for that app.";
    }
    card.setAttribute("data-tip", tip);
    if (preview.id === item.id) card.className += " is-previewed";

    var thumb = libEl("span", "qk-lib-card__thumb");
    var thumbUrl = "";
    var api = lib.api;
    if (!missing && api && item.previewThumb && typeof api.itemFileUrl === "function") {
      thumbUrl = api.itemFileUrl(item.id, item.previewThumb);
    }
    if (thumbUrl) {
      var img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.loading = "lazy";
      img.decoding = "async";
      img.setAttribute("data-src", thumbUrl);
      img.addEventListener("error", function () {
        libClear(thumb);
        thumb.appendChild(libIconEl(libTypeIcon(item.type), 20, "qk-lib-card__glyph"));
      });
      thumb.appendChild(img);
      libThumbWatch(img);
    } else {
      thumb.appendChild(libIconEl(libTypeIcon(item.type), 20, "qk-lib-card__glyph"));
    }
    card.appendChild(thumb);

    var text = libEl("div", "qk-lib-card__text");
    text.appendChild(libEl("div", "qk-lib-card__name", item.name));
    var meta = libTypeLabel(item.type) + " · " + (item.category || "No category");
    if (!works) meta += " · " + item.hostSupport[0];
    text.appendChild(libEl("div", "qk-lib-card__meta", meta));
    card.appendChild(text);

    if (missing) {
      var badge = libEl("span", "qk-lib-card__badge", "Missing");
      badge.setAttribute("data-tip", "The asset file is gone. Repair keeps the entry so you can re-import it.");
      card.appendChild(badge);
    }

    var star = libEl("button", "qk-lib-card__star");
    star.type = "button";
    star.setAttribute("aria-pressed", item.favorite ? "true" : "false");
    star.setAttribute("aria-label", item.favorite ? "Remove from favorites" : "Add to favorites");
    star.setAttribute("data-tip", item.favorite ? "Remove from Favorites" : "Add to Favorites");
    star.appendChild(libIconEl("star", 14));
    star.addEventListener("click", function (event) {
      event.stopPropagation();
      libToggleFavorite(item.id);
    });
    card.appendChild(star);

    return card;
  }

  /* --------------------------------------------------------- interaction */

  function libSetSelection(ids) {
    lib.selected = ids.slice(0);
    if (ids.length) {
      lib.anchor = ids[0];
      lib.focusId = ids[0];
    }
    renderLibrary();
  }

  function libClearFilters() {
    lib.search = "";
    lib.type = "all";
    lib.host = "all";
    lib.category = "all";
    lib.collection = "all";
    lib.folderId = "";
    renderLibrary();
  }

  function libToggleFavorite(id) {
    var core = libCore();
    if (!core || !lib.index) return;
    var item = core.itemById(lib.index, id);
    if (!item) return;
    var api = libApiGet();
    if (!api) return;
    libApply(
      api.itemUpdate({ id: id, favorite: !item.favorite }),
      item.favorite ? "Removed \"" + item.name + "\" from Favorites." : "Added \"" + item.name + "\" to Favorites."
    );
  }

  function libSelectCard(id, event) {
    var list = libVisibleItems();
    if (event && event.shiftKey && lib.anchor) {
      var from = -1;
      var to = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === lib.anchor) from = i;
        if (list[i].id === id) to = i;
      }
      if (from >= 0 && to >= 0) {
        var ids = [];
        var start = Math.min(from, to);
        var end = Math.max(from, to);
        for (var j = start; j <= end; j++) ids.push(list[j].id);
        lib.selected = ids;
        lib.focusId = id;
        renderLibrary();
        libPreviewShow(id);
        return;
      }
    }

    if (event && (event.ctrlKey || event.metaKey)) {
      var at = lib.selected.indexOf(id);
      if (at >= 0) lib.selected.splice(at, 1);
      else lib.selected.push(id);
      lib.anchor = id;
      lib.focusId = id;
      renderLibrary();
      libPreviewShow(id);
      return;
    }

    lib.selected = [id];
    lib.anchor = id;
    lib.focusId = id;
    renderLibrary();
    libPreviewShow(id);
  }

  function libFocusStep(step) {
    var list = libVisibleItems();
    if (!list.length) return;
    var at = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === lib.focusId) at = i;
    }
    if (at < 0) at = 0;
    var next = at + step;
    if (next < 0) next = 0;
    if (next > list.length - 1) next = list.length - 1;
    var target = list[next];

    lib.selected = [target.id];
    lib.focusId = target.id;
    lib.anchor = target.id;
    renderLibrary();

    var card = els.libItems.querySelector('[data-id="' + target.id + '"]');
    if (card) {
      card.focus();
      if (card.scrollIntoView) {
        try {
          card.scrollIntoView({ block: "nearest", inline: "nearest" });
        } catch (eScroll) {}
      }
    }
    libPreviewShow(target.id);
  }

  function libOpenItemMenu(id, x, y) {
    var core = libCore();
    if (!core || !lib.index) return;
    var item = core.itemById(lib.index, id);
    if (!item) return;

    if (lib.selected.indexOf(id) < 0) lib.selected = [id];
    lib.anchor = id;
    lib.focusId = id;
    renderLibrary();

    var rows = [];
    rows.push({ label: "Open details…", onClick: function () { libEditItem(id); } });
    rows.push({ label: "Rename (F2)", onClick: function () { libRenameItem(id); } });
    rows.push({
      label: item.favorite ? "Remove from Favorites" : "Add to Favorites",
      onClick: function () { libToggleFavorite(id); }
    });
    rows.push({ sep: true });
    rows.push({ heading: "Move to" });
    rows.push({ label: "All items (no folder)", onClick: function () { libMoveItems(lib.selected, ""); } });
    for (var i = 0; i < lib.index.folders.length; i++) {
      (function (folder) {
        var path = core.folderPathOf(lib.index, folder.id).join(" / ");
        rows.push({
          label: path || folder.name,
          onClick: function () { libMoveItems(lib.selected, folder.id); },
          disabled: lib.selected.length > 0 && lib.selected.every(function (sid) {
            var sitem = core.itemById(lib.index, sid);
            return sitem && sitem.folderId === folder.id;
          })
        });
      })(lib.index.folders[i]);
    }
    rows.push({ sep: true });
    rows.push({
      label: lib.selected.length > 1 ? "Export " + lib.selected.length + " items…" : "Export item…",
      onClick: function () { libExportPack(); }
    });
    rows.push({
      label: lib.selected.length > 1 ? "Delete " + lib.selected.length + " items…" : "Delete item…",
      onClick: function () { libDeleteItems(lib.selected); }
    });

    libShowMenu(rows, x, y);
  }

  function libOpenFolderMenu(id, x, y) {
    var core = libCore();
    if (!core || !lib.index) return;
    var folder = id ? core.folderById(lib.index, id) : null;
    var rows = [
      { label: "New folder here…", onClick: function () { libNewFolder(id); } }
    ];
    if (folder) {
      rows.push({ label: "Rename folder…", onClick: function () { libRenameFolder(id); } });
      rows.push({
        label: "Move folder to All items",
        disabled: folder.parentId === "",
        onClick: function () { libMoveFolder(id, ""); }
      });
      rows.push({ sep: true });
      rows.push({ label: "Delete folder…", onClick: function () { libDeleteFolder(id); } });
    }
    libShowMenu(rows, x, y);
  }

  function libShowMenu(rows, x, y) {
    if (!els.libMenu) return;
    libClear(els.libMenu);

    for (var i = 0; i < rows.length; i++) (function (row) {
      if (row.sep) {
        els.libMenu.appendChild(libEl("div", "qk-lib-menu__sep"));
        return;
      }
      if (row.heading) {
        els.libMenu.appendChild(libEl("div", "qk-lib-menu__label", row.heading));
        return;
      }
      var btn = libEl("button", "", row.label);
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.disabled = !!row.disabled;
      btn.addEventListener("click", function () {
        libCloseMenu();
        row.onClick();
      });
      els.libMenu.appendChild(btn);
    })(rows[i]);

    els.libMenu.hidden = false;
    els.libMenu.style.left = "0px";
    els.libMenu.style.top = "0px";

    var box = els.libMenu.getBoundingClientRect();
    var left = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - box.width - 4));
    var top = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - box.height - 4));
    els.libMenu.style.left = Math.round(left) + "px";
    els.libMenu.style.top = Math.round(top) + "px";

    var first = els.libMenu.querySelector("button:not(:disabled)");
    if (first) first.focus();
  }

  function libCloseMenu() {
    if (els.libMenu) els.libMenu.hidden = true;
  }

  function libDeleteItems(ids) {
    var items = [];
    var core = libCore();
    for (var i = 0; i < ids.length; i++) {
      var item = core.itemById(lib.index, ids[i]);
      if (item) items.push(item);
    }
    if (!items.length) return;

    var names = items
      .slice(0, 5)
      .map(function (item) {
        return item.name;
      })
      .join(", ");
    var lead =
      items.length > 5 ? names + " and " + (items.length - 5) + " more" : names;

    libOpenDialog({
      title: items.length > 1 ? "Delete " + items.length + " items?" : "Delete this item?",
      lead: lead,
      body: [
        libEl(
          "p",
          "qk-lib-dialog__message",
          "The item folders are removed from %APPDATA%\\QuickKit\\library. This cannot be undone."
        )
      ],
      okLabel: "Delete",
      onOk: function () {
        var result = libApiGet().itemsDelete({ ids: items.map(function (item) { return item.id; }) });
        if (!result.ok) return result.error || "The items could not be deleted.";
        libApply(result, "Deleted " + libPlural(items.length, "item", "items") + ".");
        return "";
      }
    });
  }

  function libMoveItems(ids, folderId) {
    if (!ids.length) return;
    var core = libCore();
    var folder = folderId ? core.folderById(lib.index, folderId) : null;
    var where = folder ? "\"" + folder.name + "\"" : "All items";
    var result = libApiGet().itemsMove({ ids: ids, folderId: folderId });
    libApply(result, "Moved " + libPlural(ids.length, "item", "items") + " to " + where + ".");
  }

  function libRenameItem(id) {
    var core = libCore();
    var item = core.itemById(lib.index, id);
    if (!item) return;

    var input = libTextInput(item.name, "Item name");
    libOpenDialog({
      title: "Rename item",
      body: [libField("Name", input)],
      okLabel: "Rename",
      focus: input,
      onOk: function () {
        var name = input.value.replace(/^\s+|\s+$/g, "");
        if (!name) return "Give the item a name first.";
        var result = libApiGet().itemUpdate({ id: id, name: name });
        if (!result.ok) return result.error || "The item could not be renamed.";
        libApply(result, "Renamed the item to \"" + name + "\".");
        return "";
      }
    });
  }

  function libEditItem(id) {
    var core = libCore();
    var item = core.itemById(lib.index, id);
    if (!item) return;

    var name = libTextInput(item.name, "Item name");
    var category = libTextInput(item.category, "e.g. Titles");
    var tags = libTextInput(item.tags.join(", "), "intro, logo, clean");
    var notes = document.createElement("textarea");
    notes.className = "qk-input qk-lib-dialog__notes";
    notes.rows = 3;
    notes.value = item.notes || "";
    notes.placeholder = "What this item is for";

    var folderSelect = libEl("select", "qk-select");
    var flat = libFolderOptions();
    for (var i = 0; i < flat.length; i++) {
      var option = libEl("option", "", flat[i].label);
      option.value = flat[i].value;
      folderSelect.appendChild(option);
    }
    folderSelect.value = item.folderId || "";

    var facts = libEl("p", "qk-lib-dialog__message");
    facts.textContent =
      libTypeLabel(item.type) +
      " · " +
      libHostText(item) +
      " · " +
      (item.usageCount ? "used " + libPlural(item.usageCount, "time", "times") : "never used") +
      " · added " +
      (item.createdAt || "unknown");

    libOpenDialog({
      title: "Item details",
      body: [
        facts,
        libField("Name", name),
        libField("Category", category),
        libField("Tags (comma separated)", tags),
        libField("Folder", folderSelect),
        libField("Notes", notes)
      ],
      okLabel: "Save",
      focus: name,
      onOk: function () {
        var wanted = name.value.replace(/^\s+|\s+$/g, "");
        if (!wanted) return "Give the item a name first.";
        var result = libApiGet().itemUpdate({
          id: id,
          name: wanted,
          category: category.value,
          tags: tags.value,
          folderId: folderSelect.value,
          notes: notes.value
        });
        if (!result.ok) return result.error || "The item could not be saved.";
        libApply(result, "Saved \"" + wanted + "\".");
        return "";
      }
    });
  }

  function libFolderOptions() {
    var core = libCore();
    var out = [{ value: "", label: "All items (no folder)" }];
    if (!core || !lib.index) return out;

    var byParent = {};
    for (var i = 0; i < lib.index.folders.length; i++) {
      var folder = lib.index.folders[i];
      var key = folder.parentId || "";
      if (!byParent[key]) byParent[key] = [];
      byParent[key].push(folder);
    }
    for (var k in byParent) {
      if (!Object.prototype.hasOwnProperty.call(byParent, k)) continue;
      byParent[k].sort(function (a, b) {
        return a.order - b.order || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
      });
    }

    function add(parentId, depth) {
      var list = byParent[parentId] || [];
      for (var j = 0; j < list.length; j++) {
        var prefix = "";
        for (var d = 0; d < depth; d++) prefix += "    ";
        out.push({ value: list[j].id, label: prefix + list[j].name });
        if (depth < 10) add(list[j].id, depth + 1);
      }
    }
    add("", 0);
    return out;
  }

  function libNewFolder(parentId) {
    var parent = parentId === undefined ? lib.folderId : parentId;
    var name = libTextInput("", "Folder name");
    var parentSelect = libEl("select", "qk-select");
    var flat = libFolderOptions();
    for (var i = 0; i < flat.length; i++) {
      var option = libEl("option", "", flat[i].label);
      option.value = flat[i].value;
      parentSelect.appendChild(option);
    }
    parentSelect.value = parent || "";

    libOpenDialog({
      title: "New folder",
      body: [libField("Name", name), libField("Inside", parentSelect)],
      okLabel: "Create",
      focus: name,
      onOk: function () {
        var wanted = name.value.replace(/^\s+|\s+$/g, "");
        if (!wanted) return "Give the folder a name first.";
        var result = libApiGet().folderCreate({ name: wanted, parentId: parentSelect.value });
        if (!result.ok) return result.error || "The folder could not be created.";
        libApply(result, "Created the folder \"" + wanted + "\".");
        return "";
      }
    });
  }

  function libRenameFolder(id) {
    var core = libCore();
    var folder = core.folderById(lib.index, id);
    if (!folder) return;
    var name = libTextInput(folder.name, "Folder name");

    libOpenDialog({
      title: "Rename folder",
      body: [libField("Name", name)],
      okLabel: "Rename",
      focus: name,
      onOk: function () {
        var wanted = name.value.replace(/^\s+|\s+$/g, "");
        if (!wanted) return "Give the folder a name first.";
        var result = libApiGet().folderRename({ id: id, name: wanted });
        if (!result.ok) return result.error || "The folder could not be renamed.";
        libApply(result, "Renamed the folder to \"" + wanted + "\".");
        return "";
      }
    });
  }

  function libMoveFolder(id, parentId) {
    var result = libApiGet().folderMove({ id: id, parentId: parentId });
    libApply(result, result.ok ? "Moved the folder." : "");
  }

  function libDeleteFolder(id) {
    var core = libCore();
    var folder = core.folderById(lib.index, id);
    if (!folder) return;

    var inside = 0;
    var span = core.descendantIds(lib.index, id);
    for (var i = 0; i < lib.index.items.length; i++) {
      if (span.indexOf(lib.index.items[i].folderId) >= 0) inside++;
    }

    libOpenDialog({
      title: "Delete folder \"" + folder.name + "\"?",
      lead: "The folder goes away; its items and subfolders move up one level. Nothing is deleted.",
      body: [
        libEl(
          "p",
          "qk-lib-dialog__message",
          inside ? libPlural(inside, "item is", "items are") + " inside this folder tree and will be kept." : "The folder is empty."
        )
      ],
      okLabel: "Delete folder",
      onOk: function () {
        var result = libApiGet().folderDelete({ id: id });
        if (!result.ok) return result.error || "The folder could not be deleted.";
        if (lib.folderId === id) lib.folderId = result.parentId || "";
        libApply(result, "Deleted the folder \"" + folder.name + "\".");
        return "";
      }
    });
  }

  /* ------------------------------------------------------------ dialogs */

  function libTextInput(value, placeholder) {
    var input = document.createElement("input");
    input.className = "qk-input";
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder || "";
    return input;
  }

  function libField(label, control) {
    var wrap = document.createElement("label");
    wrap.className = "qk-field";
    var span = document.createElement("span");
    span.className = "qk-label";
    span.textContent = label;
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
  }

  function libOpenDialog(config) {
    if (!els.libDialog) return;
    lib.dialog = config;
    lib.returnFocus = document.activeElement;

    els.libDialogTitle.textContent = config.title || "Library";
    els.libDialogLead.textContent = config.lead || "";
    els.libDialogLead.hidden = !config.lead;
    els.libDialogOk.textContent = config.okLabel || "Save";
    els.libDialogOk.hidden = !!config.hideOk;

    libClear(els.libDialogBody);
    var body = config.body || [];
    for (var i = 0; i < body.length; i++) els.libDialogBody.appendChild(body[i]);

    lib.dialogError = libEl("p", "qk-lib-dialog__message");
    lib.dialogError.hidden = true;
    els.libDialogBody.appendChild(lib.dialogError);

    els.libDialog.hidden = false;
    if (config.focus) config.focus.focus();
    else els.libDialogOk.focus();
  }

  function libCloseDialog() {
    if (!els.libDialog || els.libDialog.hidden) return;
    els.libDialog.hidden = true;
    lib.dialog = null;
    lib.dialogError = null;
    if (lib.returnFocus && typeof lib.returnFocus.focus === "function") {
      try {
        lib.returnFocus.focus();
      } catch (eFocus) {}
    }
    lib.returnFocus = null;
  }

  function libConfirmDialog() {
    if (!lib.dialog || typeof lib.dialog.onOk !== "function") {
      libCloseDialog();
      return;
    }
    var problem = lib.dialog.onOk();
    if (problem) {
      if (lib.dialogError) {
        lib.dialogError.textContent = problem;
        lib.dialogError.hidden = false;
      }
      return;
    }
    libCloseDialog();
  }

  /* -------------------------------------------------- packs and repair */

  function libPickSave(defaultName) {
    var cep = window.cep;
    if (!cep || !cep.fs || typeof cep.fs.showSaveDialogEx !== "function") return null;
    try {
      var result = cep.fs.showSaveDialogEx(
        "Save a QuickKit pack",
        lib.root || "",
        ["qkpack"],
        defaultName || "QuickKit pack.qkpack"
      );
      if (!result || result.err || !result.data) return "";
      return String(result.data);
    } catch (eSave) {
      return "";
    }
  }

  function libPickOpen() {
    var cep = window.cep;
    if (!cep || !cep.fs || typeof cep.fs.showOpenDialogEx !== "function") return null;
    try {
      var result = cep.fs.showOpenDialogEx(false, false, "Open a QuickKit pack", lib.root || "", ["qkpack"]);
      if (!result || result.err || !result.data) return "";
      return String(result.data[0] || "");
    } catch (eOpen) {
      return "";
    }
  }

  function libExportPack() {
    var api = libApiGet();
    if (!api) {
      showMessage("error", lib.apiError || "The library is not available.");
      return;
    }

    var items = lib.selected.length ? libSelectedItems() : libVisibleItems();
    if (!items.length) {
      showMessage("error", "Select an item, or open a folder with something in it, before exporting.");
      return;
    }

    var core = libCore();
    var folder = lib.folderId ? core.folderById(lib.index, lib.folderId) : null;
    var suggested = (folder ? folder.name : lib.selected.length ? "QuickKit selection" : "QuickKit library") + ".qkpack";
    var target = libPickSave(suggested);
    if (target === null) {
      showMessage("error", "Choosing where to save needs the panel inside After Effects or Premiere Pro.");
      return;
    }
    if (!target) return;

    var ids = items.map(function (item) {
      return item.id;
    });
    var result = api.exportPack({ ids: ids, name: suggested.replace(/\.qkpack$/i, ""), target: target });
    if (!result.ok) {
      showMessage("error", result.error || "The pack could not be written.");
      return;
    }

    var text = "Exported " + libPlural(result.count, "item", "items") + " to " + result.path + ".";
    if (result.skipped && result.skipped.length) {
      text += " " + result.skipped.length + " item(s) had no files and were left out.";
    }
    showMessage("ok", text);
    setStatus("Pack written");
  }

  function libImportPack() {
    var api = libApiGet();
    if (!api) {
      showMessage("error", lib.apiError || "The library is not available.");
      return;
    }

    var file = libPickOpen();
    if (file === null) {
      showMessage("error", "Choosing a pack needs the panel inside After Effects or Premiere Pro.");
      return;
    }
    if (!file) return;

    var info = api.inspectPack(file);
    if (!info || !info.ok) {
      showMessage("error", (info && info.error) || "That pack could not be read.");
      return;
    }

    var choices = libEl("div", "qk-lib-dialog__choice");
    var modes = [
      { value: "skip", label: "Skip items already in the library" },
      { value: "replace", label: "Replace them with the pack's copy" },
      { value: "both", label: "Keep both (the pack's copy gets a number)" }
    ];
    var radios = [];
    for (var i = 0; i < modes.length; i++) {
      var row = document.createElement("label");
      row.className = "qk-check";
      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "qk-lib-import-mode";
      radio.value = modes[i].value;
      radio.checked = i === 0;
      radios.push(radio);
      var text = document.createElement("span");
      text.textContent = modes[i].label;
      row.appendChild(radio);
      row.appendChild(text);
      choices.appendChild(row);
    }

    var list = libEl("ul", "qk-lib-dialog__files");
    var names = info.names || [];
    for (var n = 0; n < names.length; n++) {
      list.appendChild(libEl("li", "", names[n]));
    }
    if (info.count > names.length) {
      list.appendChild(libEl("li", "", "and " + (info.count - names.length) + " more"));
    }

    libOpenDialog({
      title: "Import \"" + info.name + "\"",
      lead: libPlural(info.count, "item", "items") + (info.createdAt ? ", made " + info.createdAt : ""),
      body: [choices, list],
      okLabel: "Import",
      onOk: function () {
        var mode = "skip";
        for (var r = 0; r < radios.length; r++) {
          if (radios[r].checked) mode = radios[r].value;
        }
        var result = api.importPack({ file: file, mode: mode });
        if (!result.ok) return result.error || "The pack could not be imported.";
        var message = result.message || "Imported the pack.";
        if (result.failed && result.failed.length) {
          message += " " + result.failed.length + " item(s) could not be written.";
        }
        libApply(result, message);
        return "";
      }
    });
  }

  function libRepairLibrary() {
    var api = libApiGet();
    if (!api) {
      showMessage("error", lib.apiError || "The library is not available.");
      return;
    }

    libOpenDialog({
      title: "Repair the library?",
      lead: "QuickKit rebuilds library.json from the item folders on disk. Nothing is deleted; damaged items are skipped and left where they are.",
      body: [
        libEl(
          "p",
          "qk-lib-dialog__message",
          "Use this when items go missing from the list, or after copying the library folder from another machine."
        )
      ],
      okLabel: "Repair library",
      onOk: function () {
        var result = api.repair();
        if (!result.ok) return result.error || "The library could not be repaired.";
        var text =
          "Rebuilt the library index: " +
          libPlural(result.index.items.length, "item", "items") +
          " in " +
          libPlural(result.index.folders.length, "folder", "folders") +
          ".";
        if (result.skipped && result.skipped.length) text += " " + result.skipped.length + " folder(s) were unreadable.";
        libApply(result, text);
        return "";
      }
    });
  }

  function libClearSearch() {
    lib.search = "";
    if (els.libSearch) els.libSearch.value = "";
    renderLibrary();
    if (els.libSearch) els.libSearch.focus();
  }

  function libIsTyping(target) {
    if (!target) return false;
    var tag = String(target.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
  }

  /* ------------------------------------------------------------- wiring */

  function bindLibrary() {
    if (!els.libItems) return;

    if (els.libSearch) {
      els.libSearch.addEventListener("input", function () {
        lib.search = els.libSearch.value;
        lib.selected = [];
        lib.anchor = "";
        renderLibrary();
      });
    }
    if (els.libSearchClear) els.libSearchClear.addEventListener("click", libClearSearch);
    if (els.libType) {
      els.libType.addEventListener("change", function () {
        lib.type = els.libType.value;
        lib.selected = [];
        renderLibrary();
      });
    }
    if (els.libHost) {
      els.libHost.addEventListener("change", function () {
        lib.host = els.libHost.value;
        lib.selected = [];
        renderLibrary();
      });
    }
    if (els.libCategory) {
      els.libCategory.addEventListener("change", function () {
        lib.category = els.libCategory.value;
        lib.selected = [];
        renderLibrary();
      });
    }
    if (els.libSort) {
      els.libSort.addEventListener("change", function () {
        lib.sort = els.libSort.value;
        renderLibrary();
      });
    }
    if (els.libNewFolder) {
      els.libNewFolder.addEventListener("click", function () {
        libNewFolder(lib.folderId);
      });
    }
    if (els.libExport) els.libExport.addEventListener("click", libExportPack);
    if (els.libImport) els.libImport.addEventListener("click", libImportPack);
    if (els.libRepair) els.libRepair.addEventListener("click", libRepairLibrary);

    if (els.libBinsCreate) {
      els.libBinsCreate.addEventListener("click", function () {
        libBinsRun("create");
      });
    }
    if (els.libBinsSort) {
      els.libBinsSort.addEventListener("click", function () {
        libBinsRun("sort");
      });
    }
    if (els.libBinsRename) {
      els.libBinsRename.addEventListener("click", function () {
        libBinsRun("rename");
      });
    }

    if (els.libViewGrid) {
      els.libViewGrid.addEventListener("click", function () {
        lib.view = "grid";
        libStore(LIB_VIEW_KEY, lib.view);
        renderLibrary();
      });
    }
    if (els.libViewList) {
      els.libViewList.addEventListener("click", function () {
        lib.view = "list";
        libStore(LIB_VIEW_KEY, lib.view);
        renderLibrary();
      });
    }
    if (els.libThumb) {
      els.libThumb.addEventListener("input", function () {
        lib.thumb = Number(els.libThumb.value) || 112;
        libStore(LIB_THUMB_KEY, lib.thumb);
        renderLibViewButtons();
      });
    }

    if (els.libCollections) {
      els.libCollections.addEventListener("click", function (event) {
        var btn = event.target.closest("[data-collection]");
        if (!btn) return;
        lib.collection = btn.getAttribute("data-collection");
        lib.selected = [];
        renderLibrary();
      });
    }

    if (els.libCrumbs) {
      els.libCrumbs.addEventListener("click", function (event) {
        var btn = event.target.closest("[data-folder]");
        if (!btn) return;
        lib.folderId = btn.getAttribute("data-folder");
        lib.selected = [];
        renderLibrary();
      });
    }

    if (els.libFolders) {
      els.libFolders.addEventListener("click", function (event) {
        var row = event.target.closest("[data-folder]");
        if (!row) return;
        lib.folderId = row.getAttribute("data-folder");
        lib.selected = [];
        renderLibrary();
      });
      els.libFolders.addEventListener("contextmenu", function (event) {
        var row = event.target.closest("[data-folder]");
        if (!row) return;
        event.preventDefault();
        libOpenFolderMenu(row.getAttribute("data-folder"), event.clientX, event.clientY);
      });
      els.libFolders.addEventListener("dragover", function (event) {
        var row = event.target.closest("[data-folder]");
        if (!row) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        row.classList.add("is-drop");
      });
      els.libFolders.addEventListener("dragleave", function (event) {
        var row = event.target.closest("[data-folder]");
        if (row) row.classList.remove("is-drop");
      });
      els.libFolders.addEventListener("drop", function (event) {
        var row = event.target.closest("[data-folder]");
        if (!row) return;
        event.preventDefault();
        row.classList.remove("is-drop");
        var ids = lib.dragIds && lib.dragIds.length ? lib.dragIds : libDropIds(event);
        lib.dragIds = null;
        if (ids.length) libMoveItems(ids, row.getAttribute("data-folder"));
      });
    }

    els.libItems.addEventListener("click", function (event) {
      var star = event.target.closest(".qk-lib-card__star");
      if (star) return;
      var card = event.target.closest(".qk-lib-card");
      if (!card) return;
      libSelectCard(card.getAttribute("data-id"), event);
    });

    els.libItems.addEventListener("dblclick", function (event) {
      var card = event.target.closest(".qk-lib-card");
      if (!card) return;
      var id = card.getAttribute("data-id");
      if (lib.selected.indexOf(id) < 0) libSelectCard(id, null);
      libPreviewShow(id);
      libApplyPreviewItem();
    });

    els.libItems.addEventListener("mouseover", function (event) {
      if (preview.mode !== "hover") return;
      var card = event.target.closest(".qk-lib-card");
      if (!card) return;
      libPreviewShow(card.getAttribute("data-id"));
    });

    els.libItems.addEventListener("contextmenu", function (event) {
      var card = event.target.closest(".qk-lib-card");
      if (!card) return;
      event.preventDefault();
      libOpenItemMenu(card.getAttribute("data-id"), event.clientX, event.clientY);
    });

    els.libItems.addEventListener("dragstart", function (event) {
      var card = event.target.closest(".qk-lib-card");
      if (!card) return;
      var id = card.getAttribute("data-id");
      var ids = lib.selected.indexOf(id) >= 0 ? lib.selected.slice(0) : [id];
      lib.dragIds = ids;
      card.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", ids.join(","));
      }
    });

    els.libItems.addEventListener("dragend", function (event) {
      var card = event.target.closest(".qk-lib-card");
      if (card) card.classList.remove("is-dragging");
      lib.dragIds = null;
      qsa(".qk-lib-folder.is-drop", els.libFolders).forEach(function (row) {
        row.classList.remove("is-drop");
      });
    });

    els.libItems.addEventListener("keydown", function (event) {
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!lib.selected.length) return;
        event.preventDefault();
        libDeleteItems(lib.selected);
        return;
      }
      if (event.key === "F2") {
        if (!lib.selected.length) return;
        event.preventDefault();
        libRenameItem(lib.selected[0]);
        return;
      }
      if (event.key === "Enter") {
        if (!lib.selected.length) return;
        event.preventDefault();
        libApplyPreviewItem();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        libFocusStep(1);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        libFocusStep(-1);
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        if (!lib.focusId) return;
        event.preventDefault();
        previewTogglePlay();
      }
    });

    if (els.libDialogOk) els.libDialogOk.addEventListener("click", libConfirmDialog);
    if (els.libDialogCancel) els.libDialogCancel.addEventListener("click", libCloseDialog);
    if (els.libDialogClose) els.libDialogClose.addEventListener("click", libCloseDialog);
    if (els.libDialog) {
      els.libDialog.addEventListener("click", function (event) {
        if (event.target === els.libDialog) libCloseDialog();
      });
    }

    document.addEventListener("click", function (event) {
      if (!els.libMenu || els.libMenu.hidden) return;
      if (els.libMenu.contains(event.target)) return;
      libCloseMenu();
    });

    window.addEventListener("resize", libCloseMenu);
    window.addEventListener("scroll", libCloseMenu, true);

    document.addEventListener("keydown", function (event) {
      if (els.libDialog && !els.libDialog.hidden) {
        if (event.key === "Escape") {
          event.preventDefault();
          libCloseDialog();
          return;
        }
        if (event.key === "Enter" && event.target && event.target.tagName !== "TEXTAREA") {
          event.preventDefault();
          libConfirmDialog();
        }
        return;
      }

      if (event.key === "Escape" && els.libMenu && !els.libMenu.hidden) {
        libCloseMenu();
        return;
      }

      if (state.activeTab !== "library") return;

      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "f") {
        event.preventDefault();
        if (els.libSearch) {
          els.libSearch.focus();
          if (els.libSearch.select) els.libSearch.select();
        }
        return;
      }

      if (libIsTyping(event.target)) return;
      if (els.libMenu && !els.libMenu.hidden) {
        if (event.key === "Escape") {
          libCloseMenu();
          return;
        }
        return;
      }

      if (event.key === "Delete" && lib.selected.length) {
        event.preventDefault();
        libDeleteItems(lib.selected);
      } else if (event.key === "F2" && lib.selected.length) {
        event.preventDefault();
        libRenameItem(lib.selected[0]);
      }
    });

    var savedView = libStore(LIB_VIEW_KEY);
    if (savedView === "list" || savedView === "grid") lib.view = savedView;
    var savedThumb = Number(libStore(LIB_THUMB_KEY));
    if (savedThumb >= 72 && savedThumb <= 176) lib.thumb = savedThumb;

    previewBind();
  }

  function libDropIds(event) {
    var raw = "";
    try {
      raw = event.dataTransfer ? String(event.dataTransfer.getData("text/plain") || "") : "";
    } catch (eData) {
      raw = "";
    }
    if (!raw) return [];
    var parts = raw.split(",");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var id = parts[i].replace(/^\s+|\s+$/g, "");
      if (id) out.push(id);
    }
    return out;
  }

  /* ---------- library preview (Part 6B) ---------- */

  var LIB_PREVIEW_MODE_KEY = "qk.library.preview.mode";
  var LIB_PREVIEW_HEIGHT_KEY = "qk.library.preview.height";
  var LIB_PREVIEW_COLLAPSED_KEY = "qk.library.preview.collapsed";
  var LIB_PREVIEW_MIN_H = 96;
  var LIB_PREVIEW_MAX_H = 420;

  var preview = {
    id: "",
    params: {},
    mode: "click",
    stageH: 180,
    collapsed: false,
    playing: true,
    loop: true,
    speed: 1,
    time: 0,
    last: 0,
    kind: "none",
    raf: 0,
    job: null,
    thumbs: null,
    ffmpegModule: null,
    ffmpegModuleError: "",
    nodeModule: null,
    nodeModuleError: "",
    ffmpeg: "",
    ffmpegError: "",
    gen: null,
    /* Part 6D: Premiere targeting and MOGRT state. */
    target: "selected",
    trackIndex: -1,
    context: null,
    contextPending: false,
    contextError: "",
    mogrt: null
  };

  function previewCore() {
    return window.QKPreviewCore || null;
  }

  function previewCopyParams(params) {
    var out = {};
    for (var key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) out[key] = params[key];
    }
    return out;
  }

  function previewClampHeight(value) {
    var height = Number(value);
    if (!isFinite(height)) height = 180;
    if (height < LIB_PREVIEW_MIN_H) height = LIB_PREVIEW_MIN_H;
    if (height > LIB_PREVIEW_MAX_H) height = LIB_PREVIEW_MAX_H;
    return Math.round(height);
  }

  /* Canvas colours cannot read CSS variables, so the values are fetched once
     per paint from the same token file the rest of the panel uses. */
  function previewCss(name, fallback) {
    try {
      var value = window.getComputedStyle(document.documentElement).getPropertyValue(name);
      value = String(value || "").replace(/^\s+|\s+$/g, "");
      return value || fallback;
    } catch (eVar) {
      return fallback;
    }
  }

  function previewItem() {
    var core = libCore();
    if (!core || !lib.index || !preview.id) return null;
    return core.itemById(lib.index, preview.id);
  }

  function previewStateOf(item) {
    var core = libCore();
    if (!core || !item) return "none";
    if (lib.previewsGone && lib.previewsGone.indexOf(item.id) >= 0) return "none";
    return core.previewState(item);
  }

  function previewAssetKind(item) {
    if (!item) return "";
    var asset = String(item.asset || "").toLowerCase();
    if (item.type === "mogrt") return /\.mogrt$/.test(asset) ? "mogrt" : "";
    if (item.type === "pr-recipe") return /\.qkrecipe\.json$/.test(asset) ? "qkrecipe" : "";
    if (item.type !== "ae-preset") return "";
    if (/\.qkpreset$/.test(asset)) return "qkpreset";
    if (/\.qktextpreset$/.test(asset)) return "qktextpreset";
    if (/\.ffx$/.test(asset)) return "ffx";
    return "";
  }

  function previewCanGenerate(item) {
    return (
      !!item &&
      item.type === "ae-preset" &&
      libCurrentHost() === "AEFT" &&
      previewAssetKind(item) !== "" &&
      !libIsMissing(item.id)
    );
  }

  function previewCanApply(item) {
    if (!item || libIsMissing(item.id) || !libWorksHere(item)) return false;
    var host = libCurrentHost();
    if (item.type === "pr-recipe") return host === "PPRO" && !!recipeForItem(item);
    if (item.type === "mogrt") return host === "PPRO" && previewAssetKind(item) === "mogrt";
    return previewAssetKind(item) !== "";
  }

  /* ------------------------------------------------- Part 6D: Premiere */

  function prEngine() {
    return window.QKRecipes || null;
  }

  function recipeIdFor(item) {
    if (!item || item.type !== "pr-recipe") return "";
    var asset = String(item.asset || "").replace(/\\/g, "/");
    var name = asset.substring(asset.lastIndexOf("/") + 1);
    if (/\.qkrecipe\.json$/i.test(name)) return name.replace(/\.qkrecipe\.json$/i, "");
    return String(item.id || "").replace(/^qk-recipe-/, "");
  }

  function recipeForItem(item) {
    var engine = prEngine();
    if (!engine) return null;
    return engine.byId(recipeIdFor(item));
  }

  function recipeParamDefs(item) {
    var engine = prEngine();
    var recipe = recipeForItem(item);
    if (!engine || !recipe) return [];
    var out = [];
    for (var i = 0; i < engine.PARAM_ORDER.length; i++) {
      var key = engine.PARAM_ORDER[i];
      if (recipe.params.indexOf(key) < 0) continue;
      if (engine.PARAMS[key]) out.push(engine.PARAMS[key]);
    }
    return out;
  }

  function previewPrDefs(item) {
    if (!item) return [];
    if (item.type === "pr-recipe") return recipeParamDefs(item);
    return [];
  }

  function prContextRefresh() {
    if (libCurrentHost() !== "PPRO") return;
    if (preview.contextPending) return;
    preview.contextPending = true;
    preview.contextError = "";
    bridgeCall("qkPrContext()", function (data) {
      preview.contextPending = false;
      if (data && data.ok) {
        preview.context = data;
        if (preview.trackIndex < 0) preview.trackIndex = previewDefaultTrack();
      } else {
        preview.context = null;
        preview.contextError = (data && data.error) || "Premiere did not return the sequence.";
      }
      renderPreview();
    });
  }

  function previewTrackList() {
    if (!preview.context || !preview.context.tracks) return [];
    return preview.context.tracks;
  }

  function previewDefaultTrack() {
    var tracks = previewTrackList();
    var pick = -1;
    for (var i = 0; i < tracks.length; i++) {
      if (!tracks[i].locked) pick = tracks[i].index;
    }
    if (pick < 0 && tracks.length) pick = tracks[tracks.length - 1].index;
    return pick;
  }

  function previewTrackName(index) {
    var tracks = previewTrackList();
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].index === index) return tracks[i].name + (tracks[i].locked ? " (locked)" : "");
    }
    return "V" + (index + 1);
  }

  function previewTrackSelect(id, label, value, onChange) {
    var row = libEl("div", "qk-lib-preview__target-row");
    row.appendChild(libEl("span", "qk-lib-preview__target-label", label));
    var select = document.createElement("select");
    select.className = "qk-select";
    select.id = id;
    select.setAttribute("aria-label", label);
    var tracks = previewTrackList();
    if (!tracks.length) {
      var empty = libEl("option", "", "No sequence read yet");
      empty.value = "-1";
      select.appendChild(empty);
      select.disabled = true;
    }
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      var option = libEl("option", "", track.name + (track.locked ? " (locked)" : ""));
      option.value = String(track.index);
      if (track.index === value) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", function () {
      onChange(Number(select.value));
    });
    row.appendChild(select);
    return row;
  }

  function renderPreviewTarget(item) {
    if (!els.libPreviewTarget) return;
    libClear(els.libPreviewTarget);
    var host = libCurrentHost();
    var isRecipe = !!item && item.type === "pr-recipe";
    var isMogrt = !!item && item.type === "mogrt";
    var wants = host === "PPRO" && (isRecipe || isMogrt);
    els.libPreviewTarget.hidden = !wants;
    if (!wants) return;

    if (!preview.context && !preview.contextPending && !preview.contextError) prContextRefresh();

    if (isRecipe) {
      var modeRow = libEl("div", "qk-lib-preview__target-row");
      modeRow.appendChild(libEl("span", "qk-lib-preview__target-label", "Target"));
      var mode = document.createElement("select");
      mode.className = "qk-select";
      mode.id = "qk-lib-target-mode";
      mode.setAttribute("aria-label", "What the recipe applies to");
      var modes = [
        { value: "selected", label: "Selected clips" },
        { value: "playhead", label: "Clip under playhead" }
      ];
      for (var m = 0; m < modes.length; m++) {
        var opt = libEl("option", "", modes[m].label);
        opt.value = modes[m].value;
        if (preview.target === modes[m].value) opt.selected = true;
        mode.appendChild(opt);
      }
      mode.addEventListener("change", function () {
        preview.target = mode.value === "playhead" ? "playhead" : "selected";
        renderPreviewTarget(item);
      });
      modeRow.appendChild(mode);
      els.libPreviewTarget.appendChild(modeRow);
    }

    if (preview.trackIndex < 0) preview.trackIndex = previewDefaultTrack();

    if (isMogrt || preview.target === "playhead") {
      els.libPreviewTarget.appendChild(
        previewTrackSelect(
          isMogrt ? "qk-lib-target-track" : "qk-lib-target-search-track",
          isMogrt ? "Video track" : "Search from",
          preview.trackIndex,
          function (value) {
            preview.trackIndex = value;
            renderPreviewTarget(item);
          }
        )
      );
    }

    var refreshRow = libEl("div", "qk-lib-preview__target-row");
    var refresh = libEl("button", "qk-btn qk-btn--ghost qk-btn--xs", "Refresh sequence");
    refresh.type = "button";
    refresh.setAttribute("data-tip", "Re-read the sequence, playhead and track list from Premiere Pro");
    refresh.addEventListener("click", function () {
      preview.contextError = "";
      prContextRefresh();
    });
    refreshRow.appendChild(refresh);
    var status = preview.context
      ? preview.context.sequence + " \u00b7 " + previewTrackName(preview.trackIndex)
      : preview.contextError || "Reading the sequence\u2026";
    refreshRow.appendChild(libEl("span", "qk-lib-preview__target-label", status));
    els.libPreviewTarget.appendChild(refreshRow);
  }

  function mogrtRefresh() {
    if (!preview.mogrt) return;
    var payload = { nodeId: preview.mogrt.nodeId };
    bridgeCall("qkPrMogrtParams(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      if (!data || !data.ok) {
        showMessage("error", (data && data.error) || "The template controls could not be read.");
        preview.mogrt = null;
        renderPreview();
        return;
      }
      preview.mogrt = { nodeId: data.nodeId, name: data.name, params: data.params || [] };
      renderPreview();
    });
  }

  function mogrtSetText(index, text) {
    if (!preview.mogrt) return;
    var payload = { nodeId: preview.mogrt.nodeId, index: index, text: text };
    bridgeCall("qkPrMogrtSetText(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      if (!data || !data.ok) {
        showMessage("error", (data && data.error) || "The text was not changed.");
        return;
      }
      showMessage("ok", data.message || "Text updated.");
      setStatus(data.message || "Text updated");
      mogrtRefresh();
    });
  }

  function mogrtSetParam(index, kind, value) {
    if (!preview.mogrt) return;
    var payload = { nodeId: preview.mogrt.nodeId, index: index, kind: kind, value: value };
    bridgeCall("qkPrMogrtSetParam(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      if (!data || !data.ok) {
        showMessage("error", (data && data.error) || "The control was not changed.");
        return;
      }
      showMessage("ok", data.message || "Control updated.");
      setStatus(data.message || "Control updated");
    });
  }

  function renderPreviewMogrt(item) {
    if (!els.libPreviewMogrt) return;
    libClear(els.libPreviewMogrt);
    var show = libCurrentHost() === "PPRO" && !!item && item.type === "mogrt" && !!preview.mogrt;
    els.libPreviewMogrt.hidden = !show;
    if (!show) return;

    var head = libEl("div", "qk-lib-preview__mogrt-head");
    head.appendChild(libEl("span", "qk-lib-preview__mogrt-title", "Controls on \"" + preview.mogrt.name + "\""));
    var refresh = libEl("button", "qk-btn qk-btn--ghost qk-btn--xs", "Refresh");
    refresh.type = "button";
    refresh.setAttribute("data-tip", "Read the template's controls again");
    refresh.addEventListener("click", mogrtRefresh);
    head.appendChild(refresh);
    els.libPreviewMogrt.appendChild(head);

    var params = preview.mogrt.params || [];
    if (!params.length) {
      els.libPreviewMogrt.appendChild(
        libEl("p", "qk-lib-preview__mogrt-other", "This template exposes no editable controls.")
      );
      return;
    }

    for (var i = 0; i < params.length; i++) {
      (function (param) {
        if (param.kind === "text") {
          var textRow = libEl("div", "qk-lib-preview__mogrt-row");
          textRow.style.gridTemplateColumns = "minmax(0, 1fr)";
          var area = document.createElement("textarea");
          area.className = "qk-input qk-lib-preview__mogrt-text";
          area.value = param.text || "";
          area.setAttribute("aria-label", param.name);
          area.setAttribute("data-tip", "Type the new text, then press Update text");
          var update = libEl("button", "qk-btn qk-btn--secondary qk-btn--xs", "Update text");
          update.type = "button";
          update.setAttribute("data-tip", "Write this text into \"" + param.name + "\"");
          update.addEventListener("click", function () {
            mogrtSetText(param.index, area.value);
          });
          textRow.appendChild(area);
          textRow.appendChild(update);
          els.libPreviewMogrt.appendChild(textRow);
          return;
        }

        var row = libEl("div", "qk-lib-preview__mogrt-row");
        row.appendChild(libEl("span", "qk-lib-preview__mogrt-label", param.name));
        if (param.kind === "number") {
          var input = document.createElement("input");
          input.type = "number";
          input.className = "qk-input";
          input.step = "any";
          input.value = String(param.value === null || param.value === undefined ? 0 : param.value);
          input.setAttribute("aria-label", param.name);
          input.addEventListener("change", function () {
            mogrtSetParam(param.index, "number", Number(input.value));
          });
          row.appendChild(input);
        } else if (param.kind === "checkbox") {
          var box = document.createElement("input");
          box.type = "checkbox";
          box.checked = param.checked === true;
          box.setAttribute("aria-label", param.name);
          box.addEventListener("change", function () {
            mogrtSetParam(param.index, "checkbox", box.checked);
          });
          row.appendChild(box);
        } else {
          row.appendChild(libEl("span", "qk-lib-preview__mogrt-other", "Not editable from a script"));
        }
        els.libPreviewMogrt.appendChild(row);
      })(params[i]);
    }
  }

  function prApplyRecipe(item) {
    var engine = prEngine();
    var recipe = recipeForItem(item);
    if (!engine || !recipe) {
      showMessage("error", "This recipe cannot be read. Re-import it or pick another recipe.");
      return;
    }
    var plan = engine.plan(recipe, preview.params);
    if (!plan) {
      showMessage("error", "This recipe has no keyframes.");
      return;
    }
    var payload = {
      plan: plan,
      target: preview.target === "playhead" ? "playhead" : "selected",
      trackIndex: preview.trackIndex
    };
    setStatus("Applying \"" + item.name + "\u2026");
    bridgeCall("qkPrRecipeApply(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      if (!data || !data.ok) {
        showMessage("error", (data && data.error) || "Nothing was applied.");
        setStatus("Nothing applied");
        return;
      }
      showMessage("ok", data.message || "Applied.");
      setStatus(data.message || "Applied");
      var api = libApiGet();
      if (api && api.touch) {
        try {
          api.touch(item.id);
        } catch (eTouch) {}
      }
      libRefresh();
      renderPreview();
    });
  }

  function prApplyMogrt(item) {
    var api = libApiGet();
    if (!api) return;
    var payload = { path: api.itemAssetPath(item.id), trackIndex: preview.trackIndex };
    setStatus("Inserting \"" + item.name + "\u2026");
    bridgeCall("qkPrMogrtInsert(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      if (!data || !data.ok) {
        showMessage("error", (data && data.error) || "Nothing was inserted.");
        setStatus("Nothing inserted");
        return;
      }
      preview.mogrt = { nodeId: data.nodeId, name: data.name, params: data.params || [] };
      showMessage("ok", data.message || "Inserted.");
      setStatus(data.message || "Inserted");
      if (api.touch) {
        try {
          api.touch(item.id);
        } catch (eTouch) {}
      }
      libRefresh();
      renderPreview();
      if (els.libPreviewMogrt) {
        var area = els.libPreviewMogrt.querySelector("textarea");
        if (area) {
          try {
            area.focus();
          } catch (eFocus) {}
        }
      }
    });
  }

  function previewApprox(item) {
    var core = previewCore();
    if (!core || !item) return null;
    return core.approxFor({
      type: item.type,
      name: item.name,
      category: item.category,
      tags: item.tags,
      params: preview.params
    });
  }

  /* ------------------------------------------------------------- player */

  function previewSetIcon(button, name) {
    if (!button) return;
    button.setAttribute("data-icon", name);
    if (window.QKIcons && window.QKIcons.has(name)) button.innerHTML = window.QKIcons.svg(name, 16);
  }

  function previewReleaseVideo() {
    var video = els.libPreviewVideo;
    if (!video) return;
    try {
      video.pause();
    } catch (ePause) {}
    video.removeAttribute("src");
    try {
      video.load();
    } catch (eLoad) {}
    video.hidden = true;
  }

  function previewStopLoop() {
    if (preview.raf) {
      try {
        window.cancelAnimationFrame(preview.raf);
      } catch (eCancel) {}
      preview.raf = 0;
    }
    preview.last = 0;
  }

  function previewStartLoop() {
    if (preview.raf) return;
    preview.last = 0;
    preview.raf = window.requestAnimationFrame(previewFrame);
  }

  function previewDuration() {
    if (preview.kind === "video" && els.libPreviewVideo) {
      var length = Number(els.libPreviewVideo.duration);
      if (isFinite(length) && length > 0.05) return length;
    }
    var approx = previewApprox(previewItem());
    if (approx && approx.duration) return approx.duration;
    return 1.2;
  }

  function previewFrame(now) {
    preview.raf = 0;
    var item = previewItem();
    if (!item || preview.kind === "none") return;

    var duration = previewDuration();
    if (preview.kind === "video") {
      var video = els.libPreviewVideo;
      preview.time = video.currentTime || 0;
      preview.playing = !video.paused && !video.ended;
      if (preview.time >= duration - 0.02 && !preview.loop) preview.playing = false;
    } else if (preview.playing) {
      var dt = preview.last ? (now - preview.last) / 1000 : 0;
      preview.last = now;
      preview.time += dt * preview.speed;
      if (preview.time >= duration) {
        if (preview.loop) preview.time = preview.time % Math.max(0.01, duration);
        else {
          preview.time = duration;
          preview.playing = false;
        }
      }
      previewPaint();
    }

    previewUpdateTransport();
    if (preview.kind === "video" || preview.playing) preview.raf = window.requestAnimationFrame(previewFrame);
  }

  function previewPaint() {
    var canvas = els.libPreviewCanvas;
    if (!canvas || preview.kind !== "canvas") return;
    var item = previewItem();
    var approx = previewApprox(item);
    if (!item || !approx) return;

    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var width = canvas.width;
    var height = canvas.height;
    var duration = previewDuration() || 1;
    var raw = Math.max(0, Math.min(1, preview.time / duration));

    var core = previewCore();
    var kind = approx.kind;
    var eased = raw;
    if (kind !== "type" && kind !== "wipe") eased = core.easingFn(approx.easing)(raw);
    var pose = core.sampleAt(kind, eased, {
      direction: approx.direction,
      distance: approx.distance * (height / 270)
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    var stageColor = previewCss("--qk-lib-preview-stage-bg");
    if (stageColor) ctx.fillStyle = stageColor;
    ctx.fillRect(0, 0, width, height);

    var word = item.name.length > 34 ? item.name.slice(0, 33) + "\u2026" : item.name;
    ctx.font = "600 " + Math.round(height * 0.11) + "px " + previewCss("--qk-font-ui", "Inter, sans-serif");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var textColor = previewCss("--qk-text");
    if (textColor) ctx.fillStyle = textColor;

    var textWidth = ctx.measureText(word).width;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, pose.opacity));
    if (pose.blur > 0.2) ctx.filter = "blur(" + pose.blur.toFixed(1) + "px)";
    ctx.translate(width / 2 + pose.dx, height / 2 + pose.dy);
    if (pose.rotate) ctx.rotate((pose.rotate * Math.PI) / 180);
    if (pose.scale !== 1) ctx.scale(pose.scale, pose.scale);
    if (pose.clip < 1) {
      ctx.beginPath();
      ctx.rect(-textWidth / 2, -height, Math.max(0.5, textWidth * pose.clip), height * 2);
      ctx.clip();
    }
    ctx.fillText(word, 0, 0);
    ctx.restore();
  }

  function previewDecideKind(item) {
    var api = libApiGet();
    preview.kind = "none";
    if (!item) return;

    var state = previewStateOf(item);
    var approx = previewApprox(item);
    var videoUrl = "";
    if (api && item.previewVideo && typeof api.itemFileUrl === "function") {
      videoUrl = api.itemFileUrl(item.id, item.previewVideo);
    }

    if (state === "ready" && videoUrl) {
      var video = els.libPreviewVideo;
      preview.kind = "video";
      video.hidden = false;
      if (video.getAttribute("src") !== videoUrl) video.setAttribute("src", videoUrl);
      video.muted = true;
      video.loop = preview.loop;
      video.playbackRate = preview.speed;
      try {
        video.load();
        var started = video.play();
        if (started && started.catch) started.catch(function () {});
      } catch (ePlay) {}
      preview.playing = true;
      previewStartLoop();
      return;
    }

    if (approx) {
      preview.kind = "canvas";
      els.libPreviewCanvas.hidden = false;
      preview.playing = true;
      previewPaint();
      previewStartLoop();
      return;
    }

    if (videoUrl) {
      preview.kind = "video";
      els.libPreviewVideo.hidden = false;
      els.libPreviewVideo.setAttribute("src", videoUrl);
      try {
        els.libPreviewVideo.load();
      } catch (eLoad2) {}
      previewStartLoop();
    }
  }

  function previewReload() {
    previewStopLoop();
    previewReleaseVideo();
    preview.kind = "none";
    preview.time = 0;
    preview.playing = true;
    if (els.libPreviewCanvas) els.libPreviewCanvas.hidden = true;
    var item = previewItem();
    if (item) previewDecideKind(item);
    renderPreview();
  }

  function previewMarkCard(id) {
    if (!els.libItems) return;
    var marked = els.libItems.querySelectorAll(".qk-lib-card.is-previewed");
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove("is-previewed");
    if (!id) return;
    var card = els.libItems.querySelector('[data-id="' + id + '"]');
    if (card) card.classList.add("is-previewed");
  }

  function libPreviewShow(id) {
    var core = libCore();
    if (!core || !lib.index) return;
    var item = id ? core.itemById(lib.index, id) : null;
    var nextId = item ? item.id : "";
    if (nextId === preview.id && preview.kind !== "none") {
      renderPreview();
      previewMarkCard(nextId);
      return;
    }
    previewStopLoop();
    previewReleaseVideo();
    preview.id = nextId;
    preview.params = item ? previewCopyParams(item.params) : {};
    preview.mogrt = null;
    preview.time = 0;
    preview.playing = true;
    preview.kind = "none";
    if (els.libPreviewCanvas) els.libPreviewCanvas.hidden = true;
    if (item) previewDecideKind(item);
    renderPreview();
    previewMarkCard(nextId);
  }

  function previewTogglePlay() {
    if (!previewItem() || preview.kind === "none") return;
    if (preview.kind === "video") {
      var video = els.libPreviewVideo;
      if (video.paused) {
        try {
          var started = video.play();
          if (started && started.catch) started.catch(function () {});
        } catch (ePlay) {}
        preview.playing = true;
      } else {
        video.pause();
        preview.playing = false;
      }
    } else {
      preview.playing = !preview.playing;
      if (preview.playing && preview.time >= previewDuration() - 0.01) preview.time = 0;
      preview.last = 0;
      previewStartLoop();
      previewPaint();
    }
    previewUpdateTransport();
  }

  function previewToggleLoop() {
    preview.loop = !preview.loop;
    if (els.libPreviewVideo) els.libPreviewVideo.loop = preview.loop;
    previewUpdateTransport();
  }

  function previewCycleSpeed() {
    var core = previewCore();
    if (!core) return;
    preview.speed = core.nextSpeed(preview.speed);
    if (els.libPreviewVideo) {
      try {
        els.libPreviewVideo.playbackRate = preview.speed;
      } catch (eRate) {}
    }
    previewUpdateTransport();
  }

  function previewScrubTo(ratio) {
    var value = Math.max(0, Math.min(1, Number(ratio) || 0));
    var duration = previewDuration();
    preview.time = value * duration;
    if (preview.kind === "video" && els.libPreviewVideo) {
      try {
        els.libPreviewVideo.currentTime = preview.time;
      } catch (eSeek) {}
    } else {
      previewPaint();
    }
    previewUpdateTransport();
  }

  function previewUpdateTransport() {
    if (!els.libPreviewClock) return;
    var core = previewCore();
    var item = previewItem();
    var ready = !!item && preview.kind !== "none";
    var duration = previewDuration();

    if (els.libPreviewPlay) {
      els.libPreviewPlay.disabled = !ready;
      previewSetIcon(els.libPreviewPlay, preview.playing ? "pause" : "play");
      els.libPreviewPlay.setAttribute("aria-label", preview.playing ? "Pause the preview" : "Play the preview");
      els.libPreviewPlay.setAttribute("data-tip", preview.playing ? "Pause (Space)" : "Play (Space)");
    }
    if (els.libPreviewLoop) {
      els.libPreviewLoop.setAttribute("aria-pressed", preview.loop ? "true" : "false");
      els.libPreviewLoop.disabled = !ready;
    }
    if (els.libPreviewSpeed) {
      els.libPreviewSpeed.textContent = preview.speed + "x";
      els.libPreviewSpeed.disabled = !ready;
    }
    if (els.libPreviewScrub) {
      els.libPreviewScrub.disabled = !ready;
      var ratio = duration > 0 ? preview.time / duration : 0;
      els.libPreviewScrub.value = String(Math.round(Math.max(0, Math.min(1, ratio)) * 1000));
    }
    if (core) {
      els.libPreviewClock.textContent = core.formatClock(preview.time) + " / " + core.formatClock(duration);
    }
  }

  /* --------------------------------------------------------------- pane */

  function previewSetMode(mode) {
    preview.mode = mode === "hover" ? "hover" : "click";
    libStore(LIB_PREVIEW_MODE_KEY, preview.mode);
    if (els.libPreviewMode) {
      els.libPreviewMode.textContent = preview.mode === "hover" ? "Hover to preview" : "Click to preview";
    }
    setStatus(preview.mode === "hover" ? "Preview mode: Hover. Click still selects." : "Preview mode: Click.");
  }

  function previewGenerateCount() {
    var core = previewCore();
    if (!core || !lib.index) return 0;
    if (libCurrentHost() !== "AEFT") return 0;
    return core.planGeneration(lib.index.items, previewStateOf).length;
  }

  function renderPreview() {
    if (!els.libPreview) return;
    var core = libCore();
    var item = previewItem();
    var state = item ? previewStateOf(item) : "none";

    els.libPreview.setAttribute("data-state", item ? "selected" : "empty");
    els.libPreview.setAttribute("data-collapsed", preview.collapsed ? "true" : "false");
    if (els.libPreviewBody) els.libPreviewBody.hidden = preview.collapsed;
    els.libPreview.style.setProperty("--qk-lib-preview-stage-h", preview.stageH + "px");
    if (els.libPreviewCollapse) {
      els.libPreviewCollapse.setAttribute("aria-expanded", preview.collapsed ? "false" : "true");
      els.libPreviewCollapse.setAttribute("data-tip", preview.collapsed ? "Expand the preview" : "Collapse the preview");
    }
    if (els.libPreviewMode) {
      els.libPreviewMode.textContent = preview.mode === "hover" ? "Hover to preview" : "Click to preview";
    }

    if (els.libPreviewVideo) els.libPreviewVideo.hidden = preview.kind !== "video";
    if (els.libPreviewCanvas) els.libPreviewCanvas.hidden = preview.kind !== "canvas";

    var empty = !item || preview.kind === "none";
    if (els.libPreviewEmpty) els.libPreviewEmpty.hidden = !empty;

    if (!item) {
      if (els.libPreviewEmptyText) {
        els.libPreviewEmptyText.textContent = core
          ? "Click an item to preview it here. Arrow keys move the selection."
          : "The library engine did not load, so there is nothing to preview.";
      }
      if (els.libPreviewEmptyIcon) {
        libClear(els.libPreviewEmptyIcon);
        els.libPreviewEmptyIcon.appendChild(libIconEl("library", 28));
      }
    } else if (preview.kind === "none") {
      if (els.libPreviewEmptyText) {
        els.libPreviewEmptyText.textContent = previewCanGenerate(item)
          ? "No rendered preview yet. Generate one from After Effects, or keep the approximation."
          : "No rendered preview yet.";
      }
      if (els.libPreviewEmptyIcon) {
        libClear(els.libPreviewEmptyIcon);
        els.libPreviewEmptyIcon.appendChild(libIconEl(libTypeIcon(item.type), 28));
      }
    }

    if (els.libPreviewGenerate) {
      els.libPreviewGenerate.hidden = !previewCanGenerate(item);
      els.libPreviewGenerate.disabled = !!(preview.gen && preview.gen.active);
      els.libPreviewGenerate.textContent = state === "stale" ? "Regenerate preview" : "Generate preview";
    }

    if (els.libPreviewName) els.libPreviewName.textContent = item ? item.name : "Nothing selected";
    if (els.libPreviewBadge) {
      els.libPreviewBadge.hidden = !item;
      els.libPreviewBadge.textContent = item ? libTypeLabel(item.type) : "";
    }
    if (els.libPreviewHost) {
      if (!item) els.libPreviewHost.textContent = "";
      else {
        var hostText = libHostText(item);
        if (libIsMissing(item.id)) hostText += " \u00b7 the file is missing on disk";
        if (previewCanGenerate(item)) {
          hostText += state === "ready" ? " \u00b7 preview ready" : state === "stale" ? " \u00b7 preview out of date" : " \u00b7 no preview yet";
        }
        els.libPreviewHost.textContent = hostText;
      }
    }

    if (els.libPreviewTags) {
      libClear(els.libPreviewTags);
      var tags = item && item.tags ? item.tags : [];
      for (var t = 0; t < tags.length; t++) {
        els.libPreviewTags.appendChild(libEl("span", "qk-lib-preview__tag", tags[t]));
      }
    }

    if (els.libPreviewApply) {
      var host = libCurrentHost();
      var canApply = previewCanApply(item);
      var label = "Apply";
      var tip = "Apply to the current selection (Enter or double-click)";
      if (item && item.type === "pr-recipe") {
        label = "Apply recipe";
        tip = "Keyframe the selected clips, or the clip under the playhead";
      } else if (item && item.type === "mogrt") {
        label = "Insert at playhead";
        tip = "Import the MOGRT on the chosen video track at the playhead";
      } else if (item && item.type === "pack") {
        tip = "A pack is a bundle of items. Open its menu to unpack it.";
      } else if (host === "PPRO") {
        tip = "This item works in After Effects only. It stays in the library for that app.";
      }
      els.libPreviewApply.textContent = label;
      els.libPreviewApply.disabled = !canApply;
      els.libPreviewApply.setAttribute("data-tip", tip);
    }

    if (els.libPreviewFav) {
      els.libPreviewFav.disabled = !item;
      els.libPreviewFav.textContent = item && item.favorite ? "In Favorites" : "Favorite";
      els.libPreviewFav.setAttribute("aria-pressed", item && item.favorite ? "true" : "false");
    }

    if (els.libPreviewNote) {
      var note = "";
      if (item && state === "stale") note = "The saved preview was made with different settings.";
      if (item && preview.kind === "canvas") note = "Showing an approximation, not the rendered preset.";
      els.libPreviewNote.textContent = note;
      els.libPreviewNote.hidden = !note;
    }

    renderPreviewParams(item);
    renderPreviewTarget(item);
    renderPreviewMogrt(item);
    renderPreviewRegen(item, state);
    previewUpdateTransport();
  }

  function renderPreviewRegen(item, state) {
    if (!els.libPreviewRegen) return;
    var show = !!item && state === "stale" && previewCanGenerate(item) && !(preview.gen && preview.gen.active);
    els.libPreviewRegen.hidden = !show;
    if (els.libPreviewRegenBtn) {
      els.libPreviewRegenBtn.disabled = !previewCanGenerate(item);
      els.libPreviewRegenBtn.textContent = "Regenerate preview";
    }
  }

  function renderPreviewParams(item) {
    if (!els.libPreviewParams) return;
    libClear(els.libPreviewParams);
    var core = libCore();
    if (!core || !item) {
      els.libPreviewParams.hidden = true;
      return;
    }
    var defs = previewPrDefs(item);
    if (!defs.length && item.type !== "pr-recipe" && item.type !== "mogrt") {
      defs = core.paramDefs(item.type);
    }
    els.libPreviewParams.hidden = defs.length === 0;
    if (!defs.length) return;

    for (var i = 0; i < defs.length; i++) {
      (function (def) {
        var row = libEl("div", "qk-lib-preview__param");
        row.setAttribute("data-param", def.key);
        row.appendChild(libEl("span", "qk-lib-preview__param-label", def.label));

        var value = preview.params[def.key];
        if (value === undefined) value = def.value;

        if (def.kind === "number") {
          var wrap = libEl("div", "qk-lib-preview__param-value");
          var input = document.createElement("input");
          input.type = "range";
          input.className = "qk-range";
          input.min = String(def.min);
          input.max = String(def.max);
          input.step = String(def.step);
          input.value = String(value);
          input.setAttribute("aria-label", def.label);
          var clock = libEl("span", "", String(value) + (def.unit || ""));
          wrap.appendChild(input);
          wrap.appendChild(clock);
          row.appendChild(wrap);

          input.addEventListener("input", function () {
            preview.params[def.key] = Number(input.value);
            clock.textContent = input.value + (def.unit || "");
            previewParamsChanged(item, false);
          });
          input.addEventListener("change", function () {
            preview.params[def.key] = Number(input.value);
            previewParamsChanged(item, true);
          });
        } else {
          var select = document.createElement("select");
          select.className = "qk-select";
          select.setAttribute("aria-label", def.label);
          for (var o = 0; o < def.options.length; o++) {
            var option = libEl("option", "", def.options[o].label);
            option.value = def.options[o].value;
            if (def.options[o].value === value) option.selected = true;
            select.appendChild(option);
          }
          row.appendChild(select);
          select.addEventListener("change", function () {
            preview.params[def.key] = select.value;
            previewParamsChanged(item, true);
          });
        }

        els.libPreviewParams.appendChild(row);
      })(defs[i]);
    }
  }

  function previewParamsChanged(item, persist) {
    var core = libCore();
    if (!core) return;

    var probe = {
      type: item.type,
      asset: item.asset,
      bytes: item.bytes,
      params: preview.params,
      previewVideo: item.previewVideo,
      previewKey: item.previewKey
    };
    var state = core.previewState(probe);

    if (state !== "ready") {
      previewStopLoop();
      previewReleaseVideo();
      preview.kind = "none";
      var approx = previewApprox(item);
      if (approx) {
        preview.kind = "canvas";
        if (els.libPreviewCanvas) els.libPreviewCanvas.hidden = false;
        preview.playing = true;
        preview.time = 0;
        previewPaint();
        previewStartLoop();
      }
    }
    renderPreview();

    if (persist) {
      var api = libApiGet();
      if (!api) return;
      var result = api.itemUpdate({ id: item.id, params: preview.params });
      if (result && result.ok) {
        if (result.index) lib.index = result.index;
        var live = core.itemById(lib.index, item.id);
        if (live) preview.params = previewCopyParams(live.params);
      } else {
        showMessage("error", (result && result.error) || "The new settings could not be saved.");
      }
      renderPreview();
    }
  }

  /* ---------------------------------------------------------- generation */

  function previewNodeModule() {
    if (preview.nodeModule) return preview.nodeModule;
    if (preview.nodeModuleError) return null;
    if (!libNode()) {
      preview.nodeModuleError = "Node is not available in this panel, so ffmpeg cannot start.";
      return null;
    }
    var bridge = window.CSInterfaceLite;
    var root = bridge && bridge.getSystemPath ? String(bridge.getSystemPath("extension") || "") : "";
    var path = null;
    try {
      path = require("path");
    } catch (ePath) {
      path = null;
    }
    try {
      root = root.replace(/^file:\/\/\//i, "").replace(/^file:\/\//i, "");
      try {
        root = decodeURIComponent(root);
      } catch (eDecode) {}
      var file = root && path ? path.join(root, "js", "preview-node.js") : "./js/preview-node.js";
      preview.nodeModule = require(file);
      return preview.nodeModule;
    } catch (eLoad) {
      preview.nodeModuleError = "Could not load the preview encoder: " + (eLoad && eLoad.message ? eLoad.message : eLoad);
      return null;
    }
  }

  function previewFfmpegModule() {
    if (preview.ffmpegModule) return preview.ffmpegModule;
    if (preview.ffmpegModuleError) return null;
    if (!libNode()) {
      preview.ffmpegModuleError = "Node is not available in this panel, so ffmpeg cannot start.";
      return null;
    }
    var bridge = window.CSInterfaceLite;
    var root = bridge && bridge.getSystemPath ? String(bridge.getSystemPath("extension") || "") : "";
    var path = null;
    try {
      path = require("path");
    } catch (ePath) {
      path = null;
    }
    try {
      root = root.replace(/^file:\/\/\//i, "").replace(/^file:\/\//i, "");
      try {
        root = decodeURIComponent(root);
      } catch (eDecode) {}
      var file = root && path ? path.join(root, "js", "ffmpeg-node.js") : "./js/ffmpeg-node.js";
      preview.ffmpegModule = require(file);
      return preview.ffmpegModule;
    } catch (eLoad2) {
      preview.ffmpegModuleError = "Could not load the FFmpeg helper: " + (eLoad2 && eLoad2.message ? eLoad2.message : eLoad2);
      return null;
    }
  }

  function previewFindFfmpeg(then) {
    if (preview.ffmpeg) {
      then(preview.ffmpeg);
      return;
    }
    var mod = previewFfmpegModule();
    if (!mod) {
      then(null);
      return;
    }
    var bridge = window.CSInterfaceLite;
    var extensionDir = bridge && bridge.getSystemPath ? String(bridge.getSystemPath("extension") || "") : "";
    var saved = "";
    try {
      var settings = silenceSettingsFile();
      var stored = settings ? mod.loadSetting(settings) : null;
      saved = stored && stored.ffmpegPath ? String(stored.ffmpegPath) : "";
    } catch (eSettings) {
      saved = "";
    }
    mod.locate({ extensionDir: extensionDir, savedPath: saved }, function (error, found) {
      if (error || !found || !found.ok) {
        preview.ffmpegError = (error && error.message) || "ffmpeg was not found. Run scripts\\fetch-ffmpeg.ps1.";
        then(null);
        return;
      }
      preview.ffmpeg = found.path;
      preview.ffmpegError = "";
      then(preview.ffmpeg);
    });
  }

  function previewBusy(text) {
    if (els.libPreviewBusy) {
      els.libPreviewBusy.hidden = false;
      if (els.libPreviewBusyText) els.libPreviewBusyText.textContent = text;
    }
    if (els.libPreviewCancel) els.libPreviewCancel.hidden = false;
    if (text) setStatus(text);
  }

  function previewBusyDone() {
    if (els.libPreviewBusy) els.libPreviewBusy.hidden = true;
    if (els.libPreviewCancel) els.libPreviewCancel.hidden = true;
  }

  function previewGenerateOne(item, done) {
    var api = libApiGet();
    if (!api) {
      done({ ok: false, error: preview.ffmpegError || lib.apiError || "The library is not available." });
      return;
    }
    if (!previewCanGenerate(item)) {
      done({ ok: false, error: "This item cannot be rendered into a preview here." });
      return;
    }
    var dir = "";
    try {
      dir = api.previewTempDir(item.id);
    } catch (eTemp) {
      dir = "";
    }
    if (!dir) {
      done({ ok: false, error: "QuickKit could not create a temp folder for the preview." });
      return;
    }

    var payload = {
      name: item.name,
      kind: previewAssetKind(item),
      path: api.itemAssetPath(item.id),
      dir: dir
    };

    previewBusy("Rendering frames in After Effects\u2026");
    bridgeCall("qkPreviewGenerate(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      if (!data || !data.ok) {
        api.previewCleanup(dir);
        done({ ok: false, error: (data && data.error) || "After Effects did not render the preview." });
        return;
      }

      var frames = data.frames || [];
      var paths = [];
      for (var i = 0; i < frames.length; i++) paths.push(dir + "/" + frames[i]);

      previewFindFfmpeg(function (ffmpegPath) {
        if (!ffmpegPath) {
          api.previewCleanup(dir);
          done({ ok: false, error: preview.ffmpegError || preview.ffmpegModuleError || "ffmpeg was not found." });
          return;
        }
        var mod = previewNodeModule();
        if (!mod) {
          api.previewCleanup(dir);
          done({ ok: false, error: preview.nodeModuleError || "The preview encoder did not load." });
          return;
        }

        previewBusy("Encoding the preview\u2026");
        preview.job = mod.encode(
          {
            ffmpeg: ffmpegPath,
            frames: paths,
            fps: data.fps || 24,
            width: 480,
            seconds: data.seconds || 2.5,
            outVideo: dir + "/preview.mp4",
            outThumb: dir + "/thumb.webp",
            listPath: dir + "/frames.txt"
          },
          {
            onDone: function (error, result) {
              preview.job = null;
              if (error) {
                api.previewCleanup(dir);
                done({ ok: false, error: error.message || "ffmpeg could not encode the preview." });
                return;
              }
              var saved = api.previewsSave({ id: item.id, videoPath: result.video, thumbPath: result.thumb });
              api.previewCleanup(dir);
              if (!saved || !saved.ok) {
                done({ ok: false, error: (saved && saved.error) || "QuickKit could not save the preview files." });
                return;
              }
              done({ ok: true, message: "Preview ready for \"" + item.name + "\"." });
            }
          }
        );
      });
    });
  }

  function libGeneratePreview() {
    var item = previewItem();
    if (!item) {
      showMessage("error", "Select an item first.");
      return;
    }
    if (preview.gen && preview.gen.active) return;
    if (libCurrentHost() !== "AEFT") {
      showMessage("error", "Previews are generated in After Effects. In Premiere Pro they are read-only.");
      return;
    }
    if (!previewCanGenerate(item)) {
      showMessage("error", "This item has nothing QuickKit can render in After Effects.");
      return;
    }

    preview.gen = { active: true, cancel: false, queue: [], done: 0, total: 1, failed: 0 };
    renderPreview();
    previewGenerateOne(item, function (result) {
      preview.gen.active = false;
      previewBusyDone();
      if (!result.ok) {
        showMessage("error", result.error || "The preview could not be generated.");
        setStatus("Preview not generated");
        renderPreview();
        return;
      }
      showMessage("ok", result.message || "Preview generated.");
      setStatus("Preview generated");
      libRefresh();
      previewReload();
    });
  }

  function libGenerateMissing() {
    if (preview.gen && preview.gen.active) return;
    var core = libCore();
    var pc = previewCore();
    if (!core || !pc || !lib.index) return;
    if (libCurrentHost() !== "AEFT") {
      showMessage("error", "Previews are generated in After Effects. In Premiere Pro they are read-only.");
      return;
    }

    var queue = pc.planGeneration(lib.index.items, previewStateOf);
    if (!queue.length) {
      showMessage("ok", "Every After Effects preset already has a fresh preview.");
      setStatus("Nothing to generate");
      return;
    }

    preview.gen = { active: true, cancel: false, queue: queue.slice(0), done: 0, total: queue.length, failed: 0 };
    renderPreview();
    previewRunQueue();
  }

  function previewRunQueue() {
    if (!preview.gen || !preview.gen.active) return;

    if (preview.gen.cancel) {
      previewEndQueue("Stopped after " + preview.gen.done + " of " + preview.gen.total + ".");
      return;
    }
    if (!preview.gen.queue.length) {
      previewEndQueue(
        "Generated " +
          (preview.gen.total - preview.gen.failed) +
          " of " +
          preview.gen.total +
          " previews" +
          (preview.gen.failed ? ", " + preview.gen.failed + " failed" : "") +
          "."
      );
      return;
    }

    var item = preview.gen.queue.shift();
    previewBusy("Preview " + (preview.gen.done + 1) + " of " + preview.gen.total + " \u2014 " + item.name);
    previewGenerateOne(item, function (result) {
      if (!preview.gen || !preview.gen.active) return;
      preview.gen.done++;
      if (!result.ok) preview.gen.failed++;
      previewRunQueue();
    });
  }

  function previewEndQueue(message) {
    var failed = preview.gen ? preview.gen.failed : 0;
    preview.gen = null;
    previewBusyDone();
    renderPreview();
    if (message) showMessage(failed ? "error" : "ok", message);
    setStatus(message || "Preview generation finished");
    libRefresh();
    previewReload();
  }

  function libCancelGeneration() {
    if (!preview.gen || !preview.gen.active) {
      previewBusyDone();
      return;
    }
    preview.gen.cancel = true;
    if (preview.job && preview.job.cancel) {
      try {
        preview.job.cancel();
      } catch (eCancel) {}
    }
    previewBusy("Stopping after this item\u2026");
    setStatus("Stopping preview generation");
  }

  function libClearPreviewCache() {
    var api = libApiGet();
    if (!api) return;
    var info = null;
    try {
      info = api.previewsInfo ? api.previewsInfo() : null;
    } catch (eInfo) {
      info = null;
    }
    var count = info && info.clearable ? info.clearable : 0;
    var megabytes = info && info.bytes ? Math.round((info.bytes / (1024 * 1024)) * 10) / 10 : 0;

    libOpenDialog({
      title: "Clear the preview cache?",
      lead: count
        ? count + " preview file(s), about " + megabytes + " MB. The items and their presets are not touched."
        : "There are no preview files to remove yet.",
      body: [
        libEl(
          "p",
          "qk-lib-dialog__message",
          "Thumbnails and preview videos are deleted from the library folder. QuickKit falls back to the built-in approximation until you generate previews again."
        )
      ],
      okLabel: "Clear previews",
      onOk: function () {
        var result = api.previewsClear({});
        if (!result || !result.ok) return (result && result.error) || "The preview cache could not be cleared.";
        libCloseDialog();
        showMessage("ok", "Removed " + (result.cleared || 0) + " preview file(s).");
        setStatus("Preview cache cleared");
        libRefresh();
        previewReload();
        return "";
      }
    });
  }

  function libPreviewSettings(x, y) {
    var missing = previewGenerateCount();
    var rows = [];
    rows.push({ heading: "Preview mode" });
    rows.push({
      label: (preview.mode === "click" ? "\u2713 " : "") + "Click (default)",
      onClick: function () {
        previewSetMode("click");
      }
    });
    rows.push({
      label: (preview.mode === "hover" ? "\u2713 " : "") + "Hover",
      onClick: function () {
        previewSetMode("hover");
      }
    });
    rows.push({ sep: true });
    rows.push({
      label: missing ? "Generate missing previews (" + missing + ")" : "Generate missing previews",
      disabled: libCurrentHost() !== "AEFT" || !missing,
      onClick: libGenerateMissing
    });
    rows.push({
      label: "Generate this preview",
      disabled: !previewCanGenerate(previewItem()),
      onClick: libGeneratePreview
    });
    rows.push({ sep: true });
    /* Same library on both hosts: deleting previews from Premiere would throw
       away files it cannot regenerate, so the row is read-only there. */
    rows.push({
      label: libCurrentHost() === "AEFT" ? "Clear preview cache\u2026" : "Clear preview cache (After Effects only)",
      disabled: libCurrentHost() !== "AEFT",
      onClick: libClearPreviewCache
    });
    libShowMenu(rows, x, y);
  }

  /* --------------------------------------------------------------- apply */

  function libApplyPreviewItem() {
    var item = previewItem();
    if (!item) {
      showMessage("error", "Select an item first.");
      return;
    }
    if (libIsMissing(item.id)) {
      showMessage("error", "\"" + item.name + "\" is missing its file on disk. Repair the library or import the pack again.");
      return;
    }
    if (!previewCanApply(item)) {
      showMessage(
        "error",
        item.type === "pack"
          ? "A pack is a bundle of items, not something to apply. Unpack it from the item menu."
          : libCurrentHost() === "PPRO"
          ? "\"" + item.name + "\" cannot be applied in Premiere Pro. After Effects presets stay in the library for After Effects."
          : "\"" + item.name + "\" cannot be applied in this app."
      );
      return;
    }

    if (libCurrentHost() === "PPRO") {
      if (item.type === "pr-recipe") {
        prApplyRecipe(item);
        return;
      }
      if (item.type === "mogrt") {
        prApplyMogrt(item);
        return;
      }
    }

    var api = libApiGet();
    if (!api) return;
    var payload = {
      kind: previewAssetKind(item),
      path: api.itemAssetPath(item.id),
      name: item.name
    };

    setStatus("Applying \"" + item.name + "\u2026");
    bridgeCall("qkLibraryApply(" + qkQuote(JSON.stringify(payload)) + ")", function (data) {
      if (!data || !data.ok) {
        showMessage("error", (data && data.error) || "Nothing was applied.");
        setStatus("Nothing applied");
        return;
      }
      showMessage("ok", data.message || "Applied.");
      setStatus(data.message || "Applied");
      try {
        api.touch(item.id);
      } catch (eTouch) {}
      libRefresh();
      renderPreview();
    });
  }

  function libPreviewFavorite() {
    var item = previewItem();
    if (!item) return;
    libToggleFavorite(item.id);
  }

  /* ---------------------------------------------------------- bindings */

  function previewBindDrag() {
    var handle = els.libPreviewResize;
    if (!handle) return;

    function start(event) {
      event.preventDefault();
      var startY = event.clientY;
      var startHeight = preview.stageH;
      handle.setPointerCapture && handle.setPointerCapture(event.pointerId);
      function move(moveEvent) {
        preview.stageH = previewClampHeight(startHeight + (moveEvent.clientY - startY));
        if (els.libPreviewStage) els.libPreviewStage.style.height = preview.stageH + "px";
        els.libPreview.style.setProperty("--qk-lib-preview-stage-h", preview.stageH + "px");
      }
      function stop() {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        libStore(LIB_PREVIEW_HEIGHT_KEY, preview.stageH);
      }
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
    }

    handle.addEventListener("pointerdown", start);
    handle.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      preview.stageH = previewClampHeight(preview.stageH + (event.key === "ArrowDown" ? 16 : -16));
      els.libPreview.style.setProperty("--qk-lib-preview-stage-h", preview.stageH + "px");
      libStore(LIB_PREVIEW_HEIGHT_KEY, preview.stageH);
    });
  }

  function previewBind() {
    previewBindDrag();

    if (els.libPreviewCollapse) {
      els.libPreviewCollapse.addEventListener("click", function () {
        preview.collapsed = !preview.collapsed;
        libStore(LIB_PREVIEW_COLLAPSED_KEY, preview.collapsed ? "1" : "0");
        renderPreview();
      });
    }

    if (els.libPreviewSettings) {
      els.libPreviewSettings.addEventListener("click", function (event) {
        var box = els.libPreviewSettings.getBoundingClientRect();
        libPreviewSettings(box.left, box.bottom + 4);
      });
    }

    if (els.libPreviewPlay) els.libPreviewPlay.addEventListener("click", previewTogglePlay);
    if (els.libPreviewLoop) els.libPreviewLoop.addEventListener("click", previewToggleLoop);
    if (els.libPreviewSpeed) els.libPreviewSpeed.addEventListener("click", previewCycleSpeed);

    if (els.libPreviewScrub) {
      els.libPreviewScrub.addEventListener("input", function () {
        previewScrubTo(Number(els.libPreviewScrub.value) / 1000);
      });
    }

    if (els.libPreviewApply) els.libPreviewApply.addEventListener("click", libApplyPreviewItem);
    if (els.libPreviewFav) els.libPreviewFav.addEventListener("click", libPreviewFavorite);
    if (els.libPreviewGenerate) els.libPreviewGenerate.addEventListener("click", libGeneratePreview);
    if (els.libPreviewRegenBtn) els.libPreviewRegenBtn.addEventListener("click", libGeneratePreview);
    if (els.libPreviewCancel) els.libPreviewCancel.addEventListener("click", libCancelGeneration);

    if (els.libPreviewVideo) {
      els.libPreviewVideo.addEventListener("play", function () {
        preview.playing = true;
        previewUpdateTransport();
        previewStartLoop();
      });
      els.libPreviewVideo.addEventListener("pause", function () {
        preview.playing = false;
        previewUpdateTransport();
      });
      els.libPreviewVideo.addEventListener("loadedmetadata", previewUpdateTransport);
      /* rAF is throttled when the panel is hidden; media events still fire, so
         the clock and the scrub bar stay honest even then. */
      els.libPreviewVideo.addEventListener("timeupdate", function () {
        if (preview.kind !== "video") return;
        preview.time = els.libPreviewVideo.currentTime || 0;
        previewUpdateTransport();
      });
      els.libPreviewVideo.addEventListener("error", function () {
        if (preview.kind !== "video") return;
        previewReleaseVideo();
        var item = previewItem();
        preview.kind = "none";
        if (item) {
          if (previewApprox(item)) {
            preview.kind = "canvas";
            if (els.libPreviewCanvas) els.libPreviewCanvas.hidden = false;
            previewPaint();
            previewStartLoop();
          }
        }
        renderPreview();
      });
    }

    var savedMode = libStore(LIB_PREVIEW_MODE_KEY);
    preview.mode = savedMode === "hover" ? "hover" : "click";
    var savedHeight = Number(libStore(LIB_PREVIEW_HEIGHT_KEY));
    if (isFinite(savedHeight) && savedHeight > 0) preview.stageH = previewClampHeight(savedHeight);
    preview.collapsed = libStore(LIB_PREVIEW_COLLAPSED_KEY) === "1";

    if (els.libPreviewStage) {
      els.libPreviewStage.style.setProperty("--qk-lib-preview-stage-h", preview.stageH + "px");
    }
    renderPreview();
  }

  function libThumbLoad(img) {
    var src = img.getAttribute("data-src");
    if (!src) return;
    img.removeAttribute("data-src");
    img.src = src;
  }

  function libThumbWatch(img) {
    if (!window.IntersectionObserver) {
      libThumbLoad(img);
      return;
    }
    if (!preview.thumbs) {
      preview.thumbs = new window.IntersectionObserver(
        function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (!entries[i].isIntersecting) continue;
            libThumbLoad(entries[i].target);
            preview.thumbs.unobserve(entries[i].target);
          }
        },
        { rootMargin: "240px 0px" }
      );
    }
    preview.thumbs.observe(img);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window, document);
