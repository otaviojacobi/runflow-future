/**
 * Quick text ("escrita rápida"): Brazilian coaching shorthand ⇄ workout structure.
 *   "10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq"
 *   "15' Z2 + 3x(2km Z4 + 3' Z1) + 10' Z1"
 *   swim: "400 livre + 8x50 educativo + 10x100 crawl @1:45 palmar + 200 costas"
 *   strength (one exercise per line): "Agachamento 4x8 70% desc 90\""
 *   hashtags anywhere tag the workout: "... + 10' desaq #intervalado #pista"
 * Deterministic and forgiving: unknown bits become warnings, never exceptions.
 */
import type { Sport } from "@/api/types";
import { cleanTags, extractTags } from "./tags";
import type { Block, Duration, Equipment, Exercise, Intent, Load, Repeat, Step, Stroke, Structure, Target, ZoneN } from "./workout";

/** `tags`: "#hashtags" found anywhere in the text (they never become steps). */
export interface ParseResult { structure: Structure; warnings: string[]; tags: string[] }

const STROKES: [RegExp, Stroke][] = [
  [/\b(crawl|livre)\b/, "free"], [/\bcostas\b/, "back"], [/\bpeito\b/, "breast"], [/\bborboleta\b/, "fly"],
  [/\bmedley\b/, "im"], [/\bpernadas?\b/, "kick"], [/\beducativos?\b/, "drill"], [/\b(escolha|livre escolha)\b/, "choice"],
];
const EQUIP: [RegExp, Equipment][] = [[/\bpalmar(es)?\b/, "paddles"], [/\bpull ?(buoy)?\b/, "pullbuoy"], [/\bnadadeiras?\b/, "fins"], [/\bprancha\b/, "kickboard"], [/\bsnorkel\b/, "snorkel"]];

const num = (s: string) => Number(s.replace(",", "."));
const mmss = (m: string, s: string) => Number(m) * 60 + Number(s);

/** Split on top-level separators ("+", ";", newlines), ignoring those inside parentheses. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "+" || ch === ";" || ch === "\n")) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const normalize = (s: string) =>
  s.replace(/[×]/g, "x").replace(/[′’´`]/g, "'").replace(/[″”“]/g, '"').replace(/''/g, '"').replace(/\s+/g, " ").trim();

function parseDuration(t: string, sport: Sport): Duration | null {
  let m: RegExpMatchArray | null;
  if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*km\b/))) return { type: "distance", m: Math.round(num(m[1]!) * 1000) };
  if ((m = t.match(/(\d+)\s*m\b(?!in)/))) return { type: "distance", m: Number(m[1]) };
  if ((m = t.match(/(\d+)\s*h\s*(\d{1,2})?\b/))) return { type: "time", s: Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60 };
  if ((m = t.match(/(\d+)\s*'\s*(\d{1,2})\s*"/))) return { type: "time", s: mmss(m[1]!, m[2]!) };
  if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:'|min\b|minutos?\b)/))) return { type: "time", s: Math.round(num(m[1]!) * 60) };
  if ((m = t.match(/(\d+)\s*(?:"|s\b|seg\b|segundos?\b)/))) return { type: "time", s: Number(m[1]) };
  if (sport === "swim" && (m = t.match(/^(\d{2,4})\b/))) return { type: "distance", m: Number(m[1]) };
  return null;
}

function parseTarget(t: string, sport: Sport): Target | null {
  let m: RegExpMatchArray | null;
  if ((m = t.match(/(?:fc|bpm)\s*(\d{2,3})\s*(?:-|–|a)\s*(\d{2,3})/))) return { type: "hr", min: Number(m[1]), max: Number(m[2]) };
  if ((m = t.match(/\b(?:pse|rpe)\s*(\d{1,2})\b/))) return { type: "rpe", value: Math.min(10, Number(m[1])) };
  if ((m = t.match(/\bz\s*([1-5])\b/))) return { type: "zone", metric: /\bfc\b/.test(t) ? "hr" : "pace", zone: Number(m[1]) as ZoneN };
  if (sport !== "swim" || /\/\s*100/.test(t)) {
    if ((m = t.match(/@\s*(\d{1,2}):(\d{2})\s*(?:-|–|a)\s*(\d{1,2}):(\d{2})/))) {
      const a = mmss(m[1]!, m[2]!), b = mmss(m[3]!, m[4]!);
      return { type: "pace", min_s: Math.min(a, b), max_s: Math.max(a, b) };
    }
    if ((m = t.match(/@\s*(\d{1,2}):(\d{2})/))) { const p = mmss(m[1]!, m[2]!); return { type: "pace", min_s: p - 5, max_s: p + 5 }; }
  }
  if (/\bregenerativ/.test(t)) return { type: "zone", metric: "pace", zone: 1 };
  if (/\bleve\b/.test(t)) return { type: "zone", metric: "pace", zone: 2 };
  if (/\bmoderad/.test(t)) return { type: "zone", metric: "pace", zone: 3 };
  if (/\b(forte|limiar)\b/.test(t)) return { type: "zone", metric: "pace", zone: 4 };
  if (/\b(máximo|maximo|tiro forte|sprint)\b/.test(t)) return { type: "zone", metric: "pace", zone: 5 };
  return null;
}

function parseIntent(t: string, fallback: Intent): Intent {
  if (/\baquec/.test(t)) return "warmup";
  if (/\b(desaq|volta (a|à) calma|soltar|solto)/.test(t)) return "cooldown";
  if (/\b(descanso|parado|pausa)\b/.test(t)) return "rest";
  if (/\b(trote|rec|recupera|caminhada)/.test(t)) return "recovery";
  return fallback;
}

function parseStep(raw: string, sport: Sport, fallback: Intent, warnings: string[]): Step | null {
  const noteMatch = raw.match(/\(([^)]*)\)/);
  const t = raw.replace(/\([^)]*\)/g, " ").toLowerCase();
  const duration = parseDuration(t, sport);
  const intent = parseIntent(t, fallback);
  const target = parseTarget(t, sport);
  const step: Step = { kind: "step", intent, duration: duration ?? { type: "open" }, target: target ?? { type: "open" } };
  if (noteMatch?.[1]?.trim()) step.note = noteMatch[1].trim();
  if (sport === "swim") {
    const stroke = STROKES.find(([rx]) => rx.test(t));
    if (stroke) step.stroke = stroke[1];
    const eq = EQUIP.filter(([rx]) => rx.test(t)).map(([, e]) => e);
    if (eq.length) step.equipment = eq;
    const so = t.match(/(?:@|sa[ií]da|a cada)\s*(\d{1,2}):(\d{2})/) ?? t.match(/(?:sa[ií]da|a cada)\s*(\d+)\s*'/);
    if (so) step.send_off_s = so[2] !== undefined ? mmss(so[1]!, so[2]) : Number(so[1]) * 60;
  }
  if (!duration && !target && step.intent === fallback && !step.stroke) {
    if (/^\s*(trote|recupera|descanso|caminhada)/.test(t)) return step;
    warnings.push(raw.trim());
    return null;
  }
  return step;
}

const RECOVERY_SPLIT = /\s(?:c\/|com|int(?:ervalo)?(?: de)?|rec(?:uperação)?|pausa de|pausa)\s+(?=\d)/;

function parseSegment(seg: string, sport: Sport, warnings: string[]): Block | null {
  const s = seg.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+)\s*x\s*\((.+)\)\s*(.*)$/i))) {
    const steps = splitTop(m[2]!.replace(/,(?!\d)/g, "+")).map((x, i) => parseStep(x, sport, i === 0 ? "active" : "recovery", warnings)).filter(Boolean) as Step[];
    const after = m[3]?.trim();
    if (after && RECOVERY_SPLIT.test(" " + after + " ")) {
      const rec = parseStep(after.replace(/^(?:c\/|com|int(?:ervalo)?(?: de)?|rec|pausa(?: de)?)\s*/i, ""), sport, "recovery", warnings);
      if (rec) steps.push(rec);
    }
    return steps.length ? ({ kind: "repeat", count: Number(m[1]), steps } as Repeat) : null;
  }
  if ((m = s.match(/^(\d+)\s*(?:x|tiros? de|vezes)\s*(.+)$/i))) {
    const [active, rec] = m[2]!.split(RECOVERY_SPLIT);
    const a = parseStep(active!, sport, "active", warnings);
    if (!a) return null;
    const steps: Step[] = [a];
    if (rec) { const r = parseStep(rec, sport, "recovery", warnings); if (r) steps.push(r); }
    return { kind: "repeat", count: Number(m[1]), steps };
  }
  const [main, rec] = s.split(RECOVERY_SPLIT);
  const st = parseStep(main!, sport, "active", warnings);
  if (st && rec) { const r = parseStep(rec, sport, "recovery", warnings); return r ? ({ kind: "repeat", count: 1, steps: [st, r] } as Repeat) : st; }
  return st;
}

function parseExercise(line: string, warnings: string[]): Exercise | null {
  const m = line.match(/^(.+?)\s+(\d+)\s*x\s*(\d+(?:\s*-\s*\d+)?(?:\s*s\b|\s*")?)(.*)$/i);
  if (!m) { warnings.push(line.trim()); return null; }
  const rest = m[4]!.toLowerCase();
  let load: Load | undefined;
  let x: RegExpMatchArray | null;
  if ((x = rest.match(/(\d+(?:[.,]\d+)?)\s*kg/))) load = { type: "kg", value: num(x[1]!) };
  else if ((x = rest.match(/(\d{1,3})\s*%/))) load = { type: "pct_1rm", value: Number(x[1]) };
  else if ((x = rest.match(/\b(?:pse|rpe)\s*(\d{1,2})/))) load = { type: "rpe", value: Number(x[1]) };
  else if (/\b(pc|peso corporal)\b/.test(rest)) load = { type: "bodyweight" };
  const r = rest.match(/(?:desc(?:anso)?|int(?:ervalo)?)\s*(\d+)\s*('|"|s\b|min)?/);
  const ex: Exercise = { kind: "exercise", name: m[1]!.trim().replace(/^\w/, (c) => c.toUpperCase()), sets: Number(m[2]), reps: m[3]!.replace(/\s+/g, "").replace('"', " s").replace(/(\d)s$/, "$1 s") };
  if (load) ex.load = load;
  if (r) ex.rest_s = r[2] === "'" || r[2] === "min" ? Number(r[1]) * 60 : Number(r[1]);
  return ex;
}

export function parseQuickText(raw: string, sport: Sport): ParseResult {
  const warnings: string[] = [];
  const tags: string[] = [];
  const input = raw.replace(/\r/g, "").split("\n").map((l) => { const x = extractTags(l); tags.push(...x.tags); return x.text; }).join("\n");
  const text = normalize(input);
  const uniq = cleanTags(tags);
  if (!text) return { structure: { v: 1, blocks: [] }, warnings, tags: uniq };
  if (sport === "strength") {
    const blocks = input.split(/\n|;/).map((l) => normalize(l)).filter(Boolean).map((l) => parseExercise(l, warnings)).filter(Boolean) as Block[];
    return { structure: { v: 1, blocks }, warnings, tags: uniq };
  }
  const blocks = splitTop(input.split("\n").map(normalize).join("\n")).map((seg) => parseSegment(seg, sport, warnings)).filter(Boolean) as Block[];
  return { structure: { v: 1, blocks }, warnings, tags: uniq };
}

// ---------------------------------------------------------------- structure → text
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
function durText(d: Duration, sport: Sport): string {
  if (d.type === "time") return d.s % 60 === 0 ? `${d.s / 60}'` : d.s < 60 ? `${d.s}"` : `${Math.floor(d.s / 60)}'${d.s % 60}"`;
  if (d.type === "distance") return sport === "swim" ? `${d.m}` : d.m % 1000 === 0 ? `${d.m / 1000}km` : d.m > 1000 ? `${String(d.m / 1000).replace(".", ",")}km` : `${d.m}m`;
  return "";
}
function tgtText(t: Target): string {
  switch (t.type) {
    case "zone": return `Z${t.zone}${t.metric === "hr" ? " fc" : ""}`;
    case "pace": return t.max_s - t.min_s === 10 ? `@${fmtClock(t.min_s + 5)}` : `@${fmtClock(t.min_s)}-${fmtClock(t.max_s)}`;
    case "hr": return `fc ${t.min}-${t.max}`;
    case "rpe": return `pse ${t.value}`;
    default: return "";
  }
}
const INTENT_WORD: Partial<Record<Intent, string>> = { warmup: "aquec", cooldown: "desaq", recovery: "trote", rest: "descanso" };
const STROKE_WORD: Record<Stroke, string> = { free: "crawl", back: "costas", breast: "peito", fly: "borboleta", im: "medley", choice: "escolha", kick: "pernada", drill: "educativo" };
const EQUIP_WORD: Record<Equipment, string> = { paddles: "palmar", pullbuoy: "pullbuoy", fins: "nadadeira", kickboard: "prancha", snorkel: "snorkel" };
function stepToText(s: Step, sport: Sport): string {
  const parts = [durText(s.duration, sport)];
  if (sport === "swim") {
    if (s.stroke) parts.push(STROKE_WORD[s.stroke]);
    if (s.send_off_s) parts.push(`@${fmtClock(s.send_off_s)}`);
    if (s.equipment?.length) parts.push(...s.equipment.map((e) => EQUIP_WORD[e]));
    if (s.intent === "warmup" || s.intent === "cooldown") parts.push(INTENT_WORD[s.intent]!);
  } else {
    if (INTENT_WORD[s.intent]) parts.push(INTENT_WORD[s.intent]!);
    const tg = tgtText(s.target);
    if (tg) parts.push(tg);
  }
  if (s.note) parts.push(`(${s.note})`);
  return parts.filter(Boolean).join(" ");
}
export function toQuickText(st: Structure, sport: Sport): string {
  if (sport === "strength")
    return st.blocks.filter((b): b is Exercise => b.kind === "exercise").map((e) => {
      const load = e.load ? (e.load.type === "kg" ? ` ${e.load.value}kg` : e.load.type === "pct_1rm" ? ` ${e.load.value}%` : e.load.type === "rpe" ? ` pse ${e.load.value}` : " pc") : "";
      return `${e.name} ${e.sets}x${e.reps.replace(" s", "s")}${load}${e.rest_s ? ` desc ${e.rest_s}"` : ""}`;
    }).join("\n");
  return st.blocks.map((b) => {
    if (b.kind === "exercise") return `${b.name} ${b.sets}x${b.reps}`;
    if (b.kind === "repeat") {
      const [a, ...rest] = b.steps;
      if (a && rest.length <= 1 && rest.every((r) => r.intent === "recovery" || r.intent === "rest")) return `${b.count}x${stepToText(a, sport)}${rest[0] ? ` c/ ${stepToText(rest[0], sport)}` : ""}`;
      return `${b.count}x(${b.steps.map((x) => stepToText(x, sport)).join(" + ")})`;
    }
    return stepToText(b, sport);
  }).join(" + ");
}
