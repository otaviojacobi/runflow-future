/** Notification control (D-032, F35): every notification goes through h.notify, which applies the recipient's choices. */
const KINDS = ["workout_assigned", "workout_changed", "week_released", "comment", "feedback", "member_joined", "billing", "message", "announcement"];
/** Defaults per kind (endpoints.md § Notifications). */
const DEFAULTS = {
  workout_assigned: { app: true, push: true, email: "off" },
  workout_changed: { app: true, push: true, email: "off" },
  week_released: { app: true, push: true, email: "instant" },
  comment: { app: true, push: true, email: "off" },
  message: { app: true, push: true, email: "off" },
  announcement: { app: true, push: true, email: "off" },
  feedback: { app: true, push: false, email: "digest" },
  member_joined: { app: true, push: false, email: "digest" },
  billing: { app: true, push: false, email: "instant" },
};
const EMAIL = ["off", "instant", "digest"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function register(h) {
  const blank = (userId) => ({ user_id: userId, kinds: {}, digest_hour: 7, quiet_start: "22:00", quiet_end: "07:00", paused: false, last_digest_on: null, updated_at: h.nowIso() });
  /** The stored row (rows saved before F35 are upgraded in place). */
  const row = (userId) => {
    let p = h.db.notification_prefs.find((x) => x.user_id === userId);
    if (!p) { p = blank(userId); h.db.notification_prefs.push(p); }
    if (!("kinds" in p)) { for (const k of ["push_workouts", "push_comments", "push_classes", "email_weekly"]) delete p[k]; Object.assign(p, { ...blank(userId), ...p, kinds: {} }); }
    h.db.notification_group_filters ||= [];
    return p;
  };
  const resolve = (p, kind) => ({ ...DEFAULTS[kind], ...(p.kinds?.[kind] ?? {}) });

  /** GET /me/prefs payload: every kind resolved, plus the staff group filters. */
  h.prefsOut = (userId) => {
    const p = row(userId);
    const groups = h.db.memberships
      .filter((m) => m.user_id === userId && m.status === "active" && m.role !== "student")
      .map((m) => ({ club_id: m.club_id, membership_id: m.id, group_ids: h.db.notification_group_filters.find((f) => f.membership_id === m.id)?.group_ids ?? [] }));
    return { kinds: Object.fromEntries(KINDS.map((k) => [k, resolve(p, k)])), digest_hour: p.digest_hour, quiet_start: p.quiet_start, quiet_end: p.quiet_end, paused: p.paused, groups };
  };

  /** Create a notification as the recipient wants it. `about`: the student it is about (group filter for staff). */
  h.notify = (n, { about } = {}) => {
    if (about && (n.kind === "feedback" || n.kind === "comment")) {
      const staff = h.db.memberships.find((m) => m.user_id === n.user_id && m.club_id === n.club_id && m.role !== "student");
      const f = staff && (h.db.notification_group_filters ||= []).find((x) => x.membership_id === staff.id);
      if (f?.group_ids.length && !h.db.group_members.some((g) => g.membership_id === about && f.group_ids.includes(g.group_id))) return null;
    }
    const p = row(n.user_id);
    const k = resolve(p, n.kind);
    const email = p.paused || k.email === "off" ? "none" : k.email;
    // Push only to people with a registered device; the mock stores when it would go out (the backend sends it,
    // holding it through quiet hours).
    const push = k.push && !p.paused && (h.db.push_tokens ||= []).some((t) => t.user_id === n.user_id);
    if (!k.app && email === "none" && !push) return null;
    const out = { read_at: null, created_at: h.nowIso(), ...n, in_app: k.app, email, push_at: push ? h.nowIso() : null, pushed_at: null };
    h.db.notifications.push(out);
    return out;
  };

  h.get("/v1/me/prefs", (ctx) => h.prefsOut(ctx.user().id));

  /** Devices for push (S7b): web = a Web Push subscription, ios/android = Expo tokens (X10). */
  h.post("/v1/me/push-tokens", (ctx) => {
    const u = ctx.user(), b = ctx.body;
    const token = typeof b.token === "string" ? b.token.trim() : "";
    const keys = b.keys && typeof b.keys === "object" ? b.keys : null;
    const e = [];
    if (!["web", "ios", "android"].includes(b.platform)) e.push({ field: "platform", message: "Plataforma inválida." });
    const expo = /^(ExponentPushToken|ExpoPushToken)\[[\x21-\x5c\x5e-\x7e]{1,256}\]$/.test(token);
    if (!token || token.length > 2048 || (b.platform === "web" ? !/^https:\/\//.test(token) : !expo)) e.push({ field: "token", message: "Informe o token do aparelho." });
    if (b.platform === "web" && !(typeof keys?.p256dh === "string" && keys.p256dh && typeof keys?.auth === "string" && keys.auth)) e.push({ field: "keys", message: "Chaves da inscrição inválidas." });
    if (e.length) h.invalid(e);
    h.db.push_tokens ||= [];
    const now = h.nowIso();
    const t = h.db.push_tokens.find((x) => x.token === token);
    const k = b.platform === "web" ? { p256dh: keys.p256dh, auth: keys.auth } : null;
    if (t) Object.assign(t, { user_id: u.id, platform: b.platform, keys: k, last_seen_at: now });
    else h.db.push_tokens.push({ id: h.uuid("pt"), user_id: u.id, platform: b.platform, token, keys: k, created_at: now, last_seen_at: now });
  });
  h.delete("/v1/me/push-tokens", (ctx) => {
    const u = ctx.user();
    h.db.push_tokens = (h.db.push_tokens ||= []).filter((t) => !(t.user_id === u.id && t.token === ctx.body?.token));
  });
  h.patch("/v1/me/prefs", (ctx) => {
    const u = ctx.user();
    const p = row(u.id);
    const b = ctx.body, errors = [];
    if ("kinds" in b) {
      for (const [k, v] of Object.entries(b.kinds ?? {})) {
        if (!KINDS.includes(k) || typeof v !== "object" || v === null) { errors.push({ field: "kinds", message: "Tipo de notificação desconhecido." }); continue; }
        if ("email" in v && !EMAIL.includes(v.email)) errors.push({ field: "kinds", message: "Escolha como receber por e-mail." });
        if (("app" in v && typeof v.app !== "boolean") || ("push" in v && typeof v.push !== "boolean")) errors.push({ field: "kinds", message: "Use ligado ou desligado." });
      }
    }
    if ("digest_hour" in b && !(Number.isInteger(b.digest_hour) && b.digest_hour >= 0 && b.digest_hour <= 23)) errors.push({ field: "digest_hour", message: "Escolha um horário entre 0 e 23 h." });
    if ("quiet_start" in b || "quiet_end" in b) {
      const both = TIME.test(b.quiet_start ?? "") && TIME.test(b.quiet_end ?? "");
      const none = b.quiet_start == null && b.quiet_end == null;
      if (!both && !none) errors.push({ field: "quiet_start", message: "Informe o início e o fim do horário silencioso." });
    }
    if ("paused" in b && typeof b.paused !== "boolean") errors.push({ field: "paused", message: "Use ligado ou desligado." });
    if (errors.length) h.invalid(errors);
    if (Array.isArray(b.groups)) {
      for (const g of b.groups) {
        const m = h.db.memberships.find((x) => x.user_id === u.id && x.club_id === g.club_id && x.status === "active" && x.role !== "student");
        if (!m) h.fail(403, "auth.forbidden", "Sem permissão", "Só a equipe do clube filtra avisos por grupo.");
        const ids = [...new Set(Array.isArray(g.group_ids) ? g.group_ids : [])].filter((id) => h.db.groups.some((x) => x.id === id && x.club_id === g.club_id));
        const f = h.db.notification_group_filters.find((x) => x.membership_id === m.id);
        if (f) Object.assign(f, { group_ids: ids, updated_at: h.nowIso() });
        else h.db.notification_group_filters.push({ membership_id: m.id, group_ids: ids, updated_at: h.nowIso() });
      }
    }
    if (b.kinds) for (const [k, v] of Object.entries(b.kinds)) p.kinds[k] = { ...(p.kinds[k] ?? {}), ...Object.fromEntries(Object.entries(v).filter(([x]) => ["app", "push", "email"].includes(x))) };
    for (const k of ["digest_hour", "quiet_start", "quiet_end", "paused"]) if (k in b) p[k] = b[k] ?? null;
    p.updated_at = h.nowIso();
    return h.prefsOut(u.id);
  });
}
