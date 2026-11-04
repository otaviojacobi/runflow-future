/** Members (owner), groups, and the trainer's students list (/athletes). */
export default function register(h) {
  const userOf = (m) => h.db.users.find((u) => u.id === m.user_id);
  const groupsOf = (mid) => h.db.group_members.filter((g) => g.membership_id === mid).map((g) => g.group_id);
  const memberOut = (m) => ({ membership: m, user: h.publicUser(userOf(m)), group_ids: groupsOf(m.id) });
  const getMember = (clubId, id) => h.db.memberships.find((m) => m.id === id && m.club_id === clubId) || h.fail(404, "member.not_found", "Membro não encontrado", "Ele pode ter saído do clube.");

  // ---- members (owner)
  h.get("/v1/clubs/:club_id/members", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const q = (ctx.query.q || "").toLowerCase();
    const items = h.db.memberships
      .filter((m) => m.club_id === ctx.params.club_id && (ctx.query.status ? m.status === ctx.query.status : m.status !== "left") && (!ctx.query.role || ctx.query.role.split(",").includes(m.role)))
      .map(memberOut)
      .filter((x) => !q || x.user.name.toLowerCase().includes(q) || x.user.email.toLowerCase().includes(q))
      .sort((a, b) => ["owner", "trainer", "student"].indexOf(a.membership.role) - ["owner", "trainer", "student"].indexOf(b.membership.role) || a.user.name.localeCompare(b.user.name, "pt-BR"));
    return h.list(items, ctx, 500);
  });
  h.patch("/v1/clubs/:club_id/members/:id", (ctx) => {
    const me = ctx.owner(ctx.params.club_id);
    const m = getMember(ctx.params.club_id, ctx.params.id);
    if (m.id === me.id) h.fail(409, "member.self", "Não é possível alterar o próprio acesso", "Peça a outro gestor para fazer essa mudança.");
    const { role, status } = ctx.body;
    if (role === "owner") h.invalid([{ field: "role", message: "Cada clube tem um único responsável." }]);
    if (role !== undefined && !["trainer", "student"].includes(role)) h.invalid([{ field: "role", message: "Papel inválido." }]);
    if (status !== undefined && !["active", "suspended"].includes(status)) h.invalid([{ field: "status", message: "Situação inválida." }]);
    // Taking a seat (reactivated, or moved to another role) counts against the plan (D-043).
    const nextRole = role ?? m.role, nextStatus = status ?? m.status;
    if (nextStatus === "active" && (m.status !== "active" || nextRole !== m.role)) h.ensureSeat(ctx.params.club_id, nextRole);
    if (role) m.role = role;
    if (status) m.status = status;
    // A suspended (or no longer student) person's Strava sync no club sees is disconnected (D-011).
    h.enforceStravaSharing(m.user_id);
    h.db.audit_log.push({ id: h.db.audit_log.length + 1, club_id: m.club_id, actor_user_id: ctx.user().id, action: "member.updated", target_type: "membership", target_id: m.id, data: { role, status }, created_at: h.nowIso() });
    return memberOut(m);
  });
  h.delete("/v1/clubs/:club_id/members/:id", (ctx) => {
    const me = ctx.owner(ctx.params.club_id);
    const m = getMember(ctx.params.club_id, ctx.params.id);
    if (m.id === me.id) h.fail(409, "member.self", "Você não pode se remover", "Para sair, transfira a gestão do clube primeiro.");
    Object.assign(m, { status: "left", left_at: h.nowIso() });
    h.db.group_members = h.db.group_members.filter((g) => g.membership_id !== m.id);
    h.enforceStravaSharing(m.user_id);
    h.db.audit_log.push({ id: h.db.audit_log.length + 1, club_id: m.club_id, actor_user_id: ctx.user().id, action: "member.removed", target_type: "membership", target_id: m.id, data: null, created_at: h.nowIso() });
  });

  // ---- groups
  const groupOut = (g) => ({ ...g, member_ids: h.db.group_members.filter((x) => x.group_id === g.id).map((x) => x.membership_id) });
  const getGroup = (clubId, id) => h.db.groups.find((g) => g.id === id && g.club_id === clubId) || h.fail(404, "group.not_found", "Grupo não encontrado", "Ele pode ter sido excluído.");
  h.get("/v1/clubs/:club_id/groups", (ctx) => { ctx.staff(ctx.params.club_id); return { items: h.db.groups.filter((g) => g.club_id === ctx.params.club_id).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(groupOut), next_cursor: null }; });
  h.post("/v1/clubs/:club_id/groups", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const name = h.str(ctx.body, "name", "o nome do grupo", { max: 60 });
    if (h.db.groups.some((g) => g.club_id === ctx.params.club_id && g.name.toLowerCase() === name.toLowerCase())) h.invalid([{ field: "name", message: "Já existe um grupo com esse nome." }]);
    const g = { id: h.uuid("group"), club_id: ctx.params.club_id, name, description: ctx.body.description || null, created_at: h.nowIso() };
    h.db.groups.push(g);
    return { __status: 201, data: groupOut(g) };
  });
  h.patch("/v1/clubs/:club_id/groups/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const g = getGroup(ctx.params.club_id, ctx.params.id);
    if ("name" in ctx.body) g.name = h.str(ctx.body, "name", "o nome do grupo", { max: 60 });
    if ("description" in ctx.body) g.description = ctx.body.description || null;
    return groupOut(g);
  });
  h.delete("/v1/clubs/:club_id/groups/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const g = getGroup(ctx.params.club_id, ctx.params.id);
    h.db.groups = h.db.groups.filter((x) => x.id !== g.id);
    h.db.group_members = h.db.group_members.filter((x) => x.group_id !== g.id);
  });
  h.put("/v1/clubs/:club_id/groups/:id/members", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const g = getGroup(ctx.params.club_id, ctx.params.id);
    const ids = Array.isArray(ctx.body.membership_ids) ? ctx.body.membership_ids : [];
    const valid = new Set(h.db.memberships.filter((m) => m.club_id === g.club_id && m.status !== "left").map((m) => m.id));
    h.db.group_members = h.db.group_members.filter((x) => x.group_id !== g.id).concat(ids.filter((id) => valid.has(id)).map((membership_id) => ({ group_id: g.id, membership_id, added_at: h.nowIso() })));
    return groupOut(g);
  });

  // ---- students list for trainers (W2, W4)
  /** Per-student stats; exported for the dashboard (F13). */
  h.athleteSummary = (m, today = h.today()) => {
    const u = userOf(m);
    const since = h.addDays(today, -28);
    const planned = h.db.planned_workouts.filter((p) => p.athlete_membership_id === m.id);
    const past = planned.filter((p) => p.date >= since && p.date < today);
    const comp = (p) => h.db.workout_completions.find((c) => c.planned_workout_id === p.id);
    const score = past.reduce((s, p) => { const c = comp(p); return s + (c?.status === "completed" ? 1 : c?.status === "partial" ? 0.5 : 0); }, 0);
    const monday = h.mondayOf(today), sunday = h.addDays(monday, 6);
    const week = planned.filter((p) => p.date >= monday && p.date <= sunday);
    const shares = h.db.consents.some((c) => c.user_id === u.id && c.club_id === m.club_id && c.kind === "share_training_data" && !c.revoked_at);
    const stravaShared = h.db.consents.some((c) => c.user_id === u.id && c.club_id === m.club_id && c.kind === "share_strava" && !c.revoked_at);
    const acts = h.db.activities.filter((a) => a.user_id === u.id && (a.source !== "strava" || stravaShared)).sort((a, b) => b.started_at.localeCompare(a.started_at));
    const profile = h.db.athlete_profiles.find((p) => p.membership_id === m.id);
    const conn = h.db.provider_connections.find((c) => c.user_id === u.id && c.provider === "strava" && c.status === "active");
    return {
      membership: m, user: h.publicUser(u), group_ids: groupsOf(m.id),
      goal: profile?.goal ?? null, level: profile?.level ?? null,
      compliance_pct: past.length ? Math.round((score / past.length) * 100) : null,
      week: { planned: week.length, done: week.filter((p) => ["completed", "partial"].includes(comp(p)?.status)).length },
      last_activity_at: shares ? acts[0]?.started_at ?? null : null,
      strava: conn ? (stravaShared ? "shared" : "private") : "none",
      shares_data: shares,
    };
  };
  h.get("/v1/clubs/:club_id/athletes", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const q = (ctx.query.q || "").toLowerCase();
    const inGroup = ctx.query.group_id ? new Set(h.db.group_members.filter((g) => g.group_id === ctx.query.group_id).map((g) => g.membership_id)) : null;
    const items = h.db.memberships
      .filter((m) => m.club_id === ctx.params.club_id && m.role === "student" && m.status === "active" && (!inGroup || inGroup.has(m.id)))
      .map((m) => h.athleteSummary(m))
      .filter((a) => !q || a.user.name.toLowerCase().includes(q))
      .sort((a, b) => a.user.name.localeCompare(b.user.name, "pt-BR"));
    return h.list(items, ctx, 500);
  });
}
