//! Rust port of the club color engine (`design/src/color.js`, D-014, §7.8).
//!
//! The backend runs it once per branding save and stores the result (`club_branding.theme` + `theme_css`).
//! It must reproduce `design/dist/color-fixtures.json` exactly (synced to `assets/design/`); the test in
//! `tests/color_fixtures.rs` is the proof. When `color.js` changes, port the change here in the same step.
//! Color math: OKLab/OKLCH (Björn Ottosson), WCAG 2.x contrast. Only what the server needs is ported
//! (no logo color suggestions: the apps do that).

use serde::Serialize;
use serde_json::{Map, Value, json};

pub const STEPS: [u16; 11] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const L_TARGET: [f64; 11] = [
    0.975, 0.945, 0.89, 0.82, 0.72, 0.63, 0.54, 0.47, 0.4, 0.33, 0.26,
];
const C_FACTOR: [f64; 11] = [
    0.12, 0.22, 0.42, 0.65, 0.85, 0.97, 1.0, 0.92, 0.8, 0.66, 0.52,
];

pub const ROLE_KEYS: [&str; 11] = [
    "solid",
    "solidHover",
    "solidActive",
    "onSolid",
    "solidBorder",
    "text",
    "subtle",
    "subtleHover",
    "subtleFg",
    "border",
    "ring",
];

/// Backgrounds a theme is checked against, per mode (`tokens.json` → `env`).
#[derive(Debug, Clone)]
pub struct Env {
    pub canvas: String,
    pub surface: String,
    pub white: String,
    pub ink: String,
}

#[derive(Debug, Clone)]
pub struct Envs {
    pub light: Env,
    pub dark: Env,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Light,
    Dark,
}

impl Mode {
    fn env(self, envs: &Envs) -> &Env {
        match self {
            Mode::Light => &envs.light,
            Mode::Dark => &envs.dark,
        }
    }
}

/// Runflow's own seeds (`tokens.json` → `seeds.brand`, `seeds.accent`).
#[derive(Debug, Clone)]
pub struct Defaults {
    pub brand: String,
    pub accent: String,
}

// ------------------------------------------------------------------------------------ conversions

/// `#RGB` / `#RRGGBB` (with or without `#`) → linear-free sRGB in 0..1. `None` if invalid.
pub fn hex_to_rgb(hex: &str) -> Option<[f64; 3]> {
    let h = hex.trim().replacen('#', "", 1);
    let h: String = if h.len() == 3 {
        h.chars().flat_map(|c| [c, c]).collect()
    } else {
        h
    };
    if h.len() != 6 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let n = u32::from_str_radix(&h, 16).ok()?;
    Some([
        ((n >> 16) & 255) as f64 / 255.0,
        ((n >> 8) & 255) as f64 / 255.0,
        (n & 255) as f64 / 255.0,
    ])
}

fn rgb(hex: &str) -> [f64; 3] {
    hex_to_rgb(hex).unwrap_or_else(|| panic!("invalid hex color: {hex}"))
}

pub fn rgb_to_hex(rgb: [f64; 3]) -> String {
    let c = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02X}{:02X}{:02X}", c(rgb[0]), c(rgb[1]), c(rgb[2]))
}

fn to_lin(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn from_lin(c: f64) -> f64 {
    if c <= 0.0031308 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

fn lin_to_oklab([r, g, b]: [f64; 3]) -> [f64; 3] {
    let l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b).cbrt();
    let m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b).cbrt();
    let s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b).cbrt();
    [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
}

fn oklab_to_lin([l_, a, b]: [f64; 3]) -> [f64; 3] {
    let l = (l_ + 0.3963377774 * a + 0.2158037573 * b).powi(3);
    let m = (l_ - 0.1055613458 * a - 0.0638541728 * b).powi(3);
    let s = (l_ - 0.0894841775 * a - 1.291485548 * b).powi(3);
    [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
}

/// hex → `[L (0..1), C (0..~0.37), H (deg)]`.
pub fn to_oklch(hex: &str) -> [f64; 3] {
    let [r, g, b] = rgb(hex);
    let [l, a, bb] = lin_to_oklab([to_lin(r), to_lin(g), to_lin(b)]);
    let c = (a * a + bb * bb).sqrt();
    let mut h = bb.atan2(a) * 180.0 / std::f64::consts::PI;
    if h < 0.0 {
        h += 360.0;
    }
    [l, c, if c < 1e-4 { 0.0 } else { h }]
}

fn oklch_to_lin(l: f64, c: f64, h: f64) -> [f64; 3] {
    let hr = h * std::f64::consts::PI / 180.0;
    oklab_to_lin([l, c * hr.cos(), c * hr.sin()])
}

fn in_gamut(lin: &[f64; 3]) -> bool {
    lin.iter().all(|v| *v >= -1e-5 && *v <= 1.0 + 1e-5)
}

/// OKLCH → hex, reducing chroma (keeping L and H) until it fits sRGB.
pub fn oklch(l: f64, c: f64, h: f64) -> String {
    let l = l.clamp(0.0, 1.0);
    let mut lin = oklch_to_lin(l, c, h);
    if !in_gamut(&lin) {
        let (mut lo, mut hi) = (0.0, c);
        for _ in 0..24 {
            let mid = (lo + hi) / 2.0;
            if in_gamut(&oklch_to_lin(l, mid, h)) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        lin = oklch_to_lin(l, lo, h);
    }
    rgb_to_hex(lin.map(|v| from_lin(v.clamp(0.0, 1.0))))
}

// ------------------------------------------------------------------------------------ contrast

pub fn luminance(hex: &str) -> f64 {
    let [r, g, b] = rgb(hex);
    0.2126 * to_lin(r) + 0.7152 * to_lin(g) + 0.0722 * to_lin(b)
}

pub fn contrast(a: &str, b: &str) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

/// Move lightness (+1 lighter, −1 darker) until `contrast(result, against) >= target`; closest to the original.
pub fn ensure_contrast(hex: &str, against: &str, target: f64, direction: i8) -> String {
    if contrast(hex, against) >= target {
        return hex.to_uppercase();
    }
    let [l, c, h] = to_oklch(hex);
    let (mut lo, mut hi) = (l, if direction > 0 { 1.0 } else { 0.0 });
    if contrast(&oklch(hi, c, h), against) < target {
        return oklch(hi, c, h);
    }
    for _ in 0..28 {
        let mid = (lo + hi) / 2.0;
        if contrast(&oklch(mid, c, h), against) >= target {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    oklch(hi, c, h)
}

pub fn shift_l(hex: &str, delta: f64) -> String {
    let [l, c, h] = to_oklch(hex);
    oklch(l + delta, c, h)
}

// ------------------------------------------------------------------------------------ scales

/// Tonal scale 50..950 (in `STEPS` order) and the anchored step (where the seed itself sits).
pub fn scale(seed: &str) -> ([String; 11], u16) {
    let [l, c, h] = to_oklch(seed);
    let mut out: [String; 11] = Default::default();
    for (i, lt) in L_TARGET.iter().enumerate() {
        let near = if *lt < l {
            1.0 - (0.5 * (l - lt)) / (l - 0.2).max(0.1)
        } else {
            (1.0 - (lt - l) / (1.0 - l).max(0.02)).max(0.0).powf(1.2)
        };
        out[i] = oklch(*lt, c * C_FACTOR[i].max(near), h);
    }
    // Strictly closer wins, so ties keep the earlier step (same as color.js).
    let nearest = L_TARGET.iter().enumerate().fold(0, |best, (i, lt)| {
        if (lt - l).abs() < (L_TARGET[best] - l).abs() {
            i
        } else {
            best
        }
    });
    out[nearest] = seed.to_uppercase();
    (out, STEPS[nearest])
}

fn step(scale: &[String; 11], s: u16) -> &str {
    &scale[STEPS.iter().position(|x| *x == s).expect("known step")]
}

// ------------------------------------------------------------------------------------ roles

/// The semantic roles of one chromatic color for one mode (see `color.js` → `roles()` for the guarantees).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Roles {
    pub solid: String,
    pub solid_hover: String,
    pub solid_active: String,
    pub on_solid: String,
    pub solid_border: String,
    pub text: String,
    pub subtle: String,
    pub subtle_hover: String,
    pub subtle_fg: String,
    pub border: String,
    pub ring: String,
    pub meta: RolesMeta,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolesMeta {
    pub seed: String,
    pub solid_adjusted: bool,
    pub on_solid_contrast: f64,
    pub solid_vs_canvas: f64,
    pub text_adjusted: bool,
}

impl Roles {
    /// In `ROLE_KEYS` order.
    pub fn values(&self) -> [&str; 11] {
        [
            &self.solid,
            &self.solid_hover,
            &self.solid_active,
            &self.on_solid,
            &self.solid_border,
            &self.text,
            &self.subtle,
            &self.subtle_hover,
            &self.subtle_fg,
            &self.border,
            &self.ring,
        ]
    }

    /// The role colors only (what `club_branding.theme.roles` stores).
    pub fn to_json(&self) -> Value {
        Value::Object(
            ROLE_KEYS
                .iter()
                .zip(self.values())
                .map(|(k, v)| (k.to_string(), json!(v)))
                .collect::<Map<_, _>>(),
        )
    }
}

/// JavaScript's `+x.toFixed(2)`.
fn fixed2(x: f64) -> f64 {
    format!("{x:.2}").parse().unwrap_or(x)
}

pub fn roles(seed: &str, mode: Mode, env: &Env) -> Roles {
    let (s, _) = scale(seed);
    let [_, c, h] = to_oklch(seed);
    let dark = mode == Mode::Dark;
    let away: i8 = if dark { 1 } else { -1 };

    let mut solid = seed.to_uppercase();
    let mut adjusted = false;
    if dark && contrast(&solid, &env.canvas) < 3.0 {
        solid = ensure_contrast(&solid, &env.canvas, 3.0, 1);
        adjusted = true;
    }
    let on_solid = if contrast(&solid, &env.white) >= 4.5 {
        env.white.clone()
    } else if contrast(&solid, &env.ink) >= 4.5 {
        env.ink.clone()
    } else {
        "#000000".to_string()
    };
    let [ls, _, _] = to_oklch(&solid);
    let hover_dir = if ls < 0.32 { 1.0 } else { -1.0 };
    let solid_hover = shift_l(&solid, 0.05 * hover_dir);
    let solid_active = shift_l(&solid, 0.09 * hover_dir);
    let solid_border = ensure_contrast(&solid, &env.canvas, 3.0, away);

    let text = ensure_contrast(seed, &env.surface, 4.6, away);
    let subtle = if dark {
        oklch(0.29, (c * 0.4).min(0.075), h)
    } else {
        step(&s, 50).to_string()
    };
    let subtle_hover = if dark {
        oklch(0.33, (c * 0.45).min(0.085), h)
    } else {
        step(&s, 100).to_string()
    };
    let subtle_fg = ensure_contrast(
        if dark { step(&s, 200) } else { step(&s, 800) },
        &subtle,
        4.6,
        away,
    );
    let border = if dark {
        oklch(0.42, (c * 0.55).min(0.11), h)
    } else {
        step(&s, 200).to_string()
    };
    let ring = ensure_contrast(&text, &env.surface, 3.0, away);

    let meta = RolesMeta {
        seed: seed.to_uppercase(),
        solid_adjusted: adjusted,
        on_solid_contrast: fixed2(contrast(&solid, &on_solid)),
        solid_vs_canvas: fixed2(contrast(&solid, &env.canvas)),
        text_adjusted: text != seed.to_uppercase(),
    };
    Roles {
        solid,
        solid_hover,
        solid_active,
        on_solid,
        solid_border,
        text,
        subtle,
        subtle_hover,
        subtle_fg,
        border,
        ring,
        meta,
    }
}

fn kebab(s: &str) -> String {
    s.chars()
        .flat_map(|c| {
            if c.is_ascii_uppercase() {
                vec!['-', c.to_ascii_lowercase()]
            } else {
                vec![c]
            }
        })
        .collect()
}

fn roles_to_css(prefix: &str, r: &Roles) -> String {
    ROLE_KEYS
        .iter()
        .zip(r.values())
        .map(|(k, v)| format!("--rf-{prefix}-{}: {v};", kebab(k)))
        .collect::<Vec<_>>()
        .join(" ")
}

// ------------------------------------------------------------------------------------ club themes

/// Companion color for a club that chose only a primary (achromatic primary → Runflow's accent).
pub fn derive_secondary(primary: &str, fallback: &str) -> String {
    let [l, c, h] = to_oklch(primary);
    if c < 0.04 {
        return fallback.to_uppercase();
    }
    if l > 0.72 {
        oklch(0.36, c * 0.85, h)
    } else {
        oklch(0.88, c * 0.85, h)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Default,
    Derived,
    Club,
}

/// A club's two seeds, from its 0, 1 or 2 chosen colors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Resolved {
    pub primary: String,
    pub secondary: String,
    pub source: Source,
}

/// `#RRGGBB` (case-insensitive, `#` optional) → `#RRGGBB` uppercase; anything else → `None`.
pub fn normalize_hex(h: &str) -> Option<String> {
    let t = h.trim();
    let body = t.strip_prefix('#').unwrap_or(t);
    (body.len() == 6 && body.chars().all(|c| c.is_ascii_hexdigit()))
        .then(|| format!("#{}", body.to_uppercase()))
}

pub fn resolve_club_colors(
    primary: Option<&str>,
    secondary: Option<&str>,
    defaults: &Defaults,
) -> Resolved {
    let mut p = primary.and_then(normalize_hex);
    let mut s = secondary.and_then(normalize_hex);
    if p.is_none() && s.is_some() {
        p = s.take();
    }
    match (p, s) {
        (None, _) => Resolved {
            primary: defaults.brand.to_uppercase(),
            secondary: defaults.accent.to_uppercase(),
            source: Source::Default,
        },
        (Some(p), None) => Resolved {
            secondary: derive_secondary(&p, &defaults.accent),
            primary: p,
            source: Source::Derived,
        },
        (Some(p), Some(s)) => Resolved {
            primary: p,
            secondary: s,
            source: Source::Club,
        },
    }
}

/// Full CSS override for a club theme: brand/accent scales, light, dark and the system preference.
pub fn club_theme_css(
    primary: Option<&str>,
    secondary: Option<&str>,
    envs: &Envs,
    defaults: &Defaults,
) -> String {
    let c = resolve_club_colors(primary, secondary, defaults);
    let scale_css = |name: &str, seed: &str| {
        let (sc, _) = scale(seed);
        STEPS
            .iter()
            .zip(sc.iter())
            .map(|(st, v)| format!("--rf-{name}-{st}: {v};"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    let mode_css = |mode: Mode| {
        let env = mode.env(envs);
        format!(
            "{} {}",
            roles_to_css("brand", &roles(&c.primary, mode, env)),
            roles_to_css("accent", &roles(&c.secondary, mode, env))
        )
    };
    let dark = mode_css(Mode::Dark);
    format!(
        ":root {{ {} {} }}\n:root, [data-theme=\"light\"] {{ {} }}\n[data-theme=\"dark\"] {{ {dark} }}\n@media (prefers-color-scheme: dark) {{ :root:not([data-theme=\"light\"]) {{ {dark} }} }}",
        scale_css("brand", &c.primary),
        scale_css("accent", &c.secondary),
        mode_css(Mode::Light),
    )
}

/// What `club_branding` stores: `theme` (`{primary, secondary, source, roles: {light, dark}}`) and the CSS.
pub fn club_theme(
    primary: Option<&str>,
    secondary: Option<&str>,
    envs: &Envs,
    defaults: &Defaults,
) -> (Value, String) {
    let r = resolve_club_colors(primary, secondary, defaults);
    let roles_for = |mode: Mode| {
        let env = mode.env(envs);
        json!({ "brand": roles(&r.primary, mode, env).to_json(), "accent": roles(&r.secondary, mode, env).to_json() })
    };
    let theme = json!({
        "primary": r.primary, "secondary": r.secondary, "source": r.source,
        "roles": { "light": roles_for(Mode::Light), "dark": roles_for(Mode::Dark) },
    });
    (theme, club_theme_css(primary, secondary, envs, defaults))
}

/// Runflow's envs and defaults, from the design tokens (`tokens.json`: `env`, `seeds`).
pub fn from_tokens(tokens: &Value) -> Option<(Envs, Defaults)> {
    let env = |mode: &str| -> Option<Env> {
        let e = &tokens["env"][mode];
        Some(Env {
            canvas: e["canvas"].as_str()?.into(),
            surface: e["surface"].as_str()?.into(),
            white: e["white"].as_str()?.into(),
            ink: e["ink"].as_str()?.into(),
        })
    };
    let defaults = Defaults {
        brand: tokens["seeds"]["brand"].as_str()?.into(),
        accent: tokens["seeds"]["accent"].as_str()?.into(),
    };
    Some((
        Envs {
            light: env("light")?,
            dark: env("dark")?,
        },
        defaults,
    ))
}
