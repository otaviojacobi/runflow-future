/**
 * Activity matching (D-049, docs/activity-matching.md): which planned workout a synced or logged activity was.
 * Pure: the caller gathers one student's open activities and open workouts (§ Scope in the doc); the result is the
 * links to make and the questions to ask. Ported to backend/crates/domain/src/matching.rs; both must give the
 * outputs in api/activity-match-examples.json.
 *
 *   activity: {id, day: "YYYY-MM-DD" (club time), sport, distance_m?, duration_s, moving_time_s?, clubs?}
 *   workout:  {id, date, sport, est_distance_m?, est_duration_s?, club_id?}
 *   `clubs`: the clubs this activity may be matched to (the ones the student shares it with, D-011); absent = any.
 *   → {links: [{activity_id, workout_id, compliance_pct}], pending: [{activity_id, options: [workout_id…]}]}
 */
export const RULES = {
  maxDays: 2, // an activity can be a workout planned up to 2 days before or after it
  dayCost: 500, // cost per day away from the planned date
  unknownSize: 300, // size cost when neither distance nor time can be compared
  maxSize: 2000, // cap on the size cost
  plausibleSize: 500, // on another day, |ln(actual ÷ planned)| must be ≤ 0.5 (≈ 61%–165%)
  margin: 250, // a rival this close to the best makes the engine ask
  maxOptions: 3,
  askDays: 7, // only activities of the last 7 days become questions; older doubts stay unmatched
  completedPct: 80, // an automatic match at ≥ 80% is "completed", below it "partial"
};

const GYM = new Set(["strength", "mobility"]);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const num = (v) => (typeof v === "number" && v > 0 ? v : null);

/** Whole days from `b` to `a` (both "YYYY-MM-DD"). */
export const days = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/** Same sport, or both from the gym family (a functional circuit often reaches Strava as "Workout" = strength). */
export const compatible = (a, b) => a === b || (GYM.has(a) && GYM.has(b));

/** actual ÷ planned: distance when both have one, else time (moving time when known) against the planned time. */
export function ratio(act, w) {
  const est = num(w.est_distance_m), d = num(act.distance_m);
  if (est && d) return d / est;
  const estS = num(w.est_duration_s);
  if (estS) return (num(act.moving_time_s) ?? act.duration_s) / estS;
  return null;
}

/** Compliance of a linked workout: the ratio as a percentage (0–200), 100 when nothing can be compared. */
export function compliance(act, w) {
  const r = ratio(act, w);
  return r == null ? 100 : Math.min(200, Math.max(0, Math.round(r * 100)));
}

/** How unlikely it is that `act` was `w` (lower is likelier), or null when it can't have been. */
export function cost(act, w) {
  // Only a club the student shares this activity with may see it completing one of its workouts (D-011).
  if (Array.isArray(act.clubs) && !act.clubs.includes(w.club_id)) return null;
  if (!compatible(act.sport, w.sport)) return null;
  const d = Math.abs(days(act.day, w.date));
  if (d > RULES.maxDays) return null;
  const r = ratio(act, w);
  const size = r == null ? RULES.unknownSize : Math.min(RULES.maxSize, Math.round(Math.abs(Math.log(r)) * 1000));
  // Same day: always plausible (a short run is a partial workout). Another day: only when the size fits.
  if (d > 0 && (r == null ? d > 1 : size > RULES.plausibleSize)) return null;
  return d * RULES.dayCost + size;
}

/** Links each activity to its likeliest workout, or asks when a free rival is almost as likely. */
export function solve({ today, activities, workouts }) {
  const acts = [...activities].sort((a, b) => cmp(a.day, b.day) || cmp(a.id, b.id));
  const pairs = [];
  for (const a of acts) for (const w of workouts) {
    const c = cost(a, w);
    if (c != null) pairs.push({ a, w, c });
  }
  pairs.sort((x, y) => x.c - y.c || cmp(x.a.day, y.a.day) || cmp(x.a.id, y.a.id) || cmp(x.w.date, y.w.date) || cmp(x.w.id, y.w.id));
  // Greedy: the cheapest pairs first, each activity and each workout used once.
  const byAct = new Map(), taken = new Set();
  for (const p of pairs) {
    if (byAct.has(p.a.id) || taken.has(p.w.id)) continue;
    byAct.set(p.a.id, p);
    taken.add(p.w.id);
  }
  const links = [], pending = [];
  for (const a of acts) {
    const best = byAct.get(a.id);
    if (!best) continue;
    // Rivals: workouts no activity took, almost as likely as the best one.
    const rivals = pairs.filter((q) => q.a.id === a.id && q.w.id !== best.w.id && !taken.has(q.w.id) && q.c - best.c < RULES.margin);
    if (!rivals.length) links.push({ activity_id: a.id, workout_id: best.w.id, compliance_pct: compliance(a, best.w) });
    else if (days(today, a.day) <= RULES.askDays) pending.push({ activity_id: a.id, options: [best, ...rivals].slice(0, RULES.maxOptions).map((q) => q.w.id) });
  }
  return { links, pending };
}
