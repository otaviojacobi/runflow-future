//! Free-text workouts in pt-BR → workout structure v1 (api/endpoints.md § Workout structure), for the assistant's
//! `POST /ai/workout`. One grammar for coaching shorthand and plain sentences:
//!   "10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq"
//!   "15 min de aquecimento, 6 tiros de 800 m a 4:10 com 2 min de trote e 10 min de desaquecimento"
//!
//! This is the backend's port of the grammar in api/mock/lib/workout-text.mjs (the web builder has the third one,
//! frontend/src/domain/quicktext.ts). All three must give exactly the golden examples in
//! api/workout-text-examples.json (synced to assets/; tests/workout_text.rs): change them together, function by
//! function (the names and order below follow the JavaScript). Rules: docs/workout-text.md.
//!
//! Pipeline: #tags out → normalize → tokens (numbers, clocks, words, punctuation; number words become numbers) →
//! pieces (split on "+", ";", new lines; and on ",", ".", " e ", "depois"… once the piece has a number) → each piece
//! is a repeat, steps, an exercise or a modifier of the previous block. Deterministic and forgiving: what isn't
//! understood becomes a warning (the text as typed), never an error.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Map, Value, json};

use crate::tags;

/// What a text says: the structure, the pieces that weren't understood (as typed), its `#tags` and a name.
#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub structure: Value,
    pub warnings: Vec<String>,
    pub tags: Vec<String>,
    pub name: String,
}

// ------------------------------------------------------------------------------------ vocabulary
// The word lists keep the JavaScript's layout (one line each), so the three ports read side by side.

#[rustfmt::skip]
const KM: &[&str] = &["km", "k", "kms", "quilômetro", "quilômetros", "quilometro", "quilometros"];
const METERS: &[&str] = &["m", "mt", "mts", "metro", "metros"];
const HOURS: &[&str] = &["h", "hr", "hrs", "hora", "horas"];
#[rustfmt::skip]
const MINUTES: &[&str] = &["min", "mins", "minuto", "minutos", "minutinho", "minutinhos"];
const SECONDS: &[&str] = &["s", "seg", "segs", "segundo", "segundos", "sec"];

#[rustfmt::skip]
fn number_word(w: &str) -> Option<f64> {
    Some(match w {
        "um" | "uma" => 1.0, "dois" | "duas" => 2.0, "três" | "tres" => 3.0, "quatro" => 4.0, "cinco" => 5.0,
        "seis" => 6.0, "sete" => 7.0, "oito" => 8.0, "nove" => 9.0, "dez" => 10.0, "onze" => 11.0, "doze" => 12.0,
        "treze" => 13.0, "quatorze" | "catorze" => 14.0, "quinze" => 15.0, "dezesseis" => 16.0, "dezessete" => 17.0,
        "dezoito" => 18.0, "dezenove" => 19.0, "vinte" => 20.0, "trinta" => 30.0, "quarenta" => 40.0,
        "cinquenta" => 50.0, "sessenta" => 60.0, "setenta" => 70.0, "oitenta" => 80.0, "noventa" => 90.0,
        "cem" | "cento" => 100.0, "duzentos" | "duzentas" => 200.0, "trezentos" | "trezentas" => 300.0,
        "quatrocentos" | "quatrocentas" => 400.0, "quinhentos" | "quinhentas" => 500.0, "seiscentos" => 600.0,
        "setecentos" => 700.0, "oitocentos" => 800.0, "novecentos" => 900.0, "mil" => 1000.0,
        _ => return None,
    })
}

/// "6x", "6 vezes", "6 tiros (de)", "3 séries (de)".
#[rustfmt::skip]
const REPEAT_WORDS: &[&str] = &["x", "vezes", "tiro", "tiros", "repetição", "repetições", "repeticao", "repeticoes", "rep", "reps", "série", "séries", "serie", "series", "bloco", "blocos", "estímulo", "estímulos", "estimulo", "estimulos", "aceleração", "acelerações", "aceleracao", "aceleracoes", "strides"];
/// Words that open the recovery part of a repeat ("6x1km c/ 2' trote", "8x100 com 20\" de descanso").
#[rustfmt::skip]
const RECOVERY_MARKERS: &[&str] = &["com", "int", "intervalo", "intervalos", "rec", "recuperação", "recuperacao", "recupera", "pausa", "descanso", "desc"];
/// Words that make a piece a recovery when they follow an amount ("2' trote", "15\" desc", "1' parado").
#[rustfmt::skip]
const RECOVERY_WORDS: &[&str] = &["descanso", "desc", "parado", "parada", "pausa", "intervalo", "int", "rec", "recuperação", "recuperacao", "andando", "repouso"];
/// Easy words: after a hard rep, an amount with one of these is the recovery ("10x1' forte 1' leve").
#[rustfmt::skip]
const EASY_WORDS: &[&str] = &["leve", "leves", "solto", "soltinho", "levinho", "regenerativo", "fácil", "facil", "devagar", "suave"];
#[rustfmt::skip]
const SOFT_WORDS: &[&str] = &["e", "depois", "então", "entao", "seguido", "seguida", "seguidos", "seguidas"];
#[rustfmt::skip]
const HR_WORDS: &[&str] = &["fc", "bpm", "frequência", "frequencia", "cardíaca", "cardiaca"];
const POWER_WORDS: &[&str] = &["potência", "potencia", "power", "watts", "watt", "w", "ftp"];
/// Intensity words → PSE (RPE 1–10) with the word people see: `{type: "rpe", value, label}` (docs/workout-text.md
/// § PSE). Phrases first, then adjectives (they win over nouns like "rodagem"), in this order.
#[rustfmt::skip]
const INTENSITY_PHRASES: &[(&[&str], i64, &str)] = &[
    (&["bem", "leve"], 2, "bem leve"), (&["muito", "leve"], 2, "muito leve"), (&["bem", "levinho"], 2, "bem leve"), (&["muito", "forte"], 9, "muito forte"),
    (&["ritmo", "de", "meia", "maratona"], 7, "ritmo de meia"), (&["ritmo", "de", "meia"], 7, "ritmo de meia"), (&["ritmo", "de", "maratona"], 6, "ritmo de maratona"),
];
/// The nouns ("rodagem", "longão") come last (`INTENSITY_NOUNS`).
#[rustfmt::skip]
const INTENSITY_WORDS: &[(&[&str], i64, &str)] = &[
    (&["regenerativo", "regenerativa", "regenerativos", "recuperativo", "recuperativa"], 2, "regenerativo"), (&["soltinho"], 2, "soltinho"), (&["levinho"], 2, "levinho"),
    (&["leve", "leves"], 3, "leve"), (&["fácil", "facil"], 3, "fácil"), (&["tranquilo", "tranquila"], 3, "tranquilo"), (&["confortável", "confortavel"], 3, "confortável"), (&["aeróbico", "aerobico"], 3, "aeróbico"),
    (&["moderado", "moderada"], 5, "moderado"), (&["médio", "medio"], 5, "médio"), (&["steady"], 5, "steady"),
    (&["limiar", "threshold"], 7, "limiar"), (&["forte", "fortes"], 8, "forte"), (&["intenso", "intensa"], 8, "intenso"), (&["fortíssimo", "fortissimo"], 9, "fortíssimo"),
    (&["máximo", "maximo", "máxima", "maxima", "máx", "max"], 10, "máximo"), (&["sprint", "sprints"], 10, "sprint"),
];
#[rustfmt::skip]
const INTENSITY_NOUNS: &[(&[&str], i64, &str)] = &[(&["rodagem", "longão", "longao", "longo", "longa"], 3, "leve")];
/// Recovery words that also say how easy: "2' trote" (PSE 3), "3' andando" (PSE 2).
fn is_jog(t: &Tok) -> bool {
    t.k == K::Word && t.low.starts_with("trot")
}
fn is_walk(t: &Tok) -> bool {
    t.k == K::Word && (t.low.starts_with("caminh") || t.low == "andando")
}
/// "Desc. 1'30\" & 3'": the rest after each run of the set above, and after the whole set.
const DESC_WORDS: &[&str] = &["desc", "descanso", "pausa"];
/// Swim strokes, most specific first (a kick or drill set wins over the base stroke).
#[rustfmt::skip]
const STROKES: &[(&[&str], &str)] = &[
    (&["escolha"], "choice"), (&["pernada", "pernadas", "perna", "pernas"], "kick"), (&["educativo", "educativos", "educativa"], "drill"),
    (&["borboleta", "golfinho"], "fly"), (&["costas"], "back"), (&["peito"], "breast"), (&["medley"], "im"), (&["crawl", "crol", "livre"], "free"),
];
#[rustfmt::skip]
const EQUIPMENT: &[(&[&str], &str)] = &[
    (&["palmar", "palmares"], "paddles"), (&["pull", "pullbuoy", "buoy", "flutuador", "boia", "bóia"], "pullbuoy"),
    (&["nadadeira", "nadadeiras"], "fins"), (&["prancha", "pranchinha"], "kickboard"), (&["snorkel", "respirador"], "snorkel"),
];
/// Free words kept as the step's note (pt-BR, as shown to the athlete).
#[rustfmt::skip]
const NOTE_WORDS: &[(&[&str], &str)] = &[
    (&["educativo", "educativos", "educativa"], "educativos"), (&["subida", "subidas", "ladeira", "ladeiras", "morro", "rampa", "rampas"], "subida"),
    (&["esteira"], "esteira"),
];
/// Words that may sit inside "( )" and still be read as the step's target ("6x1km (4:30)", "40' (Z2)").
#[rustfmt::skip]
const INLINE_WORDS: &[&str] = &["z", "zona", "pse", "rpe", "fc", "bpm", "w", "km", "min", "pace", "ritmo", "a", "de", "por", "ftp", "do", "potência", "potencia", "watts"];
#[rustfmt::skip]
const LEAD_FILLERS: &[&str] = &["e", "depois", "mais", "então", "entao", "seguido", "seguida", "de", "do", "da", "por", "fim", "também", "tambem", "faça", "faca", "fazer", "faz", "com", "o", "a", "os", "as", "no", "na", "pra", "para", "finalizar", "finalizando", "terminar"];
const TRAIL_FILLERS: &[&str] = &["de", "com", "em", "no", "na", "a", "o", "e"];
const SETS_WORDS: &[&str] = &["séries", "series", "série", "serie", "sets", "set"];
#[rustfmt::skip]
const REPS_WORDS: &[&str] = &["repetições", "repeticoes", "repetição", "repeticao", "reps", "rep", "vezes"];
const KG: &[&str] = &["kg", "kgs", "quilos", "kilos", "quilo", "kilo"];
#[rustfmt::skip]
const REST_WORDS: &[&str] = &["desc", "descanso", "int", "intervalo", "pausa", "rest", "rec", "recuperação", "recuperacao"];
/// With `KG` and `REST_WORDS`: the words that end an exercise's name ("4 séries de 10 agachamentos com 20 kg").
#[rustfmt::skip]
const ATTR_WORDS: &[&str] = &["pse", "rpe", "pc", "peso", "tempo", "carga", "com", "a", "de", "sem", "cada", "por", "cadência", "cadencia"];
const ATTR_FILLERS: &[&str] = &["com", "a", "de", "e", "carga", "do", "da"];
const SIDE_WORDS: &[&str] = &["lado", "perna", "braço", "braco", "membro"];
const MAX_REPEAT_STEPS: usize = 50;
const MAX_AMOUNT: i64 = 1_000_000;

// ------------------------------------------------------------------------------------ tokens

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum K {
    Num,
    Clock,
    Word,
    P,
}

/// A token: `v` = the number (num) or seconds (clock); `int` = written without decimals; `n` = clock parts;
/// `sp` = a space before it.
#[derive(Clone, Debug)]
struct Tok {
    k: K,
    raw: String,
    low: String,
    sp: bool,
    v: f64,
    int: bool,
    n: u8,
}

type T<'a> = Option<&'a Tok>;

fn is_digit(c: Option<&char>) -> bool {
    c.is_some_and(char::is_ascii_digit)
}

/// ASCII letters and Latin-1/Latin Extended letters (Portuguese), the same set in every port.
fn is_letter(c: Option<&char>) -> bool {
    c.is_some_and(|&c| {
        c.is_ascii_alphabetic() || (('\u{C0}'..='\u{24F}').contains(&c) && c != '×' && c != '÷')
    })
}

/// JavaScript's `Math.floor(x + 0.5)`.
fn round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// A whole number from a computed value (saturating: the grammar bounds what it keeps).
fn whole(x: f64) -> i64 {
    x as i64
}

/// JavaScript's `\s`, spelled out so every port treats the same characters as spaces.
fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// A JSON number written like JavaScript would (`90`, not `90.0`).
fn number(x: f64) -> Value {
    if x.is_finite() && x.fract() == 0.0 && x.abs() < 1.8e19 {
        if x >= 0.0 {
            json!(x as u64)
        } else {
            json!(x as i64)
        }
    } else {
        serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number)
    }
}

/// `String(v).replace(".", ",")` for the values the notes print (1 ≤ v < 1000).
fn fmt_num(v: f64) -> String {
    v.to_string().replacen('.', ",", 1)
}

/// "1) " or "2. " numbering a line.
fn strip_list_marker(s: String) -> String {
    let cs: Vec<char> = s.chars().collect();
    let mut j = 0;
    while j < 2 && is_digit(cs.get(j)) {
        j += 1;
    }
    if j > 0 && matches!(cs.get(j), Some(')' | '.')) && cs.get(j + 1) == Some(&' ') {
        cs[j + 2..].iter().collect()
    } else {
        s
    }
}

/// Typographic marks → ASCII ("×" → x, primes → ' and "), one space between words.
fn normalize_line(s: &str) -> String {
    let mapped: String = s
        .chars()
        .map(|c| match c {
            '×' => 'x',
            '′' | '’' | '´' | '`' | '‘' => '\'',
            '″' | '”' | '“' => '"',
            '–' | '—' | '−' => '-',
            c if is_space(c) => ' ',
            c => c,
        })
        .collect();
    let mapped = mapped.replace("''", "\"");
    let mut out = String::with_capacity(mapped.len());
    for c in mapped.chars() {
        if c == ' ' && out.ends_with(' ') {
            continue;
        }
        out.push(c);
    }
    out.trim_matches(' ').to_string()
}

fn tokenize(text: &str) -> Vec<Tok> {
    let cs: Vec<char> = text.chars().collect();
    let mut out: Vec<Tok> = Vec::new();
    let (mut i, mut sp) = (0usize, false);
    let digit = |j: usize| is_digit(cs.get(j));
    let two_digits = |j: usize| digit(j) && digit(j + 1) && !digit(j + 2);
    let push = |out: &mut Vec<Tok>,
                i: &mut usize,
                sp: &mut bool,
                k: K,
                j: usize,
                v: f64,
                int: bool,
                n: u8| {
        let raw: String = cs[*i..j].iter().collect();
        let low = raw.to_lowercase();
        out.push(Tok {
            k,
            raw,
            low,
            sp: *sp,
            v,
            int,
            n,
        });
        *sp = false;
        *i = j;
    };
    while i < cs.len() {
        let c = cs[i];
        if c == ' ' {
            sp = true;
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let mut j = i;
            while digit(j) {
                j += 1;
            }
            let mut digits: String = cs[i..j].iter().collect();
            // "4:30", "1:23:45": a clock (minutes or hours up to two digits).
            if cs.get(j) == Some(&':') && j - i <= 2 && two_digits(j + 1) {
                let a: f64 = digits.parse().unwrap_or(0.0);
                let b = f64::from(
                    cs[j + 1].to_digit(10).unwrap_or(0) * 10 + cs[j + 2].to_digit(10).unwrap_or(0),
                );
                if cs.get(j + 3) == Some(&':') && two_digits(j + 4) {
                    let c2 = f64::from(
                        cs[j + 4].to_digit(10).unwrap_or(0) * 10
                            + cs[j + 5].to_digit(10).unwrap_or(0),
                    );
                    push(
                        &mut out,
                        &mut i,
                        &mut sp,
                        K::Clock,
                        j + 6,
                        a * 3600.0 + b * 60.0 + c2,
                        false,
                        3,
                    );
                } else {
                    push(
                        &mut out,
                        &mut i,
                        &mut sp,
                        K::Clock,
                        j + 3,
                        a * 60.0 + b,
                        false,
                        2,
                    );
                }
                continue;
            }
            // "1.500" is a thousand separator; "1,5" and "1.5" are decimals.
            while cs.get(j) == Some(&'.')
                && digit(j + 1)
                && digit(j + 2)
                && digit(j + 3)
                && !digit(j + 4)
            {
                digits.extend(&cs[j + 1..j + 4]);
                j += 4;
            }
            if matches!(cs.get(j), Some(',' | '.')) && digit(j + 1) {
                let mut k = j + 1;
                while digit(k) {
                    k += 1;
                }
                let frac: String = cs[j + 1..k].iter().collect();
                let v: f64 = format!("{digits}.{frac}").parse().unwrap_or(0.0);
                push(&mut out, &mut i, &mut sp, K::Num, k, v, false, 0);
            } else {
                let v: f64 = digits.parse().unwrap_or(0.0);
                push(&mut out, &mut i, &mut sp, K::Num, j, v, true, 0);
            }
            continue;
        }
        if is_letter(Some(&c)) {
            let mut j = i;
            while is_letter(cs.get(j)) {
                j += 1;
            }
            // "3xmáx", "4xfalha": the "x" of a count glued to a word.
            let after_num = out.last().is_some_and(|t| t.k == K::Num);
            if (c == 'x' || c == 'X') && j > i + 1 && !sp && after_num {
                let j = i + 1;
                push(&mut out, &mut i, &mut sp, K::Word, j, 0.0, false, 0);
                continue;
            }
            push(&mut out, &mut i, &mut sp, K::Word, j, 0.0, false, 0);
            continue;
        }
        let j = i + 1;
        push(&mut out, &mut i, &mut sp, K::P, j, 0.0, false, 0);
    }
    out
}

fn w(t: T, ws: &[&str]) -> bool {
    t.is_some_and(|t| t.k == K::Word && ws.contains(&t.low.as_str()))
}
fn p(t: T, c: &str) -> bool {
    t.is_some_and(|t| t.k == K::P && t.low == c)
}
fn n(t: T) -> bool {
    t.is_some_and(|t| t.k == K::Num)
}
fn int(t: T) -> bool {
    t.is_some_and(|t| t.k == K::Num && t.int)
}
fn clock(t: T) -> bool {
    t.is_some_and(|t| t.k == K::Clock && t.n == 2)
}
fn numish(t: T) -> bool {
    t.is_some_and(|t| t.k == K::Num || t.k == K::Clock)
}
fn is_word(t: T) -> bool {
    t.is_some_and(|t| t.k == K::Word)
}
fn is_unit(t: T) -> bool {
    w(t, KM) || w(t, METERS) || w(t, HOURS) || w(t, MINUTES) || w(t, SECONDS)
}
fn is_number_word(t: T) -> bool {
    t.is_some_and(|t| t.k == K::Word && number_word(&t.low).is_some())
}
/// The value of a token known to be a number or clock.
fn val(t: T) -> f64 {
    t.map_or(0.0, |t| t.v)
}
/// `toks[i]` (`None` out of range, negative included).
fn get(toks: &[Tok], i: isize) -> T<'_> {
    usize::try_from(i).ok().and_then(|i| toks.get(i))
}
/// `toks[i]` unless already taken.
fn at<'a>(toks: &'a [Tok], used: &[bool], j: isize) -> T<'a> {
    let i = usize::try_from(j).ok()?;
    if used.get(i).copied().unwrap_or(false) {
        None
    } else {
        toks.get(i)
    }
}
fn claim(used: &mut [bool], a: isize, b: isize) {
    for k in a.max(0)..b {
        if let Some(u) = used.get_mut(k as usize) {
            *u = true;
        }
    }
}
/// The text of some tokens, as typed (after normalization).
fn text_of(toks: &[Tok]) -> String {
    let mut s = String::new();
    for (i, t) in toks.iter().enumerate() {
        if i > 0 && t.sp {
            s.push(' ');
        }
        s.push_str(&t.raw);
    }
    s
}

/// Number words → numbers ("seis tiros", "vinte e cinco", "dois mil"); "meia hora", "1 hora e meia", "1 hora e 20".
fn number_words(toks: &[Tok]) -> Vec<Tok> {
    let mut res: Vec<Tok> = Vec::new();
    let g = |i: usize| toks.get(i);
    let mut i = 0;
    while i < toks.len() {
        let t = &toks[i];
        if is_number_word(Some(t)) || (int(Some(t)) && w(g(i + 1), &["mil"])) {
            let mut v = number_word(&t.low).unwrap_or(t.v);
            let mut last = v;
            let mut j = i + 1;
            if w(g(j), &["mil"]) && v != 1000.0 {
                v *= 1000.0;
                last = 1000.0;
                j += 1;
            }
            while w(g(j), &["e"])
                && is_number_word(g(j + 1))
                && last >= 20.0
                && number_word(&toks[j + 1].low).unwrap_or(f64::MAX) < last
            {
                last = number_word(&toks[j + 1].low).unwrap_or(0.0);
                v += last;
                j += 2;
            }
            let raw = text_of(&toks[i..j]);
            let low = raw.to_lowercase();
            res.push(Tok {
                k: K::Num,
                raw,
                low,
                sp: t.sp,
                v,
                int: true,
                n: 0,
            });
            i = j;
            continue;
        }
        if w(Some(t), &["meia", "meio"]) && is_unit(g(i + 1)) {
            res.push(Tok {
                k: K::Num,
                v: 0.5,
                int: false,
                ..t.clone()
            });
            i += 1;
            continue;
        }
        let len = res.len();
        let (a, u) = (
            len.checked_sub(2).map(|k| &res[k]),
            len.checked_sub(1).map(|k| &res[k]),
        );
        if w(Some(t), &["e"]) && n(a) && is_unit(u) {
            if w(g(i + 1), &["meia", "meio"]) {
                let a = &mut res[len - 2];
                a.v += 0.5;
                a.int = false;
                i += 2;
                continue;
            }
            let ul = u.map_or("", |u| u.low.as_str());
            if n(g(i + 1))
                && (HOURS.contains(&ul)
                    || (MINUTES.contains(&ul) && (w(g(i + 2), SECONDS) || p(g(i + 2), "\""))))
            {
                i += 1;
                continue;
            }
        }
        res.push(t.clone());
        i += 1;
    }
    res
}

/// "p: 1'30\"", "P: 1'": some coaches write a pause (pausa) this way.
fn pause_marks(toks: Vec<Tok>) -> Vec<Tok> {
    let mut out = Vec::with_capacity(toks.len());
    let mut it = toks.into_iter().peekable();
    while let Some(t) = it.next() {
        if w(Some(&t), &["p"]) && p(it.peek(), ":") {
            it.next();
            out.push(Tok {
                low: "pausa".into(),
                ..t
            });
            continue;
        }
        out.push(t);
    }
    out
}

// ------------------------------------------------------------------------------------ pieces

#[derive(Clone)]
struct Piece {
    toks: Vec<Tok>,
    soft: bool,
}

/// "entre 4:30 e 4:40": that "e" joins a range, it doesn't split.
fn range_e(toks: &[Tok], i: usize) -> bool {
    if !numish(toks.get(i + 1)) {
        return false;
    }
    let mut j = i as isize - 1;
    while j >= 0 && j >= i as isize - 4 {
        let t = get(toks, j);
        if w(t, &["entre"]) {
            return true;
        }
        if !(numish(t)
            || t.is_some_and(|t| t.k == K::P)
            || is_unit(t)
            || w(t, &["bpm", "w", "watts", "kg"]))
        {
            return false;
        }
        j -= 1;
    }
    false
}
/// "2' limiar/ 1' trote": a slash between a word (not a unit, not the "c" of "c/") and an amount.
fn slash_pair(toks: &[Tok], i: usize) -> bool {
    let (a, u) = (get(toks, i as isize - 1), toks.get(i + 2));
    a.is_some_and(|a| a.k == K::Word && a.low.chars().count() > 1)
        && !is_unit(a)
        && n(toks.get(i + 1))
        && (is_unit(u) || p(u, "'") || p(u, "\""))
}
fn soft_at(toks: &[Tok], i: usize) -> bool {
    let t = toks.get(i);
    let next_sp = toks.get(i + 1).is_some_and(|x| x.sp);
    if p(t, ",") || p(t, ".") || p(t, "|") {
        return true;
    }
    if p(t, "-") {
        return t.is_some_and(|t| t.sp)
            && next_sp
            && !(numish(get(toks, i as isize - 1))
                && numish(toks.get(i + 1))
                && !w(toks.get(i + 2), REPEAT_WORDS));
    }
    if p(t, "/") {
        return (t.is_some_and(|t| t.sp) && next_sp) || slash_pair(toks, i);
    }
    if w(t, &["e"]) {
        return !range_e(toks, i);
    }
    w(t, SOFT_WORDS)
}
/// Words a ":" belongs to ("tempo: 3-1-1", "desc: 1'"), so it doesn't split there.
fn colon_keep(l: &str) -> bool {
    [
        "tempo",
        "cadência",
        "cadencia",
        "pse",
        "rpe",
        "fc",
        "pace",
        "ritmo",
        "zona",
    ]
    .contains(&l)
        || DESC_WORDS.contains(&l)
        || REST_WORDS.contains(&l)
}
/// "2' caminhada: 4' corrida leve", "3' (4:35/km) : 5' (4:18/km)": a ":" between two amounts alternates them (a
/// soft split), unless it's inside a repeat ("11x 100m (leve): 300m", one round: parse_repeat) or after a label word.
fn colon_split(toks: &[Tok], i: usize, cur: &[Tok]) -> bool {
    let prev = get(toks, i as isize - 1);
    if !n(toks.get(i + 1)) || prev.is_some_and(|x| x.k == K::Word && colon_keep(&x.low)) {
        return false;
    }
    find_anchor(cur).is_none()
}
/// Split on "+", ";" and new lines (hard), and on soft separators once the piece has a number.
fn segment(toks: &[Tok]) -> Vec<Piece> {
    let mut pieces: Vec<Piece> = Vec::new();
    let (mut cur, mut soft, mut depth): (Vec<Tok>, bool, usize) = (Vec::new(), false, 0);
    let flush = |pieces: &mut Vec<Piece>, cur: &mut Vec<Tok>, soft: &mut bool, next_soft: bool| {
        if !cur.is_empty() {
            pieces.push(Piece {
                toks: std::mem::take(cur),
                soft: *soft,
            });
            *soft = next_soft;
        } else if !next_soft {
            *soft = false;
        }
    };
    for (i, t) in toks.iter().enumerate() {
        let t1 = Some(t);
        if p(t1, "\n") {
            depth = 0;
            flush(&mut pieces, &mut cur, &mut soft, false);
            continue;
        }
        if p(t1, "(") {
            depth += 1;
        } else if p(t1, ")") {
            depth = depth.saturating_sub(1);
        } else if depth == 0 {
            if p(t1, "+") || p(t1, ";") {
                flush(&mut pieces, &mut cur, &mut soft, false);
                continue;
            }
            if (soft_at(toks, i) || (p(t1, ":") && colon_split(toks, i, &cur)))
                && cur.iter().any(|x| numish(Some(x)))
            {
                flush(&mut pieces, &mut cur, &mut soft, true);
                continue;
            }
        }
        cur.push(t.clone());
    }
    flush(&mut pieces, &mut cur, &mut soft, false);
    pause_parens(pieces)
}
/// "600m | p: 1'30\" (2'30 | 4:10/km)": the pace in parentheses after a pause is the run's, before it (a pause has
/// no pace). Moved to the end of the run's piece.
fn pause_parens(mut pieces: Vec<Piece>) -> Vec<Piece> {
    for k in 1..pieces.len() {
        let pc = &pieces[k];
        if !pc.soft || !w(pc.toks.first(), &["pausa"]) {
            continue;
        }
        let Some(a) = pc.toks.iter().position(|t| p(Some(t), "(")) else {
            continue;
        };
        let (mut d, mut b) = (0, a);
        while b < pc.toks.len() {
            let x = Some(&pc.toks[b]);
            if p(x, "(") {
                d += 1;
            } else if p(x, ")") {
                d -= 1;
                if d == 0 {
                    break;
                }
            }
            b += 1;
        }
        let close = (b + 1).min(pc.toks.len());
        if !pc.toks[a..close].iter().any(|t| t.k == K::Clock)
            || pieces[k - 1].toks.iter().any(|t| p(Some(t), "("))
        {
            continue;
        }
        let group: Vec<Tok> = pieces[k].toks.drain(a..close).collect();
        pieces[k - 1].toks.extend(group);
    }
    pieces
}

/// The words of `INTENSITY_WORDS`, `INTENSITY_PHRASES` and `EASY_WORDS` (not the nouns).
fn intensity_only(l: &str) -> bool {
    INTENSITY_WORDS.iter().any(|(ws, ..)| ws.contains(&l))
        || INTENSITY_PHRASES.iter().any(|(ws, ..)| ws.contains(&l))
        || EASY_WORDS.contains(&l)
}
/// "(2'30 | 4:10/km)": the same target written two ways (the rep's time | its pace) → the part with the pace.
fn pick_alternative(inner: &[Tok]) -> Vec<Tok> {
    if !inner.iter().any(|t| p(Some(t), "|")) {
        return inner.to_vec();
    }
    let mut parts: Vec<Vec<Tok>> = vec![Vec::new()];
    for t in inner {
        if p(Some(t), "|") {
            parts.push(Vec::new());
        } else {
            parts.last_mut().expect("a part").push(t.clone());
        }
    }
    let paced = parts
        .iter()
        .position(|q| (0..q.len()).any(|i| p(q.get(i), "/") && w(q.get(i + 1), KM)));
    parts.swap_remove(paced.unwrap_or(0))
}
/// Parenthesized text: a note, or (when it only holds a target) inline tokens. `words`: an intensity word alone
/// ("(leve)") is a target too (runs, rides, swims; for exercises it stays a note).
fn take_parens(toks0: &[Tok], words: bool) -> (Vec<Tok>, Vec<String>) {
    let (mut toks, mut notes) = (Vec::new(), Vec::new());
    let mut i = 0;
    while i < toks0.len() {
        let t = Some(&toks0[i]);
        if p(t, ")") {
            i += 1;
            continue;
        }
        if !p(t, "(") {
            toks.push(toks0[i].clone());
            i += 1;
            continue;
        }
        let (mut d, mut j) = (1, i + 1);
        while j < toks0.len() {
            let x = Some(&toks0[j]);
            if p(x, "(") {
                d += 1;
            } else if p(x, ")") {
                d -= 1;
                if d == 0 {
                    break;
                }
            }
            j += 1;
        }
        let inner = pick_alternative(&toks0[i + 1..j.min(toks0.len())]);
        let inline = inner
            .iter()
            .all(|t| t.k != K::Word || INLINE_WORDS.contains(&t.low.as_str()));
        let intensity = words
            && !inner.is_empty()
            && inner
                .iter()
                .all(|t| t.k == K::Word && intensity_only(&t.low));
        if intensity
            || (!inner.is_empty()
                && inline
                && (inner.iter().any(|t| numish(Some(t)))
                    || inner
                        .iter()
                        .any(|t| w(Some(t), HR_WORDS) || w(Some(t), POWER_WORDS))))
        {
            toks.extend(inner);
        } else {
            let s = text_of(&inner);
            let s = s.trim();
            if !s.is_empty() {
                notes.push(s.to_string());
            }
        }
        i = j + 1;
    }
    (toks, notes)
}

// ------------------------------------------------------------------------------------ amounts and values

#[derive(Clone, Copy, Debug, PartialEq)]
enum Dur {
    Time(i64),
    Distance(i64),
    Open,
}

impl Dur {
    fn amount(self) -> i64 {
        match self {
            Dur::Time(x) | Dur::Distance(x) => x,
            Dur::Open => 0,
        }
    }
    fn same_type(self, o: Dur) -> bool {
        std::mem::discriminant(&self) == std::mem::discriminant(&o)
    }
    fn json(self) -> Value {
        match self {
            Dur::Time(s) => json!({ "type": "time", "s": s }),
            Dur::Distance(m) => json!({ "type": "distance", "m": m }),
            Dur::Open => json!({ "type": "open" }),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Amount {
    dur: Dur,
    end: isize,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Bare {
    No,
    Active,
    Recovery,
}

/// A duration at `i` (unused tokens only), up to 1,000 km or 1,000,000 s.
fn amount_at(toks: &[Tok], used: &[bool], i: isize, sport: &str, bare: Bare) -> Option<Amount> {
    raw_amount_at(toks, used, i, sport, bare).filter(|a| a.dur.amount() <= MAX_AMOUNT)
}
/// `bare`: unitless numbers (active: swim meters, run ≥ 100 m; recovery: < 100 s, else m).
fn raw_amount_at(toks: &[Tok], used: &[bool], i: isize, sport: &str, bare: Bare) -> Option<Amount> {
    let at = |j: isize| at(toks, used, j);
    let t = at(i);
    if !n(t) {
        return None;
    }
    let (u, v) = (at(i + 1), val(t));
    let time = |s: f64, end: isize| {
        Some(Amount {
            dur: Dur::Time(whole(round(s))),
            end,
        })
    };
    if w(u, KM) {
        if p(at(i + 2), "/") && w(at(i + 3), &["h"]) {
            return None;
        }
        return Some(Amount {
            dur: Dur::Distance(whole(round(v * 1000.0))),
            end: i + 2,
        });
    }
    if w(u, METERS) {
        return Some(Amount {
            dur: Dur::Distance(whole(round(v))),
            end: i + 2,
        });
    }
    if w(u, HOURS) {
        let (mut s, mut end) = (v * 3600.0, i + 2);
        if int(at(end)) && val(at(end)) < 60.0 {
            s += val(at(end)) * 60.0;
            end += 1;
            if w(at(end), MINUTES) || p(at(end), "'") {
                end += 1;
            }
        }
        return time(s, end);
    }
    if w(u, MINUTES) || p(u, "'") {
        let (mut s, mut end) = (v * 60.0, i + 2);
        let nx = at(end);
        let secs = p(at(end + 1), "\"") || w(at(end + 1), SECONDS);
        if int(nx) && val(nx) < 60.0 && (secs || (p(u, "'") && !nx.is_some_and(|x| x.sp))) {
            s += val(nx);
            end += if secs { 2 } else { 1 };
        }
        return time(s, end);
    }
    if w(u, SECONDS) || p(u, "\"") {
        return time(v, i + 2);
    }
    if bare == Bare::No || !int(t) {
        return None;
    }
    let prev = at(i - 1);
    if w(prev, &["fc", "pse", "rpe", "z", "zona", "x"])
        || w(u, &["w", "watts", "bpm", "rpm"])
        || w(u, KG)
        || p(u, "%")
    {
        return None;
    }
    if bare == Bare::Recovery {
        if v < 100.0 {
            return Some(Amount {
                dur: Dur::Time(whole(v)),
                end: i + 1,
            });
        }
        if sport == "bike" {
            return None;
        }
        return Some(Amount {
            dur: Dur::Distance(whole(v)),
            end: i + 1,
        });
    }
    if (sport == "swim" && (10.0..=10000.0).contains(&v))
        || (sport == "run" && (100.0..=50000.0).contains(&v))
    {
        return Some(Amount {
            dur: Dur::Distance(whole(v)),
            end: i + 1,
        });
    }
    None
}
/// A pace or send-off value: "4:30", "4'30" → (seconds, end).
fn clock_at(toks: &[Tok], used: &[bool], i: isize) -> Option<(f64, isize)> {
    let at = |j: isize| at(toks, used, j);
    let t = at(i);
    if clock(t) {
        return Some((val(t), i + 1));
    }
    let s = at(i + 2);
    if int(t) && val(t) < 60.0 && p(at(i + 1), "'") && int(s) && val(s) < 60.0 {
        return Some((
            val(t) * 60.0 + val(s),
            i + if p(at(i + 3), "\"") { 4 } else { 3 },
        ));
    }
    None
}
/// "/km", "min/km", "/100", "por km" → (end, per 100 m).
fn pace_unit_at(toks: &[Tok], used: &[bool], i: isize) -> Option<(isize, bool)> {
    let at = |j: isize| at(toks, used, j);
    let mut j = i;
    if w(at(j), &["min"]) {
        j += 1;
    }
    if p(at(j), "/") {
        if w(at(j + 1), &["km"]) {
            return Some((j + 2, false));
        }
        if n(at(j + 1)) && val(at(j + 1)) == 100.0 {
            return Some((j + if w(at(j + 2), &["m", "metros"]) { 3 } else { 2 }, true));
        }
    }
    if w(at(i), &["por"]) && w(at(i + 1), &["km"]) {
        return Some((i + 2, false));
    }
    None
}
fn range_conn(t: T) -> bool {
    p(t, "-") || w(t, &["a", "e", "até", "ate"])
}

/// Numbers nobody took, with the free words around them ("nos últimos 5 km"): reported as warnings.
fn leftovers(toks: &[Tok], used: &[bool]) -> Vec<String> {
    let mut out = Vec::new();
    let len = toks.len() as isize;
    let free = |k: isize| {
        k >= 0
            && k < len
            && !used[k as usize]
            && !p(get(toks, k), ",")
            && !p(get(toks, k), "(")
            && !p(get(toks, k), ")")
    };
    let mut i: isize = 0;
    while i < len {
        if used[i as usize] || !numish(get(toks, i)) {
            i += 1;
            continue;
        }
        let (mut a, mut b) = (i, i + 1);
        while free(a - 1) {
            a -= 1;
        }
        while free(b) {
            b += 1;
        }
        while a < i && toks[a as usize].k == K::P {
            a += 1;
        }
        while b > i + 1 && {
            let t = get(toks, b - 1);
            t.is_some_and(|t| t.k == K::P) && !p(t, "'") && !p(t, "\"") && !p(t, "%")
        } {
            b -= 1;
        }
        out.push(text_of(&toks[a as usize..b as usize]));
        i = b;
    }
    out
}

// ------------------------------------------------------------------------------------ steps

#[derive(Clone, Debug, PartialEq)]
enum Tgt {
    Open,
    Zone {
        metric: &'static str,
        zone: i64,
    },
    Pace {
        min: i64,
        max: i64,
    },
    Hr {
        min: i64,
        max: i64,
    },
    Power {
        min: i64,
        max: i64,
    },
    /// The value and, from an intensity word, the word people see ("forte" → 8).
    Rpe(i64, Option<&'static str>),
}

impl Tgt {
    fn json(&self) -> Value {
        match self {
            Tgt::Open => json!({ "type": "open" }),
            Tgt::Zone { metric, zone } => json!({ "type": "zone", "metric": metric, "zone": zone }),
            Tgt::Pace { min, max } => json!({ "type": "pace", "min_s": min, "max_s": max }),
            Tgt::Hr { min, max } => json!({ "type": "hr", "min": min, "max": max }),
            Tgt::Power { min, max } => json!({ "type": "power", "min": min, "max": max }),
            Tgt::Rpe(v, None) => json!({ "type": "rpe", "value": v }),
            Tgt::Rpe(v, Some(label)) => json!({ "type": "rpe", "value": v, "label": label }),
        }
    }
    /// How hard a target is, to spot progressions (comparable only within one target type).
    fn level(&self) -> Option<i64> {
        match self {
            Tgt::Zone { zone, .. } => Some(*zone),
            Tgt::Rpe(v, _) => Some(*v),
            Tgt::Pace { min, max } => Some(-(min + max)),
            Tgt::Hr { min, max } | Tgt::Power { min, max } => Some(min + max),
            Tgt::Open => None,
        }
    }
}

#[derive(Clone, Debug)]
struct Step {
    intent: &'static str,
    duration: Dur,
    /// The upper end of a range ("60-80m": `max_m` 80, "30 a 40 min": `max_s` 2400); `duration` is the lower one.
    dur_max: Option<i64>,
    target: Tgt,
    note: Option<String>,
    stroke: Option<&'static str>,
    equipment: Vec<&'static str>,
    send_off: Option<i64>,
}

impl Step {
    fn json(&self) -> Value {
        let mut m = Map::new();
        m.insert("kind".into(), json!("step"));
        m.insert("intent".into(), json!(self.intent));
        let mut duration = self.duration.json();
        if let Some(max) = self.dur_max {
            let key = if matches!(self.duration, Dur::Distance(_)) {
                "max_m"
            } else {
                "max_s"
            };
            duration[key] = json!(max);
        }
        m.insert("duration".into(), duration);
        m.insert("target".into(), self.target.json());
        if let Some(note) = &self.note {
            m.insert("note".into(), json!(note));
        }
        if let Some(stroke) = self.stroke {
            m.insert("stroke".into(), json!(stroke));
        }
        if !self.equipment.is_empty() {
            m.insert("equipment".into(), json!(self.equipment));
        }
        if let Some(s) = self.send_off {
            m.insert("send_off_s".into(), json!(s));
        }
        Value::Object(m)
    }
}

fn is_rest(s: Option<&Step>) -> bool {
    s.is_some_and(|s| s.intent == "recovery" || s.intent == "rest")
}
fn is_easy(s: &Step) -> bool {
    match s.target {
        Tgt::Open => true,
        Tgt::Zone { zone, .. } => zone <= 2,
        Tgt::Rpe(v, _) => v <= 3,
        _ => false,
    }
}
/// An easy step short enough to be a recovery: an easy target, up to 5 min or 1 km (not a pool distance).
fn short_recovery(s: &Step, sport: &str) -> bool {
    s.target != Tgt::Open
        && is_easy(s)
        && match s.duration {
            Dur::Time(t) => t <= 300,
            Dur::Distance(m) => sport != "swim" && m <= 1000,
            Dur::Open => false,
        }
}
fn rest_intent(sport: &str) -> &'static str {
    if sport == "swim" { "rest" } else { "recovery" }
}
fn default_metric(sport: &str) -> &'static str {
    if sport == "bike" { "hr" } else { "pace" }
}
fn ftp_zone(pct: f64) -> i64 {
    if pct < 56.0 {
        1
    } else if pct < 76.0 {
        2
    } else if pct < 91.0 {
        3
    } else if pct < 106.0 {
        4
    } else {
        5
    }
}

/// Split a progression's total into `n` parts: whole km (or minutes) when it fits, the remainder on the first.
fn split_parts(dur: Dur, n: i64) -> Vec<Dur> {
    let total = dur.amount();
    let distance = matches!(dur, Dur::Distance(_));
    let unit = if distance {
        if total >= n * 1000 { 1000 } else { 100 }
    } else if total >= n * 60 {
        60
    } else {
        1
    };
    let base = whole((total as f64 / n as f64 / unit as f64).floor()) * unit;
    (0..n)
        .map(|i| if i == 0 { total - base * (n - 1) } else { base })
        .map(|x| {
            if distance {
                Dur::Distance(x)
            } else {
                Dur::Time(x)
            }
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Between {
    Reps,
    Series,
}

struct StepsResult {
    steps: Vec<Step>,
    understood: bool,
    from_word: bool,
    between: Option<Between>,
    modifier_only: bool,
    has_duration: bool,
    progression: bool,
    total: Option<Dur>,
    leftovers: Vec<String>,
}

/// One piece → steps. `fallback`: the intent when no word says it. Returns the steps plus what the piece said:
/// `from_word` (an intent word), `between` ("entre os tiros" / "entre séries"), `modifier_only` (only a target,
/// stroke, equipment, send-off or note: it can complete the previous block), `progression`.
fn parse_steps(toks0: &[Tok], sport: &str, fallback: &'static str, bare: Bare) -> StepsResult {
    let (toks, paren_notes) = take_parens(toks0, true);
    let toks = &toks[..];
    let mut used = vec![false; toks.len()];
    let nn = toks.len() as isize;
    macro_rules! at {
        ($j:expr) => {
            at(toks, &used, $j)
        };
    }
    let tv = |i: isize| val(get(toks, i));

    let mut between = None;
    let mut i = 0;
    while i < nn && between.is_none() {
        if w(at!(i), &["entre"]) {
            let mut j = i + 1;
            while w(at!(j), &["os", "as", "o", "a"]) {
                j += 1;
            }
            if let Some(x) = at!(j).filter(|x| x.k == K::Word) {
                let l = x.low.as_str();
                if [
                    "tiro", "rep", "estímul", "estimul", "eles", "elas", "cada", "piq",
                ]
                .iter()
                .any(|p| l.starts_with(p))
                {
                    between = Some(Between::Reps);
                } else if ["séri", "seri", "bloco", "set", "round"]
                    .iter()
                    .any(|p| l.starts_with(p))
                {
                    between = Some(Between::Series);
                }
                if between.is_some() {
                    claim(&mut used, i, j + 1);
                }
            }
        }
        i += 1;
    }
    let mut progression = false;
    for i in 0..nn {
        if at!(i).is_some_and(|x| {
            x.k == K::Word && (x.low.starts_with("progress") || x.low.starts_with("progredi"))
        }) {
            used[i as usize] = true;
            progression = true;
        }
    }

    // "5 km em 25 min", "400 em 6:00": a total time for a distance → pace.
    let mut total: Option<(f64, bool)> = None;
    let mut i = 0;
    while i < nn && total.is_none() {
        if w(at!(i), &["em"]) {
            let c = at!(i + 1);
            if let Some(c) = c.filter(|c| c.k == K::Clock)
                && pace_unit_at(toks, &used, i + 2).is_none()
            {
                total = Some((c.v, c.n == 2));
                claim(&mut used, i, i + 2);
            } else if let Some(a) = amount_at(toks, &used, i + 1, sport, Bare::No)
                && let Dur::Time(s) = a.dur
            {
                total = Some((s as f64, false));
                claim(&mut used, i, a.end);
            }
        }
        i += 1;
    }
    // "200m 53-58seg", "400m 1'30\"": a time (or a range of times) right after a run distance is the time for it → pace.
    let mut rep_time: Option<(i64, i64, Option<i64>)> = None;
    let mut i = 0;
    while i < nn && rep_time.is_none() && sport == "run" {
        let start = i;
        i += 1;
        let Some(d) = amount_at(toks, &used, start, sport, bare) else {
            continue;
        };
        let Dur::Distance(m) = d.dur else {
            continue;
        };
        if m <= 0 || !n(at!(d.end)) {
            continue;
        }
        let j = d.end;
        let lo = amount_at(toks, &used, j, sport, Bare::No);
        if lo.is_some_and(|lo| !matches!(lo.dur, Dur::Time(_))) {
            continue;
        }
        let c = lo.map_or(j + 1, |lo| lo.end);
        let (mut a, mut b, mut end) = (None, None, j);
        if (p(at!(c), "-") || w(at!(c), &["a"]))
            && let Some(hi) = amount_at(toks, &used, c + 1, sport, Bare::No)
            && let Dur::Time(hs) = hi.dur
            && tv(c + 1) > 0.0
        {
            b = Some(hs);
            a = Some(lo.map_or_else(
                || whole(round(hs as f64 * tv(j) / tv(c + 1))),
                |lo| lo.dur.amount(),
            ));
            end = hi.end;
        }
        if a.is_none()
            && let Some(lo) = lo
        {
            a = Some(lo.dur.amount());
            end = lo.end;
        }
        let Some(a) = a.filter(|a| *a > 0) else {
            continue;
        };
        claim(&mut used, j, end);
        rep_time = Some((m, b.map_or(a, |b| a.min(b)), b.map(|b| a.max(b))));
    }

    let mut ftp: Option<(f64, f64)> = None;
    let mut power: Option<Tgt> = None;
    let mut hr: Option<Tgt> = None;
    let mut rpe: Option<Tgt> = None;
    let mut zone: Option<(i64, Option<i64>)> = None;
    let mut pace: Option<(f64, Option<f64>)> = None;
    let mut send_off: Option<i64> = None;
    let mut extra_notes: Vec<String> = Vec::new();
    for i in 0..nn {
        if ftp.is_some() {
            break;
        }
        if !n(at!(i)) {
            continue;
        }
        let (mut j, mut b) = (i + 1, tv(i));
        if range_conn(at!(j)) && n(at!(j + 1)) {
            b = tv(j + 1);
            j += 2;
        }
        if !p(at!(j), "%") {
            continue;
        }
        j += 1;
        while w(at!(j), &["do", "de", "da"]) {
            j += 1;
        }
        if !w(at!(j), &["ftp"]) || tv(i) < 1.0 || tv(i) >= 1000.0 || b < 1.0 || b >= 1000.0 {
            continue;
        }
        claim(&mut used, i, j + 1);
        ftp = Some((tv(i), b));
    }
    for i in 0..nn {
        if power.is_some() {
            break;
        }
        if !n(at!(i)) {
            continue;
        }
        let (mut j, mut b) = (i + 1, None);
        if range_conn(at!(j)) && n(at!(j + 1)) {
            b = Some(tv(j + 1));
            j += 2;
        }
        if !w(at!(j), &["w", "watts", "watt"]) || tv(i) > 3000.0 || b.is_some_and(|b| b > 3000.0) {
            continue;
        }
        claim(&mut used, i, j + 1);
        let a = whole(round(tv(i)));
        power = Some(match b {
            None => Tgt::Power { min: a, max: a },
            Some(b) => {
                let b = whole(round(b));
                Tgt::Power {
                    min: a.min(b),
                    max: a.max(b),
                }
            }
        });
    }
    // "FC até 150", "FC máx 160": a cap, kept as a note.
    for i in 0..nn {
        if !w(at!(i), &["fc", "frequência", "frequencia"]) {
            continue;
        }
        let mut j = i + 1;
        while w(at!(j), &["cardíaca", "cardiaca"]) || p(at!(j), ":") {
            j += 1;
        }
        if !w(
            at!(j),
            &["até", "ate", "abaixo", "máx", "max", "máxima", "maxima"],
        ) {
            continue;
        }
        j += 1;
        while w(at!(j), &["de", "da"]) {
            j += 1;
        }
        let c = at!(j);
        if !n(c) || val(c) < 40.0 || val(c) > 230.0 {
            continue;
        }
        let k = if w(at!(j + 1), &["bpm"]) {
            j + 2
        } else {
            j + 1
        };
        claim(&mut used, i, k);
        extra_notes.push(format!("FC até {}", whole(round(val(c)))));
        break;
    }
    for i in 0..nn {
        if hr.is_some() {
            break;
        }
        let mut j = i;
        if w(at!(i), &["fc", "frequência", "frequencia"]) {
            j = i + 1;
            while w(at!(j), &["cardíaca", "cardiaca", "de", "entre", "em", "a"]) || p(at!(j), ":")
            {
                j += 1;
            }
        } else if !n(at!(i)) {
            continue;
        }
        let t = at!(j);
        if !n(t) || val(t) < 40.0 || val(t) > 230.0 {
            continue;
        }
        let (mut k, mut b) = (j + 1, None);
        if range_conn(at!(k)) && n(at!(k + 1)) {
            b = Some(tv(k + 1));
            k += 2;
        }
        if w(at!(k), &["bpm"]) {
            k += 1;
        } else if j == i {
            continue; // a bare number needs "bpm"
        }
        claim(&mut used, i, k);
        let a = whole(round(val(t)));
        hr = Some(match b {
            None => Tgt::Hr { min: a, max: a },
            Some(b) => {
                let b = whole(round(b));
                Tgt::Hr {
                    min: a.min(b),
                    max: a.max(b),
                }
            }
        });
    }
    for i in 0..nn {
        if rpe.is_some() {
            break;
        }
        if !w(at!(i), &["pse", "rpe"]) {
            continue;
        }
        let mut j = i + 1;
        while w(at!(j), &["de"]) || p(at!(j), ":") {
            j += 1;
        }
        if !n(at!(j)) {
            continue;
        }
        let a = tv(j);
        let mut k = j + 1;
        if range_conn(at!(k)) && n(at!(k + 1)) {
            let b = tv(k + 1);
            if b != a && (1.0..=10.0).contains(&a) && (1.0..=10.0).contains(&b) {
                extra_notes.push(format!("PSE {}–{}", fmt_num(a), fmt_num(b)));
            }
            k += 2;
        }
        if p(at!(k), "/") && n(at!(k + 1)) && val(at!(k + 1)) == 10.0 {
            k += 2;
        }
        claim(&mut used, i, k);
        rpe = Some(Tgt::Rpe(whole(round(a)).clamp(1, 10), None));
    }
    for i in 0..nn {
        if zone.is_some() {
            break;
        }
        if !w(at!(i), &["z", "zona"]) {
            continue;
        }
        let t = at!(i + 1);
        if !int(t) || val(t) < 1.0 || val(t) > 5.0 {
            continue;
        }
        let (mut k, mut b) = (i + 2, None);
        if p(at!(k), "-")
            || p(at!(k), "/")
            || p(at!(k), ">")
            || w(at!(k), &["a", "ao", "até", "ate", "para"])
        {
            let m = if w(at!(k + 1), &["z", "zona"]) {
                k + 2
            } else {
                k + 1
            };
            let z = at!(m);
            if int(z) && (1.0..=5.0).contains(&val(z)) {
                b = Some(whole(val(z)));
                k = m + 1;
            }
        }
        claim(&mut used, i, k);
        zone = Some((whole(val(t)), b));
    }
    let mut metric = default_metric(sport);
    if zone.is_some() {
        for i in 0..nn {
            if w(at!(i), HR_WORDS) {
                metric = "hr";
                used[i as usize] = true;
            } else if w(at!(i), POWER_WORDS) {
                metric = "power";
                used[i as usize] = true;
            }
        }
    }
    for j in 0..nn {
        if pace.is_some() {
            break;
        }
        let Some((v1, v1_end)) = clock_at(toks, &used, j) else {
            continue;
        };
        let (mut start, mut marker) = (j, false);
        if p(at!(j - 1), "@") {
            start = j - 1;
            marker = sport != "swim";
        } else if w(at!(j - 1), &["ritmo", "pace"]) {
            start = j - 1;
            marker = true;
        } else if w(at!(j - 1), &["de", "em", "a", "no"]) && w(at!(j - 2), &["ritmo", "pace"]) {
            start = j - 2;
            marker = true;
        } else if w(at!(j - 1), &["a"]) && sport != "swim" {
            start = j - 1;
            marker = true;
        } else if w(at!(j - 1), &["entre", "de"]) {
            start = j - 1;
        }
        let (mut end, mut b) = (v1_end, None);
        if (p(at!(end), "-") || p(at!(end), ">") || w(at!(end), &["a", "até", "ate", "e", "para"]))
            && let Some((v2, e2)) = clock_at(toks, &used, end + 1)
        {
            b = Some(v2);
            end = e2;
        }
        let unit = pace_unit_at(toks, &used, end);
        if let Some((e, _)) = unit {
            end = e;
        }
        let ok = if sport == "swim" {
            unit.is_some_and(|(_, per100)| per100) || (marker && !p(at!(start), "@"))
        } else {
            marker || unit.is_some() || b.is_some()
        };
        if !ok {
            continue;
        }
        if start == j - 1 && w(at!(j - 1), &["entre", "de"]) && b.is_none() && unit.is_none() {
            start = j;
        }
        claim(&mut used, start, end);
        pace = Some((v1, b));
    }
    if sport == "swim" {
        for i in 0..nn {
            if send_off.is_some() {
                break;
            }
            let (k, start);
            if p(at!(i), "@") {
                (k, start) = (i + 1, i);
            } else if w(at!(i), &["saída", "saida", "saindo", "sai", "sair"]) {
                let mut kk = i + 1;
                while w(at!(kk), &["em", "a", "de", "com", "cada", "do"]) {
                    kk += 1;
                }
                (k, start) = (kk, i);
            } else if w(at!(i), &["cada"]) {
                (k, start) = (i + 1, if w(at!(i - 1), &["a"]) { i - 1 } else { i });
            } else {
                continue;
            }
            if let Some((c, end)) = clock_at(toks, &used, k) {
                claim(&mut used, start, end);
                send_off = Some(whole(c));
            } else if let Some(a) = amount_at(toks, &used, k, sport, Bare::No)
                && let Dur::Time(s) = a.dur
            {
                claim(&mut used, start, a.end);
                send_off = Some(s);
            }
        }
    }
    for i in 0..nn {
        let t = at!(i);
        if !n(t) || val(t) < 1.0 || val(t) >= 1000.0 {
            continue;
        }
        if w(at!(i + 1), &["km"]) && p(at!(i + 2), "/") && w(at!(i + 3), &["h"]) {
            claim(&mut used, i, i + 4);
            extra_notes.push(format!("{} km/h", fmt_num(val(t))));
        } else if w(at!(i + 1), &["rpm"]) {
            claim(&mut used, i, i + 2);
            if w(at!(i - 1), &["de"]) {
                used[(i - 1) as usize] = true;
            }
            extra_notes.push(format!("{} rpm", fmt_num(val(t))));
        }
    }
    for i in 0..nn {
        if w(at!(i), &["cadência", "cadencia"]) && extra_notes.iter().any(|x| x.ends_with("rpm")) {
            used[i as usize] = true;
        }
    }
    // An unmarked "4:30": a pace (a send-off in the pool).
    for j in 0..nn {
        let c = at!(j);
        if !clock(c) {
            continue;
        }
        if sport == "swim" && send_off.is_none() {
            send_off = Some(whole(val(c)));
            used[j as usize] = true;
        } else if sport != "swim" && pace.is_none() {
            pace = Some((val(c), None));
            used[j as usize] = true;
        }
    }

    let mut dur: Option<Dur> = None;
    // "30 a 40 min", "60-80m", "1h a 1h30": a range, {s, max_s} / {m, max_m} (the lower amount first).
    let mut dur_max: Option<i64> = None;
    for i in 0..nn {
        if dur.is_some() {
            break;
        }
        if !n(at!(i)) {
            continue;
        }
        let lo = amount_at(toks, &used, i, sport, Bare::No);
        let c = lo.map_or(i + 1, |lo| lo.end);
        if !(p(at!(c), "-") || w(at!(c), &["a", "até", "ate", "ou"])) {
            continue;
        }
        let Some(hi) = amount_at(toks, &used, c + 1, sport, Bare::No) else {
            continue;
        };
        if lo.is_some_and(|lo| !lo.dur.same_type(hi.dur)) || tv(c + 1) <= 0.0 {
            continue;
        }
        let f = tv(i) / tv(c + 1);
        let hv = hi.dur.amount();
        let lv = lo.map_or_else(|| whole(round(hv as f64 * f)), |lo| lo.dur.amount());
        if lv > MAX_AMOUNT {
            continue;
        }
        let (a, b) = (lv.min(hv), lv.max(hv));
        dur = Some(if matches!(hi.dur, Dur::Distance(_)) {
            Dur::Distance(a)
        } else {
            Dur::Time(a)
        });
        dur_max = (b > a).then_some(b);
        claim(&mut used, i, hi.end);
    }
    for i in 0..nn {
        if dur.is_some() {
            break;
        }
        if let Some(a) = amount_at(toks, &used, i, sport, bare) {
            claim(&mut used, i, a.end);
            dur = Some(a.dur);
        }
    }
    for i in 0..nn {
        if dur.is_some() {
            break;
        }
        if let Some(c) = at!(i).filter(|c| c.k == K::Clock && c.n == 3 && c.v <= MAX_AMOUNT as f64)
        {
            dur = Some(Dur::Time(whole(c.v)));
            used[i as usize] = true;
        }
    }

    // Intent words (aquecimento > desaquecimento > descanso > trote).
    let words = |used: &mut [bool], pred: &dyn Fn(&str) -> bool| {
        for i in 0..toks.len() {
            if !used[i] && toks[i].k == K::Word && pred(&toks[i].low) {
                used[i] = true;
                return true;
            }
        }
        false
    };
    let calma = |used: &mut [bool]| {
        for i in 0..nn {
            if w(at(toks, used, i), &["volta"])
                && w(at(toks, used, i + 1), &["à", "a"])
                && w(at(toks, used, i + 2), &["calma"])
            {
                claim(used, i, i + 3);
                return true;
            }
        }
        false
    };
    let mut intent: Option<&'static str> = None;
    if words(&mut used, &|w| w.starts_with("aquec") || w == "aq") {
        intent = Some("warmup");
    } else if words(&mut used, &|w| {
        w.starts_with("desaq") || ["soltar", "solto", "solta", "soltura", "soltando"].contains(&w)
    }) || calma(&mut used)
    {
        intent = Some("cooldown");
    } else if words(&mut used, &|w| {
        [
            "descanso",
            "desc",
            "parado",
            "parada",
            "pausa",
            "repouso",
            "descansar",
            "descansando",
        ]
        .contains(&w)
    }) {
        intent = Some("rest");
    } else if words(&mut used, &|w| {
        ["intervalo", "intervalos", "int"].contains(&w)
    }) {
        intent = Some(rest_intent(sport));
    } else if words(&mut used, &|w| {
        w.starts_with("trot")
            || w == "rec"
            || (w.starts_with("recupera") && !w.starts_with("recuperativ"))
            || w.starts_with("caminh")
            || w == "andando"
    }) {
        intent = Some("recovery");
    }
    let from_word = intent.is_some();
    let intent = intent.unwrap_or(if between.is_some() {
        rest_intent(sport)
    } else {
        fallback
    });

    // Notes from free words, swim stroke and equipment.
    let mut kw_notes: Vec<String> = Vec::new();
    for (ws, note) in NOTE_WORDS {
        if sport == "swim" && *note == "educativos" {
            continue;
        }
        if toks.iter().any(|t| w(Some(t), ws)) {
            kw_notes.push((*note).to_string());
            for (i, t) in toks.iter().enumerate() {
                if w(Some(t), ws) {
                    used[i] = true;
                }
            }
        }
    }
    let mut stroke: Option<&'static str> = None;
    let mut equipment: Vec<&'static str> = Vec::new();
    if sport == "swim" {
        for (ws, s) in STROKES {
            if stroke.is_none() && toks.iter().any(|t| w(Some(t), ws)) {
                stroke = Some(s);
            }
        }
        let pato = (0..nn).any(|i| {
            w(get(toks, i), &["pé", "pe"])
                && w(get(toks, i + 1), &["de"])
                && w(get(toks, i + 2), &["pato"])
        });
        for (ws, e) in EQUIPMENT {
            if toks.iter().any(|t| w(Some(t), ws)) || (*e == "fins" && pato) {
                equipment.push(e);
            }
        }
    }

    // Target: pace > power > % FTP > heart rate > zone > PSE > intensity words.
    let mut target: Option<Tgt> = None;
    if let Some((mut a, mut b)) = pace {
        // Under 2:30 it can't be a pace per km: it's the time for the rep ("8x400 @1:35").
        if let (None, "run", Some(Dur::Distance(m))) = (total, sport, dur)
            && m > 0
            && a.min(b.unwrap_or(a)) < 150.0
        {
            a = round(a * 1000.0 / m as f64);
            b = b.map(|b| round(b * 1000.0 / m as f64));
        }
        let a = whole(a);
        target = Some(match b {
            None => Tgt::Pace { min: a, max: a },
            Some(b) => {
                let b = whole(b);
                Tgt::Pace {
                    min: a.min(b),
                    max: a.max(b),
                }
            }
        });
    } else if let (Some((ts, _)), Some(Dur::Distance(m)), true) =
        (total, dur, sport == "run" || sport == "swim")
        && m > 0
    {
        let p = whole(round(
            ts * if sport == "swim" { 100.0 } else { 1000.0 } / m as f64,
        ));
        target = Some(Tgt::Pace { min: p, max: p });
    } else if let (Some((ts, true)), None, "run") = (total, dur, sport) {
        let t = whole(ts);
        target = Some(Tgt::Pace { min: t, max: t });
    } else if let Some((m, a, b)) = rep_time {
        let per = |s: i64| whole(round(s as f64 * 1000.0 / m as f64));
        target = Some(match b {
            None => Tgt::Pace {
                min: per(a),
                max: per(a),
            },
            Some(b) => Tgt::Pace {
                min: per(a),
                max: per(b),
            },
        });
    } else if let Some(pw) = &power {
        target = Some(pw.clone());
    } else if let Some((a, b)) = ftp {
        target = Some(Tgt::Zone {
            metric: "power",
            zone: ftp_zone((a + b) / 2.0),
        });
    } else if let Some(h) = &hr {
        target = Some(h.clone());
    } else if let Some((a, b)) = zone {
        target = Some(Tgt::Zone { metric, zone: a });
        if let Some(b) = b
            && b != a
            && !progression
        {
            extra_notes.push(format!("Z{a}–Z{b}"));
        }
    } else if let Some(r) = &rpe {
        target = Some(r.clone());
    }
    if let Some((a, b)) = ftp {
        let note = if a == b {
            format!("{}% do FTP", fmt_num(a))
        } else {
            format!("{}–{}% do FTP", fmt_num(a), fmt_num(b))
        };
        extra_notes.insert(0, note);
    }
    // Intensity words → PSE with the word as its label (never a zone: zones are what the coach writes as "Z4").
    if target.is_none() {
        let mut word: Option<(i64, &'static str)> = None;
        for (seq, v, label) in INTENSITY_PHRASES {
            if word.is_some() {
                break;
            }
            let len = seq.len() as isize;
            let mut i = 0;
            while i + len <= nn {
                if seq
                    .iter()
                    .enumerate()
                    .all(|(k, s)| w(at!(i + k as isize), &[s]))
                {
                    claim(&mut used, i, i + len);
                    word = Some((*v, label));
                    break;
                }
                i += 1;
            }
        }
        for (ws, v, label) in INTENSITY_WORDS.iter().chain(INTENSITY_NOUNS) {
            if word.is_none() && words(&mut used, &|w| ws.contains(&w)) {
                word = Some((*v, label));
            }
        }
        if word.is_none() {
            for i in 0..nn {
                if w(at!(i), &["vo"]) && n(at!(i + 1)) && tv(i + 1) == 2.0 {
                    claim(&mut used, i, i + 2);
                    word = Some((9, "VO2"));
                    break;
                }
            }
        }
        if word.is_none() {
            for i in 0..nn {
                if w(at!(i), &["tempo"]) && w(at!(i + 1), &["run"]) {
                    claim(&mut used, i, i + 2);
                    word = Some((7, "tempo run"));
                    break;
                }
            }
        }
        if word.is_none() && toks.iter().any(is_jog) {
            word = Some((3, "trote"));
        }
        if word.is_none() && toks.iter().any(is_walk) {
            word = Some((2, "caminhada"));
        }
        if let Some((v, label)) = word {
            target = Some(Tgt::Rpe(v, Some(label)));
        }
    }

    let note: Vec<String> = extra_notes
        .iter()
        .chain(&kw_notes)
        .chain(&paren_notes)
        .cloned()
        .collect();
    let has_duration = dur.is_some();
    let understood = has_duration
        || target.is_some()
        || from_word
        || stroke.is_some()
        || !equipment.is_empty()
        || send_off.is_some()
        || !kw_notes.is_empty()
        || !extra_notes.is_empty()
        || between.is_some();
    let make = |duration: Dur, dur_max: Option<i64>, target: Tgt| Step {
        intent,
        duration,
        dur_max,
        target,
        note: (!note.is_empty()).then(|| note.join("; ")),
        stroke,
        equipment: equipment.clone(),
        send_off,
    };

    let mut steps = vec![make(
        dur.unwrap_or(Dur::Open),
        dur_max,
        target.clone().unwrap_or(Tgt::Open),
    )];
    let mut expanded = false;
    if progression && let Some(d) = dur {
        let mut targets: Option<Vec<Tgt>> = None;
        if let (Some((a, Some(b))), None) = (pace, total) {
            targets = Some(
                (0..3)
                    .map(|k| {
                        let p = whole(round(a + (b - a) * k as f64 / 2.0));
                        Tgt::Pace { min: p, max: p }
                    })
                    .collect(),
            );
        } else if let Some((a, Some(b))) = zone
            && pace.is_none()
            && power.is_none()
            && ftp.is_none()
            && hr.is_none()
        {
            let step = if b >= a { 1 } else { -1 };
            let mut ts = Vec::new();
            let mut z = a;
            while z != b + step {
                ts.push(Tgt::Zone { metric, zone: z });
                z += step;
            }
            targets = Some(ts);
        } else if target.is_none() {
            targets = Some(
                (2..=4)
                    .map(|z| Tgt::Zone {
                        metric: default_metric(sport),
                        zone: z,
                    })
                    .collect(),
            );
        }
        if let Some(ts) = targets.filter(|ts| ts.len() > 1) {
            steps = split_parts(d, ts.len() as i64)
                .into_iter()
                .zip(ts)
                .enumerate()
                .map(|(k, (d, t))| {
                    let mut st = make(d, None, t);
                    if k > 0 {
                        st.note = None;
                    }
                    st
                })
                .collect();
            expanded = true;
        }
    }
    let modifier_only = !has_duration
        && !from_word
        && between.is_none()
        && !progression
        && (target.is_some()
            || stroke.is_some()
            || !equipment.is_empty()
            || send_off.is_some()
            || !note.is_empty());
    StepsResult {
        steps,
        understood,
        from_word,
        between,
        modifier_only,
        has_duration,
        progression: expanded,
        total: if expanded { dur } else { None },
        leftovers: leftovers(toks, &used),
    }
}

/// Fill the previous block's open fields from a modifier piece ("6x1km, ritmo de 4:30"). False on a conflict.
fn apply_mods(step: &mut Step, m: &Step) -> bool {
    if m.target != Tgt::Open {
        if step.target == Tgt::Open {
            step.target = m.target.clone();
        } else if step.target != m.target {
            return false;
        }
    }
    if let Some(note) = &m.note {
        step.note = Some(match &step.note {
            Some(s) => format!("{s}; {note}"),
            None => note.clone(),
        });
    }
    if m.stroke.is_some() && step.stroke.is_none() {
        step.stroke = m.stroke;
    }
    if !m.equipment.is_empty() {
        step.equipment = EQUIPMENT
            .iter()
            .map(|(_, e)| *e)
            .filter(|e| step.equipment.contains(e) || m.equipment.contains(e))
            .collect();
    }
    if m.send_off.is_some() && step.send_off.is_none() {
        step.send_off = m.send_off;
    }
    true
}
/// The repeat's active step (else its first).
fn main_step(steps: &mut [Step]) -> &mut Step {
    let k = steps.iter().position(|s| s.intent == "active").unwrap_or(0);
    &mut steps[k]
}
/// A rest between series: replaces the last rest of a flattened inner repeat, else goes last.
fn attach_series(steps: &mut Vec<Step>, rest: Step, last_from_inner: bool) {
    if last_from_inner && is_rest(steps.last()) {
        *steps.last_mut().expect("a last step") = rest;
    } else {
        steps.push(rest);
    }
}

// ------------------------------------------------------------------------------------ repeats

/// A count before a repeat word at `i`: "6x", "15-20x", "15 a 20 tiros" → (count, max, the word's index).
fn count_at(toks: &[Tok], i: usize) -> Option<(i64, Option<i64>, usize)> {
    let t = toks.get(i);
    if !int(t) || val(t) < 1.0 || val(t) > 200.0 {
        return None;
    }
    let u = toks.get(i + 2);
    if (p(toks.get(i + 1), "-") || w(toks.get(i + 1), &["a"]))
        && int(u)
        && (1.0..=200.0).contains(&val(u))
        && w(toks.get(i + 3), REPEAT_WORDS)
    {
        let (lo, hi) = (whole(val(t).min(val(u))), whole(val(t).max(val(u))));
        return Some((lo, (hi > lo).then_some(hi), i + 3));
    }
    w(toks.get(i + 1), REPEAT_WORDS).then_some((whole(val(t)), None, i + 1))
}
/// Where a repeat starts.
#[derive(Clone, Copy)]
struct Anchor {
    i: usize,
    count: i64,
    max: Option<i64>,
    /// The body's first token.
    j: usize,
}
/// "6x", "6 vezes", "seis tiros de", "3 séries de", "15-20x" at depth 0.
fn find_anchor(toks: &[Tok]) -> Option<Anchor> {
    let mut depth = 0usize;
    for (i, t) in toks.iter().enumerate() {
        let t1 = Some(t);
        if p(t1, "(") {
            depth += 1;
        } else if p(t1, ")") {
            depth = depth.saturating_sub(1);
        }
        if depth > 0 {
            continue;
        }
        let Some((count, max, wi)) = count_at(toks, i) else {
            continue;
        };
        let mut j = wi + 1;
        if w(toks.get(j), &["de"]) && !w(toks.get(wi), &["x"]) {
            j += 1;
        }
        if j < toks.len() {
            return Some(Anchor { i, count, max, j });
        }
    }
    None
}
/// A line that only opens a set ("3x", "15-20x", "3 séries:"): its lines follow → (count, max).
fn repeat_header(toks: &[Tok]) -> Option<(i64, Option<i64>)> {
    let (count, max, wi) = count_at(toks, 0)?;
    let mut j = wi + 1;
    while p(toks.get(j), ":") || w(toks.get(j), &["de"]) {
        j += 1;
    }
    (j == toks.len()).then_some((count, max))
}
/// A word that says "recovery" on its own ("trote", "caminhando", "descanso", "parado"…).
fn recovery_word(x: &Tok) -> bool {
    x.k == K::Word
        && (x.low.starts_with("trot")
            || x.low.starts_with("caminh")
            || RECOVERY_WORDS.contains(&x.low.as_str()))
}
/// A word that says "easy" ("leve", "solto", "regenerativo") or an easy zone ("Z1", "Z2").
fn easy_at(toks: &[Tok], k: usize) -> bool {
    let x = toks.get(k);
    if !is_word(x) {
        return false;
    }
    if w(x, &["z", "zona"]) {
        return int(toks.get(k + 1)) && val(toks.get(k + 1)) <= 2.0;
    }
    w(x, EASY_WORDS)
}
/// Where the recovery part of a repeat body starts: after a marker ("c/ 2' trote", "com 20\" de descanso",
/// "/ 1' leve", "- 2' trote"), or at a second amount followed by a recovery or easy word ("1' forte 1' leve").
fn recovery_split(body: &[Tok], sport: &str) -> Option<usize> {
    let none = vec![false; body.len()];
    let len = body.len() as isize;
    let has_amount = |from: isize| {
        (from..len).any(|k| amount_at(body, &none, k, sport, Bare::Recovery).is_some())
    };
    let first = (0..len).find_map(|k| amount_at(body, &none, k, sport, Bare::Active));
    for j in 1..len {
        let t = get(body, j);
        let slash = p(t, "/")
            && first.is_some_and(|f| f.end <= j)
            && !clock(get(body, j - 1))
            && !w(get(body, j - 1), &["min"])
            && amount_at(body, &none, j + 1, sport, Bare::No).is_some();
        let marker = (w(t, &["c"]) && p(get(body, j + 1), "/")) || w(t, RECOVERY_MARKERS) || slash;
        if marker && (has_amount(j) || body[(j + 1).min(len) as usize..].iter().any(recovery_word))
        {
            return Some(j as usize);
        }
    }
    let first = first?;
    for k in first.end..len {
        if amount_at(body, &none, k, sport, Bare::No).is_none() {
            continue;
        }
        if body[k as usize..].iter().any(recovery_word)
            || (k as usize..body.len()).any(|i| easy_at(body, i))
        {
            return Some(k as usize);
        }
        break;
    }
    None
}

struct RepeatResult {
    count: i64,
    max: Option<i64>,
    steps: Vec<Step>,
    before: Vec<Step>,
    nested: Option<i64>,
    last_from_inner: bool,
    warnings: Vec<String>,
}

/// A set's steps, `nested` (the inner count when it only holds one inner repeat) and `last_from_inner`.
type Group = (Vec<Step>, Option<i64>, bool);

/// Inside "N x ( … )": steps in order; inner repeats are flattened (the structure has one level of repeats).
fn parse_group(inner: &[Tok], sport: &str, warnings: &mut Vec<String>) -> Group {
    group_pieces(&segment(inner), sport, warnings)
}
/// The pieces of a set (in parentheses, or the lines under a "3x" line) → its steps.
fn group_pieces(pieces: &[Piece], sport: &str, warnings: &mut Vec<String>) -> Group {
    let mut steps: Vec<Step> = Vec::new();
    let (mut nested, mut last_from_inner, mut others) = (None, false, 0);
    for pc in pieces {
        match parse_repeat(&pc.toks, sport) {
            Some(Err(())) => {
                warnings.push(text_of(&pc.toks));
                continue;
            }
            Some(Ok(r)) => {
                if steps.len() + r.before.len() + r.count as usize * r.steps.len()
                    > MAX_REPEAT_STEPS
                {
                    warnings.push(text_of(&pc.toks));
                    continue;
                }
                warnings.extend(r.warnings);
                steps.extend(r.before);
                for _ in 0..r.count {
                    steps.extend(r.steps.iter().cloned());
                }
                nested = Some(r.count);
                last_from_inner = is_rest(steps.last());
                continue;
            }
            None => {}
        }
        let mut s = parse_steps(&pc.toks, sport, "active", Bare::Active);
        if !s.understood {
            warnings.push(text_of(&pc.toks));
            continue;
        }
        warnings.extend(std::mem::take(&mut s.leftovers));
        if s.between == Some(Between::Series) {
            attach_series(&mut steps, s.steps.swap_remove(0), last_from_inner);
            last_from_inner = false;
            continue;
        }
        if s.modifier_only && pc.soft && !steps.is_empty() {
            let prev = steps.last_mut().expect("a previous step");
            if !apply_mods(prev, &s.steps[0]) {
                warnings.push(text_of(&pc.toks));
            }
            continue;
        }
        let prev_active = steps.last().is_some_and(|x| x.intent == "active");
        if prev_active
            && !s.from_word
            && s.steps.len() == 1
            && is_easy(&s.steps[0])
            && !(sport == "swim" && matches!(s.steps[0].duration, Dur::Distance(_)))
        {
            s.steps[0].intent = rest_intent(sport);
        }
        steps.extend(s.steps);
        last_from_inner = false;
        others += 1;
    }
    (
        steps,
        if others == 0 { nested } else { None },
        last_from_inner,
    )
}

/// Alternating parts in one go: "100m (leve): 300m (3:50/km)", "2' caminhada: 4' corrida leve" → their steps in
/// order (each part one step with an amount); an easy part beside one that isn't easy is the recovery. `None` when
/// there's no ":" between amounts or a part isn't one step. → (steps, warnings).
fn colon_parts(toks: &[Tok], sport: &str) -> Option<(Vec<Step>, Vec<String>)> {
    let mut parts: Vec<Vec<Tok>> = vec![Vec::new()];
    let mut depth = 0usize;
    for t in toks {
        let t1 = Some(t);
        if p(t1, "(") {
            depth += 1;
        } else if p(t1, ")") {
            depth = depth.saturating_sub(1);
        }
        if depth == 0 && p(t1, ":") {
            parts.push(Vec::new());
        } else {
            parts.last_mut().expect("a part").push(t.clone());
        }
    }
    if parts.len() < 2 {
        return None;
    }
    let mut parsed = Vec::with_capacity(parts.len());
    for q in &parts {
        let none = vec![false; q.len()];
        let i = q.iter().position(|t| numish(Some(t)))?;
        amount_at(q, &none, i as isize, sport, Bare::No)?;
        let r = parse_steps(q, sport, "active", bare_of(q, sport));
        if !r.understood
            || r.steps.len() != 1
            || !r.has_duration
            || r.progression
            || r.between.is_some()
        {
            return None;
        }
        parsed.push(r);
    }
    let mut steps: Vec<Step> = parsed.iter().map(|r| r.steps[0].clone()).collect();
    if steps.iter().any(|st| !is_easy(st) && !is_rest(Some(st))) {
        for (k, st) in steps.iter_mut().enumerate() {
            if !parsed[k].from_word && st.intent == "active" && is_easy(st) {
                st.intent = rest_intent(sport);
            }
        }
    }
    let warnings = parsed.into_iter().flat_map(|r| r.leftovers).collect();
    Some((steps, warnings))
}
fn colon_round(body: &[Tok], sport: &str) -> Option<(Vec<Step>, Vec<String>)> {
    if body.iter().any(|t| p(Some(t), ":")) {
        colon_parts(body, sport)
    } else {
        None
    }
}

/// A repeat piece → the repeat, `Err` (not understood), or `None` (no "N x").
fn parse_repeat(toks: &[Tok], sport: &str) -> Option<Result<RepeatResult, ()>> {
    let an = find_anchor(toks)?;
    let (ai, count, aj) = (an.i, an.count, an.j);
    let (mut warnings, mut before) = (Vec::new(), Vec::new());
    let mut prefix: &[Tok] = &toks[..ai];
    let body = &toks[aj..];
    if prefix.iter().any(|t| numish(Some(t))) {
        let pr = parse_steps(
            prefix,
            sport,
            "active",
            if sport == "swim" {
                Bare::Active
            } else {
                Bare::No
            },
        );
        if pr.understood {
            before.extend(pr.steps);
            warnings.extend(pr.leftovers);
        } else {
            warnings.push(text_of(prefix));
        }
        prefix = &[];
    }
    let (mut steps, mut nested, mut last_from_inner) = (Vec::new(), None, false);
    if p(body.first(), "(") {
        let (mut d, mut k) = (0, 0);
        while k < body.len() {
            let x = body.get(k);
            if p(x, "(") {
                d += 1;
            } else if p(x, ")") {
                d -= 1;
                if d == 0 {
                    break;
                }
            }
            k += 1;
        }
        (steps, nested, last_from_inner) =
            parse_group(&body[1..k.min(body.len())], sport, &mut warnings);
        let trailing = &body[(k + 1).min(body.len())..];
        if !trailing.is_empty() && !steps.is_empty() {
            let r = parse_steps(trailing, sport, rest_intent(sport), Bare::Recovery);
            if r.understood && r.has_duration {
                attach_series(
                    &mut steps,
                    r.steps.into_iter().next().expect("a step"),
                    last_from_inner,
                );
                last_from_inner = false;
                warnings.extend(r.leftovers);
            } else if r.understood && r.modifier_only {
                if apply_mods(main_step(&mut steps), &r.steps[0]) {
                    warnings.extend(r.leftovers);
                } else {
                    warnings.push(text_of(trailing));
                }
            } else {
                warnings.push(text_of(trailing));
            }
        }
    } else if find_anchor(body).is_some_and(|a| a.i == 0) {
        let r = match parse_repeat(body, sport) {
            Some(Ok(r)) if r.count as usize * r.steps.len() <= MAX_REPEAT_STEPS => r,
            _ => return Some(Err(())),
        };
        warnings.extend(r.warnings);
        for _ in 0..r.count {
            steps.extend(r.steps.iter().cloned());
        }
        nested = Some(r.count);
        last_from_inner = is_rest(steps.last());
    } else if colon_round(body, sport).is_some() {
        // A label before the count ("Tiros: 11x 100m (leve): 300m") isn't a part of the round: without it, then.
        let with_prefix: Vec<Tok> = prefix.iter().chain(body).cloned().collect();
        let Some((s, w)) = colon_round(&with_prefix, sport).or_else(|| colon_round(body, sport))
        else {
            return Some(Err(()));
        };
        steps = s;
        warnings.extend(w);
    } else {
        let split = recovery_split(body, sport);
        let head: Vec<Tok> = prefix
            .iter()
            .chain(&body[..split.unwrap_or(body.len())])
            .cloned()
            .collect();
        let a = parse_steps(&head, sport, "active", Bare::Active);
        if !a.understood {
            return Some(Err(()));
        }
        steps.extend(a.steps);
        warnings.extend(a.leftovers);
        if let Some(split) = split {
            let r = parse_steps(&body[split..], sport, rest_intent(sport), Bare::Recovery);
            if r.understood {
                steps.extend(r.steps);
                warnings.extend(r.leftovers);
            } else {
                warnings.push(text_of(&body[split..]));
            }
        }
    }
    if steps.is_empty() || steps.len() > MAX_REPEAT_STEPS {
        return Some(Err(()));
    }
    Some(Ok(RepeatResult {
        count,
        max: an.max,
        steps,
        before,
        nested,
        last_from_inner,
        warnings,
    }))
}

// ------------------------------------------------------------------------------------ sets written over several lines

/// "Desc. 1'30\" & 3'": the rest after each run (`a`) and after the whole set (`b`).
struct Desc {
    a: Step,
    b: Option<Step>,
}
/// One part of a "Desc." line → its step. A time alone is a rest ("1'30\""); a distance, or an intensity word,
/// makes it an active recovery ("200m Trote": 200 m of jogging); a word can also say it ("1' parado", "2' trote").
fn desc_part(toks: &[Tok], sport: &str) -> Option<Step> {
    let none = vec![false; toks.len()];
    amount_at(toks, &none, 0, sport, Bare::Recovery)?;
    let s = parse_steps(toks, sport, "rest", Bare::Recovery);
    if !s.understood
        || s.steps.len() != 1
        || !s.has_duration
        || !s.leftovers.is_empty()
        || s.between.is_some()
        || s.progression
    {
        return None;
    }
    let mut st = s.steps.into_iter().next()?;
    if !s.from_word {
        st.intent = if matches!(st.duration, Dur::Distance(_)) || st.target != Tgt::Open {
            rest_intent(sport)
        } else {
            "rest"
        };
    }
    (st.intent == "rest" || st.intent == "recovery").then_some(st)
}
/// "Desc. 1'30\" & 3'", "Desc 1min", "Desc. 200m Trote".
fn desc_line(toks: &[Tok], sport: &str) -> Option<Desc> {
    if !w(toks.first(), DESC_WORDS) {
        return None;
    }
    let mut i = 1;
    while p(toks.get(i), ".") || p(toks.get(i), ":") || w(toks.get(i), &["de"]) {
        i += 1;
    }
    let amp = (i..toks.len()).find(|&k| p(toks.get(k), "&"));
    let a = desc_part(&toks[i.min(toks.len())..amp.unwrap_or(toks.len())], sport)?;
    let b = match amp {
        Some(k) => Some(desc_part(&toks[k + 1..], sport)?),
        None => None,
    };
    Some(Desc { a, b })
}
/// A rest after each run of a set (a step without a rest after it), and the set's own rest last: B replaces the
/// last A ("Desc. 1' & 2'"). Nothing to insert: the rest goes last. `None` when the set would get too long.
fn apply_desc(steps: &[Step], d: &Desc) -> Option<Vec<Step>> {
    let mut out: Vec<Step> = Vec::new();
    let (mut inserted, mut last_inserted) = (false, false);
    for (k, s) in steps.iter().enumerate() {
        out.push(s.clone());
        last_inserted = false;
        if !is_rest(Some(s)) && !is_rest(steps.get(k + 1)) {
            out.push(d.a.clone());
            inserted = true;
            last_inserted = true;
        }
    }
    let tail = d.b.as_ref().or(if inserted { None } else { Some(&d.a) });
    if let Some(tail) = tail {
        if last_inserted {
            *out.last_mut().expect("an inserted rest") = tail.clone();
        } else {
            out.push(tail.clone());
        }
    }
    (out.len() <= MAX_REPEAT_STEPS).then_some(out)
}
/// An easy step after the main work is the cool-down: an easy target (PSE ≤ 3, Z1–Z2), a recovery or a cool-down.
fn easy_step(s: &Step) -> bool {
    s.intent == "cooldown"
        || s.intent == "recovery"
        || (s.intent == "active" && s.target != Tgt::Open && is_easy(s))
}
/// A bare number is pool meters, or (with a recovery word: "/ 200 trote") a recovery amount.
fn bare_of(toks: &[Tok], sport: &str) -> Bare {
    if sport == "swim" {
        Bare::Active
    } else if toks.iter().any(recovery_word) {
        Bare::Recovery
    } else {
        Bare::No
    }
}
/// A line that is one easy step ("5' leve", "3' andando").
fn easy_line(toks: &[Tok], sport: &str) -> Option<Step> {
    if find_anchor(toks).is_some()
        || repeat_header(toks).is_some()
        || desc_line(toks, sport).is_some()
    {
        return None;
    }
    let s = parse_steps(toks, sport, "active", bare_of(toks, sport));
    (s.understood && s.steps.len() == 1 && easy_step(&s.steps[0])).then(|| s.steps[0].clone())
}
/// Short enough to be a set's recovery: up to 5 min or 1 km, and not a cool-down word.
fn short_easy(s: Option<&Step>) -> bool {
    s.is_some_and(|s| {
        s.intent != "cooldown"
            && match s.duration {
                Dur::Time(t) => t <= 300,
                Dur::Distance(m) => m <= 1000,
                Dur::Open => false,
            }
    })
}
/// The amount of the steps when they all have the type of `like` (else `None`).
fn steps_amount(steps: &[Step], like: Dur) -> Option<i64> {
    let mut sum = 0;
    for s in steps {
        if !s.duration.same_type(like) {
            return None;
        }
        sum += s.duration.amount();
    }
    Some(sum)
}
/// A named block's label and total ("Bloco do sábado", 30').
#[derive(Clone)]
struct Named {
    name: String,
    total: Dur,
}
/// A named block with a total ("Fartlek 28min", "Bloco do sábado 30min"): a line with only words and one amount,
/// no target, no intent word. Any words: they are only the block's label. It only counts when the lines after it
/// fill the total.
fn named_header(toks: &[Tok], sport: &str) -> Option<Named> {
    if find_anchor(toks).is_some()
        || repeat_header(toks).is_some()
        || desc_line(toks, sport).is_some()
    {
        return None;
    }
    let s = parse_steps(toks, sport, "active", Bare::No);
    let st = &s.steps[0];
    if !s.understood
        || s.steps.len() != 1
        || s.from_word
        || s.between.is_some()
        || s.progression
        || !s.has_duration
        || !s.leftovers.is_empty()
    {
        return None;
    }
    if st.intent != "active"
        || st.target != Tgt::Open
        || st.duration == Dur::Open
        || st.note.is_some()
        || st.stroke.is_some()
        || !st.equipment.is_empty()
        || st.send_off.is_some()
        || st.dur_max.is_some()
    {
        return None;
    }
    let none = vec![false; toks.len()];
    for i in 0..toks.len() {
        let Some(a) = amount_at(toks, &none, i as isize, sport, Bare::No) else {
            continue;
        };
        let rest: Vec<Tok> = toks[..i]
            .iter()
            .chain(&toks[a.end as usize..])
            .cloned()
            .collect();
        let rest = trim_name(&rest);
        if !rest.iter().any(|t| t.k == K::Word) || rest.iter().any(|t| numish(Some(t))) {
            return None;
        }
        return Some(Named {
            name: text_of(rest),
            total: st.duration,
        });
    }
    None
}
/// A set written over several lines: the repeat (or, for "1x", its steps), where the text goes on, and what it said.
struct SetResult {
    block: Option<(Block, Meta)>,
    steps: Vec<Step>,
    warnings: Vec<String>,
    end: usize,
    named: Option<Named>,
}
/// At a named header (pieces[k]): its block, when the lines after it fill its total. A repeat line that makes it
/// ("7x(3' + 1')"); a "7x" line and the lines that fit (count × their sum ≤ total, stopping when it's reached); or
/// one alternating pair "2' limiar / 1' trote" repeated as often as it fits.
fn named_block(pieces: &[Piece], k: usize, sport: &str) -> Option<SetResult> {
    let hdr = named_header(&pieces[k].toks, sport)?;
    let next = pieces.get(k + 1).filter(|x| !x.soft)?;
    let total = hdr.total.amount();
    let rh = repeat_header(&next.toks);
    let inline = if rh.is_some() {
        None
    } else {
        parse_repeat(&next.toks, sport)
    };
    if let Some(Ok(r)) = inline {
        // "Fartlek 28min" + "7x(3' + 1')": the repeat on the next line, when it makes the total.
        let sum = steps_amount(&r.steps, hdr.total).unwrap_or(0);
        if !r.before.is_empty() || sum == 0 || r.count * sum != total {
            return None;
        }
        let block = Block::Repeat {
            count: r.count,
            max_count: r.max,
            until_m: None,
            note: Some(hdr.name.clone()),
            steps: r.steps,
        };
        let meta = Meta {
            nested: r.nested,
            last_from_inner: r.last_from_inner,
            set: false,
        };
        return Some(SetResult {
            block: Some((block, meta)),
            steps: Vec::new(),
            warnings: r.warnings,
            end: k + 2,
            named: Some(hdr),
        });
    }
    if let Some((count, max)) = rh {
        let mut best: Option<(Group, Vec<String>, usize)> = None;
        for e in k + 2..pieces.len() {
            let pc = &pieces[e];
            if repeat_header(&pc.toks).is_some() || desc_line(&pc.toks, sport).is_some() {
                break;
            }
            let mut ws = Vec::new();
            let g = group_pieces(&pieces[k + 2..=e], sport, &mut ws);
            let Some(sum) = steps_amount(&g.0, hdr.total) else {
                break;
            };
            if g.0.is_empty() || count * sum > total {
                break;
            }
            best = Some((g, ws, e + 1));
            if count * sum == total {
                break;
            }
        }
        let ((steps, nested, last_from_inner), ws, end) = best?;
        let block = Block::Repeat {
            count,
            max_count: max,
            until_m: None,
            note: Some(hdr.name.clone()),
            steps,
        };
        let meta = Meta {
            nested,
            last_from_inner,
            set: true,
        };
        return Some(SetResult {
            block: Some((block, meta)),
            steps: Vec::new(),
            warnings: ws,
            end,
            named: Some(hdr),
        });
    }
    let second = pieces.get(k + 2).filter(|x| x.soft)?;
    if pieces.get(k + 3).is_some_and(|x| x.soft) {
        return None;
    }
    let one = |pc: &Piece| {
        if find_anchor(&pc.toks).is_some() || desc_line(&pc.toks, sport).is_some() {
            return None;
        }
        let s = parse_steps(&pc.toks, sport, "active", bare_of(&pc.toks, sport));
        (s.understood && s.steps.len() == 1 && !s.progression).then_some(s)
    };
    let (pa, pb) = (one(next)?, one(second)?);
    let (a, mut b) = (pa.steps[0].clone(), pb.steps[0].clone());
    let sum = steps_amount(&[a.clone(), b.clone()], hdr.total).unwrap_or(0);
    if sum == 0 || is_rest(Some(&a)) {
        return None;
    }
    let count = total / sum;
    if !(1..=200).contains(&count) {
        return None;
    }
    if !pb.from_word && b.intent == "active" && is_easy(&b) {
        b.intent = rest_intent(sport);
    }
    let block = Block::Repeat {
        count,
        max_count: None,
        until_m: None,
        note: Some(hdr.name.clone()),
        steps: vec![a, b],
    };
    let mut warnings = pa.leftovers;
    warnings.extend(pb.leftovers);
    Some(SetResult {
        block: Some((block, Meta::default())),
        steps: Vec::new(),
        warnings,
        end: k + 3,
        named: Some(hdr),
    })
}
/// At a "3x" line (pieces[k]): the set is the lines below it, up to a "Desc." line (which gives its rests), else up
/// to the next "3x" line, else to the end of the text minus the trailing easy lines (the cool-down).
fn header_set(pieces: &[Piece], k: usize, sport: &str) -> Option<SetResult> {
    let (count, max) = repeat_header(&pieces[k].toks)?;
    let (mut d, mut stop) = (None, pieces.len());
    for (e, pc) in pieces.iter().enumerate().skip(k + 1) {
        if repeat_header(&pc.toks).is_some() {
            stop = e;
            break;
        }
        // A "Desc." line closes the set; a pause beside a run ("400m | p: 1'") is that run's rest.
        if !pc.soft && desc_line(&pc.toks, sport).is_some() {
            d = Some(e);
            break;
        }
    }
    let mut end = d.unwrap_or(stop);
    if d.is_none() && stop == pieces.len() {
        while end > k + 1 && easy_line(&pieces[end - 1].toks, sport).is_some() {
            end -= 1;
        }
        // More than one easy line: the first one, when short, is the set's recovery ("1km forte / 2' trote / 10' desaq").
        if stop - end >= 2 && short_easy(easy_line(&pieces[end].toks, sport).as_ref()) {
            end += 1;
        }
    }
    if end == k + 1 {
        return None;
    }
    let mut warnings = Vec::new();
    let (mut steps, nested, last_from_inner) =
        group_pieces(&pieces[k + 1..end], sport, &mut warnings);
    if steps.is_empty() {
        return None;
    }
    let mut next = end;
    if let Some(d) = d {
        let desc = desc_line(&pieces[d].toks, sport).expect("a desc line");
        match apply_desc(&steps, &desc) {
            Some(with_rest) => steps = with_rest,
            None => warnings.push(text_of(&pieces[d].toks)),
        }
        next = d + 1;
    }
    if count == 1 && max.is_none() {
        return Some(SetResult {
            block: None,
            steps,
            warnings,
            end: next,
            named: None,
        });
    }
    let meta = Meta {
        nested,
        last_from_inner: last_from_inner && d.is_none(),
        set: true,
    };
    let block = Block::Repeat {
        count,
        max_count: max,
        until_m: None,
        note: None,
        steps,
    };
    Some(SetResult {
        block: Some((block, meta)),
        steps: Vec::new(),
        warnings,
        end: next,
        named: None,
    })
}

/// "3x-600m | p: 1'30\"" + "400m | p: 1'" + "200m | P: 1'": a count tied to the first run by "-" opens a set over the
/// lines below it, like a "3x" line above them → the count as its own piece and the run as the set's first line.
fn dash_sets(pieces: Vec<Piece>) -> Vec<Piece> {
    let mut out = Vec::with_capacity(pieces.len());
    for pc in pieces {
        let c = if pc.soft { None } else { count_at(&pc.toks, 0) };
        if let Some((_, _, wi)) = c
            && p(pc.toks.get(wi + 1), "-")
            && wi + 2 < pc.toks.len()
            && numish(pc.toks.get(wi + 2))
        {
            out.push(Piece {
                toks: pc.toks[..=wi].to_vec(),
                soft: false,
            });
            out.push(Piece {
                toks: pc.toks[wi + 2..].to_vec(),
                soft: false,
            });
        } else {
            out.push(pc);
        }
    }
    out
}

/// s/km by zone 1–5, the estimates' generic athlete (domain/workout.ts).
const RUN_ZONE_PACE: [f64; 5] = [390.0, 345.0, 310.0, 285.0, 260.0];
/// Meters a run step covers: its distance, or its time at its pace (else the zone's generic pace).
fn step_meters(st: &Step) -> f64 {
    let s = match st.duration {
        Dur::Distance(m) => return m as f64,
        Dur::Time(s) => s as f64,
        Dur::Open => 0.0,
    };
    let pace = match st.target {
        Tgt::Pace { min, max } => (min + max) as f64 / 2.0,
        ref t => RUN_ZONE_PACE[(zone_of(t) - 1).clamp(0, 4) as usize],
    };
    s * 1000.0 / pace
}
/// A total and an alternating pair on one line: "3.5km 2' caminhada: 4' corrida leve", "4.5km - 3' (4:35/km) : 5'
/// (4:18/km)", "40' - 3' forte : 2' leve" → the pair repeated to cover the total. Same unit: as often as it fits. A
/// distance of timed parts (runs): as many rounds as it takes at their paces (written, else the zones' generic
/// ones), repeated until the distance (`until_m`).
fn total_pair(pieces: &[Piece], k: usize, sport: &str) -> Option<SetResult> {
    let pc = &pieces[k];
    if pc.soft || find_anchor(&pc.toks).is_some() || repeat_header(&pc.toks).is_some() {
        return None;
    }
    let none = vec![false; pc.toks.len()];
    let tot = amount_at(&pc.toks, &none, 0, sport, Bare::No)?;
    if !matches!(tot.dur, Dur::Distance(_) | Dur::Time(_)) {
        return None;
    }
    let rest_toks = &pc.toks[tot.end as usize..];
    let (parts, end) = if rest_toks.is_empty() {
        (
            [
                pieces.get(k + 1).map(|x| &x.toks[..]),
                pieces.get(k + 2).map(|x| &x.toks[..]),
            ],
            k + 3,
        )
    } else {
        (
            [Some(rest_toks), pieces.get(k + 1).map(|x| &x.toks[..])],
            k + 2,
        )
    };
    let [Some(qa), Some(qb)] = parts else {
        return None;
    };
    if pieces[k + 1..end].iter().any(|x| !x.soft) || pieces.get(end).is_some_and(|x| x.soft) {
        return None;
    }
    let one = |q: &[Tok]| {
        let none = vec![false; q.len()];
        if !numish(q.first()) || amount_at(q, &none, 0, sport, Bare::No).is_none() {
            return None;
        }
        let r = parse_steps(q, sport, "active", bare_of(q, sport));
        (r.understood
            && r.steps.len() == 1
            && r.has_duration
            && !r.progression
            && r.between.is_none())
        .then_some(r)
    };
    let pair = [one(qa)?, one(qb)?];
    let mut ab = [pair[0].steps[0].clone(), pair[1].steps[0].clone()];
    if is_rest(Some(&ab[0])) && is_rest(Some(&ab[1])) {
        return None;
    }
    let total = tot.dur.amount();
    let (count, until_m) = match steps_amount(&ab, tot.dur).filter(|&x| x != 0) {
        Some(same) => ((total as f64 / same as f64).floor(), None),
        None if matches!(tot.dur, Dur::Distance(_))
            && sport == "run"
            && matches!(ab[0].duration, Dur::Time(_))
            && matches!(ab[1].duration, Dur::Time(_)) =>
        {
            (
                (total as f64 / (step_meters(&ab[0]) + step_meters(&ab[1])) - 1e-9).ceil(),
                Some(total),
            )
        }
        None => return None,
    };
    if !(1.0..=200.0).contains(&count) {
        return None;
    }
    // An easy part beside a harder one is its recovery ("40' - 3' forte : 2' leve"); a walk already is.
    for i in 0..2 {
        let other = &ab[1 - i];
        let harder = !is_easy(other) && !is_rest(Some(other));
        let st = &ab[i];
        if !pair[i].from_word && st.intent == "active" && is_easy(st) && harder {
            ab[i].intent = rest_intent(sport);
        }
    }
    let walk = ab
        .iter()
        .any(|st| matches!(st.target, Tgt::Rpe(_, Some("caminhada"))));
    let warnings = pair.into_iter().flat_map(|r| r.leftovers).collect();
    Some(SetResult {
        block: Some((
            Block::Repeat {
                count: whole(count),
                max_count: None,
                until_m,
                note: None,
                steps: ab.to_vec(),
            },
            Meta::default(),
        )),
        steps: Vec::new(),
        warnings,
        end,
        named: Some(Named {
            name: if walk {
                "Caminhada e corrida"
            } else {
                "Fartlek"
            }
            .into(),
            total: tot.dur,
        }),
    })
}

// ------------------------------------------------------------------------------------ exercises (strength, mobility)

#[derive(Clone, Debug)]
enum Load {
    Kg(f64),
    Pct(f64),
    Rpe(f64),
    Bodyweight,
}

#[derive(Clone, Debug)]
struct Exercise {
    name: String,
    sets: i64,
    reps: String,
    load: Option<Load>,
    rest_s: Option<i64>,
    tempo: Option<String>,
    note: Option<String>,
}

impl Exercise {
    fn json(&self) -> Value {
        let mut m = Map::new();
        m.insert("kind".into(), json!("exercise"));
        m.insert("name".into(), json!(self.name));
        m.insert("sets".into(), json!(self.sets));
        m.insert("reps".into(), json!(self.reps));
        if let Some(load) = &self.load {
            m.insert(
                "load".into(),
                match load {
                    Load::Kg(v) => json!({ "type": "kg", "value": number(*v) }),
                    Load::Pct(v) => json!({ "type": "pct_1rm", "value": number(*v) }),
                    Load::Rpe(v) => json!({ "type": "rpe", "value": number(*v) }),
                    Load::Bodyweight => json!({ "type": "bodyweight" }),
                },
            );
        }
        if let Some(r) = self.rest_s {
            m.insert("rest_s".into(), json!(r));
        }
        if let Some(t) = &self.tempo {
            m.insert("tempo".into(), json!(t));
        }
        if let Some(n) = &self.note {
            m.insert("note".into(), json!(n));
        }
        Value::Object(m)
    }
}

fn trim_name(toks: &[Tok]) -> &[Tok] {
    let (mut a, mut b) = (0, toks.len());
    loop {
        if a < b && toks[a].k == K::P {
            a += 1;
        } else if a + 1 < b
            && n(toks.get(a))
            && (p(toks.get(a + 1), ".") || p(toks.get(a + 1), ")") || p(toks.get(a + 1), "-"))
        {
            a += 2;
        } else if a < b && w(toks.get(a), LEAD_FILLERS) {
            a += 1;
        } else {
            break;
        }
    }
    while b > a && (toks[b - 1].k == K::P || w(toks.get(b - 1), TRAIL_FILLERS)) {
        b -= 1;
    }
    &toks[a..b]
}
/// Rest after "desc", "descanso"…: 90" / 1'30 / 2 min / 1:30; a bare number is seconds (minutes up to 5).
fn rest_at(toks: &[Tok], used: &[bool], i: isize, bare_ok: bool) -> Option<(i64, isize)> {
    let at = |j: isize| at(toks, used, j);
    let t = at(i);
    if clock(t) {
        return Some((whole(val(t)), i + 1));
    }
    if !n(t) {
        return None;
    }
    let u = at(i + 1);
    let capped =
        |s: f64, end: isize| (round(s) <= MAX_AMOUNT as f64).then(|| (whole(round(s)), end));
    if p(u, "'") || w(u, MINUTES) {
        let (mut s, mut end) = (val(t) * 60.0, i + 2);
        let x = at(end);
        let secs = p(at(end + 1), "\"") || w(at(end + 1), SECONDS);
        if int(x) && val(x) < 60.0 && (!x.is_some_and(|x| x.sp) || secs) {
            s += val(x);
            end += if secs { 2 } else { 1 };
        }
        return capped(s, end);
    }
    if p(u, "\"") || w(u, SECONDS) {
        return capped(val(t), i + 2);
    }
    if !bare_ok {
        return None;
    }
    capped(if val(t) <= 5.0 { val(t) * 60.0 } else { val(t) }, i + 1)
}

struct Attrs {
    load: Option<Load>,
    rest_s: Option<i64>,
    tempo: Option<String>,
    notes: Vec<String>,
    found: bool,
    all: bool,
    leftovers: Vec<String>,
}

/// Load, rest, tempo and notes of an exercise. `all`: nothing else in the tokens (a piece that only adds to the
/// previous exercise).
fn parse_attrs(toks0: &[Tok]) -> Attrs {
    let (toks, paren_notes) = take_parens(toks0, false);
    let toks = &toks[..];
    let mut used = vec![false; toks.len()];
    let nn = toks.len() as isize;
    macro_rules! at {
        ($j:expr) => {
            at(toks, &used, $j)
        };
    }
    let tv = |i: isize| val(get(toks, i));
    let (mut load, mut rest, mut tempo) = (None, None, None);
    let mut notes: Vec<String> = Vec::new();
    for i in 0..nn {
        if load.is_some() {
            break;
        }
        if !n(at!(i)) {
            continue;
        }
        let mut j = i + 1;
        if range_conn(at!(j)) && n(at!(j + 1)) {
            j += 2;
        }
        if w(at!(j), KG) {
            claim(&mut used, i, j + 1);
            load = Some(Load::Kg(tv(i)));
            break;
        }
        if !p(at!(j), "%") {
            continue;
        }
        j += 1;
        while w(at!(j), &["de", "do", "da"]) {
            j += 1;
        }
        if n(at!(j)) && tv(j) == 1.0 && w(at!(j + 1), &["rm"]) {
            j += 2;
        } else if w(at!(j), &["rm"]) {
            j += 1;
        }
        claim(&mut used, i, j);
        load = Some(Load::Pct(tv(i)));
    }
    for i in 0..nn {
        if load.is_some() {
            break;
        }
        if w(at!(i), &["pse", "rpe"]) && n(at!(i + 1)) {
            claim(&mut used, i, i + 2);
            load = Some(Load::Rpe(tv(i + 1)));
        } else if w(at!(i), &["pc", "bodyweight"]) {
            claim(&mut used, i, i + 1);
            load = Some(Load::Bodyweight);
        } else if w(at!(i), &["peso"]) && w(at!(i + 1), &["corporal"]) {
            claim(&mut used, i, i + 2);
            load = Some(Load::Bodyweight);
        } else if w(at!(i), &["peso"]) && w(at!(i + 1), &["do"]) && w(at!(i + 2), &["corpo"]) {
            claim(&mut used, i, i + 3);
            load = Some(Load::Bodyweight);
        } else if w(at!(i), &["sem"]) && w(at!(i + 1), &["carga", "peso"]) {
            claim(&mut used, i, i + 2);
            load = Some(Load::Bodyweight);
        }
    }
    for i in 0..nn {
        if rest.is_some() {
            break;
        }
        if w(at!(i), REST_WORDS) {
            let mut j = i + 1;
            while w(at!(j), &["de"]) || p(at!(j), ":") {
                j += 1;
            }
            if let Some((s, end)) = rest_at(toks, &used, j, true) {
                claim(&mut used, i, end);
                rest = Some(s);
            }
            continue;
        }
        let Some((s, end)) = rest_at(toks, &used, i, false) else {
            continue;
        };
        let k = if w(at!(end), &["de"]) { end + 1 } else { end };
        if w(at!(k), &["descanso", "intervalo", "pausa", "desc"]) {
            claim(&mut used, i, k + 1);
            rest = Some(s);
        }
    }
    for i in 0..nn {
        if tempo.is_some() {
            break;
        }
        if !w(at!(i), &["tempo", "cadência", "cadencia"]) {
            continue;
        }
        let mut j = i + 1;
        if p(at!(j), ":") {
            j += 1;
        }
        if !n(at!(j)) {
            continue;
        }
        let mut k = j + 1;
        while p(at!(k), "-") && n(at!(k + 1)) {
            k += 2;
        }
        tempo = Some(text_of(&toks[j as usize..(k as usize).min(toks.len())]));
        claim(&mut used, i, k);
    }
    for i in 0..nn {
        let next = at!(i + 1);
        if w(at!(i), &["cada"]) && is_word(next) {
            notes.push(format!("cada {}", next.map_or("", |x| x.low.as_str())));
            claim(&mut used, i, i + 2);
        } else if w(at!(i), &["por"]) && w(next, SIDE_WORDS) {
            notes.push(format!("por {}", next.map_or("", |x| x.low.as_str())));
            claim(&mut used, i, i + 2);
        } else if w(at!(i), &["unilateral"]) {
            notes.push("unilateral".into());
            claim(&mut used, i, i + 1);
        }
    }
    let found = load.is_some() || rest.is_some() || tempo.is_some() || !notes.is_empty();
    let all = toks
        .iter()
        .enumerate()
        .all(|(i, t)| used[i] || t.k == K::P || w(Some(t), ATTR_FILLERS));
    notes.extend(paren_notes);
    Attrs {
        load,
        rest_s: rest,
        tempo,
        notes,
        found,
        all,
        leftovers: leftovers(toks, &used),
    }
}
/// "Agachamento 4x8 70% desc 90\"", "4 séries de 10 supino", "Prancha 3x45s pc" → the exercise and leftovers.
fn parse_exercise(toks: &[Tok]) -> Option<(Exercise, Vec<String>)> {
    let mut depth = 0usize;
    for (i, c) in toks.iter().enumerate() {
        let c1 = Some(c);
        if p(c1, "(") {
            depth += 1;
        } else if p(c1, ")") {
            depth = depth.saturating_sub(1);
        }
        if depth > 0 || !int(c1) || c.v < 1.0 || c.v > 50.0 {
            continue;
        }
        let mut j = i + 1;
        if w(toks.get(j), &["x"]) {
            j += 1;
        } else if w(toks.get(j), SETS_WORDS) {
            j += 1;
            if w(toks.get(j), &["de"]) {
                j += 1;
            }
        } else {
            continue;
        }
        let r = toks.get(j);
        let (mut reps, mut end);
        if w(r, &["máx", "max", "máximo", "maximo", "falha"]) {
            (reps, end) = ("máx".to_string(), j + 1);
        } else if int(r) && val(r) <= 1000.0 {
            (reps, end) = (whole(val(r)).to_string(), j + 1);
            let hi = toks.get(end + 1);
            if (p(toks.get(end), "-") || w(toks.get(end), &["a"]))
                && int(hi)
                && val(hi) <= 1000.0
                && !w(toks.get(end + 2), KG)
                && !p(toks.get(end + 2), "%")
            {
                reps = format!("{reps}-{}", whole(val(hi)));
                end += 2;
            }
            if p(toks.get(end), "\"") || w(toks.get(end), SECONDS) {
                reps.push_str(" s");
                end += 1;
            } else if p(toks.get(end), "'") || w(toks.get(end), MINUTES) {
                reps.push_str(" min");
                end += 1;
            } else if w(toks.get(end), REPS_WORDS) {
                end += 1;
            }
        } else {
            continue;
        }
        let end = end.min(toks.len());
        let mut name = trim_name(&toks[..i]);
        let mut after = &toks[end..];
        if name.is_empty() {
            let mut k = 0;
            while k < after.len() && after[k].k == K::Word && !is_attr_word(&after[k].low) {
                k += 1;
            }
            name = trim_name(&after[..k]);
            after = &after[k..];
        }
        if name.is_empty() {
            return None;
        }
        let text = text_of(name);
        let mut chars = text.chars();
        let name = chars
            .next()
            .map(|f| f.to_uppercase().chain(chars).collect())
            .unwrap_or_default();
        let at = parse_attrs(after);
        let ex = Exercise {
            name,
            sets: whole(c.v),
            reps,
            load: at.load,
            rest_s: at.rest_s,
            tempo: at.tempo,
            note: (!at.notes.is_empty()).then(|| at.notes.join("; ")),
        };
        return Some((ex, at.leftovers));
    }
    None
}
fn is_attr_word(l: &str) -> bool {
    KG.contains(&l) || REST_WORDS.contains(&l) || ATTR_WORDS.contains(&l)
}
fn merge_attrs(ex: &mut Exercise, at: Attrs) {
    if ex.load.is_none() {
        ex.load = at.load;
    }
    if ex.rest_s.is_none() {
        ex.rest_s = at.rest_s;
    }
    if ex.tempo.is_none() {
        ex.tempo = at.tempo;
    }
    if !at.notes.is_empty() {
        let mut all: Vec<String> = ex
            .note
            .take()
            .filter(|s| !s.is_empty())
            .into_iter()
            .collect();
        all.extend(at.notes);
        ex.note = Some(all.join("; "));
    }
}

// ------------------------------------------------------------------------------------ the workout

#[derive(Clone, Debug)]
enum Block {
    Step(Step),
    /// `max_count`: "15-20x" (the athlete picks); `until_m`: repeated until that distance; `note`: a named block's
    /// label ("Bloco do sábado").
    Repeat {
        count: i64,
        max_count: Option<i64>,
        until_m: Option<i64>,
        note: Option<String>,
        steps: Vec<Step>,
    },
    Exercise(Exercise),
}

impl Block {
    fn json(&self) -> Value {
        match self {
            Block::Step(s) => s.json(),
            Block::Repeat {
                count,
                max_count,
                until_m,
                note,
                steps,
            } => {
                let mut v = json!({ "kind": "repeat", "count": count, "steps": steps.iter().map(Step::json).collect::<Vec<_>>() });
                if let Some(max) = max_count {
                    v["max_count"] = json!(max);
                }
                if let Some(m) = until_m {
                    v["until_m"] = json!(m);
                }
                if let Some(note) = note {
                    v["note"] = json!(note);
                }
                v
            }
            Block::Exercise(e) => e.json(),
        }
    }
}

/// `set`: a set written over several lines (named by what each round adds up to).
#[derive(Clone, Copy, Default)]
struct Meta {
    nested: Option<i64>,
    last_from_inner: bool,
    set: bool,
}

struct Hints {
    long: bool,
    fartlek: bool,
    progressive: bool,
    progression: Option<Dur>,
    named: Option<Named>,
}

fn assemble(
    pieces: &[Piece],
    sport: &str,
    warnings: &mut Vec<String>,
    hints: &mut Hints,
) -> (Vec<Block>, Vec<Meta>) {
    let (mut blocks, mut meta): (Vec<Block>, Vec<Meta>) = (Vec::new(), Vec::new());
    let strength_like = sport == "strength" || sport == "mobility";
    let mut k = 0;
    while k < pieces.len() {
        let piece = &pieces[k];
        k += 1;
        let text = text_of(&piece.toks);
        if strength_like {
            if let Some((ex, left)) = parse_exercise(&piece.toks) {
                blocks.push(Block::Exercise(ex));
                meta.push(Meta::default());
                warnings.extend(left);
                continue;
            }
            let at = parse_attrs(&piece.toks);
            if at.found && at.all {
                match blocks.last_mut() {
                    Some(Block::Exercise(ex)) if piece.soft => merge_attrs(ex, at),
                    _ => warnings.push(text),
                }
                continue;
            }
        } else {
            // A total and an alternating pair: "4.5km - 3' (4:35/km) : 5' (4:18/km)". Sets over several lines:
            // "Fartlek 28min" + "7x" + lines, "3x" + lines + "Desc. 1' & 2'".
            let set = total_pair(pieces, k - 1, sport)
                .or_else(|| named_block(pieces, k - 1, sport))
                .or_else(|| {
                    repeat_header(&piece.toks)
                        .is_some()
                        .then(|| header_set(pieces, k - 1, sport))
                        .flatten()
                });
            if let Some(set) = set {
                warnings.extend(set.warnings);
                match set.block {
                    Some((b, m)) => {
                        blocks.push(b);
                        meta.push(m);
                    }
                    None => {
                        for st in set.steps {
                            blocks.push(Block::Step(st));
                            meta.push(Meta::default());
                        }
                    }
                }
                if hints.named.is_none() {
                    hints.named = set.named;
                }
                k = set.end;
                continue;
            }
            // "4x4x150m" + "Desc. 1'30\" & 2'30\"": the rests of the repeat above (when it has none).
            if let (Some(dl), Some(Block::Repeat { steps, .. })) =
                (desc_line(&piece.toks, sport), blocks.last_mut())
                && !steps.iter().any(|x| is_rest(Some(x)))
                && let Some(with_rest) = apply_desc(steps, &dl)
            {
                *steps = with_rest;
                if let Some(m) = meta.last_mut() {
                    m.last_from_inner = false;
                }
                continue;
            }
            match parse_repeat(&piece.toks, sport) {
                Some(Err(())) => {
                    warnings.push(text);
                    continue;
                }
                Some(Ok(r)) => {
                    warnings.extend(r.warnings);
                    for st in r.before {
                        blocks.push(Block::Step(st));
                        meta.push(Meta::default());
                    }
                    if r.count == 1 && r.max.is_none() {
                        for st in r.steps {
                            blocks.push(Block::Step(st));
                            meta.push(Meta::default());
                        }
                    } else {
                        blocks.push(Block::Repeat {
                            count: r.count,
                            max_count: r.max,
                            until_m: None,
                            note: None,
                            steps: r.steps,
                        });
                        meta.push(Meta {
                            nested: r.nested,
                            last_from_inner: r.last_from_inner,
                            set: false,
                        });
                    }
                    continue;
                }
                None => {}
            }
        }
        let mut s = parse_steps(&piece.toks, sport, "active", bare_of(&piece.toks, sport));
        if !s.understood {
            warnings.push(text);
            continue;
        }
        warnings.extend(std::mem::take(&mut s.leftovers));
        let one = s.steps.len() == 1;
        if let (Some(Between::Series), Some(Block::Repeat { steps, .. })) =
            (s.between, blocks.last_mut())
        {
            let m = meta.last_mut().expect("meta for each block");
            attach_series(steps, s.steps.swap_remove(0), m.last_from_inner);
            m.last_from_inner = false;
            continue;
        }
        if let Some(Block::Repeat { steps, .. }) = blocks.last_mut() {
            if one
                && is_rest(s.steps.first())
                && (s.from_word || s.between.is_some())
                && !steps.iter().any(|x| is_rest(Some(x)))
                && (piece.soft || s.between == Some(Between::Reps))
            {
                steps.push(s.steps.swap_remove(0));
                continue;
            }
            // "10x1' forte, 1' leve": a short easy piece right after a repeat without a rest is its recovery.
            if one
                && !s.from_word
                && piece.soft
                && steps.len() == 1
                && !is_easy(&steps[0])
                && short_recovery(&s.steps[0], sport)
            {
                let mut st = s.steps.swap_remove(0);
                st.intent = rest_intent(sport);
                steps.push(st);
                continue;
            }
        }
        if s.modifier_only && piece.soft {
            let target = match blocks.last_mut() {
                Some(Block::Step(st)) => Some(st),
                Some(Block::Repeat { steps, .. }) => Some(main_step(steps)),
                _ => None,
            };
            if let Some(st) = target {
                if !apply_mods(st, &s.steps[0]) {
                    warnings.push(text);
                }
                continue;
            }
        }
        if s.progression && hints.progression.is_none() {
            hints.progression = s.total;
        }
        for st in s.steps {
            blocks.push(Block::Step(st));
            meta.push(Meta::default());
        }
    }
    if !strength_like {
        cool_down(&mut blocks);
    }
    (blocks, meta)
}
/// The easy steps after the main work (a repeat, or an active step that isn't easy) are the cool-down.
fn cool_down(blocks: &mut [Block]) {
    let easy = |b: &Block| matches!(b, Block::Step(s) if easy_step(s));
    let mut k = blocks.len();
    while k > 0 && easy(&blocks[k - 1]) {
        k -= 1;
    }
    let main = blocks[..k].iter().any(|b| match b {
        Block::Repeat { .. } => true,
        Block::Step(s) => s.intent == "active" && !easy_step(s),
        Block::Exercise(_) => false,
    });
    if !main {
        return;
    }
    for b in &mut blocks[k..] {
        if let Block::Step(s) = b {
            s.intent = "cooldown";
        }
    }
}

/// "8 km", "1h20", "30'"; a range shares its unit: "60–80 m", "30–40'", "800 m–1 km".
fn amount_range(d: Dur, max: Option<i64>) -> String {
    let a = amount_text(d);
    let Some(max) = max else {
        return a;
    };
    let b = amount_text(match d {
        Dur::Distance(_) => Dur::Distance(max),
        _ => Dur::Time(max),
    });
    for u in [" km", " m", "'", "\""] {
        if let Some(head) = a.strip_suffix(u)
            && b.ends_with(u)
            && !head.is_empty()
            && head.chars().all(|c| c.is_ascii_digit() || c == ',')
        {
            return format!("{head}–{b}");
        }
    }
    format!("{a}–{b}")
}
fn amount_text(d: Dur) -> String {
    match d {
        Dur::Distance(m) if m >= 1000 => format!(
            "{} km",
            (m as f64 / 1000.0).to_string().replacen('.', ",", 1)
        ),
        Dur::Distance(m) => format!("{m} m"),
        Dur::Time(s) if s < 60 => format!("{s}\""),
        Dur::Time(s) if s < 3600 => {
            if s % 60 == 0 {
                format!("{}'", s / 60)
            } else {
                format!("{}'{:02}\"", s / 60, s % 60)
            }
        }
        Dur::Time(s) => {
            let m = (s % 3600) / 60;
            if m > 0 {
                format!("{}h{m:02}", s / 3600)
            } else {
                format!("{}h", s / 3600)
            }
        }
        Dur::Open => String::new(),
    }
}
fn volume(d: Dur) -> i64 {
    match d {
        Dur::Distance(m) => m,
        Dur::Time(s) => s * 3,
        Dur::Open => 0,
    }
}
fn zone_of(t: &Tgt) -> i64 {
    match t {
        Tgt::Zone { zone, .. } => *zone,
        Tgt::Rpe(v, _) if *v >= 9 => 5,
        Tgt::Rpe(v, _) if *v >= 7 => 4,
        Tgt::Rpe(v, _) if *v >= 5 => 3,
        Tgt::Rpe(v, _) if *v >= 3 => 2,
        Tgt::Rpe(..) => 1,
        _ => 3,
    }
}
/// A natural pt-BR name: "Intervalado 6×800 m", "Rodagem 8 km", "Séries 10×100 m", "Progressivo 10 km",
/// "Força: Agachamento + Remada". The biggest part names the workout (a repeat's volume against the longest step).
fn name_of(blocks: &[Block], meta: &[Meta], sport: &str, hints: &Hints) -> String {
    let exercises: Vec<&str> = blocks
        .iter()
        .filter_map(|b| match b {
            Block::Exercise(e) => Some(e.name.as_str()),
            _ => None,
        })
        .collect();
    if !exercises.is_empty() {
        let label = if sport == "mobility" {
            "Mobilidade"
        } else {
            "Força"
        };
        let names = exercises
            .iter()
            .take(2)
            .copied()
            .collect::<Vec<_>>()
            .join(" + ");
        return if names.to_lowercase().starts_with(&label.to_lowercase()) {
            names
        } else {
            format!("{label}: {names}")
        };
    }
    if let Some(d) = hints.progression {
        return format!("Progressivo {}", amount_text(d));
    }
    if let Some(named) = &hints.named {
        return format!("{} {}", named.name, amount_text(named.total));
    }
    let actives: Vec<&Step> = blocks
        .iter()
        .filter_map(|b| match b {
            Block::Step(s) if s.intent == "active" => Some(s),
            _ => None,
        })
        .collect();
    let mut main: Option<&Step> = None;
    for a in &actives {
        if main.is_none_or(|m| volume(a.duration) > volume(m.duration)) {
            main = Some(a);
        }
    }
    let (mut best, mut best_vol) = (None, -1);
    for (i, b) in blocks.iter().enumerate() {
        if let Block::Repeat { count, steps, .. } = b {
            let vol = count
                * steps
                    .iter()
                    .filter(|s| s.intent == "active")
                    .map(|s| volume(s.duration))
                    .sum::<i64>();
            if vol > best_vol {
                (best, best_vol) = (Some(i), vol);
            }
        }
    }
    if let Some(i) = best
        && main.is_none_or(|m| best_vol >= volume(m.duration))
        && let Block::Repeat {
            count,
            max_count,
            steps,
            ..
        } = &blocks[i]
    {
        let a = steps
            .iter()
            .find(|s| s.intent == "active")
            .unwrap_or(&steps[0]);
        let label = if sport == "swim" {
            "Séries"
        } else if hints.fartlek {
            "Fartlek"
        } else {
            "Intervalado"
        };
        let count = match max_count {
            Some(max) => format!("{count}–{max}"),
            None => count.to_string(),
        };
        // A set written over several lines with different runs: named by what each round adds up to ("3×1,5 km").
        let runs: Vec<Step> = steps
            .iter()
            .filter(|s| s.intent == "active")
            .cloned()
            .collect();
        let sum = if runs.len() > 1 {
            steps_amount(&runs, a.duration).unwrap_or(0)
        } else {
            0
        };
        if meta[i].set && meta[i].nested.is_none() && sum > 0 {
            let total = match a.duration {
                Dur::Distance(_) => Dur::Distance(sum),
                _ => Dur::Time(sum),
            };
            return format!("{label} {count}×{}", amount_text(total));
        }
        let amount = amount_range(a.duration, a.dur_max);
        return match meta[i].nested {
            Some(inner) => format!("{label} {count}×({inner}×{amount})"),
            None => format!("{label} {count}×{amount}"),
        };
    }
    let Some(m) = main else {
        let any = blocks.iter().find_map(|b| match b {
            Block::Step(s) => Some(s),
            _ => None,
        });
        let Some(any) = any else {
            return "Treino".into();
        };
        let label = if matches!(any.target, Tgt::Rpe(_, Some("caminhada"))) {
            "Caminhada"
        } else {
            "Treino"
        };
        return format!("{label} {}", amount_range(any.duration, any.dur_max))
            .trim()
            .to_string();
    };
    // Several parts and none of them most of the work: the whole ("Progressivo 15 km" when each is harder).
    let sum: i64 = actives.iter().map(|a| volume(a.duration)).sum();
    if actives.len() > 1
        && sum > 0
        && volume(m.duration) * 5 <= sum * 3
        && actives.iter().all(|a| a.duration.same_type(m.duration))
    {
        let total = if matches!(m.duration, Dur::Distance(_)) {
            Dur::Distance(sum)
        } else {
            Dur::Time(sum / 3)
        };
        let t0 = &actives[0].target;
        let rising = t0.level().is_some()
            && actives.windows(2).all(|x| {
                std::mem::discriminant(&x[1].target) == std::mem::discriminant(t0)
                    && x[1].target.level() > x[0].target.level()
            });
        let label = if rising {
            "Progressivo"
        } else {
            match sport {
                "run" => "Corrida",
                "bike" => "Pedal",
                "swim" => "Natação",
                "mobility" => "Mobilidade",
                _ => "Treino",
            }
        };
        return format!("{label} {}", amount_text(total)).trim().to_string();
    }
    let z = zone_of(&m.target);
    let long = matches!(m.duration, Dur::Distance(d) if d >= 16000)
        || matches!(m.duration, Dur::Time(s) if s >= 5400);
    let label = if hints.progressive && sport != "mobility" && sport != "other" {
        "Progressivo"
    } else if sport == "swim" {
        "Nado contínuo"
    } else if sport == "bike" {
        match z {
            ..=1 => "Pedal regenerativo",
            2 => "Pedal leve",
            3 => "Pedal moderado",
            _ => "Pedal forte",
        }
    } else if sport == "mobility" {
        "Mobilidade"
    } else if sport != "run" {
        "Treino"
    } else if hints.fartlek {
        "Fartlek"
    } else if hints.long && z <= 3 {
        "Longão"
    } else {
        match z {
            ..=1 => "Regenerativo",
            2 if long => "Longão",
            2 => "Rodagem",
            3 => "Corrida moderada",
            _ => "Ritmo forte",
        }
    };
    format!("{label} {}", amount_range(m.duration, m.dur_max))
        .trim()
        .to_string()
}

// ------------------------------------------------------------------------------------ tags (api/endpoints.md § Tags)

static HASHTAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(^|[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}(])#([\p{L}\p{N}_-]+)")
        .expect("valid pattern")
});
static TABS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]{2,}").expect("valid pattern"));
static TRAILING_PLUS: LazyLock<Regex> = LazyLock::new(|| {
    let s = r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";
    Regex::new(&format!(r"{s}*\+{s}*$")).expect("valid pattern")
});

/// Normalized, without empties or duplicates, at most `tags::MAX_TAGS` (order kept).
fn clean_tags<'a>(raw: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in raw {
        let n = tags::normalize(t);
        if !n.is_empty() && !out.contains(&n) {
            out.push(n);
        }
    }
    out.truncate(tags::MAX_TAGS);
    out
}
/// Pull "#tags" out of a line; returns the line without them.
fn extract_tags(line: &str) -> (String, Vec<String>) {
    let mut found: Vec<String> = Vec::new();
    let rest = HASHTAG.replace_all(line, |c: &regex::Captures<'_>| {
        found.push(c[2].to_string());
        c[1].to_string()
    });
    let rest = TABS.replace_all(&rest, " ");
    let rest = TRAILING_PLUS.replace(&rest, "");
    let rest = rest.trim_matches(is_space).to_string();
    (rest, clean_tags(found.iter().map(String::as_str)))
}

/// Free text → structure, warnings (the pieces that weren't understood, as typed), #tags and a suggested name.
pub fn parse(raw: &str, sport: &str) -> Parsed {
    let mut tags_found: Vec<String> = Vec::new();
    let lines: Vec<String> = raw
        .replace('\r', "")
        .split('\n')
        .map(|l| {
            let (text, t) = extract_tags(l);
            tags_found.extend(t);
            strip_list_marker(normalize_line(&text))
        })
        .collect();
    let toks = pause_marks(number_words(&tokenize(&lines.join("\n"))));
    let mut hints = Hints {
        long: toks
            .iter()
            .any(|t| w(Some(t), &["longão", "longao", "longo", "longa"])),
        fartlek: toks.iter().any(|t| w(Some(t), &["fartlek"])),
        progressive: toks.iter().any(|t| {
            t.k == K::Word && (t.low.starts_with("progress") || t.low.starts_with("progredi"))
        }),
        progression: None,
        named: None,
    };
    let mut warnings = Vec::new();
    let (blocks, meta) = assemble(&dash_sets(segment(&toks)), sport, &mut warnings, &mut hints);
    let name = name_of(&blocks, &meta, sport, &hints);
    Parsed {
        structure: json!({ "v": 1, "blocks": blocks.iter().map(Block::json).collect::<Vec<_>>() }),
        warnings,
        tags: clean_tags(tags_found.iter().map(String::as_str)),
        name,
    }
}
