/** Auth, /me, prefs, consents, notifications, mock-only demo accounts. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEV_CODE = "000000";

export default function register(h) {
  const { db } = h;

  function createUser(email, name) {
    const now = h.nowIso();
    const user = { id: h.uuid("user"), email, name, avatar_url: null, phone: null, birth_date: null, sex: null, locale: "pt-BR", created_at: now, updated_at: now, deleted_at: null };
    h.db.users.push(user);
    h.db.notification_prefs.push({ user_id: user.id, push_workouts: true, push_comments: true, push_classes: true, email_weekly: true, updated_at: now });
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
      prefs: h.db.notification_prefs.find((p) => p.user_id === user.id) || null,
      unread_notifications: h.db.notifications.filter((n) => n.user_id === user.id && !n.read_at).length,
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
    if (errors.length) h.invalid(errors);
    for (const k of ["name", "phone", "birth_date", "sex", "avatar_url"]) if (k in b) u[k] = typeof b[k] === "string" ? b[k].trim() || null : b[k];
    u.updated_at = h.nowIso();
    return me(u);
  });
  h.delete("/v1/me", (ctx) => {
    const u = ctx.user();
    const now = h.nowIso();
    if (h.db.memberships.some((m) => m.user_id === u.id && m.role === "owner" && m.status === "active"))
      h.fail(409, "account.owns_club", "Você ainda é gestor de um clube", "Transfira a gestão ou encerre o clube antes de excluir sua conta.");
    u.deleted_at = now;
    u.email = `deleted+${u.id}@runflow.club`;
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
      planned_workouts: h.db.planned_workouts.filter((p) => mids.includes(p.athlete_membership_id)),
      completions: h.db.workout_completions.filter((c) => h.db.planned_workouts.some((p) => p.id === c.planned_workout_id && mids.includes(p.athlete_membership_id))),
      bookings: h.db.bookings.filter((b) => mids.includes(b.membership_id)), notifications: mine("notifications"),
    };
  });

  // ---- prefs
  h.get("/v1/me/prefs", (ctx) => h.db.notification_prefs.find((p) => p.user_id === ctx.user().id));
  h.patch("/v1/me/prefs", (ctx) => {
    const p = h.db.notification_prefs.find((x) => x.user_id === ctx.user().id);
    for (const k of ["push_workouts", "push_comments", "push_classes", "email_weekly"]) if (typeof ctx.body[k] === "boolean") p[k] = ctx.body[k];
    p.updated_at = h.nowIso();
    return p;
  });

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
    const items = h.db.notifications.filter((n) => n.user_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return h.list(items, ctx);
  });
  h.post("/v1/me/notifications/read", (ctx) => {
    const u = ctx.user();
    const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : null;
    for (const n of h.db.notifications) if (n.user_id === u.id && !n.read_at && (!ids || ids.includes(n.id))) n.read_at = h.nowIso();
  });
}
