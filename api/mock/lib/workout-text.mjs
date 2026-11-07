/**
 * Free-text workouts in pt-BR → workout structure v1 (api/endpoints.md § Workout structure).
 *
 * One grammar for coaching shorthand and plain sentences:
 *   "10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq"
 *   "15 min de aquecimento, 6 tiros de 800 m a 4:10 com 2 min de trote e 10 min de desaquecimento"
 *   swim "400 livre aquec + 10x100 crawl @1:45 palmar", strength "Agachamento 4x8 70% desc 90\"" (one exercise per line)
 * The grammar lives in three ports kept identical by the golden examples in api/workout-text-examples.json: this file
 * (the mock's /ai/workout), the web builder's quick text (frontend/src/domain/quicktext.ts) and the backend
 * (backend/crates/domain/src/workout_text.rs). Change all three together. Rules: docs/workout-text.md.
 *
 * Pipeline: #tags out → normalize → tokens (numbers, clocks, words, punctuation; number words become numbers) →
 * pieces (split on "+", ";", new lines; and on ",", ".", " e ", "depois"… once the piece has a number) → each piece
 * is a repeat, steps, an exercise or a modifier of the previous block. Deterministic and forgiving: what isn't
 * understood becomes a warning (the text as typed), never an exception.
 */

// ---------------------------------------------------------------- tags (api/endpoints.md § Tags)
const MAX_TAGS = 8;
export const normalizeTag = (raw) =>
  String(raw).replace(/^#+/, "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
export function cleanTags(tags) {
  const out = [];
  for (const t of tags) { const n = normalizeTag(t); if (n && !out.includes(n)) out.push(n); }
  return out.slice(0, MAX_TAGS);
}
const HASHTAG = /(^|[\s(])#([\p{L}\p{N}_-]+)/gu;
/** Pull "#tags" out of a line; returns the line without them. */
export function extractTags(text) {
  const found = [];
  const rest = text.replace(HASHTAG, (_m, lead, tag) => { found.push(tag); return lead; });
  return { text: rest.replace(/[ \t]{2,}/g, " ").replace(/\s*\+\s*$/, "").trim(), tags: cleanTags(found) };
}

// ---------------------------------------------------------------- vocabulary
const KM = ["km", "k", "kms", "quilômetro", "quilômetros", "quilometro", "quilometros"];
const METERS = ["m", "mt", "mts", "metro", "metros"];
const HOURS = ["h", "hr", "hrs", "hora", "horas"];
const MINUTES = ["min", "mins", "minuto", "minutos", "minutinho", "minutinhos"];
const SECONDS = ["s", "seg", "segs", "segundo", "segundos", "sec"];
const UNIT_WORDS = [...KM, ...METERS, ...HOURS, ...MINUTES, ...SECONDS];
const NUMBER_WORDS = {
  um: 1, uma: 1, dois: 2, duas: 2, "três": 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900, mil: 1000,
};
/** "6x", "6 vezes", "6 tiros (de)", "3 séries (de)". */
const REPEAT_WORDS = ["x", "vezes", "tiro", "tiros", "repetição", "repetições", "repeticao", "repeticoes", "rep", "reps", "série", "séries", "serie", "series", "bloco", "blocos", "estímulo", "estímulos", "estimulo", "estimulos", "aceleração", "acelerações", "aceleracao", "aceleracoes", "strides"];
/** Words that open the recovery part of a repeat ("6x1km c/ 2' trote", "8x100 com 20\" de descanso"). */
const RECOVERY_MARKERS = ["com", "int", "intervalo", "intervalos", "rec", "recuperação", "recuperacao", "recupera", "pausa", "descanso", "desc"];
/** Words that make a piece a recovery when they follow an amount ("2' trote", "15\" desc", "1' parado"). */
const RECOVERY_WORDS = ["descanso", "desc", "parado", "parada", "pausa", "intervalo", "int", "rec", "recuperação", "recuperacao", "andando", "repouso"];
/** Easy words: after a hard rep, an amount with one of these is the recovery ("10x1' forte 1' leve"). */
const EASY_WORDS = ["leve", "leves", "solto", "soltinho", "levinho", "regenerativo", "fácil", "facil", "devagar", "suave"];
const SOFT_WORDS = ["e", "depois", "então", "entao", "seguido", "seguida", "seguidos", "seguidas"];
const HR_WORDS = ["fc", "bpm", "frequência", "frequencia", "cardíaca", "cardiaca"];
const POWER_WORDS = ["potência", "potencia", "power", "watts", "watt", "w", "ftp"];
/**
 * Intensity words → PSE (RPE 1–10) with the word people see: `{type: "rpe", value, label}` (docs/workout-text.md
 * § PSE). Phrases first, then adjectives (they win over nouns like "rodagem"), in this order.
 */
const INTENSITY_PHRASES = [
  [["bem", "leve"], 2, "bem leve"], [["muito", "leve"], 2, "muito leve"], [["bem", "levinho"], 2, "bem leve"], [["muito", "forte"], 9, "muito forte"],
  [["ritmo", "de", "meia", "maratona"], 7, "ritmo de meia"], [["ritmo", "de", "meia"], 7, "ritmo de meia"], [["ritmo", "de", "maratona"], 6, "ritmo de maratona"],
];
const INTENSITY_WORDS = [
  [["regenerativo", "regenerativa", "regenerativos", "recuperativo", "recuperativa"], 2, "regenerativo"], [["soltinho"], 2, "soltinho"], [["levinho"], 2, "levinho"],
  [["leve", "leves"], 3, "leve"], [["fácil", "facil"], 3, "fácil"], [["tranquilo", "tranquila"], 3, "tranquilo"], [["confortável", "confortavel"], 3, "confortável"], [["aeróbico", "aerobico"], 3, "aeróbico"],
  [["moderado", "moderada"], 5, "moderado"], [["médio", "medio"], 5, "médio"], [["steady"], 5, "steady"],
  [["limiar", "threshold"], 7, "limiar"], [["forte", "fortes"], 8, "forte"], [["intenso", "intensa"], 8, "intenso"], [["fortíssimo", "fortissimo"], 9, "fortíssimo"],
  [["máximo", "maximo", "máxima", "maxima", "máx", "max"], 10, "máximo"], [["sprint", "sprints"], 10, "sprint"],
];
const INTENSITY_NOUNS = [[["rodagem", "longão", "longao", "longo", "longa"], 3, "leve"]];
/** Recovery words that also say how easy: "2' trote" (PSE 3), "3' andando" (PSE 2). */
const isJog = (t) => t.k === "word" && t.low.startsWith("trot");
const isWalk = (t) => t.k === "word" && (t.low.startsWith("caminh") || t.low === "andando");
/** "Desc. 1'30" & 3'": the rest after each run of the set above, and after the whole set. */
const DESC_WORDS = ["desc", "descanso", "pausa"];
/** Swim strokes, most specific first (a kick or drill set wins over the base stroke). */
const STROKES = [
  [["escolha"], "choice"], [["pernada", "pernadas", "perna", "pernas"], "kick"], [["educativo", "educativos", "educativa"], "drill"],
  [["borboleta", "golfinho"], "fly"], [["costas"], "back"], [["peito"], "breast"], [["medley"], "im"], [["crawl", "crol", "livre"], "free"],
];
const EQUIPMENT = [
  [["palmar", "palmares"], "paddles"], [["pull", "pullbuoy", "buoy", "flutuador", "boia", "bóia"], "pullbuoy"],
  [["nadadeira", "nadadeiras"], "fins"], [["prancha", "pranchinha"], "kickboard"], [["snorkel", "respirador"], "snorkel"],
];
/** Free words kept as the step's note (pt-BR, as shown to the athlete). */
const NOTE_WORDS = [
  [["educativo", "educativos", "educativa"], "educativos"], [["subida", "subidas", "ladeira", "ladeiras", "morro", "rampa", "rampas"], "subida"],
  [["esteira"], "esteira"],
];
/** Words that may sit inside "( )" and still be read as the step's target ("6x1km (4:30)", "40' (Z2)"). */
const INLINE_WORDS = ["z", "zona", "pse", "rpe", "fc", "bpm", "w", "km", "min", "pace", "ritmo", "a", "de", "por", "ftp", "do", "potência", "potencia", "watts"];
const LEAD_FILLERS = ["e", "depois", "mais", "então", "entao", "seguido", "seguida", "de", "do", "da", "por", "fim", "também", "tambem", "faça", "faca", "fazer", "faz", "com", "o", "a", "os", "as", "no", "na", "pra", "para", "finalizar", "finalizando", "terminar"];
const TRAIL_FILLERS = ["de", "com", "em", "no", "na", "a", "o", "e"];
const SETS_WORDS = ["séries", "series", "série", "serie", "sets", "set"];
const REPS_WORDS = ["repetições", "repeticoes", "repetição", "repeticao", "reps", "rep", "vezes"];
const KG = ["kg", "kgs", "quilos", "kilos", "quilo", "kilo"];
const REST_WORDS = ["desc", "descanso", "int", "intervalo", "pausa", "rest", "rec", "recuperação", "recuperacao"];
const ATTR_WORDS = [...KG, ...REST_WORDS, "pse", "rpe", "pc", "peso", "tempo", "carga", "com", "a", "de", "sem", "cada", "por", "cadência", "cadencia"];
const ATTR_FILLERS = ["com", "a", "de", "e", "carga", "do", "da"];
const SIDE_WORDS = ["lado", "perna", "braço", "braco", "membro"];
const MAX_REPEAT_STEPS = 50;
const MAX_AMOUNT = 1000000;

// ---------------------------------------------------------------- tokens
const isDigit = (c) => c !== undefined && c >= "0" && c <= "9";
/** ASCII letters and Latin-1/Latin Extended letters (Portuguese), the same set in every port. */
const isLetter = (c) => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "À" && c <= "ɏ" && c !== "×" && c !== "÷"));
const round = (x) => Math.floor(x + 0.5);
/** JavaScript's `\s`, spelled out so every port treats the same characters as spaces. */
const isSpace = (c) => "\t\n\v\f\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff".includes(c) || (c >= "\u2000" && c <= "\u200a");

/** "1) " or "2. " numbering a line. */
function stripListMarker(s) {
  let j = 0;
  while (j < 2 && isDigit(s[j])) j++;
  return j > 0 && (s[j] === ")" || s[j] === ".") && s[j + 1] === " " ? s.slice(j + 2) : s;
}

/** Typographic marks → ASCII ("×" → x, primes → ' and "), one space between words. */
function normalizeLine(s) {
  let out = "";
  for (const c of s) {
    if (c === "×") out += "x";
    else if ("′’´`‘".includes(c)) out += "'";
    else if ("″”“".includes(c)) out += '"';
    else if ("–—−".includes(c)) out += "-";
    else if (isSpace(c)) out += " ";
    else out += c;
  }
  return out.replaceAll("''", '"').replace(/ {2,}/g, " ").trim();
}

/** Tokens: {k: num|clock|word|p, raw, low, sp (space before), v (num: value, clock: seconds), int, n (clock parts)}. */
function tokenize(text) {
  const cs = [...text];
  const out = [];
  let i = 0, sp = false;
  const push = (t, j) => { const raw = cs.slice(i, j).join(""); out.push({ ...t, raw, low: raw.toLowerCase(), sp }); sp = false; i = j; };
  const twoDigits = (j) => isDigit(cs[j]) && isDigit(cs[j + 1]) && !isDigit(cs[j + 2]);
  while (i < cs.length) {
    const c = cs[i];
    if (c === " ") { sp = true; i++; continue; }
    if (isDigit(c)) {
      let j = i;
      while (isDigit(cs[j])) j++;
      let digits = cs.slice(i, j).join("");
      // "4:30", "1:23:45": a clock (minutes or hours up to two digits).
      if (cs[j] === ":" && j - i <= 2 && twoDigits(j + 1)) {
        const a = Number(digits), b = Number(cs[j + 1] + cs[j + 2]);
        if (cs[j + 3] === ":" && twoDigits(j + 4)) push({ k: "clock", n: 3, v: a * 3600 + b * 60 + Number(cs[j + 4] + cs[j + 5]) }, j + 6);
        else push({ k: "clock", n: 2, v: a * 60 + b }, j + 3);
        continue;
      }
      // "1.500" is a thousand separator; "1,5" and "1.5" are decimals.
      while (cs[j] === "." && isDigit(cs[j + 1]) && isDigit(cs[j + 2]) && isDigit(cs[j + 3]) && !isDigit(cs[j + 4])) { digits += cs[j + 1] + cs[j + 2] + cs[j + 3]; j += 4; }
      if ((cs[j] === "," || cs[j] === ".") && isDigit(cs[j + 1])) {
        let k = j + 1;
        while (isDigit(cs[k])) k++;
        push({ k: "num", v: Number(digits + "." + cs.slice(j + 1, k).join("")), int: false }, k);
      } else push({ k: "num", v: Number(digits), int: true }, j);
      continue;
    }
    if (isLetter(c)) {
      let j = i;
      while (isLetter(cs[j])) j++;
      // "3xmáx", "4xfalha": the "x" of a count glued to a word.
      const prev = out[out.length - 1];
      if ((c === "x" || c === "X") && j > i + 1 && !sp && prev !== undefined && prev.k === "num") { push({ k: "word" }, i + 1); continue; }
      push({ k: "word" }, j);
      continue;
    }
    push({ k: "p" }, i + 1);
  }
  return out;
}

const W = (t, ...ws) => t !== undefined && t.k === "word" && ws.includes(t.low);
const P = (t, c) => t !== undefined && t.k === "p" && t.low === c;
const N = (t) => t !== undefined && t.k === "num";
const INT = (t) => N(t) && t.int;
const CLOCK = (t) => t !== undefined && t.k === "clock" && t.n === 2;
const numish = (t) => t !== undefined && (t.k === "num" || t.k === "clock");
const isUnit = (t) => t !== undefined && t.k === "word" && UNIT_WORDS.includes(t.low);
const isNumberWord = (t) => t !== undefined && t.k === "word" && Object.hasOwn(NUMBER_WORDS, t.low);
/** The text of some tokens, as typed (after normalization). */
const textOf = (toks) => toks.map((t, i) => (i > 0 && t.sp ? " " : "") + t.raw).join("");

/** Number words → numbers ("seis tiros", "vinte e cinco", "dois mil"); "meia hora", "1 hora e meia", "1 hora e 20". */
function numberWords(toks) {
  const res = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (isNumberWord(t) || (INT(t) && W(toks[i + 1], "mil"))) {
      let v = isNumberWord(t) ? NUMBER_WORDS[t.low] : t.v, last = v, j = i + 1;
      if (W(toks[j], "mil") && v !== 1000) { v *= 1000; last = 1000; j++; }
      while (W(toks[j], "e") && isNumberWord(toks[j + 1]) && last >= 20 && NUMBER_WORDS[toks[j + 1].low] < last) { last = NUMBER_WORDS[toks[j + 1].low]; v += last; j += 2; }
      res.push({ k: "num", v, int: true, raw: textOf(toks.slice(i, j)), low: textOf(toks.slice(i, j)).toLowerCase(), sp: t.sp });
      i = j - 1;
      continue;
    }
    if (W(t, "meia", "meio") && isUnit(toks[i + 1])) { res.push({ ...t, k: "num", v: 0.5, int: false }); continue; }
    const a = res[res.length - 2], u = res[res.length - 1];
    if (W(t, "e") && N(a) && isUnit(u)) {
      if (W(toks[i + 1], "meia", "meio")) { res[res.length - 2] = { ...a, v: a.v + 0.5, int: false }; i++; continue; }
      if (N(toks[i + 1]) && (HOURS.includes(u.low) || (MINUTES.includes(u.low) && (W(toks[i + 2], ...SECONDS) || P(toks[i + 2], '"'))))) continue;
    }
    res.push(t);
  }
  return res;
}

/** "p: 1'30"", "P: 1'": some coaches write a pause (pausa) this way. */
function pauseMarks(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (W(toks[i], "p") && P(toks[i + 1], ":")) { out.push({ ...toks[i], low: "pausa" }); i++; continue; }
    out.push(toks[i]);
  }
  return out;
}

// ---------------------------------------------------------------- pieces
/** "entre 4:30 e 4:40": that "e" joins a range, it doesn't split. */
function rangeE(toks, i) {
  if (!numish(toks[i + 1])) return false;
  for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
    const t = toks[j];
    if (W(t, "entre")) return true;
    if (!(numish(t) || t.k === "p" || isUnit(t) || W(t, "bpm", "w", "watts", "kg"))) return false;
  }
  return false;
}
/** "2' limiar/ 1' trote": a slash between a word (not a unit, not the "c" of "c/") and an amount. */
function slashPair(toks, i) {
  const a = toks[i - 1], u = toks[i + 2];
  return a !== undefined && a.k === "word" && [...a.low].length > 1 && !isUnit(a) && N(toks[i + 1]) && (W(u, ...UNIT_WORDS) || P(u, "'") || P(u, '"'));
}
function softAt(toks, i) {
  const t = toks[i];
  if (P(t, ",") || P(t, ".") || P(t, "|")) return true;
  if (P(t, "-")) return t.sp && !!toks[i + 1]?.sp && !(numish(toks[i - 1]) && numish(toks[i + 1]) && !W(toks[i + 2], ...REPEAT_WORDS));
  if (P(t, "/")) return (t.sp && !!toks[i + 1]?.sp) || slashPair(toks, i);
  if (W(t, "e")) return !rangeE(toks, i);
  return W(t, ...SOFT_WORDS);
}
/** Words a ":" belongs to ("tempo: 3-1-1", "desc: 1'"), so it doesn't split there. */
const COLON_KEEP = ["tempo", "cadência", "cadencia", "pse", "rpe", "fc", "pace", "ritmo", "zona", ...DESC_WORDS, ...REST_WORDS];
/**
 * "2' caminhada: 4' corrida leve", "3' (4:35/km) : 5' (4:18/km)": a ":" between two amounts alternates them (a soft
 * split), unless it's inside a repeat ("11x 100m (leve): 300m", one round: parseRepeat) or after a label word.
 */
function colonSplit(toks, i, cur) {
  const prev = toks[i - 1];
  if (!N(toks[i + 1]) || (prev !== undefined && prev.k === "word" && COLON_KEEP.includes(prev.low))) return false;
  return !findAnchor(cur);
}
/** Split on "+", ";" and new lines (hard), and on soft separators once the piece has a number. */
function segment(toks) {
  const pieces = [];
  let cur = [], sep = "hard", depth = 0;
  const flush = (next) => {
    if (cur.length) { pieces.push({ toks: cur, sep }); cur = []; sep = next; }
    else if (next === "hard") sep = "hard";
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (P(t, "\n")) { depth = 0; flush("hard"); continue; }
    if (P(t, "(")) depth++;
    else if (P(t, ")")) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (P(t, "+") || P(t, ";")) { flush("hard"); continue; }
      if ((softAt(toks, i) || (P(t, ":") && colonSplit(toks, i, cur))) && cur.some(numish)) { flush("soft"); continue; }
    }
    cur.push(t);
  }
  flush("hard");
  return pauseParens(pieces);
}
/**
 * "600m | p: 1'30" (2'30 | 4:10/km)": the pace in parentheses after a pause is the run's, before it (a pause has no
 * pace). Moved to the end of the run's piece.
 */
function pauseParens(pieces) {
  for (let k = 1; k < pieces.length; k++) {
    const p = pieces[k];
    if (p.sep !== "soft" || !W(p.toks[0], "pausa")) continue;
    const a = p.toks.findIndex((t) => P(t, "("));
    if (a < 0) continue;
    let d = 0, b = a;
    for (; b < p.toks.length; b++) {
      if (P(p.toks[b], "(")) d++;
      else if (P(p.toks[b], ")") && --d === 0) break;
    }
    const group = p.toks.slice(a, b + 1);
    if (!group.some((t) => t.k === "clock") || pieces[k - 1].toks.some((t) => P(t, "("))) continue;
    pieces[k - 1] = { ...pieces[k - 1], toks: [...pieces[k - 1].toks, ...group] };
    pieces[k] = { ...p, toks: [...p.toks.slice(0, a), ...p.toks.slice(b + 1)] };
  }
  return pieces;
}

const INTENSITY_ONLY = new Set([...INTENSITY_WORDS.flatMap(([ws]) => ws), ...INTENSITY_PHRASES.flatMap(([ws]) => ws), ...EASY_WORDS]);
/** "(2'30 | 4:10/km)": the same target written two ways (the rep's time | its pace) → the part with the pace. */
function pickAlternative(inner) {
  if (!inner.some((t) => P(t, "|"))) return inner;
  const parts = [[]];
  for (const t of inner) { if (P(t, "|")) parts.push([]); else parts[parts.length - 1].push(t); }
  return parts.find((q) => q.some((t, i) => P(t, "/") && W(q[i + 1], ...KM))) ?? parts[0];
}
/**
 * Parenthesized text: a note, or (when it only holds a target) inline tokens. `words`: an intensity word alone
 * ("(leve)") is a target too (runs, rides, swims; for exercises it stays a note).
 */
function takeParens(toks0, words = false) {
  const toks = [], notes = [];
  for (let i = 0; i < toks0.length; i++) {
    if (P(toks0[i], ")")) continue;
    if (!P(toks0[i], "(")) { toks.push(toks0[i]); continue; }
    let d = 1, j = i + 1;
    for (; j < toks0.length; j++) {
      if (P(toks0[j], "(")) d++;
      else if (P(toks0[j], ")") && --d === 0) break;
    }
    const inner = pickAlternative(toks0.slice(i + 1, j));
    const inline = inner.every((t) => t.k !== "word" || INLINE_WORDS.includes(t.low));
    const intensity = words && inner.length > 0 && inner.every((t) => t.k === "word" && INTENSITY_ONLY.has(t.low));
    if (intensity || (inner.length && inline && (inner.some(numish) || inner.some((t) => W(t, ...HR_WORDS, ...POWER_WORDS))))) toks.push(...inner);
    else { const s = textOf(inner).trim(); if (s) notes.push(s); }
    i = j;
  }
  return { toks, notes };
}

// ---------------------------------------------------------------- amounts and values
/** A duration at `i` → {dur, end} (unused tokens only), up to 1,000 km or 1,000,000 s. */
function amountAt(toks, used, i, sport, bare) {
  const a = rawAmountAt(toks, used, i, sport, bare);
  return a && (a.dur.type === "distance" ? a.dur.m : a.dur.s) <= MAX_AMOUNT ? a : null;
}
/** `bare`: unitless numbers ("active": swim meters, run ≥ 100 m; "recovery": < 100 s, else m). */
function rawAmountAt(toks, used, i, sport, bare) {
  const at = (j) => (used[j] ? undefined : toks[j]);
  const t = at(i);
  if (!N(t)) return null;
  const u = at(i + 1), v = t.v;
  if (W(u, ...KM)) {
    if (P(at(i + 2), "/") && W(at(i + 3), "h")) return null;
    return { dur: { type: "distance", m: round(v * 1000) }, end: i + 2 };
  }
  if (W(u, ...METERS)) return { dur: { type: "distance", m: round(v) }, end: i + 2 };
  if (W(u, ...HOURS)) {
    let s = v * 3600, end = i + 2;
    if (INT(at(end)) && at(end).v < 60) { s += at(end).v * 60; end++; if (W(at(end), ...MINUTES) || P(at(end), "'")) end++; }
    return { dur: { type: "time", s: round(s) }, end };
  }
  if (W(u, ...MINUTES) || P(u, "'")) {
    let s = v * 60, end = i + 2;
    const n = at(end);
    if (INT(n) && n.v < 60 && (P(at(end + 1), '"') || W(at(end + 1), ...SECONDS) || (P(u, "'") && !n.sp))) { s += n.v; end += P(at(end + 1), '"') || W(at(end + 1), ...SECONDS) ? 2 : 1; }
    return { dur: { type: "time", s: round(s) }, end };
  }
  if (W(u, ...SECONDS) || P(u, '"')) return { dur: { type: "time", s: round(v) }, end: i + 2 };
  if (!bare || !t.int) return null;
  const prev = at(i - 1);
  if (W(prev, "fc", "pse", "rpe", "z", "zona", "x") || W(u, "w", "watts", "bpm", "rpm", ...KG) || P(u, "%")) return null;
  if (bare === "recovery") return v < 100 ? { dur: { type: "time", s: v }, end: i + 1 } : sport === "bike" ? null : { dur: { type: "distance", m: v }, end: i + 1 };
  if (sport === "swim" && v >= 10 && v <= 10000) return { dur: { type: "distance", m: v }, end: i + 1 };
  if (sport === "run" && v >= 100 && v <= 50000) return { dur: { type: "distance", m: v }, end: i + 1 };
  return null;
}
/** A pace or send-off value: "4:30", "4'30" → {v (s), end}. */
function clockAt(toks, used, i) {
  const at = (j) => (used[j] ? undefined : toks[j]);
  const t = at(i);
  if (CLOCK(t)) return { v: t.v, end: i + 1 };
  if (INT(t) && t.v < 60 && P(at(i + 1), "'") && INT(at(i + 2)) && at(i + 2).v < 60) return { v: t.v * 60 + at(i + 2).v, end: i + (P(at(i + 3), '"') ? 4 : 3) };
  return null;
}
/** "/km", "min/km", "/100", "por km" → {end, per100}. */
function paceUnitAt(toks, used, i) {
  const at = (j) => (used[j] ? undefined : toks[j]);
  let j = i;
  if (W(at(j), "min")) j++;
  if (P(at(j), "/")) {
    if (W(at(j + 1), "km")) return { end: j + 2, per100: false };
    if (N(at(j + 1)) && at(j + 1).v === 100) return { end: j + (W(at(j + 2), "m", "metros") ? 3 : 2), per100: true };
  }
  if (W(at(i), "por") && W(at(i + 1), "km")) return { end: i + 2, per100: false };
  return null;
}
const rangeConn = (t) => P(t, "-") || W(t, "a", "e", "até", "ate");
const fmtNum = (v) => String(v).replace(".", ",");

/** Numbers nobody took, with the free words around them ("nos últimos 5 km"): reported as warnings. */
function leftovers(toks, used) {
  const out = [];
  const free = (k) => k >= 0 && k < toks.length && !used[k] && !P(toks[k], ",") && !P(toks[k], "(") && !P(toks[k], ")");
  for (let i = 0; i < toks.length; i++) {
    if (used[i] || !numish(toks[i])) continue;
    let a = i, b = i + 1;
    while (free(a - 1)) a--;
    while (free(b)) b++;
    while (a < i && toks[a].k === "p") a++;
    while (b > i + 1 && toks[b - 1].k === "p" && !P(toks[b - 1], "'") && !P(toks[b - 1], '"') && !P(toks[b - 1], "%")) b--;
    out.push(textOf(toks.slice(a, b)));
    i = b - 1;
  }
  return out;
}

// ---------------------------------------------------------------- steps
const isRest = (s) => s !== undefined && s.kind === "step" && (s.intent === "recovery" || s.intent === "rest");
const isEasy = (s) => s.target.type === "open" || (s.target.type === "zone" && s.target.zone <= 2) || (s.target.type === "rpe" && s.target.value <= 3);
/** An easy step short enough to be a recovery: an easy target, up to 5 min or 1 km (not a pool distance). */
const shortRecovery = (s, sport) => s.target.type !== "open" && isEasy(s) && ((s.duration.type === "time" && s.duration.s <= 300) || (s.duration.type === "distance" && sport !== "swim" && s.duration.m <= 1000));
const restIntent = (sport) => (sport === "swim" ? "rest" : "recovery");
const defaultMetric = (sport) => (sport === "bike" ? "hr" : "pace");
const ftpZone = (pct) => (pct < 56 ? 1 : pct < 76 ? 2 : pct < 91 ? 3 : pct < 106 ? 4 : 5);

/** Split a progression's total into `n` parts: whole km (or minutes) when it fits, the remainder on the first. */
function splitParts(dur, n) {
  const total = dur.type === "distance" ? dur.m : dur.s;
  const unit = dur.type === "distance" ? (total >= n * 1000 ? 1000 : 100) : total >= n * 60 ? 60 : 1;
  const base = Math.floor(total / n / unit) * unit;
  return Array.from({ length: n }, (_, i) => (i === 0 ? total - base * (n - 1) : base)).map((x) => (dur.type === "distance" ? { type: "distance", m: x } : { type: "time", s: x }));
}

/**
 * One piece → steps. `fallback`: the intent when no word says it. Returns the steps plus what the piece said:
 * `fromWord` (an intent word), `between` ("reps" | "series": "entre os tiros" / "entre séries"), `modifierOnly`
 * (only a target, stroke, equipment, send-off or note: it can complete the previous block), `progression`.
 */
function parseSteps(toks0, sport, fallback, bare) {
  const { toks, notes: parenNotes } = takeParens(toks0, true);
  const used = toks.map(() => false);
  const at = (j) => (used[j] ? undefined : toks[j]);
  const claim = (a, b) => { for (let k = a; k < b; k++) used[k] = true; };
  const n = toks.length;

  let between = null;
  for (let i = 0; i < n && !between; i++) {
    if (!W(at(i), "entre")) continue;
    let j = i + 1;
    while (W(at(j), "os", "as", "o", "a")) j++;
    const w = at(j);
    if (w?.k !== "word") continue;
    if (["tiro", "rep", "estímul", "estimul", "eles", "elas", "cada", "piq"].some((p) => w.low.startsWith(p))) between = "reps";
    else if (["séri", "seri", "bloco", "set", "round"].some((p) => w.low.startsWith(p))) between = "series";
    if (between) claim(i, j + 1);
  }
  let progression = false;
  for (let i = 0; i < n; i++) if (at(i)?.k === "word" && (at(i).low.startsWith("progress") || at(i).low.startsWith("progredi"))) { used[i] = true; progression = true; }

  // "5 km em 25 min", "400 em 6:00": a total time for a distance → pace.
  let total = null;
  for (let i = 0; i < n && total === null; i++) {
    if (!W(at(i), "em")) continue;
    const c = at(i + 1);
    if (c !== undefined && c.k === "clock" && !paceUnitAt(toks, used, i + 2)) { total = { s: c.v, clock: c.n === 2 }; claim(i, i + 2); continue; }
    const a = amountAt(toks, used, i + 1, sport, null);
    if (a && a.dur.type === "time") { total = { s: a.dur.s, clock: false }; claim(i, a.end); }
  }
  // "200m 53-58seg", "400m 1'30"": a time (or a range of times) right after a run distance is the time for it → pace.
  let repTime = null;
  for (let i = 0; i < n && !repTime && sport === "run"; i++) {
    const d = amountAt(toks, used, i, sport, bare);
    if (!d || d.dur.type !== "distance" || d.dur.m <= 0 || !N(at(d.end))) continue;
    const j = d.end;
    const lo = amountAt(toks, used, j, sport, null);
    if (lo && lo.dur.type !== "time") continue;
    const c = lo ? lo.end : j + 1;
    let a = null, b = null, end = j;
    if (P(at(c), "-") || W(at(c), "a")) {
      const hi = amountAt(toks, used, c + 1, sport, null);
      if (hi && hi.dur.type === "time" && toks[c + 1].v > 0) { b = hi.dur.s; a = lo ? lo.dur.s : round((hi.dur.s * toks[j].v) / toks[c + 1].v); end = hi.end; }
    }
    if (a === null && lo) { a = lo.dur.s; end = lo.end; }
    if (a === null || a <= 0) continue;
    claim(j, end);
    repTime = { m: d.dur.m, a: Math.min(a, b ?? a), b: b === null ? null : Math.max(a, b) };
  }

  let ftp = null, power = null, hr = null, rpe = null, zone = null, pace = null, sendOff = null;
  const extraNotes = [];
  for (let i = 0; i < n && !ftp; i++) {
    if (!N(at(i))) continue;
    let j = i + 1, b = toks[i].v;
    if (rangeConn(at(j)) && N(at(j + 1))) { b = toks[j + 1].v; j += 2; }
    if (!P(at(j), "%")) continue;
    j++;
    while (W(at(j), "do", "de", "da")) j++;
    if (!W(at(j), "ftp") || toks[i].v < 1 || toks[i].v >= 1000 || b < 1 || b >= 1000) continue;
    claim(i, j + 1);
    ftp = { a: toks[i].v, b };
  }
  for (let i = 0; i < n && !power; i++) {
    if (!N(at(i))) continue;
    let j = i + 1, b = null;
    if (rangeConn(at(j)) && N(at(j + 1))) { b = toks[j + 1].v; j += 2; }
    if (!W(at(j), "w", "watts", "watt") || toks[i].v > 3000 || b > 3000) continue;
    claim(i, j + 1);
    const a = round(toks[i].v);
    power = b === null ? { type: "power", min: a, max: a } : { type: "power", min: Math.min(a, round(b)), max: Math.max(a, round(b)) };
  }
  // "FC até 150", "FC máx 160": a cap, kept as a note.
  for (let i = 0; i < n; i++) {
    if (!W(at(i), "fc", "frequência", "frequencia")) continue;
    let j = i + 1;
    while (W(at(j), "cardíaca", "cardiaca") || P(at(j), ":")) j++;
    if (!W(at(j), "até", "ate", "abaixo", "máx", "max", "máxima", "maxima")) continue;
    j++;
    while (W(at(j), "de", "da")) j++;
    if (!N(at(j)) || toks[j].v < 40 || toks[j].v > 230) continue;
    const k = W(at(j + 1), "bpm") ? j + 2 : j + 1;
    claim(i, k);
    extraNotes.push(`FC até ${round(toks[j].v)}`);
    break;
  }
  for (let i = 0; i < n && !hr; i++) {
    let j = i;
    if (W(at(i), "fc", "frequência", "frequencia")) {
      j = i + 1;
      while (W(at(j), "cardíaca", "cardiaca", "de", "entre", "em", "a") || P(at(j), ":")) j++;
    } else if (!N(at(i))) continue;
    const t = at(j);
    if (!N(t) || t.v < 40 || t.v > 230) continue;
    let k = j + 1, b = null;
    if (rangeConn(at(k)) && N(at(k + 1))) { b = toks[k + 1].v; k += 2; }
    if (W(at(k), "bpm")) k++;
    else if (j === i) continue; // a bare number needs "bpm"
    claim(i, k);
    const a = round(t.v);
    hr = b === null ? { type: "hr", min: a, max: a } : { type: "hr", min: Math.min(a, round(b)), max: Math.max(a, round(b)) };
  }
  for (let i = 0; i < n && !rpe; i++) {
    if (!W(at(i), "pse", "rpe")) continue;
    let j = i + 1;
    while (W(at(j), "de") || P(at(j), ":")) j++;
    if (!N(at(j))) continue;
    let k = j + 1;
    if (rangeConn(at(k)) && N(at(k + 1))) {
      if (toks[k + 1].v !== toks[j].v && toks[j].v >= 1 && toks[j].v <= 10 && toks[k + 1].v >= 1 && toks[k + 1].v <= 10) extraNotes.push(`PSE ${fmtNum(toks[j].v)}–${fmtNum(toks[k + 1].v)}`);
      k += 2;
    }
    if (P(at(k), "/") && N(at(k + 1)) && toks[k + 1].v === 10) k += 2;
    claim(i, k);
    rpe = { type: "rpe", value: Math.min(10, Math.max(1, round(toks[j].v))) };
  }
  for (let i = 0; i < n && !zone; i++) {
    if (!W(at(i), "z", "zona")) continue;
    const t = at(i + 1);
    if (!INT(t) || t.v < 1 || t.v > 5) continue;
    let k = i + 2, b = null;
    if (P(at(k), "-") || P(at(k), "/") || P(at(k), ">") || W(at(k), "a", "ao", "até", "ate", "para")) {
      const m = W(at(k + 1), "z", "zona") ? k + 2 : k + 1;
      if (INT(at(m)) && at(m).v >= 1 && at(m).v <= 5) { b = at(m).v; k = m + 1; }
    }
    claim(i, k);
    zone = { a: t.v, b };
  }
  let metric = defaultMetric(sport);
  if (zone) {
    for (let i = 0; i < n; i++) {
      if (W(at(i), ...HR_WORDS)) { metric = "hr"; used[i] = true; }
      else if (W(at(i), ...POWER_WORDS)) { metric = "power"; used[i] = true; }
    }
  }
  for (let j = 0; j < n && !pace; j++) {
    const v1 = clockAt(toks, used, j);
    if (!v1) continue;
    let start = j, marker = false;
    if (P(at(j - 1), "@")) { start = j - 1; marker = sport !== "swim"; }
    else if (W(at(j - 1), "ritmo", "pace")) { start = j - 1; marker = true; }
    else if (W(at(j - 1), "de", "em", "a", "no") && W(at(j - 2), "ritmo", "pace")) { start = j - 2; marker = true; }
    else if (W(at(j - 1), "a") && sport !== "swim") { start = j - 1; marker = true; }
    else if (W(at(j - 1), "entre", "de")) start = j - 1;
    let end = v1.end, b = null;
    if (P(at(end), "-") || P(at(end), ">") || W(at(end), "a", "até", "ate", "e", "para")) {
      const v2 = clockAt(toks, used, end + 1);
      if (v2) { b = v2.v; end = v2.end; }
    }
    const unit = paceUnitAt(toks, used, end);
    if (unit) end = unit.end;
    const ok = sport === "swim" ? (unit && unit.per100) || (marker && !P(at(start), "@")) : marker || unit || b !== null;
    if (!ok) continue;
    if (start === j - 1 && W(at(j - 1), "entre", "de") && b === null && !unit) start = j;
    claim(start, end);
    pace = { a: v1.v, b };
  }
  if (sport === "swim") {
    for (let i = 0; i < n && sendOff === null; i++) {
      let k, start = i;
      if (P(at(i), "@")) k = i + 1;
      else if (W(at(i), "saída", "saida", "saindo", "sai", "sair")) { k = i + 1; while (W(at(k), "em", "a", "de", "com", "cada", "do")) k++; }
      else if (W(at(i), "cada")) { k = i + 1; if (W(at(i - 1), "a")) start = i - 1; }
      else continue;
      const c = clockAt(toks, used, k);
      const a = c ? null : amountAt(toks, used, k, sport, null);
      if (c) { claim(start, c.end); sendOff = c.v; }
      else if (a && a.dur.type === "time") { claim(start, a.end); sendOff = a.dur.s; }
    }
  }
  for (let i = 0; i < n; i++) {
    if (!N(at(i))) continue;
    if (toks[i].v < 1 || toks[i].v >= 1000) continue;
    if (W(at(i + 1), "km") && P(at(i + 2), "/") && W(at(i + 3), "h")) { claim(i, i + 4); extraNotes.push(`${fmtNum(toks[i].v)} km/h`); }
    else if (W(at(i + 1), "rpm")) { claim(i, i + 2); if (W(at(i - 1), "de")) used[i - 1] = true; extraNotes.push(`${fmtNum(toks[i].v)} rpm`); }
  }
  for (let i = 0; i < n; i++) if (W(at(i), "cadência", "cadencia") && extraNotes.some((x) => x.endsWith("rpm"))) used[i] = true;
  // An unmarked "4:30": a pace (a send-off in the pool).
  for (let j = 0; j < n; j++) {
    if (!CLOCK(at(j))) continue;
    if (sport === "swim" && sendOff === null) { sendOff = toks[j].v; used[j] = true; }
    else if (sport !== "swim" && !pace) { pace = { a: toks[j].v, b: null }; used[j] = true; }
  }

  let dur = null;
  // "30 a 40 min", "60-80m", "1h a 1h30": a range, {s, max_s} / {m, max_m} (the lower amount first).
  for (let i = 0; i < n && !dur; i++) {
    if (!N(at(i))) continue;
    const lo = amountAt(toks, used, i, sport, null);
    const c = lo ? lo.end : i + 1;
    if (!(P(at(c), "-") || W(at(c), "a", "até", "ate", "ou"))) continue;
    const hi = amountAt(toks, used, c + 1, sport, null);
    if (!hi || (lo && lo.dur.type !== hi.dur.type) || !(toks[c + 1].v > 0)) continue;
    const f = toks[i].v / toks[c + 1].v;
    const dist = hi.dur.type === "distance";
    const hv = dist ? hi.dur.m : hi.dur.s;
    const lv = lo ? (dist ? lo.dur.m : lo.dur.s) : round(hv * f);
    if (lv > MAX_AMOUNT) continue;
    const a = Math.min(lv, hv), b = Math.max(lv, hv);
    dur = dist ? { type: "distance", m: a } : { type: "time", s: a };
    if (b > a) dur[dist ? "max_m" : "max_s"] = b;
    claim(i, hi.end);
  }
  for (let i = 0; i < n && !dur; i++) {
    const a = amountAt(toks, used, i, sport, bare);
    if (a) { claim(i, a.end); dur = a.dur; }
  }
  for (let i = 0; i < n && !dur; i++) if (at(i)?.k === "clock" && at(i).n === 3 && toks[i].v <= MAX_AMOUNT) { dur = { type: "time", s: toks[i].v }; used[i] = true; }

  // Intent words (aquecimento > desaquecimento > descanso > trote).
  let intent = null;
  const words = (pred) => { for (let i = 0; i < n; i++) if (at(i)?.k === "word" && pred(toks[i].low, i)) { used[i] = true; return true; } return false; };
  const calma = () => { for (let i = 0; i < n; i++) if (W(at(i), "volta") && W(at(i + 1), "à", "a") && W(at(i + 2), "calma")) { claim(i, i + 3); return true; } return false; };
  if (words((w) => w.startsWith("aquec") || w === "aq")) intent = "warmup";
  else if (words((w) => w.startsWith("desaq") || ["soltar", "solto", "solta", "soltura", "soltando"].includes(w)) || calma()) intent = "cooldown";
  else if (words((w) => ["descanso", "desc", "parado", "parada", "pausa", "repouso", "descansar", "descansando"].includes(w))) intent = "rest";
  else if (words((w) => ["intervalo", "intervalos", "int"].includes(w))) intent = restIntent(sport);
  else if (words((w) => w.startsWith("trot") || w === "rec" || (w.startsWith("recupera") && !w.startsWith("recuperativ")) || w.startsWith("caminh") || w === "andando")) intent = "recovery";
  const fromWord = intent !== null;
  if (!intent) intent = between ? restIntent(sport) : fallback;

  // Notes from free words, swim stroke and equipment.
  const kwNotes = [];
  for (const [ws, note] of NOTE_WORDS) {
    if (sport === "swim" && note === "educativos") continue;
    if (toks.some((t) => t.k === "word" && ws.includes(t.low))) { kwNotes.push(note); toks.forEach((t, i) => { if (t.k === "word" && ws.includes(t.low)) used[i] = true; }); }
  }
  let stroke = null;
  const equipment = [];
  if (sport === "swim") {
    for (const [ws, s] of STROKES) if (!stroke && toks.some((t) => t.k === "word" && ws.includes(t.low))) stroke = s;
    const pato = toks.some((t, i) => W(t, "pé", "pe") && W(toks[i + 1], "de") && W(toks[i + 2], "pato"));
    for (const [ws, e] of EQUIPMENT) if (toks.some((t) => t.k === "word" && ws.includes(t.low)) || (e === "fins" && pato)) equipment.push(e);
  }

  // Target: pace > power > % FTP > heart rate > zone > PSE > intensity words.
  let target = null;
  if (pace) {
    let a = pace.a, b = pace.b;
    // Under 2:30 it can't be a pace per km: it's the time for the rep ("8x400 @1:35").
    if (total === null && sport === "run" && dur?.type === "distance" && dur.m > 0 && Math.min(a, b ?? a) < 150) { a = round((a * 1000) / dur.m); b = b === null ? null : round((b * 1000) / dur.m); }
    target = b === null ? { type: "pace", min_s: a, max_s: a } : { type: "pace", min_s: Math.min(a, b), max_s: Math.max(a, b) };
  } else if (total !== null && dur?.type === "distance" && dur.m > 0 && (sport === "run" || sport === "swim")) {
    const p = round((total.s * (sport === "swim" ? 100 : 1000)) / dur.m);
    target = { type: "pace", min_s: p, max_s: p };
  } else if (total !== null && total.clock && !dur && sport === "run") target = { type: "pace", min_s: total.s, max_s: total.s };
  else if (repTime) {
    const per = (s) => round((s * 1000) / repTime.m);
    target = repTime.b === null ? { type: "pace", min_s: per(repTime.a), max_s: per(repTime.a) } : { type: "pace", min_s: per(repTime.a), max_s: per(repTime.b) };
  } else if (power) target = power;
  else if (ftp) target = { type: "zone", metric: "power", zone: ftpZone((ftp.a + ftp.b) / 2) };
  else if (hr) target = hr;
  else if (zone) {
    target = { type: "zone", metric, zone: zone.a };
    if (zone.b !== null && zone.b !== zone.a && !progression) extraNotes.push(`Z${zone.a}–Z${zone.b}`);
  }
  else if (rpe) target = rpe;
  if (ftp) extraNotes.unshift(ftp.a === ftp.b ? `${fmtNum(ftp.a)}% do FTP` : `${fmtNum(ftp.a)}–${fmtNum(ftp.b)}% do FTP`);
  // Intensity words → PSE with the word as its label (never a zone: zones are what the coach writes as "Z4").
  if (!target) {
    let word = null;
    for (const [seq, v, label] of INTENSITY_PHRASES) {
      if (word) break;
      for (let i = 0; i + seq.length <= n; i++) if (seq.every((w, k) => W(at(i + k), w))) { claim(i, i + seq.length); word = [v, label]; break; }
    }
    for (const [ws, v, label] of [...INTENSITY_WORDS, ...INTENSITY_NOUNS]) if (!word && words((w) => ws.includes(w))) word = [v, label];
    if (!word) for (let i = 0; i < n; i++) if (W(at(i), "vo") && N(at(i + 1)) && toks[i + 1].v === 2) { claim(i, i + 2); word = [9, "VO2"]; break; }
    if (!word) for (let i = 0; i < n; i++) if (W(at(i), "tempo") && W(at(i + 1), "run")) { claim(i, i + 2); word = [7, "tempo run"]; break; }
    if (!word && toks.some(isJog)) word = [3, "trote"];
    if (!word && toks.some(isWalk)) word = [2, "caminhada"];
    if (word) target = { type: "rpe", value: word[0], label: word[1] };
  }

  const note = [...extraNotes, ...kwNotes, ...parenNotes];
  const hasDuration = dur !== null;
  const understood = hasDuration || target !== null || fromWord || stroke !== null || equipment.length > 0 || sendOff !== null || kwNotes.length > 0 || extraNotes.length > 0 || between !== null;
  const make = (duration, tgt) => {
    const st = { kind: "step", intent, duration, target: tgt };
    if (note.length) st.note = note.join("; ");
    if (stroke) st.stroke = stroke;
    if (equipment.length) st.equipment = [...equipment];
    if (sendOff !== null) st.send_off_s = sendOff;
    return st;
  };

  let steps = [make(dur ?? { type: "open" }, target ?? { type: "open" })];
  let expanded = false;
  if (progression && dur) {
    let targets = null;
    if (pace && pace.b !== null && total === null) {
      const a = pace.a, b = pace.b;
      targets = [0, 1, 2].map((k) => { const p = round(a + ((b - a) * k) / 2); return { type: "pace", min_s: p, max_s: p }; });
    } else if (zone && zone.b !== null && !pace && !power && !ftp && !hr) {
      const step = zone.b >= zone.a ? 1 : -1;
      targets = [];
      for (let z = zone.a; z !== zone.b + step; z += step) targets.push({ type: "zone", metric, zone: z });
    } else if (!target) targets = [2, 3, 4].map((z) => ({ type: "zone", metric: defaultMetric(sport), zone: z }));
    if (targets && targets.length > 1) {
      const parts = splitParts(dur, targets.length);
      steps = parts.map((d, k) => { const st = make(d, targets[k]); if (k > 0) delete st.note; return st; });
      expanded = true;
    }
  }
  const modifierOnly = !hasDuration && !fromWord && between === null && !progression && (target !== null || stroke !== null || equipment.length > 0 || sendOff !== null || note.length > 0);
  return { steps, understood, fromWord, between, modifierOnly, hasDuration, progression: expanded, total: expanded ? dur : null, leftovers: leftovers(toks, used) };
}

/** Fill the previous block's open fields from a modifier piece ("6x1km, ritmo de 4:30"). False on a conflict. */
function applyMods(step, mod) {
  if (mod.target.type !== "open") {
    if (step.target.type === "open") step.target = mod.target;
    else if (JSON.stringify(step.target) !== JSON.stringify(mod.target)) return false;
  }
  if (mod.note) step.note = step.note ? `${step.note}; ${mod.note}` : mod.note;
  if (mod.stroke && !step.stroke) step.stroke = mod.stroke;
  if (mod.equipment) step.equipment = EQUIPMENT.map(([, e]) => e).filter((e) => step.equipment?.includes(e) || mod.equipment.includes(e));
  if (mod.send_off_s !== undefined && step.send_off_s === undefined) step.send_off_s = mod.send_off_s;
  return true;
}
const mainStep = (b) => (b.kind === "repeat" ? (b.steps.find((s) => s.intent === "active") ?? b.steps[0]) : b);
/** A rest between series: replaces the last rest of a flattened inner repeat, else goes last. */
function attachSeries(steps, rest, lastFromInner) {
  if (lastFromInner && isRest(steps[steps.length - 1])) steps[steps.length - 1] = rest;
  else steps.push(rest);
}
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- repeats
/** A count before a repeat word at `i`: "6x", "15-20x", "15 a 20 tiros" → {count, max (or null), w (the word)}. */
function countAt(toks, i) {
  const t = toks[i];
  if (!INT(t) || t.v < 1 || t.v > 200) return null;
  const u = toks[i + 2];
  if ((P(toks[i + 1], "-") || W(toks[i + 1], "a")) && INT(u) && u.v >= 1 && u.v <= 200 && W(toks[i + 3], ...REPEAT_WORDS)) {
    const lo = Math.min(t.v, u.v), hi = Math.max(t.v, u.v);
    return { count: lo, max: hi > lo ? hi : null, w: i + 3 };
  }
  return W(toks[i + 1], ...REPEAT_WORDS) ? { count: t.v, max: null, w: i + 1 } : null;
}
/** "6x", "6 vezes", "seis tiros de", "3 séries de", "15-20x" at depth 0 → {i, count, max, j (body start)}. */
function findAnchor(toks) {
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (P(t, "(")) depth++;
    else if (P(t, ")")) depth = Math.max(0, depth - 1);
    const c = depth > 0 ? null : countAt(toks, i);
    if (!c) continue;
    let j = c.w + 1;
    if (W(toks[j], "de") && !W(toks[c.w], "x")) j++;
    if (j < toks.length) return { i, count: c.count, max: c.max, j };
  }
  return null;
}
/** A line that only opens a set ("3x", "15-20x", "3 séries:"): its lines follow → {count, max}. */
function repeatHeader(toks) {
  const c = countAt(toks, 0);
  if (!c) return null;
  let j = c.w + 1;
  while (P(toks[j], ":") || W(toks[j], "de")) j++;
  return j === toks.length ? { count: c.count, max: c.max } : null;
}
/** A word that says "recovery" on its own ("trote", "caminhando", "descanso", "parado"…). */
const recoveryWord = (x) => x.k === "word" && (x.low.startsWith("trot") || x.low.startsWith("caminh") || RECOVERY_WORDS.includes(x.low));
/** A word that says "easy" ("leve", "solto", "regenerativo") or an easy zone ("Z1", "Z2"). */
function easyAt(toks, k) {
  const x = toks[k];
  if (x === undefined || x.k !== "word") return false;
  if (W(x, "z", "zona")) return INT(toks[k + 1]) && toks[k + 1].v <= 2;
  return EASY_WORDS.includes(x.low);
}
/**
 * Where the recovery part of a repeat body starts, or -1: after a marker ("c/ 2' trote", "com 20\" de descanso",
 * "/ 1' leve", "- 2' trote"), or at a second amount followed by a recovery or easy word ("1' forte 1' leve", "15\" desc").
 */
function recoverySplit(body, sport) {
  const none = body.map(() => false);
  const hasAmount = (from) => { for (let k = from; k < body.length; k++) if (amountAt(body, none, k, sport, "recovery")) return true; return false; };
  let first = null;
  for (let k = 0; k < body.length; k++) { const a = amountAt(body, none, k, sport, "active"); if (a) { first = { ...a, at: k }; break; } }
  for (let j = 1; j < body.length; j++) {
    const t = body[j];
    const slash = P(t, "/") && first !== null && first.end <= j && !CLOCK(body[j - 1]) && !W(body[j - 1], "min") && amountAt(body, none, j + 1, sport, null) !== null;
    const marker = (W(t, "c") && P(body[j + 1], "/")) || W(t, ...RECOVERY_MARKERS) || slash;
    if (marker && (hasAmount(j) || body.slice(j + 1).some(recoveryWord))) return j;
  }
  if (!first) return -1;
  for (let k = first.end; k < body.length; k++) {
    if (!amountAt(body, none, k, sport, null)) continue;
    if (body.slice(k).some(recoveryWord) || body.some((_, i) => i >= k && easyAt(body, i))) return k;
    break;
  }
  return -1;
}

/** Inside "N x ( … )": steps in order; inner repeats are flattened (the structure has one level of repeats). */
function parseGroup(inner, sport, warnings) {
  return groupPieces(segment(inner), sport, warnings);
}
/** The pieces of a set (in parentheses, or the lines under a "3x" line) → its steps. */
function groupPieces(pieces, sport, warnings) {
  const steps = [];
  let nested = null, lastFromInner = false, others = 0;
  for (const p of pieces) {
    const r = parseRepeat(p.toks, sport);
    if (r) {
      if (r.type === "unknown" || steps.length + r.before.length + r.count * r.steps.length > MAX_REPEAT_STEPS) { warnings.push(textOf(p.toks)); continue; }
      warnings.push(...r.warnings);
      steps.push(...r.before);
      for (let k = 0; k < r.count; k++) steps.push(...r.steps.map(clone));
      nested = r.count;
      lastFromInner = isRest(steps[steps.length - 1]);
      continue;
    }
    const s = parseSteps(p.toks, sport, "active", "active");
    if (!s.understood) { warnings.push(textOf(p.toks)); continue; }
    warnings.push(...s.leftovers);
    if (s.between === "series") { attachSeries(steps, s.steps[0], lastFromInner); lastFromInner = false; continue; }
    const prev = steps[steps.length - 1];
    if (s.modifierOnly && p.sep === "soft" && prev) { if (!applyMods(prev, s.steps[0])) warnings.push(textOf(p.toks)); continue; }
    if (prev && prev.intent === "active" && !s.fromWord && s.steps.length === 1 && isEasy(s.steps[0]) && !(sport === "swim" && s.steps[0].duration.type === "distance")) s.steps[0].intent = restIntent(sport);
    steps.push(...s.steps);
    lastFromInner = false;
    others++;
  }
  return { steps, nested: others === 0 ? nested : null, lastFromInner };
}

/**
 * Alternating parts in one go: "100m (leve): 300m (3:50/km)", "2' caminhada: 4' corrida leve" → their steps in
 * order (each part one step with an amount); an easy part beside one that isn't easy is the recovery. Null when
 * there's no ":" between amounts or a part isn't one step.
 */
function colonParts(toks, sport) {
  const parts = [[]];
  let depth = 0;
  for (const t of toks) {
    if (P(t, "(")) depth++;
    else if (P(t, ")")) depth = Math.max(0, depth - 1);
    if (depth === 0 && P(t, ":")) parts.push([]);
    else parts[parts.length - 1].push(t);
  }
  if (parts.length < 2) return null;
  const none = (q) => q.map(() => false);
  const parsed = parts.map((q) => {
    const i = q.findIndex(numish);
    return i < 0 || !amountAt(q, none(q), i, sport, null) ? null : parseSteps(q, sport, "active", bareOf(q, sport));
  });
  if (parsed.some((r) => !r || !r.understood || r.steps.length !== 1 || !r.hasDuration || r.progression || r.between)) return null;
  const steps = parsed.map((r) => r.steps[0]);
  if (steps.some((st) => !isEasy(st) && !isRest(st))) for (const [k, st] of steps.entries()) if (!parsed[k].fromWord && st.intent === "active" && isEasy(st)) st.intent = restIntent(sport);
  return { steps, warnings: parsed.flatMap((r) => r.leftovers) };
}
const colonRound = (body, sport) => (body.some((t) => P(t, ":")) ? colonParts(body, sport) : null);

/** A repeat piece → {type: "repeat", count, max, steps, before, nested, lastFromInner, warnings}, {type: "unknown"} or null (no "N x"). */
function parseRepeat(toks, sport) {
  const an = findAnchor(toks);
  if (!an) return null;
  const warnings = [], before = [];
  let prefix = toks.slice(0, an.i);
  const body = toks.slice(an.j);
  if (prefix.some(numish)) {
    const p = parseSteps(prefix, sport, "active", sport === "swim" ? "active" : null);
    if (p.understood) { before.push(...p.steps); warnings.push(...p.leftovers); }
    else warnings.push(textOf(prefix));
    prefix = [];
  }
  let steps, nested = null, lastFromInner = false;
  if (P(body[0], "(")) {
    let d = 0, k = 0;
    for (; k < body.length; k++) {
      if (P(body[k], "(")) d++;
      else if (P(body[k], ")") && --d === 0) break;
    }
    const g = parseGroup(body.slice(1, k), sport, warnings);
    ({ steps, nested, lastFromInner } = g);
    const trailing = body.slice(k + 1);
    if (trailing.length && steps.length) {
      const r = parseSteps(trailing, sport, restIntent(sport), "recovery");
      if (r.understood && r.hasDuration) { attachSeries(steps, r.steps[0], lastFromInner); lastFromInner = false; warnings.push(...r.leftovers); }
      else if (r.understood && r.modifierOnly) { if (!applyMods(mainStep({ kind: "repeat", steps }), r.steps[0])) warnings.push(textOf(trailing)); else warnings.push(...r.leftovers); }
      else warnings.push(textOf(trailing));
    }
  } else {
    const inner = findAnchor(body);
    if (inner && inner.i === 0) {
      const r = parseRepeat(body, sport);
      if (r.type === "unknown" || r.count * r.steps.length > MAX_REPEAT_STEPS) return { type: "unknown" };
      warnings.push(...r.warnings);
      steps = [];
      for (let k = 0; k < r.count; k++) steps.push(...r.steps.map(clone));
      nested = r.count;
      lastFromInner = isRest(steps[steps.length - 1]);
    } else if (colonRound(body, sport)) {
      // A label before the count ("Tiros: 11x 100m (leve): 300m") isn't a part of the round: without it, then.
      const c = colonRound([...prefix, ...body], sport) ?? colonRound(body, sport);
      steps = c.steps;
      warnings.push(...c.warnings);
    } else {
      const split = recoverySplit(body, sport);
      const a = parseSteps([...prefix, ...(split < 0 ? body : body.slice(0, split))], sport, "active", "active");
      if (!a.understood) return { type: "unknown" };
      steps = [...a.steps];
      warnings.push(...a.leftovers);
      if (split >= 0) {
        const r = parseSteps(body.slice(split), sport, restIntent(sport), "recovery");
        if (r.understood) { steps.push(...r.steps); warnings.push(...r.leftovers); }
        else warnings.push(textOf(body.slice(split)));
      }
    }
  }
  if (!steps.length || steps.length > MAX_REPEAT_STEPS) return { type: "unknown" };
  return { type: "repeat", count: an.count, max: an.max, steps, before, nested, lastFromInner, warnings };
}

// ---------------------------------------------------------------- sets written over several lines
/**
 * One part of a "Desc." line → its step, or null. A time alone is a rest ("1'30""); a distance, or an intensity word,
 * makes it an active recovery ("200m Trote": 200 m of jogging); a word can also say it ("1' parado", "2' trote").
 */
function descPart(toks, sport) {
  const none = toks.map(() => false);
  if (!toks.length || !amountAt(toks, none, 0, sport, "recovery")) return null;
  const s = parseSteps(toks, sport, "rest", "recovery");
  const st = s.steps[0];
  if (!s.understood || s.steps.length !== 1 || !s.hasDuration || s.leftovers.length || s.between || s.progression) return null;
  if (!s.fromWord) st.intent = st.duration.type === "distance" || st.target.type !== "open" ? restIntent(sport) : "rest";
  return st.intent === "rest" || st.intent === "recovery" ? st : null;
}
/** "Desc. 1'30" & 3'", "Desc 1min", "Desc. 200m Trote": {a (after each run), b (after the set, or null)}, or null. */
function descLine(toks, sport) {
  if (!W(toks[0], ...DESC_WORDS)) return null;
  let i = 1;
  while (P(toks[i], ".") || P(toks[i], ":") || W(toks[i], "de")) i++;
  const amp = toks.findIndex((t, k) => k >= i && P(t, "&"));
  const a = descPart(toks.slice(i, amp < 0 ? toks.length : amp), sport);
  const b = amp < 0 ? null : descPart(toks.slice(amp + 1), sport);
  return a && (amp < 0 || b) ? { a, b } : null;
}
const restStep = (st) => clone(st);
/**
 * A rest after each run of a set (a step without a rest after it), and the set's own rest last: B replaces the
 * last A ("Desc. 1' & 2'"). Nothing to insert: the rest goes last. Null when the set would get too long.
 */
function applyDesc(steps, d) {
  const out = [];
  let inserted = false, lastInserted = false;
  steps.forEach((s, k) => {
    out.push(s);
    lastInserted = false;
    if (!isRest(s) && !isRest(steps[k + 1])) { out.push(restStep(d.a)); inserted = lastInserted = true; }
  });
  const tail = d.b ?? (inserted ? null : d.a);
  if (tail) { if (lastInserted) out[out.length - 1] = restStep(tail); else out.push(restStep(tail)); }
  return out.length > MAX_REPEAT_STEPS ? null : out;
}
/** An easy step after the main work is the cool-down: an easy target (PSE ≤ 3, Z1–Z2), a recovery or a cool-down. */
const easyStep = (s) => s.kind === "step" && (s.intent === "cooldown" || s.intent === "recovery" || (s.intent === "active" && s.target.type !== "open" && isEasy(s)));
/** A bare number is pool meters, or (with a recovery word: "/ 200 trote") a recovery amount. */
const bareOf = (toks, sport) => (sport === "swim" ? "active" : toks.some(recoveryWord) ? "recovery" : null);
/** A line that is one easy step ("5' leve", "3' andando") → that step, else null. */
function easyLine(toks, sport) {
  if (findAnchor(toks) || repeatHeader(toks) || descLine(toks, sport)) return null;
  const s = parseSteps(toks, sport, "active", bareOf(toks, sport));
  return s.understood && s.steps.length === 1 && easyStep(s.steps[0]) ? s.steps[0] : null;
}
/** Short enough to be a set's recovery: up to 5 min or 1 km, and not a cool-down word. */
const shortEasy = (s) => s !== null && s.intent !== "cooldown" && ((s.duration.type === "time" && s.duration.s <= 300) || (s.duration.type === "distance" && s.duration.m <= 1000));
/** The amount of the steps when they all have the type of `total` (else null). */
function stepsAmount(steps, type) {
  let sum = 0;
  for (const s of steps) {
    if (s.duration.type !== type) return null;
    sum += type === "distance" ? s.duration.m : s.duration.s;
  }
  return sum;
}
/**
 * A named block with a total ("Fartlek 28min", "Cruise Interval 51min"): a line with only words and one amount,
 * no target, no intent word → {name, total}, or null. It only counts when the lines after it fill the total.
 */
function namedHeader(toks, sport) {
  if (findAnchor(toks) || repeatHeader(toks) || descLine(toks, sport)) return null;
  const s = parseSteps(toks, sport, "active", null);
  const st = s.steps[0];
  if (!s.understood || s.steps.length !== 1 || s.fromWord || s.between || s.progression || !s.hasDuration || s.leftovers.length) return null;
  if (st.intent !== "active" || st.target.type !== "open" || st.duration.type === "open" || st.note || st.stroke || st.equipment || st.send_off_s !== undefined) return null;
  if (st.duration.max_s !== undefined || st.duration.max_m !== undefined) return null;
  const none = toks.map(() => false);
  for (let i = 0; i < toks.length; i++) {
    const a = amountAt(toks, none, i, sport, null);
    if (!a) continue;
    const rest = trimName([...toks.slice(0, i), ...toks.slice(a.end)]);
    if (!rest.some((t) => t.k === "word") || rest.some(numish)) return null;
    return { name: textOf(rest), total: st.duration };
  }
  return null;
}
/**
 * At a named header (pieces[k]): its block, when the lines after it fill its total. Either a "7x" line and the
 * lines that fit (count × their sum ≤ total, stopping when it's reached), or one alternating pair "2' limiar / 1'
 * trote" repeated as often as it fits. → {block, meta, warnings, end (the next piece)} or null.
 */
function namedBlock(pieces, k, sport) {
  const hdr = namedHeader(pieces[k].toks, sport);
  const next = pieces[k + 1];
  if (!hdr || !next || next.sep !== "hard") return null;
  const type = hdr.total.type, total = type === "distance" ? hdr.total.m : hdr.total.s;
  const rh = repeatHeader(next.toks);
  const inline = rh ? null : parseRepeat(next.toks, sport);
  if (inline && inline.type === "repeat") {
    // "Fartlek 28min" + "7x(3' + 1')": the repeat on the next line, when it makes the total.
    const sum = stepsAmount(inline.steps, type);
    if (inline.before.length || !sum || inline.count * sum !== total) return null;
    const block = { kind: "repeat", count: inline.count, ...(inline.max !== null && { max_count: inline.max }), note: hdr.name, steps: inline.steps };
    return { block, meta: { nested: inline.nested, lastFromInner: inline.lastFromInner, set: false }, warnings: inline.warnings, end: k + 2, named: hdr };
  }
  if (rh) {
    let best = null;
    for (let e = k + 2; e < pieces.length; e++) {
      const p = pieces[e];
      if (repeatHeader(p.toks) || descLine(p.toks, sport)) break;
      const ws = [];
      const g = groupPieces(pieces.slice(k + 2, e + 1), sport, ws);
      const sum = stepsAmount(g.steps, type);
      if (!g.steps.length || sum === null || rh.count * sum > total) break;
      best = { g, ws, end: e + 1 };
      if (rh.count * sum === total) break;
    }
    if (!best) return null;
    const block = { kind: "repeat", count: rh.count, ...(rh.max !== null && { max_count: rh.max }), note: hdr.name, steps: best.g.steps };
    return { block, meta: { nested: best.g.nested, lastFromInner: best.g.lastFromInner, set: true }, warnings: best.ws, end: best.end, named: hdr };
  }
  const second = pieces[k + 2], after = pieces[k + 3];
  if (!second || second.sep !== "soft" || (after && after.sep !== "hard")) return null;
  const pair = [next, second].map((p) => (findAnchor(p.toks) || descLine(p.toks, sport) ? null : parseSteps(p.toks, sport, "active", bareOf(p.toks, sport))));
  if (pair.some((s) => !s || !s.understood || s.steps.length !== 1 || s.progression)) return null;
  const [a, b] = pair.map((s) => s.steps[0]);
  const sum = stepsAmount([a, b], type);
  if (!sum || isRest(a)) return null;
  const count = Math.floor(total / sum);
  if (count < 1 || count > 200) return null;
  if (!pair[1].fromWord && b.intent === "active" && isEasy(b)) b.intent = restIntent(sport);
  const block = { kind: "repeat", count, note: hdr.name, steps: [a, b] };
  return { block, meta: { nested: null, lastFromInner: false, set: false }, warnings: [...pair[0].leftovers, ...pair[1].leftovers], end: k + 3, named: hdr };
}
/**
 * At a "3x" line (pieces[k]): the set is the lines below it, up to a "Desc." line (which gives its rests), else up
 * to the next "3x" line, else to the end of the text minus the trailing easy lines (the cool-down).
 * → {block or steps, meta, warnings, end} or null (nothing under it).
 */
function headerSet(pieces, k, sport) {
  const hdr = repeatHeader(pieces[k].toks);
  let d = -1, stop = pieces.length;
  for (let e = k + 1; e < pieces.length; e++) {
    if (repeatHeader(pieces[e].toks)) { stop = e; break; }
    // A "Desc." line closes the set; a pause beside a run ("400m | p: 1'") is that run's rest.
    if (pieces[e].sep === "hard" && descLine(pieces[e].toks, sport)) { d = e; break; }
  }
  let end = d >= 0 ? d : stop;
  if (d < 0 && stop === pieces.length) {
    while (end > k + 1 && easyLine(pieces[end - 1].toks, sport)) end--;
    // More than one easy line: the first one, when short, is the set's recovery ("1km forte / 2' trote / 10' desaq").
    if (stop - end >= 2 && shortEasy(easyLine(pieces[end].toks, sport))) end++;
  }
  if (end === k + 1) return null;
  const warnings = [];
  const g = groupPieces(pieces.slice(k + 1, end), sport, warnings);
  if (!g.steps.length) return null;
  let steps = g.steps, next = end;
  if (d >= 0) {
    const withRest = applyDesc(steps, descLine(pieces[d].toks, sport));
    if (withRest) steps = withRest;
    else warnings.push(textOf(pieces[d].toks));
    next = d + 1;
  }
  const meta = { nested: g.nested, lastFromInner: g.lastFromInner && d < 0, set: true };
  if (hdr.count === 1 && hdr.max === null) return { steps, warnings, end: next };
  return { block: { kind: "repeat", count: hdr.count, ...(hdr.max !== null && { max_count: hdr.max }), steps }, meta, warnings, end: next };
}

/**
 * "3x-600m | p: 1'30"" + "400m | p: 1'" + "200m | P: 1'": a count tied to the first run by "-" opens a set over the
 * lines below it, like a "3x" line above them → the count as its own piece and the run as the set's first line.
 */
function dashSets(pieces) {
  const out = [];
  for (const p of pieces) {
    const c = p.sep === "hard" ? countAt(p.toks, 0) : null;
    if (c && P(p.toks[c.w + 1], "-") && c.w + 2 < p.toks.length && numish(p.toks[c.w + 2])) {
      out.push({ toks: p.toks.slice(0, c.w + 1), sep: "hard" }, { toks: p.toks.slice(c.w + 2), sep: "hard" });
    } else out.push(p);
  }
  return out;
}

const RUN_ZONE_PACE = { 1: 390, 2: 345, 3: 310, 4: 285, 5: 260 }; // s/km, the estimates' generic athlete (domain/workout.ts)
/** Meters a run step covers: its distance, or its time at its pace (else the zone's generic pace). */
function stepMeters(st) {
  if (st.duration.type === "distance") return st.duration.m;
  const t = st.target;
  const pace = t.type === "pace" ? (t.min_s + t.max_s) / 2 : RUN_ZONE_PACE[zoneOf(t)];
  return (st.duration.s * 1000) / pace;
}
/**
 * A total and an alternating pair on one line: "3.5km 2' caminhada: 4' corrida leve", "4.5km - 3' (4:35/km) : 5'
 * (4:18/km)", "40' - 3' forte : 2' leve" → the pair repeated to cover the total. Same unit: as often as it fits. A
 * distance of timed parts (runs): as many rounds as it takes at their paces (written, else the zones' generic
 * ones), repeated until the distance (`until_m`; count = the rounds that cover it). → {block, warnings, end, named} or null.
 */
function totalPair(pieces, k, sport) {
  const p = pieces[k];
  if (p.sep !== "hard" || findAnchor(p.toks) || repeatHeader(p.toks)) return null;
  const tot = amountAt(p.toks, p.toks.map(() => false), 0, sport, null);
  if (!tot || (tot.dur.type !== "distance" && tot.dur.type !== "time") || tot.dur.max_s !== undefined || tot.dur.max_m !== undefined) return null;
  const restToks = p.toks.slice(tot.end);
  const parts = restToks.length ? [restToks, pieces[k + 1]?.toks] : [pieces[k + 1]?.toks, pieces[k + 2]?.toks];
  const end = restToks.length ? k + 2 : k + 3;
  if (parts.some((q) => !q) || pieces.slice(k + 1, end).some((q) => q.sep !== "soft") || (pieces[end] && pieces[end].sep !== "hard")) return null;
  const pair = parts.map((q) => (numish(q[0]) && amountAt(q, q.map(() => false), 0, sport, null) ? parseSteps(q, sport, "active", bareOf(q, sport)) : null));
  if (pair.some((r) => !r || !r.understood || r.steps.length !== 1 || !r.hasDuration || r.progression || r.between)) return null;
  const [a, b] = pair.map((r) => r.steps[0]);
  if (isRest(a) && isRest(b)) return null;
  const type = tot.dur.type, total = type === "distance" ? tot.dur.m : tot.dur.s;
  const same = stepsAmount([a, b], type);
  let count, until;
  if (same) count = Math.floor(total / same);
  else if (type === "distance" && sport === "run" && a.duration.type === "time" && b.duration.type === "time") {
    count = Math.ceil(total / (stepMeters(a) + stepMeters(b)) - 1e-9);
    until = total;
  } else return null;
  if (count < 1 || count > 200) return null;
  // An easy part beside a harder one is its recovery ("40' - 3' forte : 2' leve"); a walk already is.
  for (const [i, st] of [a, b].entries()) if (!pair[i].fromWord && st.intent === "active" && isEasy(st) && !isEasy([a, b][1 - i]) && !isRest([a, b][1 - i])) st.intent = restIntent(sport);
  const walk = [a, b].some((st) => st.target.type === "rpe" && st.target.label === "caminhada");
  return {
    block: { kind: "repeat", count, ...(until !== undefined && { until_m: until }), steps: [a, b] },
    warnings: [...pair[0].leftovers, ...pair[1].leftovers],
    end,
    named: { name: walk ? "Caminhada e corrida" : "Fartlek", total: tot.dur },
  };
}

// ---------------------------------------------------------------- exercises (strength, mobility)
function trimName(toks) {
  let a = 0, b = toks.length;
  for (;;) {
    if (a < b && toks[a].k === "p") a++;
    else if (a + 1 < b && N(toks[a]) && (P(toks[a + 1], ".") || P(toks[a + 1], ")") || P(toks[a + 1], "-"))) a += 2;
    else if (a < b && W(toks[a], ...LEAD_FILLERS)) a++;
    else break;
  }
  while (b > a && (toks[b - 1].k === "p" || W(toks[b - 1], ...TRAIL_FILLERS))) b--;
  return toks.slice(a, b);
}
/** Rest after "desc", "descanso"…: 90" / 1'30 / 2 min / 1:30; a bare number is seconds (minutes up to 5). */
function restAt(toks, used, i, bareOk) {
  const at = (j) => (used[j] ? undefined : toks[j]);
  const t = at(i);
  if (CLOCK(t)) return { s: t.v, end: i + 1 };
  if (!N(t)) return null;
  const u = at(i + 1);
  if (P(u, "'") || W(u, ...MINUTES)) {
    let s = t.v * 60, end = i + 2;
    if (INT(at(end)) && at(end).v < 60 && (!at(end).sp || P(at(end + 1), '"') || W(at(end + 1), ...SECONDS))) { s += at(end).v; end += P(at(end + 1), '"') || W(at(end + 1), ...SECONDS) ? 2 : 1; }
    return round(s) <= MAX_AMOUNT ? { s: round(s), end } : null;
  }
  if (P(u, '"') || W(u, ...SECONDS)) return round(t.v) <= MAX_AMOUNT ? { s: round(t.v), end: i + 2 } : null;
  if (!bareOk) return null;
  const s = round(t.v <= 5 ? t.v * 60 : t.v);
  return s <= MAX_AMOUNT ? { s, end: i + 1 } : null;
}
/** Load, rest, tempo and notes of an exercise. `all`: nothing else in the tokens (a piece that only adds to the previous exercise). */
function parseAttrs(toks0) {
  const { toks, notes: parenNotes } = takeParens(toks0);
  const used = toks.map(() => false);
  const at = (j) => (used[j] ? undefined : toks[j]);
  const claim = (a, b) => { for (let k = a; k < b; k++) used[k] = true; };
  const n = toks.length;
  let load = null, rest = null, tempo = null;
  const notes = [];
  for (let i = 0; i < n && !load; i++) {
    if (!N(at(i))) continue;
    let j = i + 1;
    if (rangeConn(at(j)) && N(at(j + 1))) j += 2;
    if (W(at(j), ...KG)) { claim(i, j + 1); load = { type: "kg", value: toks[i].v }; break; }
    if (!P(at(j), "%")) continue;
    j++;
    while (W(at(j), "de", "do", "da")) j++;
    if (N(at(j)) && toks[j].v === 1 && W(at(j + 1), "rm")) j += 2;
    else if (W(at(j), "rm")) j++;
    claim(i, j);
    load = { type: "pct_1rm", value: toks[i].v };
  }
  for (let i = 0; i < n && !load; i++) {
    if (W(at(i), "pse", "rpe") && N(at(i + 1))) { claim(i, i + 2); load = { type: "rpe", value: toks[i + 1].v }; }
    else if (W(at(i), "pc", "bodyweight")) { claim(i, i + 1); load = { type: "bodyweight" }; }
    else if (W(at(i), "peso") && W(at(i + 1), "corporal")) { claim(i, i + 2); load = { type: "bodyweight" }; }
    else if (W(at(i), "peso") && W(at(i + 1), "do") && W(at(i + 2), "corpo")) { claim(i, i + 3); load = { type: "bodyweight" }; }
    else if (W(at(i), "sem") && W(at(i + 1), "carga", "peso")) { claim(i, i + 2); load = { type: "bodyweight" }; }
  }
  for (let i = 0; i < n && rest === null; i++) {
    if (W(at(i), ...REST_WORDS)) {
      let j = i + 1;
      while (W(at(j), "de") || P(at(j), ":")) j++;
      const r = restAt(toks, used, j, true);
      if (r) { claim(i, r.end); rest = r.s; }
      continue;
    }
    const r = restAt(toks, used, i, false);
    if (!r) continue;
    const k = W(at(r.end), "de") ? r.end + 1 : r.end;
    if (W(at(k), "descanso", "intervalo", "pausa", "desc")) { claim(i, k + 1); rest = r.s; }
  }
  for (let i = 0; i < n && !tempo; i++) {
    if (!W(at(i), "tempo", "cadência", "cadencia")) continue;
    let j = i + 1;
    if (P(at(j), ":")) j++;
    if (!N(at(j))) continue;
    let k = j + 1;
    while (P(at(k), "-") && N(at(k + 1))) k += 2;
    tempo = textOf(toks.slice(j, k));
    claim(i, k);
  }
  for (let i = 0; i < n; i++) {
    if (W(at(i), "cada") && at(i + 1)?.k === "word") { notes.push(`cada ${toks[i + 1].low}`); claim(i, i + 2); }
    else if (W(at(i), "por") && W(at(i + 1), ...SIDE_WORDS)) { notes.push(`por ${toks[i + 1].low}`); claim(i, i + 2); }
    else if (W(at(i), "unilateral")) { notes.push("unilateral"); claim(i, i + 1); }
  }
  const found = load !== null || rest !== null || tempo !== null || notes.length > 0;
  const all = toks.every((t, i) => used[i] || t.k === "p" || W(t, ...ATTR_FILLERS));
  return { load, rest_s: rest, tempo, notes: [...notes, ...parenNotes], found, all, leftovers: leftovers(toks, used) };
}
/** "Agachamento 4x8 70% desc 90\"", "4 séries de 10 supino", "Prancha 3x45s pc" → exercise, or null. */
function parseExercise(toks0) {
  const toks = toks0;
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    if (P(toks[i], "(")) depth++;
    else if (P(toks[i], ")")) depth = Math.max(0, depth - 1);
    if (depth > 0 || !INT(toks[i]) || toks[i].v < 1 || toks[i].v > 50) continue;
    let j = i + 1;
    if (W(toks[j], "x")) j++;
    else if (W(toks[j], ...SETS_WORDS)) { j++; if (W(toks[j], "de")) j++; }
    else continue;
    let reps, end;
    const r = toks[j];
    if (W(r, "máx", "max", "máximo", "maximo", "falha")) { reps = "máx"; end = j + 1; }
    else if (INT(r) && r.v <= 1000) {
      reps = String(r.v);
      end = j + 1;
      if ((P(toks[end], "-") || W(toks[end], "a")) && INT(toks[end + 1]) && toks[end + 1].v <= 1000 && !W(toks[end + 2], ...KG) && !P(toks[end + 2], "%")) { reps += "-" + toks[end + 1].v; end += 2; }
      if (P(toks[end], '"') || W(toks[end], ...SECONDS)) { reps += " s"; end++; }
      else if (P(toks[end], "'") || W(toks[end], ...MINUTES)) { reps += " min"; end++; }
      else if (W(toks[end], ...REPS_WORDS)) end++;
    } else continue;
    let name = trimName(toks.slice(0, i)), after = toks.slice(end);
    if (!name.length) {
      let k = 0;
      while (k < after.length && after[k].k === "word" && !ATTR_WORDS.includes(after[k].low)) k++;
      name = trimName(after.slice(0, k));
      after = after.slice(k);
    }
    if (!name.length) return null;
    const text = textOf(name);
    const at = parseAttrs(after);
    const ex = { kind: "exercise", name: text.charAt(0).toUpperCase() + text.slice(1), sets: toks[i].v, reps };
    if (at.load) ex.load = at.load;
    if (at.rest_s !== null) ex.rest_s = at.rest_s;
    if (at.tempo) ex.tempo = at.tempo;
    if (at.notes.length) ex.note = at.notes.join("; ");
    return { ex, leftovers: at.leftovers };
  }
  return null;
}
function mergeAttrs(ex, at) {
  if (at.load && !ex.load) ex.load = at.load;
  if (at.rest_s !== null && ex.rest_s === undefined) ex.rest_s = at.rest_s;
  if (at.tempo && !ex.tempo) ex.tempo = at.tempo;
  if (at.notes.length) ex.note = [ex.note, ...at.notes].filter(Boolean).join("; ");
}

// ---------------------------------------------------------------- the workout
function assemble(pieces, sport, warnings, hints) {
  const blocks = [], meta = [];
  const strengthLike = sport === "strength" || sport === "mobility";
  for (let k = 0; k < pieces.length; k++) {
    const piece = pieces[k];
    const text = textOf(piece.toks);
    const last = blocks[blocks.length - 1], lastMeta = meta[meta.length - 1];
    if (strengthLike) {
      const e = parseExercise(piece.toks);
      if (e) { blocks.push(e.ex); meta.push({}); warnings.push(...e.leftovers); continue; }
      const at = parseAttrs(piece.toks);
      if (at.found && at.all) {
        if (piece.sep === "soft" && last?.kind === "exercise") mergeAttrs(last, at);
        else warnings.push(text);
        continue;
      }
    } else {
      // A total and an alternating pair: "4.5km - 3' (4:35/km) : 5' (4:18/km)".
      const tp = totalPair(pieces, k, sport);
      if (tp) {
        warnings.push(...tp.warnings);
        blocks.push(tp.block);
        meta.push({ nested: null, lastFromInner: false, set: false });
        if (!hints.named) hints.named = tp.named;
        k = tp.end - 1;
        continue;
      }
      // Sets over several lines: "Fartlek 28min" + "7x" + lines, "3x" + lines + "Desc. 1' & 2'".
      const nb = namedBlock(pieces, k, sport);
      if (nb) {
        warnings.push(...nb.warnings);
        blocks.push(nb.block);
        meta.push(nb.meta);
        if (!hints.named) hints.named = nb.named;
        k = nb.end - 1;
        continue;
      }
      const hs = repeatHeader(piece.toks) ? headerSet(pieces, k, sport) : null;
      if (hs) {
        warnings.push(...hs.warnings);
        if (hs.block) { blocks.push(hs.block); meta.push(hs.meta); }
        else for (const st of hs.steps) { blocks.push(st); meta.push({}); }
        k = hs.end - 1;
        continue;
      }
      // "4x4x150m" + "Desc. 1'30" & 2'30"": the rests of the repeat above (when it has none).
      const dl = descLine(piece.toks, sport);
      if (dl && last?.kind === "repeat" && !last.steps.some(isRest)) {
        const withRest = applyDesc(last.steps, dl);
        if (withRest) { last.steps = withRest; lastMeta.lastFromInner = false; continue; }
      }
      const r = parseRepeat(piece.toks, sport);
      if (r && r.type === "unknown") { warnings.push(text); continue; }
      if (r) {
        warnings.push(...r.warnings);
        for (const st of r.before) { blocks.push(st); meta.push({}); }
        if (r.count === 1 && r.max === null) for (const st of r.steps) { blocks.push(st); meta.push({}); }
        else { blocks.push({ kind: "repeat", count: r.count, ...(r.max !== null && { max_count: r.max }), steps: r.steps }); meta.push({ nested: r.nested, lastFromInner: r.lastFromInner }); }
        continue;
      }
    }
    const s = parseSteps(piece.toks, sport, "active", bareOf(piece.toks, sport));
    if (!s.understood) { warnings.push(text); continue; }
    warnings.push(...s.leftovers);
    if (s.between === "series" && last?.kind === "repeat") { attachSeries(last.steps, s.steps[0], lastMeta.lastFromInner); lastMeta.lastFromInner = false; continue; }
    if (s.steps.length === 1 && isRest(s.steps[0]) && (s.fromWord || s.between) && last?.kind === "repeat" && !last.steps.some(isRest) && (piece.sep === "soft" || s.between === "reps")) { last.steps.push(s.steps[0]); continue; }
    // "10x1' forte, 1' leve": a short easy piece right after a repeat without a rest is the repeat's recovery.
    if (s.steps.length === 1 && !s.fromWord && piece.sep === "soft" && last?.kind === "repeat" && last.steps.length === 1 && !isEasy(last.steps[0]) && shortRecovery(s.steps[0], sport)) { s.steps[0].intent = restIntent(sport); last.steps.push(s.steps[0]); continue; }
    if (s.modifierOnly && piece.sep === "soft" && last && last.kind !== "exercise") { if (!applyMods(mainStep(last), s.steps[0])) warnings.push(text); continue; }
    if (s.progression && !hints.progression) hints.progression = s.total;
    for (const st of s.steps) { blocks.push(st); meta.push({}); }
  }
  if (!strengthLike) coolDown(blocks);
  return { blocks, meta };
}
/** The easy steps after the main work (a repeat, or an active step that isn't easy) are the cool-down. */
function coolDown(blocks) {
  let k = blocks.length;
  while (k > 0 && easyStep(blocks[k - 1])) k--;
  if (!blocks.slice(0, k).some((b) => b.kind === "repeat" || (b.kind === "step" && b.intent === "active" && !easyStep(b)))) return;
  for (let i = k; i < blocks.length; i++) blocks[i].intent = "cooldown";
}

function oneAmount(type, v) {
  if (type === "distance") return v >= 1000 ? `${String(v / 1000).replace(".", ",")} km` : `${v} m`;
  if (v < 60) return `${v}"`;
  if (v < 3600) return v % 60 === 0 ? `${v / 60}'` : `${Math.floor(v / 60)}'${String(v % 60).padStart(2, "0")}"`;
  const m = Math.floor((v % 3600) / 60);
  return `${Math.floor(v / 3600)}h${m ? String(m).padStart(2, "0") : ""}`;
}
/** "8 km", "1h20", "30'"; a range shares its unit: "60–80 m", "30–40'", "800 m–1 km". */
function amountText(d) {
  if (d.type !== "distance" && d.type !== "time") return "";
  const a = oneAmount(d.type, d.type === "distance" ? d.m : d.s), max = d.type === "distance" ? d.max_m : d.max_s;
  if (max === undefined) return a;
  const b = oneAmount(d.type, max);
  for (const u of [" km", " m", "'", '"']) {
    const head = a.slice(0, a.length - u.length);
    if (a.endsWith(u) && b.endsWith(u) && head.length > 0 && [...head].every((c) => isDigit(c) || c === ",")) return `${head}–${b}`;
  }
  return `${a}–${b}`;
}
const volume = (d) => (d.type === "distance" ? d.m : d.type === "time" ? d.s * 3 : 0);
/** How hard a target is, to spot progressions (comparable only within one target type). */
const level = (t) => (t.type === "zone" ? t.zone : t.type === "rpe" ? t.value : t.type === "pace" ? -(t.min_s + t.max_s) : t.type === "hr" || t.type === "power" ? t.min + t.max : null);
const zoneOf = (t) => (t.type === "zone" ? t.zone : t.type === "rpe" ? (t.value >= 9 ? 5 : t.value >= 7 ? 4 : t.value >= 5 ? 3 : t.value >= 3 ? 2 : 1) : 3);
/**
 * A natural pt-BR name: "Intervalado 6×800 m", "Rodagem 8 km", "Séries 10×100 m", "Progressivo 10 km",
 * "Força: Agachamento + Remada". The biggest part names the workout (a repeat's volume against the longest step).
 */
function nameOf(blocks, meta, sport, hints) {
  const exercises = blocks.filter((b) => b.kind === "exercise");
  if (exercises.length) {
    const label = sport === "mobility" ? "Mobilidade" : "Força", names = exercises.slice(0, 2).map((e) => e.name).join(" + ");
    return names.toLowerCase().startsWith(label.toLowerCase()) ? names : `${label}: ${names}`;
  }
  if (hints.progression) return `Progressivo ${amountText(hints.progression)}`;
  if (hints.named) return `${hints.named.name} ${amountText(hints.named.total)}`;
  const actives = blocks.filter((b) => b.kind === "step" && b.intent === "active");
  let main = null;
  for (const a of actives) if (main === null || volume(a.duration) > volume(main.duration)) main = a;
  let best = -1, bestVol = -1;
  blocks.forEach((b, i) => {
    if (b.kind !== "repeat") return;
    const vol = b.count * b.steps.filter((s) => s.intent === "active").reduce((x, s) => x + volume(s.duration), 0);
    if (vol > bestVol) { best = i; bestVol = vol; }
  });
  if (best >= 0 && (main === null || bestVol >= volume(main.duration))) {
    const r = blocks[best], a = mainStep(r), inner = meta[best].nested;
    const label = sport === "swim" ? "Séries" : hints.fartlek ? "Fartlek" : "Intervalado";
    const count = r.max_count === undefined ? `${r.count}` : `${r.count}–${r.max_count}`;
    // A set written over several lines with different runs: named by what each round adds up to ("3×1,5 km").
    const runs = r.steps.filter((s) => s.intent === "active");
    const sum = runs.length > 1 ? stepsAmount(runs, a.duration.type) : null;
    if (meta[best].set && !inner && sum) return `${label} ${count}×${amountText(a.duration.type === "distance" ? { type: "distance", m: sum } : { type: "time", s: sum })}`;
    return `${label} ${count}×${inner ? `(${inner}×${amountText(a.duration)})` : amountText(a.duration)}`;
  }
  if (main === null) {
    const any = blocks.find((b) => b.kind === "step");
    if (!any) return "Treino";
    return `${any.target.type === "rpe" && any.target.label === "caminhada" ? "Caminhada" : "Treino"} ${amountText(any.duration)}`.trim();
  }
  // Several parts and none of them most of the work: the whole ("Progressivo 15 km" when each is harder).
  const sum = actives.reduce((x, a) => x + volume(a.duration), 0);
  if (actives.length > 1 && sum > 0 && volume(main.duration) * 5 <= sum * 3 && actives.every((a) => a.duration.type === main.duration.type)) {
    const total = main.duration.type === "distance" ? { type: "distance", m: sum } : { type: "time", s: sum / 3 };
    const t0 = actives[0].target;
    const rising = level(t0) !== null && actives.every((a, i) => i === 0 || (a.target.type === t0.type && level(a.target) > level(actives[i - 1].target)));
    const label = rising ? "Progressivo" : sport === "run" ? "Corrida" : sport === "bike" ? "Pedal" : sport === "swim" ? "Natação" : sport === "mobility" ? "Mobilidade" : "Treino";
    return `${label} ${amountText(total)}`.trim();
  }
  const z = zoneOf(main.target);
  const long = (main.duration.type === "distance" && main.duration.m >= 16000) || (main.duration.type === "time" && main.duration.s >= 5400);
  const label =
    hints.progressive && sport !== "mobility" && sport !== "other" ? "Progressivo"
    : sport === "swim" ? "Nado contínuo"
    : sport === "bike" ? (z <= 1 ? "Pedal regenerativo" : z === 2 ? "Pedal leve" : z === 3 ? "Pedal moderado" : "Pedal forte")
    : sport === "mobility" ? "Mobilidade"
    : sport !== "run" ? "Treino"
    : hints.fartlek ? "Fartlek"
    : hints.long && z <= 3 ? "Longão"
    : z <= 1 ? "Regenerativo" : z === 2 ? (long ? "Longão" : "Rodagem") : z === 3 ? "Corrida moderada" : "Ritmo forte";
  return `${label} ${amountText(main.duration)}`.trim();
}

/**
 * Free text → `{structure, warnings, tags, name}`. `warnings`: the pieces that weren't understood, as typed;
 * `tags`: the #hashtags (normalized); `name`: a suggested workout name.
 */
export function parseWorkoutText(raw, sport) {
  const tags = [];
  const lines = String(raw ?? "").replace(/\r/g, "").split("\n").map((l) => { const x = extractTags(l); tags.push(...x.tags); return stripListMarker(normalizeLine(x.text)); });
  const toks = pauseMarks(numberWords(tokenize(lines.join("\n"))));
  const hints = {
    long: toks.some((t) => W(t, "longão", "longao", "longo", "longa")),
    fartlek: toks.some((t) => W(t, "fartlek")),
    progressive: toks.some((t) => t.k === "word" && (t.low.startsWith("progress") || t.low.startsWith("progredi"))),
    progression: null,
    named: null,
  };
  const warnings = [];
  const { blocks, meta } = assemble(dashSets(segment(toks)), sport, warnings, hints);
  return { structure: { v: 1, blocks }, warnings, tags: cleanTags(tags), name: nameOf(blocks, meta, sport, hints) };
}
