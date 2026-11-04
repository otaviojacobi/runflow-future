#!/usr/bin/env node
/**
 * Deterministic demo data for the mock API. Every table key and column mirrors api/schema.sql.
 *
 *   node api/mock/seed.mjs [YYYY-MM-DD]   -> writes api/mock/db.json (default anchor: 2026-11-03, a Tuesday)
 *   import { generate } from "./seed.mjs"  -> the mock server seeds relative to *today* on first run / --reset
 *
 * Story: "Pace Forte Assessoria" (running club, São Paulo, Free plan, 9/10 students, primary + secondary colors)
 * and "Equipe Maré Natação" (swim school, Santos, Pro plan, one color, classes). Ana is a student in both.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { compute as computeAssessment } from "./lib/assessments.mjs";
import { solve as solveMatches } from "./lib/matching.mjs";

const require = createRequire(import.meta.url);
const Color = require("@runflow/design/color");
const Tokens = require("@runflow/design/tokens.json");
const DEFAULTS = { brand: Tokens.seeds.brand, accent: Tokens.seeds.accent };

// ---------------------------------------------------------------- helpers
export const uuid = (name) => {
  const h = createHash("sha256").update("runflow:" + name).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAY = 86400000;
const parseDate = (s) => new Date(s + "T00:00:00Z");
const fmtDate = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => fmtDate(new Date(parseDate(s).getTime() + n * DAY));
const isoWeekday = (s) => ((parseDate(s).getUTCDay() + 6) % 7) + 1; // 1 = Monday
const mondayOf = (s) => addDays(s, 1 - isoWeekday(s));
/** Club-local (America/Sao_Paulo, UTC-3) date + "HH:MM" -> UTC ISO timestamp. */
const at = (date, hhmm) => new Date(parseDate(date).getTime() + (Number(hhmm.slice(0, 2)) + 3) * 3600000 + Number(hhmm.slice(3, 5)) * 60000).toISOString();
export function themeFor(primary, secondary) {
  const input = { primary, secondary };
  const r = Color.resolveClubColors(input, DEFAULTS);
  const roles = (mode) => {
    const pick = (seed) => Object.fromEntries(Color.ROLE_KEYS.map((k) => [k, Color.roles(seed, mode, Tokens.env[mode])[k]]));
    return { brand: pick(r.primary), accent: pick(r.secondary) };
  };
  return { theme: { ...r, roles: { light: roles("light"), dark: roles("dark") } }, theme_css: Color.clubThemeCss(input, Tokens.env, DEFAULTS) };
}

// ---------------------------------------------------------------- workout structures
const time = (s) => ({ type: "time", s });
const dist = (m) => ({ type: "distance", m });
const open = { type: "open" };
const zone = (z, metric = "pace") => ({ type: "zone", metric, zone: z });
const pace = (min_s, max_s) => ({ type: "pace", min_s, max_s });
const step = (intent, duration, target = open, extra = {}) => ({ kind: "step", intent, duration, target, ...extra });
const rep = (count, steps) => ({ kind: "repeat", count, steps });
const ex = (name, sets, reps, load, rest_s, note) => ({ kind: "exercise", name, sets, reps, load, rest_s, ...(note ? { note } : {}) });
const S = (blocks) => ({ v: 1, blocks });

const ZONE_PACE = { 1: 390, 2: 345, 3: 310, 4: 285, 5: 260 };
/** Rough duration/distance estimate (the frontend has its own, richer estimator). */
export function estimate(sport, structure) {
  let s = 0, m = 0;
  const per = sport === "swim" ? 120 / 100 : 1 / 1000; // seconds per meter factor base
  const speedOf = (t) => {
    if (sport === "swim") return t && t.type === "pace" ? (t.min_s + t.max_s) / 2 / 100 : 1.25;
    if (t && t.type === "pace") return (t.min_s + t.max_s) / 2 / 1000;
    if (t && t.type === "zone") return ZONE_PACE[t.zone] / 1000;
    // PSE → the zone it stands for (1–2 → Z1 … 9–10 → Z5), like the frontend's zoneOf.
    if (t && t.type === "rpe") return ZONE_PACE[t.value >= 9 ? 5 : t.value >= 7 ? 4 : t.value >= 5 ? 3 : t.value >= 3 ? 2 : 1] / 1000;
    return 330 / 1000;
  };
  const walk = (blocks, mult) => {
    for (const b of blocks) {
      if (b.kind === "repeat") walk(b.steps, mult * b.count);
      else if (b.kind === "exercise") s += mult * b.sets * (45 + (b.rest_s || 60));
      else if (b.duration.type === "time") { s += mult * b.duration.s; if (sport === "run" || sport === "swim") m += (mult * b.duration.s) / speedOf(b.target); }
      else if (b.duration.type === "distance") { m += mult * b.duration.m; s += mult * b.duration.m * speedOf(b.target); }
      else s += mult * 300;
    }
  };
  walk(structure.blocks, 1);
  void per;
  return { est_duration_s: Math.round(s / 60) * 60, est_distance_m: sport === "run" || sport === "swim" || sport === "bike" ? Math.round(m / 100) * 100 : null };
}

export const LIB = {
  easy6: ["run", "Rodagem leve 6 km", S([step("active", dist(6000), zone(2))]), ["base"]],
  regen5: ["run", "Regenerativo 5 km", S([step("active", dist(5000), zone(1), { note: "Bem leve, conversando." })]), ["recuperação"]],
  int6x1k: ["run", "Intervalado 6×1 km", S([step("warmup", time(600), zone(2)), rep(6, [step("active", dist(1000), pace(265, 275)), step("recovery", time(120), open, { note: "trote" })]), step("cooldown", time(600), zone(1))]), ["intervalado", "vo2"]],
  int8x400: ["run", "Intervalado 8×400 m", S([step("warmup", time(900), zone(2)), rep(8, [step("active", dist(400), pace(235, 245)), step("recovery", time(90), open, { note: "trote" })]), step("cooldown", time(600), zone(1))]), ["intervalado", "velocidade"]],
  fartlek: ["run", "Fartlek 40′", S([step("warmup", time(600), zone(2)), rep(8, [step("active", time(60), zone(5)), step("recovery", time(120), zone(2))]), step("cooldown", time(360), zone(1))]), ["fartlek"]],
  tempo: ["run", "Tempo run 30′", S([step("warmup", time(600), zone(2)), step("active", time(1800), pace(280, 290)), step("cooldown", time(600), zone(1))]), ["limiar"]],
  long: ["run", "Longão 18 km", S([step("active", dist(18000), zone(2), { note: "Hidratação a cada 5 km." })]), ["longão"]],
  prog10: ["run", "Progressivo 10 km", S([step("active", dist(4000), zone(2)), step("active", dist(3000), zone(3)), step("active", dist(3000), zone(4))]), ["progressivo"]],
  test5k: ["run", "Teste de 5 km", S([step("warmup", time(900), zone(2)), step("active", dist(5000), { type: "rpe", value: 9 }, { note: "Forte e constante." }), step("cooldown", time(600), zone(1))]), ["teste"]],
  forcaA: ["strength", "Força A: inferiores", S([ex("Agachamento livre", 4, "8", { type: "pct_1rm", value: 70 }, 90), ex("Levantamento terra romeno", 3, "10", { type: "kg", value: 40 }, 90), ex("Afundo alternado", 3, "12", { type: "bodyweight" }, 60), ex("Panturrilha em pé", 4, "15", { type: "bodyweight" }, 45)]), ["força"]],
  forcaB: ["strength", "Força B: superiores e core", S([ex("Supino com halteres", 4, "8-10", { type: "kg", value: 14 }, 90), ex("Remada curvada", 4, "10", { type: "kg", value: 30 }, 90), ex("Prancha", 3, "45 s", { type: "bodyweight" }, 45), ex("Elevação pélvica", 3, "12", { type: "kg", value: 40 }, 60)]), ["força", "core"]],
  mob: ["mobility", "Mobilidade 20′", S([step("other", time(1200), open, { note: "Quadril, tornozelo e coluna torácica." })]), ["mobilidade"]],
  swimTech: ["swim", "Técnica de crawl 2.000 m", S([step("warmup", dist(300), open, { stroke: "free" }), rep(8, [step("active", dist(50), open, { stroke: "drill", note: "Educativo: polegar na coxa" })]), rep(6, [step("active", dist(100), zone(2), { stroke: "free", send_off_s: 120 })]), step("cooldown", dist(200), open, { stroke: "choice" })]), ["técnica"]],
  swim10x100: ["swim", "Séries 10×100 m", S([step("warmup", dist(400), open, { stroke: "free" }), rep(10, [step("active", dist(100), pace(95, 100), { stroke: "free", send_off_s: 120, equipment: ["paddles"] })]), step("cooldown", dist(200), open, { stroke: "back" })]), ["séries"]],
};

/** Starter library per modality: copied into every new club (POST /clubs). */
export const STARTER = { run: ["easy6", "regen5", "int6x1k", "int8x400", "fartlek", "tempo", "long", "prog10"], strength: ["forcaA", "forcaB"], mobility: ["mob"], swim: ["swimTech", "swim10x100"] };
/** Contract artifact `api/starter-library.json` (the backend reads a synced copy): templates per modality, estimates included. */
export const starterLibrary = () =>
  Object.fromEntries(Object.entries(STARTER).map(([mod, keys]) => [mod, keys.map((k) => { const [sport, name, structure, tags] = LIB[k]; return { key: k, sport, name, structure, tags, ...estimate(sport, structure) }; })]));

/** Runflow's global exercise catalog (contract artifact `api/exercise-catalog.json`; ids are stable). */
export const EXERCISE_CATALOG = [
  ["Agachamento livre", "strength", ["quadríceps", "glúteos"], ["barra"], "Pés na largura dos ombros, joelhos acompanham a ponta dos pés, desça até a coxa paralela mantendo o tronco firme."],
  ["Levantamento terra romeno", "strength", ["posteriores", "glúteos"], ["barra", "halteres"], "Joelhos levemente flexionados, quadril vai para trás, barra rente às pernas, coluna neutra."],
  ["Afundo alternado", "strength", ["quadríceps", "glúteos"], [], "Passo longo, joelho de trás quase toca o chão, tronco reto."],
  ["Panturrilha em pé", "strength", ["panturrilha"], ["degrau"], "Suba na ponta dos pés devagar e desça abaixo da linha do degrau."],
  ["Supino com halteres", "strength", ["peitoral", "tríceps"], ["halteres", "banco"], "Escápulas encaixadas, desça os halteres até a linha do peito e empurre em linha reta."],
  ["Remada curvada", "strength", ["costas", "bíceps"], ["barra", "halteres"], "Tronco inclinado a 45°, puxe em direção ao umbigo aproximando as escápulas."],
  ["Elevação pélvica", "strength", ["glúteos", "posteriores"], ["banco", "barra"], "Costas apoiadas no banco, empurre pelos calcanhares e contraia o glúteo no alto."],
  ["Agachamento búlgaro", "strength", ["quadríceps", "glúteos"], ["banco", "halteres"], "Pé de trás no banco, desça na vertical; o joelho da frente não passa muito da ponta do pé."],
  ["Step-up", "strength", ["quadríceps", "glúteos"], ["caixa"], "Suba empurrando pela perna de cima, sem impulso da de baixo."],
  ["Ponte unilateral", "strength", ["glúteos"], [], "Uma perna estendida, quadril alinhado durante toda a subida."],
  ["Prancha", "core", ["abdômen"], [], "Cotovelos sob os ombros, corpo em linha reta, sem deixar o quadril cair."],
  ["Prancha lateral", "core", ["oblíquos"], [], "Quadril alto, corpo alinhado da cabeça aos pés."],
  ["Dead bug", "core", ["abdômen"], [], "Lombar colada no chão; estenda braço e perna opostos devagar."],
  ["Bird dog", "core", ["lombar", "abdômen"], [], "Quatro apoios, estenda braço e perna opostos sem girar o quadril."],
  ["Mobilidade de quadril 90/90", "mobility", ["quadril"], [], "Sentado com as pernas a 90°, gire o quadril de um lado para o outro sem usar as mãos."],
  ["Mobilidade de tornozelo na parede", "mobility", ["tornozelo"], [], "Joelho vai em direção à parede sem tirar o calcanhar do chão."],
  ["Rotação torácica", "mobility", ["coluna torácica"], [], "Em quatro apoios, mão na nuca, gire abrindo o cotovelo para o teto."],
  ["Alongamento de flexores do quadril", "stretch", ["flexores do quadril"], [], "Em afundo com joelho no chão, contraia o glúteo e leve o quadril à frente. 30 s cada lado."],
  ["Alongamento de posteriores", "stretch", ["posteriores"], [], "Perna estendida, incline o tronco com a coluna longa. 30 s cada lado."],
  ["Skipping alto", "drill", ["corrida"], [], "Joelhos à altura do quadril, apoio no antepé, braços coordenados."],
  ["Anfersen", "drill", ["corrida"], [], "Calcanhar em direção ao glúteo, passada curta e rápida."],
  ["Corrida com elevação de joelhos", "drill", ["corrida"], [], "Postura alta, contato curto com o chão."],
  ["Saltos no caixote", "plyometrics", ["quadríceps", "glúteos"], ["caixa"], "Aterrisse suave com os joelhos semiflexionados; desça do caixote sem saltar."],
  ["Saltos laterais", "plyometrics", ["glúteos", "tornozelo"], [], "Saltos de um pé para o outro, aterrissagem estável."],
];
export const exerciseCatalog = () => EXERCISE_CATALOG.map(([name, category, muscles, equipment, cues]) => ({ id: uuid("exercise:" + name), name, category, muscles, equipment, cues }));

// ---------------------------------------------------------------- generate
export function generate(anchor) {
  const rand = prng(20261103);
  /** Fisher–Yates with the seeded PRNG: same result on every JS engine (a random sort comparator is not). */
  const shuffle = (xs) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const r = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const W0 = mondayOf(anchor);
  const T = {};
  const t = (name) => (T[name] ||= []);
  const createdLongAgo = at(addDays(W0, -70), "10:00");

  // ---- users
  const U = {};
  const person = (key, name, email, extra = {}) => {
    const row = { id: uuid("user:" + key), email, name, avatar_url: null, phone: null, birth_date: null, sex: null, locale: "pt-BR", created_at: createdLongAgo, updated_at: createdLongAgo, deleted_at: null, ...extra };
    t("users").push(row);
    t("auth_identities").push({ id: uuid("ident:" + key), user_id: row.id, provider: "google", subject: "google-" + key, email, created_at: createdLongAgo });
    t("notification_prefs").push({ user_id: row.id, kinds: {}, paused: false, updated_at: createdLongAgo });
    t("consents").push(
      { id: uuid("consent:terms:" + key), user_id: row.id, club_id: null, kind: "terms", text_version: "2026-10", granted_at: createdLongAgo, revoked_at: null },
      { id: uuid("consent:privacy:" + key), user_id: row.id, club_id: null, kind: "privacy", text_version: "2026-10", granted_at: createdLongAgo, revoked_at: null },
    );
    U[key] = row;
    return row;
  };
  person("marcos", "Marcos Oliveira", "marcos@paceforte.com.br", { phone: "+5511987650001", birth_date: "1984-03-12", sex: "male" });
  person("julia", "Júlia Santos", "julia@paceforte.com.br", { phone: "+5511987650002", birth_date: "1991-07-30", sex: "female" });
  person("renata", "Renata Prado", "renata@equipemare.com.br", { phone: "+5513991230001", birth_date: "1979-11-02", sex: "female" });
  const PF_STUDENTS = [
    ["ana", "Ana Souza", "female", "1993-05-21", "42k", "advanced", 270, 186, "marathon"],
    ["bruno", "Bruno Lima", "male", "1988-09-14", "21k", "intermediate", 300, 182, "marathon"],
    ["carla", "Carla Mendes", "female", "1990-01-08", "10k", "intermediate", 330, 190, "strength"],
    ["diego", "Diego Rocha", "male", "1985-12-03", "42k", "advanced", 275, 178, "marathon"],
    ["elisa", "Elisa Martins", "female", "1998-04-17", "5k", "beginner", 400, 194, "beginner"],
    ["felipe", "Felipe Costa", "male", "1995-08-25", "health", "beginner", 380, 189, "beginner"],
    ["gabriela", "Gabriela Alves", "female", "1987-02-11", "10k", "beginner", 370, 183, "beginner"],
    ["henrique", "Henrique Dias", "male", "1982-06-29", "21k", "intermediate", 305, 176, "marathon"],
    ["isabela", "Isabela Freitas", "female", "1996-10-05", "health", "intermediate", 345, 191, "strength"],
  ];
  for (const [k, name, sex, bd] of PF_STUDENTS) person(k, name, `${k}.${name.split(" ")[1].toLowerCase()}@email.com`, { sex, birth_date: bd, phone: "+55119" + String(r(10000000, 99999999)) });
  const MARE_STUDENTS = [["lucas", "Lucas Ferreira", "male"], ["marina", "Marina Ribeiro", "female"], ["rafael", "Rafael Gomes", "male"], ["sofia", "Sofia Carvalho", "female"], ["tiago", "Tiago Nunes", "male"]];
  for (const [k, name, sex] of MARE_STUDENTS) person(k, name, `${k}.${name.split(" ")[1].toLowerCase()}@email.com`, { sex });

  // ---- clubs, branding, subscriptions
  const club = (key, row, colors, sub) => {
    const c = { id: uuid("club:" + key), timezone: "America/Sao_Paulo", created_at: createdLongAgo, updated_at: createdLongAgo, deleted_at: null, release_mode: "weekly", auto_release_weekday: 7, auto_release_time: "18:00", ...row };
    t("clubs").push(c);
    const th = themeFor(colors[0], colors[1]);
    t("club_branding").push({ club_id: c.id, primary_color: colors[0], secondary_color: colors[1], logo_asset_id: null, theme_rev: 3, engine_version: 1, ...th, updated_at: createdLongAgo });
    t("club_subscriptions").push({ club_id: c.id, stripe_customer_id: null, stripe_subscription_id: null, current_period_end: null, cancel_at_period_end: false, past_due_since: null, updated_at: createdLongAgo, ...sub });
    return c;
  };
  const PF = club("paceforte", { slug: "paceforte", name: "Pace Forte Assessoria", city: "São Paulo", state: "SP", modalities: ["run", "strength", "mobility"], trainer_label: "treinador" }, ["#D62828", "#FFB703"], { plan: "free", status: "active" });
  const MARE = club("mare", { slug: "equipemare", name: "Equipe Maré Natação", city: "Santos", state: "SP", modalities: ["swim"], trainer_label: "professor", release_mode: "immediate", auto_release_weekday: null, auto_release_time: null }, ["#0096C7", null], { plan: "pro", status: "active", stripe_customer_id: "cus_mock_mare", stripe_subscription_id: "sub_mock_mare", current_period_end: at(addDays(anchor, 18), "00:00") });
  for (let i = 3; i >= 1; i--) {
    const start = addDays(anchor, 18 - 30 * (i + 1)), end = addDays(anchor, 18 - 30 * i);
    t("invoices").push({ id: uuid("inv:mare:" + i), club_id: MARE.id, stripe_invoice_id: "in_mock_mare_" + i, amount_cents: 2000, currency: "BRL", status: "paid", period_start: at(start, "00:00"), period_end: at(end, "00:00"), hosted_url: null, created_at: at(start, "09:00") });
  }

  // ---- exercise library (F28): Runflow's global catalog (no videos seeded: clubs add their own links)
  for (const e of exerciseCatalog()) t("exercises").push({ ...e, club_id: null, video_url: null, created_by: null, created_at: createdLongAgo, archived_at: null });

  // ---- memberships, consents, groups
  const M = {};
  const member = (clubRow, ukey, role, extra = {}) => {
    const row = { id: uuid(`m:${clubRow.slug}:${ukey}`), club_id: clubRow.id, user_id: U[ukey].id, role, status: "active", is_billing_owner: false, joined_at: at(addDays(W0, -60 + r(0, 30)), "12:00"), left_at: null, ...extra };
    t("memberships").push(row);
    M[`${clubRow.slug}:${ukey}`] = row;
    if (role === "student") t("consents").push({ id: uuid(`consent:share:${clubRow.slug}:${ukey}`), user_id: U[ukey].id, club_id: clubRow.id, kind: "share_training_data", text_version: "2026-10", granted_at: row.joined_at, revoked_at: null });
    return row;
  };
  member(PF, "marcos", "owner", { is_billing_owner: true, joined_at: createdLongAgo });
  member(PF, "julia", "trainer");
  for (const s of PF_STUDENTS) member(PF, s[0], "student");
  member(MARE, "renata", "owner", { is_billing_owner: true, joined_at: createdLongAgo });
  member(MARE, "ana", "student");
  for (const s of MARE_STUDENTS) member(MARE, s[0], "student");
  M["paceforte:isabela"].joined_at = at(addDays(anchor, -2), "19:12");

  const group = (key, name, description, keys) => {
    const g = { id: uuid("group:" + key), club_id: PF.id, name, description, created_at: createdLongAgo };
    t("groups").push(g);
    for (const k of keys) t("group_members").push({ group_id: g.id, membership_id: M["paceforte:" + k].id, added_at: createdLongAgo });
  };
  group("maratona", "Maratona SP 2027", "Preparação para a Maratona de São Paulo.", ["ana", "bruno", "diego", "henrique"]);
  group("iniciantes", "Iniciantes", "Primeiros 5 e 10 km.", ["elisa", "felipe", "gabriela"]);
  group("forca", "Força e corrida", "Corrida + musculação.", ["bruno", "carla", "isabela"]);

  // ---- invitations
  // Personal invites (D-023): one per e-mail, 7 days, single use.
  const inv = (key, clubRow, role, by, email, name, sentDaysAgo, extra = {}) => {
    const sent = at(addDays(anchor, -sentDaysAgo), "10:00");
    t("invitations").push({ id: uuid("inv:" + key), club_id: clubRow.id, role, email, name, token: uuid("invtoken:" + key).replace(/-/g, "").slice(0, 24), group_ids: [], created_by: by, expires_at: at(addDays(anchor, 7 - sentDaysAgo), "10:00"), sent_at: sent, send_count: 1, accepted_at: null, accepted_by: null, revoked_at: null, created_at: sent, ...extra });
  };
  const marcos = M["paceforte:marcos"].id;
  inv("pf-joao", PF, "student", marcos, "joao.pereira@email.com", "João", 1, { group_ids: [uuid("group:iniciantes")] });
  inv("pf-luiza", PF, "student", marcos, "luiza.campos@email.com", "Luiza", 6);
  inv("pf-pedro", PF, "student", marcos, "pedro.alves@email.com", "Pedro", 12);
  inv("pf-isabela", PF, "student", marcos, "isabela.freitas@email.com", "Isabela", 4, { accepted_at: at(addDays(anchor, -2), "19:12"), accepted_by: U.isabela.id });
  inv("pf-rafael", PF, "trainer", marcos, "rafael.souza@email.com", "Rafael", 2);
  inv("mare-camila", MARE, "student", M["equipemare:renata"].id, "camila.rocha@email.com", "Camila", 3);

  // ---- athlete profiles + zones
  for (const [k, , , , goal, level, thr, maxhr] of PF_STUDENTS) {
    const m = M["paceforte:" + k];
    t("athlete_profiles").push({ membership_id: m.id, goal, goal_note: null, goal_date: goal === "42k" ? "2027-06-06" : null, level, weekly_sessions: level === "beginner" ? 3 : 5, max_hr: maxhr, resting_hr: r(48, 62), threshold_pace_s_per_km: thr, css_s_per_100m: null, ftp_w: null, recent_race: level === "beginner" ? null : { distance_m: 10000, time_s: Math.round(thr * 10 * 1.04), date: addDays(W0, -40) }, trainer_notes: k === "carla" ? "Plantões no hospital: evitar treinos fortes às segundas." : null, updated_at: createdLongAgo });
    const f = [1.3, 1.17, 1.08, 1.0, 0.94];
    t("zones").push({ id: uuid("zones:pace:" + k), membership_id: m.id, kind: "pace", source: level === "beginner" ? "estimated" : "race", bounds: f.map((x, i) => ({ zone: i + 1, min: Math.round(thr * (f[i + 1] || 0.85)), max: Math.round(thr * x) })), valid_from: addDays(W0, -40), created_by: M["paceforte:marcos"].id, created_at: createdLongAgo });
    const hrf = [0.6, 0.7, 0.8, 0.9, 1.0];
    t("zones").push({ id: uuid("zones:hr:" + k), membership_id: m.id, kind: "hr", source: "estimated", bounds: hrf.map((x, i) => ({ zone: i + 1, min: Math.round(maxhr * (hrf[i - 1] || 0.5)), max: Math.round(maxhr * x) })), valid_from: addDays(W0, -40), created_by: M["paceforte:marcos"].id, created_at: createdLongAgo });
  }
  t("athlete_profiles").push({ membership_id: M["equipemare:ana"].id, goal: "swim", goal_note: null, goal_date: null, level: "intermediate", weekly_sessions: 2, max_hr: 186, resting_hr: 52, threshold_pace_s_per_km: null, css_s_per_100m: 98, ftp_w: null, recent_race: null, trainer_notes: null, updated_at: createdLongAgo });

  // ---- library
  const TPL = {};
  const tpl = (key, clubRow, author) => {
    const [sport, name, structure, tags] = LIB[key];
    const row = { id: uuid(`tpl:${clubRow.slug}:${key}`), club_id: clubRow.id, author_membership_id: author, sport, name, description: null, structure, ...estimate(sport, structure), tags, created_at: createdLongAgo, updated_at: createdLongAgo, archived_at: null };
    t("workout_templates").push(row);
    TPL[key] = row;
  };
  for (const k of ["easy6", "regen5", "int6x1k", "int8x400", "fartlek", "tempo", "long", "prog10", "test5k", "forcaA", "forcaB", "mob"]) tpl(k, PF, M["paceforte:marcos"].id);
  for (const k of ["swimTech", "swim10x100"]) tpl(k, MARE, M["equipemare:renata"].id);

  // ---- planilha
  const plan = { id: uuid("plan:base10k"), club_id: PF.id, author_membership_id: M["paceforte:marcos"].id, name: "Base 10 km: 8 semanas", description: "Do zero aos 10 km com segurança.", weeks: 8, created_at: createdLongAgo, updated_at: createdLongAgo, archived_at: null };
  t("training_plans").push(plan);
  for (let w = 1; w <= 8; w++) for (const [wd, key] of [[2, "regen5"], [4, w % 2 ? "fartlek" : "tempo"], [6, "easy6"]]) {
    const [sport, title, structure] = LIB[key];
    t("training_plan_items").push({ id: uuid(`pi:${w}:${wd}`), plan_id: plan.id, week: w, weekday: wd, template_id: TPL[key].id, sport, title, structure, ...estimate(sport, structure), notes: null });
  }

  // ---- connections
  const strava = new Set(["ana", "bruno", "diego"]);
  for (const k of strava) {
    t("provider_connections").push({ id: uuid("conn:strava:" + k), user_id: U[k].id, provider: "strava", external_user_id: String(r(1000000, 9999999)), athlete_name: U[k].name, access_token_enc: null, refresh_token_enc: null, scopes: ["read", "activity:read_all"], token_expires_at: null, status: "active", connected_at: createdLongAgo, last_sync_at: at(anchor, "07:41") });
    // Strava shared with every club they train with, as the welcome flow defaults (D-011).
    for (const m of t("memberships").filter((x) => x.user_id === U[k].id && x.role === "student")) {
      const id = m.club_id === PF.id ? uuid("consent:strava:" + k) : uuid(`consent:strava:${k}:${m.club_id}`);
      t("consents").push({ id, user_id: U[k].id, club_id: m.club_id, kind: "share_strava", text_version: "2026-10", granted_at: createdLongAgo, revoked_at: null });
    }
  }

  // ---- planned workouts, completions, activities
  const WEEK_PATTERNS = {
    marathon: (w) => ({ 2: w % 2 ? "int6x1k" : "int8x400", 3: "easy6", 4: "tempo", 6: "long", 7: "regen5" }),
    beginner: (w) => ({ 2: "regen5", 4: "fartlek", 6: w % 2 ? "easy6" : "regen5" }),
    strength: () => ({ 1: "forcaA", 3: "easy6", 5: "forcaB", 6: "prog10" }),
  };
  const RELIABILITY = { ana: 0.95, bruno: 0.85, carla: 0.55, diego: 0.9, elisa: 0.8, felipe: 0.7, gabriela: 0.85, henrique: 0.8, isabela: 0.75 };
  const FEEL = ["great", "good", "good", "ok", "bad"];
  const COMMENTS = ["Tiros encaixaram bem!", "Calor demais hoje, segurei o ritmo.", "Senti a panturrilha no final.", "Ótimo treino, terminei forte.", "Dormi mal, foi difícil.", "Consegui manter o pace o tempo todo."];
  const PW = {};
  const addPlanned = (clubRow, mkey, ukey, date, key, created_by, overrides = {}) => {
    const [sport, baseTitle, structure] = LIB[key];
    let title = baseTitle, st = structure;
    if (key === "long") {
      const km = 14 + ((Math.round((parseDate(date) - parseDate(W0)) / DAY / 7) + 6) % 4) * 2;
      title = `Longão ${km} km`;
      st = S([step("active", dist(km * 1000), zone(2), { note: "Hidratação a cada 5 km." })]);
    }
    const row = { id: uuid(`pw:${mkey}:${date}:${key}`), club_id: clubRow.id, athlete_membership_id: M[mkey].id, date, position: 0, sport, title, structure: st, notes: null, ...estimate(sport, st), template_id: TPL[key] ? TPL[key].id : null, plan_assignment_id: null, created_by, created_at: at(addDays(date, -7), "20:00"), updated_at: at(addDays(date, -7), "20:00"), ...overrides };
    t("planned_workouts").push(row);
    PW[`${ukey}:${date}`] = row;
    return { row, ukey };
  };
  const complete = (pw, ukey, status, opts = {}) => {
    const p = pw;
    const f = status === "partial" ? 0.6 + rand() * 0.2 : 0.95 + rand() * 0.1;
    let activity = null;
    if (status !== "missed" && status !== "skipped") {
      const dur = Math.round((p.est_duration_s || 2400) * f);
      const dm = p.est_distance_m ? Math.round(p.est_distance_m * f) : null;
      const intense = /Intervalado|Tempo|Teste|Fartlek|Progressivo/.test(p.title);
      const hhmm = opts.hhmm || (rand() < 0.6 ? "06:" + String(r(10, 45)).padStart(2, "0") : "18:" + String(r(15, 50)).padStart(2, "0"));
      const avgPace = dm ? Math.round(dur / (dm / 1000)) : null;
      const recent = parseDate(p.date) >= parseDate(addDays(W0, -14));
      activity = {
        id: uuid("act:" + p.id), user_id: U[ukey].id, source: strava.has(ukey) ? "strava" : "manual", external_id: strava.has(ukey) ? String(r(10000000000, 19999999999)) : null,
        sport: p.sport, name: p.title, started_at: at(p.date, hhmm), duration_s: dur, moving_time_s: Math.round(dur * 0.97), distance_m: dm,
        elevation_gain_m: dm ? r(10, 90) : null, avg_hr: p.sport === "strength" || p.sport === "mobility" ? null : r(intense ? 158 : 138, intense ? 172 : 152), max_hr: p.sport === "run" ? r(170, 188) : null,
        avg_pace_s_per_km: p.sport === "run" ? avgPace : null, avg_power_w: null, calories: Math.round(dur / 60 * (intense ? 12 : 9)),
        laps: recent && p.sport === "run" && dm ? Array.from({ length: Math.floor(dm / 1000) }, () => ({ distance_m: 1000, duration_s: avgPace + r(-12, 12), avg_hr: r(135, 175) })) : null,
        polyline: null, match_state: "open", created_at: at(p.date, "10:00"),
      };
      t("activities").push(activity);
    }
    t("workout_completions").push({
      planned_workout_id: p.id, activity_id: activity ? activity.id : null, status,
      compliance_pct: status === "completed" ? r(90, 104) : status === "partial" ? r(55, 80) : 0,
      rpe: activity ? (/Intervalado|Tempo|Teste/.test(p.title) ? r(7, 9) : r(3, 6)) : null,
      feeling: activity ? pick(FEEL) : null, comment: opts.comment !== undefined ? opts.comment : rand() < 0.25 && activity ? pick(COMMENTS) : null,
      matched_by: activity ? "auto" : null, reported_at: activity ? activity.started_at : at(p.date, "23:00"),
      completed_at: activity ? activity.started_at : at(p.date, "23:00"), updated_at: activity ? activity.started_at : at(p.date, "23:00"),
    });
  };
  for (const [k, , , , , , , , pattern] of PF_STUDENTS) {
    for (let w = -4; w <= 1; w++) {
      const days = WEEK_PATTERNS[pattern](w + 10);
      for (const [wd, key] of Object.entries(days)) {
        const date = addDays(W0, w * 7 + Number(wd) - 1);
        const by = k === "carla" || k === "isabela" ? M["paceforte:julia"].id : M["paceforte:marcos"].id;
        const { row } = addPlanned(PF, "paceforte:" + k, k, date, key, by);
        if (date < anchor) {
          const x = rand();
          const rel = RELIABILITY[k];
          complete(row, k, x < rel ? "completed" : x < rel + (1 - rel) / 2 ? "partial" : "missed");
        }
      }
    }
  }
  // Today's story: Ana's intervals are pending; Bruno already trained this morning.
  const today = anchor;
  if (!PW["ana:" + today]) addPlanned(PF, "paceforte:ana", "ana", today, "int6x1k", M["paceforte:marcos"].id);
  PW["ana:" + today].notes = "Foco nos últimos três tiros: braço solto e passada curta.";
  if (PW["bruno:" + today]) complete(PW["bruno:" + today], "bruno", "completed", { hhmm: "06:20", comment: "Tiros saíram mais fáceis que semana passada!" });
  // Ana's swim prescriptions at Maré
  for (let w = -2; w <= 1; w++) for (const [wd, key] of [[1, "swimTech"], [3, "swim10x100"]]) {
    const date = addDays(W0, w * 7 + wd - 1);
    const { row } = addPlanned(MARE, "equipemare:ana", "ana", date, key, M["equipemare:renata"].id);
    if (date < anchor) complete(row, "ana", "completed", { hhmm: "07:05" });
  }

  // Week release (D-031): Pace Forte plans next week in private (released Sunday 18:00); Maré shows workouts at once.
  t("week_releases");

  // ---- threads
  const comment = (pw, mkey, body, when) => t("comments").push({ id: uuid(`c:${pw.id}:${when}`), planned_workout_id: pw.id, author_membership_id: M[mkey].id, body, created_at: when, edited_at: null, deleted_at: null });
  const lastTue = PW["ana:" + addDays(W0, -6)];
  if (lastTue) {
    comment(lastTue, "paceforte:ana", "Os três últimos tiros ficaram mais lentos, senti a panturrilha.", at(lastTue.date, "08:02"));
    comment(lastTue, "paceforte:marcos", "Normal nessa fase. Amanhã faz o regenerativo bem leve e alonga a panturrilha.", at(lastTue.date, "12:30"));
    t("thread_reads").push({ membership_id: M["paceforte:marcos"].id, planned_workout_id: lastTue.id, last_read_at: at(lastTue.date, "12:31") }, { membership_id: M["paceforte:ana"].id, planned_workout_id: lastTue.id, last_read_at: at(lastTue.date, "12:40") });
  }
  const carlaMissed = t("planned_workouts").filter((p) => p.athlete_membership_id === M["paceforte:carla"].id && p.date < anchor).slice(-1)[0];
  if (carlaMissed) {
    const c = t("workout_completions").find((x) => x.planned_workout_id === carlaMissed.id);
    if (c) Object.assign(c, { status: "missed", activity_id: null, compliance_pct: 0, rpe: null, feeling: null });
    comment(carlaMissed, "paceforte:carla", "Não consegui treinar, plantão no hospital. Posso compensar amanhã?", at(addDays(anchor, -1), "21:14"));
  }
  // A run the matching engine can't place on its own (D-049): yesterday's run, between two of Ana's runs a day apart
  // at most (cut short, done late or done early?). The distance is the longest one the engine asks about; nothing changes
  // when there's no such pair.
  t("activity_match_options");
  {
    const d = addDays(anchor, -1);
    const near = t("planned_workouts").filter((p) => p.athlete_membership_id === M["paceforte:ana"].id && p.sport === "run" && p.est_distance_m && Math.abs(Math.round((parseDate(p.date) - parseDate(d)) / DAY)) <= 1);
    for (let dm = 20000; dm >= 3000 && near.length >= 2; dm -= 100) {
      const dur = Math.round(dm * 0.33);
      const act = { id: uuid("act:ana-pending"), user_id: U.ana.id, source: "strava", external_id: "18000000001", sport: "run", name: "Corrida matinal", started_at: at(d, "06:40"), duration_s: dur, moving_time_s: Math.round(dur * 0.97), distance_m: dm, elevation_gain_m: 34, avg_hr: 146, max_hr: 171, avg_pace_s_per_km: Math.round(dur / (dm / 1000)), avg_power_w: null, calories: Math.round((dur / 60) * 9), laps: null, polyline: null, match_state: "pending", created_at: at(d, "07:30") };
      const { pending } = solveMatches({ today: anchor, activities: [{ ...act, day: d }], workouts: near });
      if (!pending.length) continue;
      // Those workouts are still open: no completion, no activity.
      const ids = new Set(near.map((p) => p.id));
      const gone = new Set(t("workout_completions").filter((c) => ids.has(c.planned_workout_id)).map((c) => c.activity_id).filter(Boolean));
      T.workout_completions = t("workout_completions").filter((c) => !ids.has(c.planned_workout_id));
      T.activities = t("activities").filter((a) => !gone.has(a.id));
      t("activities").push(act);
      pending[0].options.forEach((id, rank) => t("activity_match_options").push({ activity_id: act.id, planned_workout_id: id, rank }));
      break;
    }
  }
  if (PW["bruno:" + today]) comment(PW["bruno:" + today], "paceforte:bruno", "Tiros saíram mais fáceis que semana passada!", at(today, "07:02"));

  // ---- assessments (F23)
  const assess = (key, mk, kind, day, data, notes = null) => {
    const { result } = computeAssessment(kind, data);
    t("assessments").push({ id: uuid("as:" + key), club_id: M[mk].club_id, membership_id: M[mk].id, kind, date: addDays(anchor, day), data, result, notes, zones_id: null, created_by: M[mk.startsWith("paceforte") ? "paceforte:julia" : "equipemare:renata"].id, created_at: at(addDays(anchor, day), "08:00") });
  };
  assess("ana-body-1", "paceforte:ana", "body", -62, { weight_kg: 61.5, height_cm: 166, body_fat_pct: 22.4, waist_cm: 70 });
  assess("ana-body-2", "paceforte:ana", "body", -6, { weight_kg: 59.8, height_cm: 166, body_fat_pct: 20.9, waist_cm: 68 });
  assess("ana-cooper", "paceforte:ana", "cooper", -41, { distance_m: 3050 }, "Pista do Ibirapuera, tempo bom.");
  assess("bruno-3k", "paceforte:bruno", "run_3k", -20, { time_s: 730 });
  assess("diego-hr", "paceforte:diego", "hr_max", -30, { max_hr: 182 }, "Teste de rampa na esteira.");
  assess("elisa-cooper", "paceforte:elisa", "cooper", -11, { distance_m: 2120 });
  assess("carla-body", "paceforte:carla", "body", -25, { weight_kg: 68, height_cm: 171, body_fat_pct: 26 });
  assess("carla-agacho", "paceforte:carla", "one_rm", -18, { exercise: "Agachamento livre", weight_kg: 60, reps: 5 });
  assess("isabela-supino", "paceforte:isabela", "one_rm", -9, { exercise: "Supino reto", weight_kg: 30, reps: 8 });
  assess("ana-css", "equipemare:ana", "css", -15, { t400_s: 380, t200_s: 178 });
  assess("lucas-css", "equipemare:lucas", "css", -15, { t400_s: 352, t200_s: 166 });

  // ---- messages and announcements (F22)
  const convo = (ckey, mk, msgs) => {
    const c = { id: uuid("conv:" + ckey), club_id: M[mk].club_id, student_membership_id: M[mk].id, last_message_at: null, created_at: at(addDays(anchor, -12), "09:00") };
    t("conversations").push(c);
    for (const [i, [who, day, hhmm, body]] of msgs.entries()) {
      const created = at(addDays(anchor, day), hhmm);
      t("messages").push({ id: uuid(`msg:${ckey}:${i}`), conversation_id: c.id, author_membership_id: M[who].id, body, created_at: created, deleted_at: null });
      c.last_message_at = created;
    }
    return c;
  };
  const cAna = convo("pf-ana", "paceforte:ana", [
    ["paceforte:ana", -3, "07:40", "Marcos, posso trocar o longão de sábado para domingo? Tenho um casamento no sábado."],
    ["paceforte:marcos", -3, "08:15", "Pode sim! Só mantém o ritmo Z2 e hidrata bem. Já mudei no seu plano."],
    ["paceforte:ana", -3, "08:20", "Perfeito, obrigada!"],
    ["paceforte:ana", -1, "21:02", "Senti a panturrilha no final do intervalado. Faço o regenerativo amanhã mesmo assim?"],
  ]);
  const cCarla = convo("pf-carla", "paceforte:carla", [
    ["paceforte:julia", -6, "12:00", "Oi Carla! Vi que a semana foi puxada no hospital. Quer que eu reduza o volume da próxima?"],
    ["paceforte:carla", -6, "22:30", "Quero sim, por favor. Plantão de novo na quarta."],
    ["paceforte:julia", -5, "07:10", "Feito: tirei o treino de quarta e deixei o de sexta mais curto."],
  ]);
  const cMareAna = convo("mare-ana", "equipemare:ana", [["equipemare:renata", -2, "18:00", "Ana, amanhã vamos trabalhar a virada olímpica. Traz a nadadeira!"]]);
  const read = (c, mk, day, hhmm) => t("conversation_reads").push({ conversation_id: c.id, membership_id: M[mk].id, last_read_at: at(addDays(anchor, day), hhmm) });
  read(cAna, "paceforte:ana", -3, "08:20"); read(cAna, "paceforte:marcos", -3, "08:21");
  read(cCarla, "paceforte:carla", -5, "08:00"); read(cCarla, "paceforte:julia", -6, "22:40"); read(cCarla, "paceforte:marcos", -5, "09:00");
  const ann = (key, clubRow, author, day, title, body, extra = {}) => { const a = { id: uuid("ann:" + key), club_id: clubRow.id, author_membership_id: M[author].id, title, body, group_ids: [], pinned: false, created_at: at(addDays(anchor, day), "10:00"), edited_at: null, deleted_at: null, ...extra }; t("announcements").push(a); return a; };
  const a1 = ann("pf-uniforme", PF, "paceforte:marcos", -9, "Uniforme novo da equipe", "Chegaram as camisetas 2027! Retirem no estúdio de terça a quinta, das 18h às 20h. Tamanhos P ao GG.", { pinned: true });
  const a2 = ann("pf-feriado", PF, "paceforte:julia", -2, "Treino de pista no feriado", "No dia 15/11 o treino de pista acontece normalmente às 6h30. Quem for viajar, avisa aqui no app para eu ajustar a planilha.");
  const a3 = ann("pf-maratona", PF, "paceforte:marcos", -5, "Grupo da maratona: longões de domingo", "A partir deste mês os longões de domingo saem às 6h do portão 10 do Ibirapuera. Teremos apoio de hidratação no km 12.", { group_ids: [uuid("group:maratona")] });
  for (const k of ["ana", "bruno", "carla", "diego", "felipe", "henrique"]) t("announcement_reads").push({ announcement_id: a1.id, membership_id: M["paceforte:" + k].id, read_at: at(addDays(anchor, -8), "12:00") });
  for (const k of ["bruno", "diego"]) t("announcement_reads").push({ announcement_id: a2.id, membership_id: M["paceforte:" + k].id, read_at: at(addDays(anchor, -1), "19:00") });
  for (const k of ["ana", "bruno", "diego", "henrique"]) t("announcement_reads").push({ announcement_id: a3.id, membership_id: M["paceforte:" + k].id, read_at: at(addDays(anchor, -4), "07:00") });
  ann("mare-touca", MARE, "equipemare:renata", -4, "Touca obrigatória na piscina", "O Sesc passou a exigir touca em todas as raias. Sem touca, não entra. Temos toucas da equipe à venda por R$ 25.");

  // ---- races (F21)
  const race = (key, clubRow, row) => { const x = { id: uuid("race:" + key), club_id: clubRow.id, sport: "run", start_time: "07:00", city: null, state: null, url: null, notes: null, created_by: null, created_at: createdLongAgo, archived_at: null, ...row }; t("races").push(x); return x; };
  const RIEGEL = (thr, m) => Math.round(thr * 10 * Math.pow(m / 10000, 1.06));
  const entry = (raceRow, mk, distance_m, extra = {}) => t("race_entries").push({ id: uuid(`re:${raceRow.id}:${mk}`), race_id: raceRow.id, membership_id: M[mk].id, distance_m, goal_time_s: null, is_goal: false, status: "registered", result_time_s: null, result_position: null, created_at: at(addDays(anchor, -20), "12:00"), updated_at: at(addDays(anchor, -20), "12:00"), ...extra });
  const thrOf = Object.fromEntries(PF_STUDENTS.map((s) => [s[0], s[6]]));
  const primavera = race("pf-primavera", PF, { name: "Corrida da Primavera", date: addDays(W0, -29), city: "São Paulo", state: "SP", distances_m: [5000, 10000], created_by: M["paceforte:marcos"].id });
  [["ana", 10000], ["bruno", 10000], ["diego", 10000], ["henrique", 10000], ["carla", 5000], ["gabriela", 5000], ["elisa", 5000]].forEach(([k, d], i) => {
    const time = Math.round(RIEGEL(thrOf[k], d) * (0.98 + rand() * 0.05));
    entry(primavera, "paceforte:" + k, d, k === "elisa" ? { status: "dns" } : { status: "finished", result_time_s: time, result_position: 40 + i * 37 + r(0, 30), goal_time_s: Math.round(time * 1.01 / 10) * 10 });
  });
  const parques = race("pf-parques", PF, { name: "Circuito Parques SP · Ibirapuera", date: addDays(W0, 13), city: "São Paulo", state: "SP", distances_m: [5000, 10000], notes: "Concentração da equipe às 6h15 no portão 3.", created_by: M["paceforte:julia"].id });
  [["ana", 10000], ["bruno", 10000], ["carla", 10000, true], ["gabriela", 5000, true], ["felipe", 5000], ["isabela", 5000]].forEach(([k, d, goal]) => entry(parques, "paceforte:" + k, d, { goal_time_s: Math.round(RIEGEL(thrOf[k], d) * 0.98 / 30) * 30, is_goal: !!goal }));
  const santos = race("pf-meia-santos", PF, { name: "Meia Maratona de Santos", date: addDays(W0, 41), city: "Santos", state: "SP", distances_m: [5000, 21097], start_time: "06:30", created_by: M["paceforte:marcos"].id });
  [["bruno", 21097, true], ["henrique", 21097, true], ["diego", 21097]].forEach(([k, d, goal]) => entry(santos, "paceforte:" + k, d, { goal_time_s: Math.round(RIEGEL(thrOf[k], d) / 60) * 60, is_goal: !!goal }));
  const maratona = race("pf-maratona", PF, { name: "Maratona de Inverno", date: "2027-06-06", city: "São Paulo", state: "SP", distances_m: [10000, 21097, 42195], start_time: "06:00", created_by: M["paceforte:marcos"].id });
  [["ana", 42195], ["diego", 42195]].forEach(([k, d]) => entry(maratona, "paceforte:" + k, d, { goal_time_s: Math.round(RIEGEL(thrOf[k], d) / 60) * 60, is_goal: true }));
  const travessia = race("mare-travessia", MARE, { name: "Travessia Ponta da Praia", sport: "swim", date: addDays(W0, 27), city: "Santos", state: "SP", distances_m: [1500, 3000], start_time: "08:00", notes: "Touca da equipe obrigatória.", created_by: M["equipemare:renata"].id });
  entry(travessia, "equipemare:ana", 1500, { goal_time_s: 1800 });
  ["lucas", "marina", "sofia"].forEach((k, i) => entry(travessia, "equipemare:" + k, i === 1 ? 3000 : 1500));

  // ---- notifications
  const note = (ukey, clubRow, kind, title, body, link, when, read = false) => t("notifications").push({ id: uuid(`n:${ukey}:${kind}:${when}`), user_id: U[ukey].id, club_id: clubRow ? clubRow.id : null, kind, title, body, link, read_at: read ? when : null, created_at: when, push_at: null, pushed_at: null });
  note("ana", PF, "workout_assigned", "Novo treino para hoje", "Intervalado 6×1 km", `/workouts/${PW["ana:" + today].id}`, at(addDays(today, -1), "20:00"));
  if (lastTue) note("ana", PF, "comment", "Marcos comentou no seu treino", "Normal nessa fase. Amanhã faz o regenerativo bem leve…", `/workouts/${lastTue.id}`, at(lastTue.date, "12:30"), true);
  if (carlaMissed) note("marcos", PF, "feedback", "Carla Mendes deixou um comentário", "Não consegui treinar, plantão no hospital…", `/feedback`, at(addDays(anchor, -1), "21:14"));
  note("marcos", PF, "member_joined", "Isabela Freitas entrou no clube", null, "/students", at(addDays(anchor, -2), "19:12"), true);
  note("marcos", PF, "billing", "9 de 10 alunos no plano Free", "Faça upgrade para o Pro e tenha até 30 alunos.", "/club/billing", at(addDays(anchor, -2), "19:13"));

  // empty tables (present so the mock and the check know them)
  for (const k of ["sessions", "assets", "plan_assignments", "webhook_events", "push_tokens", "audit_log", "jobs"]) t(k);
  return { meta: { anchor_date: anchor, generated_at: new Date().toISOString(), version: 1 }, ...T };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const anchor = process.argv[2] || "2026-11-03";
  const db = generate(anchor);
  const out = join(dirname(fileURLToPath(import.meta.url)), "db.json");
  writeFileSync(out, JSON.stringify(db, null, 1) + "\n");
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "starter-library.json"), JSON.stringify(starterLibrary(), null, 1) + "\n");
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "exercise-catalog.json"), JSON.stringify(exerciseCatalog(), null, 1) + "\n");
  const counts = Object.entries(db).filter(([k]) => k !== "meta").map(([k, v]) => `${k}=${v.length}`).join(" ");
  console.log(`✓ wrote ${out} (anchor ${anchor})\n  ${counts}`);
}
