/** Exercise library (F28): Runflow's global catalog + club exercises (a club version shadows a global one by name). */
const CATEGORIES = ["strength", "core", "mobility", "stretch", "plyometrics", "drill"];
/** Accepts YouTube (watch, youtu.be, shorts) and Vimeo links. */
export const videoOk = (u) => /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)[\w-]{6,}|youtu\.be\/[\w-]{6,}|vimeo\.com\/\d+)/.test(u);

export default function register(h) {
  const key = (s) => s.trim().toLowerCase();
  const visible = (clubId) => {
    const mine = h.db.exercises.filter((e) => e.club_id === clubId && !e.archived_at);
    const names = new Set(mine.map((e) => key(e.name)));
    return [...mine, ...h.db.exercises.filter((e) => e.club_id === null && !e.archived_at && !names.has(key(e.name)))];
  };
  const out = (e) => ({ ...e, scope: e.club_id ? "club" : "global" });
  const validate = (b, partial) => {
    const e = [];
    if ((!partial || "name" in b) && !String(b.name || "").trim()) e.push({ field: "name", message: "Dê um nome ao exercício." });
    if ((!partial || "category" in b) && !CATEGORIES.includes(b.category)) e.push({ field: "category", message: "Escolha a categoria." });
    if (b.video_url && !videoOk(b.video_url)) e.push({ field: "video_url", message: "Use um link do YouTube ou do Vimeo." });
    if (e.length) h.invalid(e);
  };
  const FIELDS = ["name", "category", "muscles", "equipment", "cues", "video_url"];

  h.get("/v1/clubs/:club_id/exercises", (ctx) => {
    ctx.member(ctx.params.club_id);
    const q = key(String(ctx.query.q || ""));
    const items = visible(ctx.params.club_id).filter((e) => (!ctx.query.category || e.category === ctx.query.category) && (!q || key(e.name).includes(q) || e.muscles.some((m) => m.includes(q))))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return { items: items.map(out), next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/exercises", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    validate(ctx.body, false);
    if (h.db.exercises.some((e) => e.club_id === me.club_id && !e.archived_at && key(e.name) === key(ctx.body.name))) h.invalid([{ field: "name", message: "O clube já tem um exercício com esse nome." }]);
    const e = { id: h.uuid("exercise"), club_id: me.club_id, muscles: [], equipment: [], cues: null, video_url: null, created_by: me.id, created_at: h.nowIso(), archived_at: null };
    for (const k of FIELDS) if (k in ctx.body) e[k] = ctx.body[k] === "" ? null : ctx.body[k];
    e.name = e.name.trim();
    h.db.exercises.push(e);
    return { __status: 201, data: out(e) };
  });
  const own = (ctx) => {
    ctx.staff(ctx.params.club_id);
    const e = h.db.exercises.find((x) => x.id === ctx.params.id && !x.archived_at);
    if (!e) h.fail(404, "exercise.not_found", "Exercício não encontrado", "Ele pode ter sido removido.");
    if (e.club_id !== ctx.params.club_id) h.fail(403, "exercise.global", "Exercício do catálogo Runflow", "Crie uma versão do clube para mudar o vídeo ou as dicas.");
    return e;
  };
  h.patch("/v1/clubs/:club_id/exercises/:id", (ctx) => { const e = own(ctx); validate(ctx.body, true); for (const k of FIELDS) if (k in ctx.body) e[k] = ctx.body[k] === "" ? null : ctx.body[k]; return out(e); });
  h.delete("/v1/clubs/:club_id/exercises/:id", (ctx) => { own(ctx).archived_at = h.nowIso(); });
}
