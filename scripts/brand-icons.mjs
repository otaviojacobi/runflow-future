#!/usr/bin/env node
/**
 * App icons from Runflow's mark (design/src/logo.js, B1): the web app's favicon, PWA icons and SVG downloads, and the
 * mobile app's icon, adaptive icon and splash. Run after the mark or the brand seeds change, then commit the PNGs:
 *   npm run icons            (Chrome via Playwright; PW_CHROME=/usr/bin/google-chrome to use the system one)
 * Icons the OS masks get the full-bleed tile, and the bars shrink into each platform's safe zone.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const Logo = require(join(root, "design/src/logo.js"));
const T = require(join(root, "design/dist/tokens.json"));
const brand = { tile: T.seeds.brand, ink: T.palette.neutral["0"], accent: T.seeds.accent };
const white = { ink: T.palette.neutral["0"], accent: T.palette.neutral["0"] };

/** [file, size, svg options, opaque (no alpha channel: iOS rejects transparency)] */
const ICONS = [
  ["frontend/public/icons/icon-192.png", 192, { colors: brand }, false],
  ["frontend/public/icons/icon-512.png", 512, { colors: brand }, false],
  // Maskable: launchers crop to a circle of 80% of the width; the bars' corners sit at 42% of it, so 0.85.
  ["frontend/public/icons/maskable-512.png", 512, { colors: brand, tile: "square", scale: 0.85 }, true],
  ["frontend/public/icons/apple-touch-icon.png", 180, { colors: brand, tile: "square" }, true],
  ["mobile/assets/images/icon.png", 1024, { colors: brand, tile: "square" }, true],
  ["mobile/assets/images/favicon.png", 48, { colors: brand }, false],
  // Android adaptive icon: the foreground's safe zone is the inner 66 of 108 dp, so 0.7.
  ["mobile/assets/images/android-icon-foreground.png", 1024, { colors: brand, tile: "none", scale: 0.7 }, false],
  ["mobile/assets/images/android-icon-background.png", 1024, { colors: { ...brand, ink: brand.tile, accent: brand.tile }, tile: "square" }, true],
  ["mobile/assets/images/android-icon-monochrome.png", 1024, { colors: white, tile: "none", scale: 0.7 }, false],
  // Splash: the bars alone on the brand background (app.json backgroundColor).
  ["mobile/assets/images/splash-icon.png", 1024, { colors: brand, tile: "none" }, false],
];

// The vector files the web app serves: favicon and the downloads on /dev/logo.
mkdirSync(join(root, "frontend/public/brand"), { recursive: true });
for (const [from, to] of [["design/dist/logo.svg", "frontend/public/favicon.svg"], ["design/dist/logo.svg", "frontend/public/brand/runflow-mark.svg"], ["design/dist/logo-mono.svg", "frontend/public/brand/runflow-mark-mono.svg"]]) {
  copyFileSync(join(root, from), join(root, to));
  console.log(`✓ ${to}`);
}

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, size, o, opaque] of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${Logo.svg({ ...o, size })}</body></html>`);
  const out = join(root, file);
  await page.locator("svg").screenshot({ path: out, omitBackground: !opaque });
  console.log(`✓ ${file} (${size}×${size})`);
}
await browser.close();

// Drop the alpha channel where the platform wants none (best effort: needs python3 + Pillow).
const flat = ICONS.filter((i) => i[3]).map((i) => join(root, i[0]));
try {
  execFileSync("python3", ["-c", "import sys\nfrom PIL import Image\nfor f in sys.argv[1:]:\n    Image.open(f).convert('RGB').save(f, optimize=True)", ...flat]);
  console.log(`✓ flattened ${flat.length} opaque icons (no alpha)`);
} catch {
  console.warn("! python3 with Pillow not found: opaque icons keep an (unused) alpha channel");
}
