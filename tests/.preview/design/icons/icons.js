/* QuickKit icon set — original artwork.
   16x16 viewBox, one stroke weight (1.5), round caps and joins, currentColor.
   Nothing may inline an SVG elsewhere; use QKIcons.svg(name, size). */
(function (window) {
  "use strict";

  var PATHS = {
    anchor:
      '<circle cx="8" cy="3.6" r="1.9"/>' +
      '<path d="M8 5.5v7.8"/>' +
      '<path d="M5 7.4h6"/>' +
      '<path d="M2.6 10.2c0 2 2.4 3.3 5.4 3.3s5.4-1.3 5.4-3.3"/>',
    presets:
      '<rect x="2.6" y="3" width="10.8" height="10" rx="1.8"/>' +
      '<path d="M5.4 6.1h5.2"/>' +
      '<path d="M8 8v3"/>' +
      '<path d="M6.5 9.5h3"/>',
    text:
      '<path d="M3.2 3.9h9.6"/>' +
      '<path d="M8 3.9v8.3"/>' +
      '<path d="M6 12.2h4"/>',
    easing:
      '<path d="M2.6 13.2c4.4 0 5.2-10.4 10.8-10.4"/>' +
      '<circle cx="2.6" cy="13.2" r="1.1"/>' +
      '<circle cx="13.4" cy="2.8" r="1.1"/>',
    layers:
      '<path d="M8 2.4 13.6 5 8 7.6 2.4 5Z"/>' +
      '<path d="M2.4 8 8 10.6 13.6 8"/>' +
      '<path d="M2.4 11 8 13.6 13.6 11"/>',
    silence:
      '<path d="M2.2 8h1.6"/>' +
      '<path d="M5.2 5.2v5.6"/>' +
      '<path d="M8 3.4v9.2"/>' +
      '<path d="M10.8 5.8v4.4"/>' +
      '<path d="M13.8 7.2v1.6"/>',
    bridge:
      '<path d="M6.6 9.4 9.4 6.6"/>' +
      '<path d="M7.2 4.6 8.6 3.2a2.9 2.9 0 0 1 4.1 4.1l-1.4 1.4"/>' +
      '<path d="M8.8 11.4 7.4 12.8a2.9 2.9 0 0 1-4.1-4.1l1.4-1.4"/>',
    help:
      '<circle cx="8" cy="8" r="5.9"/>' +
      '<path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4"/>' +
      '<circle cx="8" cy="11.7" r="0.8" fill="currentColor" stroke="none"/>',
    close:
      '<path d="M4.2 4.2 11.8 11.8"/>' +
      '<path d="M11.8 4.2 4.2 11.8"/>',
    check:
      '<path d="M3.2 8.4 6.4 11.6 12.9 4.9"/>',
    info:
      '<circle cx="8" cy="8" r="5.9"/>' +
      '<path d="M8 7.4v4"/>' +
      '<circle cx="8" cy="5" r="0.8" fill="currentColor" stroke="none"/>',
    undo:
      '<path d="M3.2 7.2h6.6a3.6 3.6 0 0 1 0 7.2H6.2"/>' +
      '<path d="M5.9 4.4 3 7.2l2.9 2.8"/>',
    plug:
      '<path d="M6 2.7v3.1"/>' +
      '<path d="M10 2.7v3.1"/>' +
      '<path d="M4.4 5.8h7.2v2.3a3.6 3.6 0 0 1-7.2 0Z"/>' +
      '<path d="M8 11.7v1.6"/>'
  };

  function svg(name, size, extraClass) {
    var body = PATHS[name] || PATHS.info;
    var px = size || 16;
    return (
      '<svg class="qk-icon' +
      (extraClass ? " " + extraClass : "") +
      '" viewBox="0 0 16 16" width="' +
      px +
      '" height="' +
      px +
      '" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      body +
      "</svg>"
    );
  }

  function has(name) {
    return Object.prototype.hasOwnProperty.call(PATHS, name);
  }

  window.QKIcons = { paths: PATHS, svg: svg, has: has };
})(window);
