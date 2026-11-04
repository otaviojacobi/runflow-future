import { describe, expect, it } from "vitest";
import { dayOffset, plannedSize } from "./matching";

describe("dayOffset", () => {
  it("says whether the activity was on the planned day, early or late", () => {
    expect(dayOffset("2026-11-03", "2026-11-03")).toBe("no dia");
    expect(dayOffset("2026-11-02", "2026-11-03")).toBe("adiantado 1 dia");
    expect(dayOffset("2026-11-02", "2026-11-04")).toBe("adiantado 2 dias");
    expect(dayOffset("2026-11-03", "2026-11-01")).toBe("atrasado 2 dias");
  });
});

describe("plannedSize", () => {
  it("shows distance and time when known, meters for swims", () => {
    expect(plannedSize({ est_distance_m: 9500, est_duration_s: 3000 }, "run")).toBe("9,5 km · ≈ 50 min");
    expect(plannedSize({ est_distance_m: 1500, est_duration_s: null }, "swim")).toBe("1.500 m");
    expect(plannedSize({ est_distance_m: null, est_duration_s: 2700 }, "mobility")).toBe("≈ 45 min");
    expect(plannedSize({ est_distance_m: null, est_duration_s: null }, "strength")).toBe("");
  });
});
