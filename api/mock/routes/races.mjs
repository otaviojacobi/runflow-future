/** Races and events (F21): club race calendar, entries, goal race → profile goal, results → recent race. */
const SPORTS = ["run", "trail", "swim", "bike", "triathlon", "other"];
const GOAL_BY_DISTANCE = { 5000: "5k", 10000: "10k", 21097: "21k", 42195: "42k" };

export default function register(h) {
  const own = (clubId, id) => h.db.races.find((r) => r.id === id && r.club_id === clubId && !r.archived_at) || h.fail(404, "race.not_found", "Prova não encontrada", "Ela pode ter sido removida do calendário.");
  const userOfM = (mid) => { const m = h.db.memberships.find((x) => x.id === mid); return m ? h.publicUser(h.db.users.find((u) => u.id === m.user_id)) : null; };
  const entriesOf = (raceId) => h.db.race_entries.filter((e) => e.race_id === raceId);
  const out = (r, viewer) => {
    const entries = entriesOf(r.id);
    const base = { ...r, entries_count: entries.length, my_entry: entries.find((e) => e.membership_id === viewer.id) || null };
    if (viewer.role === "student") return base;
    return { ...base, entries: entries.map((e) => ({ ...e, athlete: { membership_id: e.membership_id, user: userOfM(e.membership_id) } })).sort((a, b) => a.distance_m - b.distance_m || a.athlete.user.name.localeCompare(b.athlete.user.name)) };
  };
  const validate = (b, partial) => {
    const e = [];
    if ((!partial || "name" in b) && !String(b.name || "").trim()) e.push({ field: "name", message: "Dê um nome à prova." });
    if ((!partial || "date" in b) && !/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) e.push({ field: "date", message: "Informe a data." });
    if ((!partial || "distances_m" in b) && !(Array.isArray(b.distances_m) && b.distances_m.length && b.distances_m.every((d) => Number.isInteger(d) && d > 0))) e.push({ field: "distances_m", message: "Escolha pelo menos uma distância." });
    if ("sport" in b && !SPORTS.includes(b.sport)) e.push({ field: "sport", message: "Modalidade inválida." });
    if ("start_time" in b && b.start_time && !/^\d{2}:\d{2}$/.test(b.start_time)) e.push({ field: "start_time", message: "Horário inválido." });
    if (e.length) h.invalid(e);
  };
  const FIELDS = ["name", "sport", "date", "start_time", "city", "state", "url", "distances_m", "notes"];

  /** The "A race" sets the profile goal and date (used by planning/plans); only one per student at a time. */
  const applyGoal = (entry, race) => {
    for (const x of h.db.race_entries) if (x.membership_id === entry.membership_id && x.id !== entry.id && x.is_goal) x.is_goal = false;
    let p = h.db.athlete_profiles.find((x) => x.membership_id === entry.membership_id);
    if (!p) { p = h.emptyProfile(entry.membership_id); h.db.athlete_profiles.push(p); }
    p.goal_date = race.date;
    p.goal = race.sport === "run" ? GOAL_BY_DISTANCE[entry.distance_m] ?? p.goal : race.sport === "swim" ? "swim" : race.sport === "trail" ? "trail" : race.sport === "triathlon" ? "triathlon" : p.goal;
    p.updated_at = h.nowIso();
  };
  /** A finished run result becomes the profile's recent race (the trainer can recalculate zones from it). */
  const applyResult = (entry, race) => {
    if (entry.status !== "finished" || !entry.result_time_s || race.sport !== "run") return;
    let p = h.db.athlete_profiles.find((x) => x.membership_id === entry.membership_id);
    if (!p) { p = h.emptyProfile(entry.membership_id); h.db.athlete_profiles.push(p); }
    if (!p.recent_race?.date || p.recent_race.date <= race.date) { p.recent_race = { distance_m: entry.distance_m, time_s: entry.result_time_s, date: race.date }; p.updated_at = h.nowIso(); }
  };
  const validateEntry = (b, race) => {
    const e = [];
    if ("distance_m" in b && !race.distances_m.includes(Number(b.distance_m))) e.push({ field: "distance_m", message: "Escolha uma das distâncias da prova." });
    if ("goal_time_s" in b && b.goal_time_s !== null && !(b.goal_time_s > 0)) e.push({ field: "goal_time_s", message: "Tempo inválido." });
    if ("status" in b && !["registered", "finished", "dns", "dnf"].includes(b.status)) e.push({ field: "status", message: "Situação inválida." });
    if ("result_time_s" in b && b.result_time_s !== null && !(b.result_time_s > 0)) e.push({ field: "result_time_s", message: "Tempo inválido." });
    if (b.status === "finished" && !(b.result_time_s > 0)) e.push({ field: "result_time_s", message: "Informe o tempo de prova." });
    if (e.length) h.invalid(e);
  };

  h.get("/v1/clubs/:club_id/races", (ctx) => {
    const m = ctx.member(ctx.params.club_id);
    const { from, to } = ctx.query;
    const items = h.db.races.filter((r) => r.club_id === ctx.params.club_id && !r.archived_at && (!from || r.date >= from) && (!to || r.date <= to)).sort((a, b) => a.date.localeCompare(b.date));
    return { items: items.map((r) => out(r, m)), next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/races", (ctx) => {
    const m = ctx.staff(ctx.params.club_id);
    validate(ctx.body, false);
    const r = { id: h.uuid("race"), club_id: ctx.params.club_id, sport: "run", start_time: null, city: null, state: null, url: null, notes: null, created_by: m.id, created_at: h.nowIso(), archived_at: null };
    for (const k of FIELDS) if (k in ctx.body) r[k] = ctx.body[k] === "" ? null : ctx.body[k];
    r.name = r.name.trim(); r.distances_m = [...new Set(r.distances_m.map(Number))].sort((a, b) => a - b);
    h.db.races.push(r);
    return { __status: 201, data: out(r, m) };
  });
  h.get("/v1/clubs/:club_id/races/:id", (ctx) => { const m = ctx.member(ctx.params.club_id); return out(own(ctx.params.club_id, ctx.params.id), m); });
  h.patch("/v1/clubs/:club_id/races/:id", (ctx) => {
    const m = ctx.staff(ctx.params.club_id);
    const r = own(ctx.params.club_id, ctx.params.id);
    validate(ctx.body, true);
    if (ctx.body.distances_m && entriesOf(r.id).some((e) => !ctx.body.distances_m.includes(e.distance_m))) h.fail(409, "race.distance_in_use", "Há alunos inscritos nessa distância", "Mude a inscrição deles antes de remover a distância.");
    for (const k of FIELDS) if (k in ctx.body) r[k] = ctx.body[k] === "" ? null : ctx.body[k];
    if (ctx.body.date) for (const e of entriesOf(r.id).filter((e) => e.is_goal)) applyGoal(e, r);
    return out(r, m);
  });
  h.delete("/v1/clubs/:club_id/races/:id", (ctx) => { ctx.staff(ctx.params.club_id); own(ctx.params.club_id, ctx.params.id).archived_at = h.nowIso(); });

  h.post("/v1/clubs/:club_id/races/:id/entries", (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const r = own(ctx.params.club_id, ctx.params.id);
    const target = me.role === "student" ? me.id : ctx.body.membership_id;
    if (!target || !h.db.memberships.some((m) => m.id === target && m.club_id === r.club_id && m.role === "student" && m.status === "active")) h.invalid([{ field: "membership_id", message: "Escolha o aluno." }]);
    const b = { distance_m: Number(ctx.body.distance_m ?? r.distances_m[0]), ...("goal_time_s" in ctx.body && { goal_time_s: ctx.body.goal_time_s }), ...("is_goal" in ctx.body && { is_goal: !!ctx.body.is_goal }) };
    validateEntry(b, r);
    let e = h.db.race_entries.find((x) => x.race_id === r.id && x.membership_id === target);
    const created = !e;
    if (!e) { e = { id: h.uuid("re"), race_id: r.id, membership_id: target, distance_m: b.distance_m, goal_time_s: null, is_goal: false, status: "registered", result_time_s: null, result_position: null, created_at: h.nowIso(), updated_at: h.nowIso() }; h.db.race_entries.push(e); }
    Object.assign(e, b, { updated_at: h.nowIso() });
    if (e.is_goal) applyGoal(e, r);
    return { __status: created ? 201 : 200, data: e };
  });
  const getEntry = (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const e = h.db.race_entries.find((x) => x.id === ctx.params.id);
    const r = e && h.db.races.find((x) => x.id === e.race_id && x.club_id === ctx.params.club_id);
    if (!r || (me.role === "student" && e.membership_id !== me.id)) h.fail(404, "race_entry.not_found", "Inscrição não encontrada", "Ela pode ter sido cancelada.");
    return { e, r };
  };
  h.patch("/v1/clubs/:club_id/race-entries/:id", (ctx) => {
    const { e, r } = getEntry(ctx);
    const b = ctx.body;
    validateEntry({ ...b, ...(b.status === "finished" && !("result_time_s" in b) && { result_time_s: e.result_time_s }) }, r);
    for (const k of ["distance_m", "goal_time_s", "is_goal", "status", "result_time_s", "result_position"]) if (k in b) e[k] = k === "distance_m" ? Number(b[k]) : b[k];
    e.updated_at = h.nowIso();
    if (b.is_goal) applyGoal(e, r);
    applyResult(e, r);
    return e;
  });
  h.delete("/v1/clubs/:club_id/race-entries/:id", (ctx) => {
    const { e } = getEntry(ctx);
    h.db.race_entries.splice(h.db.race_entries.indexOf(e), 1);
  });
}
