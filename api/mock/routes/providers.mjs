/** Provider connections (Strava now, Garmin later). Mock OAuth: start → in-app consent → callback imports sample activities. */
export default function register(h) {
  const conn = (userId, provider) => h.db.provider_connections.find((c) => c.user_id === userId && c.provider === provider);
  const out = (c) => c && { id: c.id, provider: c.provider, athlete_name: c.athlete_name, status: c.status, connected_at: c.connected_at, last_sync_at: c.last_sync_at };

  h.get("/v1/me/connections", (ctx) => {
    const u = ctx.user();
    return {
      items: ["strava", "garmin"].map((provider) => {
        const c = conn(u.id, provider);
        return { provider, available: provider === "strava", connection: c && c.status !== "revoked" ? out(c) : null };
      }),
    };
  });
  h.post("/v1/me/connections/strava/start", (ctx) => {
    ctx.user();
    const client = ctx.body?.client ?? "web";
    if (!["web", "app"].includes(client)) h.invalid([{ field: "client", message: "Cliente inválido." }]);
    const state = h.uuid("oauth").slice(0, 8);
    const redirect_uri = client === "app" ? "runflow://localhost/connect/strava" : "/connect/strava";
    return { authorize_url: `/dev/strava/autorizar?state=${state}`, state, redirect_uri };
  });
  h.post("/v1/me/connections/strava/callback", (ctx) => {
    const u = ctx.user();
    if (!ctx.body.code) h.fail(400, "strava.denied", "Conexão cancelada", "Você não autorizou o acesso no Strava.");
    const now = h.nowIso();
    let c = conn(u.id, "strava");
    if (!c) { c = { id: h.uuid("conn"), user_id: u.id, provider: "strava", external_user_id: String(10000000 + Math.floor(Math.random() * 8e7)), athlete_name: u.name, access_token_enc: null, refresh_token_enc: null, scopes: ["read", "activity:read_all"], token_expires_at: null, status: "active", connected_at: now, last_sync_at: now }; h.db.provider_connections.push(c); }
    else Object.assign(c, { status: "active", connected_at: now, last_sync_at: now });
    // Import a few recent runs (what the first Strava sync would bring).
    if (!h.db.activities.some((a) => a.user_id === u.id && a.source === "strava")) {
      const runs = [[1, 6100, 2040, "Rodagem leve"], [3, 8200, 2620, "Corrida no parque"], [5, 5000, 1390, "Treino de ritmo"], [8, 12100, 4180, "Longão de domingo"], [10, 6000, 2010, "Rodagem leve"]];
      for (const [daysAgo, m, s, name] of runs) {
        const started = new Date(Date.parse(h.addDays(h.today(), -daysAgo) + "T09:20:00Z")).toISOString();
        const pace = Math.round(s / (m / 1000));
        h.db.activities.push({ id: h.uuid("act"), user_id: u.id, source: "strava", external_id: String(Math.floor(1e10 + Math.random() * 9e9)), sport: "run", name, started_at: started, duration_s: s, moving_time_s: Math.round(s * 0.97), distance_m: m, elevation_gain_m: 20 + Math.floor(Math.random() * 60), avg_hr: 140 + Math.floor(Math.random() * 20), max_hr: 172 + Math.floor(Math.random() * 12), avg_pace_s_per_km: pace, avg_power_w: null, calories: Math.round(s / 60 * 10), laps: Array.from({ length: Math.floor(m / 1000) }, () => ({ distance_m: 1000, duration_s: pace + Math.floor(Math.random() * 20 - 10), avg_hr: 140 + Math.floor(Math.random() * 25) })), polyline: null, match_state: "open", created_at: now });
      }
      // Matched to the plan like any import (D-049).
      h.rematch(u.id, h.addDays(h.today(), -10), h.today());
    }
    return out(c);
  });
  h.delete("/v1/me/connections/:provider", (ctx) => {
    const u = ctx.user();
    const c = conn(u.id, ctx.params.provider);
    if (!c || c.status === "revoked") h.fail(404, "connection.not_found", "Conexão não encontrada", "Ela já foi desfeita.");
    c.status = "revoked";
    // §5: disconnecting deletes the raw data synced from that provider (student inputs stay).
    const gone = new Set(h.db.activities.filter((a) => a.user_id === u.id && a.source === ctx.params.provider).map((a) => a.id));
    h.db.activities = h.db.activities.filter((a) => !gone.has(a.id));
    h.db.activity_match_options = h.db.activity_match_options.filter((o) => !gone.has(o.activity_id));
    for (const wc of h.db.workout_completions) if (gone.has(wc.activity_id)) wc.activity_id = null;
    h.rematch(u.id, h.addDays(h.today(), -30), h.today());
    for (const cs of h.db.consents) if (cs.user_id === u.id && cs.kind === `share_${ctx.params.provider}` && !cs.revoked_at) cs.revoked_at = h.nowIso();
  });
}
