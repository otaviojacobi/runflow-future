#!/usr/bin/env node
/**
 * Files the phone app keeps as verbatim copies of the web app's (areas never import each other's source, §7.1):
 * the free-text grammar and hashtag rules (R1/R2), the modality → feature table (D-052) and the completed-training
 * analysis rules (D-055). Part of `npm run check`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const COPIES = ["domain/quicktext.ts", "domain/tags.ts", "lib/features.ts", "domain/activity.ts"];
const stale = COPIES.filter((f) => readFileSync(join(root, "frontend/src", f), "utf8") !== readFileSync(join(root, "mobile/src", f), "utf8"));
for (const f of stale) console.error(`✗ mobile/src/${f} differs from frontend/src/${f}: copy the web file to the app`);
if (stale.length) process.exit(1);
console.log(`✓ ${COPIES.length} files the app copies from the web are identical`);
