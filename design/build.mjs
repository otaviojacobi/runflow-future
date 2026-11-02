#!/usr/bin/env node
/**
 * Runflow token build. Zero dependencies (Node >= 20).
 *
 *   node build.mjs          -> writes dist/tokens.{css,ts,js,json} and dist/color-fixtures.json
 *   node build.mjs --check  -> exits 1 if dist/ is stale or a contrast guarantee fails (CI)
 *
 * dist/ is committed on purpose: diffs show the exact values a token change produces.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require("./src/color.js");
const src = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));
const CHECK = process.argv.includes("--check");

const val = (node) => node.$value;
const strip = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith("$")));
const values = (obj) => Object.fromEntries(Object.entries(strip(obj)).map(([k, v]) => [k, val(v)]));
const kebab = C.kebab;
const failures = [];

// ---------- primitives ----------
const seeds = values(src.color.seed);
const neutral = C.neutralScale(src.color.neutral.$extensions["club.runflow.derive"].hue);
const scales = Object.fromEntries(
  Object.entries(seeds).map(([k, hex]) => {
    const { anchor, ...steps } = C.scale(hex);
    return [k, steps];
  }),
);
const zone = values(src.color.zone);
const sport = values(src.color.sport);
const palette = { neutral, ...scales, zone, sport };

function resolveAlias(v) {
  if (typeof v !== "string" || !v.startsWith("{")) return v;
  const [root, group, step] = v.slice(1, -1).split(".");
  const out = root === "color" ? palette[group]?.[step] : undefined;
  if (!out) throw new Error("Unresolved alias " + v);
  return out;
}
function resolveTree(node) {
  if (node && typeof node === "object" && "$value" in node) return resolveAlias(node.$value);
  const out = {};
  for (const [k, v] of Object.entries(strip(node))) out[k] = resolveTree(v);
  return out;
}

// ---------- semantic per mode ----------
const modes = ["light", "dark"];
const semantic = {};
const env = {};
for (const mode of modes) {
  const s = resolveTree(src.semantic[mode]);
  const e = { canvas: s.bg.canvas, surface: s.bg.surface, white: neutral[0], ink: mode === "light" ? neutral[950] : neutral[1000] };
  const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));
  const full = (hex) => pick(C.roles(hex, mode, e), C.ROLE_KEYS);
  for (const k of ["brand", "accent", "success", "warning", "danger", "info"]) s[k] = full(seeds[k]);
  s.sport = Object.fromEntries(
    Object.entries(sport).map(([k, hex]) => [k, pick(C.roles(hex, mode, e), ["solid", "onSolid", "text", "subtle", "subtleFg"])]),
  );
  s.zone = Object.fromEntries(Object.entries(zone).map(([k, hex]) => [k, pick(C.roles(hex, mode, e), ["solid", "onSolid", "text"])]));
  semantic[mode] = s;
  env[mode] = e;

  // contrast guarantees: the build fails if a token edit breaks them
  const need = (name, fg, bg, min) => {
    const r = C.contrast(fg, bg);
    if (r < min) failures.push(`${mode}: ${name} ${fg} on ${bg} = ${r.toFixed(2)} < ${min}`);
  };
  need("fg.default/canvas", s.fg.default, s.bg.canvas, 7);
  need("fg.default/surface", s.fg.default, s.bg.surface, 7);
  need("fg.muted/surface", s.fg.muted, s.bg.surface, 4.5);
  need("fg.muted/canvas", s.fg.muted, s.bg.canvas, 4.5);
  for (const bg of ["surface", "canvas", "sunken"]) need(`fg.subtle/${bg}`, s.fg.subtle, s.bg[bg], 4.5); // meta text is text: WCAG AA
  need("border.strong/surface", s.border.strong, s.bg.surface, 3);
  for (const k of ["brand", "accent", "success", "warning", "danger", "info"]) {
    need(`${k}.onSolid/solid`, s[k].onSolid, s[k].solid, 4.5);
    need(`${k}.text/surface`, s[k].text, s.bg.surface, 4.5);
    need(`${k}.subtleFg/subtle`, s[k].subtleFg, s[k].subtle, 4.5);
    need(`${k}.ring/surface`, s[k].ring, s.bg.surface, 3);
  }
  for (const [k, r] of Object.entries(s.sport)) need(`sport.${k}.subtleFg/subtle`, r.subtleFg, r.subtle, 4.5);
}

// ---------- golden fixtures for ports (Rust backend, mobile) ----------
// Club color resolution: 0, 1 or 2 chosen colors -> primary + secondary seeds.
const RESOLUTION_INPUTS = [
  {},
  { primary: "#D62828" },
  { primary: "#0096C7" },
  { primary: "#FFC300" },
  { primary: "#111111" },
  { primary: "#FFFFFF" },
  { primary: "#D62828", secondary: "#FFB703" },
  { primary: "#FFC300", secondary: "#111111" },
  { secondary: "#2D6A4F" },
];
const resolution = RESOLUTION_INPUTS.map((input) => ({ input, output: C.resolveClubColors(input, seeds) }));
const FIXTURE_SEEDS = [
  ...new Set(
    [seeds.brand, seeds.accent, "#D62828", "#FFC300", "#111111", "#0096C7", "#2D6A4F", "#FF6B00", "#E91E63", "#FFFFFF"].concat(
      resolution.flatMap((r) => [r.output.primary, r.output.secondary]),
    ),
  ),
];
const fixtures = FIXTURE_SEEDS.map((seed) => {
  const { anchor, ...sc } = C.scale(seed);
  return { seed, scale: sc, light: C.roles(seed, "light", env.light), dark: C.roles(seed, "dark", env.dark) };
});
// The engine's guarantees must hold for ANY club color, not just ours.
for (const f of fixtures) {
  for (const mode of modes) {
    const r = f[mode], e = env[mode];
    const need = (name, a, b, min) => {
      const x = C.contrast(a, b);
      if (x < min) failures.push(`fixture ${f.seed} ${mode}: ${name} ${a} on ${b} = ${x.toFixed(2)} < ${min}`);
    };
    need("onSolid/solid", r.onSolid, r.solid, 4.5);
    need("text/surface", r.text, e.surface, 4.5);
    need("subtleFg/subtle", r.subtleFg, r.subtle, 4.5);
    need("ring/surface", r.ring, e.surface, 3);
    need("solidBorder/canvas", r.solidBorder, e.canvas, 3);
  }
}

// ---------- CSS ----------
const decl = (name, value) => `  --rf-${name}: ${value};`;
function flatten(prefix, obj, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? `${prefix}-${kebab(k)}` : kebab(k);
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(name, v, out);
    else out.push([name, v]);
  }
  return out;
}
const px = (n) => (n === 0 ? "0" : `${n}px`);
const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-monospace", "cursive"]);
const fam = (arr) => arr.map((f) => (GENERIC.has(f) || !/[\s]/.test(f) ? f : `"${f}"`)).join(", ");

const prims = [];
for (const [group, steps] of Object.entries(palette)) for (const [k, hex] of Object.entries(steps)) prims.push(decl(`${group}-${k}`, hex));
for (const [k, v] of Object.entries(values(src.font.family))) prims.push(decl(`font-${k}`, fam(v)));
for (const [k, v] of Object.entries(values(src.font.weight))) prims.push(decl(`weight-${k}`, v));
for (const [k, v] of Object.entries(values(src.space))) prims.push(decl(`space-${String(k).replace(".", "_")}`, px(v)));
for (const [k, v] of Object.entries(values(src.radius))) prims.push(decl(`radius-${k}`, px(v)));
for (const [k, v] of Object.entries(values(src.size))) prims.push(decl(`size-${kebab(k)}`, px(v)));
for (const [k, v] of Object.entries(values(src.motion.duration))) prims.push(decl(`duration-${k}`, `${v}ms`));
for (const [k, v] of Object.entries(values(src.motion.easing))) prims.push(decl(`easing-${k}`, `cubic-bezier(${v.join(", ")})`));
for (const [k, v] of Object.entries(values(src.z))) prims.push(decl(`z-${k}`, v));

const modeDecls = (mode) => flatten("", semantic[mode]).map(([n, v]) => decl(n, v));
const header = "/* GENERATED by design/build.mjs. Do not edit. Source: design/tokens.json */";
const css = [
  header,
  "/* Modes: light by default; data-theme=\"dark|light\" on <html> or ANY element forces a mode; otherwise follows the OS. */",
  "",
  ":root {",
  ...prims,
  "}",
  "",
  ':root, [data-theme="light"] {',
  "  color-scheme: light;",
  ...modeDecls("light"),
  "}",
  "",
  '[data-theme="dark"] {',
  "  color-scheme: dark;",
  ...modeDecls("dark"),
  "}",
  "",
  "@media (prefers-color-scheme: dark) {",
  '  :root:not([data-theme="light"]) {',
  "    color-scheme: dark;",
  ...modeDecls("dark").map((l) => "  " + l),
  "  }",
  "}",
  "",
  "/* Text styles */",
  ...Object.entries(strip(src.text)).map(([k, t]) => {
    const p = [
      `font-family: var(--rf-font-${t.family})`,
      `font-size: ${t.size / 16}rem`,
      `line-height: ${+(t.lineHeight / t.size).toFixed(4)}`,
      `font-weight: ${t.weight}`,
      `letter-spacing: ${t.letterSpacing}em`,
    ];
    if (t.width) p.push(`font-stretch: ${t.width}%`);
    if (t.numeric === "tabular") p.push("font-variant-numeric: tabular-nums");
    if (t.transform) p.push(`text-transform: ${t.transform}`);
    return `.rf-text-${kebab(k)} { ${p.join("; ")}; }`;
  }),
  "",
  "@media (prefers-reduced-motion: reduce) {",
  "  :root { --rf-duration-instant: 0ms; --rf-duration-fast: 0ms; --rf-duration-base: 0ms; --rf-duration-slow: 0ms; }",
  "}",
  "",
].join("\n");

// ---------- TS / JS / JSON ----------
const out = {
  seeds,
  palette,
  semantic,
  env,
  font: { family: values(src.font.family), weight: values(src.font.weight) },
  text: strip(src.text),
  space: values(src.space),
  radius: values(src.radius),
  size: values(src.size),
  motion: { duration: values(src.motion.duration), easing: values(src.motion.easing) },
  breakpoint: values(src.breakpoint),
  z: values(src.z),
};
const json = JSON.stringify(out, null, 2);
const files = {
  "dist/tokens.css": css,
  "dist/tokens.json": json + "\n",
  "dist/tokens.ts":
    `// GENERATED by design/build.mjs. Do not edit. Source: design/tokens.json\n` +
    `export const tokens = ${json} as const;\n\n` +
    `export type Tokens = typeof tokens;\nexport type ColorMode = keyof typeof tokens.semantic;\nexport type SemanticColors = (typeof tokens.semantic)["light"];\n`,
  "dist/tokens.js": `${header}\n(function (root) { root.RunflowTokens = ${json}; })(typeof self !== "undefined" ? self : this);\n`,
  "dist/color-fixtures.json":
    JSON.stringify({ $description: "Golden fixtures: any port of src/color.js (Rust, Swift, Kotlin…) must reproduce these exactly.", env, defaults: { brand: seeds.brand, accent: seeds.accent }, resolution, fixtures }, null, 2) + "\n",
};

if (failures.length) {
  console.error("✗ Contrast guarantees failed:\n  " + failures.join("\n  "));
  process.exit(1);
}
if (CHECK) {
  const stale = Object.entries(files).filter(([f, c]) => !existsSync(join(here, f)) || readFileSync(join(here, f), "utf8") !== c);
  if (stale.length) {
    console.error("✗ dist/ is stale. Run `node build.mjs`: " + stale.map(([f]) => f).join(", "));
    process.exit(1);
  }
  console.log("✓ tokens up to date, contrast guarantees hold");
} else {
  mkdirSync(join(here, "dist"), { recursive: true });
  for (const [f, c] of Object.entries(files)) writeFileSync(join(here, f), c);
  console.log("✓ wrote " + Object.keys(files).join(", "));
}
