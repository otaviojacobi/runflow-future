#!/usr/bin/env node
/**
 * Golden examples for free-text workouts: api/workout-text-examples.json (R1). Every implementation of the grammar
 * (this mock's lib/workout-text.mjs, the web builder's quick text, the backend's workout_text.rs) must give exactly
 * the structure, name, warnings and tags written there.
 *
 *   node api/mock/workout-text-examples.mjs               check every example (also part of `npm run check:api`)
 *   node api/mock/workout-text-examples.mjs --fill        fill in examples that only have `text` + `sport` with what
 *                                                         the parser understands today (review the diff!)
 *   node api/mock/workout-text-examples.mjs run "6x1km @4:30 c/ 2' trote"   show what the parser understands
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkoutText } from "./lib/workout-text.mjs";

export const EXAMPLES_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "workout-text-examples.json");
const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Key order doesn't matter in JSON objects: compare with sorted keys. */
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);

/** What a parse must match: `warnings` and `tags` default to none; `name` is checked when written. */
function expected(ex) {
  return { structure: ex.structure, warnings: ex.warnings ?? [], tags: ex.tags ?? [], ...(ex.name !== undefined && { name: ex.name }) };
}

/** `{count, failures: [{text, sport, field, want, got}]}` for every example of the file. */
export function checkExamples(doc = JSON.parse(readFileSync(EXAMPLES_FILE, "utf8"))) {
  const failures = [];
  for (const ex of doc.examples) {
    if (typeof ex.text !== "string" || !SPORTS.includes(ex.sport)) { failures.push({ text: ex.text, sport: ex.sport, field: "sport", want: SPORTS.join(" | "), got: ex.sport }); continue; }
    if (ex.structure === undefined) { failures.push({ text: ex.text, sport: ex.sport, field: "structure", want: "(missing: run with --fill)", got: null }); continue; }
    const got = parseWorkoutText(ex.text, ex.sport);
    const want = expected(ex);
    for (const field of Object.keys(want)) if (!same(canon(want[field]), canon(got[field]))) failures.push({ text: ex.text, sport: ex.sport, field, want: want[field], got: got[field] });
  }
  return { count: doc.examples.length, failures };
}

// ---------------------------------------------------------------- the file's layout (one block per line)
const j = (v) => JSON.stringify(v);
function formatExample(ex) {
  const lines = [];
  for (const [k, v] of Object.entries(ex)) {
    if (k === "structure" && v?.blocks?.length) lines.push(`   "structure": {"v":${j(v.v)},"blocks":[\n${v.blocks.map((b) => "    " + j(b)).join(",\n")}\n   ]}`);
    else lines.push(`   ${j(k)}: ${j(v)}`);
  }
  return `  {\n${lines.join(",\n")}\n  }`;
}
export function formatExamples(doc) {
  const head = Object.entries(doc).filter(([k]) => k !== "examples").map(([k, v]) => ` ${j(k)}: ${Array.isArray(v) ? `[\n${v.map((x) => "  " + j(x)).join(",\n")}\n ]` : j(v)}`);
  return `{\n${head.join(",\n")},\n "examples": [\n${doc.examples.map(formatExample).join(",\n")}\n ]\n}\n`;
}

/** Fill `structure`, `name`, `warnings`, `tags` of examples written with only `text` + `sport`. */
export function fill(doc) {
  let n = 0;
  doc.examples = doc.examples.map((ex) => {
    if (ex.structure !== undefined) return ex;
    n++;
    const r = parseWorkoutText(ex.text, ex.sport);
    const { text, sport, comment, ...rest } = ex;
    return { text, sport, ...(comment !== undefined && { comment }), name: r.name, structure: r.structure, ...(r.warnings.length && { warnings: r.warnings }), ...(r.tags.length && { tags: r.tags }), ...rest };
  });
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [arg, text] = process.argv.slice(2);
  if (arg && SPORTS.includes(arg)) {
    console.log(JSON.stringify(parseWorkoutText(text ?? "", arg), null, 1));
  } else {
    const doc = JSON.parse(readFileSync(EXAMPLES_FILE, "utf8"));
    if (arg === "--fill") {
      const n = fill(doc);
      writeFileSync(EXAMPLES_FILE, formatExamples(doc));
      console.log(`filled ${n} example(s) in api/workout-text-examples.json: review the diff, fix what's wrong by hand, then make the parsers match`);
    } else {
      const { count, failures } = checkExamples(doc);
      for (const f of failures.slice(0, 10)) console.error(`✗ [${f.sport}] ${j(f.text)}: ${f.field}\n    want ${j(f.want)}\n    got  ${j(f.got)}`);
      if (failures.length) process.exit(1);
      console.log(`✓ ${count} workout text examples`);
    }
  }
}
