/** Activities: the student's own (/me/activities) and the trainer's consent-aware views; athlete detail, profile, zones. */
const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];
const ZF_PACE = [1.3, 1.17, 1.08, 1.0, 0.94];
const ZF_HR = [0.6, 0.7, 0.8, 0.9, 1.0];

export default function register(h) {
  const matched = (actId) => {
    const c = h.db.workout_completions.find((x) => x.activity_id === actId);
    const p = c && h.db.planned_workouts.find((x) => x.id === c.planned_workout_id);
    return p ? { id: p.id, title: p.title, date: p.date, club_id: p.club_id, compliance_pct: c.compliance_pct, est_distance_m: p.est_distance_m, est_duration_s: p.est_duration_s } : null;
  };
  const out = (a) => ({ ...a, matched_workout: matched(a.id) });

  h.get("/v1/me/activities", (ctx) => {
    const u = ctx.user();
    const { from, to } = ctx.query;
    const items = h.db.activities.filter((a) => a.user_id === u.id && (!from || a.started_at.slice(0, 10) >= from) && (!to || a.started_at.slice(0, 10) <= to)).sort((a, b) => b.started_at.localeCompare(a.started_at)).map(out);
    return h.list(items, ctx, 100);
  });
  h.get("/v1/me/activities/:id", (ctx) => {
    const a = h.db.activities.find((x) => x.id === ctx.params.id && x.user_id === ctx.user().id);
    if (!a) h.fail(404, "activity.not_found", "Atividade não encontrada", "Ela pode ter sido removida.");
    return out(a);
  });
  h.post("/v1/me/activities", (ctx) => {
    const u = ctx.user();
    const b = ctx.body, errors = [];
    if (!SPORTS.includes(b.sport)) errors.push({ field: "sport", message: "Escolha a modalidade." });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(b.started_at || "")) errors.push({ field: "started_at", message: "Informe a data e a hora." });
    if (!(b.duration_s > 0)) errors.push({ field: "duration_s", message: "Informe a duração." });
    if (b.distance_m != null && !(b.distance_m > 0)) errors.push({ field: "distance_m", message: "Distância inválida." });
    if (errors.length) h.invalid(errors);
    const a = { id: h.uuid("act"), user_id: u.id, source: "manual", external_id: null, sport: b.sport, name: (b.name || "").trim() || "Atividade", started_at: new Date(b.started_at).toISOString(), duration_s: b.duration_s, moving_time_s: b.duration_s, distance_m: b.distance_m ?? null, elevation_gain_m: null, avg_hr: b.avg_hr ?? null, max_hr: null, avg_pace_s_per_km: b.sport === "run" && b.distance_m ? Math.round(b.duration_s / (b.distance_m / 1000)) : null, avg_power_w: null, calories: null, laps: null, polyline: null, created_at: h.nowIso() };
    h.db.activities.push(a);
    return { __status: 201, data: out(a) };
  });
  h.delete("/v1/me/activities/:id", (ctx) => {
    const a = h.db.activities.find((x) => x.id === ctx.params.id && x.user_id === ctx.user().id);
    if (!a) h.fail(404, "activity.not_found", "Atividade não encontrada", "Ela pode ter sido removida.");
    if (a.source !== "manual") h.fail(409, "activity.synced", "Atividade sincronizada", "Para remover, apague no app de origem (Strava).");
    h.db.activities = h.db.activities.filter((x) => x.id !== a.id);
    for (const c of h.db.workout_completions) if (c.activity_id === a.id) c.activity_id = null;
  });

  // ---- trainer views
  const athlete = (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const m = h.db.memberships.find((x) => x.id === ctx.params.membership_id && x.club_id === ctx.params.club_id && x.role === "student");
    if (!m) h.fail(404, "athlete.not_found", "Aluno não encontrado", "Ele pode ter saído do clube.");
    return { me, m };
  };
  const consents = (m) => {
    const has = (kind) => h.db.consents.some((c) => c.user_id === m.user_id && c.club_id === m.club_id && c.kind === kind && !c.revoked_at);
    return { training_data: has("share_training_data"), strava: has("share_strava") };
  };
  const visibleActs = (m) => {
    const c = consents(m);
    if (!c.training_data) return [];
    return h.db.activities.filter((a) => a.user_id === m.user_id && (a.source !== "strava" || c.strava)).sort((a, b) => b.started_at.localeCompare(a.started_at));
  };
  const zonesOut = (m) => ["pace", "hr"].map((kind) => h.db.zones.filter((z) => z.membership_id === m.id && z.kind === kind).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]).filter(Boolean);

  h.get("/v1/clubs/:club_id/athletes/:membership_id", (ctx) => {
    const { me, m } = athlete(ctx);
    const today = h.today();
    const monday = h.mondayOf(today);
    const planned = h.db.planned_workouts.filter((p) => p.athlete_membership_id === m.id);
    const acts = visibleActs(m);
    const weekly = Array.from({ length: 12 }, (_, i) => {
      const mon = h.addDays(monday, -7 * (11 - i)), sun = h.addDays(mon, 6);
      const ps = planned.filter((p) => p.date >= mon && p.date <= sun);
      const as = acts.filter((a) => a.started_at.slice(0, 10) >= mon && a.started_at.slice(0, 10) <= sun);
      return { week_start: mon, current: mon === monday, planned_s: ps.reduce((s, p) => s + (p.est_duration_s || 0), 0), done_s: as.reduce((s, a) => s + a.duration_s, 0), distance_m: as.reduce((s, a) => s + (a.distance_m || 0), 0), sessions: as.length };
    });
    void me;
    return {
      ...h.athleteSummary(m), profile: h.db.athlete_profiles.find((p) => p.membership_id === m.id) || h.emptyProfile(m.id),
      zones: zonesOut(m), consents: consents(m), weekly, recent_activities: acts.slice(0, 10).map(out),
      groups: h.db.groups.filter((g) => h.db.group_members.some((x) => x.group_id === g.id && x.membership_id === m.id)).map((g) => ({ id: g.id, name: g.name })),
    };
  });
  h.put("/v1/clubs/:club_id/athletes/:membership_id/profile", (ctx) => {
    const { m } = athlete(ctx);
    let p = h.db.athlete_profiles.find((x) => x.membership_id === m.id);
    if (!p) { p = h.emptyProfile(m.id); h.db.athlete_profiles.push(p); }
    return h.applyProfile(p, ctx.body, true);
  });
  h.put("/v1/clubs/:club_id/athletes/:membership_id/zones", (ctx) => {
    const { me, m } = athlete(ctx);
    const b = ctx.body;
    let bounds;
    if (b.kind === "pace") {
      const thr = b.threshold_pace_s_per_km || (b.race && b.race.distance_m > 0 && b.race.time_s > 0 ? Math.round((b.race.time_s * Math.pow(10000 / b.race.distance_m, 1.06)) / 10) : null);
      if (!thr || thr < 150 || thr > 900) h.invalid([{ field: "threshold_pace_s_per_km", message: "Informe um pace de limiar entre 2:30 e 15:00 /km, ou uma prova." }]);
      bounds = ZF_PACE.map((x, i) => ({ zone: i + 1, min: Math.round(thr * (ZF_PACE[i + 1] || 0.85)), max: Math.round(thr * x) }));
      const p = h.db.athlete_profiles.find((x) => x.membership_id === m.id);
      if (p) p.threshold_pace_s_per_km = thr;
    } else if (b.kind === "hr") {
      if (!(b.max_hr >= 120 && b.max_hr <= 230)) h.invalid([{ field: "max_hr", message: "Informe uma FC máxima entre 120 e 230 bpm." }]);
      bounds = ZF_HR.map((x, i) => ({ zone: i + 1, min: Math.round(b.max_hr * (ZF_HR[i - 1] || 0.5)), max: Math.round(b.max_hr * x) }));
      const p = h.db.athlete_profiles.find((x) => x.membership_id === m.id);
      if (p) p.max_hr = b.max_hr;
    } else h.invalid([{ field: "kind", message: "Tipo de zona inválido." }]);
    const z = { id: h.uuid("zones"), membership_id: m.id, kind: b.kind, source: b.race ? "race" : b.source === "test" ? "test" : "manual", bounds, valid_from: h.today(), created_by: me.id, created_at: h.nowIso() };
    h.db.zones.push(z);
    return z;
  });
  h.get("/v1/clubs/:club_id/athletes/:membership_id/activities", (ctx) => {
    const { m } = athlete(ctx);
    return h.list(visibleActs(m).map(out), ctx, 50);
  });
}
