/** Assessment formulas, mirrored from the API (api/mock/lib/assessments.mjs) for a live preview. The server's `result` is authoritative. */
export type AssessmentKind = "body" | "cooper" | "run_3k" | "css" | "ftp" | "one_rm" | "hr_max";
export type AssessmentData = Partial<{ weight_kg: number; height_cm: number; body_fat_pct: number; waist_cm: number; resting_hr: number; distance_m: number; time_s: number; t400_s: number; t200_s: number; avg_power_w: number; exercise: string; reps: number; max_hr: number }>;
export type AssessmentResult = Partial<{ bmi: number; vo2max: number; threshold_pace_s_per_km: number; css_s_per_100m: number; ftp_w: number; one_rm_kg: number; max_hr: number }>;

const round = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
export function vo2FromRace(m: number, s: number) {
  const t = s / 60, v = m / t;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return round(vo2 / pct, 1);
}
export const thresholdFrom = (m: number, s: number) => Math.round((s * Math.pow(10000 / m, 1.06)) / 10);

/** Derived values, or null while the inputs are incomplete/out of range. */
export function computeAssessment(kind: AssessmentKind, d: AssessmentData): AssessmentResult | null {
  const ok = (v: number | undefined, lo: number, hi: number): v is number => typeof v === "number" && v >= lo && v <= hi;
  switch (kind) {
    case "body": return ok(d.weight_kg, 25, 300) && ok(d.height_cm, 100, 250) ? { bmi: round(d.weight_kg / (d.height_cm / 100) ** 2, 1) } : null;
    case "cooper": return ok(d.distance_m, 800, 5500) ? { vo2max: round((d.distance_m - 504.9) / 44.73, 1), threshold_pace_s_per_km: thresholdFrom(d.distance_m, 720) } : null;
    case "run_3k": return ok(d.time_s, 420, 2700) ? { vo2max: vo2FromRace(3000, d.time_s), threshold_pace_s_per_km: thresholdFrom(3000, d.time_s) } : null;
    case "css": return ok(d.t400_s, 240, 1200) && ok(d.t200_s, 100, (d.t400_s ?? 0) - 1) ? { css_s_per_100m: round((d.t400_s - d.t200_s) / 2, 1) } : null;
    case "ftp": return ok(d.avg_power_w, 50, 600) ? { ftp_w: Math.round(d.avg_power_w * 0.95) } : null;
    case "one_rm": return d.exercise?.trim() && ok(d.weight_kg, 0.5, 500) && ok(d.reps, 1, 15) ? { one_rm_kg: round(d.reps === 1 ? d.weight_kg : d.weight_kg * (1 + d.reps / 30), 1) } : null;
    case "hr_max": return ok(d.max_hr, 120, 230) ? { max_hr: d.max_hr } : null;
  }
}
/** Tests that can produce zones (and which kind). */
export const ZONE_KIND: Partial<Record<AssessmentKind, "pace" | "swim_pace" | "power" | "hr">> = { cooper: "pace", run_3k: "pace", css: "swim_pace", ftp: "power", hr_max: "hr" };

/** Zone bounds a test produces (same math as the API). Pace/swim in s (min = faster), power in W, HR in bpm. */
export function zonesFrom(kind: AssessmentKind, r: AssessmentResult): { zone: number; min: number; max: number }[] | null {
  const fromThr = (thr: number, f: number[]) => f.map((x, i) => ({ zone: i + 1, min: Math.round(thr * (f[i + 1] || 0.85)), max: Math.round(thr * x) }));
  const pct = (base: number, f: number[], top = 0) => [1, 2, 3, 4, 5].map((z) => ({ zone: z, min: Math.round(base * f[z - 1]!), max: Math.round(base * f[z]!) - (z === 5 ? 0 : top) }));
  if ((kind === "cooper" || kind === "run_3k") && r.threshold_pace_s_per_km) return fromThr(r.threshold_pace_s_per_km, [1.3, 1.17, 1.08, 1.0, 0.94]);
  if (kind === "css" && r.css_s_per_100m) return fromThr(r.css_s_per_100m, [1.25, 1.12, 1.05, 1.0, 0.95]);
  if (kind === "ftp" && r.ftp_w) return pct(r.ftp_w, [0, 0.56, 0.76, 0.91, 1.06, 1.21], 1);
  if (kind === "hr_max" && r.max_hr) return pct(r.max_hr, [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);
  return null;
}
