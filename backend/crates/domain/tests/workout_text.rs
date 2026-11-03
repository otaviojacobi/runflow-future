//! The free-text grammar (`workout_text`) gives exactly the golden examples of `api/workout-text-examples.json`
//! (synced to `assets/`), like the mock and the web builder: structure, warnings, tags and name.

use runflow_domain::workout::validate;
use runflow_domain::workout_text::parse;
use serde_json::{Value, json};

const EXAMPLES: &str = include_str!("../../../assets/workout-text-examples.json");

#[test]
fn golden_examples() {
    let doc: Value = serde_json::from_str(EXAMPLES).expect("valid JSON");
    let examples = doc["examples"].as_array().expect("examples");
    assert!(examples.len() > 100);
    let mut failures = Vec::new();
    for ex in examples {
        let (text, sport) = (
            ex["text"].as_str().expect("text"),
            ex["sport"].as_str().expect("sport"),
        );
        let got = parse(text, sport);
        let want_warnings = ex.get("warnings").cloned().unwrap_or_else(|| json!([]));
        let want_tags = ex.get("tags").cloned().unwrap_or_else(|| json!([]));
        let mut diff = Vec::new();
        if got.structure != ex["structure"] {
            diff.push(format!(
                "structure\n    want {}\n    got  {}",
                ex["structure"], got.structure
            ));
        }
        if json!(got.warnings) != want_warnings {
            diff.push(format!(
                "warnings: want {want_warnings}, got {:?}",
                got.warnings
            ));
        }
        if json!(got.tags) != want_tags {
            diff.push(format!("tags: want {want_tags}, got {:?}", got.tags));
        }
        if let Some(name) = ex.get("name").and_then(Value::as_str)
            && got.name != name
        {
            diff.push(format!("name: want {name:?}, got {:?}", got.name));
        }
        if !diff.is_empty() {
            failures.push(format!("[{sport}] {text:?}: {}", diff.join("; ")));
        }
        // Whatever the grammar builds is a structure the API accepts (when there is something to store).
        if !got.structure["blocks"]
            .as_array()
            .is_some_and(Vec::is_empty)
        {
            validate(&got.structure).unwrap_or_else(|e| panic!("{text:?}: {e:?}"));
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

#[test]
fn never_panics() {
    for text in [
        "",
        "   ",
        "(((",
        "))) 6x",
        "x x x",
        "6x(",
        "+++",
        "@@@ 4:30 @",
        "1000000x1km",
        "#só #tags",
        "999999999999999999999999 km",
        "3x(2x(2x(400)))",
        "6x1km @0:00 c/ 0'",
        "Agachamento 4x",
    ] {
        for sport in ["run", "swim", "bike", "strength", "mobility", "other"] {
            let _ = parse(text, sport);
        }
    }
}

/// Port parity beyond the examples: `node api/mock/workout-text-examples.mjs --corpus /tmp/corpus.json`, then
/// `WORKOUT_TEXT_CORPUS=/tmp/corpus.json cargo test -p runflow-domain --test workout_text -- --ignored`.
#[test]
#[ignore = "needs WORKOUT_TEXT_CORPUS from the mock"]
fn corpus() {
    let path = std::env::var("WORKOUT_TEXT_CORPUS").expect("WORKOUT_TEXT_CORPUS");
    let items: Vec<Value> =
        serde_json::from_str(&std::fs::read_to_string(path).expect("corpus file")).expect("JSON");
    let mut failures = Vec::new();
    for it in &items {
        let (text, sport) = (
            it["text"].as_str().expect("text"),
            it["sport"].as_str().expect("sport"),
        );
        let got = parse(text, sport);
        let got = json!({ "structure": got.structure, "warnings": got.warnings, "tags": got.tags, "name": got.name });
        let want = json!({ "structure": it["structure"], "warnings": it["warnings"], "tags": it["tags"], "name": it["name"] });
        if got != want {
            failures.push(format!(
                "[{sport}] {text:?}\n    want {want}\n    got  {got}"
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} differ:\n{}",
        failures.len(),
        items.len(),
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
