//! The assistant's rules engine (F27): a port of api/mock/routes/ai.mjs. It suggests a running week from the
//! profile and summarizes a period's feedback; workouts from text use the shared free-text grammar
//! (`crate::workout_text`). Deterministic and local: no student data leaves the server. An LLM can replace it later
//! behind the same contract (root.md §11.4).
//!
//! The patterns are the mock's, compiled with JavaScript semantics (`\d`, `\w` and `\b` are ASCII there), and the
//! tests hold the mock's answers for the same inputs.

use std::collections::HashSet;
use std::sync::LazyLock;

use chrono::{Duration, NaiveDate};
use regex::Regex;
use serde_json::{Value, json};

use crate::workout::estimate;

/// The `source` the responses carry.
pub const SOURCE: &str = "rules";

/// Compiles a JavaScript-flavored pattern: `\d`, `\w` and `\b` are ASCII-only there (Unicode in `regex`).
fn js(pattern: &str) -> Regex {
    let p = pattern
        .replace(r"\d", "[0-9]")
        .replace(r"\w", "[0-9A-Za-z_]")
        .replace(r"\b", r"(?-u:\b)");
    Regex::new(&p).expect("valid pattern")
}

/// JavaScript's `Math.round` (half up).
fn round(x: f64) -> i64 {
    (x + 0.5).floor() as i64
}

/// A JSON number written like JavaScript would (`90`, not `90.0`).
fn number(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 1e15 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

fn zone(n: i64) -> Value {
    json!({ "type": "zone", "metric": "pace", "zone": n })
}

fn open() -> Value {
    json!({ "type": "open" })
}

fn time(s: f64) -> Value {
    json!({ "type": "time", "s": number(s) })
}

fn distance(m: i64) -> Value {
    json!({ "type": "distance", "m": m })
}

fn step(intent: &str, duration: Value, target: Value) -> Value {
    json!({ "kind": "step", "intent": intent, "duration": duration, "target": target })
}

/// The example shown when nothing in a description was understood (each one is a golden example in
/// api/workout-text-examples.json), like the mock.
pub fn example_for(sport: &str) -> &'static str {
    match sport {
        "swim" => {
            "Tente algo como: 400 m de aquecimento, 10x100 crawl saída 1:45 com palmar e 200 m solto."
        }
        "bike" => {
            "Tente algo como: 15 min leve, 4x8 min a 95% do FTP com 4 min leve e 10 min de desaquecimento."
        }
        "strength" => "Tente algo como: agachamento 4x10 com 40 kg, remada 3x12, prancha 3x30.",
        "mobility" => {
            "Tente algo como: Mobilidade de quadril 90/90 2x10, rotação torácica 2x10 por lado, prancha 3x30 s."
        }
        _ => {
            "Tente algo como: 15 min de aquecimento, 6 tiros de 800 m a 4:10 com 2 min de trote e 10 min de desaquecimento."
        }
    }
}

// ------------------------------------------------------------------------------------ week plan

/// What the week plan reads about the student.
pub struct Athlete<'a> {
    pub first_name: &'a str,
    pub goal: Option<&'a str>,
    pub level: Option<&'a str>,
    pub weekly_sessions: Option<i32>,
    pub goal_date: Option<NaiveDate>,
}

/// Swimming, strength and triathlon goals have no automatic plan yet.
#[derive(Debug, PartialEq, Eq)]
pub struct UnsupportedGoal;

/// The suggested week: `rationale` lines and `items` (`{date, sport, title, structure, est_*, reason}`).
pub struct WeekPlan {
    pub rationale: Vec<String>,
    pub items: Vec<Value>,
}

fn slots(n: usize) -> (&'static [i64], &'static [&'static str]) {
    match n {
        2 => (&[3, 6], &["quality", "long"]),
        3 => (&[2, 4, 6], &["quality", "easy", "long"]),
        4 => (&[2, 3, 5, 7], &["quality", "easy", "tempo", "long"]),
        5 => (
            &[1, 2, 4, 5, 7],
            &["easy", "quality", "easy", "tempo", "long"],
        ),
        _ => (
            &[1, 2, 3, 5, 6, 7],
            &["easy", "quality", "easy", "tempo", "easy", "long"],
        ),
    }
}

fn long_km(goal: Option<&str>) -> [f64; 3] {
    match goal {
        Some("5k") => [6.0, 8.0, 10.0],
        Some("10k") => [8.0, 12.0, 15.0],
        Some("21k") => [12.0, 16.0, 20.0],
        Some("42k") => [16.0, 22.0, 28.0],
        Some("trail") => [10.0, 14.0, 18.0],
        _ => [5.0, 7.0, 9.0],
    }
}

/// One session: `(title, reason, structure)`.
fn session(kind: &str, li: usize, long_km: f64, factor: f64) -> (String, &'static str, Value) {
    let t = |min: f64| time(round(min * 60.0 * factor) as f64);
    match kind {
        "easy" => (
            "Rodagem leve".into(),
            "Base aeróbica, sem cansar para o próximo treino forte.",
            json!({ "v": 1, "blocks": [step("active", t([30.0, 40.0, 50.0][li]), zone(2))] }),
        ),
        "tempo" => (
            "Ritmo forte contínuo".into(),
            "Limiar: sustentar um ritmo forte por mais tempo.",
            json!({ "v": 1, "blocks": [step("warmup", t(12.0), zone(2)), step("active", t([12.0, 20.0, 25.0][li]), zone(4)), step("cooldown", t(8.0), zone(1))] }),
        ),
        "long" => {
            let km = round(long_km * factor);
            (
                format!("Longão {km} km"),
                "Resistência: o treino mais importante da semana para a prova.",
                json!({ "v": 1, "blocks": [step("active", distance(km * 1000), zone(2))] }),
            )
        }
        _ => {
            let count = round([5.0, 6.0, 8.0][li] * factor).max(3);
            let rep = [400, 800, 1000][li];
            (
                format!("Intervalado {count}×{rep} m"),
                "Velocidade e VO₂máx, com recuperação completa.",
                json!({ "v": 1, "blocks": [
                    step("warmup", time(900.0), zone(2)),
                    { "kind": "repeat", "count": count, "steps": [step("active", distance(rep), zone(5)), step("recovery", time([90.0, 120.0, 120.0][li]), open())] },
                    step("cooldown", time(600.0), zone(1)),
                ] }),
            )
        }
    }
}

/// A running week from the profile, the last 14 days' compliance (`recent` completion statuses, `None` = no
/// record) and the goal-race date (taper); days in `taken` already have workouts and are skipped.
pub fn week_plan(
    a: &Athlete<'_>,
    monday: NaiveDate,
    recent: &[Option<String>],
    taken: &HashSet<NaiveDate>,
) -> Result<WeekPlan, UnsupportedGoal> {
    if matches!(a.goal, Some("swim" | "strength" | "triathlon")) {
        return Err(UnsupportedGoal);
    }
    let level = a.level.unwrap_or("beginner");
    let li = match level {
        "intermediate" => 1,
        "advanced" => 2,
        _ => 0,
    };
    let sessions = a
        .weekly_sessions
        .filter(|n| *n != 0)
        .map_or([3, 4, 5][li], |n| n as i64);
    let n = sessions.clamp(2, 6) as usize;

    let comp = (!recent.is_empty()).then(|| {
        let points: f64 = recent
            .iter()
            .map(|s| match s.as_deref() {
                Some("completed") => 1.0,
                Some("partial") => 0.5,
                _ => 0.0,
            })
            .sum();
        points / recent.len() as f64
    });
    let to_goal = a.goal_date.map(|d| (d - monday).num_days());
    let mut factor = 1.0;
    let mut notes = Vec::new();
    match (to_goal, comp) {
        (Some(d @ 0..=13), _) => {
            factor = if d <= 6 { 0.55 } else { 0.75 };
            notes.push(format!(
                "Prova em {d} dias: semana de polimento, com volume reduzido."
            ));
        }
        (_, Some(c)) if c < 0.6 => {
            factor = 0.85;
            notes.push(format!(
                "Fez {}% dos treinos nas últimas 2 semanas: volume um pouco menor para retomar a constância.",
                round(c * 100.0)
            ));
        }
        (_, Some(c)) => notes.push(format!(
            "Boa constância nas últimas 2 semanas ({}%): mantive a progressão.",
            round(c * 100.0)
        )),
        _ => {}
    }
    match taken.len() {
        0 => {}
        1 => notes.push("Um dia já tem treino: sugeri só os outros.".into()),
        k => notes.push(format!("{k} dias já têm treino: sugeri só os outros.")),
    }

    let race_week = to_goal.is_some_and(|d| (0..=6).contains(&d));
    let long = long_km(a.goal)[li];
    let (days, kinds) = slots(n);
    let items = days
        .iter()
        .zip(kinds)
        .map(|(wd, kind)| (monday + Duration::days(wd - 1), *kind))
        .filter(|(date, _)| !taken.contains(date))
        .map(|(date, kind)| {
            let kind = if race_week && kind == "long" { "easy" } else { kind };
            let (title, reason, structure) = session(kind, li, long, factor);
            let (est_duration_s, est_distance_m) = estimate("run", &structure);
            json!({ "date": date, "sport": "run", "title": title, "structure": structure,
                    "est_duration_s": est_duration_s, "est_distance_m": est_distance_m, "reason": reason })
        })
        .collect();

    let goal = match a.goal {
        Some("5k") => "5 km",
        Some("10k") => "10 km",
        Some("21k") => "meia maratona",
        Some("42k") => "maratona",
        Some("trail") => "trail",
        Some("health") => "saúde",
        _ => "condicionamento",
    };
    let level = match li {
        1 => "intermediário",
        2 => "avançado",
        _ => "iniciante",
    };
    let mut rationale = vec![format!(
        "{}: objetivo {goal}, nível {level}, {n} treinos por semana.",
        a.first_name
    )];
    rationale.extend(notes);
    Ok(WeekPlan { rationale, items })
}

// ------------------------------------------------------------------------------------ feedback summary

/// A past planned workout in the period, with its completion (if any).
pub struct Feedback<'a> {
    pub membership_id: &'a str,
    pub planned_workout_id: &'a str,
    pub first_name: &'a str,
    pub title: &'a str,
    pub status: Option<&'a str>,
    pub rpe: Option<i32>,
    pub comment: Option<&'a str>,
}

static KEYWORDS: LazyLock<Vec<(Regex, &'static str, &'static str, &'static str)>> = LazyLock::new(
    || {
        [
        // The mock's lookarounds, as letter-or-edge groups (same matches).
        (
            r"(?:^|[^\p{L}])(?:dor|dores|doendo|doeu)(?:[^\p{L}]|$)|lesão|lesao|machuc|tornozelo|joelho|panturrilha|canela",
            "pain",
            "danger",
            "relatou dor",
        ),
        (r"cansad|exaust|pesad|sem energia", "fatigue", "warning", "relatou cansaço"),
        (r"plantão|plantao|trabalho|viagem|viajando", "life", "info", "citou rotina/viagem"),
        (r"doente|gripe|febre", "sick", "warning", "relatou estar doente"),
    ]
    .into_iter()
    .map(|(p, kind, severity, verb)| (js(p), kind, severity, verb))
    .collect()
    },
);

/// `(summary lines, highlights ≤ 12)` for the period's past workouts of `students` students.
pub fn feedback_summary(items: &[Feedback<'_>], students: usize) -> (Vec<String>, Vec<Value>) {
    let done: Vec<&Feedback> = items
        .iter()
        .filter(|f| matches!(f.status, Some("completed" | "partial")))
        .collect();
    let rpes: Vec<i32> = done
        .iter()
        .filter_map(|f| f.rpe)
        .filter(|r| *r != 0)
        .collect();
    let avg = (!rpes.is_empty())
        .then(|| round(rpes.iter().sum::<i32>() as f64 / rpes.len() as f64 * 10.0) as f64 / 10.0);

    let mut highlights = Vec::new();
    for f in items {
        let comment = f.comment.unwrap_or("");
        let lower = comment.to_lowercase();
        for (re, kind, severity, verb) in KEYWORDS.iter() {
            if re.is_match(&lower) {
                let quote = if comment.chars().count() > 80 {
                    format!("{}…", comment.chars().take(77).collect::<String>())
                } else {
                    comment.to_string()
                };
                highlights.push(json!({ "membership_id": f.membership_id, "planned_workout_id": f.planned_workout_id,
                    "kind": kind, "severity": severity, "text": format!("{} {verb}: “{quote}”", f.first_name) }));
            }
        }
        if let Some(rpe) = f.rpe.filter(|r| *r >= 9) {
            highlights.push(json!({ "membership_id": f.membership_id, "planned_workout_id": f.planned_workout_id,
                "kind": "rpe", "severity": "warning", "text": format!("{} marcou PSE {rpe} em “{}”.", f.first_name, f.title) }));
        }
    }
    // Two or more missed workouts, per student (in order of first appearance).
    let mut missed: Vec<(&str, &str, usize)> = Vec::new();
    for f in items
        .iter()
        .filter(|f| matches!(f.status, None | Some("missed" | "skipped")))
    {
        match missed.iter_mut().find(|(m, _, _)| *m == f.membership_id) {
            Some(entry) => entry.2 += 1,
            None => missed.push((f.membership_id, f.first_name, 1)),
        }
    }
    for (membership_id, name, k) in missed.into_iter().filter(|(_, _, k)| *k >= 2) {
        highlights.push(
            json!({ "membership_id": membership_id, "planned_workout_id": null, "kind": "missed",
            "severity": "danger", "text": format!("{name} não fez {k} treinos no período.") }),
        );
    }

    let total = items.len();
    let pct = if total == 0 {
        0
    } else {
        round(done.len() as f64 / total as f64 * 100.0)
    };
    let effort = match avg {
        Some(a) => format!(
            "Esforço percebido médio: PSE {}{}",
            a.to_string().replace('.', ","),
            if a >= 7.5 {
                ", alto para a fase: vale aliviar a próxima semana."
            } else if a <= 4.0 {
                ", baixo: dá para progredir."
            } else {
                ", dentro do esperado."
            }
        ),
        None => "Ninguém registrou PSE no período.".into(),
    };
    let attention = match highlights.len() {
        0 => "Nenhum sinal de alerta nos comentários.".to_string(),
        1 => "1 ponto pede atenção, abaixo.".to_string(),
        k => format!("{k} pontos pedem atenção, abaixo."),
    };
    let summary = vec![
        format!(
            "{} de {total} treinos feitos ({pct}%) por {students} alunos.",
            done.len()
        ),
        effort,
        attention,
    ];
    highlights.truncate(12);
    (summary, highlights)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    // The free-text grammar has its own golden tests (tests/workout_text.rs); here: the estimate of a parsed workout
    // matches the mock's (seed.mjs `estimate`) and every sport has an example that parses.
    #[test]
    fn parsed_workouts_and_examples() {
        let paced = crate::workout_text::parse("5 km a 5:30", "run").structure;
        assert_eq!(
            paced["blocks"][0]["target"],
            json!({"type":"pace","min_s":325,"max_s":335})
        );
        assert_eq!(estimate("run", &paced), (1680, Some(5000)));
        for sport in ["run", "swim", "bike", "strength", "mobility", "other"] {
            let example = example_for(sport).trim_start_matches("Tente algo como: ");
            let parsed = crate::workout_text::parse(example, sport);
            assert!(
                parsed.warnings.is_empty()
                    && !parsed.structure["blocks"].as_array().unwrap().is_empty(),
                "{sport}"
            );
        }
    }

    #[test]
    fn a_beginner_week_without_history() {
        let a = Athlete {
            first_name: "Ana",
            goal: None,
            level: None,
            weekly_sessions: None,
            goal_date: None,
        };
        let plan = week_plan(&a, date("2026-11-09"), &[], &HashSet::new()).unwrap();
        assert_eq!(
            plan.rationale,
            ["Ana: objetivo condicionamento, nível iniciante, 3 treinos por semana."]
        );
        let got: Vec<(&str, &str)> = plan
            .items
            .iter()
            .map(|i| (i["date"].as_str().unwrap(), i["title"].as_str().unwrap()))
            .collect();
        assert_eq!(
            got,
            [
                ("2026-11-10", "Intervalado 5×400 m"),
                ("2026-11-12", "Rodagem leve"),
                ("2026-11-14", "Longão 5 km")
            ]
        );
        assert_eq!(plan.items[1]["est_duration_s"], 1800);
        assert_eq!(
            plan.items[2]["structure"]["blocks"][0]["duration"]["m"],
            5000
        );
    }

    #[test]
    fn taper_low_compliance_and_taken_days() {
        let race = Athlete {
            first_name: "Bia",
            goal: Some("21k"),
            level: Some("intermediate"),
            weekly_sessions: Some(4),
            goal_date: Some(date("2026-11-15")),
        };
        let taken: HashSet<NaiveDate> = [date("2026-11-10")].into();
        let plan = week_plan(&race, date("2026-11-09"), &[], &taken).unwrap();
        assert_eq!(
            plan.rationale,
            [
                "Bia: objetivo meia maratona, nível intermediário, 4 treinos por semana.",
                "Prova em 6 dias: semana de polimento, com volume reduzido.",
                "Um dia já tem treino: sugeri só os outros.",
            ]
        );
        // Race week: no long run; volume × 0.55.
        let titles: Vec<&str> = plan
            .items
            .iter()
            .map(|i| i["title"].as_str().unwrap())
            .collect();
        assert_eq!(
            titles,
            ["Rodagem leve", "Ritmo forte contínuo", "Rodagem leve"]
        );
        assert_eq!(
            plan.items[0]["structure"]["blocks"][0]["duration"]["s"],
            1320
        );

        let behind = Athlete {
            first_name: "Caio",
            goal: Some("10k"),
            level: Some("advanced"),
            weekly_sessions: Some(9),
            goal_date: None,
        };
        let recent = [
            Some("completed".to_string()),
            None,
            Some("partial".to_string()),
            Some("skipped".to_string()),
        ];
        let plan = week_plan(&behind, date("2026-11-09"), &recent, &HashSet::new()).unwrap();
        assert_eq!(
            plan.rationale[0],
            "Caio: objetivo 10 km, nível avançado, 6 treinos por semana."
        );
        assert_eq!(
            plan.rationale[1],
            "Fez 38% dos treinos nas últimas 2 semanas: volume um pouco menor para retomar a constância."
        );
        assert_eq!(plan.items.len(), 6);
        assert_eq!(plan.items[1]["title"], "Intervalado 7×1000 m");
        assert_eq!(plan.items[5]["title"], "Longão 13 km");

        let swim = Athlete {
            first_name: "Duda",
            goal: Some("swim"),
            level: None,
            weekly_sessions: None,
            goal_date: None,
        };
        assert_eq!(
            week_plan(&swim, date("2026-11-09"), &[], &HashSet::new()).err(),
            Some(UnsupportedGoal)
        );
    }

    #[test]
    fn feedback_highlights() {
        let f = |id: &'static str,
                 status: Option<&'static str>,
                 rpe: Option<i32>,
                 comment: Option<&'static str>| Feedback {
            membership_id: if id.starts_with('a') {
                "m-ana"
            } else {
                "m-bia"
            },
            planned_workout_id: id,
            first_name: if id.starts_with('a') { "Ana" } else { "Bia" },
            title: "Intervalado",
            status,
            rpe,
            comment,
        };
        let items = [
            f(
                "a1",
                Some("completed"),
                Some(9),
                Some("Senti dor no joelho no fim"),
            ),
            f("a2", Some("partial"), Some(6), Some("Cansada do plantão")),
            f("a3", Some("completed"), None, Some("Adorei, tudo certo")),
            f("b1", None, None, None),
            f("b2", Some("skipped"), None, None),
        ];
        let (summary, highlights) = feedback_summary(&items, 2);
        assert_eq!(
            summary,
            [
                "3 de 5 treinos feitos (60%) por 2 alunos.",
                "Esforço percebido médio: PSE 7,5, alto para a fase: vale aliviar a próxima semana.",
                "5 pontos pedem atenção, abaixo.",
            ]
        );
        let kinds: Vec<&str> = highlights
            .iter()
            .map(|h| h["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["pain", "rpe", "fatigue", "life", "missed"]);
        assert_eq!(
            highlights[0]["text"],
            "Ana relatou dor: “Senti dor no joelho no fim”"
        );
        assert_eq!(highlights[1]["text"], "Ana marcou PSE 9 em “Intervalado”.");
        assert_eq!(highlights[4]["text"], "Bia não fez 2 treinos no período.");
        assert!(highlights[4]["planned_workout_id"].is_null());
        // "Adorei" has "dor" inside a word: not pain.
        let (_, none) = feedback_summary(&items[2..3], 1);
        assert!(none.is_empty());
    }
}
