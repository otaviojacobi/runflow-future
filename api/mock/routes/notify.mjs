/** Notifications (D-045, N1): every notification goes through h.notify and always lands in the app; the person only
 * switches push to their devices on or off per kind, or pauses it. No notification e-mails. */
const KINDS = ["workout_assigned", "workout_changed", "week_released", "comment", "feedback", "member_joined", "billing", "message", "announcement"];
/** Push by default (endpoints.md § Notifications): on, except the staff's busiest kinds. */
const PUSH_OFF_BY_DEFAULT = ["feedback", "member_joined"];

export default function register(h) {
  const blank = (userId) => ({ user_id: userId, kinds: {}, paused: false, updated_at: h.nowIso() });
  /** The stored row (rows saved by older versions are trimmed to the current shape). */
  const row = (userId) => {
    let p = h.db.notification_prefs.find((x) => x.user_id === userId);
    if (!p) { p = blank(userId); h.db.notification_prefs.push(p); }
    if ("digest_hour" in p || !("kinds" in p)) {
      const kinds = Object.fromEntries(Object.entries(p.kinds ?? {}).filter(([, v]) => typeof v?.push === "boolean").map(([k, v]) => [k, { push: v.push }]));
      for (const k of Object.keys(p)) if (!["user_id", "paused", "updated_at"].includes(k)) delete p[k];
      Object.assign(p, { ...blank(userId), ...p, kinds });
    }
    return p;
  };
  const pushOn = (p, kind) => (typeof p.kinds?.[kind]?.push === "boolean" ? p.kinds[kind].push : !PUSH_OFF_BY_DEFAULT.includes(kind));

  /** GET /me/prefs payload: every kind resolved, plus the pause. */
  h.prefsOut = (userId) => {
    const p = row(userId);
    return { kinds: Object.fromEntries(KINDS.map((k) => [k, { push: pushOn(p, k) }])), paused: p.paused };
  };

  /** Create a notification (always in the center). The mock stores when the push would go out: the kind is on, push
   * isn't paused and the person registered a device (the backend sends it). */
  h.notify = (n) => {
    const p = row(n.user_id);
    const push = pushOn(p, n.kind) && !p.paused && (h.db.push_tokens ||= []).some((t) => t.user_id === n.user_id);
    const out = { read_at: null, created_at: h.nowIso(), ...n, push_at: push ? h.nowIso() : null, pushed_at: null };
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
      const kinds = b.kinds;
      if (typeof kinds !== "object" || kinds === null || Array.isArray(kinds)) errors.push({ field: "kinds", message: "Tipo de notificação desconhecido." });
      else for (const [k, v] of Object.entries(kinds)) {
        if (!KINDS.includes(k) || typeof v !== "object" || v === null || Array.isArray(v)) { errors.push({ field: "kinds", message: "Tipo de notificação desconhecido." }); break; }
        if ("push" in v && typeof v.push !== "boolean") { errors.push({ field: "kinds", message: "Use ligado ou desligado." }); break; }
      }
    }
    if ("paused" in b && typeof b.paused !== "boolean") errors.push({ field: "paused", message: "Use ligado ou desligado." });
    if (errors.length) h.invalid(errors);
    if (b.kinds) for (const [k, v] of Object.entries(b.kinds)) if (typeof v.push === "boolean") p.kinds[k] = { push: v.push };
    if ("paused" in b) p.paused = b.paused;
    p.updated_at = h.nowIso();
    return h.prefsOut(u.id);
  });
}
