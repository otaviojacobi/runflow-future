import { describe, expect, it } from "vitest";
import { computeAssessment, vo2FromRace } from "./assessments";

describe("assessments", () => {
  it("BMI", () => expect(computeAssessment("body", { weight_kg: 70, height_cm: 175 })).toEqual({ bmi: 22.9 }));
  it("Cooper: VO2max and threshold pace", () => {
    const r = computeAssessment("cooper", { distance_m: 3000 })!;
    expect(r.vo2max).toBe(55.8);
    expect(r.threshold_pace_s_per_km).toBeGreaterThan(240); // slower than the 12-min pace (4:00 /km)
    expect(r.threshold_pace_s_per_km).toBeLessThan(270);
  });
  it("3 km in 12:00 ≈ VDOT 48 (Daniels tables)", () => { expect(vo2FromRace(3000, 720)).toBeGreaterThan(46.5); expect(vo2FromRace(3000, 720)).toBeLessThan(49.5); });
  it("CSS needs 200 m faster than 400 m", () => {
    expect(computeAssessment("css", { t400_s: 380, t200_s: 178 })).toEqual({ css_s_per_100m: 101 });
    expect(computeAssessment("css", { t400_s: 300, t200_s: 310 })).toBeNull();
  });
  it("FTP is 95 % of the 20 min power; 1RM uses Epley", () => {
    expect(computeAssessment("ftp", { avg_power_w: 250 })).toEqual({ ftp_w: 238 });
    expect(computeAssessment("one_rm", { exercise: "Agachamento", weight_kg: 60, reps: 5 })).toEqual({ one_rm_kg: 70 });
    expect(computeAssessment("one_rm", { exercise: "Supino", weight_kg: 80, reps: 1 })).toEqual({ one_rm_kg: 80 });
  });
  it("incomplete input → null", () => expect(computeAssessment("body", { weight_kg: 70 })).toBeNull());
});
