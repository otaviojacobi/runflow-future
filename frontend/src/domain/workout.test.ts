import { describe, expect, it } from "vitest";
import { countText, estimate, profileHeights, segments, stepText, targetText, type Repeat, type Step, type Structure } from "./workout";

const intervals: Structure = { v: 1, blocks: [
  { kind: "step", intent: "warmup", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 2 } },
  { kind: "repeat", count: 6, steps: [
    { kind: "step", intent: "active", duration: { type: "distance", m: 1000 }, target: { type: "pace", min_s: 265, max_s: 275 } },
    { kind: "step", intent: "recovery", duration: { type: "time", s: 120 }, target: { type: "open" }, note: "trote" },
  ] },
  { kind: "step", intent: "cooldown", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 1 } },
] };

const prev = (xs: number[], i: number) => xs[i - 1]!;

describe("workout structure", () => {
  it("shows targets exactly as the coach wrote them, and a short rep's time first", () => {
    const pace = (min_s: number, max_s: number) => ({ type: "pace" as const, min_s, max_s });
    expect(targetText(pace(290, 290), "run", { type: "distance", m: 1000 })).toBe("4:50 /km");
    expect(targetText(pace(260, 270), "run", { type: "distance", m: 2000 })).toBe("4:20–4:30 /km");
    // A tiro: 200 m at 4:30/km is 54″ (founder: "each tiro in 54″, not 52–56″").
    expect(targetText(pace(270, 270), "run", { type: "distance", m: 200 })).toBe("54″ (4:30 /km)");
    expect(targetText(pace(265, 290), "run", { type: "distance", m: 200 })).toBe("53–58″ (4:25–4:50 /km)");
    expect(targetText(pace(240, 240), "run", { type: "distance", m: 400 })).toBe("1′36″ (4:00 /km)");
    expect(targetText({ type: "hr", min: 150, max: 150 }, "run")).toBe("150 bpm");
  });
  it("shows a progression climbing and a fartlek's changes in the profile's heights", () => {
    // 1 km each from 4:50 to 4:20 (all Z4 but the last two): seven rising bars, the fastest full height.
    const km = (p: number): Step => ({ kind: "step", intent: "active", duration: { type: "distance", m: 1000 }, target: { type: "pace", min_s: p - 5, max_s: p + 5 } });
    const prog = profileHeights(segments({ v: 1, blocks: [290, 285, 280, 275, 270, 265, 260].map(km) }, "run"));
    expect(prog.every((h, i) => i === 0 || h > prev(prog, i))).toBe(true);
    expect(prog[6]).toBe(100);
    expect(prog[6]! - prog[0]!).toBeGreaterThan(40);
    // Between zones too: 4:45 sits above 4:50 though both are Z4.
    expect(prog[1]! - prog[0]!).toBeGreaterThan(5);
    // Felipe's "Fartlek - 14km": an open warm-up, then 6:10, 5:55, 6:25, 6:10, 5:55 (all Z1–Z2 for the generic table).
    const open: Step = { kind: "step", intent: "warmup", duration: { type: "distance", m: 3000 }, target: { type: "open" } };
    const fart = profileHeights(segments({ v: 1, blocks: [open, ...[370, 355, 385, 370, 355].map(km)] }, "run"));
    expect(fart[0]).toBe(24);
    expect(fart[3]! < fart[1]! && fart[1]! < fart[2]!).toBe(true);
    expect(fart[2]! - fart[3]!).toBeGreaterThan(30);
    // …but an easy session stays low on the absolute half: its hardest step isn't full height.
    expect(fart[2]).toBeLessThan(80);
    // An easy run doesn't look like intervals: Z1 then Z2 climb, but the absolute half keeps Z2 well below full height.
    const easy = profileHeights(segments({ v: 1, blocks: [
      { kind: "step", intent: "warmup", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 1 } },
      { kind: "step", intent: "active", duration: { type: "time", s: 2400 }, target: { type: "zone", metric: "pace", zone: 2 } },
    ] }, "run"));
    expect(easy[0]).toBeLessThan(easy[1]!);
    expect(easy[1]).toBeLessThan(80);
  });
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
  it("has no expected distance when a main part is free by time (\"30' livre\")", () => {
    const free: Structure = { v: 1, blocks: [{ kind: "step", intent: "active", duration: { type: "time", s: 1800 }, target: { type: "open" } }] };
    expect(estimate(free, "run")).toEqual({ duration_s: 1800, distance_m: null });
    // Easy parts without a target (warm-up, recovery, cool-down) still count at an easy pace.
    const easyEnds: Structure = { v: 1, blocks: [
      { kind: "step", intent: "warmup", duration: { type: "time", s: 600 }, target: { type: "open" } },
      { kind: "step", intent: "active", duration: { type: "distance", m: 5000 }, target: { type: "pace", min_s: 270, max_s: 280 } },
      { kind: "step", intent: "cooldown", duration: { type: "time", s: 600 }, target: { type: "open" } },
    ] };
    expect(estimate(easyEnds, "run").distance_m).toBeGreaterThan(5000);
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
