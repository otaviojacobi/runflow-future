/**
 * Aulas (D-052, endpoints.md § Aulas): venues, class types, recurring schedules, sessions, bookings with a waitlist,
 * check-in by code, attendance. Restored from F15 (removed in F37) and adapted: push-only notifications through
 * h.notify, bookings in `class_bookings`, students cancel until the start, staff book active students only.
 * Helpers for other modules: h.cancelOpenBookings (leaving a club), h.nextClass (/my/summary), h.upcomingClasses
 * (dashboard).
 */
const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"];
const KINDS = ["track", "pool", "gym", "park", "studio", "other"];
/** Sessions exist from today up to 8 weeks ahead (the backend's daily job; here, whenever sessions are listed). */
const HORIZON_DAYS = 56;
/** Check-in opens 45 minutes before the start and closes at the end. */
const CHECKIN_EARLY_MS = 45 * 60000;
/** Mock-only: the web app the QR's check-in link opens (the backend uses PUBLIC_APP_URL). */
const APP_URL = process.env.MOCK_APP_URL || "http://localhost:8080";

export default function register(h) {
  const TZ_MS = 3 * 3600000; // club-local = São Paulo, like h.today()
  const toUtc = (date, hhmm) => new Date(Date.parse(`${date}T${hhmm}:00Z`) + TZ_MS).toISOString();
  const localDate = (iso) => new Date(Date.parse(iso) - TZ_MS).toISOString().slice(0, 10);
  const code = () => h.uuid("code").replace(/[^0-9a-f]/g, "").slice(-6).toUpperCase();
  const missing = { location: "Local não encontrado", class_type: "Tipo de aula não encontrado", schedule: "Horário não encontrado", session: "Aula não encontrada" };
  const own = (table, clubId, id, what) =>
    h.db[table].find((x) => x.id === id && x.club_id === clubId) || h.fail(404, `${what}.not_found`, missing[what], "Ele pode ter sido removido.");
  const userOfM = (mid) => { const m = h.db.memberships.find((x) => x.id === mid); return m ? h.publicUser(h.db.users.find((u) => u.id === m.user_id)) : null; };
  const typeOf = (s) => h.db.class_types.find((t) => t.id === s.class_type_id) || null;
  const locationOf = (s) => (s.location_id ? h.db.locations.find((l) => l.id === s.location_id) || null : null);
  const tell = (mid, s, kind, title, body) => {
    const m = h.db.memberships.find((x) => x.id === mid);
    if (m) h.notify({ id: h.uuid("n"), user_id: m.user_id, club_id: s.club_id, kind, title, body, link: `/classes?session=${s.id}` });
  };
  const seated = (sid) => h.db.class_bookings.filter((b) => b.session_id === sid && (b.status === "booked" || b.status === "attended"));
  const waiting = (sid) => h.db.class_bookings.filter((b) => b.session_id === sid && b.status === "waitlisted").sort((a, b) => a.waitlist_position - b.waitlist_position);
  const renumber = (sid) => waiting(sid).forEach((b, i) => { b.waitlist_position = i + 1; });
  const when = (s) => { const d = localDate(s.starts_at), t = new Date(Date.parse(s.starts_at) - TZ_MS).toISOString().slice(11, 16); return `${d.slice(8, 10)}/${d.slice(5, 7)} às ${t}`; };

  /** Seats freed: the waitlist moves up, in order, and each promoted student hears about it. */
  const promote = (s) => {
    while (s.status === "scheduled" && seated(s.id).length < s.capacity && waiting(s.id).length) {
      const b = waiting(s.id)[0];
      Object.assign(b, { status: "booked", waitlist_position: null, updated_at: h.nowIso() });
      tell(b.membership_id, s, "waitlist_promoted", "Você saiu da lista de espera", `${typeOf(s)?.name ?? "Aula"} · ${when(s)}: sua vaga está garantida.`);
    }
    renumber(s.id);
  };
  /** A cancelled session: every seat and waitlist place goes, and those people hear why. */
  const cancelSession = (s, reason) => {
    Object.assign(s, { status: "cancelled", cancel_reason: reason || null });
    for (const b of h.db.class_bookings.filter((x) => x.session_id === s.id && (x.status === "booked" || x.status === "waitlisted"))) {
      Object.assign(b, { status: "cancelled", waitlist_position: null, updated_at: h.nowIso() });
      tell(b.membership_id, s, "class_cancelled", "Aula cancelada", `${typeOf(s)?.name ?? "Aula"} · ${when(s)}${reason ? `: ${reason}` : ""}`);
    }
  };

  /** A rule's sessions for club-local dates in [from, to]; never twice for the same start. */
  const materialize = (sc, from, to) => {
    let n = 0;
    const start = [from, sc.valid_from].sort().at(-1);
    for (let date = h.addDays(h.mondayOf(start), sc.weekday - 1); date <= to; date = h.addDays(date, 7)) {
      if (date < start || (sc.valid_until && date > sc.valid_until)) continue;
      const starts = toUtc(date, sc.start_time.slice(0, 5));
      if (h.db.class_sessions.some((s) => s.schedule_id === sc.id && s.starts_at === starts)) continue;
      h.db.class_sessions.push({
        id: h.uuid("sess"), club_id: sc.club_id, class_type_id: sc.class_type_id, schedule_id: sc.id, location_id: sc.location_id,
        instructor_membership_id: sc.instructor_membership_id, starts_at: starts, ends_at: new Date(Date.parse(starts) + sc.duration_min * 60000).toISOString(),
        capacity: sc.capacity, status: "scheduled", cancel_reason: null, notes: null, checkin_code: code(), created_at: h.nowIso(),
      });
      n++;
    }
    return n;
  };
  const ensure = (clubId) => {
    const lo = h.today(), hi = h.addDays(lo, HORIZON_DAYS);
    let n = 0;
    for (const sc of h.db.class_schedules) if (sc.club_id === clubId && (!sc.valid_until || sc.valid_until >= lo)) n += materialize(sc, lo, hi);
    if (n) h.persist();
  };

  const sessionOut = (s, viewer) => ({
    ...s, checkin_code: undefined,
    class_type: typeOf(s), location: locationOf(s), instructor: s.instructor_membership_id ? userOfM(s.instructor_membership_id) : null,
    booked: seated(s.id).length, waitlist: waiting(s.id).length,
    my_booking: viewer ? h.db.class_bookings.find((b) => b.session_id === s.id && b.membership_id === viewer.id && b.status !== "cancelled") || null : null,
  });
  const staffSession = (s, viewer) => ({
    ...sessionOut(s, viewer), checkin_code: s.checkin_code,
    checkin_url: `${APP_URL}/classes/check-in?session=${s.id}&code=${s.checkin_code}`,
    roster: h.db.class_bookings
      .filter((b) => b.session_id === s.id && b.status !== "cancelled")
      .sort((a, b) => (a.status === "waitlisted") - (b.status === "waitlisted") || (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0) || a.created_at.localeCompare(b.created_at))
      .map((b) => ({ ...b, athlete: { membership_id: b.membership_id, user: userOfM(b.membership_id) } })),
  });

  // ---- helpers for other modules
  /** Leaving a club (or the account): open bookings there are cancelled and the waitlists move up. */
  h.cancelOpenBookings = (membershipId) => {
    const now = h.nowIso();
    for (const b of h.db.class_bookings.filter((x) => x.membership_id === membershipId && (x.status === "booked" || x.status === "waitlisted"))) {
      const s = h.db.class_sessions.find((x) => x.id === b.session_id);
      if (!s || s.starts_at <= now) continue;
      Object.assign(b, { status: "cancelled", waitlist_position: null, updated_at: now });
      promote(s);
    }
  };
  /** /my/summary: the student's next booked or waitlisted class. */
  h.nextClass = (membershipId) => {
    const now = h.nowIso();
    const next = h.db.class_bookings
      .filter((b) => b.membership_id === membershipId && (b.status === "booked" || b.status === "waitlisted"))
      .map((b) => ({ b, s: h.db.class_sessions.find((s) => s.id === b.session_id) }))
      .filter((x) => x.s && x.s.status === "scheduled" && x.s.ends_at > now)
      .sort((a, b) => a.s.starts_at.localeCompare(b.s.starts_at))[0];
    if (!next) return null;
    const { checkin_code: _c, ...session } = next.s;
    return { booking: next.b, session, class_type: typeOf(next.s), location: locationOf(next.s) };
  };
  /** Dashboard: the next three scheduled sessions. */
  h.upcomingClasses = (clubId) => {
    ensure(clubId);
    const now = h.nowIso();
    return h.db.class_sessions
      .filter((s) => s.club_id === clubId && s.status === "scheduled" && s.starts_at > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 3)
      .map((s) => { const { checkin_code: _c, ...session } = s; return { session, class_type: typeOf(s), booked: seated(s.id).length, waitlist: waiting(s.id).length }; });
  };

  // ---- venues
  h.get("/v1/clubs/:club_id/locations", (ctx) => { ctx.member(ctx.params.club_id); return { items: h.db.locations.filter((l) => l.club_id === ctx.params.club_id && !l.archived_at), next_cursor: null }; });
  const validLocation = (b, partial) => {
    const e = [];
    if ((!partial || "name" in b) && !String(b.name || "").trim()) e.push({ field: "name", message: "Informe o nome do local." });
    if ((!partial || "kind" in b) && !KINDS.includes(b.kind)) e.push({ field: "kind", message: "Escolha o tipo de local." });
    if (b.lanes != null && !(Number.isInteger(Number(b.lanes)) && Number(b.lanes) > 0)) e.push({ field: "lanes", message: "Número de raias inválido." });
    if (e.length) h.invalid(e);
  };
  h.post("/v1/clubs/:club_id/locations", (ctx) => {
    ctx.staff(ctx.params.club_id);
    validLocation(ctx.body, false);
    const b = ctx.body;
    const row = { id: h.uuid("loc"), club_id: ctx.params.club_id, name: String(b.name).trim().slice(0, 80), kind: b.kind, address: b.address || null, lanes: b.lanes ? Number(b.lanes) : null, created_at: h.nowIso(), archived_at: null };
    h.db.locations.push(row);
    return { __status: 201, data: row };
  });
  h.patch("/v1/clubs/:club_id/locations/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const l = own("locations", ctx.params.club_id, ctx.params.id, "location");
    validLocation(ctx.body, true);
    for (const k of ["name", "kind", "address", "lanes"]) if (k in ctx.body) l[k] = k === "name" ? String(ctx.body.name).trim() : k === "lanes" && ctx.body.lanes != null ? Number(ctx.body.lanes) : ctx.body[k];
    return l;
  });
  h.delete("/v1/clubs/:club_id/locations/:id", (ctx) => { ctx.staff(ctx.params.club_id); own("locations", ctx.params.club_id, ctx.params.id, "location").archived_at = h.nowIso(); });

  // ---- class types
  h.get("/v1/clubs/:club_id/class-types", (ctx) => { ctx.member(ctx.params.club_id); return { items: h.db.class_types.filter((t) => t.club_id === ctx.params.club_id && !t.archived_at), next_cursor: null }; });
  const validType = (b) => {
    const e = [];
    if (!String(b.name || "").trim()) e.push({ field: "name", message: "Dê um nome à aula." });
    if (!SPORTS.includes(b.sport)) e.push({ field: "sport", message: "Escolha a modalidade." });
    if (!(Number(b.default_capacity) > 0)) e.push({ field: "default_capacity", message: "Informe as vagas." });
    if (!(Number(b.duration_min) > 0)) e.push({ field: "duration_min", message: "Informe a duração." });
    if (e.length) h.invalid(e);
  };
  h.post("/v1/clubs/:club_id/class-types", (ctx) => {
    ctx.staff(ctx.params.club_id);
    validType(ctx.body);
    const b = ctx.body;
    const row = { id: h.uuid("ct"), club_id: ctx.params.club_id, name: String(b.name).trim().slice(0, 80), sport: b.sport, description: b.description || null, default_capacity: Number(b.default_capacity), duration_min: Number(b.duration_min), created_at: h.nowIso(), archived_at: null };
    h.db.class_types.push(row);
    return { __status: 201, data: row };
  });
  h.patch("/v1/clubs/:club_id/class-types/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const t = own("class_types", ctx.params.club_id, ctx.params.id, "class_type");
    validType({ ...t, ...ctx.body });
    for (const k of ["name", "sport", "description", "default_capacity", "duration_min"]) if (k in ctx.body) t[k] = ["default_capacity", "duration_min"].includes(k) ? Number(ctx.body[k]) : ctx.body[k];
    return t;
  });
  h.delete("/v1/clubs/:club_id/class-types/:id", (ctx) => { ctx.staff(ctx.params.club_id); own("class_types", ctx.params.club_id, ctx.params.id, "class_type").archived_at = h.nowIso(); });

  // ---- recurring schedules
  const scheduleOut = (sc) => ({ ...sc, class_type: typeOf(sc), location: locationOf(sc), instructor: sc.instructor_membership_id ? userOfM(sc.instructor_membership_id) : null });
  /** Optional references must belong to the club (an active staff member as instructor). */
  const refs = (clubId, b) => {
    const e = [];
    if (b.location_id && !h.db.locations.some((l) => l.id === b.location_id && l.club_id === clubId && !l.archived_at)) e.push({ field: "location_id", message: "Local inválido." });
    if (b.instructor_membership_id && !h.db.memberships.some((m) => m.id === b.instructor_membership_id && m.club_id === clubId && m.status === "active" && m.role !== "student")) e.push({ field: "instructor_membership_id", message: "Escolha alguém da equipe." });
    if (b.capacity != null && !(Number(b.capacity) > 0)) e.push({ field: "capacity", message: "Informe as vagas." });
    if (b.duration_min != null && !(Number(b.duration_min) > 0)) e.push({ field: "duration_min", message: "Informe a duração." });
    return e;
  };
  h.get("/v1/clubs/:club_id/class-schedules", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const items = h.db.class_schedules
      .filter((s) => s.club_id === ctx.params.club_id && (!s.valid_until || s.valid_until >= h.today()))
      .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time)).map(scheduleOut);
    return { items, next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/class-schedules", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const b = ctx.body;
    const ct = own("class_types", ctx.params.club_id, b.class_type_id, "class_type");
    const weekdays = [...new Set(Array.isArray(b.weekdays) ? b.weekdays.map(Number).filter((d) => d >= 1 && d <= 7) : [])].sort();
    const e = refs(ctx.params.club_id, b);
    if (!weekdays.length) e.push({ field: "weekdays", message: "Escolha pelo menos um dia da semana." });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start_time || "")) e.push({ field: "start_time", message: "Informe o horário." });
    if (b.valid_from != null && !/^\d{4}-\d{2}-\d{2}$/.test(b.valid_from)) e.push({ field: "valid_from", message: "Data inválida." });
    if (e.length) h.invalid(e);
    const created = [];
    let sessions = 0;
    for (const weekday of weekdays) {
      const sc = { id: h.uuid("cs"), club_id: ctx.params.club_id, class_type_id: ct.id, location_id: b.location_id || null, instructor_membership_id: b.instructor_membership_id || null, weekday, start_time: b.start_time, duration_min: Number(b.duration_min) || ct.duration_min, capacity: Number(b.capacity) || ct.default_capacity, valid_from: b.valid_from || h.today(), valid_until: null, created_at: h.nowIso() };
      h.db.class_schedules.push(sc);
      sessions += materialize(sc, [sc.valid_from, h.today()].sort().at(-1), h.addDays(h.today(), HORIZON_DAYS));
      created.push(scheduleOut(sc));
    }
    return { __status: 201, data: { items: created, sessions } };
  });
  h.delete("/v1/clubs/:club_id/class-schedules/:id", (ctx) => {
    ctx.staff(ctx.params.club_id);
    const sc = own("class_schedules", ctx.params.club_id, ctx.params.id, "schedule");
    sc.valid_until = h.addDays(h.today(), -1);
    const now = h.nowIso();
    const future = h.db.class_sessions.filter((s) => s.schedule_id === sc.id && s.starts_at > now && s.status === "scheduled");
    for (const s of future) cancelSession(s, "o horário deixou de existir");
    return { __status: 200, data: { cancelled_sessions: future.length } };
  });

  // ---- sessions
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  h.get("/v1/clubs/:club_id/class-sessions", (ctx) => {
    const m = ctx.member(ctx.params.club_id);
    const { from, to } = ctx.query;
    if (!DATE.test(from || "") || !DATE.test(to || "")) h.invalid([{ field: "from", message: "Informe o período (from e to)." }]);
    ensure(ctx.params.club_id);
    const items = h.db.class_sessions
      .filter((s) => s.club_id === ctx.params.club_id && localDate(s.starts_at) >= from && localDate(s.starts_at) <= to && (m.role !== "student" || s.status === "scheduled"))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((s) => sessionOut(s, m));
    return { items, next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/class-sessions", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const b = ctx.body;
    const ct = own("class_types", ctx.params.club_id, b.class_type_id, "class_type");
    const e = refs(ctx.params.club_id, b);
    if (!DATE.test(b.date || "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time || "")) e.push({ field: "date", message: "Informe a data e o horário." });
    if (e.length) h.invalid(e);
    const starts = toUtc(b.date, b.time);
    const s = { id: h.uuid("sess"), club_id: ctx.params.club_id, class_type_id: ct.id, schedule_id: null, location_id: b.location_id || null, instructor_membership_id: b.instructor_membership_id || null, starts_at: starts, ends_at: new Date(Date.parse(starts) + (Number(b.duration_min) || ct.duration_min) * 60000).toISOString(), capacity: Number(b.capacity) || ct.default_capacity, status: "scheduled", cancel_reason: null, notes: b.notes || null, checkin_code: code(), created_at: h.nowIso() };
    h.db.class_sessions.push(s);
    return { __status: 201, data: staffSession(s, me) };
  });
  h.get("/v1/clubs/:club_id/class-sessions/:id", (ctx) => {
    const m = ctx.member(ctx.params.club_id);
    const s = own("class_sessions", ctx.params.club_id, ctx.params.id, "session");
    return m.role === "student" ? sessionOut(s, m) : staffSession(s, m);
  });
  h.patch("/v1/clubs/:club_id/class-sessions/:id", (ctx) => {
    const me = ctx.staff(ctx.params.club_id);
    const s = own("class_sessions", ctx.params.club_id, ctx.params.id, "session");
    const b = ctx.body;
    const e = refs(ctx.params.club_id, b);
    if ("status" in b && b.status !== "cancelled") e.push({ field: "status", message: "Só é possível cancelar a aula." });
    if (e.length) h.invalid(e);
    for (const k of ["notes", "instructor_membership_id", "location_id"]) if (k in b) s[k] = b[k] || null;
    if ("capacity" in b && s.status === "scheduled") { s.capacity = Number(b.capacity); promote(s); }
    if (b.status === "cancelled" && s.status !== "cancelled") cancelSession(s, (b.cancel_reason || "").trim() || null);
    return staffSession(s, me);
  });

  // ---- bookings
  h.post("/v1/clubs/:club_id/class-sessions/:id/bookings", (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const s = own("class_sessions", ctx.params.club_id, ctx.params.id, "session");
    if (s.status === "cancelled") h.fail(409, "session.cancelled", "Aula cancelada", "Escolha outro horário.");
    if (s.ends_at <= h.nowIso()) h.fail(409, "session.past", "Esta aula já aconteceu", "Escolha um horário futuro.");
    const target = me.role === "student" ? me.id : ctx.body.membership_id;
    if (!target || !h.db.memberships.some((m) => m.id === target && m.club_id === s.club_id && m.status === "active" && m.role === "student")) h.invalid([{ field: "membership_id", message: "Escolha um aluno do clube." }]);
    let b = h.db.class_bookings.find((x) => x.session_id === s.id && x.membership_id === target);
    if (b && b.status !== "cancelled") h.fail(409, "booking.exists", "Essa reserva já existe", b.status === "waitlisted" ? `Na lista de espera, posição ${b.waitlist_position}.` : "A vaga já está garantida.");
    const full = seated(s.id).length >= s.capacity;
    const fields = { status: full ? "waitlisted" : "booked", waitlist_position: full ? waiting(s.id).length + 1 : null, checked_in_at: null, updated_at: h.nowIso() };
    if (b) Object.assign(b, fields);
    else { b = { id: h.uuid("bk"), session_id: s.id, membership_id: target, created_at: h.nowIso(), ...fields }; h.db.class_bookings.push(b); }
    return { __status: 201, data: b };
  });
  const getBooking = (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const b = h.db.class_bookings.find((x) => x.id === ctx.params.id);
    const s = b && h.db.class_sessions.find((x) => x.id === b.session_id && x.club_id === ctx.params.club_id);
    if (!s || (me.role === "student" && b.membership_id !== me.id)) h.fail(404, "booking.not_found", "Reserva não encontrada", "Ela pode já ter sido cancelada.");
    return { me, b, s };
  };
  h.delete("/v1/clubs/:club_id/bookings/:id", (ctx) => {
    const { me, b, s } = getBooking(ctx);
    if (b.status === "cancelled") return;
    if (me.role === "student" && s.starts_at <= h.nowIso()) h.fail(409, "booking.started", "A aula já começou", "Não é possível cancelar depois do início. Fale com a equipe.");
    Object.assign(b, { status: "cancelled", waitlist_position: null, updated_at: h.nowIso() });
    promote(s);
  });
  h.patch("/v1/clubs/:club_id/bookings/:id", (ctx) => {
    const { me, b, s } = getBooking(ctx);
    if (me.role === "student") h.fail(403, "auth.forbidden", "Sem permissão", "Só a equipe marca presença.");
    if (!["attended", "no_show", "booked"].includes(ctx.body.status)) h.invalid([{ field: "status", message: "Situação inválida." }]);
    const was = b.status;
    Object.assign(b, { status: ctx.body.status, waitlist_position: null, checked_in_at: ctx.body.status === "attended" ? b.checked_in_at || h.nowIso() : null, updated_at: h.nowIso() });
    if (was === "waitlisted") renumber(s.id);
    return b;
  });
  h.post("/v1/clubs/:club_id/class-sessions/:id/check-in", (ctx) => {
    const me = ctx.member(ctx.params.club_id, ["student"]);
    const s = own("class_sessions", ctx.params.club_id, ctx.params.id, "session");
    if (String(ctx.body.checkin_code || "").trim().toUpperCase() !== s.checkin_code) h.fail(400, "checkin.invalid_code", "Código incorreto", "Confira o código mostrado no local da aula.");
    if (s.status === "cancelled") h.fail(409, "session.cancelled", "Aula cancelada", "Esta aula foi cancelada.");
    const now = Date.now();
    if (now < Date.parse(s.starts_at) - CHECKIN_EARLY_MS || now > Date.parse(s.ends_at)) h.fail(409, "checkin.window", "Fora do horário", "O check-in abre 45 minutos antes da aula e fecha no fim dela.");
    let b = h.db.class_bookings.find((x) => x.session_id === s.id && x.membership_id === me.id);
    const hasSeat = b && (b.status === "booked" || b.status === "attended");
    if (!hasSeat && seated(s.id).length >= s.capacity) h.fail(409, "session.full", "Aula lotada", "Não há vagas para fazer check-in.");
    const was = b?.status;
    if (!b) { b = { id: h.uuid("bk"), session_id: s.id, membership_id: me.id, created_at: h.nowIso() }; h.db.class_bookings.push(b); }
    Object.assign(b, { status: "attended", waitlist_position: null, checked_in_at: b.checked_in_at || h.nowIso(), updated_at: h.nowIso() });
    if (was === "waitlisted") renumber(s.id);
    return b;
  });
}
