//! Workout structure v1 (api/endpoints.md § Workout structure), strongly typed (§7.2). The API validates every
//! structure it stores against these types but keeps the JSON exactly as sent (apps may carry extra fields).

use serde::Deserialize;
use serde_json::Value;

pub const SPORTS: [&str; 6] = ["run", "swim", "bike", "strength", "mobility", "other"];

#[derive(Debug, Deserialize)]
pub struct Structure {
    pub v: u8,
    /// The coach's words about the whole workout ("obs: …", D-059), shown at the top of its steps.
    pub note: Option<String>,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Block {
    Step(Step),
    Repeat(Repeat),
    Exercise(Exercise),
}

#[derive(Debug, Deserialize)]
pub struct Step {
    pub intent: Intent,
    pub duration: Duration,
    pub target: Target,
    pub note: Option<String>,
    pub stroke: Option<Stroke>,
    pub equipment: Option<Vec<Equipment>>,
    pub send_off_s: Option<u32>,
}

/// `max_count`: "15–20×" (the athlete picks; estimates use `count`). `note`: the block's name ("Cruise Interval").
/// `until_m`: repeated until that distance (estimates use it; `count` is the rounds that cover it).
#[derive(Debug, Deserialize)]
pub struct Repeat {
    pub count: u32,
    pub max_count: Option<u32>,
    pub until_m: Option<u32>,
    pub note: Option<String>,
    pub steps: Vec<Step>,
}

#[derive(Debug, Deserialize)]
pub struct Exercise {
    pub name: String,
    pub sets: u32,
    pub reps: String,
    pub load: Option<Load>,
    pub rest_s: Option<u32>,
    pub tempo: Option<String>,
    pub note: Option<String>,
    pub exercise_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Intent {
    Warmup,
    Active,
    Recovery,
    Rest,
    Cooldown,
    Other,
}

/// `max_s` / `max_m`: a range the athlete picks by feel ("60–80 m"); estimates use the lower bound.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Duration {
    Time { s: u32, max_s: Option<u32> },
    Distance { m: u32, max_m: Option<u32> },
    Open,
}

/// `Rpe.label`: the coach's word for it ("forte" → 8).
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Target {
    Open,
    Zone { metric: Metric, zone: u8 },
    Pace { min_s: u32, max_s: u32 },
    Hr { min: u32, max: u32 },
    Power { min: u32, max: u32 },
    Rpe { value: u8, label: Option<String> },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Metric {
    Hr,
    Pace,
    Power,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stroke {
    Free,
    Back,
    Breast,
    Fly,
    Im,
    Choice,
    Kick,
    Drill,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Equipment {
    Pullbuoy,
    Kickboard,
    Fins,
    Paddles,
    Snorkel,
}

#[derive(Debug, Deserialize)]
pub struct Load {
    #[serde(rename = "type")]
    pub kind: LoadKind,
    pub value: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoadKind {
    Kg,
    #[serde(rename = "pct_1rm")]
    Pct1rm,
    Bodyweight,
    Rpe,
}

/// Why a structure can't be stored (the API turns it into a pt-BR field error).
#[derive(Debug, PartialEq, Eq)]
pub enum StructureError {
    /// No blocks (the mock's "Adicione pelo menos uma etapa.").
    Empty,
    /// Wrong shape or values out of range.
    Invalid(String),
}

fn check_step(s: &Step) -> Result<(), String> {
    match s.duration {
        Duration::Time {
            s: lo,
            max_s: Some(hi),
        }
        | Duration::Distance {
            m: lo,
            max_m: Some(hi),
        } if hi < lo => {
            return Err("duration max < min".into());
        }
        _ => {}
    }
    match s.target {
        Target::Zone { zone, .. } if !(1..=5).contains(&zone) => {
            return Err(format!("zone {zone} out of 1..5"));
        }
        Target::Rpe { value, .. } if !(1..=10).contains(&value) => {
            return Err(format!("rpe {value} out of 1..10"));
        }
        Target::Pace { min_s, max_s }
        | Target::Hr {
            min: min_s,
            max: max_s,
        }
        | Target::Power {
            min: min_s,
            max: max_s,
        } if min_s > max_s => {
            return Err("range min > max".into());
        }
        _ => {}
    }
    Ok(())
}

/// Validate a v1 structure.
pub fn validate(value: &Value) -> Result<Structure, StructureError> {
    let s: Structure = serde_json::from_value(value.clone())
        .map_err(|e| StructureError::Invalid(e.to_string()))?;
    if s.v != 1 {
        return Err(StructureError::Invalid(format!("unknown version {}", s.v)));
    }
    if s.note.as_ref().is_some_and(|n| n.chars().count() > 500) {
        return Err(StructureError::Invalid("note over 500 characters".into()));
    }
    if s.blocks.is_empty() {
        return Err(StructureError::Empty);
    }
    for b in &s.blocks {
        match b {
            Block::Step(st) => check_step(st).map_err(StructureError::Invalid)?,
            Block::Repeat(r) => {
                if r.count == 0 || r.count > 200 || r.steps.is_empty() {
                    return Err(StructureError::Invalid(
                        "repeat needs 1..200 rounds and steps".into(),
                    ));
                }
                if r.max_count.is_some_and(|m| m < r.count || m > 200) {
                    return Err(StructureError::Invalid(
                        "repeat max_count out of count..200".into(),
                    ));
                }
                if r.until_m.is_some_and(|m| m == 0 || m > 1_000_000) {
                    return Err(StructureError::Invalid(
                        "repeat until_m out of 1..1000000".into(),
                    ));
                }
                for st in &r.steps {
                    check_step(st).map_err(StructureError::Invalid)?;
                }
            }
            Block::Exercise(e) => {
                if e.name.trim().is_empty() || e.sets == 0 {
                    return Err(StructureError::Invalid(
                        "exercise needs a name and sets".into(),
                    ));
                }
            }
        }
    }
    Ok(s)
}

/// Add `resolved` ranges to zone targets from the athlete's zones (`kind` → `[{zone, min, max}]`):
/// `{min_s, max_s}` for pace zones (s/km), `{min, max}` bpm for HR zones. Same as the mock.
pub fn resolve_targets(structure: &Value, zones: &[(String, Value)]) -> Value {
    let table = |kind: &str| zones.iter().find(|(k, _)| k == kind).map(|(_, b)| b);
    let fix = |step: &Value| -> Value {
        let mut step = step.clone();
        let target = &step["target"];
        if target["type"] != "zone" {
            return step;
        }
        let hr = target["metric"] == "hr";
        let zone = target["zone"].as_i64();
        let bound = table(if hr { "hr" } else { "pace" })
            .and_then(Value::as_array)
            .and_then(|b| b.iter().find(|x| x["zone"].as_i64() == zone).cloned());
        if let Some(b) = bound {
            step["target"]["resolved"] = if hr {
                serde_json::json!({ "min": b["min"], "max": b["max"] })
            } else {
                serde_json::json!({ "min_s": b["min"], "max_s": b["max"] })
            };
        }
        step
    };
    let mut out = structure.clone();
    if let Some(blocks) = out["blocks"].as_array_mut() {
        for b in blocks.iter_mut() {
            match b["kind"].as_str() {
                Some("step") => *b = fix(b),
                Some("repeat") => {
                    if let Some(steps) = b["steps"].as_array_mut() {
                        for st in steps.iter_mut() {
                            *st = fix(st);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    out
}

/// Planned pace (s/km) per zone when a step only says "zone N" (the mock's `ZONE_PACE`).
const ZONE_PACE: [f64; 5] = [390.0, 345.0, 310.0, 285.0, 260.0];

fn number(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}

/// Seconds per meter at a step's target.
fn per_meter(sport: &str, target: &Value) -> f64 {
    let kind = target.get("type").and_then(Value::as_str);
    let mid = (number(target, "min_s") + number(target, "max_s")) / 2.0;
    match (sport, kind) {
        ("swim", Some("pace")) => mid / 100.0,
        ("swim", _) => 1.25,
        (_, Some("pace")) => mid / 1000.0,
        (_, Some("zone")) => {
            let z = target.get("zone").and_then(Value::as_u64).unwrap_or(0) as usize;
            ZONE_PACE.get(z.wrapping_sub(1)).copied().unwrap_or(330.0) / 1000.0
        }
        // PSE → the zone it stands for (1–2 → Z1 … 9–10 → Z5), like the mock and the web app.
        (_, Some("rpe")) => {
            let v = target.get("value").and_then(Value::as_u64).unwrap_or(0);
            let z = match v {
                9.. => 5,
                7..=8 => 4,
                5..=6 => 3,
                3..=4 => 2,
                _ => 1,
            };
            ZONE_PACE[z - 1] / 1000.0
        }
        _ => 0.33,
    }
}

/// Adds `blocks` (each `mult` times) to the running `(seconds, meters, free)`; `free` = a main part by time with no
/// target ("30' livre"), which has no expected distance.
fn walk(sport: &str, blocks: &[Value], mult: f64, total: &mut (f64, f64, bool)) {
    for b in blocks {
        match b.get("kind").and_then(Value::as_str) {
            Some("repeat") => {
                let steps = b.get("steps").and_then(Value::as_array);
                let steps = steps.map_or(&[][..], Vec::as_slice);
                // Until a distance (D-058): one round's time and meters, scaled to the distance.
                let until = number(b, "until_m");
                let mut round = (0.0, 0.0, false);
                if until > 0.0 {
                    walk(sport, steps, 1.0, &mut round);
                }
                if round.1 > 0.0 {
                    total.0 += mult * round.0 * (until / round.1);
                    total.1 += mult * until;
                    total.2 |= round.2;
                } else {
                    walk(sport, steps, mult * number(b, "count"), total);
                }
            }
            Some("exercise") => {
                let rest = Some(number(b, "rest_s"))
                    .filter(|r| *r != 0.0)
                    .unwrap_or(60.0);
                total.0 += mult * number(b, "sets") * (45.0 + rest);
            }
            _ => {
                let (d, target) = (&b["duration"], &b["target"]);
                match d.get("type").and_then(Value::as_str) {
                    Some("time") => {
                        total.0 += mult * number(d, "s");
                        if sport == "run" || sport == "swim" {
                            total.1 += mult * number(d, "s") / per_meter(sport, target);
                        }
                        let open = target
                            .get("type")
                            .and_then(Value::as_str)
                            .is_none_or(|t| t == "open");
                        if b.get("intent").and_then(Value::as_str) == Some("active") && open {
                            total.2 = true;
                        }
                    }
                    Some("distance") => {
                        total.1 += mult * number(d, "m");
                        total.0 += mult * number(d, "m") * per_meter(sport, target);
                    }
                    _ => total.0 += mult * 300.0,
                }
            }
        }
    }
}

/// `(est_duration_s, est_distance_m)` for a structure, like `estimate` in api/mock/seed.mjs: whole minutes, and a
/// distance rounded to 100 m for run, swim and bike (`None` otherwise, and when a main part is free by time: "30'
/// livre" has no expected distance; easy parts without a target still count).
pub fn estimate(sport: &str, structure: &Value) -> (i64, Option<i64>) {
    let mut total = (0.0, 0.0, false);
    let blocks = structure.get("blocks").and_then(Value::as_array);
    walk(sport, blocks.map_or(&[], Vec::as_slice), 1.0, &mut total);
    let round = |x: f64| (x + 0.5).floor() as i64;
    let distance = (matches!(sport, "run" | "swim" | "bike") && !total.2)
        .then(|| round(total.1 / 100.0) * 100);
    (round(total.0 / 60.0) * 60, distance)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_repeat_until_a_distance_is_estimated_by_it() {
        let walk_run = json!({ "v": 1, "blocks": [{ "kind": "repeat", "count": 5, "until_m": 5000, "steps": [
            { "kind": "step", "intent": "recovery", "duration": { "type": "time", "s": 120 }, "target": { "type": "rpe", "value": 2, "label": "caminhada" } },
            { "kind": "step", "intent": "active", "duration": { "type": "time", "s": 240 }, "target": { "type": "rpe", "value": 5, "label": "moderado" } } ] }] });
        assert!(validate(&walk_run).is_ok());
        let (s, m) = estimate("run", &walk_run);
        assert_eq!(m, Some(5000));
        assert!((26 * 60..30 * 60).contains(&s), "{s}");
        let zero = json!({ "v": 1, "blocks": [{ "kind": "repeat", "count": 5, "until_m": 0, "steps": walk_run["blocks"][0]["steps"] }] });
        assert!(validate(&zero).is_err());
    }

    #[test]
    fn accepts_the_contract_example_and_rejects_garbage() {
        let ok = json!({ "v": 1, "blocks": [
            { "kind": "step", "intent": "warmup", "duration": { "type": "time", "s": 600 }, "target": { "type": "zone", "metric": "hr", "zone": 2 } },
            { "kind": "repeat", "count": 6, "steps": [
                { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 1000 }, "target": { "type": "pace", "min_s": 265, "max_s": 275 } },
                { "kind": "step", "intent": "recovery", "duration": { "type": "time", "s": 120 }, "target": { "type": "open" }, "note": "trote" } ] },
            { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 100 }, "target": { "type": "open" }, "stroke": "free", "equipment": ["paddles"], "send_off_s": 105 },
            { "kind": "exercise", "name": "Agachamento", "sets": 4, "reps": "8-10", "load": { "type": "pct_1rm", "value": 70 }, "rest_s": 90, "extra": true }
        ] });
        if let Err(e) = validate(&ok) {
            panic!("{e:?}");
        }
        // Ranges the athlete picks, a named block, PSE with the coach's word (R2).
        let ranges = json!({ "v": 1, "blocks": [
            { "kind": "repeat", "count": 15, "max_count": 20, "note": "Bloco do sábado", "steps": [
                { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 60, "max_m": 80 }, "target": { "type": "rpe", "value": 3, "label": "leve" }, "note": "subida" },
                { "kind": "step", "intent": "rest", "duration": { "type": "time", "s": 60, "max_s": 90 }, "target": { "type": "open" } } ] }
        ] });
        if let Err(e) = validate(&ranges) {
            panic!("{e:?}");
        }
        assert_eq!(
            validate(&json!({ "v": 1, "blocks": [] })).unwrap_err(),
            StructureError::Empty
        );
        let step = |duration: Value| json!({ "kind": "step", "intent": "active", "duration": duration, "target": { "type": "open" } });
        for bad in [
            json!({ "v": 2, "blocks": [] }),
            json!({ "blocks": [] }),
            json!({ "v": 1, "blocks": [{ "kind": "jump" }] }),
            json!({ "v": 1, "blocks": [{ "kind": "step", "intent": "active", "duration": { "type": "time", "s": 60 }, "target": { "type": "zone", "metric": "hr", "zone": 7 } }] }),
            json!({ "v": 1, "blocks": [{ "kind": "repeat", "count": 0, "steps": [] }] }),
            json!({ "v": 1, "blocks": [{ "kind": "repeat", "count": 15, "max_count": 10, "steps": [step(json!({ "type": "time", "s": 60 }))] }] }),
            json!({ "v": 1, "blocks": [{ "kind": "repeat", "count": 15, "max_count": 201, "steps": [step(json!({ "type": "time", "s": 60 }))] }] }),
            json!({ "v": 1, "blocks": [step(json!({ "type": "distance", "m": 80, "max_m": 60 }))] }),
            json!({ "v": 1, "blocks": [step(json!({ "type": "time", "s": 600, "max_s": 300 }))] }),
            json!({ "v": 1, "blocks": [{ "kind": "step", "intent": "active", "duration": { "type": "time", "s": 60 }, "target": { "type": "rpe", "value": 8, "label": 8 } }] }),
        ] {
            assert!(
                matches!(validate(&bad), Err(StructureError::Invalid(_))),
                "{bad}"
            );
        }
    }

    // Expected values: `estimate` in api/mock/seed.mjs on the same structures.
    #[test]
    fn estimates_match_the_mock() {
        let intervals = json!({ "v": 1, "blocks": [
            { "kind": "step", "intent": "warmup", "duration": { "type": "time", "s": 900 }, "target": { "type": "zone", "metric": "pace", "zone": 2 } },
            { "kind": "repeat", "count": 6, "steps": [
                { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 800 }, "target": { "type": "pace", "min_s": 245, "max_s": 255 } },
                { "kind": "step", "intent": "recovery", "duration": { "type": "time", "s": 120 }, "target": { "type": "open" } } ] },
            { "kind": "step", "intent": "cooldown", "duration": { "type": "time", "s": 600 }, "target": { "type": "zone", "metric": "pace", "zone": 1 } }
        ] });
        assert_eq!(estimate("run", &intervals), (3420, Some(11100)));
        // PSE counts as the zone it stands for (8 → Z4, 285 s/km); ranges use the lower bound.
        let pse = json!({ "v": 1, "blocks": [
            { "kind": "repeat", "count": 15, "max_count": 20, "steps": [
                { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 60, "max_m": 80 }, "target": { "type": "rpe", "value": 3, "label": "leve" } } ] },
            { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 5000 }, "target": { "type": "rpe", "value": 8, "label": "forte" } }
        ] });
        assert_eq!(estimate("run", &pse), (1740, Some(5900)));
        let strength = json!({ "v": 1, "blocks": [
            { "kind": "exercise", "name": "Agachamento", "sets": 4, "reps": "10", "rest_s": 60 },
            { "kind": "exercise", "name": "Remada", "sets": 3, "reps": "12", "rest_s": 60 },
            { "kind": "exercise", "name": "Prancha", "sets": 3, "reps": "30", "rest_s": 60 }
        ] });
        assert_eq!(estimate("strength", &strength), (1080, None));
        let swim = json!({ "v": 1, "blocks": [{ "kind": "repeat", "count": 8, "steps": [
            { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 100 }, "target": { "type": "zone", "metric": "pace", "zone": 3 } },
            { "kind": "step", "intent": "rest", "duration": { "type": "time", "s": 20 }, "target": { "type": "open" } } ] }] });
        assert_eq!(estimate("swim", &swim), (1140, Some(900)));
        // "30' livre": no expected distance. An easy warm-up and cool-down without a target still count.
        let free = json!({ "v": 1, "blocks": [
            { "kind": "step", "intent": "active", "duration": { "type": "time", "s": 1800 }, "target": { "type": "open" } }
        ] });
        assert_eq!(estimate("run", &free), (1800, None));
        let easy = json!({ "v": 1, "blocks": [
            { "kind": "step", "intent": "warmup", "duration": { "type": "time", "s": 600 }, "target": { "type": "open" } },
            { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 5000 }, "target": { "type": "pace", "min_s": 270, "max_s": 280 } },
            { "kind": "step", "intent": "cooldown", "duration": { "type": "time", "s": 600 }, "target": { "type": "open" } }
        ] });
        assert_eq!(estimate("run", &easy), (2580, Some(8600)));
    }
}
