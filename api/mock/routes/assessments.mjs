/** Assessments and tests (F23): body measurements and field tests; a test can create zones and update the profile. */
import { KINDS, compute, zonesFrom } from "../lib/assessments.mjs";

export default function register(h) {
  const userOfM = (mid) => { const m = h.db.memberships.find((x) => x.id === mid); return m ? h.publicUser(h.db.users.find((u) => u.id === m.user_id)) : null; };
  const out = (a) => ({ ...a, athlete: { membership_id: a.membership_id, user: userOfM(a.membership_id) }, zones: a.zones_id ? h.db.zones.find((z) => z.id === a.zones_id) ?? null : null });
  const list = (clubId, f) => h.db.assessments.filter((a) => a.club_id === clubId && (!f.membership_id || a.membership_id === f.membership_id) && (!f.kind || a.kind === f.kind)).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

  h.get("/v1/clubs/:club_id/assessments", (ctx) => {
    ctx.staff(ctx.params.club_id);
    return { items: list(ctx.params.club_id, ctx.query).map(out), next_cursor: null };
  });
  h.get("/v1/clubs/:club_id/my/assessments", (ctx) => {
    const m = ctx.member(ctx.params.club_id, ["student"]);
    return { items: list(ctx.params.club_id, { membership_id: m.id }).map(out), next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/assessments", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const b = ctx.body;
    const m = h.db.memberships.find((x) => x.id === b.membership_id && x.club_id === me.club_id && x.role === "student" && x.status === "active");
    const errors = [];
    if (!m) errors.push({ field: "membership_id", message: "Escolha o aluno." });
    if (!KINDS.includes(b.kind)) errors.push({ field: "kind", message: "Escolha o tipo de avaliação." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "") || b.date > h.today()) errors.push({ field: "date", message: "Informe a data (hoje ou antes)." });
    const data = b.data && typeof b.data === "object" ? b.data : {};
    const { result, errors: dataErrors } = KINDS.includes(b.kind) ? compute(b.kind, data) : { result: {}, errors: [] };
    if (errors.length || dataErrors.length) h.invalid([...errors, ...dataErrors]);
    const a = { id: h.uuid("as"), club_id: me.club_id, membership_id: m.id, kind: b.kind, date: b.date, data, result, notes: b.notes || null, zones_id: null, created_by: me.id, created_at: h.nowIso() };
    // Apply: new zones from the test (dated the test day) and the matching profile field.
    const z = b.apply_zones ? zonesFrom(b.kind, result) : null;
    if (z) {
      const row = { id: h.uuid("zones"), membership_id: m.id, kind: z.kind, source: "test", bounds: z.bounds, valid_from: b.date, created_by: me.id, created_at: h.nowIso() };
      h.db.zones.push(row);
      a.zones_id = row.id;
      let p = h.db.athlete_profiles.find((x) => x.membership_id === m.id);
      if (!p) { p = h.emptyProfile(m.id); h.db.athlete_profiles.push(p); }
      if (result.threshold_pace_s_per_km) p.threshold_pace_s_per_km = result.threshold_pace_s_per_km;
      if (result.css_s_per_100m) p.css_s_per_100m = Math.round(result.css_s_per_100m);
      if (result.ftp_w) p.ftp_w = result.ftp_w;
      if (result.max_hr) p.max_hr = result.max_hr;
      p.updated_at = h.nowIso();
    }
    if (b.kind === "body" && data.resting_hr) { const p = h.db.athlete_profiles.find((x) => x.membership_id === m.id); if (p) p.resting_hr = data.resting_hr; }
    h.db.assessments.push(a);
    return { __status: 201, data: out(a) };
  });
  h.delete("/v1/clubs/:club_id/assessments/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const i = h.db.assessments.findIndex((a) => a.id === ctx.params.id && a.club_id === ctx.params.club_id);
    if (i < 0) h.fail(404, "assessment.not_found", "Avaliação não encontrada", "Ela pode já ter sido apagada.");
    h.db.assessments.splice(i, 1); // zones created from it stay: they may already drive workouts
  });
}
