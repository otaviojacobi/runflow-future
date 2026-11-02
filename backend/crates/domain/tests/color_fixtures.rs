//! The Rust color engine must reproduce `design/dist/color-fixtures.json` (synced to `assets/design/`) exactly:
//! scales, roles (with meta) in both modes, color resolution, and the stored theme + CSS (D-014, §7.8).

use runflow_domain::color::{
    Defaults, Env, Envs, Mode, STEPS, club_theme, resolve_club_colors, roles, scale,
};
use serde_json::{Value, json};

const FIXTURES: &str = include_str!("../../../assets/design/color-fixtures.json");
const TOKENS: &str = include_str!("../../../assets/design/tokens.json");

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).unwrap()
}

fn envs(f: &Value) -> Envs {
    let env = |m: &str| Env {
        canvas: f["env"][m]["canvas"].as_str().unwrap().into(),
        surface: f["env"][m]["surface"].as_str().unwrap().into(),
        white: f["env"][m]["white"].as_str().unwrap().into(),
        ink: f["env"][m]["ink"].as_str().unwrap().into(),
    };
    Envs {
        light: env("light"),
        dark: env("dark"),
    }
}

fn defaults(f: &Value) -> Defaults {
    Defaults {
        brand: f["defaults"]["brand"].as_str().unwrap().into(),
        accent: f["defaults"]["accent"].as_str().unwrap().into(),
    }
}

fn input(i: &Value) -> (Option<&str>, Option<&str>) {
    (i["primary"].as_str(), i["secondary"].as_str())
}

#[test]
fn scales_and_roles_match_every_fixture() {
    let f = fixtures();
    let envs = envs(&f);
    let mut mismatches = Vec::new();
    for fx in f["fixtures"].as_array().unwrap() {
        let seed = fx["seed"].as_str().unwrap();
        let (sc, _) = scale(seed);
        let got: Value = STEPS
            .iter()
            .zip(sc.iter())
            .map(|(s, v)| (s.to_string(), json!(v)))
            .collect::<serde_json::Map<_, _>>()
            .into();
        if got != fx["scale"] {
            mismatches.push(format!("{seed} scale: got {got} want {}", fx["scale"]));
        }
        for (mode, key, env) in [
            (Mode::Light, "light", &envs.light),
            (Mode::Dark, "dark", &envs.dark),
        ] {
            let got = serde_json::to_value(roles(seed, mode, env)).unwrap();
            if got != fx[key] {
                mismatches.push(format!("{seed} {key}: got {got} want {}", fx[key]));
            }
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} mismatches:\n{}",
        mismatches.len(),
        mismatches.join("\n")
    );
}

#[test]
fn resolution_matches() {
    let f = fixtures();
    let d = defaults(&f);
    for r in f["resolution"].as_array().unwrap() {
        let (p, s) = input(&r["input"]);
        assert_eq!(
            serde_json::to_value(resolve_club_colors(p, s, &d)).unwrap(),
            r["output"],
            "input {}",
            r["input"]
        );
    }
}

#[test]
fn stored_theme_and_css_match() {
    let f = fixtures();
    let (envs, d) = (envs(&f), defaults(&f));
    let themes = f["themes"]
        .as_array()
        .expect("design build emits `themes` fixtures");
    assert!(!themes.is_empty());
    for t in themes {
        let (p, s) = input(&t["input"]);
        let (theme, css) = club_theme(p, s, &envs, &d);
        assert_eq!(theme, t["theme"], "theme for {}", t["input"]);
        assert_eq!(css, t["css"].as_str().unwrap(), "css for {}", t["input"]);
    }
}

#[test]
fn tokens_provide_the_same_envs_and_defaults() {
    let tokens: Value = serde_json::from_str(TOKENS).unwrap();
    let (envs, d) =
        runflow_domain::color::from_tokens(&tokens).expect("tokens.json has env + seeds");
    let f = fixtures();
    assert_eq!(
        (d.brand.as_str(), d.accent.as_str()),
        (
            f["defaults"]["brand"].as_str().unwrap(),
            f["defaults"]["accent"].as_str().unwrap()
        )
    );
    assert_eq!(
        envs.dark.canvas,
        f["env"]["dark"]["canvas"].as_str().unwrap()
    );
}
