/** Planned workouts (calendar, assign, move, copy week) for trainers. Student endpoints arrive in F10. */
const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function register(h) {
  const comp = (pwId) => h.db.workout_completions.find((c) => c.planned_workout_id === pwId) || null;
  const threadInfo = (pw, membershipId) => {
    const cs = h.db.comments.filter((c) => c.planned_workout_id === pw.id && !c.deleted_at);
    const read = h.db.thread_reads.find((r) => r.membership_id === membershipId && r.planned_workout_id === pw.id);
    return { comments_count: cs.length, unread_count: cs.filter((c) => c.author_membership_id !== membershipId && (!read || c.created_at > read.last_read_at)).length };
  };
  /** A planned workout as the API returns it (row + completion + thread counters). */
  h.workoutOut = (pw, viewerMembershipId) => ({ ...pw, completion: comp(pw.id), ...threadInfo(pw, viewerMembershipId), visible: h.visible(pw) });
  const get = (clubId, id) => h.db.planned_workouts.find((p) => p.id === id && p.club_id === clubId) || h.fail(404, "workout.not_found", "Treino não encontrado", "Ele pode ter sido removido pelo treinador.");
  const students = (clubId) => new Set(h.db.memberships.filter((m) => m.club_id === clubId && m.role === "student" && m.status === "active").map((m) => m.id));
  const notify = (pw, kind, title) => {
    const m = h.db.memberships.find((x) => x.id === pw.athlete_membership_id);
    if (m) h.notify({ id: h.uuid("n"), user_id: m.user_id, club_id: pw.club_id, kind, title, body: pw.title, link: `/workouts/${pw.id}`, read_at: null, created_at: h.nowIso() });
  };
  const validContent = (b) => {
    const errors = [];
    if (!SPORTS.includes(b.sport)) errors.push({ field: "sport", message: "Escolha a modalidade." });
    if (!String(b.title || "").trim()) errors.push({ field: "title", message: "Dê um nome ao treino." });
    if (!b.structure || b.structure.v !== 1 || !Array.isArray(b.structure.blocks) || !b.structure.blocks.length) errors.push({ field: "structure", message: "Adicione pelo menos uma etapa." });
    if (errors.length) h.invalid(errors);
  };

  h.get("/v1/clubs/:club_id/planned-workouts", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    h.autoRelease();
    const { from, to, athlete_id, group_id } = ctx.query;
    if (!DATE.test(from || "") || !DATE.test(to || "")) h.invalid([{ field: "from", message: "Informe o período (from e to)." }]);
    const inGroup = group_id ? new Set(h.db.group_members.filter((g) => g.group_id === group_id).map((g) => g.membership_id)) : null;
    const items = h.db.planned_workouts
      .filter((p) => p.club_id === ctx.params.club_id && p.date >= from && p.date <= to && (!athlete_id || p.athlete_membership_id === athlete_id) && (!inGroup || inGroup.has(p.athlete_membership_id)))
      .sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position)
      .map((p) => h.workoutOut(p, me.id));
    return { items, next_cursor: null };
  });

  h.post("/v1/clubs/:club_id/planned-workouts", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const b = ctx.body;
    const valid = students(ctx.params.club_id);
    let ids = Array.isArray(b.athlete_ids) ? b.athlete_ids : [];
    if (b.group_id) ids = ids.concat(h.db.group_members.filter((g) => g.group_id === b.group_id).map((g) => g.membership_id));
    ids = [...new Set(ids)].filter((id) => valid.has(id));
    const dates = (Array.isArray(b.dates) ? b.dates : []).filter((d) => DATE.test(d));
    const errors = [];
    if (!ids.length) errors.push({ field: "athlete_ids", message: "Escolha pelo menos um aluno." });
    if (!dates.length) errors.push({ field: "dates", message: "Escolha pelo menos um dia." });
    if (errors.length) h.invalid(errors);
    let content;
    if (b.template_id) {
      const tpl = h.db.workout_templates.find((x) => x.id === b.template_id && x.club_id === ctx.params.club_id && !x.archived_at);
      if (!tpl) h.fail(404, "template.not_found", "Treino da biblioteca não encontrado", "Ele pode ter sido arquivado.");
      content = { sport: tpl.sport, title: tpl.name, structure: tpl.structure, est_duration_s: tpl.est_duration_s, est_distance_m: tpl.est_distance_m, template_id: tpl.id, notes: b.notes ?? tpl.description ?? null };
    } else {
      validContent(b);
      content = { sport: b.sport, title: b.title.trim(), structure: b.structure, est_duration_s: b.est_duration_s ?? null, est_distance_m: b.est_distance_m ?? null, template_id: null, notes: b.notes || null };
    }
    const now = h.nowIso();
    const created = [];
    for (const athlete of ids) for (const date of dates) {
      const position = h.db.planned_workouts.filter((p) => p.athlete_membership_id === athlete && p.date === date).length;
      const row = { id: h.uuid("pw"), club_id: ctx.params.club_id, athlete_membership_id: athlete, date, position, ...content, plan_assignment_id: null, created_by: me.id, created_at: now, updated_at: now };
      h.db.planned_workouts.push(row);
      created.push(row);
    }
    // Only what the student can already see (D-031): drafts are announced by the week's release.
    for (const athlete of ids) {
      const seen = created.filter((c) => c.athlete_membership_id === athlete && h.visible(c));
      if (seen.length) notify(seen[0], "workout_assigned", seen.length > 1 ? `${seen.length} novos treinos na sua agenda` : "Novo treino na sua agenda");
    }
    return { __status: 201, data: { items: created.map((p) => h.workoutOut(p, me.id)), next_cursor: null } };
  });

  h.get("/v1/clubs/:club_id/planned-workouts/:id", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const pw = get(ctx.params.club_id, ctx.params.id);
    const m = h.db.memberships.find((x) => x.id === pw.athlete_membership_id);
    const shared = h.db.consents.some((c) => c.user_id === m.user_id && c.club_id === pw.club_id && c.kind === "share_training_data" && !c.revoked_at);
    const c = comp(pw.id);
    const activity = shared && c?.activity_id ? h.db.activities.find((a) => a.id === c.activity_id) : null;
    return { ...h.workoutOut(pw, me.id), athlete: { membership_id: m.id, user: h.publicUser(h.db.users.find((u) => u.id === m.user_id)) }, activity: activity || null };
  });
  h.patch("/v1/clubs/:club_id/planned-workouts/:id", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const pw = get(ctx.params.club_id, ctx.params.id);
    const b = ctx.body;
    if ("date" in b && !DATE.test(b.date)) h.invalid([{ field: "date", message: "Data inválida." }]);
    if ("structure" in b || "title" in b || "sport" in b) validContent({ sport: b.sport ?? pw.sport, title: b.title ?? pw.title, structure: b.structure ?? pw.structure });
    const moved = "date" in b && b.date !== pw.date;
    for (const k of ["date", "sport", "title", "structure", "notes", "est_duration_s", "est_distance_m", "position"]) if (k in b) pw[k] = k === "title" ? b.title.trim() : b[k];
    pw.updated_at = h.nowIso();
    if ((moved || "structure" in b) && h.visible(pw)) notify(pw, "workout_changed", moved ? "Um treino mudou de dia" : "Seu treinador ajustou um treino");
    return h.workoutOut(pw, me.id);
  });
  h.delete("/v1/clubs/:club_id/planned-workouts/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const pw = get(ctx.params.club_id, ctx.params.id);
    h.db.planned_workouts = h.db.planned_workouts.filter((p) => p.id !== pw.id);
    h.db.workout_completions = h.db.workout_completions.filter((c) => c.planned_workout_id !== pw.id);
    h.db.comments = h.db.comments.filter((c) => c.planned_workout_id !== pw.id);
    h.db.thread_reads = h.db.thread_reads.filter((r) => r.planned_workout_id !== pw.id);
  });
  h.post("/v1/clubs/:club_id/planned-workouts/copy-week", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const { from_monday, to_monday } = ctx.body;
    if (!DATE.test(from_monday || "") || !DATE.test(to_monday || "")) h.invalid([{ field: "to_monday", message: "Escolha a semana de destino." }]);
    if (from_monday === to_monday) h.invalid([{ field: "to_monday", message: "Escolha uma semana diferente." }]);
    const athletes = new Set(Array.isArray(ctx.body.athlete_ids) && ctx.body.athlete_ids.length ? ctx.body.athlete_ids : [...students(ctx.params.club_id)]);
    const shift = h.daysBetween(from_monday, to_monday);
    const source = h.db.planned_workouts.filter((p) => p.club_id === ctx.params.club_id && athletes.has(p.athlete_membership_id) && p.date >= from_monday && p.date <= h.addDays(from_monday, 6));
    const now = h.nowIso();
    const created = source.map((p) => ({ ...structuredClone(p), id: h.uuid("pw"), date: h.addDays(p.date, shift), plan_assignment_id: null, created_by: me.id, created_at: now, updated_at: now }));
    h.db.planned_workouts.push(...created);
    return { __status: 201, data: { copied: created.length } };
  });
}
