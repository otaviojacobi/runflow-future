/**
 * Assistant (F27). A deterministic rules engine, like the backend's (an LLM may come later behind the same contract:
 * root.md §11). Workouts from text use the free-text grammar shared with the web builder and the backend
 * (lib/workout-text.mjs, golden examples in api/workout-text-examples.json).
 */
import { estimate } from "../seed.mjs";
import { parseWorkoutText } from "../lib/workout-text.mjs";

const step = (intent, duration, target) => ({ kind: "step", intent, duration, target });

/** The 422 example per sport (each one is a golden example in api/workout-text-examples.json). */
const EXAMPLE = {
  run: "15 min de aquecimento, 6 tiros de 800 m a 4:10 com 2 min de trote e 10 min de desaquecimento.",
  swim: "400 m de aquecimento, 10x100 crawl saída 1:45 com palmar e 200 m solto.",
  bike: "15 min leve, 4x8 min a 95% do FTP com 4 min leve e 10 min de desaquecimento.",
  strength: "agachamento 4x10 com 40 kg, remada 3x12, prancha 3x30.",
  mobility: "Mobilidade de quadril 90/90 2x10, rotação torácica 2x10 por lado, prancha 3x30 s.",
};
const MAX_TEXT = 2000;

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
    if ([...text].length > MAX_TEXT) h.invalid([{ field: "text", message: "Use até 2.000 caracteres." }]);
    const { structure, name, warnings, tags } = parseWorkoutText(text, sport);
    if (!structure.blocks.length) h.fail(422, "ai.not_understood", "Não entendi o treino", `Tente algo como: ${EXAMPLE[sport] ?? EXAMPLE.run}`);
    return { name, sport, structure, ...estimate(sport, structure), notes: null, warnings, tags, source: "rules" };
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
      .map((x) => { const ses = session(daysToGoal != null && daysToGoal >= 0 && daysToGoal <= 6 && x.kind === "long" ? "easy" : x.kind, li, longKm, factor); return { date: x.date, sport: "run", title: ses.title, structure: ses.s, ...estimate("run", ses.s), reason: ses.why }; });
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
