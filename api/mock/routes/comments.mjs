/** Workout threads (student ⇄ trainers). GET marks the thread as read for the caller. */
export default function register(h) {
  const access = (ctx) => {
    const m = ctx.member(ctx.params.club_id);
    const p = h.db.planned_workouts.find((x) => x.id === ctx.params.id && x.club_id === ctx.params.club_id);
    if (!p || (m.role === "student" && (p.athlete_membership_id !== m.id || !h.visible(p)))) h.fail(404, "workout.not_found", "Treino não encontrado", "Ele pode ter sido removido.");
    return { m, p };
  };
  const out = (c) => {
    const am = h.db.memberships.find((x) => x.id === c.author_membership_id);
    return { ...c, author: { membership_id: am.id, role: am.role, user: h.publicUser(h.db.users.find((u) => u.id === am.user_id)) } };
  };
  const markRead = (mid, pid) => {
    const r = h.db.thread_reads.find((x) => x.membership_id === mid && x.planned_workout_id === pid);
    if (r) r.last_read_at = h.nowIso(); else h.db.thread_reads.push({ membership_id: mid, planned_workout_id: pid, last_read_at: h.nowIso() });
  };
  h.get("/v1/clubs/:club_id/planned-workouts/:id/comments", (ctx) => {
    const { m, p } = access(ctx);
    const items = h.db.comments.filter((c) => c.planned_workout_id === p.id && !c.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(out);
    markRead(m.id, p.id);
    h.persist();
    return { items, next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/planned-workouts/:id/comments", (ctx) => {
    const { m, p } = access(ctx);
    const body = String(ctx.body.body || "").trim();
    if (!body) h.invalid([{ field: "body", message: "Escreva uma mensagem." }]);
    if (body.length > 4000) h.invalid([{ field: "body", message: "Use no máximo 4.000 caracteres." }]);
    const c = { id: h.uuid("c"), planned_workout_id: p.id, author_membership_id: m.id, body, created_at: h.nowIso(), edited_at: null, deleted_at: null };
    h.db.comments.push(c);
    markRead(m.id, p.id);
    const author = h.db.users.find((u) => u.id === m.user_id);
    const recipients = m.role === "student"
      ? h.db.memberships.filter((x) => x.club_id === p.club_id && x.role !== "student" && x.status === "active").map((x) => x.user_id)
      : [h.db.memberships.find((x) => x.id === p.athlete_membership_id)?.user_id].filter(Boolean);
    // A student's message is feedback for the staff (pushed by default); the staff's reply is a comment for the student.
    for (const uid of recipients) h.notify({ id: h.uuid("n"), user_id: uid, club_id: p.club_id, kind: m.role === "student" ? "feedback" : "comment", title: `${author.name} comentou no treino`, body: body.slice(0, 120), link: m.role === "student" ? `/feedback?workout=${p.id}` : `/workouts/${p.id}?conversa=1`, read_at: null, created_at: c.created_at });
    return { __status: 201, data: out(c) };
  });
}
