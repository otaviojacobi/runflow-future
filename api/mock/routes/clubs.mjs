/** Clubs, branding (Club Studio), assets, invites (create / public / accept). */
import { LIB, estimate } from "../seed.mjs";

const UF = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];
const HEX = /^#[0-9A-F]{6}$/;
/** Starter library per modality (copied into every new club). */
const STARTER = { run: ["easy6", "regen5", "int6x1k", "int8x400", "fartlek", "tempo", "long", "prog10"], strength: ["forcaA", "forcaB"], mobility: ["mob"], swim: ["swimTech", "swim10x100"] };

export default function register(h) {
  const slugify = (name) => {
    const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "clube";
    let slug = base.length < 3 ? base + "-clube" : base, i = 2;
    while (h.db.clubs.some((c) => c.slug === slug)) slug = `${base}-${i++}`;
    return slug;
  };
  const club = (id) => h.db.clubs.find((c) => c.id === id && !c.deleted_at) || h.fail(404, "club.not_found", "Clube não encontrado", "Ele pode ter sido encerrado.");
  const inviteToken = () => h.uuid("inv").replace(/-/g, "").slice(0, 10);
  const inviteOut = (i) => ({ ...i, url: `https://runflow.club/invite/${i.token}` });
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
    h.db.invitations.push({ id: h.uuid("inv"), club_id: c.id, role: "student", token: inviteToken(), email: null, created_by: m.id, max_uses: null, uses: 0, expires_at: null, revoked_at: null, created_at: now });
    for (const key of modalities.flatMap((s) => STARTER[s] || [])) {
      const [sport, tname, structure, tags] = LIB[key];
      h.db.workout_templates.push({ id: h.uuid("tpl"), club_id: c.id, author_membership_id: m.id, sport, name: tname, description: null, structure, ...estimate(sport, structure), tags, created_at: now, updated_at: now, archived_at: null });
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
    if ("subdomain" in b && b.subdomain) {
      const sub = String(b.subdomain).toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(sub)) errors.push({ field: "subdomain", message: "Use de 3 a 32 letras, números ou hífens." });
      else if (h.db.clubs.some((x) => x.subdomain === sub && x.id !== c.id)) errors.push({ field: "subdomain", message: "Este endereço já está em uso." });
      else if (h.subscription(c.id).plan === "free") h.fail(402, "plan.required", "Disponível no plano Pro", "O endereço próprio (seuclube.runflow.club) faz parte do plano Pro.");
    }
    if (errors.length) h.invalid(errors);
    for (const k of ["name", "city", "timezone", "trainer_label"]) if (k in b) c[k] = typeof b[k] === "string" ? b[k].trim() || null : b[k];
    if ("state" in b) c.state = b.state ? String(b.state).toUpperCase() : null;
    if ("modalities" in b) c.modalities = b.modalities.filter((m) => SPORTS.includes(m));
    if ("subdomain" in b) c.subdomain = b.subdomain ? String(b.subdomain).toLowerCase() : null;
    c.updated_at = h.nowIso();
    return c;
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

  // ---- invites
  h.get("/v1/clubs/:club_id/invites", (ctx) => {
    ctx.staff(ctx.params.club_id);
    return { items: h.db.invitations.filter((i) => i.club_id === ctx.params.club_id && !i.revoked_at).map(inviteOut), next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/invites", (ctx) => {
    const m = ctx.staff(ctx.params.club_id);
    const role = ctx.body.role === "trainer" ? "trainer" : "student";
    if (role === "trainer" && m.role !== "owner") h.fail(403, "auth.forbidden", "Sem permissão", "Só o gestor convida treinadores.");
    const max = ctx.body.max_uses ? Number(ctx.body.max_uses) : null;
    const row = { id: h.uuid("inv"), club_id: ctx.params.club_id, role, token: inviteToken(), email: ctx.body.email || null, created_by: m.id, max_uses: max, uses: 0, expires_at: ctx.body.expires_at || null, revoked_at: null, created_at: h.nowIso() };
    h.db.invitations.push(row);
    return { __status: 201, data: inviteOut(row) };
  });
  h.delete("/v1/clubs/:club_id/invites/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const i = h.db.invitations.find((x) => x.id === ctx.params.id && x.club_id === ctx.params.club_id);
    if (!i) h.fail(404, "invite.not_found", "Convite não encontrado", "Ele pode já ter sido revogado.");
    i.revoked_at = h.nowIso();
  });
  const inviteState = (token) => {
    const i = h.db.invitations.find((x) => x.token === token);
    if (!i) h.fail(404, "invite.not_found", "Convite não encontrado", "Confira o link com quem te convidou.");
    const c = club(i.club_id);
    let reason = null;
    if (i.revoked_at) reason = "revoked";
    else if (i.expires_at && i.expires_at < h.nowIso()) reason = "expired";
    else if (i.max_uses && i.uses >= i.max_uses) reason = "used_up";
    else if (i.role === "student") { const s = h.subscription(c.id); if (s.active_students >= s.student_limit) reason = "club_full"; }
    return { i, c, reason };
  };
  h.get("/v1/public/invites/:token", (ctx) => {
    const { i, c, reason } = inviteState(ctx.params.token);
    const owner = h.db.memberships.find((m) => m.club_id === c.id && m.role === "owner");
    const ownerUser = owner && h.db.users.find((u) => u.id === owner.user_id);
    const already = ctx.auth ? h.db.memberships.find((m) => m.club_id === c.id && m.user_id === ctx.auth.user.id && m.status === "active") : null;
    return {
      club: { id: c.id, slug: c.slug, name: c.name, city: c.city, state: c.state, modalities: c.modalities, trainer_label: c.trainer_label },
      branding: h.branding(c.id), role: i.role, valid: !reason, reason, invited_by: ownerUser ? ownerUser.name : null,
      members: h.activeStudents(c.id), already_member: !!already,
    };
  });
  h.post("/v1/invites/:token/accept", (ctx) => {
    const u = ctx.user();
    const { i, c, reason } = inviteState(ctx.params.token);
    const existing = h.db.memberships.find((m) => m.club_id === c.id && m.user_id === u.id);
    if (existing && existing.status === "active") return { membership: existing, club: c, already_member: true };
    const messages = {
      revoked: ["Convite cancelado", "Peça um novo link para quem te convidou."],
      expired: ["Convite expirado", "Peça um novo link para quem te convidou."],
      used_up: ["Convite já utilizado", "Este link atingiu o limite de usos. Peça um novo."],
      club_full: ["O clube está lotado", "O clube atingiu o limite de alunos do plano. Avise o seu treinador."],
    };
    if (reason) h.fail(409, `invite.${reason}`, ...messages[reason]);
    const now = h.nowIso();
    let m = existing;
    if (m) Object.assign(m, { status: "active", role: i.role, left_at: null, joined_at: now });
    else { m = { id: h.uuid("m"), club_id: c.id, user_id: u.id, role: i.role, status: "active", is_billing_owner: false, joined_at: now, left_at: null }; h.db.memberships.push(m); }
    i.uses++;
    for (const staff of h.db.memberships.filter((x) => x.club_id === c.id && x.role !== "student" && x.status === "active"))
      h.db.notifications.push({ id: h.uuid("n"), user_id: staff.user_id, club_id: c.id, kind: "member_joined", title: `${u.name} entrou no clube`, body: i.role === "trainer" ? "Novo treinador na equipe." : null, link: i.role === "trainer" ? "/club/members" : "/students", read_at: null, created_at: now });
    return { __status: 201, data: { membership: m, club: c, already_member: false } };
  });
}
