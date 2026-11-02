//! Workout structure v1 (api/endpoints.md § Workout structure), strongly typed (§7.2). The API validates every
//! structure it stores against these types but keeps the JSON exactly as sent (apps may carry extra fields).

use serde::Deserialize;
use serde_json::Value;

pub const SPORTS: [&str; 6] = ["run", "swim", "bike", "strength", "mobility", "other"];

#[derive(Debug, Deserialize)]
pub struct Structure {
    pub v: u8,
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

#[derive(Debug, Deserialize)]
pub struct Repeat {
    pub count: u32,
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

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Duration {
    Time { s: u32 },
    Distance { m: u32 },
    Open,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Target {
    Open,
    Zone { metric: Metric, zone: u8 },
    Pace { min_s: u32, max_s: u32 },
    Hr { min: u32, max: u32 },
    Power { min: u32, max: u32 },
    Rpe { value: u8 },
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
    match s.target {
        Target::Zone { zone, .. } if !(1..=5).contains(&zone) => {
            return Err(format!("zone {zone} out of 1..5"));
        }
        Target::Rpe { value } if !(1..=10).contains(&value) => {
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

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
        assert_eq!(
            validate(&json!({ "v": 1, "blocks": [] })).unwrap_err(),
            StructureError::Empty
        );
        for bad in [
            json!({ "v": 2, "blocks": [] }),
            json!({ "blocks": [] }),
            json!({ "v": 1, "blocks": [{ "kind": "jump" }] }),
            json!({ "v": 1, "blocks": [{ "kind": "step", "intent": "active", "duration": { "type": "time", "s": 60 }, "target": { "type": "zone", "metric": "hr", "zone": 7 } }] }),
            json!({ "v": 1, "blocks": [{ "kind": "repeat", "count": 0, "steps": [] }] }),
        ] {
            assert!(
                matches!(validate(&bad), Err(StructureError::Invalid(_))),
                "{bad}"
            );
        }
    }
}
