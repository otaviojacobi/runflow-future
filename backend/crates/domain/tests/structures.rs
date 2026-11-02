//! Every workout structure the apps produce today (mock seed: templates, planned workouts, planilha items; the
//! starter library) passes the Rust validator, so the stricter backend never rejects real data.

use runflow_domain::workout::validate;
use serde_json::Value;

#[test]
fn seed_and_starter_structures_are_valid() {
    let mut checked = 0;
    let starter: Value =
        serde_json::from_str(include_str!("../../../assets/starter-library.json")).unwrap();
    for t in starter
        .as_object()
        .unwrap()
        .values()
        .flat_map(|v| v.as_array().unwrap())
    {
        validate(&t["structure"]).unwrap_or_else(|e| panic!("starter {}: {e:?}", t["name"]));
        checked += 1;
    }
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../api/mock/db.json");
    if let Ok(raw) = std::fs::read_to_string(path) {
        let db: Value = serde_json::from_str(&raw).unwrap();
        for table in [
            "workout_templates",
            "planned_workouts",
            "training_plan_items",
        ] {
            for row in db[table].as_array().unwrap() {
                validate(&row["structure"])
                    .unwrap_or_else(|e| panic!("{table} {}: {e:?}", row["id"]));
                checked += 1;
            }
        }
    }
    assert!(checked > 200, "checked {checked}");
}
