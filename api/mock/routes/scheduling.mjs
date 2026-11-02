/** Scheduling (aulas): venues, class types, recurring schedules, sessions, bookings, waitlist, check-in. */
const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];
const KINDS = ["track", "pool", "gym", "park", "studio", "other"];

export default function register(h) {
  const tz = -3; // club-local UTC offset (America/Sao_Paulo)
  const toUtc = (date, hhmm) => new Date(Date.parse(`${date}T${hhmm}:00Z`) - tz * 3600000).toISOString();
  const code = () => h.uuid("code").replace(/-/g, "").slice(0, 6).toUpperCase();
  const own = (table, clubId, id, what) => h.db[table].find((x) => x.id === id && x.club_id === clubId) || h.fail(404, `${what}.not_found`, "Não encontrado", "O item pode ter sido removido.");
  const userOfM = (mid) => { const m = h.db.memberships.find((x) => x.id === mid); return m ? h.publicUser(h.db.users.find((u) => u.id === m.user_id)) : null; };
  const notify = (mid, clubId, kind, title, body) => { const m = h.db.memberships.find((x) => x.id === mid); if (m) h.db.notifications.push({ id: h.uuid("n"), user_id: m.user_id, club_id: clubId, kind, title, body, link: "/classes", read_at: null, created_at: h.nowIso() }); };
  const active = (sid) => h.db.bookings.filter((b) => b.session_id === sid && (b.status === "booked" || b.status === "attended"));
  const waiting = (sid) => h.db.bookings.filter((b) => b.session_id === sid && b.status === "waitlisted").sort((a, b) => a.waitlist_position - b.waitlist_position);
  const sessionOut = (s, viewerMid) => ({
    ...s, class_type: h.db.class_types.find((t) => t.id === s.class_type_id), location: h.db.locations.find((l) => l.id === s.location_id) || null,
    instructor: s.instructor_membership_id ? userOfM(s.instructor_membership_id) : null,
    booked: active(s.id).length, waitlist: waiting(s.id).length,
    my_booking: viewerMid ? h.db.bookings.find((b) => b.session_id === s.id && b.membership_id === viewerMid && b.status !== "cancelled") || null : null,
  });
  const renumber = (sid) => waiting(sid).forEach((b, i) => (b.waitlist_position = i + 1));
  const promote = (s) => {
    while (active(s.id).length < s.capacity && waiting(s.id).length) {
      const b = waiting(s.id)[0];
      Object.assign(b, { status: "booked", waitlist_position: null, updated_at: h.nowIso() });
      const ct = h.db.class_types.find((t) => t.id === s.class_type_id);
      notify(b.membership_id, s.club_id, "waitlist_promoted", "Você saiu da lista de espera!", `${ct?.name ?? "Aula"} · vaga confirmada`);
    }
    renumber(s.id);
  };
  /** Materialize a rule's sessions for club-local dates in [from, to] (idempotent). */
  const materialize = (sc, from, to) => {
    let n = 0;
    const start = [from, sc.valid_from].sort().at(-1);
    for (let date = h.addDays(h.mondayOf(start), sc.weekday - 1); date <= to; date = h.addDays(date, 7)) {
      if (date < start || (sc.valid_until && date > sc.valid_until)) continue;
      const starts = toUtc(date, sc.start_time.slice(0, 5));
      if (h.db.class_sessions.some((s) => s.schedule_id === sc.id && s.starts_at === starts)) continue;
      h.db.class_sessions.push({ id: h.uuid("sess"), club_id: sc.club_id, class_type_id: sc.class_type_id, schedule_id: sc.id, location_id: sc.location_id, instructor_membership_id: sc.instructor_membership_id, starts_at: starts, ends_at: new Date(Date.parse(starts) + sc.duration_min * 60000).toISOString(), capacity: sc.capacity, status: "scheduled", notes: null, checkin_code: code(), created_at: h.nowIso() });
      n++;
    }
    return n;
  };
  /** Rolling horizon: sessions exist from today up to 8 weeks ahead (a backend job does this nightly). */
  const HORIZON = 56;
  const ensure = (clubId, from, to) => {
    const lo = [from, h.today()].sort().at(-1), hi = [to, h.addDays(h.today(), HORIZON)].sort()[0];
    if (lo > hi) return;
    let n = 0;
    for (const sc of h.db.class_schedules) if (sc.club_id === clubId && (!sc.valid_until || sc.valid_until >= lo)) n += materialize(sc, lo, hi);
    if (n) h.persist();
  };

  /** class_reminder for booked sessions starting in the next 12 h (a backend job sends these, plus push). */
  h.remindClasses = (userId) => {
    const now = Date.now(), until = new Date(now + 12 * 3600000).toISOString(), nowIso = new Date(now).toISOString();
    const mids = new Set(h.db.memberships.filter((m) => m.user_id === userId && m.status === "active").map((m) => m.id));
    for (const b of h.db.bookings) {
      if (!mids.has(b.membership_id) || b.status !== "booked") continue;
      const s = h.db.class_sessions.find((x) => x.id === b.session_id);
      if (!s || s.status !== "scheduled" || s.starts_at <= nowIso || s.starts_at > until) continue;
      const link = `/classes?session=${s.id}`;
      if (h.db.notifications.some((n) => n.user_id === userId && n.link === link && n.kind === "class_reminder")) continue;
      const ct = h.db.class_types.find((t) => t.id === s.class_type_id), loc = h.db.locations.find((l) => l.id === s.location_id);
      const hhmm = new Date(Date.parse(s.starts_at) + tz * 3600000).toISOString().slice(11, 16);
      h.db.notifications.push({ id: h.uuid("n"), user_id: userId, club_id: s.club_id, kind: "class_reminder", title: `Aula às ${hhmm}: ${ct?.name ?? "aula"}`, body: loc ? `${loc.name} · faça check-in pelo QR no local` : "Faça check-in pelo QR no local", link, read_at: null, created_at: nowIso });
    }
  };

  // ---- venues
  h.get("/v1/clubs/:club_id/locations", (ctx) => { ctx.member(ctx.params.club_id); return { items: h.db.locations.filter((l) => l.club_id === ctx.params.club_id && !l.archived_at), next_cursor: null }; });
  h.post("/v1/clubs/:club_id/locations", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const name = h.str(ctx.body, "name", "o nome do local", { max: 80 });
    if (!KINDS.includes(ctx.body.kind)) h.invalid([{ field: "kind", message: "Escolha o tipo de local." }]);
    const row = { id: h.uuid("loc"), club_id: ctx.params.club_id, name, kind: ctx.body.kind, address: ctx.body.address || null, lanes: ctx.body.lanes ? Number(ctx.body.lanes) : null, created_at: h.nowIso(), archived_at: null };
    h.db.locations.push(row);
    return { __status: 201, data: row };
  });
  h.patch("/v1/clubs/:club_id/locations/:id", (ctx) => { ctx.staff(ctx.params.club_id); const l = own("locations", ctx.params.club_id, ctx.params.id, "location"); for (const k of ["name", "kind", "address", "lanes"]) if (k in ctx.body) l[k] = ctx.body[k]; return l; });
  h.delete("/v1/clubs/:club_id/locations/:id", (ctx) => { ctx.staff(ctx.params.club_id); own("locations", ctx.params.club_id, ctx.params.id, "location").archived_at = h.nowIso(); });

  // ---- class types
  h.get("/v1/clubs/:club_id/class-types", (ctx) => { ctx.member(ctx.params.club_id); return { items: h.db.class_types.filter((t) => t.club_id === ctx.params.club_id && !t.archived_at), next_cursor: null }; });
  const validType = (b) => {
    const e = [];
    if (!String(b.name || "").trim()) e.push({ field: "name", message: "Dê um nome à aula." });
    if (!SPORTS.includes(b.sport)) e.push({ field: "sport", message: "Escolha a modalidade." });
    if (!(b.default_capacity > 0)) e.push({ field: "default_capacity", message: "Informe as vagas." });
    if (!(b.duration_min > 0)) e.push({ field: "duration_min", message: "Informe a duração." });
    if (e.length) h.invalid(e);
  };
  h.post("/v1/clubs/:club_id/class-types", (ctx) => {
    ctx.staff(ctx.params.club_id); validType(ctx.body);
    const row = { id: h.uuid("ct"), club_id: ctx.params.club_id, name: ctx.body.name.trim(), sport: ctx.body.sport, description: ctx.body.description || null, default_capacity: Number(ctx.body.default_capacity), duration_min: Number(ctx.body.duration_min), created_at: h.nowIso(), archived_at: null };
    h.db.class_types.push(row);
    return { __status: 201, data: row };
  });
  h.patch("/v1/clubs/:club_id/class-types/:id", (ctx) => { ctx.staff(ctx.params.club_id); const t = own("class_types", ctx.params.club_id, ctx.params.id, "class_type"); validType({ ...t, ...ctx.body }); for (const k of ["name", "sport", "description", "default_capacity", "duration_min"]) if (k in ctx.body) t[k] = ctx.body[k]; return t; });
  h.delete("/v1/clubs/:club_id/class-types/:id", (ctx) => { ctx.staff(ctx.params.club_id); own("class_types", ctx.params.club_id, ctx.params.id, "class_type").archived_at = h.nowIso(); });

  // ---- recurring schedules
  const scheduleOut = (sc) => ({ ...sc, class_type: h.db.class_types.find((t) => t.id === sc.class_type_id), location: h.db.locations.find((l) => l.id === sc.location_id) || null, instructor: sc.instructor_membership_id ? userOfM(sc.instructor_membership_id) : null });
  h.get("/v1/clubs/:club_id/class-schedules", (ctx) => { ctx.staff(ctx.params.club_id); return { items: h.db.class_schedules.filter((s) => s.club_id === ctx.params.club_id && (!s.valid_until || s.valid_until >= h.today())).sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time)).map(scheduleOut), next_cursor: null }; });
  h.post("/v1/clubs/:club_id/class-schedules", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const b = ctx.body;
    const ct = own("class_types", ctx.params.club_id, b.class_type_id, "class_type");
    const weekdays = Array.isArray(b.weekdays) ? b.weekdays.filter((d) => d >= 1 && d <= 7) : [];
    const e = [];
    if (!weekdays.length) e.push({ field: "weekdays", message: "Escolha pelo menos um dia da semana." });
    if (!/^\d{2}:\d{2}$/.test(b.start_time || "")) e.push({ field: "start_time", message: "Informe o horário." });
    if (e.length) h.invalid(e);
    const created = [];
    let sessions = 0;
    for (const weekday of weekdays) {
      const sc = { id: h.uuid("cs"), club_id: ctx.params.club_id, class_type_id: ct.id, location_id: b.location_id || null, instructor_membership_id: b.instructor_membership_id || null, weekday, start_time: b.start_time, duration_min: Number(b.duration_min) || ct.duration_min, capacity: Number(b.capacity) || ct.default_capacity, valid_from: b.valid_from || h.today(), valid_until: null, created_at: h.nowIso() };
      h.db.class_schedules.push(sc);
      sessions += materialize(sc, [sc.valid_from, h.today()].sort().at(-1), h.addDays(h.today(), HORIZON));
      created.push(scheduleOut(sc));
    }
    return { __status: 201, data: { items: created, sessions } };
  });
  h.delete("/v1/clubs/:club_id/class-schedules/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const sc = own("class_schedules", ctx.params.club_id, ctx.params.id, "schedule");
    sc.valid_until = h.addDays(h.today(), -1);
    const now = h.nowIso();
    const future = h.db.class_sessions.filter((s) => s.schedule_id === sc.id && s.starts_at > now);
    for (const s of future) { s.status = "cancelled"; for (const b of h.db.bookings.filter((x) => x.session_id === s.id && x.status !== "cancelled")) { b.status = "cancelled"; notify(b.membership_id, s.club_id, "class_cancelled", "Aula cancelada", h.db.class_types.find((t) => t.id === s.class_type_id)?.name); } }
    return { __status: 200, data: { cancelled_sessions: future.length } };
  });

  // ---- sessions
  h.get("/v1/clubs/:club_id/class-sessions", (ctx) => {
    const m = ctx.member(ctx.params.club_id);
    const { from, to } = ctx.query;
    if (!from || !to) h.invalid([{ field: "from", message: "Informe o período." }]);
    ensure(ctx.params.club_id, from, to);
    const items = h.db.class_sessions.filter((s) => s.club_id === ctx.params.club_id && s.starts_at >= toUtc(from, "00:00") && s.starts_at < toUtc(h.addDays(to, 1), "00:00") && (m.role !== "student" || s.status === "scheduled")).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((s) => sessionOut(s, m.id));
    return { items, next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/class-sessions", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const b = ctx.body;
    const ct = own("class_types", ctx.params.club_id, b.class_type_id, "class_type");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "") || !/^\d{2}:\d{2}$/.test(b.time || "")) h.invalid([{ field: "date", message: "Informe a data e o horário." }]);
    const starts = toUtc(b.date, b.time);
    const s = { id: h.uuid("sess"), club_id: ctx.params.club_id, class_type_id: ct.id, schedule_id: null, location_id: b.location_id || null, instructor_membership_id: b.instructor_membership_id || null, starts_at: starts, ends_at: new Date(Date.parse(starts) + (Number(b.duration_min) || ct.duration_min) * 60000).toISOString(), capacity: Number(b.capacity) || ct.default_capacity, status: "scheduled", notes: b.notes || null, checkin_code: code(), created_at: h.nowIso() };
    h.db.class_sessions.push(s);
    return { __status: 201, data: sessionOut(s) };
  });
  h.get("/v1/clubs/:club_id/class-sessions/:id", (ctx) => {
    const m = ctx.member(ctx.params.club_id);
    const s = own("class_sessions", ctx.params.club_id, ctx.params.id, "session");
    const out = sessionOut(s, m.id);
    if (m.role === "student") { delete out.checkin_code; return out; }
    out.roster = h.db.bookings.filter((b) => b.session_id === s.id && b.status !== "cancelled").sort((a, b) => (a.status === "waitlisted") - (b.status === "waitlisted") || (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0) || a.created_at.localeCompare(b.created_at)).map((b) => ({ ...b, athlete: { membership_id: b.membership_id, user: userOfM(b.membership_id) } }));
    return out;
  });
  h.patch("/v1/clubs/:club_id/class-sessions/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const s = own("class_sessions", ctx.params.club_id, ctx.params.id, "session");
    const b = ctx.body;
    if (b.status === "cancelled" && s.status !== "cancelled") {
      s.status = "cancelled";
      const ct = h.db.class_types.find((t) => t.id === s.class_type_id);
      for (const bk of h.db.bookings.filter((x) => x.session_id === s.id && x.status !== "cancelled")) { bk.status = "cancelled"; notify(bk.membership_id, s.club_id, "class_cancelled", "Aula cancelada", `${ct?.name} · ${b.reason || "o clube cancelou esta aula"}`); }
    }
    if ("capacity" in b) { s.capacity = Math.max(1, Number(b.capacity)); promote(s); }
    for (const k of ["notes", "instructor_membership_id", "location_id"]) if (k in b) s[k] = b[k];
    return sessionOut(s);
  });

  // ---- bookings
  h.post("/v1/clubs/:club_id/class-sessions/:id/bookings", (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const s = own("class_sessions", ctx.params.club_id, ctx.params.id, "session");
    if (s.status === "cancelled") h.fail(409, "session.cancelled", "Aula cancelada", "Escolha outro horário.");
    if (s.ends_at < h.nowIso()) h.fail(409, "session.past", "Esta aula já aconteceu", "Escolha um horário futuro.");
    const target = me.role === "student" ? me.id : ctx.body.membership_id;
    if (!target || !h.db.memberships.some((m) => m.id === target && m.club_id === s.club_id && m.status === "active")) h.invalid([{ field: "membership_id", message: "Escolha o aluno." }]);
    let b = h.db.bookings.find((x) => x.session_id === s.id && x.membership_id === target);
    if (b && b.status !== "cancelled") h.fail(409, "booking.exists", "Você já tem essa reserva", b.status === "waitlisted" ? `Você está na lista de espera, posição ${b.waitlist_position}.` : "Sua vaga já está garantida.");
    const full = active(s.id).length >= s.capacity;
    const fields = { status: full ? "waitlisted" : "booked", waitlist_position: full ? waiting(s.id).length + 1 : null, checked_in_at: null, updated_at: h.nowIso() };
    if (b) Object.assign(b, fields);
    else { b = { id: h.uuid("bk"), session_id: s.id, membership_id: target, created_at: h.nowIso(), ...fields }; h.db.bookings.push(b); }
    return { __status: 201, data: b };
  });
  const getBooking = (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const b = h.db.bookings.find((x) => x.id === ctx.params.id);
    const s = b && h.db.class_sessions.find((x) => x.id === b.session_id && x.club_id === ctx.params.club_id);
    if (!s || (me.role === "student" && b.membership_id !== me.id)) h.fail(404, "booking.not_found", "Reserva não encontrada", "Ela pode já ter sido cancelada.");
    return { me, b, s };
  };
  h.delete("/v1/clubs/:club_id/bookings/:id", (ctx) => {
    const { b, s } = getBooking(ctx);
    b.status = "cancelled"; b.waitlist_position = null; b.updated_at = h.nowIso();
    promote(s);
  });
  h.patch("/v1/clubs/:club_id/bookings/:id", (ctx) => {
    const { me, b } = getBooking(ctx);
    if (me.role === "student") h.fail(403, "auth.forbidden", "Sem permissão", "Só a equipe marca presença.");
    if (!["attended", "no_show", "booked"].includes(ctx.body.status)) h.invalid([{ field: "status", message: "Situação inválida." }]);
    b.status = ctx.body.status; b.checked_in_at = ctx.body.status === "attended" ? b.checked_in_at || h.nowIso() : null; b.updated_at = h.nowIso();
    return b;
  });
  h.post("/v1/clubs/:club_id/class-sessions/:id/check-in", (ctx) => {
    const me = ctx.member(ctx.params.club_id, ["student"]);
    const s = own("class_sessions", ctx.params.club_id, ctx.params.id, "session");
    if (String(ctx.body.checkin_code || "").trim().toUpperCase() !== s.checkin_code) h.fail(400, "checkin.invalid_code", "Código incorreto", "Confira o código mostrado no local da aula.");
    const now = Date.now();
    if (now < Date.parse(s.starts_at) - 45 * 60000 || now > Date.parse(s.ends_at)) h.fail(409, "checkin.window", "Fora do horário", "O check-in abre 45 minutos antes da aula e fecha no fim dela.");
    let b = h.db.bookings.find((x) => x.session_id === s.id && x.membership_id === me.id && x.status !== "cancelled");
    if (!b) { if (active(s.id).length >= s.capacity) h.fail(409, "session.full", "Aula lotada", "Não há vagas para check-in sem reserva."); b = { id: h.uuid("bk"), session_id: s.id, membership_id: me.id, created_at: h.nowIso() }; h.db.bookings.push(b); }
    Object.assign(b, { status: "attended", waitlist_position: null, checked_in_at: h.nowIso(), updated_at: h.nowIso() });
    return b;
  });
}
