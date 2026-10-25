/* QuickKit CEP bridge — original minimal wrapper.
   Only the calls QuickKit needs; no Adobe library code is copied or bundled.
   When the panel runs in a normal browser, isHosted is false and callers must
   degrade gracefully. */
(function (window) {
  "use strict";

  var cep = window.__adobe_cep__ || null;

  function parse(json) {
    if (typeof json !== "string" || json === "") return null;
    try {
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  var bridge = {
    isHosted: !!cep,

    getHostEnvironment: function () {
      if (!cep || typeof cep.getHostEnvironment !== "function") return null;
      try {
        return parse(cep.getHostEnvironment());
      } catch (e) {
        return null;
      }
    },

    evalScript: function (script, callback) {
      var done = typeof callback === "function" ? callback : function () {};
      if (!cep || typeof cep.evalScript !== "function") {
        done(null);
        return;
      }
      try {
        cep.evalScript(String(script), function (result) {
          done(result);
        });
      } catch (e) {
        done(null);
      }
    },

    getSystemPath: function (pathType) {
      if (!cep || typeof cep.getSystemPath !== "function") return "";
      try {
        return String(cep.getSystemPath(pathType) || "");
      } catch (e) {
        return "";
      }
    },

    getExtensionId: function () {
      if (!cep || typeof cep.getExtensionId !== "function") return "";
      try {
        return String(cep.getExtensionId() || "");
      } catch (e) {
        return "";
      }
    },

    getCurrentApiVersion: function () {
      if (!cep || typeof cep.getCurrentApiVersion !== "function") return null;
      try {
        return parse(cep.getCurrentApiVersion());
      } catch (e) {
        return null;
      }
    }
  };

  window.CSInterfaceLite = bridge;
})(window);
