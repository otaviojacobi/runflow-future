/** Trainer feedback inbox (W8): completions + threads from the last 30 days. */
export default function register(h) {
  h.get("/v1/clubs/:club_id/feedback", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const filter = ctx.query.filter || "needs_reply";
    const today = h.today();
    const since = h.addDays(today, -30);
    const role = (mid) => h.db.memberships.find((m) => m.id === mid)?.role;
    const items = h.db.planned_workouts
      .filter((p) => p.club_id === ctx.params.club_id && p.date >= since && p.date <= today)
      .map((p) => {
        const c = h.db.workout_completions.find((x) => x.planned_workout_id === p.id) || null;
        const cs = h.db.comments.filter((x) => x.planned_workout_id === p.id && !x.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
        if (!c?.comment && !cs.length && !(c && ((c.rpe ?? 0) >= 9 || ["bad", "awful"].includes(c.feeling)))) return null;
        const last = cs[cs.length - 1] || null;
        const staffReplied = cs.some((x) => role(x.author_membership_id) !== "student");
        const needs_reply = last ? role(last.author_membership_id) === "student" : !!c?.comment && !staffReplied;
        const flagged = !!c && ((c.rpe ?? 0) >= 9 || ["bad", "awful"].includes(c.feeling));
        const m = h.db.memberships.find((x) => x.id === p.athlete_membership_id);
        const w = h.workoutOut(p, me.id);
        return { workout: w, athlete: { membership_id: m.id, user: h.publicUser(h.db.users.find((u) => u.id === m.user_id)) }, last_comment: last, needs_reply, flagged, sort_at: last?.created_at || c?.updated_at || p.date };
      })
      .filter(Boolean);
    const counts = { needs_reply: items.filter((x) => x.needs_reply).length, unread: items.filter((x) => x.workout.unread_count > 0).length, flagged: items.filter((x) => x.flagged).length, all: items.length };
    const shown = items
      .filter((x) => filter === "all" || (filter === "unread" ? x.workout.unread_count > 0 : filter === "flagged" ? x.flagged : x.needs_reply))
      .sort((a, b) => b.sort_at.localeCompare(a.sort_at));
    return { ...h.list(shown, ctx, 100), counts };
  });
  h.post("/v1/clubs/:club_id/feedback/read", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const ids = Array.isArray(ctx.body.workout_ids) ? ctx.body.workout_ids : h.db.planned_workouts.filter((p) => p.club_id === ctx.params.club_id).map((p) => p.id);
    for (const id of ids) {
      const r = h.db.thread_reads.find((x) => x.membership_id === me.id && x.planned_workout_id === id);
      if (r) r.last_read_at = h.nowIso(); else h.db.thread_reads.push({ membership_id: me.id, planned_workout_id: id, last_read_at: h.nowIso() });
    }
  });
}
