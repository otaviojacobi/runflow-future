/*
 * Runflow's mark, "Ritmo" (founder, 2026-11-03, B1): a workout's intensity profile, like the builder's chart:
 * easy, hard, recovery and the hardest one in Volt. Drawn on a 48 × 48 grid; the bars sit on one baseline and are
 * centered both ways. Colors are the brand seeds (Azul Flow tile, white bars, Volt for the last one).
 *
 * Works as CommonJS (Node, the apps via @runflow/design/logo) and as a classic browser script (window.RunflowLogo),
 * like color.js. build.mjs writes dist/logo.svg, dist/logo-mono.svg and dist/logo.json (the backend's e-mails).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RunflowLogo = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var GRID = 48;
  var TILE_RADIUS = 13;
  var BAR = { width: 5.6, radius: 2.8, baseline: 36 };
  var BARS = [
    { x: 8, top: 26 },
    { x: 16.8, top: 16 },
    { x: 25.6, top: 22 },
    { x: 34.4, top: 12, accent: true },
  ];

  function num(n) {
    return String(Math.round(n * 1000) / 1000);
  }

  /**
   * The mark as an SVG string.
   * - tile: "rounded" (the app tile), "square" (full bleed, for icons the OS masks) or "none" (bars only).
   * - colors: { tile, ink, accent }; one-color use passes the same color (or "currentColor") to ink and accent.
   * - scale: shrinks the bars around the center (safe zones of maskable and adaptive icons). Default 1.
   * - size: width/height attributes (default 48).
   */
  function svg(o) {
    var c = o.colors;
    var size = o.size || GRID;
    var scale = o.scale || 1;
    var tile = o.tile || "rounded";
    var out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + GRID + " " + GRID + '">';
    if (tile !== "none") out += '<rect width="' + GRID + '" height="' + GRID + '"' + (tile === "rounded" ? ' rx="' + TILE_RADIUS + '"' : "") + ' fill="' + c.tile + '"/>';
    var half = GRID / 2;
    out += scale === 1 ? "<g>" : '<g transform="translate(' + half + " " + half + ") scale(" + num(scale) + ") translate(-" + half + " -" + half + ')">';
    for (var i = 0; i < BARS.length; i++) {
      var b = BARS[i];
      out += '<rect x="' + num(b.x) + '" y="' + num(b.top) + '" width="' + num(BAR.width) + '" height="' + num(BAR.baseline - b.top) + '" rx="' + num(BAR.radius) + '" fill="' + (b.accent ? c.accent : c.ink) + '"/>';
    }
    return out + "</g></svg>";
  }

  return { GRID: GRID, TILE_RADIUS: TILE_RADIUS, BAR: BAR, BARS: BARS, svg: svg };
});
