/** Week release (D-031, F34): drafts stay with the trainer until the week is released (endpoints.md § Week release). */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ddmm = (d) => d.split("-").reverse().slice(0, 2).join("/");

export default function register(h) {
  /** Clubs saved before F34 get the defaults (new clubs plan ahead in private, released Sunday 18:00). */
  h.releaseOf = (c) => {
    if (c && !("release_mode" in c)) Object.assign(c, { release_mode: "weekly", auto_release_weekday: 7, auto_release_time: "18:00" });
    return c;
  };
  for (const c of h.db?.clubs ?? []) h.releaseOf(c);
  const club = (id) => h.releaseOf(h.db.clubs.find((c) => c.id === id));
  const thisMonday = () => h.mondayOf(h.today());
  const releasedTo = (clubId, week, athleteId) => h.db.week_releases.some((r) => r.club_id === clubId && r.week_start === week && (r.athlete_membership_id === null || r.athlete_membership_id === athleteId));

  /** May the athlete see a workout on `date` yet? Same rule as the SQL function workout_released. */
  h.isReleased = (clubId, athleteId, date) => {
    const c = club(clubId);
    if (!c || c.release_mode === "immediate") return true;
    const week = h.mondayOf(date);
    return week <= thisMonday() || releasedTo(clubId, week, athleteId);
  };
  h.visible = (pw) => h.isReleased(pw.club_id, pw.athlete_membership_id, pw.date);
  /** When a week is released automatically (the mock runs on São Paulo time), or null. */
  h.autoReleaseAt = (c, week) => {
    if (c.release_mode !== "weekly" || !c.auto_release_weekday || !c.auto_release_time) return null;
    const day = h.addDays(week, c.auto_release_weekday - 8);
    return new Date(`${day}T${c.auto_release_time}:00-03:00`).toISOString().replace(".000Z", "Z");
  };
  /** Students whose workouts that week are drafts → how many each. */
  const hidden = (clubId, week) => {
    const m = new Map();
    for (const p of h.db.planned_workouts) if (p.club_id === clubId && p.date >= week && p.date <= h.addDays(week, 6) && !h.visible(p)) m.set(p.athlete_membership_id, (m.get(p.athlete_membership_id) || 0) + 1);
    return m;
  };
  const release = (clubId, week, athletes, by, notify = true) => {
    const before = hidden(clubId, week);
    const now = h.nowIso();
    const add = (aid) => {
      if (!h.db.week_releases.some((r) => r.club_id === clubId && r.week_start === week && r.athlete_membership_id === aid))
        h.db.week_releases.push({ id: h.uuid("wr"), club_id: clubId, week_start: week, athlete_membership_id: aid, released_by: by, released_at: now });
    };
    if (athletes.length) athletes.forEach(add);
    else add(null);
    if (!notify) return;
    for (const [aid, n] of before) {
      if (athletes.length && !athletes.includes(aid)) continue;
      const m = h.db.memberships.find((x) => x.id === aid);
      if (m) h.notify({ id: h.uuid("n"), user_id: m.user_id, club_id: clubId, kind: "week_released", title: "Sua semana de treinos está liberada", body: `${n === 1 ? "1 treino" : `${n} treinos`} de ${ddmm(week)} a ${ddmm(h.addDays(week, 6))}`, link: "/schedule", read_at: null, created_at: now });
    }
  };
  /** The mock has no worker: a due automatic release happens on the next request that reads workouts. */
  h.autoRelease = () => {
    const next = h.addDays(thisMonday(), 7);
    for (const c of h.db.clubs) {
      h.releaseOf(c);
      const at = !c.deleted_at && h.autoReleaseAt(c, next);
      if (at && at <= h.nowIso() && !h.db.week_releases.some((r) => r.club_id === c.id && r.week_start === next && r.athlete_membership_id === null)) release(c.id, next, [], null);
    }
  };
  /** Going weekly: release every future week that already has workouts, so nothing students saw disappears. */
  h.releasePlannedFuture = (clubId) => {
    const weeks = new Set(h.db.planned_workouts.filter((p) => p.club_id === clubId && h.mondayOf(p.date) > thisMonday()).map((p) => h.mondayOf(p.date)));
    for (const w of weeks) if (!h.db.week_releases.some((r) => r.club_id === clubId && r.week_start === w && r.athlete_membership_id === null)) h.db.week_releases.push({ id: h.uuid("wr"), club_id: clubId, week_start: w, athlete_membership_id: null, released_by: null, released_at: h.nowIso() });
  };
  /** Future weeks in [from, to] not released to the student yet (said whether or not anything is planned). */
  h.unreleasedWeeks = (clubId, athleteId, from, to) => {
    const c = club(clubId);
    if (!c || c.release_mode !== "weekly") return [];
    const out = [];
    for (let w = [h.mondayOf(from), h.addDays(thisMonday(), 7)].sort()[1]; w <= to && out.length < 60; w = h.addDays(w, 7))
      if (!releasedTo(clubId, w, athleteId)) out.push({ week_start: w, auto_release_at: h.autoReleaseAt(c, w) });
    return out;
  };

  const week = (ctx) => {
    const w = ctx.params.week_start;
    if (!DATE.test(w || "") || h.mondayOf(w) !== w) h.fail(400, "week.invalid", "Semana inválida", "Use a data de uma segunda-feira (AAAA-MM-DD).");
    return w;
  };
  const started = () => h.fail(409, "week.started", "Esta semana já começou", "Os alunos já veem todos os treinos dela.");
  const stateOf = (c, w) => {
    const rs = h.db.week_releases.filter((r) => r.club_id === c.id && r.week_start === w);
    const all = rs.find((r) => r.athlete_membership_id === null);
    const isStarted = w <= thisMonday();
    return {
      week_start: w, release_mode: c.release_mode, started: isStarted, released_at: all?.released_at ?? null,
      released_athlete_ids: rs.filter((r) => r.athlete_membership_id).map((r) => r.athlete_membership_id),
      auto_release_at: !isStarted && !all ? h.autoReleaseAt(c, w) : null,
      drafts: [...hidden(c.id, w).values()].reduce((s, n) => s + n, 0),
    };
  };

  h.get("/v1/clubs/:club_id/weeks/:week_start", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const w = week(ctx);
    h.autoRelease();
    return stateOf(club(ctx.params.club_id), w);
  });
  h.post("/v1/clubs/:club_id/weeks/:week_start/release", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const w = week(ctx);
    const c = club(ctx.params.club_id);
    if (c.release_mode !== "weekly") h.fail(409, "week.release_off", "A liberação semanal está desligada", "Os alunos veem cada treino assim que ele é salvo. Mude isso nas configurações do clube.");
    if (w <= thisMonday()) started();
    const b = ctx.body;
    let athletes = [];
    if ("athlete_ids" in b || b.group_id) {
      const students = new Set(h.db.memberships.filter((m) => m.club_id === c.id && m.role === "student" && m.status === "active").map((m) => m.id));
      let ids = Array.isArray(b.athlete_ids) ? b.athlete_ids : [];
      if (b.group_id) ids = ids.concat(h.db.group_members.filter((g) => g.group_id === b.group_id).map((g) => g.membership_id));
      athletes = [...new Set(ids)].filter((id) => students.has(id));
      if (!athletes.length) h.invalid([{ field: "athlete_ids", message: "Escolha pelo menos um aluno." }]);
    }
    release(c.id, w, athletes, me.id, b.notify !== false);
    return stateOf(c, w);
  });
  h.delete("/v1/clubs/:club_id/weeks/:week_start/release", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const w = week(ctx);
    const c = club(ctx.params.club_id);
    if (w <= thisMonday()) started();
    h.db.week_releases = h.db.week_releases.filter((r) => !(r.club_id === c.id && r.week_start === w));
    return { __status: 200, data: stateOf(c, w) };
  });
}
