/** Provider connections (Strava now, Garmin later). Mock OAuth: start → in-app consent → callback imports sample activities.
 *  Strava sharing (D-011, endpoints.md § Strava sharing): connecting needs a club and shares Strava with every club where
 *  the person is a student; a sync no club can see is disconnected (h.enforceStravaSharing). */
const CONSENT_TEXT_VERSION = "2026-10";

import { synthActivity } from "../lib/analysis.mjs";

export default function register(h) {
  const conn = (userId, provider) => h.db.provider_connections.find((c) => c.user_id === userId && c.provider === provider);
  const out = (c) => c && { id: c.id, provider: c.provider, athlete_name: c.athlete_name, status: c.status, connected_at: c.connected_at, last_sync_at: c.last_sync_at };
  const consented = (userId, clubId, kind) => h.db.consents.some((c) => c.user_id === userId && c.club_id === clubId && c.kind === kind && !c.revoked_at);
  /** The clubs (not closed) where the person is an active student. */
  const studentClubs = (userId) => h.db.memberships
    .filter((m) => m.user_id === userId && m.role === "student" && m.status === "active" && !h.db.clubs.find((c) => c.id === m.club_id)?.deleted_at)
    .map((m) => m.club_id);
  const needClub = (userId) => {
    if (!studentClubs(userId).length) h.fail(409, "strava.no_club", "Entre em um clube para conectar o Strava", "A conexão com o Strava existe para os seus treinadores acompanharem seus treinos. Peça o convite ao seu clube.");
  };

  /** Disconnect (§5): the connection revoked, that provider's activities deleted (student inputs stay), its sharing
   *  consents revoked, the plan matched again. Strava would also be deauthorized (real API only). */
  const disconnect = (userId, provider) => {
    const c = conn(userId, provider);
    if (!c || c.status === "revoked") return false;
    c.status = "revoked";
    const gone = new Set(h.db.activities.filter((a) => a.user_id === userId && a.source === provider).map((a) => a.id));
    h.db.activities = h.db.activities.filter((a) => !gone.has(a.id));
    h.db.activity_match_options = h.db.activity_match_options.filter((o) => !gone.has(o.activity_id));
    for (const wc of h.db.workout_completions) if (gone.has(wc.activity_id)) wc.activity_id = null;
    for (const cs of h.db.consents) if (cs.user_id === userId && cs.kind === `share_${provider}` && !cs.revoked_at) cs.revoked_at = h.nowIso();
    h.rematch(userId, h.addDays(h.today(), -30), h.today());
    return true;
  };
  /** No sync without sharing: a connected person no club can see (both sharing consents) is disconnected. */
  h.enforceStravaSharing = (userId) => {
    const visible = studentClubs(userId).some((club) => consented(userId, club, "share_training_data") && consented(userId, club, "share_strava"));
    return visible ? false : disconnect(userId, "strava");
  };

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
    const u = ctx.user();
    const client = ctx.body?.client ?? "web";
    if (!["web", "app"].includes(client)) h.invalid([{ field: "client", message: "Cliente inválido." }]);
    needClub(u.id);
    const state = h.uuid("oauth").slice(0, 8);
    const redirect_uri = client === "app" ? "runflow://localhost/connect/strava" : "/connect/strava";
    return { authorize_url: `/dev/strava/autorizar?state=${state}`, state, redirect_uri };
  });
  h.post("/v1/me/connections/strava/callback", (ctx) => {
    const u = ctx.user();
    if (!ctx.body.code) h.fail(400, "strava.denied", "Conexão cancelada", "Você não autorizou o acesso no Strava.");
    needClub(u.id);
    const now = h.nowIso();
    let c = conn(u.id, "strava");
    if (!c) { c = { id: h.uuid("conn"), user_id: u.id, provider: "strava", external_user_id: String(10000000 + Math.floor(Math.random() * 8e7)), athlete_name: u.name, access_token_enc: null, refresh_token_enc: null, scopes: ["read", "activity:read_all"], token_expires_at: null, status: "active", connected_at: now, last_sync_at: now }; h.db.provider_connections.push(c); }
    else Object.assign(c, { status: "active", connected_at: now, last_sync_at: now });
    // Connecting shares Strava with every club where the person is a student (§ Strava sharing).
    for (const club_id of studentClubs(u.id)) for (const kind of ["share_training_data", "share_strava"]) {
      if (!consented(u.id, club_id, kind)) h.db.consents.push({ id: h.uuid("consent"), user_id: u.id, club_id, kind, text_version: CONSENT_TEXT_VERSION, granted_at: now, revoked_at: null });
    }
    // Import a few recent runs (what the first Strava sync would bring).
    if (!h.db.activities.some((a) => a.user_id === u.id && a.source === "strava")) {
      const runs = [[1, 6100, 2040, "Rodagem leve"], [3, 8200, 2620, "Corrida no parque"], [5, 5000, 1390, "Treino de ritmo"], [8, 12100, 4180, "Longão de domingo"], [10, 6000, 2010, "Rodagem leve"]];
      for (const [daysAgo, m, s, name] of runs) {
        const started = new Date(Date.parse(h.addDays(h.today(), -daysAgo) + "T09:20:00Z")).toISOString();
        const pace = Math.round(s / (m / 1000));
        h.db.activities.push({ id: h.uuid("act"), user_id: u.id, source: "strava", external_id: String(Math.floor(1e10 + Math.random() * 9e9)), sport: "run", name, started_at: started, duration_s: s, moving_time_s: Math.round(s * 0.97), distance_m: m, elevation_gain_m: 20 + Math.floor(Math.random() * 60), avg_hr: 140 + Math.floor(Math.random() * 20), max_hr: 172 + Math.floor(Math.random() * 12), avg_pace_s_per_km: pace, avg_power_w: null, calories: Math.round(s / 60 * 10), laps: null, splits: null, polyline: null, route_polyline: null, match_state: "open", created_at: now });
        Object.assign(h.db.activities.at(-1), synthActivity(h.db.activities.at(-1)));
      }
    }
    // Matched to the plan like any import (D-049), now that sharing allows it.
    h.rematch(u.id, h.addDays(h.today(), -30), h.today());
    return out(c);
  });
  h.delete("/v1/me/connections/:provider", (ctx) => {
    const u = ctx.user();
    if (!disconnect(u.id, ctx.params.provider)) h.fail(404, "connection.not_found", "Conexão não encontrada", "Ela já foi desfeita.");
  });
}
