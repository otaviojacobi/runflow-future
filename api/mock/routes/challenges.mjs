/** Challenges, monthly rankings and badges (F24). Progress comes from the participant's own activities. */
const METRICS = ["distance", "duration", "sessions", "elevation"];
const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export default function register(h) {
  const TZ_MS = 3 * 3600000; // club-local (America/Sao_Paulo)
  const localDate = (iso) => new Date(Date.parse(iso) - TZ_MS).toISOString().slice(0, 10);
  const userOfM = (mid) => { const m = h.db.memberships.find((x) => x.id === mid); return m ? h.publicUser(h.db.users.find((u) => u.id === m.user_id)) : null; };
  const memberOf = (mid) => h.db.memberships.find((x) => x.id === mid);
  const groupsOf = (mid) => new Set(h.db.group_members.filter((g) => g.membership_id === mid).map((g) => g.group_id));
  /** Sum of a metric over a user's activities in [from, to] (club-local dates). distance → km, duration → h. */
  const measure = (userId, metric, sport, from, to) => {
    const acts = h.db.activities.filter((a) => a.user_id === userId && (!sport || a.sport === sport)).filter((a) => { const d = localDate(a.started_at); return d >= from && d <= to; });
    const v = metric === "distance" ? acts.reduce((s, a) => s + (a.distance_m || 0), 0) / 1000 : metric === "duration" ? acts.reduce((s, a) => s + a.duration_s, 0) / 3600 : metric === "elevation" ? acts.reduce((s, a) => s + (a.elevation_gain_m || 0), 0) : acts.length;
    return Math.round(v * 10) / 10;
  };
  const status = (c) => (h.today() < c.starts_on ? "upcoming" : h.today() > c.ends_on ? "finished" : "active");
  const visible = (c, m) => m.role !== "student" || !c.group_ids.length || c.group_ids.some((g) => groupsOf(m.id).has(g));
  const board = (c) => h.db.challenge_participants.filter((p) => p.challenge_id === c.id).map((p) => {
    const m = memberOf(p.membership_id);
    const value = m ? measure(m.user_id, c.metric, c.sport, c.starts_on, c.ends_on) : 0;
    return { membership_id: p.membership_id, user: userOfM(p.membership_id), value, pct: c.goal ? Math.min(100, Math.round((value / c.goal) * 100)) : null, joined_at: p.joined_at };
  }).sort((a, b) => b.value - a.value).map((x, i) => ({ rank: i + 1, ...x }));
  const out = (c, viewer, withBoard = false) => {
    const b = board(c);
    const me = b.find((x) => x.membership_id === viewer.id) || null;
    return { ...c, goal: c.goal == null ? null : Number(c.goal), status: status(c), participants_count: b.length, joined: !!me, my_progress: me, ...(withBoard && { leaderboard: b }) };
  };
  const own = (ctx) => h.db.challenges.find((c) => c.id === ctx.params.id && c.club_id === ctx.params.club_id && !c.archived_at) || h.fail(404, "challenge.not_found", "Desafio não encontrado", "Ele pode ter sido encerrado.");
  const validate = (b, partial) => {
    const e = [];
    if ((!partial || "name" in b) && !String(b.name || "").trim()) e.push({ field: "name", message: "Dê um nome ao desafio." });
    if ((!partial || "metric" in b) && !METRICS.includes(b.metric)) e.push({ field: "metric", message: "Escolha o que conta no desafio." });
    if ("sport" in b && b.sport !== null && !SPORTS.includes(b.sport)) e.push({ field: "sport", message: "Modalidade inválida." });
    if ("goal" in b && b.goal !== null && !(Number(b.goal) > 0)) e.push({ field: "goal", message: "A meta precisa ser maior que zero." });
    if ((!partial || "starts_on" in b) && !/^\d{4}-\d{2}-\d{2}$/.test(b.starts_on || "")) e.push({ field: "starts_on", message: "Informe o início." });
    if ((!partial || "ends_on" in b) && !/^\d{4}-\d{2}-\d{2}$/.test(b.ends_on || "")) e.push({ field: "ends_on", message: "Informe o fim." });
    if (b.starts_on && b.ends_on && b.ends_on < b.starts_on) e.push({ field: "ends_on", message: "O fim precisa ser depois do início." });
    if (e.length) h.invalid(e);
  };
  const FIELDS = ["name", "description", "metric", "sport", "goal", "starts_on", "ends_on", "group_ids"];

  h.get("/v1/clubs/:club_id/challenges", (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const order = { active: 0, upcoming: 1, finished: 2 };
    const items = h.db.challenges.filter((c) => c.club_id === me.club_id && !c.archived_at && visible(c, me)).map((c) => out(c, me))
      .sort((a, b) => order[a.status] - order[b.status] || (a.status === "finished" ? b.ends_on.localeCompare(a.ends_on) : a.starts_on.localeCompare(b.starts_on)));
    return { items, next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/challenges", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    validate(ctx.body, false);
    const c = { id: h.uuid("ch"), club_id: me.club_id, description: null, sport: null, goal: null, group_ids: [], created_by: me.id, created_at: h.nowIso(), archived_at: null };
    for (const k of FIELDS) if (k in ctx.body) c[k] = ctx.body[k] === "" ? null : ctx.body[k];
    c.name = c.name.trim(); if (c.goal != null) c.goal = Number(c.goal);
    h.db.challenges.push(c);
    return { __status: 201, data: out(c, me) };
  });
  h.get("/v1/clubs/:club_id/challenges/:id", (ctx) => { const me = ctx.member(ctx.params.club_id); const c = own(ctx); if (!visible(c, me)) h.fail(404, "challenge.not_found", "Desafio não encontrado", "Ele não é para o seu grupo."); return out(c, me, true); });
  h.patch("/v1/clubs/:club_id/challenges/:id", (ctx) => {
    const me = ctx.staff(ctx.params.club_id); const c = own(ctx);
    validate({ ...c, ...ctx.body }, true);
    for (const k of FIELDS) if (k in ctx.body) c[k] = ctx.body[k] === "" ? null : ctx.body[k];
    return out(c, me);
  });
  h.delete("/v1/clubs/:club_id/challenges/:id", (ctx) => { ctx.staff(ctx.params.club_id); own(ctx).archived_at = h.nowIso(); });
  h.post("/v1/clubs/:club_id/challenges/:id/join", (ctx) => {
    const me = ctx.member(ctx.params.club_id, ["student"]); const c = own(ctx);
    if (!visible(c, me)) h.fail(403, "challenge.not_for_you", "Desafio de outro grupo", "Este desafio é só para alguns grupos do clube.");
    if (status(c) === "finished") h.fail(409, "challenge.finished", "O desafio já terminou", "Fique de olho nos próximos!");
    if (!h.db.challenge_participants.some((p) => p.challenge_id === c.id && p.membership_id === me.id)) h.db.challenge_participants.push({ challenge_id: c.id, membership_id: me.id, joined_at: h.nowIso() });
    return out(c, me, true);
  });
  h.delete("/v1/clubs/:club_id/challenges/:id/join", (ctx) => {
    const me = ctx.member(ctx.params.club_id, ["student"]); const c = own(ctx);
    h.db.challenge_participants = h.db.challenge_participants.filter((p) => !(p.challenge_id === c.id && p.membership_id === me.id));
  });

  // ---- monthly ranking (opt-in)
  h.get("/v1/clubs/:club_id/rankings", (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const month = /^\d{4}-\d{2}$/.test(ctx.query.month || "") ? ctx.query.month : h.today().slice(0, 7);
    const sport = SPORTS.includes(ctx.query.sport) ? ctx.query.sport : "run";
    const from = month + "-01", to = h.addDays(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 10), -1);
    const opted = new Set(h.db.ranking_opt_ins.map((o) => o.membership_id));
    const items = h.db.memberships.filter((m) => m.club_id === me.club_id && m.role === "student" && m.status === "active" && opted.has(m.id))
      .map((m) => ({ membership_id: m.id, user: userOfM(m.id), value: measure(m.user_id, "distance", sport, from, to) }))
      .filter((x) => x.value > 0).sort((a, b) => b.value - a.value).map((x, i) => ({ rank: i + 1, ...x }));
    return { month, sport, items, me: { opted_in: opted.has(me.id), rank: items.find((x) => x.membership_id === me.id)?.rank ?? null } };
  });
  h.put("/v1/clubs/:club_id/my/ranking", (ctx) => {
    const me = ctx.member(ctx.params.club_id, ["student"]);
    h.db.ranking_opt_ins = h.db.ranking_opt_ins.filter((o) => o.membership_id !== me.id);
    if (ctx.body.opted_in) h.db.ranking_opt_ins.push({ membership_id: me.id, opted_in_at: h.nowIso() });
    return { opted_in: !!ctx.body.opted_in };
  });

  // ---- badges (earned on read; a backend job does this nightly)
  const award = (m, key, kind, title, when) => {
    if (h.db.badges.some((b) => b.membership_id === m.id && b.key === key)) return;
    h.db.badges.push({ id: h.uuid("badge"), membership_id: m.id, key, kind, title, earned_at: when || h.nowIso() });
  };
  const streakWeeks = (m) => {
    const monday = h.mondayOf(h.today());
    const done = (p) => ["completed", "partial"].includes(h.db.workout_completions.find((c) => c.planned_workout_id === p.id)?.status);
    const all = h.db.planned_workouts.filter((p) => p.athlete_membership_id === m.id);
    let n = 0;
    for (let w = 1; w < 52; w++) { const mon = h.addDays(monday, -7 * w); const ws = all.filter((p) => p.date >= mon && p.date <= h.addDays(mon, 6)); if (ws.length && ws.some(done)) n++; else break; }
    return n;
  };
  const evaluate = (m) => {
    const streak = streakWeeks(m);
    for (const n of [4, 8, 12, 26]) if (streak >= n) award(m, `streak-${n}`, "streak", `${n} semanas seguidas treinando`);
    for (let i = 1; i <= 6; i++) {
      const d = new Date(Date.UTC(+h.today().slice(0, 4), +h.today().slice(5, 7) - 1 - i, 1));
      const from = d.toISOString().slice(0, 10), to = h.addDays(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10), -1);
      if (measure(m.user_id, "distance", "run", from, to) >= 100) award(m, `month-100-${from.slice(0, 7)}`, "distance_month", `100 km correndo em ${MONTHS[d.getUTCMonth()]}`, `${to}T23:00:00.000Z`);
    }
    for (const p of h.db.challenge_participants.filter((x) => x.membership_id === m.id)) {
      const c = h.db.challenges.find((x) => x.id === p.challenge_id && !x.archived_at);
      if (c?.goal && measure(m.user_id, c.metric, c.sport, c.starts_on, c.ends_on) >= c.goal) award(m, `challenge-${c.id}`, "challenge", `Desafio concluído: ${c.name}`);
    }
    for (const e of h.db.race_entries.filter((x) => x.membership_id === m.id && x.status === "finished")) {
      const r = h.db.races.find((x) => x.id === e.race_id);
      if (r) award(m, `race-${e.id}`, "race", `Completou ${r.name}`, `${r.date}T15:00:00.000Z`);
    }
    return streak;
  };
  h.get("/v1/clubs/:club_id/my/badges", (ctx) => {
    const me = ctx.member(ctx.params.club_id, ["student"]);
    const streak = evaluate(me);
    return { items: h.db.badges.filter((b) => b.membership_id === me.id).sort((a, b) => b.earned_at.localeCompare(a.earned_at)), streak_weeks: streak };
  });
}
