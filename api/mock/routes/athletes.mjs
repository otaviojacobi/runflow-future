/** Athlete profiles: the student's own (/my/profile) and, from F6/F11, the trainer views. */
const GOALS = ["health", "5k", "10k", "21k", "42k", "trail", "triathlon", "swim", "strength", "other"];
const LEVELS = ["beginner", "intermediate", "advanced"];

export default function register(h) {
  const emptyProfile = (membershipId) => ({ membership_id: membershipId, goal: null, goal_date: null, level: null, weekly_sessions: null, max_hr: null, resting_hr: null, threshold_pace_s_per_km: null, css_s_per_100m: null, ftp_w: null, recent_race: null, trainer_notes: null, updated_at: h.nowIso() });
  const profileOf = (membershipId) => h.db.athlete_profiles.find((p) => p.membership_id === membershipId);
  const publicProfile = (p) => { if (!p) return null; const { trainer_notes, ...rest } = p; void trainer_notes; return rest; };

  /** Validates and applies profile fields; `trainer` may also set physiology + notes. */
  function applyProfile(p, b, trainer) {
    const errors = [];
    if ("goal" in b && b.goal !== null && !GOALS.includes(b.goal)) errors.push({ field: "goal", message: "Escolha um objetivo." });
    if ("level" in b && b.level !== null && !LEVELS.includes(b.level)) errors.push({ field: "level", message: "Escolha o nível." });
    if ("weekly_sessions" in b && b.weekly_sessions !== null && !(b.weekly_sessions >= 0 && b.weekly_sessions <= 14)) errors.push({ field: "weekly_sessions", message: "Entre 0 e 14 treinos por semana." });
    if ("goal_date" in b && b.goal_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.goal_date)) errors.push({ field: "goal_date", message: "Data inválida." });
    if ("recent_race" in b && b.recent_race && !(b.recent_race.distance_m > 0 && b.recent_race.time_s > 0)) errors.push({ field: "recent_race", message: "Informe a distância e o tempo." });
    if (errors.length) h.invalid(errors);
    const fields = ["goal", "goal_date", "level", "weekly_sessions", "recent_race", "max_hr", "resting_hr"];
    if (trainer) fields.push("threshold_pace_s_per_km", "css_s_per_100m", "ftp_w", "trainer_notes");
    for (const k of fields) if (k in b) p[k] = b[k] === "" ? null : b[k];
    // A recent race lets us estimate the threshold pace (≈ 10 km pace) when none is set.
    if (b.recent_race && !p.threshold_pace_s_per_km) {
      const { distance_m, time_s } = b.recent_race;
      const tenK = time_s * Math.pow(10000 / distance_m, 1.06); // Riegel
      p.threshold_pace_s_per_km = Math.round((tenK / 10) * 1.0);
    }
    p.updated_at = h.nowIso();
    return p;
  }

  h.get("/v1/clubs/:club_id/my/profile", (ctx) => {
    const m = ctx.member(ctx.params.club_id, ["student"]);
    return publicProfile(profileOf(m.id) || emptyProfile(m.id));
  });
  h.put("/v1/clubs/:club_id/my/profile", (ctx) => {
    const m = ctx.member(ctx.params.club_id, ["student"]);
    let p = profileOf(m.id);
    if (!p) { p = emptyProfile(m.id); h.db.athlete_profiles.push(p); }
    return publicProfile(applyProfile(p, ctx.body, false));
  });
  h.applyProfile = applyProfile; // shared with trainer routes (F11)
  h.emptyProfile = emptyProfile;
}
