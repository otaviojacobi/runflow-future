/**
 * Workout structure v1 (api/endpoints.md § Workout structure) + pure helpers: a copy of the web's domain/workout.ts
 * (keep them in sync; areas never import each other, root.md §7.1). Read-only for now: zone per step, timed segments
 * for the intensity profile, step texts, estimates. The builder's editing helpers join with X12.
 */
import type { Sport } from "@/api/types";
import { t } from "@/i18n";
import { clock, distance as fmtDistance, duration, pace as fmtPace } from "@/lib/format";

export type ZoneN = 1 | 2 | 3 | 4 | 5;
/** `max_s` / `max_m`: a range the athlete picks by feel ("60–80 m"); estimates and exports use the lower bound. */
export type Duration = { type: "time"; s: number; max_s?: number } | { type: "distance"; m: number; max_m?: number } | { type: "open" };
/** `rpe.label`: the word the coach wrote ("forte" → PSE 8), shown instead of the bare number. */
export type Target =
  | { type: "open" }
  | { type: "zone"; metric: "hr" | "pace" | "power"; zone: ZoneN; resolved?: { min_s?: number; max_s?: number; min?: number; max?: number } }
  | { type: "pace"; min_s: number; max_s: number }
  | { type: "hr"; min: number; max: number }
  | { type: "power"; min: number; max: number }
  | { type: "rpe"; value: number; label?: string };
export type Intent = "warmup" | "active" | "recovery" | "rest" | "cooldown" | "other";
export type Stroke = "free" | "back" | "breast" | "fly" | "im" | "choice" | "kick" | "drill";
export type Equipment = "pullbuoy" | "kickboard" | "fins" | "paddles" | "snorkel";
export interface Step { kind: "step"; intent: Intent; duration: Duration; target: Target; note?: string; stroke?: Stroke; equipment?: Equipment[]; send_off_s?: number }
/** `max_count`: "15–20×" (the athlete picks; estimates use `count`). `note`: the block's name ("Cruise Interval"). */
export interface Repeat { kind: "repeat"; count: number; max_count?: number; note?: string; steps: Step[] }
export interface Load { type: "kg" | "pct_1rm" | "bodyweight" | "rpe"; value?: number }
export interface Exercise { kind: "exercise"; name: string; sets: number; reps: string; load?: Load; rest_s?: number; tempo?: string; note?: string; exercise_id?: string }
export type Block = Step | Repeat | Exercise;
export interface Structure { v: 1; blocks: Block[] }

export const INTENT_LABEL: Record<Intent, string> = {
  warmup: "Aquecimento", active: "Principal", recovery: "Recuperação", rest: "Descanso", cooldown: "Desaquecimento", other: "Livre",
};
export const STROKE_LABEL: Record<Stroke, string> = {
  free: "crawl", back: "costas", breast: "peito", fly: "borboleta", im: "medley", choice: "livre escolha", kick: "pernada", drill: "educativo",
};
export const EQUIPMENT_LABEL: Record<Equipment, string> = { pullbuoy: "pullbuoy", kickboard: "prancha", fins: "nadadeira", paddles: "palmar", snorkel: "snorkel" };

const RUN_ZONE_PACE: Record<ZoneN, number> = { 1: 390, 2: 345, 3: 310, 4: 285, 5: 260 }; // s/km, generic athlete
const SWIM_ZONE_PACE: Record<ZoneN, number> = { 1: 160, 2: 140, 3: 120, 4: 105, 5: 90 }; // s/100 m
const BIKE_KMH = 28;

/** Effort 1–10 as a zone (PSE targets, the feedback scale). */
export const rpeZone = (v: number): ZoneN => (v >= 9 ? 5 : v >= 7 ? 4 : v >= 5 ? 3 : v >= 3 ? 2 : 1);

/** Zone (1–5) a step represents, for intensity profiles. */
export function zoneOf(step: Step, sport: Sport): ZoneN {
  const tg = step.target;
  if (tg.type === "zone") return tg.zone;
  if (tg.type === "rpe") return rpeZone(tg.value);
  if (tg.type === "pace") {
    const mid = (tg.min_s + tg.max_s) / 2;
    const table = sport === "swim" ? SWIM_ZONE_PACE : RUN_ZONE_PACE;
    return ([5, 4, 3, 2] as ZoneN[]).find((z) => mid <= table[z] + 5) ?? 1;
  }
  return ({ warmup: 2, active: 3, recovery: 1, rest: 1, cooldown: 1, other: 2 } as const)[step.intent];
}

/** Seconds per meter for a step (estimates only). */
function secPerMeter(step: Step, sport: Sport): number {
  const tg = step.target;
  if (sport === "swim") return (tg.type === "pace" ? (tg.min_s + tg.max_s) / 2 : SWIM_ZONE_PACE[zoneOf(step, sport)]) / 100;
  if (sport === "bike") return 3600 / (BIKE_KMH * 1000);
  return (tg.type === "pace" ? (tg.min_s + tg.max_s) / 2 : RUN_ZONE_PACE[zoneOf(step, sport)]) / 1000;
}

export interface Segment { seconds: number; zone: ZoneN; intent: Intent }
/** Flatten repeats into timed segments (exercises become one block each). */
export function segments(structure: Structure, sport: Sport): Segment[] {
  const out: Segment[] = [];
  const stepSeconds = (st: Step) =>
    st.duration.type === "time" ? st.duration.s : st.duration.type === "distance" ? st.duration.m * secPerMeter(st, sport) : 300;
  for (const b of structure.blocks) {
    if (b.kind === "repeat") for (let i = 0; i < b.count; i++) for (const st of b.steps) out.push({ seconds: stepSeconds(st), zone: zoneOf(st, sport), intent: st.intent });
    else if (b.kind === "exercise") out.push({ seconds: b.sets * (45 + (b.rest_s ?? 60)), zone: 3, intent: "active" });
    else out.push({ seconds: stepSeconds(b), zone: zoneOf(b, sport), intent: b.intent });
  }
  return out;
}

/** Estimated total duration (s) and distance (m, null for strength/mobility). */
export function estimate(structure: Structure, sport: Sport): { duration_s: number; distance_m: number | null } {
  let s = 0, m = 0;
  const walk = (blocks: Block[], mult: number) => {
    for (const b of blocks) {
      if (b.kind === "repeat") walk(b.steps, mult * b.count);
      else if (b.kind === "exercise") s += mult * b.sets * (45 + (b.rest_s ?? 60));
      else if (b.duration.type === "time") { s += mult * b.duration.s; m += (mult * b.duration.s) / secPerMeter(b, sport); }
      else if (b.duration.type === "distance") { m += mult * b.duration.m; s += mult * b.duration.m * secPerMeter(b, sport); }
      else s += mult * 300;
    }
  };
  walk(structure.blocks, 1);
  const hasDistance = sport === "run" || sport === "swim" || sport === "bike";
  return { duration_s: Math.round(s / 60) * 60, distance_m: hasDistance ? Math.round(m / 100) * 100 : null };
}

const minutes = (s: number) => (s % 60 === 0 ? `${s / 60}′` : clock(s));
/** "60 m" + "80 m" → "60–80 m"; "30′" + "40′" → "30–40′"; "800 m" + "1 km" → "800 m–1 km". */
const range = (a: string, b: string) => {
  for (const u of [" km", " m", "′"]) if (a.endsWith(u) && b.endsWith(u)) return `${a.slice(0, -u.length)}–${b}`;
  return `${a}–${b}`;
};
export function durationText(d: Duration, sport: Sport): string {
  if (d.type === "time") return d.max_s !== undefined ? range(minutes(d.s), minutes(d.max_s)) : minutes(d.s);
  if (d.type === "distance") {
    const a = fmtDistance(d.m, { swim: sport === "swim" });
    return d.max_m !== undefined ? range(a, fmtDistance(d.max_m, { swim: sport === "swim" })) : a;
  }
  return t("até apertar a volta");
}
/** "6×", "15–20×". */
export const countText = (r: Repeat) => (r.max_count !== undefined ? `${r.count}–${r.max_count}` : String(r.count));
export function targetText(tg: Target, sport: Sport): string | null {
  switch (tg.type) {
    case "open": return null;
    case "zone": {
      const base = `Z${tg.zone}${tg.metric === "hr" ? " " + t("FC") : tg.metric === "power" ? " " + t("potência") : ""}`;
      const r = tg.resolved;
      if (r?.min_s && r.max_s) return `${base} · ${fmtPace(r.min_s)}–${fmtPace(r.max_s)} ${sport === "swim" ? "/100 m" : "/km"}`;
      if (r?.min && r.max) return `${base} · ${r.min}–${r.max} bpm`;
      return base;
    }
    case "pace": return `${fmtPace(tg.min_s)}–${fmtPace(tg.max_s)} ${sport === "swim" ? "/100 m" : "/km"}`;
    case "hr": return `${tg.min}–${tg.max} bpm`;
    case "power": return `${tg.min}–${tg.max} W`;
    // The coach's word leads ("PSE forte (8)"); the number alone when there's none.
    case "rpe": return tg.label ? t("PSE {label} ({n})", { label: tg.label, n: tg.value }) : t("PSE {n}", { n: tg.value });
  }
}
/** "10′ aquecimento" (what to do), split from the target so screens can set the target apart. */
export function stepWhat(st: Step, sport: Sport): string {
  let s = durationText(st.duration, sport);
  if (st.intent !== "active") s += " " + t(INTENT_LABEL[st.intent]).toLowerCase();
  if (st.stroke) s += " " + t(STROKE_LABEL[st.stroke]);
  return s;
}
/** Send-off and equipment ("saída 2:00 · palmar"), or null. */
export function stepExtras(st: Step): string | null {
  const parts: string[] = [];
  if (st.send_off_s) parts.push(t("saída {t}", { t: clock(st.send_off_s) }));
  if (st.equipment?.length) parts.push(st.equipment.map((e) => t(EQUIPMENT_LABEL[e])).join(", "));
  return parts.length ? parts.join(" · ") : null;
}
/** "10′ aquecimento · Z2" / "1 km · 4:25–4:35 /km" / "100 m crawl · saída 2:00" (same text as the web). */
export function stepText(st: Step, sport: Sport): string {
  return [stepWhat(st, sport), targetText(st.target, sport), stepExtras(st)].filter(Boolean).join(" · ");
}
export function exerciseText(e: Exercise): string {
  const load = e.load ? (e.load.type === "kg" ? `${e.load.value} kg` : e.load.type === "pct_1rm" ? `${e.load.value}% 1RM` : e.load.type === "rpe" ? t("PSE {n}", { n: e.load.value ?? 0 }) : t("peso corporal")) : null;
  return [`${e.sets} × ${e.reps}`, load, e.rest_s ? t("descanso {t}", { t: minutes(e.rest_s) }) : null].filter(Boolean).join(" · ");
}
/** True when some zone target carries the student's own range (their zones are set). */
export const hasPersonalTargets = (s: Structure) =>
  s.blocks.some((b) => (b.kind === "repeat" ? b.steps : b.kind === "step" ? [b] : []).some((st) => st.target.type === "zone" && !!st.target.resolved));
/** "≈ 50 min · 9,5 km" (the planned estimate), or "". */
export function estimateText(w: { est_duration_s: number | null; est_distance_m: number | null; sport: Sport }) {
  return [w.est_duration_s ? `≈ ${duration(w.est_duration_s)}` : null, w.est_distance_m ? fmtDistance(w.est_distance_m, { swim: w.sport === "swim" }) : null].filter(Boolean).join(" · ");
}
