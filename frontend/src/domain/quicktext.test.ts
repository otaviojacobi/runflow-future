import { describe, expect, it } from "vitest";
import type { Sport } from "@/api/types";
// The contract's golden examples (api/, read by this test only: the app never imports another area's files).
import golden from "../../../api/workout-text-examples.json";
import { parseQuickText, toQuickText } from "./quicktext";
import type { Structure } from "./workout";

interface Example { text: string; sport: Sport; structure: Structure; name?: string; warnings?: string[]; tags?: string[] }
const examples = (golden as unknown as { examples: Example[] }).examples;

describe("quick text: the golden examples (api/workout-text-examples.json)", () => {
  it("has examples", () => expect(examples.length).toBeGreaterThan(100));
  it.each(examples.map((ex) => [ex.sport, ex.text, ex] as const))("[%s] %j", (_sport, _text, ex) => {
    const r = parseQuickText(ex.text, ex.sport);
    expect(r.structure).toStrictEqual(ex.structure);
    expect(r.warnings).toStrictEqual(ex.warnings ?? []);
    expect(r.tags).toStrictEqual(ex.tags ?? []);
    if (ex.name !== undefined) expect(r.name).toBe(ex.name);
  });
});

describe("quick text: structure → text → structure", () => {
  const cases: [Sport, string][] = [
    ["run", "10' aquec Z2 + 6x1km @4:30 c/ 2' trote + 10' desaq Z1"],
    ["run", "15' Z2 + 3x(2km Z4 + 3' Z1) + 1,5km leve + 8x400m @1:35-1:40 c/ 90\" parado"],
    ["run", "40' FC 140-150 + 10 km PSE 6 + 30' Z2 FC"],
    ["swim", "400 livre aquec + 8x50 educativo + 10x100 crawl @1:45 palmar + 12x100 pace 1:40/100m desc 15\" + 200 costas desaq"],
    ["bike", "15' Z2 + 4x8' Z4 c/ 4' Z1 + 5x5 min 300W com 3 min 150W + 45' Z2 de potência"],
    ["strength", "Agachamento 4x8 70% desc 90\"\nRemada unilateral 3x10-12 14kg tempo 3-1-1 desc 60\"\nPrancha lateral 3x30s cada lado\nFlexão 3x máx pc"],
    ["mobility", "Mobilidade de quadril 90/90 2x10\n20' mobilidade (quadril, tornozelo e torácica)"],
  ];
  it.each(cases)("[%s] %s", (sport, text) => {
    const { structure, warnings } = parseQuickText(text, sport);
    expect(warnings).toEqual([]);
    const again = parseQuickText(toQuickText(structure, sport), sport);
    expect(again.warnings).toEqual([]);
    expect(again.structure).toStrictEqual(structure);
  });
});

describe("quick text: never throws", () => {
  it.each(["", "   ", "(((", "))) 6x", "x x x", "6x(", "+++", "@@@ 4:30 @", "1000000x1km", "#só #tags", "999999999999999999999999 km"])("%j", (text) => {
    for (const sport of ["run", "swim", "bike", "strength", "mobility", "other"] as Sport[]) expect(() => parseQuickText(text, sport)).not.toThrow();
  });
});
