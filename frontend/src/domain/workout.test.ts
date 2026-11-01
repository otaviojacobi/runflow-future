import { describe, expect, it } from "vitest";
import { estimate, segments, stepText, type Structure } from "./workout";

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
});
