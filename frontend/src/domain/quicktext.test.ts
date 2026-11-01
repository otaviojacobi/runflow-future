import { describe, expect, it } from "vitest";
import { parseQuickText, toQuickText } from "./quicktext";
import type { Exercise, Repeat, Step } from "./workout";

describe("quick text: running", () => {
  it("parses the classic interval session", () => {
    const { structure, warnings } = parseQuickText("10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq", "run");
    expect(warnings).toEqual([]);
    const [w, r, c] = structure.blocks as [Step, Repeat, Step];
    expect(w).toMatchObject({ intent: "warmup", duration: { type: "time", s: 600 } });
    expect(r.count).toBe(6);
    expect(r.steps[0]).toMatchObject({ intent: "active", duration: { type: "distance", m: 1000 }, target: { type: "pace", min_s: 265, max_s: 275 } });
    expect(r.steps[1]).toMatchObject({ intent: "recovery", duration: { type: "time", s: 120 } });
    expect(c).toMatchObject({ intent: "cooldown", duration: { type: "time", s: 600 } });
  });
  it("handles zones, nested repeats, decimals and seconds", () => {
    const { structure } = parseQuickText("15' Z2 + 3x(2km Z4 + 3' Z1) + 1,5km leve + 8x400m @1:35-1:40 c/ 90\" parado", "run");
    const [a, b, c, d] = structure.blocks as [Step, Repeat, Step, Repeat];
    expect(a.target).toEqual({ type: "zone", metric: "pace", zone: 2 });
    expect(b.count).toBe(3);
    expect(b.steps).toHaveLength(2);
    expect(c.duration).toEqual({ type: "distance", m: 1500 });
    expect(c.target).toEqual({ type: "zone", metric: "pace", zone: 2 });
    expect(d.steps[0]!.target).toEqual({ type: "pace", min_s: 95, max_s: 100 });
    expect(d.steps[1]).toMatchObject({ intent: "rest", duration: { type: "time", s: 90 } });
  });
  it("accepts 'tiros de' and hours, warns on gibberish", () => {
    const { structure, warnings } = parseQuickText("1h20 Z2 + 6 tiros de 800m forte com 2' trote + blablabla", "run");
    expect((structure.blocks[0] as Step).duration).toEqual({ type: "time", s: 4800 });
    expect((structure.blocks[1] as Repeat).count).toBe(6);
    expect(warnings).toEqual(["blablabla"]);
  });
  it("round-trips through text", () => {
    const text = "10' aquec Z2 + 6x1km @4:30 c/ 2' trote + 10' desaq Z1";
    const { structure } = parseQuickText(text, "run");
    expect(parseQuickText(toQuickText(structure, "run"), "run").structure).toEqual(structure);
  });
});

describe("quick text: swimming", () => {
  it("parses strokes, send-off and equipment", () => {
    const { structure, warnings } = parseQuickText("400 livre aquec + 8x50 educativo + 10x100 crawl @1:45 palmar + 200 costas", "swim");
    expect(warnings).toEqual([]);
    const main = structure.blocks[2] as Repeat;
    expect(main.count).toBe(10);
    expect(main.steps[0]).toMatchObject({ duration: { type: "distance", m: 100 }, stroke: "free", send_off_s: 105, equipment: ["paddles"] });
    expect((structure.blocks[1] as Repeat).steps[0]!.stroke).toBe("drill");
  });
});

describe("quick text: strength", () => {
  it("parses one exercise per line", () => {
    const { structure, warnings } = parseQuickText("agachamento 4x8 70% desc 90\"\nSupino 4x10 20kg desc 1'\nPrancha 3x45s pc", "strength");
    expect(warnings).toEqual([]);
    const [a, b, c] = structure.blocks as Exercise[];
    expect(a).toMatchObject({ name: "Agachamento", sets: 4, reps: "8", load: { type: "pct_1rm", value: 70 }, rest_s: 90 });
    expect(b).toMatchObject({ load: { type: "kg", value: 20 }, rest_s: 60 });
    expect(c).toMatchObject({ reps: "45 s", load: { type: "bodyweight" } });
  });
});
