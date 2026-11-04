/** Student endpoints (/my/*): own workouts with personal targets, completion/feedback, summary for Today. */
import { compliance as complianceOf, cost } from "../lib/matching.mjs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function register(h) {
  const zonesOf = (mid) => {
    const latest = (kind) => h.db.zones.filter((z) => z.membership_id === mid && z.kind === kind).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
    return { pace: latest("pace"), hr: latest("hr"), swim_pace: latest("swim_pace") };
  };
  /** Adds `resolved` ranges to zone targets using the athlete's zones (pace s/km or bpm). */
  h.resolveTargets = (structure, mid) => {
    const z = zonesOf(mid);
    const fix = (step) => {
      const tg = step.target;
      if (tg?.type !== "zone") return step;
      const table = tg.metric === "hr" ? z.hr : z.pace;
      const b = table?.bounds.find((x) => x.zone === tg.zone);
      return b ? { ...step, target: { ...tg, resolved: tg.metric === "hr" ? { min: b.min, max: b.max } : { min_s: b.min, max_s: b.max } } } : step;
    };
    return { ...structure, blocks: structure.blocks.map((b) => (b.kind === "repeat" ? { ...b, steps: b.steps.map(fix) } : b.kind === "step" ? fix(b) : b)) };
  };
  const mine = (ctx) => ctx.member(ctx.params.club_id, ["student"]);
  const getMine = (m, id) => h.db.planned_workouts.find((p) => p.id === id && p.athlete_membership_id === m.id && h.visible(p)) || h.fail(404, "workout.not_found", "Treino não encontrado", "Ele pode ter sido removido pelo treinador.");
  const shareOk = (m) => h.db.consents.some((c) => c.user_id === m.user_id && c.club_id === m.club_id && c.kind === "share_training_data" && !c.revoked_at);

  h.get("/v1/clubs/:club_id/my/workouts", (ctx) => {
    const m = mine(ctx);
    const { from, to } = ctx.query;
    if (!DATE.test(from || "") || !DATE.test(to || "")) h.invalid([{ field: "from", message: "Informe o período (from e to)." }]);
    h.autoRelease();
    const items = h.db.planned_workouts.filter((p) => p.athlete_membership_id === m.id && p.date >= from && p.date <= to && h.visible(p)).sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position).map((p) => h.workoutOut(p, m.id));
    return { items, unreleased_weeks: h.unreleasedWeeks(m.club_id, m.id, from, to), next_cursor: null };
  });
  h.get("/v1/clubs/:club_id/my/workouts/:id", (ctx) => {
    const m = mine(ctx);
    const p = getMine(m, ctx.params.id);
    const c = h.db.workout_completions.find((x) => x.planned_workout_id === p.id);
    const activity = c?.activity_id ? h.db.activities.find((a) => a.id === c.activity_id) : null;
    const coach = h.db.memberships.find((x) => x.id === p.created_by);
    const sameDay = h.db.activities.filter((a) => a.user_id === m.user_id && a.started_at.slice(0, 10) >= h.addDays(p.date, -1) && a.started_at.slice(0, 10) <= h.addDays(p.date, 1));
    return { ...h.workoutOut(p, m.id), structure: h.resolveTargets(p.structure, m.id), activity: activity || null, candidate_activities: sameDay, coach: coach ? h.publicUser(h.db.users.find((u) => u.id === coach.user_id)) : null };
  });
  h.put("/v1/clubs/:club_id/my/workouts/:id/completion", (ctx) => {
    const m = mine(ctx);
    const p = getMine(m, ctx.params.id);
    const b = ctx.body;
    const errors = [];
    if (!["completed", "partial", "missed", "skipped"].includes(b.status)) errors.push({ field: "status", message: "Diga se você fez o treino." });
    if (b.rpe != null && !(b.rpe >= 1 && b.rpe <= 10)) errors.push({ field: "rpe", message: "O esforço vai de 1 a 10." });
    if (b.feeling != null && !["great", "good", "ok", "bad", "awful"].includes(b.feeling)) errors.push({ field: "feeling", message: "Escolha como você se sentiu." });
    if (errors.length) h.invalid(errors);
    // The activity (D-049): the one sent (the student's own link), else the one already linked, else the likeliest
    // open activity of that day. Missed or skipped drops the link.
    const done = b.status !== "missed" && b.status !== "skipped";
    let c = h.db.workout_completions.find((x) => x.planned_workout_id === p.id);
    let activityId = null, by = null;
    if (b.activity_id) {
      if (!h.db.activities.some((a) => a.id === b.activity_id && a.user_id === m.user_id)) h.invalid([{ field: "activity_id", message: "Atividade inválida." }]);
      [activityId, by] = [b.activity_id, "student"];
    } else if (done && c?.activity_id) [activityId, by] = [c.activity_id, c.matched_by ?? "auto"];
    else if (done) {
      const taken = new Set(h.db.workout_completions.map((x) => x.activity_id).filter(Boolean));
      const best = h.db.activities
        .filter((a) => a.user_id === m.user_id && !taken.has(a.id) && a.match_state !== "dismissed" && h.activityDay(a.started_at) === p.date)
        .map((a) => ({ a, cost: cost({ ...a, day: p.date }, p) }))
        .filter((x) => x.cost != null)
        .sort((x, y) => x.cost - y.cost)[0];
      if (best) [activityId, by] = [best.a.id, "auto"];
    }
    const act = activityId ? h.db.activities.find((a) => a.id === activityId) : null;
    // The activity leaves the workout it completed before; the one this workout had becomes free.
    const prev = act ? h.db.workout_completions.find((x) => x.activity_id === act.id && x.planned_workout_id !== p.id) : null;
    const dropped = c?.activity_id && c.activity_id !== activityId ? c.activity_id : null;
    if (prev) h.unlinkCompletion(prev);
    const compliance = act ? complianceOf(act, p) : b.status === "completed" ? 100 : b.status === "partial" ? 60 : 0;
    const now = h.nowIso();
    c = h.db.workout_completions.find((x) => x.planned_workout_id === p.id);
    const first = !c?.reported_at;
    if (!c) { c = { planned_workout_id: p.id, completed_at: now }; h.db.workout_completions.push(c); }
    Object.assign(c, { activity_id: activityId, matched_by: by, status: b.status, compliance_pct: Math.min(200, compliance), rpe: b.rpe ?? null, feeling: b.feeling ?? null, comment: (b.comment || "").trim() || null, reported_at: c.reported_at ?? now, updated_at: now });
    if (act) { act.match_state = "open"; h.clearMatchOptions(act.id); }
    if (prev || dropped) h.rematch(m.user_id, p.date);
    // The trainer hears about it the first time the student reports (an automatic match alone doesn't notify).
    const coach = h.db.memberships.find((x) => x.id === p.created_by);
    const student = h.db.users.find((u) => u.id === m.user_id);
    if (coach && first) h.notify({ id: h.uuid("n"), user_id: coach.user_id, club_id: p.club_id, kind: "feedback", title: `${student.name} ${b.status === "missed" ? "não fez o treino" : "registrou o treino"}`, body: c.comment || p.title, link: "/feedback", read_at: null, created_at: now });
    return h.workoutOut(p, m.id);
  });
  h.get("/v1/clubs/:club_id/my/summary", (ctx) => {
    const m = mine(ctx);
    const today = h.today();
    const monday = h.mondayOf(today);
    const status = (p) => h.db.workout_completions.find((c) => c.planned_workout_id === p.id)?.status;
    const all = h.db.planned_workouts.filter((p) => p.athlete_membership_id === m.id && h.visible(p));
    const week = all.filter((p) => p.date >= monday && p.date <= h.addDays(monday, 6));
    let streak = 0;
    for (let w = 1; w < 52; w++) {
      const mon = h.addDays(monday, -7 * w);
      const ws = all.filter((p) => p.date >= mon && p.date <= h.addDays(mon, 6));
      if (ws.length && ws.some((p) => ["completed", "partial"].includes(status(p)))) streak++;
      else break;
    }
    const last = h.db.activities.filter((a) => a.user_id === m.user_id).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] || null;
    return {
      shares_data: shareOk(m), streak_weeks: streak,
      week: { planned: week.length, done: week.filter((p) => ["completed", "partial"].includes(status(p))).length, duration_s: week.reduce((s, p) => s + (p.est_duration_s || 0), 0), distance_m: week.reduce((s, p) => s + (p.est_distance_m || 0), 0) },
      last_activity: last,
    };
  });
}
