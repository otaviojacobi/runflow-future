// §7.7 performance budget: the JS the browser loads before the first screen (entry + modulepreloads) ≤ 200 KB gzip.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const LIMIT_KB = 200;
const html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
const files = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
const kb = files.reduce((s, f) => s + gzipSync(readFileSync(new URL(`../dist/assets/${f}`, import.meta.url))).length, 0) / 1024;
const line = `initial JS ${kb.toFixed(1)} KB gzip (${files.length} files, budget ${LIMIT_KB} KB)`;
if (kb > LIMIT_KB) { console.error(`✗ ${line}`); process.exit(1); }
console.log(`✓ ${line}`);
