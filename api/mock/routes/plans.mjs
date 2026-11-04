/** Planilhas: multi-week training plans, items grid, assignments that materialize planned workouts. */
const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];
export default function register(h) {
  const get = (clubId, id) => h.db.training_plans.find((p) => p.id === id && p.club_id === clubId && !p.archived_at) || h.fail(404, "plan.not_found", "Planilha não encontrada", "Ela pode ter sido arquivada.");
  const assignmentsOf = (planId) => h.db.plan_assignments.filter((a) => a.plan_id === planId).map((a) => {
    const m = h.db.memberships.find((x) => x.id === a.athlete_membership_id);
    const ws = h.db.planned_workouts.filter((p) => p.plan_assignment_id === a.id);
    return { ...a, athlete: { membership_id: m.id, user: h.publicUser(h.db.users.find((u) => u.id === m.user_id)) }, workouts: ws.length, done: ws.filter((p) => ["completed", "partial"].includes(h.db.workout_completions.find((c) => c.planned_workout_id === p.id)?.status)).length };
  });
  const summary = (p) => {
    const items = h.db.training_plan_items.filter((i) => i.plan_id === p.id);
    return { ...p, items_count: items.length, weekly_duration_s: Array.from({ length: p.weeks }, (_, w) => items.filter((i) => i.week === w + 1).reduce((s, i) => s + (i.est_duration_s || 0), 0)), active_assignments: h.db.plan_assignments.filter((a) => a.plan_id === p.id).length };
  };
  h.get("/v1/clubs/:club_id/plans", (ctx) => { ctx.staff(ctx.params.club_id); return { items: h.db.training_plans.filter((p) => p.club_id === ctx.params.club_id && !p.archived_at).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(summary), next_cursor: null }; });
  h.post("/v1/clubs/:club_id/plans", (ctx) => {
    const m = ctx.staff(ctx.params.club_id);
    const name = h.str(ctx.body, "name", "o nome da planilha", { max: 80 });
    const weeks = Number(ctx.body.weeks);
    if (!(weeks >= 1 && weeks <= 52)) h.invalid([{ field: "weeks", message: "De 1 a 52 semanas." }]);
    const now = h.nowIso();
    const p = { id: h.uuid("plan"), club_id: ctx.params.club_id, author_membership_id: m.id, name, description: ctx.body.description || null, weeks, created_at: now, updated_at: now, archived_at: null };
    h.db.training_plans.push(p);
    return { __status: 201, data: summary(p) };
  });
  h.get("/v1/clubs/:club_id/plans/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const p = get(ctx.params.club_id, ctx.params.id);
    return { ...summary(p), items: h.db.training_plan_items.filter((i) => i.plan_id === p.id).sort((a, b) => a.week - b.week || a.weekday - b.weekday), assignments: assignmentsOf(p.id) };
  });
  h.patch("/v1/clubs/:club_id/plans/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const p = get(ctx.params.club_id, ctx.params.id);
    if ("name" in ctx.body) p.name = h.str(ctx.body, "name", "o nome da planilha", { max: 80 });
    if ("description" in ctx.body) p.description = ctx.body.description || null;
    if ("weeks" in ctx.body) {
      const w = Number(ctx.body.weeks);
      if (!(w >= 1 && w <= 52)) h.invalid([{ field: "weeks", message: "De 1 a 52 semanas." }]);
      p.weeks = w;
      h.db.training_plan_items = h.db.training_plan_items.filter((i) => i.plan_id !== p.id || i.week <= w);
    }
    p.updated_at = h.nowIso();
    return summary(p);
  });
  h.delete("/v1/clubs/:club_id/plans/:id", (ctx) => { ctx.staff(ctx.params.club_id); get(ctx.params.club_id, ctx.params.id).archived_at = h.nowIso(); });
  h.put("/v1/clubs/:club_id/plans/:id/items", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const p = get(ctx.params.club_id, ctx.params.id);
    const items = Array.isArray(ctx.body.items) ? ctx.body.items : [];
    for (const it of items) {
      if (!(it.week >= 1 && it.week <= p.weeks) || !(it.weekday >= 1 && it.weekday <= 7) || !SPORTS.includes(it.sport) || !String(it.title || "").trim() || !it.structure?.blocks?.length)
        h.invalid([{ field: "items", message: "Há um treino inválido na planilha." }]);
    }
    h.db.training_plan_items = h.db.training_plan_items.filter((i) => i.plan_id !== p.id).concat(items.map((it) => ({ id: it.id && !String(it.id).startsWith("new") ? it.id : h.uuid("pi"), plan_id: p.id, week: it.week, weekday: it.weekday, template_id: it.template_id || null, sport: it.sport, title: it.title.trim(), structure: it.structure, est_duration_s: it.est_duration_s ?? null, est_distance_m: it.est_distance_m ?? null, notes: it.notes || null })));
    p.updated_at = h.nowIso();
    return { ...summary(p), items: h.db.training_plan_items.filter((i) => i.plan_id === p.id) };
  });
  h.post("/v1/clubs/:club_id/plans/:id/assign", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const p = get(ctx.params.club_id, ctx.params.id);
    const start = ctx.body.start_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || h.mondayOf(start) !== start) h.invalid([{ field: "start_date", message: "Escolha uma segunda-feira para começar." }]);
    const students = new Set(h.db.memberships.filter((m) => m.club_id === p.club_id && m.role === "student" && m.status === "active").map((m) => m.id));
    let ids = Array.isArray(ctx.body.athlete_ids) ? ctx.body.athlete_ids : [];
    if (ctx.body.group_id) ids = ids.concat(h.db.group_members.filter((g) => g.group_id === ctx.body.group_id).map((g) => g.membership_id));
    ids = [...new Set(ids)].filter((id) => students.has(id));
    if (!ids.length) h.invalid([{ field: "athlete_ids", message: "Escolha pelo menos um aluno." }]);
    const items = h.db.training_plan_items.filter((i) => i.plan_id === p.id);
    if (!items.length) h.fail(409, "plan.empty", "A planilha está vazia", "Adicione treinos antes de aplicar.");
    const now = h.nowIso();
    let created = 0;
    const rows = [];
    for (const athlete of ids) {
      const a = { id: h.uuid("pa"), plan_id: p.id, athlete_membership_id: athlete, start_date: start, created_by: me.id, created_at: now };
      h.db.plan_assignments.push(a);
      for (const it of items) {
        const date = h.addDays(start, (it.week - 1) * 7 + it.weekday - 1);
        const row = { id: h.uuid("pw"), club_id: p.club_id, athlete_membership_id: athlete, date, position: h.db.planned_workouts.filter((x) => x.athlete_membership_id === athlete && x.date === date).length, sport: it.sport, title: it.title, structure: it.structure, notes: it.notes, est_duration_s: it.est_duration_s, est_distance_m: it.est_distance_m, template_id: it.template_id, plan_assignment_id: a.id, created_by: me.id, created_at: now, updated_at: now };
        h.db.planned_workouts.push(row);
        rows.push(row);
        created++;
      }
      // Announced now only if the first week is already visible; otherwise its release does it (D-031).
      if (!h.isReleased(p.club_id, athlete, start)) continue;
      const u = h.db.memberships.find((x) => x.id === athlete);
      h.notify({ id: h.uuid("n"), user_id: u.user_id, club_id: p.club_id, kind: "workout_assigned", title: `Nova planilha: ${p.name}`, body: `${p.weeks} semanas a partir de ${start.split("-").reverse().slice(0, 2).join("/")}`, link: "/schedule", read_at: null, created_at: now });
    }
    h.rematchWorkouts(rows);
    return { __status: 201, data: { assignments: ids.length, workouts: created } };
  });
  h.delete("/v1/clubs/:club_id/plans/:id/assignments/:aid", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const a = h.db.plan_assignments.find((x) => x.id === ctx.params.aid && x.plan_id === ctx.params.id) || h.fail(404, "assignment.not_found", "Aplicação não encontrada", "Ela pode já ter sido removida.");
    const today = h.today();
    const future = new Set(h.db.planned_workouts.filter((p) => p.plan_assignment_id === a.id && p.date >= today && !h.db.workout_completions.some((c) => c.planned_workout_id === p.id)).map((p) => p.id));
    const removed = h.db.planned_workouts.filter((p) => future.has(p.id));
    h.db.planned_workouts = h.db.planned_workouts.filter((p) => !future.has(p.id));
    h.db.activity_match_options = h.db.activity_match_options.filter((o) => !future.has(o.planned_workout_id));
    h.rematchWorkouts(removed);
    for (const p of h.db.planned_workouts) if (p.plan_assignment_id === a.id) p.plan_assignment_id = null;
    h.db.plan_assignments = h.db.plan_assignments.filter((x) => x.id !== a.id);
    return { __status: 200, data: { removed_workouts: future.size } };
  });
}
