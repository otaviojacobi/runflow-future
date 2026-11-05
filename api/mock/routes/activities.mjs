/** Activities: the student's own (/me/activities) and the trainer's consent-aware views; athlete detail, profile, zones.
 *  Matching (D-049, docs/activity-matching.md): h.rematch runs the engine (lib/matching.mjs) around changed days. */
import { compatible, compliance, days, RULES, solve } from "../lib/matching.mjs";
import { analysisOf } from "../lib/analysis.mjs";

const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];
const ZF_PACE = [1.3, 1.17, 1.08, 1.0, 0.94];
const ZF_HR = [0.6, 0.7, 0.8, 0.9, 1.0];

export default function register(h) {
  // ---- matching (D-049)
  /** The club-time day of an activity (the mock runs on São Paulo time, like h.today()). */
  const dayOf = (iso) => new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(0, 10);
  h.activityDay = dayOf;
  const compOf = (pwId) => h.db.workout_completions.find((c) => c.planned_workout_id === pwId);
  const compOfAct = (actId) => h.db.workout_completions.find((c) => c.activity_id === actId);
  /** The student's active memberships (workouts from every club they train with). */
  const studentOf = (userId) => new Set(h.db.memberships.filter((m) => m.user_id === userId && m.role === "student" && m.status === "active").map((m) => m.id));
  const summary = (p) => ({ id: p.id, title: p.title, date: p.date, club_id: p.club_id, sport: p.sport, est_distance_m: p.est_distance_m, est_duration_s: p.est_duration_s });
  const clearOptions = (actId) => { h.db.activity_match_options = h.db.activity_match_options.filter((o) => o.activity_id !== actId); };

  /** Takes the activity off a completion: a completion that only existed because of the match goes away. */
  const unlink = (c) => {
    if (!c.reported_at) h.db.workout_completions = h.db.workout_completions.filter((x) => x !== c);
    else Object.assign(c, { activity_id: null, matched_by: null, updated_at: h.nowIso() });
  };
  /** Links an activity to a workout: the student's completion keeps their answers, else one is made from the match. */
  const link = (a, p, by) => {
    const pct = compliance(a, p), now = h.nowIso();
    const c = compOf(p.id);
    const status = pct >= RULES.completedPct ? "completed" : "partial";
    if (!c) {
      const end = new Date(Date.parse(a.started_at) + a.duration_s * 1000).toISOString();
      h.db.workout_completions.push({ planned_workout_id: p.id, activity_id: a.id, status, compliance_pct: pct, rpe: null, feeling: null, comment: null, matched_by: by, reported_at: null, completed_at: end, updated_at: now });
    } else Object.assign(c, { activity_id: a.id, matched_by: by, compliance_pct: pct, updated_at: now, ...(["missed", "skipped"].includes(c.status) && { status }) });
  };

  h.unlinkCompletion = unlink;
  h.clearMatchOptions = clearOptions;

  // ---- sharing (§5, D-011): what a club's staff may see of a student's activities
  const consented = (userId, clubId, kind) => h.db.consents.some((c) => c.user_id === userId && c.club_id === clubId && c.kind === kind && !c.revoked_at);
  const SYNCED = ["strava", "garmin"];
  /** Staff of `clubId` may see an activity of `source`: training data shared and, if synced, that provider too. */
  h.staffSees = (userId, clubId, source) => consented(userId, clubId, "share_training_data") && (!SYNCED.includes(source) || consented(userId, clubId, `share_${source}`));
  /** The clubs an activity of `source` may complete workouts of (the engine's `clubs`). */
  h.sharedClubs = (userId, source) => [...new Set(h.db.memberships.filter((m) => m.user_id === userId).map((m) => m.club_id))].filter((c) => h.staffSees(userId, c, source));

  /** Re-runs the engine for one student around the days [from, to] (docs/activity-matching.md § When it runs). */
  h.rematch = (userId, from, to = from) => {
    // Automatic completions whose activity is gone.
    for (const c of [...h.db.workout_completions]) if (c.matched_by && !c.activity_id) unlink(c);
    const lo = h.addDays(from, -RULES.maxDays), hi = h.addDays(to, RULES.maxDays);
    const mids = studentOf(userId);
    const acts = h.db.activities.filter((a) => a.user_id === userId && a.match_state !== "dismissed" && dayOf(a.started_at) >= lo && dayOf(a.started_at) <= hi && compOfAct(a.id)?.matched_by !== "student");
    const inScope = new Set(acts.map((a) => a.id));
    const works = h.db.planned_workouts.filter((p) => {
      if (!mids.has(p.athlete_membership_id) || p.date < h.addDays(lo, -RULES.maxDays) || p.date > h.addDays(hi, RULES.maxDays) || !h.visible(p)) return false;
      const c = compOf(p.id);
      if (!c) return true;
      if (c.status === "missed" || c.status === "skipped") return false;
      return !c.activity_id || (c.matched_by === "auto" && inScope.has(c.activity_id));
    });
    // Each activity only to the clubs the student shares it with (D-011).
    const { links, pending } = solve({ today: h.today(), activities: acts.map((a) => ({ ...a, day: dayOf(a.started_at), clubs: h.sharedClubs(userId, a.source) })), workouts: works });
    const want = new Map(links.map((l) => [l.activity_id, l.workout_id]));
    for (const a of acts) {
      const c = compOfAct(a.id);
      if (c && want.get(a.id) !== c.planned_workout_id) unlink(c);
    }
    for (const l of links) {
      const a = acts.find((x) => x.id === l.activity_id), c = compOf(l.workout_id);
      if (c?.activity_id === a.id) c.compliance_pct = l.compliance_pct;
      else link(a, works.find((p) => p.id === l.workout_id), "auto");
    }
    for (const a of acts) {
      clearOptions(a.id);
      const q = pending.find((x) => x.activity_id === a.id);
      a.match_state = q ? "pending" : "open";
      if (q) q.options.forEach((id, rank) => h.db.activity_match_options.push({ activity_id: a.id, planned_workout_id: id, rank }));
    }
  };
  /** After planned workouts change: rematch their students around the dates that can already have activities. */
  h.rematchWorkouts = (rows) => {
    const limit = h.addDays(h.today(), RULES.maxDays);
    for (const p of rows) {
      if (p.date > limit) continue;
      const m = h.db.memberships.find((x) => x.id === p.athlete_membership_id);
      if (m) h.rematch(m.user_id, p.date);
    }
  };

  const matched = (actId) => {
    const c = compOfAct(actId);
    const p = c && h.db.planned_workouts.find((x) => x.id === c.planned_workout_id);
    return p ? { id: p.id, title: p.title, date: p.date, club_id: p.club_id, compliance_pct: c.compliance_pct, est_distance_m: p.est_distance_m, est_duration_s: p.est_duration_s, matched_by: c.matched_by } : null;
  };
  /** A pending activity's options, best first. The detail (`all`) otherwise lists what the student could pick. */
  const options = (a, all) => {
    if (a.match_state === "pending") return h.db.activity_match_options.filter((o) => o.activity_id === a.id).sort((x, y) => x.rank - y.rank).map((o) => h.db.planned_workouts.find((p) => p.id === o.planned_workout_id)).filter(Boolean).map(summary);
    if (!all) return [];
    const day = dayOf(a.started_at), mids = studentOf(a.user_id);
    return h.db.planned_workouts
      .filter((p) => mids.has(p.athlete_membership_id) && h.visible(p) && compatible(a.sport, p.sport) && Math.abs(days(p.date, day)) <= 3 && !(compOf(p.id)?.matched_by === "student" && compOf(p.id).activity_id !== a.id))
      .sort((x, y) => Math.abs(days(x.date, day)) - Math.abs(days(y.date, day)) || x.date.localeCompare(y.date) || x.position - y.position)
      .map(summary);
  };
  const out = (a, all = false) => ({ ...a, matched_workout: matched(a.id), match_options: options(a, all) });

  h.get("/v1/me/activities", (ctx) => {
    const u = ctx.user();
    const { from, to } = ctx.query;
    const pendingOnly = ctx.query.match === "pending";
    const since = h.addDays(h.today(), -RULES.askDays);
    const items = h.db.activities
      .filter((a) => a.user_id === u.id && (!from || dayOf(a.started_at) >= from) && (!to || dayOf(a.started_at) <= to) && (!pendingOnly || (a.match_state === "pending" && dayOf(a.started_at) >= since)))
      .sort((a, b) => b.started_at.localeCompare(a.started_at)).map((a) => out(a));
    return h.list(items, ctx, 100);
  });
  h.get("/v1/me/activities/:id", (ctx) => {
    const a = h.db.activities.find((x) => x.id === ctx.params.id && x.user_id === ctx.user().id);
    if (!a) h.fail(404, "activity.not_found", "Atividade não encontrada", "Ela pode ter sido removida.");
    return { ...out(a, true), analysis: analysisOf(a) };
  });
  h.put("/v1/me/activities/:id/match", (ctx) => {
    const u = ctx.user();
    const a = h.db.activities.find((x) => x.id === ctx.params.id && x.user_id === u.id);
    if (!a) h.fail(404, "activity.not_found", "Atividade não encontrada", "Ela pode ter sido removida.");
    const id = ctx.body?.planned_workout_id ?? null;
    const day = dayOf(a.started_at);
    let p = null;
    if (id !== null) {
      const mids = studentOf(u.id);
      p = h.db.planned_workouts.find((x) => x.id === id && mids.has(x.athlete_membership_id) && h.visible(x));
      if (!p || Math.abs(days(p.date, day)) > 7) h.invalid([{ field: "planned_workout_id", message: "Escolha um treino seu de até 7 dias antes ou depois da atividade." }]);
    }
    const cur = compOfAct(a.id);
    if (cur && cur.planned_workout_id !== p?.id) unlink(cur);
    clearOptions(a.id);
    const dates = [day];
    if (p) {
      const other = compOf(p.id)?.activity_id;
      const freed = other && other !== a.id ? h.db.activities.find((x) => x.id === other) : null;
      if (freed) { freed.match_state = "open"; dates.push(dayOf(freed.started_at)); }
      link(a, p, "student");
      a.match_state = "open";
      dates.push(p.date);
    } else a.match_state = "dismissed";
    if (cur) dates.push(h.db.planned_workouts.find((x) => x.id === cur.planned_workout_id)?.date ?? day);
    for (const d of dates) h.rematch(u.id, d);
    return out(a, true);
  });
  h.post("/v1/me/activities", (ctx) => {
    const u = ctx.user();
    const b = ctx.body, errors = [];
    if (!SPORTS.includes(b.sport)) errors.push({ field: "sport", message: "Escolha a modalidade." });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(b.started_at || "")) errors.push({ field: "started_at", message: "Informe a data e a hora." });
    if (!(b.duration_s > 0)) errors.push({ field: "duration_s", message: "Informe a duração." });
    if (b.distance_m != null && !(b.distance_m > 0)) errors.push({ field: "distance_m", message: "Distância inválida." });
    if (errors.length) h.invalid(errors);
    const a = { id: h.uuid("act"), user_id: u.id, source: "manual", external_id: null, sport: b.sport, name: (b.name || "").trim() || "Atividade", started_at: new Date(b.started_at).toISOString(), duration_s: b.duration_s, moving_time_s: b.duration_s, distance_m: b.distance_m ?? null, elevation_gain_m: null, avg_hr: b.avg_hr ?? null, max_hr: null, avg_pace_s_per_km: b.sport === "run" && b.distance_m ? Math.round(b.duration_s / (b.distance_m / 1000)) : null, avg_power_w: null, calories: null, laps: null, splits: null, polyline: null, route_polyline: null, match_state: "open", created_at: h.nowIso() };
    h.db.activities.push(a);
    h.rematch(u.id, dayOf(a.started_at));
    return { __status: 201, data: out(a, true) };
  });
  h.delete("/v1/me/activities/:id", (ctx) => {
    const a = h.db.activities.find((x) => x.id === ctx.params.id && x.user_id === ctx.user().id);
    if (!a) h.fail(404, "activity.not_found", "Atividade não encontrada", "Ela pode ter sido removida.");
    if (a.source !== "manual") h.fail(409, "activity.synced", "Atividade sincronizada", "Para remover, apague no app de origem (Strava).");
    h.db.activities = h.db.activities.filter((x) => x.id !== a.id);
    clearOptions(a.id);
    for (const c of h.db.workout_completions) if (c.activity_id === a.id) c.activity_id = null;
    h.rematch(a.user_id, dayOf(a.started_at));
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
      zones: zonesOut(m), consents: consents(m), weekly, recent_activities: acts.slice(0, 10).map((a) => out(a)),
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
    return h.list(visibleActs(m).map((a) => out(a)), ctx, 50);
  });
}
