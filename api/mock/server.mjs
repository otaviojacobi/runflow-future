#!/usr/bin/env node
/**
 * Runflow mock API (contract: api/endpoints.md, data: api/schema.sql shapes). Zero dependencies.
 *
 *   node api/mock/server.mjs           -> http://localhost:8787  (state persists in api/mock/.data/)
 *   node api/mock/server.mjs --reset   -> reseed relative to today
 *   PORT=… MOCK_LATENCY=ms             -> defaults 8787 / 120 ms (feels like a real network)
 *   MOCK_DATA_FILE=path                -> state file (default api/mock/.data/db.local.json)
 *
 * Route modules live in ./routes/*.mjs and export `default function register(h)`; see `h` below.
 */
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generate, uuid, themeFor } from "./seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const LATENCY = Number(process.env.MOCK_LATENCY ?? 120);
const DATA = join(here, ".data");
// MOCK_DATA_FILE: separate state for automated tests (e2e runs on its own port and file, never the demo).
const LOCAL = process.env.MOCK_DATA_FILE || join(DATA, "db.local.json");

// ------------------------------------------------------------------ time (club-local = America/Sao_Paulo, UTC-3)
const nowIso = () => new Date().toISOString();
const today = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const addDays = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const mondayOf = (s) => addDays(s, -((new Date(s + "T00:00:00Z").getUTCDay() + 6) % 7));

// ------------------------------------------------------------------ data
let db;
function load() {
  const reset = process.argv.includes("--reset");
  if (!reset && existsSync(LOCAL)) {
    db = JSON.parse(readFileSync(LOCAL, "utf8"));
    const age = daysBetween(db.meta.anchor_date, today());
    if (age > 6) {
      console.log(`· saved demo data is ${age} days old, reseeding relative to today`);
      db = generate(today());
    }
    // Tables added to the schema after this data was saved come from the seed (same anchor, same ids); tables
    // removed from it are dropped (keys starting with `_` are the mock's own: uploads, outbox).
    const fresh = generate(db.meta.anchor_date);
    for (const k of Object.keys(fresh)) if (!(k in db)) { db[k] = fresh[k]; console.log(`· added table ${k} from the seed`); }
    for (const k of Object.keys(db)) if (!(k in fresh) && !k.startsWith("_")) { delete db[k]; console.log(`· dropped table ${k}`); }
    // Columns added after this data was saved (D-049): what the seed would have written.
    for (const a of db.activities) a.match_state ??= "open";
    for (const c of db.workout_completions) { c.matched_by ??= c.activity_id ? "auto" : null; c.reported_at ??= c.completed_at; }
  } else db = generate(today());
  persist(true);
}
let timer = null;
function persist(now = false) {
  clearTimeout(timer);
  const write = () => { mkdirSync(dirname(LOCAL), { recursive: true }); writeFileSync(LOCAL, JSON.stringify(db)); };
  if (now) write();
  else timer = setTimeout(write, 300);
}

// ------------------------------------------------------------------ errors (problem+json, pt-BR for people, English code)
class Problem extends Error {
  constructor(status, code, title, detail, extra = {}) {
    super(title);
    Object.assign(this, { status, code, title, detail, extra });
  }
}
const fail = (status, code, title, detail, extra) => { throw new Problem(status, code, title, detail, extra); };
const invalid = (errors) => fail(422, "validation.failed", "Confira os campos", "Alguns campos precisam de ajuste.", { errors });

// ------------------------------------------------------------------ helpers shared with route modules
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const STAFF = ["owner", "trainer"];
/** The plan catalog (D-043): seats per role and prices; the backend reads a synced copy. */
const CATALOG = JSON.parse(readFileSync(join(here, "..", "plans.json"), "utf8"));
const DAY_MS = 86400000;
/** Writes a frozen club's staff may still make: billing, the simulation, closing the club. */
const WHILE_FROZEN = [/^\/v1\/clubs\/[^/]+\/(subscription|invoices)(\/|$)/, /^\/v1\/mock\/stripe\//];
const h = {
  get db() { return db; },
  persist, fail, invalid, uuid: (prefix = "x") => uuid(prefix + ":" + randomBytes(8).toString("hex")),
  nowIso, today, addDays, daysBetween, mondayOf, sha256, themeFor, STAFF,
  token: () => "mock_" + randomBytes(18).toString("base64url"),
  byId: (table, id) => db[table].find((r) => r.id === id),
  /** Shapes */
  publicUser: (u) => u && { id: u.id, email: u.email, name: u.name, avatar_url: u.avatar_url, phone: u.phone, birth_date: u.birth_date, sex: u.sex, locale: u.locale, created_at: u.created_at },
  branding: (clubId) => {
    const b = db.club_branding.find((x) => x.club_id === clubId);
    if (!b) return null;
    const logo = b.logo_asset_id ? `/v1/assets/${b.logo_asset_id}` : null;
    return { primary_color: b.primary_color, secondary_color: b.secondary_color, logo_url: logo, theme_rev: b.theme_rev, theme: b.theme, theme_css: b.theme_css };
  },
  activeStudents: (clubId) => db.memberships.filter((m) => m.club_id === clubId && m.role === "student" && m.status === "active").length,
  activeTrainers: (clubId) => db.memberships.filter((m) => m.club_id === clubId && m.role === "trainer" && m.status === "active").length,
  catalog: CATALOG,
  plan: (id) => CATALOG.plans.find((p) => p.id === id) ?? CATALOG.plans[0],
  /** The subscription payload (endpoints.md § Billing, § Plans). `role`: students never see `frozen`. */
  subscription: (clubId, role) => {
    const s = db.club_subscriptions.find((x) => x.club_id === clubId);
    if (!s) return null;
    const p = h.plan(s.plan), students = h.activeStudents(clubId), trainers = h.activeTrainers(clubId);
    const hard = !p.extra;
    const grace_until = s.status === "past_due" && s.past_due_since ? new Date(Date.parse(s.past_due_since) + CATALOG.grace_days * DAY_MS).toISOString() : null;
    const unpaid = s.plan !== "free" && grace_until !== null && grace_until <= h.nowIso();
    const over = hard && (students > p.students || trainers > p.trainers);
    const monthly = p.price_cents + (p.extra ? Math.max(0, trainers - p.trainers) * p.extra.trainer_cents + Math.max(0, students - p.students) * p.extra.student_cents : 0);
    return {
      plan: s.plan, status: s.status, frozen: role === "student" ? false : unpaid || over, grace_until,
      student_limit: hard ? p.students : null, active_students: students, trainer_limit: hard ? p.trainers : null, active_trainers: trainers,
      included_students: p.students, included_trainers: p.trainers, monthly_cents: monthly,
      current_period_end: s.current_period_end, cancel_at_period_end: s.cancel_at_period_end,
    };
  },
  /** 409 plan.limit_reached when a hard-limited seat is full (Free/Pro; Max bills extra seats instead). */
  ensureSeat: (clubId, role, adding = 1) => {
    const s = h.subscription(clubId);
    const limit = role === "trainer" ? s.trainer_limit : s.student_limit;
    if (limit === null) return;
    const used = role === "trainer" ? s.active_trainers : s.active_students;
    if (used + adding > limit) {
      const p = h.plan(s.plan);
      const what = role === "trainer" ? (limit === 1 ? "1 treinador" : `${limit} treinadores`) : `${limit} alunos`;
      fail(409, "plan.limit_reached", role === "trainer" ? "Limite de treinadores atingido" : "Limite de alunos atingido", `O plano ${p.name} inclui ${what}. Faça upgrade em Plano e cobrança para liberar mais vagas.`);
    }
  },
  list: (items, ctx, limit = 50) => {
    const start = Number(ctx.query.cursor || 0);
    const n = Math.min(Number(ctx.query.limit || limit), 500);
    const page = items.slice(start, start + n);
    return { items: page, next_cursor: start + n < items.length ? String(start + n) : null };
  },
  /** Body helpers */
  str: (body, field, label, { required = true, max = 200 } = {}) => {
    const v = typeof body[field] === "string" ? body[field].trim() : "";
    if (required && !v) invalid([{ field, message: `Informe ${label}.` }]);
    if (v.length > max) invalid([{ field, message: `Use no máximo ${max} caracteres.` }]);
    return v || null;
  },
};

// ------------------------------------------------------------------ router
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
  routes.push({ method, rx, keys, handler });
}
for (const m of ["get", "post", "put", "patch", "delete"]) h[m] = (p, fn) => route(m.toUpperCase(), p, fn);

function authOf(req) {
  const header = req.headers.authorization || "";
  const cookie = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith("rf_session="));
  const token = header.startsWith("Bearer ") ? header.slice(7) : cookie ? cookie.slice(11) : null;
  if (!token) return null;
  const s = db.sessions.find((x) => x.token_hash === sha256(token) && !x.revoked_at && x.expires_at > nowIso());
  const user = s && db.users.find((u) => u.id === s.user_id && !u.deleted_at);
  return user ? { session: s, user } : null;
}
function context(req, url, params, body) {
  const auth = authOf(req);
  const ctx = {
    req, params, body, query: Object.fromEntries(url.searchParams), auth,
    user() {
      if (!auth) fail(401, "auth.required", "Entre para continuar", "Sua sessão expirou ou você ainda não entrou.");
      return auth.user;
    },
    /** Active membership of the caller in a club, optionally restricted to roles. */
    member(clubId, roles = ["owner", "trainer", "student"]) {
      const u = ctx.user();
      const m = db.memberships.find((x) => x.club_id === clubId && x.user_id === u.id && x.status === "active");
      if (!m) fail(404, "club.not_found", "Clube não encontrado", "Você não participa deste clube.");
      if (!roles.includes(m.role)) fail(403, "auth.forbidden", "Sem permissão", "Seu papel no clube não permite esta ação.");
      // Frozen clubs (D-043): staff can only pay (or close the club); students never notice.
      const path = new URL(req.url, "http://mock").pathname;
      const closing = req.method === "DELETE" && /^\/v1\/clubs\/[^/]+$/.test(path);
      if (req.method !== "GET" && m.role !== "student" && !closing && !WHILE_FROZEN.some((r) => r.test(path)) && h.subscription(clubId, m.role)?.frozen) {
        fail(423, "club.frozen", "Clube congelado", m.role === "owner" ? "O pagamento do plano está pendente. Regularize em Plano e cobrança para voltar a usar o clube." : "O pagamento do plano está pendente. Peça ao responsável pelo clube para regularizar.");
      }
      return m;
    },
    staff(clubId) { return ctx.member(clubId, STAFF); },
    owner(clubId) { return ctx.member(clubId, ["owner"]); },
  };
  return ctx;
}

function send(res, status, data, extraHeaders = {}) {
  const isProblem = status >= 400;
  res.writeHead(status, {
    "Content-Type": isProblem ? "application/problem+json; charset=utf-8" : "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "ETag", ...extraHeaders,
  });
  res.end(status === 204 ? undefined : JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 12 * 1024 * 1024) fail(413, "request.too_large", "Arquivo muito grande", "O limite é 10 MB.");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail(400, "request.invalid_json", "Requisição inválida", "O corpo da requisição não é um JSON válido."); }
}

async function handle(req, res) {
  const started = Date.now();
  const url = new URL(req.url, "http://mock");
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type,If-None-Match,X-Client", "Access-Control-Max-Age": "600" });
    return res.end();
  }
  let status = 500;
  try {
    if (LATENCY) await new Promise((r) => setTimeout(r, LATENCY * (0.6 + Math.random() * 0.8)));
    const r = routes.find((x) => x.method === req.method && x.rx.test(url.pathname));
    if (!r) fail(404, "route.not_found", "Rota não encontrada", `${req.method} ${url.pathname} não existe no mock da API.`);
    const m = url.pathname.match(r.rx);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : {};
    const out = await r.handler(context(req, url, params, body));
    if (out && out.__raw) {
      status = out.status || 200;
      res.writeHead(status, { "Access-Control-Allow-Origin": "*", ...out.headers });
      res.end(out.body);
    } else {
      status = out === undefined ? 204 : out && out.__status ? out.__status : 200;
      send(res, status, out && out.__status ? out.data : out);
      if (req.method !== "GET") persist();
    }
  } catch (e) {
    if (e instanceof Problem) {
      status = e.status;
      send(res, e.status, { type: "about:blank", status: e.status, code: e.code, title: e.title, detail: e.detail, ...e.extra });
    } else {
      console.error(e);
      send(res, 500, { type: "about:blank", status: 500, code: "internal", title: "Algo deu errado", detail: "Tente novamente em instantes." });
    }
  }
  console.log(`${req.method.padEnd(6)} ${url.pathname}${url.search} → ${status} ${Date.now() - started}ms`);
}

// ------------------------------------------------------------------ boot
load();
const dir = join(here, "routes");
for (const f of readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort()) {
  const mod = await import(pathToFileURL(join(dir, f)).href);
  mod.default(h);
}
h.get("/v1/public/plans", () => CATALOG);
h.get("/v1/public/config", () => ({ google_client_id: null, strava: true, push_public_key: null, sentry: null, analytics: null }));
h.get("/v1/health", () => ({ ok: true, version: "mock", database: { ok: true, latency_ms: 0 }, anchor_date: db.meta.anchor_date, routes: routes.length }));
http.createServer(handle).listen(PORT, () =>
  console.log(`Runflow mock API → http://localhost:${PORT}/v1  (${routes.length} routes, data anchored at ${db.meta.anchor_date}, latency ~${LATENCY}ms)`),
);
