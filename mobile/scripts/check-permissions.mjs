#!/usr/bin/env node
/**
 * The Android permissions the app's features need, read from Expo's resolved config (the same config plugins EAS
 * runs). A plugin option can silently block one: on 2026-11-04 expo-image-picker's `cameraPermission: false` marked
 * CAMERA `tools:node="remove"`, so the Aulas QR scanner could never get the camera (build 8).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NEEDED = {
  "android.permission.CAMERA": "Aulas: ler o QR de check-in (expo-camera)",
};

const out = execFileSync("npx", ["expo", "config", "--type", "introspect", "--json"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20,
});
const manifest = JSON.parse(out)._internal?.modResults?.android?.manifest?.manifest;
if (!manifest) { console.error("✗ permissions: Expo's introspected config has no Android manifest"); process.exit(1); }
const perms = new Map((manifest["uses-permission"] ?? []).map((p) => [p.$["android:name"], p.$["tools:node"]]));
const bad = Object.entries(NEEDED).filter(([name]) => !perms.has(name) || perms.get(name) === "remove");
for (const [name, why] of bad) console.error(`✗ ${name} is ${perms.get(name) === "remove" ? "blocked (tools:node=remove) by a plugin option" : "missing"}; needed for ${why}`);
if (bad.length) process.exit(1);
console.log(`✓ Android permissions: ${Object.keys(NEEDED).join(", ")}`);
