/**
 * Assessment formulas (F23). The backend implements the same; the web app mirrors them in
 * frontend/src/domain/assessments.ts for a live preview. Inputs per kind:
 *   body    {weight_kg, height_cm, body_fat_pct?, waist_cm?, resting_hr?}   → {bmi}
 *   cooper  {distance_m}  (12 min run)                                     → {vo2max, threshold_pace_s_per_km}
 *   run_3k  {time_s}                                                       → {vo2max, threshold_pace_s_per_km}
 *   css     {t400_s, t200_s}                                               → {css_s_per_100m}
 *   ftp     {avg_power_w}  (best 20 min)                                   → {ftp_w}
 *   one_rm  {exercise, weight_kg, reps}                                    → {one_rm_kg}   (Epley)
 *   hr_max  {max_hr}                                                       → {max_hr}
 */
export const KINDS = ["body", "cooper", "run_3k", "css", "ftp", "one_rm", "hr_max"];
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

/** Daniels-Gilbert VO2max estimate from a performance (distance m, time s). */
export function vo2FromRace(m, s) {
  const t = s / 60, v = m / t;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return round(vo2 / pct, 1);
}
/** Threshold pace (≈ 10 km pace, Riegel 1.06) from any performance. */
export const thresholdFrom = (m, s) => Math.round((s * Math.pow(10000 / m, 1.06)) / 10);

/** Returns {result, errors[]}. */
export function compute(kind, d) {
  const e = [], need = (k, ok, msg) => { if (!ok) e.push({ field: `data.${k}`, message: msg }); };
  let result = {};
  if (kind === "body") {
    need("weight_kg", d.weight_kg >= 25 && d.weight_kg <= 300, "Informe o peso em kg.");
    need("height_cm", d.height_cm >= 100 && d.height_cm <= 250, "Informe a altura em cm.");
    if (!e.length) result = { bmi: round(d.weight_kg / (d.height_cm / 100) ** 2, 1) };
  } else if (kind === "cooper") {
    need("distance_m", d.distance_m >= 800 && d.distance_m <= 5500, "Informe a distância percorrida em 12 minutos.");
    if (!e.length) result = { vo2max: round((d.distance_m - 504.9) / 44.73, 1), threshold_pace_s_per_km: thresholdFrom(d.distance_m, 720) };
  } else if (kind === "run_3k") {
    need("time_s", d.time_s >= 420 && d.time_s <= 2700, "Informe o tempo dos 3 km.");
    if (!e.length) result = { vo2max: vo2FromRace(3000, d.time_s), threshold_pace_s_per_km: thresholdFrom(3000, d.time_s) };
  } else if (kind === "css") {
    need("t400_s", d.t400_s >= 240 && d.t400_s <= 1200, "Informe o tempo dos 400 m.");
    need("t200_s", d.t200_s >= 100 && d.t200_s < d.t400_s, "Informe o tempo dos 200 m (menor que o dos 400 m).");
    if (!e.length) result = { css_s_per_100m: round((d.t400_s - d.t200_s) / 2, 1) };
  } else if (kind === "ftp") {
    need("avg_power_w", d.avg_power_w >= 50 && d.avg_power_w <= 600, "Informe a potência média dos 20 minutos.");
    if (!e.length) result = { ftp_w: Math.round(d.avg_power_w * 0.95) };
  } else if (kind === "one_rm") {
    need("exercise", String(d.exercise || "").trim(), "Informe o exercício.");
    need("weight_kg", d.weight_kg > 0 && d.weight_kg <= 500, "Informe a carga em kg.");
    need("reps", Number.isInteger(d.reps) && d.reps >= 1 && d.reps <= 15, "Entre 1 e 15 repetições.");
    if (!e.length) result = { one_rm_kg: round(d.reps === 1 ? d.weight_kg : d.weight_kg * (1 + d.reps / 30), 1) };
  } else if (kind === "hr_max") {
    need("max_hr", d.max_hr >= 120 && d.max_hr <= 230, "Informe uma FC máxima entre 120 e 230 bpm.");
    if (!e.length) result = { max_hr: d.max_hr };
  } else e.push({ field: "kind", message: "Tipo de avaliação inválido." });
  return { result, errors: e };
}

/** Zone bounds a test can produce: [{zone, min, max}], or null. Pace/swim in s, faster = smaller. */
export function zonesFrom(kind, r) {
  const fromThreshold = (thr, f) => f.map((x, i) => ({ zone: i + 1, min: Math.round(thr * (f[i + 1] || 0.85)), max: Math.round(thr * x) }));
  if ((kind === "cooper" || kind === "run_3k") && r.threshold_pace_s_per_km) return { kind: "pace", bounds: fromThreshold(r.threshold_pace_s_per_km, [1.3, 1.17, 1.08, 1.0, 0.94]) };
  if (kind === "css" && r.css_s_per_100m) return { kind: "swim_pace", bounds: fromThreshold(r.css_s_per_100m, [1.25, 1.12, 1.05, 1.0, 0.95]) };
  if (kind === "ftp" && r.ftp_w) { const f = [0, 0.56, 0.76, 0.91, 1.06, 1.21]; return { kind: "power", bounds: [1, 2, 3, 4, 5].map((z) => ({ zone: z, min: Math.round(r.ftp_w * f[z - 1]), max: Math.round(r.ftp_w * f[z]) - (z === 5 ? 0 : 1) })) }; }
  if (kind === "hr_max" && r.max_hr) { const f = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]; return { kind: "hr", bounds: [1, 2, 3, 4, 5].map((z) => ({ zone: z, min: Math.round(r.max_hr * f[z - 1]), max: Math.round(r.max_hr * f[z]) })) }; }
  return null;
}
