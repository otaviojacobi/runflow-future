/** Personal calendar feed (F29): secret .ics URL with planned workouts, booked classes and races. */
import { randomBytes } from "node:crypto";

const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** RFC 5545 folding: lines longer than 75 octets continue with a leading space. */
const fold = (line) => { const out = []; let rest = line; while (Buffer.byteLength(rest) > 75) { let cut = 75; while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--; out.push(rest.slice(0, cut)); rest = " " + rest.slice(cut); } out.push(rest); return out.join("\r\n"); };

export default function register(h) {
  const APP = "https://runflow.club";
  // Behind the web dev server the API lives under /api (the proxy strips it); the backend uses its public base URL.
  const urlFor = (token, req) => { const host = req.headers.host || "localhost:8787"; const prefix = host.endsWith(":8787") ? "" : "/api"; return `${req.headers["x-forwarded-proto"] === "https" ? "https" : "http"}://${host}${prefix}/v1/ics/${token}.ics`; };

  h.get("/v1/me/calendar-feed", (ctx) => { const f = h.db.calendar_feeds.find((x) => x.user_id === ctx.user().id); return { active: !!f, created_at: f?.created_at ?? null }; });
  h.post("/v1/me/calendar-feed", (ctx) => {
    const u = ctx.user();
    const token = randomBytes(24).toString("base64url");
    h.db.calendar_feeds = h.db.calendar_feeds.filter((x) => x.user_id !== u.id);
    h.db.calendar_feeds.push({ user_id: u.id, token_hash: h.sha256(token), created_at: h.nowIso() });
    const url = urlFor(token, ctx.req);
    return { __status: 201, data: { url, webcal_url: url.replace(/^https?:/, "webcal:"), created_at: h.nowIso() } };
  });
  h.delete("/v1/me/calendar-feed", (ctx) => { const u = ctx.user(); h.db.calendar_feeds = h.db.calendar_feeds.filter((x) => x.user_id !== u.id); });

  h.get("/v1/ics/:file", (ctx) => {
    const token = String(ctx.params.file).replace(/\.ics$/, "");
    const feed = h.db.calendar_feeds.find((x) => x.token_hash === h.sha256(token));
    if (!feed) h.fail(404, "calendar.not_found", "Calendário não encontrado", "O link foi desativado. Gere um novo no app.");
    const mids = h.db.memberships.filter((m) => m.user_id === feed.user_id && m.status === "active" && m.role === "student");
    const clubName = (cid) => h.db.clubs.find((c) => c.id === cid)?.name ?? "";
    const from = h.addDays(h.today(), -30), to = h.addDays(h.today(), 120), now = stamp(h.nowIso());
    const ev = [];
    for (const m of mids) {
      for (const p of h.db.planned_workouts.filter((x) => x.athlete_membership_id === m.id && x.date >= from && x.date <= to)) {
        const d = p.date.replace(/-/g, "");
        ev.push(["BEGIN:VEVENT", `UID:workout-${p.id}@runflow.club`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${h.addDays(p.date, 1).replace(/-/g, "")}`, `SUMMARY:${esc(p.title)}`, `DESCRIPTION:${esc(`${clubName(m.club_id)} · ${APP}/workouts/${p.id}`)}`, `URL:${APP}/workouts/${p.id}`, "TRANSP:TRANSPARENT", "END:VEVENT"]);
      }
      for (const b of h.db.bookings.filter((x) => x.membership_id === m.id && (x.status === "booked" || x.status === "attended"))) {
        const s = h.db.class_sessions.find((x) => x.id === b.session_id && x.status === "scheduled");
        if (!s || s.starts_at.slice(0, 10) < from || s.starts_at.slice(0, 10) > to) continue;
        const ct = h.db.class_types.find((x) => x.id === s.class_type_id), loc = h.db.locations.find((x) => x.id === s.location_id);
        ev.push(["BEGIN:VEVENT", `UID:class-${s.id}@runflow.club`, `DTSTAMP:${now}`, `DTSTART:${stamp(s.starts_at)}`, `DTEND:${stamp(s.ends_at)}`, `SUMMARY:${esc(`Aula: ${ct?.name ?? ""}`)}`, ...(loc ? [`LOCATION:${esc([loc.name, loc.address].filter(Boolean).join(", "))}`] : []), `DESCRIPTION:${esc(clubName(m.club_id))}`, "END:VEVENT"]);
      }
      for (const e of h.db.race_entries.filter((x) => x.membership_id === m.id)) {
        const r = h.db.races.find((x) => x.id === e.race_id && !x.archived_at);
        if (!r || r.date < from) continue;
        ev.push(["BEGIN:VEVENT", `UID:race-${e.id}@runflow.club`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${r.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${h.addDays(r.date, 1).replace(/-/g, "")}`, `SUMMARY:${esc(`Prova: ${r.name}`)}`, ...(r.city ? [`LOCATION:${esc([r.city, r.state].filter(Boolean).join(" · "))}`] : []), "END:VEVENT"]);
      }
    }
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Runflow//Treinos//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Runflow · Treinos", "X-WR-TIMEZONE:America/Sao_Paulo", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", ...ev.flat(), "END:VCALENDAR"];
    return { __raw: true, headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900" }, body: Buffer.from(lines.map(fold).join("\r\n") + "\r\n", "utf8") };
  });
}
