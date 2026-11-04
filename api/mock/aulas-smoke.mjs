#!/usr/bin/env node
/**
 * Aulas (D-052) end to end on a throwaway mock: book → full → waitlist → cancel → promotion → check-in window →
 * attendance → cancelled class → leaving the club → report, dashboard and Hoje. Part of `npm run check:api`.
 *
 *   node api/mock/aulas-smoke.mjs        (exits 1 on the first broken expectation)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

export async function runAulasSmoke() {
  const dir = mkdtempSync(join(tmpdir(), "rf-aulas-"));
  const port = await freePort();
  const server = spawn(process.execPath, [join(here, "server.mjs"), "--reset"], { env: { ...process.env, PORT: String(port), MOCK_DATA_FILE: join(dir, "db.json"), MOCK_LATENCY: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  const base = `http://localhost:${port}/v1`;
  const steps = [];
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(base + "/health")).ok) break; } catch { /* starting */ }
      if (i > 100) throw new Error("the mock didn't start");
      await new Promise((r) => setTimeout(r, 50));
    }
    const call = async (token, method, path, body) => {
      const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) : null };
    };
    const signIn = async (email) => { await call(null, "POST", "/auth/email/start", { email }); return (await call(null, "POST", "/auth/email/verify", { email, code: "000000" })).body.token; };
    const expect = (name, ok, got) => { steps.push(name); if (!ok) throw new Error(`${name}: got ${JSON.stringify(got)?.slice(0, 300)}`); };

    const marcos = await signIn("marcos@paceforte.com.br");
    const club = (await call(marcos, "GET", "/me")).body.memberships.find((x) => x.club.slug === "paceforte").club.id;
    const [ana, bruno, carla] = await Promise.all(["ana.souza@email.com", "bruno.lima@email.com", "carla.mendes@email.com"].map(signIn));
    const memberOf = async (t) => (await call(t, "GET", "/me")).body.memberships.find((x) => x.club.id === club).membership.id;
    const [anaM, brunoM, carlaM] = await Promise.all([ana, bruno, carla].map(memberOf));
    const local = (offsetMin) => { const d = new Date(Date.now() - 3 * 3600000 + offsetMin * 60000).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; };

    // Seeded data: venues, types, the week's sessions and the report.
    const types = await call(ana, "GET", `/clubs/${club}/class-types`);
    expect("students list class types", types.status === 200 && types.body.items.length >= 2, types);
    const today = local(0).date;
    const week = await call(ana, "GET", `/clubs/${club}/class-sessions?from=${today}&to=${local(13 * 24 * 60).date}`);
    expect("sessions listed with counts", week.status === 200 && week.body.items.every((s) => "booked" in s && "waitlist" in s && !("checkin_code" in s)), week);
    expect("students only see scheduled sessions", week.body.items.every((s) => s.status === "scheduled"), week.body.items.map((s) => s.status));
    const summary = await call(ana, "GET", `/clubs/${club}/my/summary`);
    expect("Hoje has the next class", summary.body.next_class?.session?.id && summary.body.next_class.class_type, summary.body.next_class);
    const dash = await call(marcos, "GET", `/clubs/${club}/dashboard`);
    expect("dashboard lists upcoming classes", Array.isArray(dash.body.upcoming_classes) && dash.body.upcoming_classes.length > 0, dash.body.upcoming_classes);
    const report = await call(marcos, "GET", `/clubs/${club}/reports/attendance`);
    expect("attendance report counts held classes", report.status === 200 && report.body.totals.sessions > 0 && report.body.totals.attended > 0 && report.body.by_type.length > 0 && report.body.athletes.length > 0, report.body.totals);
    expect("students can't read the report", (await call(ana, "GET", `/clubs/${club}/reports/attendance`)).status === 403);

    // A two-seat class in 30 minutes.
    const type = await call(marcos, "POST", `/clubs/${club}/class-types`, { name: "Funcional express", sport: "mobility", default_capacity: 2, duration_min: 40 });
    expect("staff create a class type", type.status === 201, type);
    const soon = local(30);
    const sess = await call(marcos, "POST", `/clubs/${club}/class-sessions`, { class_type_id: type.body.id, date: soon.date, time: soon.time });
    expect("staff create a one-off session with a check-in code", sess.status === 201 && /^[0-9A-F]{6}$/.test(sess.body.checkin_code) && sess.body.checkin_url.includes(sess.body.id), sess.body);
    const sid = sess.body.id;
    const b1 = await call(ana, "POST", `/clubs/${club}/class-sessions/${sid}/bookings`, {});
    const b2 = await call(bruno, "POST", `/clubs/${club}/class-sessions/${sid}/bookings`, {});
    const b3 = await call(carla, "POST", `/clubs/${club}/class-sessions/${sid}/bookings`, {});
    expect("two seats booked", b1.body.status === "booked" && b2.body.status === "booked", [b1.body, b2.body]);
    expect("full: the third waits in line", b3.status === 201 && b3.body.status === "waitlisted" && b3.body.waitlist_position === 1, b3.body);
    expect("booking twice is refused", (await call(ana, "POST", `/clubs/${club}/class-sessions/${sid}/bookings`, {})).body.code === "booking.exists");
    expect("staff can't book a trainer", (await call(marcos, "POST", `/clubs/${club}/class-sessions/${sid}/bookings`, { membership_id: (await call(marcos, "GET", "/me")).body.memberships.find((x) => x.club.id === club).membership.id })).status === 422);

    // Bruno cancels: Carla takes the seat and hears about it (pushed by default).
    expect("a student cancels their seat", (await call(bruno, "DELETE", `/clubs/${club}/bookings/${b2.body.id}`)).status === 204);
    const roster = await call(marcos, "GET", `/clubs/${club}/class-sessions/${sid}`);
    const carlaRow = roster.body.roster.find((r) => r.membership_id === carlaM);
    expect("the waitlist moves up", carlaRow?.status === "booked" && carlaRow.waitlist_position === null && roster.body.waitlist === 0, roster.body.roster);
    const carlaNotes = (await call(carla, "GET", "/me/notifications")).body.items;
    expect("the promoted student is notified", carlaNotes.some((n) => n.kind === "waitlist_promoted" && n.link === `/classes?session=${sid}`), carlaNotes.slice(0, 3));
    const prefs = (await call(carla, "GET", "/me/prefs")).body.kinds;
    expect("class news push by default", prefs.class_cancelled?.push === true && prefs.waitlist_promoted?.push === true, prefs);

    // Check-in: wrong code, then the right one 30 minutes before the start.
    expect("a wrong code is refused", (await call(ana, "POST", `/clubs/${club}/class-sessions/${sid}/check-in`, { checkin_code: "ZZZZZZ" })).body.code === "checkin.invalid_code");
    const checkin = await call(ana, "POST", `/clubs/${club}/class-sessions/${sid}/check-in`, { checkin_code: sess.body.checkin_code.toLowerCase() });
    expect("check-in inside the window marks attended", checkin.status === 200 && checkin.body.status === "attended" && checkin.body.checked_in_at, checkin.body);
    const later = local(3 * 60);
    const far = await call(marcos, "POST", `/clubs/${club}/class-sessions`, { class_type_id: type.body.id, date: later.date, time: later.time });
    expect("check-in outside the window is refused", (await call(ana, "POST", `/clubs/${club}/class-sessions/${far.body.id}/check-in`, { checkin_code: far.body.checkin_code })).body.code === "checkin.window");

    // Attendance by staff; students can't.
    expect("students can't mark attendance", (await call(carla, "PATCH", `/clubs/${club}/bookings/${carlaRow.id}`, { status: "attended" })).status === 403);
    const ns = await call(marcos, "PATCH", `/clubs/${club}/bookings/${carlaRow.id}`, { status: "no_show" });
    expect("staff mark a no-show", ns.body.status === "no_show", ns.body);

    // A class that already started can't be cancelled by the student.
    const started = local(-10);
    const run = await call(marcos, "POST", `/clubs/${club}/class-sessions`, { class_type_id: type.body.id, date: started.date, time: started.time });
    const late = await call(bruno, "POST", `/clubs/${club}/class-sessions/${run.body.id}/bookings`, {});
    expect("a student can't cancel after the start", (await call(bruno, "DELETE", `/clubs/${club}/bookings/${late.body.id}`)).body?.code === "booking.started");

    // Staff cancel the far session with a reason: everyone booked or waiting is told, students stop seeing it.
    await call(bruno, "POST", `/clubs/${club}/class-sessions/${far.body.id}/bookings`, {});
    const cancel = await call(marcos, "PATCH", `/clubs/${club}/class-sessions/${far.body.id}`, { status: "cancelled", cancel_reason: "Chuva forte" });
    expect("staff cancel a session", cancel.body.status === "cancelled" && cancel.body.cancel_reason === "Chuva forte" && cancel.body.roster.length === 0, cancel.body);
    const brunoNotes = (await call(bruno, "GET", "/me/notifications")).body.items;
    expect("booked students hear about the cancellation", brunoNotes.some((n) => n.kind === "class_cancelled" && n.body.includes("Chuva forte")), brunoNotes.slice(0, 3));
    const after = await call(bruno, "GET", `/clubs/${club}/class-sessions?from=${today}&to=${later.date}`);
    expect("a cancelled session leaves the students' list", !after.body.items.some((s) => s.id === far.body.id), after.body.items.map((s) => s.id));
    expect("booking a cancelled session is refused", (await call(carla, "POST", `/clubs/${club}/class-sessions/${far.body.id}/bookings`, {})).body.code === "session.cancelled");

    // Recurring rule: sessions for 8 weeks; ending it cancels the future ones.
    const rule = await call(marcos, "POST", `/clubs/${club}/class-schedules`, { class_type_id: type.body.id, weekdays: [6], start_time: "08:00" });
    expect("a weekly rule creates about 8 weeks of sessions", rule.status === 201 && rule.body.items.length === 1 && rule.body.sessions >= 8 && rule.body.sessions <= 9, rule.body);
    const ended = await call(marcos, "DELETE", `/clubs/${club}/class-schedules/${rule.body.items[0].id}`);
    expect("ending a rule cancels its future sessions", ended.body.cancelled_sessions === rule.body.sessions, ended.body);

    // Leaving the club frees the seat for the next in line.
    const tiny = await call(marcos, "POST", `/clubs/${club}/class-types`, { name: "Turma de um", sport: "strength", default_capacity: 1, duration_min: 30 });
    const tomorrow = local(26 * 60);
    const one = await call(marcos, "POST", `/clubs/${club}/class-sessions`, { class_type_id: tiny.body.id, date: tomorrow.date, time: tomorrow.time });
    await call(bruno, "POST", `/clubs/${club}/class-sessions/${one.body.id}/bookings`, {});
    const wait = await call(carla, "POST", `/clubs/${club}/class-sessions/${one.body.id}/bookings`, {});
    expect("the single seat is taken, the next waits", wait.body.status === "waitlisted", wait.body);
    expect("a student leaves the club", (await call(bruno, "POST", `/clubs/${club}/leave`, {})).status === 204);
    const moved = (await call(marcos, "GET", `/clubs/${club}/class-sessions/${one.body.id}`)).body.roster;
    expect("leaving cancels the bookings and promotes the waitlist", moved.length === 1 && moved[0].membership_id === carlaM && moved[0].status === "booked", moved);
    void anaM; void brunoM;
    return { steps };
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAulasSmoke().then(({ steps }) => console.log(`✓ aulas smoke: ${steps.length} checks`), (e) => { console.error("✗ aulas smoke: " + e.message); process.exit(1); });
}
