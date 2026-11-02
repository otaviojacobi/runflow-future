/** Messages (F22): one conversation per student shared by the club staff, and club announcements (mural). */
export default function register(h) {
  const userOfM = (mid) => { const m = h.db.memberships.find((x) => x.id === mid); return m ? h.publicUser(h.db.users.find((u) => u.id === m.user_id)) : null; };
  const staffOf = (clubId) => h.db.memberships.filter((m) => m.club_id === clubId && h.STAFF.includes(m.role) && m.status === "active");
  const notify = (m, clubId, kind, title, body, link) => h.db.notifications.push({ id: h.uuid("n"), user_id: m.user_id, club_id: clubId, kind, title, body, link, read_at: null, created_at: h.nowIso() });
  const preview = (s) => (s.length > 90 ? s.slice(0, 87) + "…" : s);

  // ---- conversations
  const readOf = (cid, mid) => h.db.conversation_reads.find((r) => r.conversation_id === cid && r.membership_id === mid);
  const msgsOf = (cid) => h.db.messages.filter((x) => x.conversation_id === cid).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const unread = (c, viewer) => { const r = readOf(c.id, viewer.id)?.last_read_at ?? ""; return msgsOf(c.id).filter((x) => !x.deleted_at && x.author_membership_id !== viewer.id && x.created_at > r).length; };
  const msgOut = (x) => ({ ...x, body: x.deleted_at ? "" : x.body, author: { membership_id: x.author_membership_id, role: h.db.memberships.find((m) => m.id === x.author_membership_id)?.role, user: userOfM(x.author_membership_id) } });
  const summary = (c, viewer) => { const last = msgsOf(c.id).at(-1); return { ...c, student: { membership_id: c.student_membership_id, user: userOfM(c.student_membership_id) }, last_message: last ? msgOut(last) : null, unread_count: unread(c, viewer) }; };
  const getOrCreate = (clubId, studentMid) => {
    let c = h.db.conversations.find((x) => x.club_id === clubId && x.student_membership_id === studentMid);
    if (!c) { c = { id: h.uuid("conv"), club_id: clubId, student_membership_id: studentMid, last_message_at: null, created_at: h.nowIso() }; h.db.conversations.push(c); }
    return c;
  };
  const access = (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const c = h.db.conversations.find((x) => x.id === ctx.params.id && x.club_id === ctx.params.club_id);
    if (!c || (me.role === "student" && c.student_membership_id !== me.id)) h.fail(404, "conversation.not_found", "Conversa não encontrada", "Ela pode ter sido removida.");
    return { me, c };
  };

  h.get("/v1/clubs/:club_id/conversations", (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    if (me.role === "student") return { items: [summary(getOrCreate(me.club_id, me.id), me)], next_cursor: null };
    // Staff: every active student, conversations with messages first (newest), then the rest by name.
    const q = String(ctx.query.q || "").toLowerCase();
    const students = h.db.memberships.filter((m) => m.club_id === me.club_id && m.role === "student" && m.status === "active");
    const items = students.map((m) => { const c = h.db.conversations.find((x) => x.club_id === me.club_id && x.student_membership_id === m.id); return c ? summary(c, me) : { id: null, club_id: me.club_id, student_membership_id: m.id, last_message_at: null, created_at: null, student: { membership_id: m.id, user: userOfM(m.id) }, last_message: null, unread_count: 0 }; })
      .filter((x) => !q || x.student.user.name.toLowerCase().includes(q))
      .sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "") || a.student.user.name.localeCompare(b.student.user.name));
    return { items, next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/conversations", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const sid = ctx.body.student_membership_id;
    if (!h.db.memberships.some((m) => m.id === sid && m.club_id === me.club_id && m.role === "student" && m.status === "active")) h.invalid([{ field: "student_membership_id", message: "Escolha o aluno." }]);
    return summary(getOrCreate(me.club_id, sid), me);
  });
  h.get("/v1/clubs/:club_id/conversations/:id", (ctx) => {
    const { me, c } = access(ctx);
    const reads = h.db.conversation_reads.filter((r) => r.conversation_id === c.id && r.membership_id !== me.id).map((r) => ({ membership_id: r.membership_id, user: userOfM(r.membership_id), role: h.db.memberships.find((m) => m.id === r.membership_id)?.role, last_read_at: r.last_read_at }));
    return { ...summary(c, me), messages: msgsOf(c.id).map(msgOut), reads };
  });
  h.post("/v1/clubs/:club_id/conversations/:id/messages", (ctx) => {
    const { me, c } = access(ctx);
    const body = String(ctx.body.body || "").trim();
    if (!body) h.invalid([{ field: "body", message: "Escreva uma mensagem." }]);
    if (body.length > 4000) h.invalid([{ field: "body", message: "Mensagem muito longa (máximo 4.000 caracteres)." }]);
    const x = { id: h.uuid("msg"), conversation_id: c.id, author_membership_id: me.id, body, created_at: h.nowIso(), deleted_at: null };
    h.db.messages.push(x);
    c.last_message_at = x.created_at;
    const r = readOf(c.id, me.id); if (r) r.last_read_at = x.created_at; else h.db.conversation_reads.push({ conversation_id: c.id, membership_id: me.id, last_read_at: x.created_at });
    const author = userOfM(me.id);
    if (me.role === "student") for (const s of staffOf(c.club_id)) notify(s, c.club_id, "message", `Mensagem de ${author.name}`, preview(body), `/messages?c=${c.id}`);
    else notify(h.db.memberships.find((m) => m.id === c.student_membership_id), c.club_id, "message", `${author.name.split(" ")[0]} respondeu`, preview(body), `/messages?c=${c.id}`);
    return { __status: 201, data: msgOut(x) };
  });
  h.post("/v1/clubs/:club_id/conversations/:id/read", (ctx) => {
    const { me, c } = access(ctx);
    const now = h.nowIso();
    const r = readOf(c.id, me.id); if (r) r.last_read_at = now; else h.db.conversation_reads.push({ conversation_id: c.id, membership_id: me.id, last_read_at: now });
  });
  h.delete("/v1/clubs/:club_id/messages/:id", (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const x = h.db.messages.find((m) => m.id === ctx.params.id && m.author_membership_id === me.id);
    if (!x) h.fail(404, "message.not_found", "Mensagem não encontrada", "Só quem escreveu pode apagar.");
    x.deleted_at = h.nowIso();
  });

  // ---- announcements (mural)
  const groupsOf = (mid) => new Set(h.db.group_members.filter((g) => g.membership_id === mid).map((g) => g.group_id));
  const audience = (a) => h.db.memberships.filter((m) => m.club_id === a.club_id && m.role === "student" && m.status === "active" && (!a.group_ids.length || a.group_ids.some((g) => groupsOf(m.id).has(g))));
  const annOut = (a, viewer) => {
    const reads = h.db.announcement_reads.filter((r) => r.announcement_id === a.id);
    const base = { ...a, author: { membership_id: a.author_membership_id, user: userOfM(a.author_membership_id) }, read_at: reads.find((r) => r.membership_id === viewer.id)?.read_at ?? null };
    if (viewer.role === "student") return base;
    const aud = audience(a);
    return { ...base, audience_count: aud.length, reads_count: reads.filter((r) => aud.some((m) => m.id === r.membership_id)).length };
  };
  const ownAnn = (ctx) => h.db.announcements.find((a) => a.id === ctx.params.id && a.club_id === ctx.params.club_id && !a.deleted_at) || h.fail(404, "announcement.not_found", "Aviso não encontrado", "Ele pode ter sido apagado.");
  const validateAnn = (b, partial) => {
    const e = [];
    if ((!partial || "title" in b) && !String(b.title || "").trim()) e.push({ field: "title", message: "Dê um título ao aviso." });
    if ((!partial || "body" in b) && !String(b.body || "").trim()) e.push({ field: "body", message: "Escreva o aviso." });
    if ("title" in b && String(b.title).length > 120) e.push({ field: "title", message: "Título muito longo (máximo 120)." });
    if (e.length) h.invalid(e);
  };

  h.get("/v1/clubs/:club_id/announcements", (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const mine = groupsOf(me.id);
    const items = h.db.announcements.filter((a) => a.club_id === me.club_id && !a.deleted_at && (me.role !== "student" || !a.group_ids.length || a.group_ids.some((g) => mine.has(g))))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
    return { items: items.map((a) => annOut(a, me)), next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/announcements", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    validateAnn(ctx.body, false);
    const groupIds = (Array.isArray(ctx.body.group_ids) ? ctx.body.group_ids : []).filter((g) => h.db.groups.some((x) => x.id === g && x.club_id === me.club_id));
    const a = { id: h.uuid("ann"), club_id: me.club_id, author_membership_id: me.id, title: ctx.body.title.trim(), body: ctx.body.body.trim(), group_ids: groupIds, pinned: !!ctx.body.pinned, created_at: h.nowIso(), edited_at: null, deleted_at: null };
    h.db.announcements.push(a);
    for (const m of audience(a)) notify(m, me.club_id, "announcement", `Novo aviso: ${a.title}`, preview(a.body), "/messages");
    return { __status: 201, data: annOut(a, me) };
  });
  h.patch("/v1/clubs/:club_id/announcements/:id", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const a = ownAnn(ctx);
    validateAnn(ctx.body, true);
    for (const k of ["title", "body"]) if (k in ctx.body) { a[k] = String(ctx.body[k]).trim(); a.edited_at = h.nowIso(); }
    if ("pinned" in ctx.body) a.pinned = !!ctx.body.pinned;
    if (Array.isArray(ctx.body.group_ids)) a.group_ids = ctx.body.group_ids;
    return annOut(a, me);
  });
  h.delete("/v1/clubs/:club_id/announcements/:id", (ctx) => { ctx.staff(ctx.params.club_id); ownAnn(ctx).deleted_at = h.nowIso(); });
  h.post("/v1/clubs/:club_id/announcements/read", (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : [];
    for (const id of ids) if (h.db.announcements.some((a) => a.id === id && a.club_id === me.club_id) && !h.db.announcement_reads.some((r) => r.announcement_id === id && r.membership_id === me.id)) h.db.announcement_reads.push({ announcement_id: id, membership_id: me.id, read_at: h.nowIso() });
  });
  h.get("/v1/clubs/:club_id/announcements/:id/reads", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const a = ownAnn(ctx);
    const reads = h.db.announcement_reads.filter((r) => r.announcement_id === a.id);
    return { items: audience(a).map((m) => ({ membership_id: m.id, user: userOfM(m.id), read_at: reads.find((r) => r.membership_id === m.id)?.read_at ?? null })).sort((x, y) => Number(!!y.read_at) - Number(!!x.read_at) || x.user.name.localeCompare(y.user.name)) };
  });
}
