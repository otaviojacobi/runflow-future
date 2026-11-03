// The app's copy of the free-text grammar (src/domain/quicktext.ts, from the web's) must give exactly the golden
// examples in api/workout-text-examples.json, like the web, the mock and the backend (docs/workout-text.md), and
// survive structure → text → structure. Plain Node: it strips the TypeScript types itself (Node ≥ 23.6), and the hook
// below resolves the extensionless relative imports the app uses. No test runner needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec)) return next(spec + ".ts", ctx);
    return next(spec, ctx);
  },
});
const { parseQuickText, toQuickText } = await import(pathToFileURL(path.join(root, "src/domain/quicktext.ts")).href);
const golden = JSON.parse(readFileSync(path.join(root, "../api/workout-text-examples.json"), "utf8"));

let failed = 0;
const check = (label, fn) => { try { fn(); } catch (e) { failed++; console.error(`✗ ${label}\n  ${String(e.message).split("\n").slice(0, 12).join("\n  ")}`); } };
for (const ex of golden.examples) {
  check(`[${ex.sport}] ${JSON.stringify(ex.text)}`, () => {
    const r = parseQuickText(ex.text, ex.sport);
    assert.deepStrictEqual(r.structure, ex.structure);
    assert.deepStrictEqual(r.warnings, ex.warnings ?? []);
    assert.deepStrictEqual(r.tags, ex.tags ?? []);
    if (ex.name !== undefined) assert.equal(r.name, ex.name);
  });
}
// structure → text → structure: the builder writes the structure back into the quick-text box (same cases as the web's
// quicktext.test.ts).
const ROUND_TRIP = [
  ["run", "10' aquec Z2 + 6x1km @4:30 c/ 2' trote + 10' desaq Z1"],
  ["run", "15' Z2 + 3x(2km Z4 + 3' Z1) + 1,5km leve + 8x400m @1:35-1:40 c/ 90\" parado"],
  ["run", "40' FC 140-150 + 10 km PSE 6 + 30' Z2 FC"],
  ["run", "10’ Aquecimento\n3x\n500m Moderado\n500m Moderado\n300m Forte\n200m Forte\nDesc. 1’00 & 2’00”\n5’ Leve"],
  ["run", "10’ Aquecimento\n3x\n3x200m Forte\n1km Moderado\nDesc. 1'30\" & 3'00\"\n5’ Leve\n3' Andando"],
  ["run", "10’ Aquecimento\nFartlek 28min\n7x\n3’ Moderado\n1’ Leve\n5’ Leve"],
  ["run", "10’ Aquecimento\nCruise Interval 51min\n2’ Limiar/ 1’ Trote\n3' Andando"],
  ["run", "10’ Aquecimento\n15-20x\n60-80m subida leve\nDesc. 1min\n5’ Leve"],
  ["run", "Corrida leve 30 a 40 minutos + 1h a 1h30 Z2 + 3x10 min no limiar com 2' de trote + 5' caminhada"],
  ["swim", "400 livre aquec + 8x50 educativo + 10x100 crawl @1:45 palmar + 12x100 pace 1:40/100m desc 15\" + 200 costas desaq"],
  ["bike", "15' Z2 + 4x8' Z4 c/ 4' Z1 + 5x5 min 300W com 3 min 150W + 45' Z2 de potência"],
  ["strength", "Agachamento 4x8 70% desc 90\"\nRemada unilateral 3x10-12 14kg tempo 3-1-1 desc 60\"\nPrancha lateral 3x30s cada lado\nFlexão 3x máx pc"],
  ["mobility", "Mobilidade de quadril 90/90 2x10\n20' mobilidade (quadril, tornozelo e torácica)"],
];
for (const [sport, text] of ROUND_TRIP) check(`round trip [${sport}] ${JSON.stringify(text)}`, () => {
  const { structure, warnings } = parseQuickText(text, sport);
  assert.deepStrictEqual(warnings, []);
  const again = parseQuickText(toQuickText(structure, sport), sport);
  assert.deepStrictEqual(again.warnings, []);
  assert.deepStrictEqual(again.structure, structure);
});
for (const text of ["", "   ", "(((", "6x(", "+++", "1000000x1km", "#só #tags", "999999999999999999999999 km"])
  for (const sport of ["run", "swim", "bike", "strength", "mobility", "other"]) check(`never throws ${JSON.stringify(text)} ${sport}`, () => parseQuickText(text, sport));

if (failed) { console.error(`workout text: ${failed} failing (mobile copy of the grammar)`); process.exit(1); }
console.log(`✓ workout text: ${golden.examples.length} golden examples match the app's grammar`);
