/** Workout library (templates). */
const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];
const MAX_TAGS = 8;
/** api/endpoints.md § Tags. */
export const normalizeTag = (raw) => String(raw).replace(/^#+/, "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : []).map(normalizeTag).filter(Boolean))];

export default function register(h) {
  const get = (clubId, id) => h.db.workout_templates.find((t) => t.id === id && t.club_id === clubId && !t.archived_at) || h.fail(404, "template.not_found", "Treino não encontrado", "Ele pode ter sido arquivado.");
  const validate = (b, partial) => {
    const errors = [];
    if (!partial || "name" in b) if (!String(b.name || "").trim()) errors.push({ field: "name", message: "Dê um nome ao treino." });
    if (!partial || "sport" in b) if (!SPORTS.includes(b.sport)) errors.push({ field: "sport", message: "Escolha a modalidade." });
    if (!partial || "structure" in b) if (!b.structure || b.structure.v !== 1 || !Array.isArray(b.structure.blocks) || !b.structure.blocks.length) errors.push({ field: "structure", message: "Adicione pelo menos uma etapa." });
    if ("tags" in b && cleanTags(b.tags).length > MAX_TAGS) errors.push({ field: "tags", message: "Use até 8 tags." });
    if (errors.length) h.invalid(errors);
  };
  h.get("/v1/clubs/:club_id/templates", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const raw = (ctx.query.q || "").trim(), q = raw.toLowerCase(), hash = raw.startsWith("#"), tq = normalizeTag(raw);
    const tag = ctx.query.tag ? normalizeTag(ctx.query.tag) : "";
    const items = h.db.workout_templates
      .filter((t) => t.club_id === ctx.params.club_id && !t.archived_at && (!ctx.query.sport || t.sport === ctx.query.sport) && (!tag || t.tags.includes(tag))
        && (!q || (!hash && t.name.toLowerCase().includes(q)) || (tq && t.tags.some((x) => x.includes(tq)))))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return h.list(items, ctx, 200);
  });
  h.get("/v1/clubs/:club_id/templates/:id", (ctx) => { ctx.staff(ctx.params.club_id); return get(ctx.params.club_id, ctx.params.id); });
  h.post("/v1/clubs/:club_id/templates", (ctx) => {
    const m = ctx.staff(ctx.params.club_id);
    validate(ctx.body, false);
    const now = h.nowIso();
    const row = { id: h.uuid("tpl"), club_id: ctx.params.club_id, author_membership_id: m.id, sport: ctx.body.sport, name: ctx.body.name.trim(), description: ctx.body.description || null, structure: ctx.body.structure, est_duration_s: ctx.body.est_duration_s ?? null, est_distance_m: ctx.body.est_distance_m ?? null, tags: cleanTags(ctx.body.tags), created_at: now, updated_at: now, archived_at: null };
    h.db.workout_templates.push(row);
    return { __status: 201, data: row };
  });
  h.patch("/v1/clubs/:club_id/templates/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const row = get(ctx.params.club_id, ctx.params.id);
    validate(ctx.body, true);
    for (const k of ["name", "sport", "description", "structure", "est_duration_s", "est_distance_m", "tags"]) if (k in ctx.body) row[k] = k === "name" ? ctx.body.name.trim() : k === "tags" ? cleanTags(ctx.body.tags) : ctx.body[k];
    row.updated_at = h.nowIso();
    return row;
  });
  h.delete("/v1/clubs/:club_id/templates/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    get(ctx.params.club_id, ctx.params.id).archived_at = h.nowIso();
  });
}
