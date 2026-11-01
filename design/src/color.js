/*
 * Runflow color engine — single source of truth for palette derivation.
 *
 * Used by:
 *   - build.mjs (generates the default Runflow theme from tokens.json seeds)
 *   - showcase/ and mocks/ (live club-theme preview)
 *   - later: frontend/ and mobile/ via @runflow/design (runtime club theming),
 *     and a Rust port in backend/ (server-side theme injection). Ports MUST
 *     reproduce dist/color-fixtures.json exactly (same seed -> same hex).
 *
 * Works as CommonJS (Node) and as a classic browser script (window.RunflowColor),
 * so the showcase can be opened straight from disk (file://) without a server.
 *
 * Color math: OKLab/OKLCH (Björn Ottosson), WCAG 2.x relative-luminance contrast.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RunflowColor = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- conversions ----------
  function hexToRgb(hex) {
    let h = String(hex).trim().replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error("Invalid hex color: " + hex);
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function rgbToHex(rgb) {
    const c = (v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0");
    return ("#" + c(rgb[0]) + c(rgb[1]) + c(rgb[2])).toUpperCase();
  }
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const fromLin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

  function linToOklab(rgb) {
    const [r, g, b] = rgb;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }
  function oklabToLin(lab) {
    const [L, a, b] = lab;
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  /** hex -> [L (0..1), C (0..~0.37), H (deg)] */
  function toOklch(hex) {
    const [L, a, b] = linToOklab(hexToRgb(hex).map(toLin));
    const C = Math.sqrt(a * a + b * b);
    let H = (Math.atan2(b, a) * 180) / Math.PI;
    if (H < 0) H += 360;
    return [L, C, C < 1e-4 ? 0 : H];
  }
  function oklchToLin(L, C, H) {
    const hr = (H * Math.PI) / 180;
    return oklabToLin([L, C * Math.cos(hr), C * Math.sin(hr)]);
  }
  const inGamut = (lin) => lin.every((v) => v >= -1e-5 && v <= 1 + 1e-5);

  /** OKLCH -> hex, reducing chroma (keeping L and H) until it fits sRGB. */
  function oklch(L, C, H) {
    L = Math.min(1, Math.max(0, L));
    let lin = oklchToLin(L, C, H);
    if (!inGamut(lin)) {
      let lo = 0, hi = C;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(oklchToLin(L, mid, H))) lo = mid;
        else hi = mid;
      }
      lin = oklchToLin(L, lo, H);
    }
    return rgbToHex(lin.map((v) => fromLin(Math.min(1, Math.max(0, v)))));
  }

  // ---------- contrast ----------
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(toLin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /**
   * Move a color's OKLCH lightness (keeping hue/chroma, gamut-mapped) in
   * `direction` (+1 lighter, -1 darker) until contrast(result, against) >= target.
   * Returns the closest-to-original color that satisfies the target.
   */
  function ensureContrast(hex, against, target, direction) {
    if (contrast(hex, against) >= target) return hex.toUpperCase();
    const [L, C, H] = toOklch(hex);
    let lo = L, hi = direction > 0 ? 1 : 0;
    if (contrast(oklch(hi, C, H), against) < target) return oklch(hi, C, H);
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (contrast(oklch(mid, C, H), against) >= target) hi = mid;
      else lo = mid;
    }
    return oklch(hi, C, H);
  }
  function shiftL(hex, delta) {
    const [L, C, H] = toOklch(hex);
    return oklch(L + delta, C, H);
  }

  // ---------- scales ----------
  const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const L_TARGET = { 50: 0.975, 100: 0.945, 200: 0.89, 300: 0.82, 400: 0.72, 500: 0.63, 600: 0.54, 700: 0.47, 800: 0.4, 900: 0.33, 950: 0.26 };
  const C_FACTOR = { 50: 0.12, 100: 0.22, 200: 0.42, 300: 0.65, 400: 0.85, 500: 0.97, 600: 1, 700: 0.92, 800: 0.8, 900: 0.66, 950: 0.52 };

  /**
   * Tonal scale 50..950 from one seed. The seed itself is "anchored" at the
   * step with the nearest lightness, so a club's exact color is always in its scale.
   * Chroma per step = max(base curve, proximity to the seed): steps next to the
   * seed keep its saturation (matters for very light seeds like Volt or yellow).
   */
  function scale(seed) {
    const [L, C, H] = toOklch(seed);
    const out = {};
    for (const s of STEPS) {
      const Lt = L_TARGET[s];
      const near =
        Lt < L
          ? 1 - (0.5 * (L - Lt)) / Math.max(L - 0.2, 0.1)
          : Math.pow(Math.max(0, 1 - (Lt - L) / Math.max(1 - L, 0.02)), 1.2);
      out[s] = oklch(Lt, C * Math.max(C_FACTOR[s], near), H);
    }
    let nearest = STEPS[0];
    for (const s of STEPS) if (Math.abs(L_TARGET[s] - L) < Math.abs(L_TARGET[nearest] - L)) nearest = s;
    out[nearest] = seed.toUpperCase();
    out.anchor = nearest;
    return out;
  }

  const NEUTRAL_STEPS = [0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950, 1000];
  const NEUTRAL_L = { 0: 1, 25: 0.985, 50: 0.968, 100: 0.94, 200: 0.895, 300: 0.81, 400: 0.7, 500: 0.585, 600: 0.5, 700: 0.42, 800: 0.33, 850: 0.275, 900: 0.235, 950: 0.195, 1000: 0.155 };
  const NEUTRAL_C = { 0: 0, 25: 0.003, 50: 0.005, 100: 0.008, 200: 0.011, 300: 0.015, 400: 0.018, 500: 0.02, 600: 0.02, 700: 0.019, 800: 0.018, 850: 0.017, 900: 0.016, 950: 0.014, 1000: 0.012 };

  /** Cool neutral ("Ink") scale, tinted toward `hue`. */
  function neutralScale(hue) {
    const out = {};
    for (const s of NEUTRAL_STEPS) out[s] = oklch(NEUTRAL_L[s], NEUTRAL_C[s], hue);
    return out;
  }

  // ---------- roles ----------
  /**
   * Derive the semantic roles of one chromatic color for one mode.
   * The same function themes Runflow's brand, every club brand, the accent,
   * status colors and sport colors — one code path, one set of guarantees:
   *
   *   solid      fill for primary buttons/badges (the exact seed in light mode)
   *   onSolid    text/icons on solid               >= 4.5:1 (white, ink or black)
   *   solidBorder edge of solid vs canvas          >= 3:1 (only differs from solid
   *                                                  when the seed is too close to the canvas)
   *   text       the color used as text on surface  >= 4.5:1
   *   subtle     tinted background (selected rows, chips)
   *   subtleFg   text on subtle                     >= 4.5:1
   *   border     tinted border
   *   ring       focus ring                         >= 3:1 vs surface
   *
   * @param {string} seed  hex
   * @param {"light"|"dark"} mode
   * @param {{canvas:string, surface:string, white:string, ink:string}} env
   */
  function roles(seed, mode, env) {
    const s = scale(seed);
    const [, C, H] = toOklch(seed);
    const dark = mode === "dark";
    const away = dark ? +1 : -1; // direction that increases contrast vs the background

    let solid = seed.toUpperCase();
    let adjusted = false;
    if (dark && contrast(solid, env.canvas) < 3) {
      solid = ensureContrast(solid, env.canvas, 3, +1);
      adjusted = true;
    }
    // White if it passes AA, else the theme's ink, else pure black. One of white/black
    // always reaches >= 4.58:1, so text on a fill is guaranteed AA for any seed.
    const onSolid =
      contrast(solid, env.white) >= 4.5 ? env.white : contrast(solid, env.ink) >= 4.5 ? env.ink : "#000000";
    const [Ls] = toOklch(solid);
    const hoverDir = Ls < 0.32 ? +1 : -1;
    const solidHover = shiftL(solid, 0.05 * hoverDir);
    const solidActive = shiftL(solid, 0.09 * hoverDir);
    const solidBorder = ensureContrast(solid, env.canvas, 3, away);

    const text = ensureContrast(seed, env.surface, 4.6, away);
    const subtle = dark ? oklch(0.29, Math.min(C * 0.4, 0.075), H) : s[50];
    const subtleHover = dark ? oklch(0.33, Math.min(C * 0.45, 0.085), H) : s[100];
    const subtleFg = ensureContrast(dark ? s[200] : s[800], subtle, 4.6, away);
    const border = dark ? oklch(0.42, Math.min(C * 0.55, 0.11), H) : s[200];
    const ring = ensureContrast(text, env.surface, 3, away);

    return {
      solid, solidHover, solidActive, onSolid, solidBorder,
      text, subtle, subtleHover, subtleFg, border, ring,
      meta: {
        seed: seed.toUpperCase(),
        solidAdjusted: adjusted,
        onSolidContrast: +contrast(solid, onSolid).toFixed(2),
        solidVsCanvas: +contrast(solid, env.canvas).toFixed(2),
        textAdjusted: text !== seed.toUpperCase(),
      },
    };
  }

  /**
   * If white text on the seed fails AA, suggest the closest darker variant
   * that passes (Club Studio offers it as "use this for white text").
   */
  function whiteTextVariant(seed, white) {
    white = white || "#FFFFFF";
    if (contrast(seed, white) >= 4.5) return null;
    return ensureContrast(seed, white, 4.6, -1);
  }

  const ROLE_KEYS = ["solid", "solidHover", "solidActive", "onSolid", "solidBorder", "text", "subtle", "subtleHover", "subtleFg", "border", "ring"];
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

  /** CSS custom-property declarations for one role set, e.g. --rf-brand-solid: #...; */
  function rolesToCss(prefix, r) {
    return ROLE_KEYS.map((k) => `--rf-${prefix}-${kebab(k)}: ${r[k]};`).join(" ");
  }

  /**
   * Companion color for a club that chose only a primary color.
   * Chromatic primary: same hue, opposite lightness (light and vivid for mid/dark
   * primaries, deep for light primaries like yellow). Achromatic primary (black,
   * white, gray): `fallback` (Runflow's Volt), since a neutral can't clash with it.
   */
  function deriveSecondary(primary, fallback) {
    const [L, C, H] = toOklch(primary);
    if (C < 0.04) return String(fallback).toUpperCase();
    return L > 0.72 ? oklch(0.36, C * 0.85, H) : oklch(0.88, C * 0.85, H);
  }

  /**
   * Resolve a club's 0, 1 or 2 chosen colors into the two seeds every theme needs.
   *   {}                    -> Runflow defaults                  (source "default")
   *   {primary}             -> primary + derived secondary       (source "derived")
   *   {primary, secondary}  -> both as chosen                    (source "club")
   *   {secondary} only      -> promoted to primary, then derived
   * `defaults` = { brand, accent } (tokens.json seeds).
   */
  function resolveClubColors(input, defaults) {
    const valid = (h) => typeof h === "string" && /^#?[0-9a-fA-F]{6}$/.test(h.trim());
    const norm = (h) => ("#" + h.trim().replace("#", "")).toUpperCase();
    let p = input && valid(input.primary) ? norm(input.primary) : null;
    let s = input && valid(input.secondary) ? norm(input.secondary) : null;
    if (!p && s) { p = s; s = null; }
    if (!p) return { primary: defaults.brand.toUpperCase(), secondary: defaults.accent.toUpperCase(), source: "default" };
    if (!s) return { primary: p, secondary: deriveSecondary(p, defaults.accent), source: "derived" };
    return { primary: p, secondary: s, source: "club" };
  }

  /**
   * Full CSS override for a club theme (primary -> --rf-brand-*, secondary -> --rf-accent-*),
   * light + dark + system preference. Exactly what the API injects into index.html for a
   * club host, and what the apps apply at runtime after switching clubs. Selectors mirror
   * dist/tokens.css: any element can force a mode with data-theme="light|dark".
   *
   * @param {{primary?:string, secondary?:string}} input  the club's chosen colors (0, 1 or 2)
   * @param {{light:object, dark:object}} envs            env per mode (see roles())
   * @param {{brand:string, accent:string}} defaults      Runflow default seeds
   */
  function clubThemeCss(input, envs, defaults) {
    const c = resolveClubColors(input, defaults);
    const scaleCss = (name, seed) => {
      const sc = scale(seed);
      return STEPS.map((st) => `--rf-${name}-${st}: ${sc[st]};`).join(" ");
    };
    const modeCss = (mode) =>
      rolesToCss("brand", roles(c.primary, mode, envs[mode])) + " " + rolesToCss("accent", roles(c.secondary, mode, envs[mode]));
    const dark = modeCss("dark");
    return (
      `:root { ${scaleCss("brand", c.primary)} ${scaleCss("accent", c.secondary)} }\n` +
      `:root, [data-theme="light"] { ${modeCss("light")} }\n` +
      `[data-theme="dark"] { ${dark} }\n` +
      `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }`
    );
  }

  /**
   * Suggest brand colors from a logo's pixels (RGBA bytes, e.g. canvas ImageData.data).
   * Ignores transparent, near-white, near-black and gray pixels; groups the rest
   * by hue (24 bins of 15°) weighted by chroma; returns up to `max` hex colors,
   * most dominant first. Empty array = logo has no usable color.
   */
  function suggestFromPixels(data, max) {
    max = max || 3;
    const bins = new Map();
    const stride = Math.max(4, Math.floor(data.length / 4 / 20000) * 4);
    for (let i = 0; i + 3 < data.length; i += stride) {
      if (data[i + 3] < 128) continue;
      const lab = linToOklab([toLin(data[i] / 255), toLin(data[i + 1] / 255), toLin(data[i + 2] / 255)]);
      const L = lab[0], C = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
      if (C < 0.04 || L > 0.96 || L < 0.12) continue;
      let H = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
      if (H < 0) H += 360;
      const k = Math.round(H / 15) % 24;
      const b = bins.get(k) || { w: 0, L: 0, a: 0, b: 0 };
      b.w += C; b.L += L * C; b.a += lab[1] * C; b.b += lab[2] * C;
      bins.set(k, b);
    }
    return [...bins.values()]
      .sort((x, y) => y.w - x.w)
      .slice(0, max)
      .map((b) => {
        const L = b.L / b.w, a = b.a / b.w, bb = b.b / b.w;
        let H = (Math.atan2(bb, a) * 180) / Math.PI;
        if (H < 0) H += 360;
        return oklch(L, Math.sqrt(a * a + bb * bb), H);
      });
  }

  return {
    hexToRgb, rgbToHex, toOklch, oklch, luminance, contrast, ensureContrast, shiftL,
    STEPS, NEUTRAL_STEPS, ROLE_KEYS, scale, neutralScale, roles, whiteTextVariant,
    rolesToCss, deriveSecondary, resolveClubColors, clubThemeCss, suggestFromPixels, kebab,
  };
});
