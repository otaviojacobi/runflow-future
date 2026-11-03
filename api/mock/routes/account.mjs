/** Auth, /me, prefs, consents, notifications, mock-only demo accounts. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEV_CODE = "000000";

export default function register(h) {
  const { db } = h;

  function createUser(email, name) {
    const now = h.nowIso();
    const user = { id: h.uuid("user"), email, name, avatar_url: null, phone: null, birth_date: null, sex: null, locale: "pt-BR", created_at: now, updated_at: now, deleted_at: null };
    h.db.users.push(user);
    h.db.notification_prefs.push({ user_id: user.id, kinds: {}, digest_hour: 7, quiet_start: "22:00", quiet_end: "07:00", paused: false, last_digest_on: null, updated_at: now });
    for (const kind of ["terms", "privacy"]) h.db.consents.push({ id: h.uuid("consent"), user_id: user.id, club_id: null, kind, text_version: "2026-10", granted_at: now, revoked_at: null });
    return user;
  }
  function signIn(provider, subject, email, ctx) {
    const lower = email.toLowerCase();
    let user = h.db.users.find((u) => u.email.toLowerCase() === lower && !u.deleted_at);
    let is_new = false;
    if (!user) {
      const local = lower.split("@")[0].replace(/[._-]+/g, " ");
      user = createUser(lower, local.replace(/\b\w/g, (c) => c.toUpperCase()));
      is_new = true;
    }
    if (!h.db.auth_identities.find((i) => i.provider === provider && i.subject === subject)) {
      h.db.auth_identities.push({ id: h.uuid("ident"), user_id: user.id, provider, subject, email: lower, created_at: h.nowIso() });
    }
    const token = h.token();
    const expires = new Date(Date.now() + 60 * 86400000).toISOString();
    h.db.sessions.push({ id: h.uuid("sess"), user_id: user.id, token_hash: h.sha256(token), kind: ctx.req.headers["x-client"] === "mobile" ? "mobile" : "web", user_agent: ctx.req.headers["user-agent"] || null, created_at: h.nowIso(), last_seen_at: h.nowIso(), expires_at: expires, revoked_at: null });
    return { token, user: h.publicUser(user), is_new };
  }
  function me(user) {
    const memberships = h.db.memberships
      .filter((m) => m.user_id === user.id && m.status === "active")
      .map((m) => {
        const club = h.db.clubs.find((c) => c.id === m.club_id && !c.deleted_at);
        return club && { membership: m, club, branding: h.branding(club.id), subscription: h.subscription(club.id) };
      })
      .filter(Boolean);
    return {
      user: h.publicUser(user),
      memberships,
      prefs: h.prefsOut(user.id),
      unread_notifications: h.db.notifications.filter((n) => n.user_id === user.id && !n.read_at && n.in_app !== false).length,
    };
  }

  // ---- auth
  h.post("/v1/auth/email/start", (ctx) => {
    const email = String(ctx.body.email || "").trim().toLowerCase();
    if (!EMAIL.test(email)) h.invalid([{ field: "email", message: "Digite um e-mail válido, como nome@email.com." }]);
    h.db.email_codes.push({ id: h.uuid("code"), email, code_hash: h.sha256(DEV_CODE), attempts: 0, expires_at: new Date(Date.now() + 10 * 60000).toISOString(), consumed_at: null, created_at: h.nowIso() });
    return { sent: true, expires_in_s: 600, dev_code: DEV_CODE };
  });
  h.post("/v1/auth/email/verify", (ctx) => {
    const email = String(ctx.body.email || "").trim().toLowerCase();
    const code = String(ctx.body.code || "").replace(/\D/g, "");
    const pending = h.db.email_codes.filter((c) => c.email === email && !c.consumed_at && c.expires_at > h.nowIso()).pop();
    if (!pending) h.fail(400, "auth.code_expired", "Código expirado", "Peça um novo código para continuar.");
    pending.attempts++;
    if (pending.attempts > 5) h.fail(429, "auth.too_many_attempts", "Muitas tentativas", "Peça um novo código e tente de novo.");
    if (h.sha256(code) !== pending.code_hash) h.fail(400, "auth.invalid_code", "Código incorreto", `Confira o código de 6 dígitos que enviamos para ${email}.`);
    pending.consumed_at = h.nowIso();
    return signIn("email", email, email, ctx);
  });
  h.post("/v1/auth/google", (ctx) => {
    // Mock: the "id_token" is the e-mail chosen in the fake Google account chooser.
    const email = String(ctx.body.id_token || "").trim().toLowerCase();
    if (!EMAIL.test(email)) h.fail(400, "auth.google_failed", "Não foi possível entrar com o Google", "Tente de novo ou use o código por e-mail.");
    return signIn("google", "google-" + email, email, ctx);
  });
  h.post("/v1/auth/logout", (ctx) => {
    if (ctx.auth) ctx.auth.session.revoked_at = h.nowIso();
  });

  // ---- mock-only: accounts for the fake Google chooser
  h.get("/v1/mock/accounts", () =>
    h.db.users.filter((u) => !u.deleted_at).map((u) => ({
      email: u.email, name: u.name,
      roles: h.db.memberships.filter((m) => m.user_id === u.id && m.status === "active").map((m) => ({ club: h.db.clubs.find((c) => c.id === m.club_id)?.name, role: m.role })),
    })),
  );

  // ---- me
  h.get("/v1/me", (ctx) => me(ctx.user()));
  h.patch("/v1/me", (ctx) => {
    const u = ctx.user();
    const b = ctx.body;
    const errors = [];
    if ("name" in b && !String(b.name || "").trim()) errors.push({ field: "name", message: "Informe seu nome." });
    if ("birth_date" in b && b.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.birth_date)) errors.push({ field: "birth_date", message: "Data inválida." });
    if ("sex" in b && b.sex && !["female", "male", "other"].includes(b.sex)) errors.push({ field: "sex", message: "Opção inválida." });
    if ("avatar_url" in b && b.avatar_url && !/^\/v1\/assets\/[\w:-]+$/.test(String(b.avatar_url))) errors.push({ field: "avatar_url", message: "Envie a foto pelo app." });
    if (errors.length) h.invalid(errors);
    for (const k of ["name", "phone", "birth_date", "sex", "avatar_url"]) if (k in b) u[k] = typeof b[k] === "string" ? b[k].trim() || null : b[k];
    u.updated_at = h.nowIso();
    return me(u);
  });
  h.delete("/v1/me", (ctx) => {
    const u = ctx.user();
    const now = h.nowIso();
    // Owner of a club that's still open (closing the club is one way out).
    if (h.db.memberships.some((m) => m.user_id === u.id && m.role === "owner" && m.status === "active" && !h.db.clubs.find((c) => c.id === m.club_id)?.deleted_at))
      h.fail(409, "account.owns_club", "Você ainda é gestor de um clube", "Transfira a gestão ou encerre o clube antes de excluir sua conta.");
    // LGPD: anonymize; training history stays with the clubs under the anonymized account.
    Object.assign(u, { deleted_at: now, email: `deleted+${u.id}@runflow.club`, name: "Conta excluída", phone: null, birth_date: null, sex: null, avatar_url: null });
    h.db.auth_identities = h.db.auth_identities.filter((i) => i.user_id !== u.id);
    for (const m of h.db.memberships.filter((m) => m.user_id === u.id)) Object.assign(m, { status: "left", left_at: now });
    for (const s of h.db.sessions.filter((s) => s.user_id === u.id)) s.revoked_at = now;
    for (const c of h.db.provider_connections.filter((c) => c.user_id === u.id)) c.status = "revoked";
  });
  h.get("/v1/me/export", (ctx) => {
    const u = ctx.user();
    const mine = (t, key = "user_id") => h.db[t].filter((r) => r[key] === u.id);
    const mids = h.db.memberships.filter((m) => m.user_id === u.id).map((m) => m.id);
    return {
      exported_at: h.nowIso(), user: h.publicUser(u), memberships: mine("memberships"), consents: mine("consents"), activities: mine("activities"),
      planned_workouts: h.db.planned_workouts.filter((p) => mids.includes(p.athlete_membership_id) && h.visible(p)),
      completions: h.db.workout_completions.filter((c) => h.db.planned_workouts.some((p) => p.id === c.planned_workout_id && mids.includes(p.athlete_membership_id))),
      notifications: mine("notifications"),
    };
  });

  // ---- sessions (signed-in devices)
  const sessionOut = (s, current) => ({ id: s.id, kind: s.kind, user_agent: s.user_agent, created_at: s.created_at, last_seen_at: s.last_seen_at, current: s.id === current });
  h.get("/v1/me/sessions", (ctx) => {
    const u = ctx.user(), cur = ctx.auth.session.id;
    return { items: h.db.sessions.filter((s) => s.user_id === u.id && !s.revoked_at && s.expires_at > h.nowIso()).sort((a, b) => (b.id === cur) - (a.id === cur) || b.last_seen_at.localeCompare(a.last_seen_at)).map((s) => sessionOut(s, cur)), next_cursor: null };
  });
  h.delete("/v1/me/sessions/:id", (ctx) => {
    const u = ctx.user();
    const s = h.db.sessions.find((x) => x.id === ctx.params.id && x.user_id === u.id && !x.revoked_at);
    if (!s) h.fail(404, "session.not_found", "Sessão não encontrada", "Ela pode já ter sido encerrada.");
    s.revoked_at = h.nowIso();
  });
  h.post("/v1/me/sessions/revoke-others", (ctx) => {
    const u = ctx.user(), cur = ctx.auth.session.id, now = h.nowIso();
    let n = 0;
    for (const s of h.db.sessions) if (s.user_id === u.id && s.id !== cur && !s.revoked_at) { s.revoked_at = now; n++; }
    return { revoked: n };
  });

  // ---- avatar (user-owned asset; same storage as club logos)
  h.post("/v1/me/avatar", (ctx) => {
    const u = ctx.user();
    const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body.data_url || ""));
    if (!match) h.fail(415, "asset.unsupported", "Formato não suportado", "Envie uma foto PNG, JPG ou WebP.");
    const bytes = Buffer.from(match[3], "base64");
    if (bytes.length > 5 * 1024 * 1024) h.fail(413, "asset.too_large", "Imagem muito grande", "O limite é 5 MB.");
    const id = h.uuid("asset");
    h.db._blobs ||= {};
    h.db._blobs[id] = { content_type: match[1], data: match[3] };
    h.db.assets.push({ id, owner_user_id: u.id, club_id: null, kind: "avatar", storage_key: `users/${u.id}/${id}`, content_type: match[1], bytes: bytes.length, width: Number(ctx.body.width) || null, height: Number(ctx.body.height) || null, sha256: h.sha256(match[3]), created_at: h.nowIso() });
    u.avatar_url = `/v1/assets/${id}`; u.updated_at = h.nowIso();
    return me(u);
  });
  h.delete("/v1/me/avatar", (ctx) => { const u = ctx.user(); u.avatar_url = null; u.updated_at = h.nowIso(); return me(u); });

  // ---- leave a club
  h.post("/v1/clubs/:club_id/leave", (ctx) => {
    const m = ctx.member(ctx.params.club_id);
    if (m.role === "owner" && !h.db.memberships.some((x) => x.club_id === m.club_id && x.role === "owner" && x.status === "active" && x.id !== m.id))
      h.fail(409, "member.last_owner", "Você é o único gestor", "Promova outra pessoa a gestora em Membros ou encerre o clube.");
    const now = h.nowIso();
    Object.assign(m, { status: "left", left_at: now });
    h.db.group_members = h.db.group_members.filter((g) => g.membership_id !== m.id);
    for (const c of h.db.consents.filter((c) => c.user_id === m.user_id && c.club_id === m.club_id && !c.revoked_at)) c.revoked_at = now;
    h.db.audit_log.push({ id: h.db.audit_log.length + 1, club_id: m.club_id, actor_user_id: m.user_id, action: "member.left", target_type: "membership", target_id: m.id, data: null, created_at: now });
  });

  // ---- prefs: routes/notify.mjs (D-032)

  // ---- consents
  const CONSENT_KINDS = ["terms", "privacy", "share_training_data", "share_strava", "share_garmin"];
  h.get("/v1/me/consents", (ctx) => ({ items: h.db.consents.filter((c) => c.user_id === ctx.user().id), next_cursor: null }));
  h.post("/v1/me/consents", (ctx) => {
    const u = ctx.user();
    const { kind, club_id = null, text_version = "2026-10" } = ctx.body;
    if (!CONSENT_KINDS.includes(kind)) h.invalid([{ field: "kind", message: "Tipo de consentimento inválido." }]);
    if (club_id) ctx.member(club_id);
    const existing = h.db.consents.find((c) => c.user_id === u.id && c.club_id === club_id && c.kind === kind && !c.revoked_at);
    if (existing) return existing;
    const row = { id: h.uuid("consent"), user_id: u.id, club_id, kind, text_version, granted_at: h.nowIso(), revoked_at: null };
    h.db.consents.push(row);
    return { __status: 201, data: row };
  });
  h.delete("/v1/me/consents/:id", (ctx) => {
    const c = h.db.consents.find((x) => x.id === ctx.params.id && x.user_id === ctx.user().id);
    if (!c) h.fail(404, "consent.not_found", "Consentimento não encontrado", "Ele pode já ter sido revogado.");
    if (c.kind === "terms" || c.kind === "privacy") h.fail(409, "consent.required", "Este consentimento é obrigatório", "Para revogar os termos, exclua sua conta.");
    c.revoked_at = h.nowIso();
  });

  // ---- notifications
  h.get("/v1/me/notifications", (ctx) => {
    const u = ctx.user();
    const items = h.db.notifications.filter((n) => n.user_id === u.id && n.in_app !== false).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return h.list(items, ctx);
  });
  h.post("/v1/me/notifications/read", (ctx) => {
    const u = ctx.user();
    const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : null;
    for (const n of h.db.notifications) if (n.user_id === u.id && !n.read_at && (!ids || ids.includes(n.id))) n.read_at = h.nowIso();
  });
}
