//! Assessments and field tests (F23): `data` → `result`, and the zones a test can create. A port of
//! `api/mock/lib/assessments.mjs` (the web app mirrors it for the live preview); the tests below hold values the
//! mock computes, so the three agree.

use serde_json::{Map, Value, json};

pub const KINDS: [&str; 7] = ["body", "cooper", "run_3k", "css", "ftp", "one_rm", "hr_max"];

/// A field error on `data.<key>` (pt-BR message).
pub type DataError = (String, &'static str);

/// JavaScript's `Math.round` (half up), so results match the apps to the last digit.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

fn round(x: f64, digits: i32) -> f64 {
    let p = 10f64.powi(digits);
    js_round(x * p) / p
}

/// A JSON number written like JavaScript would (`95`, not `95.0`).
fn num(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 1e15 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

/// Daniels-Gilbert VO2max estimate from a performance (distance m, time s).
pub fn vo2_from_race(m: f64, s: f64) -> f64 {
    let t = s / 60.0;
    let v = m / t;
    let vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
    let pct = 0.8 + 0.1894393 * (-0.012778 * t).exp() + 0.2989558 * (-0.1932605 * t).exp();
    round(vo2 / pct, 1)
}

/// Threshold pace (≈ 10 km pace, Riegel 1.06) from any performance, in s/km.
pub fn threshold_from(m: f64, s: f64) -> i64 {
    js_round(s * (10000.0 / m).powf(1.06) / 10.0) as i64
}

/// `data` → `result`, or the field errors (`data.<key>`).
pub fn compute(kind: &str, data: &Value) -> Result<Value, Vec<DataError>> {
    let n = |k: &str| data.get(k).and_then(Value::as_f64);
    let mut errors = Vec::new();
    let mut need = |k: &str, ok: bool, message: &'static str| {
        if !ok {
            errors.push((format!("data.{k}"), message));
        }
    };
    let within = |k: &str, lo: f64, hi: f64| n(k).is_some_and(|x| x >= lo && x <= hi);
    let result = match kind {
        "body" => {
            need(
                "weight_kg",
                within("weight_kg", 25.0, 300.0),
                "Informe o peso em kg.",
            );
            need(
                "height_cm",
                within("height_cm", 100.0, 250.0),
                "Informe a altura em cm.",
            );
            let (w, h) = (n("weight_kg").unwrap_or(0.0), n("height_cm").unwrap_or(1.0));
            json!({ "bmi": num(round(w / (h / 100.0).powi(2), 1)) })
        }
        "cooper" => {
            need(
                "distance_m",
                within("distance_m", 800.0, 5500.0),
                "Informe a distância percorrida em 12 minutos.",
            );
            let d = n("distance_m").unwrap_or(0.0);
            json!({ "vo2max": num(round((d - 504.9) / 44.73, 1)), "threshold_pace_s_per_km": threshold_from(d, 720.0) })
        }
        "run_3k" => {
            need(
                "time_s",
                within("time_s", 420.0, 2700.0),
                "Informe o tempo dos 3 km.",
            );
            let t = n("time_s").unwrap_or(1.0);
            json!({ "vo2max": num(vo2_from_race(3000.0, t)), "threshold_pace_s_per_km": threshold_from(3000.0, t) })
        }
        "css" => {
            need(
                "t400_s",
                within("t400_s", 240.0, 1200.0),
                "Informe o tempo dos 400 m.",
            );
            let t400 = n("t400_s").unwrap_or(0.0);
            need(
                "t200_s",
                n("t200_s").is_some_and(|t| t >= 100.0 && t < t400),
                "Informe o tempo dos 200 m (menor que o dos 400 m).",
            );
            let t200 = n("t200_s").unwrap_or(0.0);
            json!({ "css_s_per_100m": num(round((t400 - t200) / 2.0, 1)) })
        }
        "ftp" => {
            need(
                "avg_power_w",
                within("avg_power_w", 50.0, 600.0),
                "Informe a potência média dos 20 minutos.",
            );
            json!({ "ftp_w": js_round(n("avg_power_w").unwrap_or(0.0) * 0.95) as i64 })
        }
        "one_rm" => {
            let exercise = data.get("exercise").and_then(Value::as_str).map(str::trim);
            need(
                "exercise",
                exercise.is_some_and(|e| !e.is_empty()),
                "Informe o exercício.",
            );
            need(
                "weight_kg",
                n("weight_kg").is_some_and(|w| w > 0.0 && w <= 500.0),
                "Informe a carga em kg.",
            );
            let reps = data.get("reps").and_then(Value::as_f64);
            need(
                "reps",
                reps.is_some_and(|r| r.fract() == 0.0 && (1.0..=15.0).contains(&r)),
                "Entre 1 e 15 repetições.",
            );
            let (w, r) = (n("weight_kg").unwrap_or(0.0), reps.unwrap_or(1.0));
            let one_rm = if r == 1.0 { w } else { w * (1.0 + r / 30.0) };
            json!({ "one_rm_kg": num(round(one_rm, 1)) })
        }
        "hr_max" => {
            need(
                "max_hr",
                within("max_hr", 120.0, 230.0),
                "Informe uma FC máxima entre 120 e 230 bpm.",
            );
            json!({ "max_hr": num(n("max_hr").unwrap_or(0.0)) })
        }
        _ => {
            return Err(vec![("kind".into(), "Tipo de avaliação inválido.")]);
        }
    };
    if errors.is_empty() {
        Ok(result)
    } else {
        Err(errors)
    }
}

/// Zones a test produces: `(kind, bounds [{zone, min, max}])`. Pace and swim pace in s (faster = smaller).
pub fn zones_from(kind: &str, result: &Value) -> Option<(&'static str, Value)> {
    let get = |k: &str| result.get(k).and_then(Value::as_f64).filter(|x| *x > 0.0);
    let from_threshold = |thr: f64, f: [f64; 5]| -> Value {
        (0..5)
            .map(|i| {
                let lower = if i + 1 < 5 { f[i + 1] } else { 0.85 };
                json!({ "zone": i + 1, "min": js_round(thr * lower) as i64, "max": js_round(thr * f[i]) as i64 })
            })
            .collect()
    };
    let scaled = |base: f64, f: [f64; 6], shave: bool| -> Value {
        (1..=5)
            .map(|z| {
                let cut = if shave && z != 5 { 1 } else { 0 };
                json!({ "zone": z, "min": js_round(base * f[z - 1]) as i64, "max": js_round(base * f[z]) as i64 - cut })
            })
            .collect()
    };
    match kind {
        "cooper" | "run_3k" => get("threshold_pace_s_per_km")
            .map(|t| ("pace", from_threshold(t, [1.3, 1.17, 1.08, 1.0, 0.94]))),
        "css" => get("css_s_per_100m").map(|t| {
            (
                "swim_pace",
                from_threshold(t, [1.25, 1.12, 1.05, 1.0, 0.95]),
            )
        }),
        "ftp" => get("ftp_w").map(|w| {
            (
                "power",
                scaled(w, [0.0, 0.56, 0.76, 0.91, 1.06, 1.21], true),
            )
        }),
        "hr_max" => {
            get("max_hr").map(|hr| ("hr", scaled(hr, [0.5, 0.6, 0.7, 0.8, 0.9, 1.0], false)))
        }
        _ => None,
    }
}

/// The profile fields a test updates when its zones are applied (`css` rounded to whole seconds).
pub fn profile_updates(result: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    for k in [
        "threshold_pace_s_per_km",
        "css_s_per_100m",
        "ftp_w",
        "max_hr",
    ] {
        if let Some(x) = result.get(k).and_then(Value::as_f64).filter(|x| *x > 0.0) {
            out.insert(k.into(), json!(js_round(x) as i64));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(kind: &str, data: Value) -> Value {
        compute(kind, &data).unwrap()
    }

    fn bounds(v: &Value) -> Vec<(i64, i64)> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|b| (b["min"].as_i64().unwrap(), b["max"].as_i64().unwrap()))
            .collect()
    }

    // Expected values: api/mock/lib/assessments.mjs on the same inputs.
    #[test]
    fn results_match_the_mock() {
        assert_eq!(
            ok("body", json!({"weight_kg": 70, "height_cm": 175})),
            json!({"bmi": 22.9})
        );
        assert_eq!(
            ok("cooper", json!({"distance_m": 2800})),
            json!({"vo2max": 51.3, "threshold_pace_s_per_km": 278})
        );
        assert_eq!(
            ok("cooper", json!({"distance_m": 3333})),
            json!({"vo2max": 63.2, "threshold_pace_s_per_km": 231})
        );
        assert_eq!(
            ok("run_3k", json!({"time_s": 720})),
            json!({"vo2max": 47.9, "threshold_pace_s_per_km": 258})
        );
        assert_eq!(
            ok("css", json!({"t400_s": 360, "t200_s": 170})).to_string(),
            r#"{"css_s_per_100m":95}"#
        );
        assert_eq!(
            ok("ftp", json!({"avg_power_w": 250})),
            json!({"ftp_w": 238})
        );
        assert_eq!(
            ok(
                "one_rm",
                json!({"exercise": "Supino", "weight_kg": 80, "reps": 5})
            ),
            json!({"one_rm_kg": 93.3})
        );
        assert_eq!(
            ok(
                "one_rm",
                json!({"exercise": "x", "weight_kg": 80, "reps": 1})
            )
            .to_string(),
            r#"{"one_rm_kg":80}"#
        );
        assert_eq!(ok("hr_max", json!({"max_hr": 190})), json!({"max_hr": 190}));
    }

    #[test]
    fn errors_match_the_mock() {
        let fields = |kind: &str, data: Value| -> Vec<String> {
            compute(kind, &data)
                .unwrap_err()
                .into_iter()
                .map(|e| e.0)
                .collect()
        };
        assert_eq!(
            fields("body", json!({})),
            ["data.weight_kg", "data.height_cm"]
        );
        assert_eq!(
            fields("css", json!({"t400_s": 360, "t200_s": 400})),
            ["data.t200_s"]
        );
        assert_eq!(
            fields("one_rm", json!({"reps": 2.5})),
            ["data.exercise", "data.weight_kg", "data.reps"]
        );
        assert_eq!(fields("yoga", json!({})), ["kind"]);
    }

    #[test]
    fn zones_match_the_mock() {
        let z = |kind: &str, data: Value| zones_from(kind, &ok(kind, data)).unwrap();
        let (k, b) = z("cooper", json!({"distance_m": 2800}));
        assert_eq!(k, "pace");
        assert_eq!(
            bounds(&b),
            [(325, 361), (300, 325), (278, 300), (261, 278), (236, 261)]
        );
        let (k, b) = z("run_3k", json!({"time_s": 720}));
        assert_eq!(k, "pace");
        assert_eq!(
            bounds(&b),
            [(302, 335), (279, 302), (258, 279), (243, 258), (219, 243)]
        );
        let (k, b) = z("css", json!({"t400_s": 360, "t200_s": 170}));
        assert_eq!(k, "swim_pace");
        assert_eq!(
            bounds(&b),
            [(106, 119), (100, 106), (95, 100), (90, 95), (81, 90)]
        );
        let (k, b) = z("ftp", json!({"avg_power_w": 250}));
        assert_eq!(k, "power");
        assert_eq!(
            bounds(&b),
            [(0, 132), (133, 180), (181, 216), (217, 251), (252, 288)]
        );
        let (k, b) = z("hr_max", json!({"max_hr": 190}));
        assert_eq!(k, "hr");
        assert_eq!(
            bounds(&b),
            [(95, 114), (114, 133), (133, 152), (152, 171), (171, 190)]
        );
        assert!(
            zones_from(
                "body",
                &ok("body", json!({"weight_kg": 70, "height_cm": 175}))
            )
            .is_none()
        );
    }

    #[test]
    fn profile_fields_from_a_result() {
        let p = profile_updates(
            &json!({"vo2max": 51.3, "threshold_pace_s_per_km": 278, "css_s_per_100m": 95.5}),
        );
        assert_eq!(
            Value::Object(p),
            json!({"threshold_pace_s_per_km": 278, "css_s_per_100m": 96})
        );
    }
}
