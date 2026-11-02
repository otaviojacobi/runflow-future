/** Reports (F25): training compliance and volume per student/group, class attendance. Staff only. */
export default function register(h) {
  const TZ_MS = 3 * 3600000;
  const localDate = (iso) => new Date(Date.parse(iso) - TZ_MS).toISOString().slice(0, 10);
  const userOfM = (mid) => { const m = h.db.memberships.find((x) => x.id === mid); return m ? h.publicUser(h.db.users.find((u) => u.id === m.user_id)) : null; };
  const period = (q) => {
    const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || "") ? q.to : h.today();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || "") ? q.from : h.addDays(to, -27);
    if (from > to) h.invalid([{ field: "from", message: "O início precisa ser antes do fim." }]);
    if (h.daysBetween(from, to) > 366) h.invalid([{ field: "from", message: "Escolha um período de até 1 ano." }]);
    return { from, to };
  };
  const studentsOf = (clubId, groupId) => h.db.memberships.filter((m) => m.club_id === clubId && m.role === "student" && m.status === "active" && (!groupId || h.db.group_members.some((g) => g.group_id === groupId && g.membership_id === m.id)));
  const shares = (m) => h.db.consents.some((c) => c.user_id === m.user_id && c.club_id === m.club_id && c.kind === "share_training_data" && !c.revoked_at);
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

  h.get("/v1/clubs/:club_id/reports/training", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const { from, to } = period(ctx.query);
    const today = h.today();
    const students = studentsOf(me.club_id, ctx.query.group_id);
    const ids = new Set(students.map((m) => m.id));
    const planned = h.db.planned_workouts.filter((p) => ids.has(p.athlete_membership_id) && p.date >= from && p.date <= to);
    const status = (p) => h.db.workout_completions.find((c) => c.planned_workout_id === p.id)?.status;
    const score = (ps) => { const past = ps.filter((p) => p.date < today); return past.length ? Math.round((past.reduce((s, p) => s + (status(p) === "completed" ? 1 : status(p) === "partial" ? 0.5 : 0), 0) / past.length) * 100) : null; };
    const actsOf = (m) => (shares(m) ? h.db.activities.filter((a) => a.user_id === m.user_id && localDate(a.started_at) >= from && localDate(a.started_at) <= to) : null);
    const athletes = students.map((m) => {
      const ps = planned.filter((p) => p.athlete_membership_id === m.id);
      const acts = actsOf(m);
      return {
        membership_id: m.id, user: userOfM(m.id), group_ids: h.db.group_members.filter((g) => g.membership_id === m.id).map((g) => g.group_id),
        planned: ps.length, done: ps.filter((p) => status(p) === "completed").length, partial: ps.filter((p) => status(p) === "partial").length,
        missed: ps.filter((p) => p.date < today && (!status(p) || status(p) === "missed" || status(p) === "skipped")).length,
        compliance_pct: score(ps), planned_s: ps.reduce((s, p) => s + (p.est_duration_s || 0), 0),
        shares_data: !!acts, activities: acts ? acts.length : null, done_s: acts ? acts.reduce((s, a) => s + a.duration_s, 0) : null, distance_m: acts ? acts.reduce((s, a) => s + (a.distance_m || 0), 0) : null,
      };
    }).sort((a, b) => a.user.name.localeCompare(b.user.name));
    const weekly = [];
    for (let mon = h.mondayOf(from); mon <= to; mon = h.addDays(mon, 7)) {
      const ps = planned.filter((p) => p.date >= mon && p.date <= h.addDays(mon, 6));
      weekly.push({ week_start: mon, pct: score(ps), planned: ps.length, done: ps.filter((p) => ["completed", "partial"].includes(status(p))).length, current: mon === h.mondayOf(today) });
    }
    const sum = (k) => athletes.reduce((s, a) => s + (a[k] || 0), 0);
    return { from, to, group_id: ctx.query.group_id || null, totals: { athletes: athletes.length, planned: sum("planned"), done: sum("done"), partial: sum("partial"), missed: sum("missed"), compliance_pct: score(planned), planned_s: sum("planned_s"), done_s: sum("done_s"), distance_m: sum("distance_m"), sharing: athletes.filter((a) => a.shares_data).length }, weekly, athletes };
  });

  h.get("/v1/clubs/:club_id/reports/attendance", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const { from, to } = period(ctx.query);
    const nowIso = h.nowIso();
    const sessions = h.db.class_sessions.filter((s) => s.club_id === me.club_id && localDate(s.starts_at) >= from && localDate(s.starts_at) <= to && s.starts_at <= nowIso);
    const held = sessions.filter((s) => s.status === "scheduled");
    const books = h.db.bookings.filter((b) => held.some((s) => s.id === b.session_id) && b.status !== "cancelled" && b.status !== "waitlisted");
    const by_type = h.db.class_types.filter((t) => t.club_id === me.club_id).map((t) => {
      const ss = held.filter((s) => s.class_type_id === t.id);
      const bs = books.filter((b) => ss.some((s) => s.id === b.session_id));
      const attended = bs.filter((b) => b.status === "attended").length, no_show = bs.filter((b) => b.status === "no_show").length;
      return { class_type: { id: t.id, name: t.name, sport: t.sport }, sessions: ss.length, cancelled: sessions.filter((s) => s.class_type_id === t.id && s.status === "cancelled").length, capacity: ss.reduce((n, s) => n + s.capacity, 0), booked: bs.length, attended, no_show, occupancy_pct: pct(bs.length, ss.reduce((n, s) => n + s.capacity, 0)), attendance_pct: pct(attended, attended + no_show) };
    }).filter((x) => x.sessions || x.cancelled);
    const athletes = studentsOf(me.club_id, ctx.query.group_id).map((m) => {
      const bs = books.filter((b) => b.membership_id === m.id);
      const attended = bs.filter((b) => b.status === "attended").length, no_show = bs.filter((b) => b.status === "no_show").length;
      return { membership_id: m.id, user: userOfM(m.id), booked: bs.length, attended, no_show, attendance_pct: pct(attended, attended + no_show) };
    }).filter((a) => a.booked).sort((a, b) => b.attended - a.attended || a.user.name.localeCompare(b.user.name));
    const attended = books.filter((b) => b.status === "attended").length, no_show = books.filter((b) => b.status === "no_show").length;
    return { from, to, totals: { sessions: held.length, cancelled: sessions.length - held.length, booked: books.length, attended, no_show, occupancy_pct: pct(books.length, held.reduce((n, s) => n + s.capacity, 0)), attendance_pct: pct(attended, attended + no_show) }, by_type, athletes };
  });
}
