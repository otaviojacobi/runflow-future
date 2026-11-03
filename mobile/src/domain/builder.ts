/**
 * Editing a workout structure (the builder, W5): new blocks with sensible defaults, ranges that keep their upper end,
 * moving and copying, and the text ⇄ number helpers of the step editor. The web keeps these in
 * components/builder/BlockEditor.tsx; here they are pure and shared by the builder's sheets.
 */
import type { Sport } from "@/api/types";
import { pace as fmtPace } from "@/lib/format";
import type { Block, Duration, Exercise, Intent, Repeat, Step, Structure } from "./workout";

export const emptyStructure = (): Structure => ({ v: 1, blocks: [] });

export const newStep = (sport: Sport, intent: Intent = "active"): Step =>
  sport === "swim"
    ? { kind: "step", intent, duration: { type: "distance", m: 100 }, target: { type: "open" }, stroke: "free" }
    : { kind: "step", intent, duration: intent === "active" ? { type: "distance", m: 1000 } : { type: "time", s: intent === "recovery" ? 120 : 600 }, target: intent === "active" ? { type: "zone", metric: "pace", zone: 3 } : { type: "zone", metric: "pace", zone: intent === "recovery" || intent === "cooldown" ? 1 : 2 } };
export const newRepeat = (sport: Sport): Repeat => ({ kind: "repeat", count: 4, steps: [newStep(sport, "active"), newStep(sport, "recovery")] });
export const newExercise = (): Exercise => ({ kind: "exercise", name: "", sets: 3, reps: "10", load: { type: "bodyweight" }, rest_s: 60 });

/** "15 a 20 vezes": the upper count stays while it's above the lower one. */
export const withCount = (r: Repeat, count: number, max?: number): Repeat => {
  const { max_count: _drop, ...rest } = r;
  void _drop;
  return max !== undefined && max > count ? { ...rest, count, max_count: max } : { ...rest, count };
};
/** A range ("30–40 min", "60–80 m": the athlete picks) keeps its upper end while it stays above the lower one. */
export const timeWithMax = (s: number, max?: number): Duration => (max !== undefined && max > s ? { type: "time", s, max_s: max } : { type: "time", s });
export const distanceWithMax = (m: number, max?: number): Duration => (max !== undefined && max > m ? { type: "distance", m, max_m: max } : { type: "distance", m });

/** 630 → "10:30", 3900 → "1:05:00". */
export const clockIn = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
/** "10" → 600 · "10:30" → 630 · "1:05:00" → 3900 (the web builder's parseClock). */
export const parseClock = (v: string): number | null => {
  const p = v.trim().split(":").map((x) => Number(x.replace(",", ".")));
  if (!v.trim() || p.some((x) => isNaN(x))) return null;
  if (p.length === 1) return Math.round(p[0]! * 60);
  if (p.length === 2) return p[0]! * 60 + p[1]!;
  return p[0]! * 3600 + p[1]! * 60 + p[2]!;
};
export const paceIn = (s: number) => fmtPace(s);
/** "4:30" → 270. */
export const parsePace = (v: string) => { const m = v.trim().match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export function move<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
/** A deep copy of a block (duplicating a step or a series). */
export const cloneBlock = <T extends Block | Step>(b: T): T => JSON.parse(JSON.stringify(b)) as T;
