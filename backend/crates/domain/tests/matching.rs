//! Activity matching (`matching`) gives exactly the golden examples of `api/activity-match-examples.json` (synced to
//! `assets/`), like the mock's `lib/matching.mjs`.

use runflow_domain::matching::{Act, Planned, solve};
use serde_json::Value;

const EXAMPLES: &str = include_str!("../../../assets/activity-match-examples.json");

#[test]
fn golden_examples() {
    let doc: Value = serde_json::from_str(EXAMPLES).expect("valid JSON");
    let examples = doc["examples"].as_array().expect("examples");
    assert!(examples.len() >= 19);
    let mut failures = Vec::new();
    for ex in examples {
        let name = ex["name"].as_str().unwrap_or("?");
        let today = ex["today"]
            .as_str()
            .and_then(|d| d.parse().ok())
            .expect("today");
        let acts: Vec<Act> = serde_json::from_value(ex["activities"].clone()).expect("activities");
        let works: Vec<Planned> = serde_json::from_value(ex["workouts"].clone()).expect("workouts");
        let got = serde_json::to_value(solve(today, &acts, &works)).expect("json");
        if got != ex["expect"] {
            failures.push(format!("{name}\n    want {}\n    got  {got}", ex["expect"]));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} examples differ:\n{}",
        failures.len(),
        examples.len(),
        failures.join("\n")
    );
}
