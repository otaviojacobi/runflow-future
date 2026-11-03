/** Clubs, branding (Club Studio), assets, invites (create / public / accept). */
import { starterLibrary } from "../seed.mjs";

const UF = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];
const HEX = /^#[0-9A-F]{6}$/;
const STARTER = starterLibrary();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TIMEZONES = ["America/Noronha", "America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Boa_Vista", "America/Rio_Branco"];
const RESERVED = new Set("app api www mail email smtp imap pop autodiscover send status docs admin assets static cdn blog ajuda suporte dev runflow staging grafana prometheus loki alloy metrics logs monitor sentry auth login qa prod".split(" "));

export default function register(h) {
  const slugify = (name) => {
    const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "clube";
    let slug = base.length < 3 ? base + "-clube" : base, i = 2;
    while (h.db.clubs.some((c) => c.slug === slug)) slug = `${base}-${i++}`;
    return slug;
  };
  const club = (id) => h.db.clubs.find((c) => c.id === id && !c.deleted_at) || h.fail(404, "club.not_found", "Clube não encontrado", "Ele pode ter sido encerrado.");
  const inviteToken = () => (h.uuid("inv") + h.uuid("inv")).replace(/-/g, "").slice(0, 24);
  const INVITE_DAYS = 7;
  const inviteStatus = (i) => (i.revoked_at ? "revoked" : i.accepted_at ? "accepted" : i.expires_at < h.nowIso() ? "expired" : "pending");
  const inviteOut = (i) => ({ ...i, status: inviteStatus(i), url: `https://runflow.club/invite/${i.token}` });
  const maskEmail = (e) => { const [u, d] = e.split("@"); return `${u.slice(0, Math.min(2, u.length))}${"•".repeat(Math.max(1, u.length - 2))}@${d}`; };
  const setBranding = (clubId, primary, secondary, logoId) => {
    let b = h.db.club_branding.find((x) => x.club_id === clubId);
    const th = h.themeFor(primary, secondary);
    if (!b) {
      b = { club_id: clubId, primary_color: null, secondary_color: null, logo_asset_id: null, theme_rev: 0, engine_version: 1 };
      h.db.club_branding.push(b);
    }
    Object.assign(b, { primary_color: primary, secondary_color: primary ? secondary : null, logo_asset_id: logoId, theme_rev: b.theme_rev + 1, ...th, updated_at: h.nowIso() });
    return b;
  };

  // ---- clubs
  h.post("/v1/clubs", (ctx) => {
    const u = ctx.user();
    const name = h.str(ctx.body, "name", "o nome do clube", { max: 80 });
    const city = h.str(ctx.body, "city", "a cidade", { required: false, max: 80 });
    const state = ctx.body.state ? String(ctx.body.state).toUpperCase() : null;
    if (state && !UF.has(state)) h.invalid([{ field: "state", message: "Escolha um estado." }]);
    const modalities = Array.isArray(ctx.body.modalities) ? ctx.body.modalities.filter((m) => SPORTS.includes(m)) : [];
    if (!modalities.length) h.invalid([{ field: "modalities", message: "Escolha pelo menos uma modalidade." }]);
    const now = h.nowIso();
    const c = { id: h.uuid("club"), slug: slugify(name), name, city, state, timezone: "America/Sao_Paulo", modalities, trainer_label: modalities.some((m) => m === "swim" || m === "strength") && !modalities.includes("run") ? "professor" : "treinador", subdomain: null, created_at: now, updated_at: now, deleted_at: null };
    h.db.clubs.push(c);
    const m = { id: h.uuid("m"), club_id: c.id, user_id: u.id, role: "owner", status: "active", is_billing_owner: true, joined_at: now, left_at: null };
    h.db.memberships.push(m);
    setBranding(c.id, null, null, null);
    h.db.club_subscriptions.push({ club_id: c.id, plan: "free", status: "active", student_limit: 10, stripe_customer_id: null, stripe_subscription_id: null, current_period_end: null, cancel_at_period_end: false, updated_at: now });
    for (const t of modalities.flatMap((s) => STARTER[s] || [])) {
      h.db.workout_templates.push({ id: h.uuid("tpl"), club_id: c.id, author_membership_id: m.id, sport: t.sport, name: t.name, description: null, structure: t.structure, est_duration_s: t.est_duration_s, est_distance_m: t.est_distance_m, tags: t.tags, created_at: now, updated_at: now, archived_at: null });
    }
    h.db.audit_log.push({ id: h.db.audit_log.length + 1, club_id: c.id, actor_user_id: u.id, action: "club.created", target_type: "club", target_id: c.id, data: null, created_at: now });
    return { __status: 201, data: { club: c, membership: m, branding: h.branding(c.id), subscription: h.subscription(c.id) } };
  });
  h.get("/v1/clubs/:club_id", (ctx) => { ctx.member(ctx.params.club_id); return club(ctx.params.club_id); });
  h.patch("/v1/clubs/:club_id", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const c = club(ctx.params.club_id);
    const b = ctx.body, errors = [];
    if ("name" in b && !String(b.name || "").trim()) errors.push({ field: "name", message: "Informe o nome do clube." });
    if ("state" in b && b.state && !UF.has(String(b.state).toUpperCase())) errors.push({ field: "state", message: "Escolha um estado." });
    if ("modalities" in b && (!Array.isArray(b.modalities) || !b.modalities.filter((m) => SPORTS.includes(m)).length)) errors.push({ field: "modalities", message: "Escolha pelo menos uma modalidade." });
    if ("trainer_label" in b && !["treinador", "professor"].includes(b.trainer_label)) errors.push({ field: "trainer_label", message: "Opção inválida." });
    // Week release (D-031)
    if ("release_mode" in b && !["immediate", "weekly"].includes(b.release_mode)) errors.push({ field: "release_mode", message: "Escolha quando os alunos veem os treinos." });
    let auto;
    if ("auto_release_weekday" in b || "auto_release_time" in b) {
      const day = Number.isInteger(b.auto_release_weekday) && b.auto_release_weekday >= 1 && b.auto_release_weekday <= 7 ? b.auto_release_weekday : null;
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(b.auto_release_time || "") ? b.auto_release_time : null;
      if (day && time) auto = { auto_release_weekday: day, auto_release_time: time };
      else if (b.auto_release_weekday == null && b.auto_release_time == null) auto = { auto_release_weekday: null, auto_release_time: null };
      else errors.push({ field: "auto_release_time", message: "Informe o dia e o horário da liberação automática." });
    }
    if ("timezone" in b && !TIMEZONES.includes(b.timezone)) errors.push({ field: "timezone", message: "Escolha um fuso horário." });
    if ("subdomain" in b && b.subdomain) {
      const sub = String(b.subdomain).toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(sub)) errors.push({ field: "subdomain", message: "Use de 3 a 32 letras, números ou hífens." });
      else if (sub.endsWith("-qa")) errors.push({ field: "subdomain", message: "Endereços terminados em -qa são reservados." }); // QA's club sites (D-029)
      else if (RESERVED.has(sub)) errors.push({ field: "subdomain", message: "Este endereço é reservado. Escolha outro." });
      else if (h.db.clubs.some((x) => x.subdomain === sub && x.id !== c.id)) errors.push({ field: "subdomain", message: "Este endereço já está em uso." });
      else if (h.subscription(c.id).plan === "free") h.fail(402, "plan.required", "Disponível no plano Pro", "O endereço próprio (seuclube.runflow.club) faz parte do plano Pro.");
    }
    if (errors.length) h.invalid(errors);
    for (const k of ["name", "city", "timezone", "trainer_label"]) if (k in b) c[k] = typeof b[k] === "string" ? b[k].trim() || null : b[k];
    if ("state" in b) c.state = b.state ? String(b.state).toUpperCase() : null;
    if ("modalities" in b) c.modalities = b.modalities.filter((m) => SPORTS.includes(m));
    if ("subdomain" in b) c.subdomain = b.subdomain ? String(b.subdomain).toLowerCase() : null;
    const wasImmediate = h.releaseOf(c).release_mode === "immediate";
    if ("release_mode" in b) c.release_mode = b.release_mode;
    if (auto) Object.assign(c, auto);
    if (wasImmediate && c.release_mode === "weekly") h.releasePlannedFuture(c.id);
    c.updated_at = h.nowIso();
    return c;
  });

  h.delete("/v1/clubs/:club_id", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const c = club(ctx.params.club_id);
    if (String(ctx.body.confirm_name || "").trim().toLowerCase() !== c.name.toLowerCase()) h.invalid([{ field: "confirm_name", message: "Digite o nome do clube exatamente como aparece." }]);
    const now = h.nowIso();
    c.deleted_at = now; c.subdomain = null; c.updated_at = now;
    for (const sub of h.db.club_subscriptions.filter((x) => x.club_id === c.id && x.status !== "canceled")) Object.assign(sub, { status: "canceled", cancel_at_period_end: false, updated_at: now });
    for (const inv of h.db.invitations.filter((x) => x.club_id === c.id && !x.revoked_at)) inv.revoked_at = now;
    h.db.audit_log.push({ id: h.db.audit_log.length + 1, club_id: c.id, actor_user_id: ctx.user().id, action: "club.closed", target_type: "club", target_id: c.id, data: null, created_at: now });
  });

  // ---- branding
  h.get("/v1/clubs/:club_id/branding", (ctx) => { ctx.member(ctx.params.club_id); return h.branding(ctx.params.club_id); });
  h.put("/v1/clubs/:club_id/branding", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const norm = (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null);
    let primary = norm(ctx.body.primary_color), secondary = norm(ctx.body.secondary_color);
    const errors = [];
    if (primary && !HEX.test(primary)) errors.push({ field: "primary_color", message: "Use uma cor no formato #RRGGBB." });
    if (secondary && !HEX.test(secondary)) errors.push({ field: "secondary_color", message: "Use uma cor no formato #RRGGBB." });
    if (errors.length) h.invalid(errors);
    if (!primary && secondary) { primary = secondary; secondary = null; }
    const current = h.db.club_branding.find((x) => x.club_id === ctx.params.club_id);
    const logo = "logo_asset_id" in ctx.body ? ctx.body.logo_asset_id || null : current?.logo_asset_id ?? null;
    if (logo && !h.db.assets.some((a) => a.id === logo && a.club_id === ctx.params.club_id)) h.invalid([{ field: "logo_asset_id", message: "Envie o logo novamente." }]);
    setBranding(ctx.params.club_id, primary, secondary, logo);
    return h.branding(ctx.params.club_id);
  });

  // ---- assets (mock object storage: data kept in db._blobs, outside the schema)
  h.post("/v1/clubs/:club_id/assets", (ctx) => {
    const m = ctx.owner(ctx.params.club_id);
    const match = /^data:(image\/(png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body.data_url || ""));
    if (!match) h.fail(415, "asset.unsupported", "Formato não suportado", "Envie uma imagem PNG, JPG, WebP ou SVG.");
    const bytes = Buffer.from(match[3], "base64");
    if (bytes.length > 5 * 1024 * 1024) h.fail(413, "asset.too_large", "Imagem muito grande", "O limite é 5 MB.");
    const id = h.uuid("asset");
    h.db._blobs ||= {};
    h.db._blobs[id] = { content_type: match[1], data: match[3] };
    h.db.assets.push({ id, owner_user_id: ctx.user().id, club_id: ctx.params.club_id, kind: ctx.body.kind === "avatar" ? "avatar" : "logo", storage_key: `clubs/${ctx.params.club_id}/${id}`, content_type: match[1], bytes: bytes.length, width: Number(ctx.body.width) || null, height: Number(ctx.body.height) || null, sha256: h.sha256(match[3]), created_at: h.nowIso() });
    void m;
    return { __status: 201, data: { id, url: `/v1/assets/${id}` } };
  });
  h.get("/v1/assets/:id", (ctx) => {
    const blob = h.db._blobs?.[ctx.params.id];
    if (!blob) h.fail(404, "asset.not_found", "Imagem não encontrada", "Ela pode ter sido removida.");
    return { __raw: true, headers: { "Content-Type": blob.content_type, "Cache-Control": "public, max-age=31536000, immutable" }, body: Buffer.from(blob.data, "base64") };
  });

  // ---- public club (subdomain / invite pages)
  h.get("/v1/public/clubs/:slug", (ctx) => {
    const c = h.db.clubs.find((x) => (x.slug === ctx.params.slug || x.subdomain === ctx.params.slug) && !x.deleted_at);
    if (!c) h.fail(404, "club.not_found", "Clube não encontrado", "Confira o endereço.");
    return { club: { id: c.id, slug: c.slug, name: c.name, city: c.city, state: c.state, modalities: c.modalities, trainer_label: c.trainer_label }, branding: h.branding(c.id) };
  });

  // ---- invites (D-023): personal, e-mailed, 7 days, single use, bound to the invited e-mail
  const outbox = (msg) => { h.db._outbox ||= []; h.db._outbox.unshift({ id: h.uuid("mail"), created_at: h.nowIso(), ...msg }); };
  /** What the backend e-mails (pt-BR). The mock keeps it in a dev outbox: GET /v1/mock/outbox, /dev/outbox in the web app. */
  const sendInvite = (i, inviter) => {
    const c = club(i.club_id);
    const until = new Date(Date.parse(i.expires_at) - 3 * 3600000).toISOString().slice(0, 10).split("-").reverse().join("/");
    const who = i.role === "trainer" ? (c.trainer_label === "professor" ? "professor(a)" : "treinador(a)") : "aluno(a)";
    i.sent_at = h.nowIso(); i.send_count = (i.send_count || 0) + 1;
    outbox({
      kind: "invite", club_id: c.id, to: i.email,
      subject: `${inviter.name} convidou você para o ${c.name} no Runflow`,
      text: `Olá${i.name ? `, ${i.name}` : ""}!\n\n${inviter.name} convidou você para entrar no ${c.name} como ${who}.\n\nAceite pelo link abaixo. Ele vale até ${until} e só funciona com este e-mail (${i.email}).`,
      action: { label: "Aceitar convite", url: `/invite/${i.token}` },
    });
  };
  const inviterOf = (m) => h.publicUser(h.db.users.find((u) => u.id === m.user_id));
  const openInvite = (clubId, email) => h.db.invitations.find((x) => x.club_id === clubId && x.email === email && !x.accepted_at && !x.revoked_at);
  const isMember = (clubId, email) => { const u = h.db.users.find((x) => x.email.toLowerCase() === email && !x.deleted_at); return !!u && h.db.memberships.some((x) => x.user_id === u.id && x.club_id === clubId && x.status === "active"); };
  const renew = (i) => { i.token = inviteToken(); i.expires_at = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString(); };

  /** Mock only: the e-mails the backend would send (invites today). Newest first; ?to= filters by recipient. */
  h.get("/v1/mock/outbox", (ctx) => ({ items: (h.db._outbox || []).filter((m) => !ctx.query.to || m.to === String(ctx.query.to).toLowerCase()).slice(0, 100) }));
  h.get("/v1/clubs/:club_id/invites", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const order = { pending: 0, expired: 1, accepted: 2 };
    const items = h.db.invitations.filter((i) => i.club_id === ctx.params.club_id && !i.revoked_at).map(inviteOut)
      .sort((a, b) => order[a.status] - order[b.status] || b.created_at.localeCompare(a.created_at));
    return { items, next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/invites", (ctx) => {
    const m = ctx.staff(ctx.params.club_id);
    const role = ctx.body.role === "trainer" ? "trainer" : "student";
    if (role === "trainer" && m.role !== "owner") h.fail(403, "auth.forbidden", "Sem permissão", "Só o gestor convida treinadores.");
    const email = String(ctx.body.email || "").trim().toLowerCase();
    if (!EMAIL.test(email)) h.invalid([{ field: "email", message: "Digite um e-mail válido, como nome@email.com." }]);
    if (isMember(m.club_id, email)) h.fail(409, "invite.already_member", "Essa pessoa já está no clube", "Ela já pode entrar com esse e-mail.");
    if (openInvite(m.club_id, email)) h.fail(409, "invite.exists", "Já existe um convite para esse e-mail", "Use “Reenviar” na lista de convites para mandar de novo.");
    const groupIds = (Array.isArray(ctx.body.group_ids) ? ctx.body.group_ids : []).filter((g) => h.db.groups.some((x) => x.id === g && x.club_id === m.club_id));
    const row = { id: h.uuid("inv"), club_id: m.club_id, role, email, name: String(ctx.body.name || "").trim() || null, token: "", group_ids: role === "student" ? groupIds : [], created_by: m.id, expires_at: "", sent_at: null, send_count: 0, accepted_at: null, accepted_by: null, revoked_at: null, created_at: h.nowIso() };
    renew(row);
    h.db.invitations.push(row);
    sendInvite(row, inviterOf(m));
    return { __status: 201, data: inviteOut(row) };
  });
  /** Send again: new link (the old one stops working) and another 7 days. */
  h.post("/v1/clubs/:club_id/invites/:id/resend", (ctx) => {
    const m = ctx.staff(ctx.params.club_id);
    const i = h.db.invitations.find((x) => x.id === ctx.params.id && x.club_id === m.club_id && !x.revoked_at);
    if (!i) h.fail(404, "invite.not_found", "Convite não encontrado", "Ele pode ter sido cancelado.");
    if (i.accepted_at) h.fail(409, "invite.accepted", "Convite já aceito", "Essa pessoa já entrou no clube.");
    if (i.role === "trainer" && m.role !== "owner") h.fail(403, "auth.forbidden", "Sem permissão", "Só o gestor convida treinadores.");
    renew(i);
    sendInvite(i, inviterOf(m));
    return inviteOut(i);
  });
  /** CSV import: one personal invite per row; an open invite for the same e-mail is sent again. */
  h.post("/v1/clubs/:club_id/invites/bulk", (ctx) => {
    const m = ctx.staff(ctx.params.club_id);
    const rows = Array.isArray(ctx.body.rows) ? ctx.body.rows.slice(0, 500) : [];
    if (!rows.length) h.invalid([{ field: "rows", message: "Envie pelo menos um aluno." }]);
    const groups = h.db.groups.filter((g) => g.club_id === m.club_id);
    const inviter = inviterOf(m);
    const seen = new Set(), items = [], skipped = [];
    for (const [i, r] of rows.entries()) {
      const email = String(r.email || "").trim().toLowerCase();
      if (!EMAIL.test(email)) { skipped.push({ row: i + 1, email, reason: "invalid_email" }); continue; }
      if (seen.has(email)) { skipped.push({ row: i + 1, email, reason: "duplicate" }); continue; }
      seen.add(email);
      if (isMember(m.club_id, email)) { skipped.push({ row: i + 1, email, reason: "already_member" }); continue; }
      const gids = String(r.groups || "").split(/[,|]/).map((g) => g.trim().toLowerCase()).filter(Boolean).map((n) => groups.find((g) => g.name.toLowerCase() === n)?.id).filter(Boolean);
      let row = openInvite(m.club_id, email);
      const resent = !!row;
      if (!row) { row = { id: h.uuid("inv"), club_id: m.club_id, role: "student", email, name: String(r.name || "").trim() || null, token: "", group_ids: gids, created_by: m.id, expires_at: "", sent_at: null, send_count: 0, accepted_at: null, accepted_by: null, revoked_at: null, created_at: h.nowIso() }; h.db.invitations.push(row); }
      renew(row);
      sendInvite(row, inviter);
      items.push({ ...inviteOut(row), resent });
    }
    const s = h.subscription(m.club_id);
    return { __status: 201, data: { created: items.length, items, skipped, over_limit: Math.max(0, s.active_students + items.length - s.student_limit) } };
  });
  h.delete("/v1/clubs/:club_id/invites/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const i = h.db.invitations.find((x) => x.id === ctx.params.id && x.club_id === ctx.params.club_id);
    if (!i) h.fail(404, "invite.not_found", "Convite não encontrado", "Ele pode já ter sido cancelado.");
    i.revoked_at = h.nowIso();
  });

  const inviteState = (token) => {
    const i = h.db.invitations.find((x) => x.token === token);
    if (!i) h.fail(404, "invite.not_found", "Convite não encontrado", "O link pode ter sido trocado por um mais novo. Confira seu e-mail ou peça um novo convite.");
    const c = club(i.club_id);
    let reason = { pending: null, expired: "expired", revoked: "revoked", accepted: "accepted" }[inviteStatus(i)];
    if (!reason && i.role === "student") { const s = h.subscription(c.id); if (s.active_students >= s.student_limit) reason = "club_full"; }
    return { i, c, reason };
  };
  h.get("/v1/public/invites/:token", (ctx) => {
    const { i, c, reason } = inviteState(ctx.params.token);
    const by = h.db.memberships.find((m) => m.id === i.created_by);
    const byUser = by && h.db.users.find((u) => u.id === by.user_id);
    const signed = ctx.auth?.user;
    const already = signed ? h.db.memberships.find((m) => m.club_id === c.id && m.user_id === signed.id && m.status === "active") : null;
    return {
      club: { id: c.id, slug: c.slug, name: c.name, city: c.city, state: c.state, modalities: c.modalities, trainer_label: c.trainer_label },
      branding: h.branding(c.id), role: i.role, valid: !reason, reason, invited_by: byUser ? byUser.name : null, name: i.name,
      email: reason ? null : i.email, email_hint: maskEmail(i.email), expires_at: i.expires_at, members: h.activeStudents(c.id), already_member: !!already,
      // Signed in: does this account's e-mail match? (null when signed out)
      email_matches: signed ? signed.email.toLowerCase() === i.email : null,
    };
  });
  h.post("/v1/invites/:token/accept", (ctx) => {
    const u = ctx.user();
    const { i, c, reason } = inviteState(ctx.params.token);
    const existing = h.db.memberships.find((m) => m.club_id === c.id && m.user_id === u.id);
    if (existing && existing.status === "active") return { membership: existing, club: c, already_member: true };
    if (u.email.toLowerCase() !== i.email) h.fail(403, "invite.email_mismatch", "Este convite é para outro e-mail", `Ele foi enviado para ${maskEmail(i.email)}. Saia e entre com esse e-mail para aceitar.`);
    const messages = {
      revoked: ["Convite cancelado", "Peça um novo convite para quem te convidou."],
      expired: ["Convite expirado", "Os convites valem 7 dias. Peça para quem te convidou reenviar."],
      accepted: ["Convite já usado", "Este convite já foi aceito. Entre com sua conta para ver o clube."],
      club_full: ["O clube está lotado", "O clube atingiu o limite de alunos do plano. Avise quem te convidou."],
    };
    if (reason) h.fail(409, `invite.${reason}`, ...messages[reason]);
    const now = h.nowIso();
    let m = existing;
    if (m) Object.assign(m, { status: "active", role: i.role, left_at: null, joined_at: now });
    else { m = { id: h.uuid("m"), club_id: c.id, user_id: u.id, role: i.role, status: "active", is_billing_owner: false, joined_at: now, left_at: null }; h.db.memberships.push(m); }
    Object.assign(i, { accepted_at: now, accepted_by: u.id });
    for (const g of i.group_ids || []) if (h.db.groups.some((x) => x.id === g) && !h.db.group_members.some((x) => x.group_id === g && x.membership_id === m.id)) h.db.group_members.push({ group_id: g, membership_id: m.id, added_at: now });
    for (const staff of h.db.memberships.filter((x) => x.club_id === c.id && x.role !== "student" && x.status === "active"))
      h.notify({ id: h.uuid("n"), user_id: staff.user_id, club_id: c.id, kind: "member_joined", title: `${u.name} entrou no clube`, body: i.role === "trainer" ? "Novo treinador na equipe." : null, link: i.role === "trainer" ? "/club/members" : `/students/${m.id}`, created_at: now, read_at: null });
    return { __status: 201, data: { membership: m, club: c, already_member: false } };
  });
}
