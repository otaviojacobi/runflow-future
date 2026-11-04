/** Trainer dashboard aggregate (W1). Everything the "Painel" shows in one call. */
export default function register(h) {
  h.get("/v1/clubs/:club_id/dashboard", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const clubId = ctx.params.club_id;
    const today = ctx.query.date || h.today();
    const monday = h.mondayOf(today);
    const students = h.db.memberships.filter((m) => m.club_id === clubId && m.role === "student" && m.status === "active");
    const sids = new Set(students.map((m) => m.id));
    const userOf = (mid) => { const m = h.db.memberships.find((x) => x.id === mid); return h.publicUser(h.db.users.find((u) => u.id === m.user_id)); };
    const planned = h.db.planned_workouts.filter((p) => p.club_id === clubId && sids.has(p.athlete_membership_id));
    const comp = (p) => h.db.workout_completions.find((c) => c.planned_workout_id === p.id);
    const done = (p) => ["completed", "partial"].includes(comp(p)?.status);
    const score = (ps) => { const past = ps.filter((p) => p.date < today); return past.length ? Math.round((past.reduce((s, p) => s + (comp(p)?.status === "completed" ? 1 : comp(p)?.status === "partial" ? 0.5 : 0), 0) / past.length) * 100) : null; };

    const todays = planned.filter((p) => p.date === today).map((p) => ({ workout: h.workoutOut(p, me.id), athlete: { membership_id: p.athlete_membership_id, user: userOf(p.athlete_membership_id) } }));
    const week = planned.filter((p) => p.date >= monday && p.date <= h.addDays(monday, 6));
    const trend = Array.from({ length: 8 }, (_, i) => {
      const mon = h.addDays(monday, -7 * (7 - i));
      const ps = planned.filter((p) => p.date >= mon && p.date <= h.addDays(mon, 6));
      return { week_start: mon, pct: score(ps), planned: ps.length, done: ps.filter(done).length, current: mon === monday };
    });

    // feedback waiting: completions with a comment or unread student comments, last 7 days
    const since = h.addDays(today, -7);
    const feedback = planned
      .filter((p) => p.date >= since && p.date <= today)
      .map((p) => ({ p, c: comp(p), th: h.workoutOut(p, me.id) }))
      .filter((x) => x.th.unread_count > 0 || (x.c?.comment && !h.db.comments.some((cm) => cm.planned_workout_id === x.p.id && h.db.memberships.find((m) => m.id === cm.author_membership_id)?.role !== "student")))
      .sort((a, b) => (b.c?.updated_at || b.p.date).localeCompare(a.c?.updated_at || a.p.date))
      .slice(0, 6)
      .map((x) => ({ workout: x.th, athlete: { membership_id: x.p.athlete_membership_id, user: userOf(x.p.athlete_membership_id) }, last_comment: h.db.comments.filter((cm) => cm.planned_workout_id === x.p.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null }));

    const alerts = [];
    for (const m of students) {
      const u = userOf(m.id);
      const mine = planned.filter((p) => p.athlete_membership_id === m.id && p.date < today).sort((a, b) => b.date.localeCompare(a.date));
      let missed = 0;
      for (const p of mine) { if (comp(p)?.status === "missed") missed++; else break; }
      if (missed >= 2) alerts.push({ kind: "missed_streak", severity: "danger", athlete: { membership_id: m.id, user: u }, text: `${u.name} não fez os últimos ${missed} treinos`, link: `/students/${m.id}` });
      const hard = mine.slice(0, 3).filter((p) => (comp(p)?.rpe ?? 0) >= 9).length;
      if (hard >= 2) alerts.push({ kind: "high_rpe", severity: "warning", athlete: { membership_id: m.id, user: u }, text: `${u.name} relatou esforço muito alto em ${hard} treinos seguidos`, link: `/students/${m.id}` });
      const conn = h.db.provider_connections.find((c) => c.user_id === m.user_id && c.provider === "strava" && c.status === "active");
      if (conn && conn.last_sync_at && h.daysBetween(conn.last_sync_at.slice(0, 10), today) >= 7) alerts.push({ kind: "no_sync", severity: "info", athlete: { membership_id: m.id, user: u }, text: `O Strava de ${u.name} não sincroniza há mais de 7 dias`, link: `/students/${m.id}` });
      // Sharing turned off in the last 14 days and still off (D-011: the club sees it). Training data off hides
      // everything, so it's the one said.
      const stopped = (kind) => {
        const cs = h.db.consents.filter((c) => c.user_id === m.user_id && c.club_id === clubId && c.kind === kind);
        return !cs.some((c) => !c.revoked_at) && cs.some((c) => c.revoked_at && Date.parse(c.revoked_at) >= Date.now() - 14 * 86400000);
      };
      if (stopped("share_training_data")) alerts.push({ kind: "sharing_off", severity: "warning", athlete: { membership_id: m.id, user: u }, text: `${u.name} parou de compartilhar os treinos`, link: `/students/${m.id}` });
      else if (stopped("share_strava")) alerts.push({ kind: "sharing_off", severity: "warning", athlete: { membership_id: m.id, user: u }, text: `${u.name} parou de compartilhar o Strava`, link: `/students/${m.id}` });
      if (u.birth_date && u.birth_date.slice(5) >= today.slice(5) && u.birth_date.slice(5) <= h.addDays(today, 6).slice(5)) alerts.push({ kind: "birthday", severity: "accent", athlete: { membership_id: m.id, user: u }, text: `Aniversário de ${u.name} em ${u.birth_date.slice(8)}/${u.birth_date.slice(5, 7)}`, link: `/students/${m.id}` });
      if (h.daysBetween(m.joined_at.slice(0, 10), today) <= 3 && !planned.some((p) => p.athlete_membership_id === m.id && p.date >= today)) alerts.push({ kind: "new_member", severity: "brand", athlete: { membership_id: m.id, user: u }, text: `${u.name} entrou e ainda não tem treinos`, link: "/planning" });
    }
    const sub = h.subscription(clubId, "owner");
    if (sub.student_limit !== null && sub.active_students >= sub.student_limit * 0.9) alerts.push({ kind: "plan_limit", severity: "warning", athlete: null, text: `${sub.active_students} de ${sub.student_limit} alunos no plano ${h.plan(sub.plan).name}`, link: "/club/billing" });


    const b = h.db.club_branding.find((x) => x.club_id === clubId);
    const onboarding = {
      logo: !!b?.logo_asset_id, colors: !!b?.primary_color, students: students.length > 0,
      workouts: planned.some((p) => p.date >= monday), groups: h.db.groups.some((g) => g.club_id === clubId),
      strava: students.some((m) => h.db.provider_connections.some((c) => c.user_id === m.user_id && c.status === "active")),
    };
    return {
      date: today, students: students.length,
      today: { planned: todays.length, done: todays.filter((x) => ["completed", "partial"].includes(x.workout.completion?.status)).length, items: todays },
      week: { planned: week.length, done: week.filter(done).length, compliance_pct: score(week), duration_s: week.reduce((s, p) => s + (p.est_duration_s || 0), 0), distance_m: week.reduce((s, p) => s + (p.est_distance_m || 0), 0) },
      compliance_trend: trend, feedback, alerts, onboarding, subscription: sub,
    };
  });
}
