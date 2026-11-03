import { describe, expect, it } from "vitest";
import { countText, estimate, segments, stepText, type Repeat, type Step, type Structure } from "./workout";

const intervals: Structure = { v: 1, blocks: [
  { kind: "step", intent: "warmup", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 2 } },
  { kind: "repeat", count: 6, steps: [
    { kind: "step", intent: "active", duration: { type: "distance", m: 1000 }, target: { type: "pace", min_s: 265, max_s: 275 } },
    { kind: "step", intent: "recovery", duration: { type: "time", s: 120 }, target: { type: "open" }, note: "trote" },
  ] },
  { kind: "step", intent: "cooldown", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 1 } },
] };

describe("workout structure", () => {
  it("flattens repeats into segments with zones", () => {
    const seg = segments(intervals, "run");
    expect(seg).toHaveLength(14);
    expect(seg[1]!.zone).toBe(4);
    expect(seg[2]!.zone).toBe(1);
  });
  it("estimates duration and distance", () => {
    const e = estimate(intervals, "run");
    expect(e.duration_s).toBe(3540); // 10' + 6×(270 s + 120 s) + 10'
    expect(e.distance_m).toBeGreaterThan(9000);
  });
  it("describes steps in pt-BR", () => {
    expect(stepText(intervals.blocks[0] as never, "run")).toBe("10′ aquecimento · Z2");
    const rep = intervals.blocks[1] as unknown as { steps: never[] };
    expect(stepText(rep.steps[0], "run")).toBe("1 km · 4:25–4:35 /km");
  });
  it("shows the coach's PSE word and ranges, and estimates with the lower bound (R2)", () => {
    const hill: Step = { kind: "step", intent: "active", duration: { type: "distance", m: 60, max_m: 80 }, target: { type: "rpe", value: 3, label: "leve" } };
    expect(stepText(hill, "run")).toBe("60–80 m · PSE leve (3)");
    expect(stepText({ ...hill, duration: { type: "time", s: 1800, max_s: 2400 }, target: { type: "rpe", value: 8 } }, "run")).toBe("30–40′ · PSE 8");
    expect(stepText({ ...hill, duration: { type: "distance", m: 800, max_m: 1000 } }, "run")).toBe("800 m–1 km · PSE leve (3)");
    const set: Repeat = { kind: "repeat", count: 15, max_count: 20, steps: [hill] };
    expect(countText(set)).toBe("15–20");
    expect(estimate({ v: 1, blocks: [set] }, "run").distance_m).toBe(900);
  });
});
