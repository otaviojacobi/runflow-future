/**
 * Assistant (F27). The backend will call an LLM (provider and budget: root.md §11). The mock is a deterministic
 * rules engine with the same contract, so the UI can be built and tested without sending data anywhere.
 */
import { estimate } from "../seed.mjs";

const num = (s) => Number(String(s).replace(",", "."));
const minutes = (n, unit) => (/^(h|hora)/.test(unit) ? n * 3600 : /^(s|seg)/.test(unit) ? n : n * 60);
const ZONE_WORDS = [[/regenerativ|bem leve|soltinho/, 1], [/\bleve|rodagem|confort|z2|longão|longao/, 2], [/moderad|z3|ritmo de maratona/, 3], [/forte|limiar|z4|tempo run/, 4], [/tiro|máxim|maxim|z5|vo2/, 5]];
const zoneOf = (s, fallback) => { const z = /\b(?:z|zona\s*)([1-5])\b/i.exec(s); if (z) return +z[1]; for (const [re, n] of ZONE_WORDS) if (re.test(s)) return n; return fallback; };
const paceOf = (s) => { const p = /(?:@|a\s|ritmo\s*(?:de)?\s*|pace\s*(?:de)?\s*)(\d{1,2}):(\d{2})/i.exec(s); if (!p) return null; const v = +p[1] * 60 + +p[2]; return { type: "pace", min_s: v - 5, max_s: v + 5 }; };
const step = (intent, duration, target) => ({ kind: "step", intent, duration, target });

/** Natural pt-BR description → Structure v1 (or null). */
export function parseDescription(text, sport) {
  const s = text.toLowerCase().replace(/\s+/g, " ");
  const blocks = [];
  if (sport === "strength" || sport === "mobility") {
    for (const m of s.matchAll(/([a-zà-ú][a-zà-ú ]{2,40}?)\s+(\d+)\s*[x×]\s*(\d+(?:-\d+)?)(?:\s*(?:com|a|@)\s*(\d+(?:[.,]\d+)?)\s*kg)?/g)) blocks.push({ kind: "exercise", name: m[1].trim().replace(/^(e|depois|mais)\s+/, "").replace(/^\w/, (c) => c.toUpperCase()), sets: +m[2], reps: m[3], ...(m[4] && { load: { type: "kg", value: num(m[4]) } }), rest_s: 60 });
    return blocks.length ? { v: 1, blocks } : null;
  }
  const warm = /(\d+)\s*(min|minutos|')\s*(?:de\s*)?aquec|aquec\w*\s*(?:de\s*)?(\d+)\s*(min|minutos|')/.exec(s);
  if (warm) blocks.push(step("warmup", { type: "time", s: minutes(+(warm[1] || warm[3]), warm[2] || warm[4]) }, { type: "zone", metric: "pace", zone: 2 }));
  const reps = /(\d+)\s*(?:x|×|vezes|tiros de|tiros|séries de|series de)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(km|m\b|metros|min|minutos|')/.exec(s);
  if (reps) {
    const unit = reps[3], v = num(reps[2]);
    const work = /km/.test(unit) ? { type: "distance", m: Math.round(v * 1000) } : /^m\b|metros/.test(unit) ? { type: "distance", m: Math.round(v) } : { type: "time", s: minutes(v, unit) };
    const target = paceOf(s) ?? { type: "zone", metric: "pace", zone: zoneOf(s.slice(reps.index), sport === "swim" ? 3 : 5) };
    const rec = /(\d+(?:[.,]\d+)?)\s*(min|minutos|'|s\b|seg\w*)\s*(?:de\s*)?(?:trote|descanso|recupera\w*|pausa|parado|caminhada)|(?:trote|descanso|recupera\w*|pausa|intervalo)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(min|minutos|'|s\b|seg\w*)/.exec(s);
    const steps = [step("active", work, target)];
    if (rec) steps.push(step(sport === "swim" ? "rest" : "recovery", { type: "time", s: Math.round(minutes(num(rec[1] || rec[3]), rec[2] || rec[4])) }, { type: "open" }));
    blocks.push({ kind: "repeat", count: +reps[1], steps });
  } else {
    const cont = /(\d+(?:[.,]\d+)?)\s*(km|metros|m\b|min|minutos|h\b|hora\w*)/.exec(s.replace(/(\d+)\s*(min|minutos|')\s*(?:de\s*)?(aquec|desaquec)\w*/g, ""));
    if (cont) {
      const v = num(cont[1]), u = cont[2];
      const d = /km/.test(u) ? { type: "distance", m: Math.round(v * 1000) } : /metros|^m\b/.test(u) ? { type: "distance", m: Math.round(v) } : { type: "time", s: minutes(v, u) };
      blocks.push(step("active", d, paceOf(s) ?? { type: "zone", metric: "pace", zone: zoneOf(s, 2) }));
    }
  }
  const cool = /(\d+)\s*(min|minutos|')\s*(?:de\s*)?(?:desaquec|volta à calma|soltar)|desaquec\w*\s*(?:de\s*)?(\d+)\s*(min|minutos|')/.exec(s);
  if (cool) blocks.push(step("cooldown", { type: "time", s: minutes(+(cool[1] || cool[3]), cool[2] || cool[4]) }, { type: "zone", metric: "pace", zone: 1 }));
  return blocks.some((b) => b.kind === "repeat" || b.intent === "active") ? { v: 1, blocks } : null;
}
function nameOf(structure, sport) {
  const r = structure.blocks.find((b) => b.kind === "repeat");
  const dist = (d) => (d.type === "distance" ? (d.m >= 1000 ? `${String(d.m / 1000).replace(".", ",")} km` : `${d.m} m`) : `${Math.round(d.s / 60)}'`);
  if (r) return `Intervalado ${r.count}×${dist(r.steps[0].duration)}`;
  const a = structure.blocks.find((b) => b.kind === "step" && b.intent === "active");
  if (a) { const z = a.target.type === "zone" ? a.target.zone : 3; return `${sport === "swim" ? "Nado contínuo" : z <= 1 ? "Regenerativo" : z === 2 ? (a.duration.type === "distance" && a.duration.m >= 16000 ? "Longão" : "Rodagem") : z >= 4 ? "Ritmo forte" : "Corrida moderada"} ${dist(a.duration)}`; }
  const ex = structure.blocks.filter((b) => b.kind === "exercise");
  return ex.length ? `Força: ${ex.slice(0, 2).map((e) => e.name).join(" + ")}` : "Treino";
}

// ---- week plan (rules)
const SLOTS = { 2: [3, 6], 3: [2, 4, 6], 4: [2, 3, 5, 7], 5: [1, 2, 4, 5, 7], 6: [1, 2, 3, 5, 6, 7] };
const KINDS = { 2: ["quality", "long"], 3: ["quality", "easy", "long"], 4: ["quality", "easy", "tempo", "long"], 5: ["easy", "quality", "easy", "tempo", "long"], 6: ["easy", "quality", "easy", "tempo", "easy", "long"] };
const LONG_KM = { "5k": [6, 8, 10], "10k": [8, 12, 15], "21k": [12, 16, 20], "42k": [16, 22, 28], trail: [10, 14, 18], health: [5, 7, 9] };
const LEVEL_I = { beginner: 0, intermediate: 1, advanced: 2 };
function session(kind, li, longKm, factor) {
  const z = (n) => ({ type: "zone", metric: "pace", zone: n });
  const t = (min) => ({ type: "time", s: Math.round(min * 60 * factor) });
  if (kind === "easy") return { title: "Rodagem leve", why: "Base aeróbica, sem cansar para o próximo treino forte.", s: { v: 1, blocks: [step("active", t([30, 40, 50][li]), z(2))] } };
  if (kind === "tempo") return { title: "Ritmo forte contínuo", why: "Limiar: sustentar um ritmo forte por mais tempo.", s: { v: 1, blocks: [step("warmup", t(12), z(2)), step("active", t([12, 20, 25][li]), z(4)), step("cooldown", t(8), z(1))] } };
  if (kind === "long") return { title: `Longão ${Math.round(longKm * factor)} km`, why: "Resistência: o treino mais importante da semana para a prova.", s: { v: 1, blocks: [step("active", { type: "distance", m: Math.round(longKm * factor) * 1000 }, z(2))] } };
  const count = Math.max(3, Math.round([5, 6, 8][li] * factor));
  return { title: `Intervalado ${count}×${[400, 800, 1000][li]} m`, why: "Velocidade e VO₂máx, com recuperação completa.", s: { v: 1, blocks: [step("warmup", { type: "time", s: 900 }, z(2)), { kind: "repeat", count, steps: [step("active", { type: "distance", m: [400, 800, 1000][li] }, z(5)), step("recovery", { type: "time", s: [90, 120, 120][li] }, { type: "open" })] }, step("cooldown", { type: "time", s: 600 }, z(1))] } };
}

export default function register(h) {
  const limit = new Map(); // per-user rate limit (the backend also caps monthly usage per plan)
  const guard = (ctx) => {
    const u = ctx.user().id, now = Date.now();
    const hits = (limit.get(u) || []).filter((x) => now - x < 60000);
    if (hits.length >= 20) h.fail(429, "ai.rate_limited", "Muitos pedidos ao assistente", "Espere um minuto e tente de novo.");
    limit.set(u, [...hits, now]);
  };

  h.post("/v1/clubs/:club_id/ai/workout", (ctx) => {
    ctx.staff(ctx.params.club_id); guard(ctx);
    const text = String(ctx.body.text || "").trim(), sport = ctx.body.sport || "run";
    if (text.length < 5) h.invalid([{ field: "text", message: "Descreva o treino em uma frase." }]);
    const structure = parseDescription(text, sport);
    if (!structure) h.fail(422, "ai.not_understood", "Não entendi o treino", sport === "strength" ? "Tente algo como: agachamento 4x10 com 40 kg, remada 3x12, prancha 3x30." : "Tente algo como: 15 min de aquecimento, 6 tiros de 800 m a 4:10 com 2 min de trote e 10 min de desaquecimento.");
    return { name: nameOf(structure, sport), sport, structure, ...estimate(sport, structure), notes: null, source: "rules" };
  });

  h.post("/v1/clubs/:club_id/ai/week-plan", (ctx) => {
    ctx.staff(ctx.params.club_id); guard(ctx);
    const m = h.db.memberships.find((x) => x.id === ctx.body.membership_id && x.club_id === ctx.params.club_id && x.role === "student" && x.status === "active");
    if (!m) h.invalid([{ field: "membership_id", message: "Escolha o aluno." }]);
    const monday = h.mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(ctx.body.week_start || "") ? ctx.body.week_start : h.today());
    const p = h.db.athlete_profiles.find((x) => x.membership_id === m.id) || {};
    if (["swim", "strength", "triathlon"].includes(p.goal)) h.fail(422, "ai.unsupported_goal", "Sugestão automática só para corrida, por enquanto", "Para natação e força, use as planilhas da biblioteca.");
    const level = p.level || "beginner", li = LEVEL_I[level];
    const n = Math.min(6, Math.max(2, p.weekly_sessions || [3, 4, 5][li]));
    const user = h.publicUser(h.db.users.find((u) => u.id === m.user_id));
    // Recent compliance (last 14 days) and goal-race taper.
    const recent = h.db.planned_workouts.filter((x) => x.athlete_membership_id === m.id && x.date >= h.addDays(monday, -14) && x.date < monday && x.date < h.today());
    const st = (x) => h.db.workout_completions.find((c) => c.planned_workout_id === x.id)?.status;
    const comp = recent.length ? recent.reduce((s, x) => s + (st(x) === "completed" ? 1 : st(x) === "partial" ? 0.5 : 0), 0) / recent.length : null;
    const daysToGoal = p.goal_date ? h.daysBetween(monday, p.goal_date) : null;
    let factor = 1;
    const notes = [];
    if (daysToGoal != null && daysToGoal >= 0 && daysToGoal <= 13) { factor = daysToGoal <= 6 ? 0.55 : 0.75; notes.push(`Prova em ${daysToGoal} dias: semana de polimento, com volume reduzido.`); }
    else if (comp != null && comp < 0.6) { factor = 0.85; notes.push(`Fez ${Math.round(comp * 100)}% dos treinos nas últimas 2 semanas: volume um pouco menor para retomar a constância.`); }
    else if (comp != null) notes.push(`Boa constância nas últimas 2 semanas (${Math.round(comp * 100)}%): mantive a progressão.`);
    const taken = new Set(h.db.planned_workouts.filter((x) => x.athlete_membership_id === m.id && x.date >= monday && x.date <= h.addDays(monday, 6)).map((x) => x.date));
    if (taken.size) notes.push(`${taken.size === 1 ? "Um dia já tem treino" : `${taken.size} dias já têm treino`}: sugeri só os outros.`);
    const longKm = (LONG_KM[p.goal] || LONG_KM.health)[li];
    const items = SLOTS[n].map((wd, i) => ({ date: h.addDays(monday, wd - 1), kind: KINDS[n][i] }))
      .filter((x) => !taken.has(x.date))
      .map((x) => { const ses = session(daysToGoal != null && daysToGoal <= 6 && x.kind === "long" ? "easy" : x.kind, li, longKm, factor); return { date: x.date, sport: "run", title: ses.title, structure: ses.s, ...estimate("run", ses.s), reason: ses.why }; });
    const goalTxt = { "5k": "5 km", "10k": "10 km", "21k": "meia maratona", "42k": "maratona", trail: "trail", health: "saúde" }[p.goal] || "condicionamento";
    return { membership_id: m.id, week_start: monday, rationale: [`${user.name.split(" ")[0]}: objetivo ${goalTxt}, nível ${{ beginner: "iniciante", intermediate: "intermediário", advanced: "avançado" }[level]}, ${n} treinos por semana.`, ...notes], items, source: "rules" };
  });

  h.post("/v1/clubs/:club_id/ai/feedback-summary", (ctx) => {
    const me = ctx.staff(ctx.params.club_id); guard(ctx);
    const to = /^\d{4}-\d{2}-\d{2}$/.test(ctx.body.to || "") ? ctx.body.to : h.today();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(ctx.body.from || "") ? ctx.body.from : h.addDays(to, -6);
    const students = h.db.memberships.filter((x) => x.club_id === me.club_id && x.role === "student" && x.status === "active" && (!ctx.body.group_id || h.db.group_members.some((g) => g.group_id === ctx.body.group_id && g.membership_id === x.id)));
    const name = (mid) => h.publicUser(h.db.users.find((u) => u.id === students.find((s) => s.id === mid)?.user_id))?.name.split(" ")[0];
    const planned = h.db.planned_workouts.filter((p) => students.some((s) => s.id === p.athlete_membership_id) && p.date >= from && p.date <= to && p.date < h.today());
    const comps = planned.map((p) => ({ p, c: h.db.workout_completions.find((c) => c.planned_workout_id === p.id) }));
    const done = comps.filter((x) => ["completed", "partial"].includes(x.c?.status));
    const missed = comps.filter((x) => !x.c || ["missed", "skipped"].includes(x.c.status));
    const rpes = done.map((x) => x.c.rpe).filter(Boolean);
    const avg = rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null;
    const highlights = [];
    const KEYS = [[/(?<![\p{L}])(dor|dores|doendo|doeu)(?![\p{L}])|lesão|lesao|machuc|tornozelo|joelho|panturrilha|canela/u, "pain", "danger", "relatou dor"], [/cansad|exaust|pesad|sem energia/, "fatigue", "warning", "relatou cansaço"], [/plantão|plantao|trabalho|viagem|viajando/, "life", "info", "citou rotina/viagem"], [/doente|gripe|febre/, "sick", "warning", "relatou estar doente"]];
    for (const { p, c } of comps) {
      const text = (c?.comment || "").toLowerCase();
      for (const [re, kind, severity, verb] of KEYS) if (re.test(text)) highlights.push({ membership_id: p.athlete_membership_id, planned_workout_id: p.id, kind, severity, text: `${name(p.athlete_membership_id)} ${verb}: “${c.comment.length > 80 ? c.comment.slice(0, 77) + "…" : c.comment}”` });
      if (c?.rpe >= 9) highlights.push({ membership_id: p.athlete_membership_id, planned_workout_id: p.id, kind: "rpe", severity: "warning", text: `${name(p.athlete_membership_id)} marcou PSE ${c.rpe} em “${p.title}”.` });
    }
    const missCount = new Map(); for (const { p } of missed) missCount.set(p.athlete_membership_id, (missCount.get(p.athlete_membership_id) || 0) + 1);
    for (const [mid, k] of missCount) if (k >= 2) highlights.push({ membership_id: mid, planned_workout_id: null, kind: "missed", severity: "danger", text: `${name(mid)} não fez ${k} treinos no período.` });
    const summary = [
      `${done.length} de ${comps.length} treinos feitos (${comps.length ? Math.round((done.length / comps.length) * 100) : 0}%) por ${students.length} alunos.`,
      avg != null ? `Esforço percebido médio: PSE ${String(avg).replace(".", ",")}${avg >= 7.5 ? ", alto para a fase: vale aliviar a próxima semana." : avg <= 4 ? ", baixo: dá para progredir." : ", dentro do esperado."}` : "Ninguém registrou PSE no período.",
      highlights.length ? `${highlights.length} ${highlights.length === 1 ? "ponto pede" : "pontos pedem"} atenção, abaixo.` : "Nenhum sinal de alerta nos comentários.",
    ];
    return { from, to, summary, highlights: highlights.slice(0, 12), source: "rules" };
  });
}
