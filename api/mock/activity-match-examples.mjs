#!/usr/bin/env node
/**
 * Golden examples for activity matching: api/activity-match-examples.json (D-049, docs/activity-matching.md). The
 * mock's lib/matching.mjs and the backend's domain/src/matching.rs must both give exactly the `expect` written there.
 *
 *   node api/mock/activity-match-examples.mjs          check every example (also part of `npm run check:api`)
 *   node api/mock/activity-match-examples.mjs --fill   write what the engine answers today into examples without
 *                                                      `expect` (review the diff!)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { solve } from "./lib/matching.mjs";

export const MATCH_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "activity-match-examples.json");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** `{count, failures: [{name, want, got}]}` for every example of the file. */
export function checkMatchExamples(doc = JSON.parse(readFileSync(MATCH_FILE, "utf8"))) {
  const failures = [];
  for (const ex of doc.examples) {
    const got = solve(ex);
    if (!ex.expect || !same(got, ex.expect)) failures.push({ name: ex.name, want: ex.expect ?? "(missing: run with --fill)", got });
  }
  return { count: doc.examples.length, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const doc = JSON.parse(readFileSync(MATCH_FILE, "utf8"));
  if (process.argv.includes("--fill")) {
    let n = 0;
    for (const ex of doc.examples) if (!ex.expect) { ex.expect = solve(ex); n++; }
    writeFileSync(MATCH_FILE, JSON.stringify(doc, null, 2) + "\n");
    console.log(`filled ${n} example(s); review the diff`);
  } else {
    const { count, failures } = checkMatchExamples(doc);
    for (const f of failures) console.log(`✗ ${f.name}\n  want ${JSON.stringify(f.want)}\n  got  ${JSON.stringify(f.got)}`);
    console.log(failures.length ? `${failures.length} of ${count} examples differ` : `✓ ${count} activity matching examples`);
    process.exit(failures.length ? 1 : 0);
  }
}
