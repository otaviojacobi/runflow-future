/** Trainer feedback inbox (W8): workouts with conversation or completion activity in the last 30 days (any workout
 *  date: a question on an upcoming workout belongs here) or dated in the last 30 days. */
export default function register(h) {
  const role = (mid) => h.db.memberships.find((m) => m.id === mid)?.role;
  const flaggedOf = (c) => !!c && ((c.rpe ?? 0) >= 9 || ["bad", "awful"].includes(c.feeling));

  /** The inbox's items for a staff member of a club (also `/me` memberships[].unread.feedback). */
  h.feedbackItems = (clubId, viewerMid) => {
    const today = h.today();
    const since = h.addDays(today, -30);
    const sinceTs = new Date(Date.now() - 30 * 86400000).toISOString();
    return h.db.planned_workouts
      .filter((p) => p.club_id === clubId)
      .map((p) => {
        const c = h.db.workout_completions.find((x) => x.planned_workout_id === p.id) || null;
        const cs = h.db.comments.filter((x) => x.planned_workout_id === p.id && !x.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
        const recent = cs.some((x) => x.created_at >= sinceTs) || (c && (c.updated_at ?? "") >= sinceTs);
        if (!recent && !(p.date >= since && p.date <= today)) return null;
        if (!c?.comment && !cs.length && !flaggedOf(c)) return null;
        const last = cs[cs.length - 1] || null;
        const staffReplied = cs.some((x) => role(x.author_membership_id) !== "student");
        const needs_reply = last ? role(last.author_membership_id) === "student" : !!c?.comment && !staffReplied;
        return { p, c, last, needs_reply, flagged: flaggedOf(c), sort_at: [last?.created_at, c?.updated_at].filter(Boolean).sort().at(-1) || p.date };
      })
      .filter(Boolean);
  };

  h.get("/v1/clubs/:club_id/feedback", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const filter = ctx.query.filter || "needs_reply";
    const items = h.feedbackItems(ctx.params.club_id, me.id).map(({ p, last, needs_reply, flagged, sort_at }) => {
      const m = h.db.memberships.find((x) => x.id === p.athlete_membership_id);
      return { workout: h.workoutOut(p, me.id), athlete: { membership_id: m.id, user: h.publicUser(h.db.users.find((u) => u.id === m.user_id)) }, last_comment: last, needs_reply, flagged, sort_at };
    });
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
