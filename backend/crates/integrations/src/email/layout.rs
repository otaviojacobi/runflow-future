//! E-mail frames. Runflow's own (sign-in codes, account) and a club's (D-036: invites and club notices wear the
//! club's Studio colors, logo and name; Runflow is credited in the footer). E-mail clients don't support CSS
//! variables, so colors, type, spacing and radii are read from the design tokens (`assets/design/tokens.json`,
//! a synced copy of `design/dist/tokens.json`) or the club's stored theme, and inlined.

use std::sync::LazyLock;

use serde_json::Value;

static TOKENS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../../assets/design/tokens.json"))
        .expect("assets/design/tokens.json is valid JSON")
});

fn color(path: &[&str]) -> String {
    let mut v = &TOKENS["semantic"]["light"];
    for k in path {
        v = &v[*k];
    }
    v.as_str()
        .unwrap_or_else(|| panic!("missing color token semantic.light.{}", path.join(".")))
        .to_string()
}

fn space(step: &str) -> u64 {
    TOKENS["space"][step]
        .as_u64()
        .unwrap_or_else(|| panic!("missing space token {step}"))
}

fn radius(name: &str) -> u64 {
    TOKENS["radius"][name]
        .as_u64()
        .unwrap_or_else(|| panic!("missing radius token {name}"))
}

/// Inline CSS for a text style token (`titleLg`, `bodyMd`, …).
fn text(style: &str) -> String {
    let t = &TOKENS["text"][style];
    let family = t["family"].as_str().unwrap_or("body");
    let stack = TOKENS["font"]["family"][family]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(|f| {
                    if f.contains(' ') {
                        format!("'{f}'")
                    } else {
                        f.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_else(|| panic!("missing font family {family}"));
    format!(
        "font-family:{stack};font-size:{}px;line-height:{}px;font-weight:{}",
        t["size"]
            .as_u64()
            .unwrap_or_else(|| panic!("missing text token {style}")),
        t["lineHeight"].as_u64().unwrap_or_default(),
        t["weight"].as_u64().unwrap_or(400),
    )
}

/// A call-to-action button.
pub struct Action<'a> {
    pub label: &'a str,
    pub url: &'a str,
}

/// Minimal HTML escaping for text that comes from people (names, club names).
pub fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// A paragraph in the body style. `html` must already be escaped.
pub fn paragraph(html: &str) -> String {
    format!(
        r#"<p style="margin:0 0 {}px;{}">{html}</p>"#,
        space("3"),
        text("bodyMd")
    )
}

/// A one-time code, big and spaced, easy to read and copy. `code` is digits only.
pub fn code_block(code: &str) -> String {
    format!(
        r#"<p style="margin:{my}px 0;padding:{p}px;background:{bg};border-radius:{r}px;text-align:center;{css};letter-spacing:{ls}px;color:{fg}">{code}</p>"#,
        my = space("5"),
        p = space("4"),
        bg = color(&["bg", "sunken"]),
        r = radius("md"),
        css = text("metricLg"),
        ls = space("2"),
        fg = color(&["fg", "default"]),
        code = escape_html(code),
    )
}

/// A club's e-mail identity (D-036): its name, its logo (an absolute URL to a PNG/JPG/WebP; SVG doesn't render in
/// most e-mail clients) and its stored theme (`club_branding.theme`, the color engine's output).
pub struct ClubFrame<'a> {
    pub name: &'a str,
    pub logo_url: Option<&'a str>,
    pub theme: &'a Value,
}

/// `#RRGGBB` from the club theme's light roles, if well-formed (never inline anything else into CSS).
fn theme_color(theme: &Value, role: &str, key: &str) -> Option<String> {
    theme["roles"]["light"][role][key]
        .as_str()
        .filter(|c| {
            c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit())
        })
        .map(str::to_string)
}

struct Colors {
    brand: String,
    on_brand: String,
    accent: String,
}

fn runflow_colors() -> Colors {
    Colors {
        brand: color(&["brand", "solid"]),
        on_brand: color(&["brand", "onSolid"]),
        accent: color(&["accent", "solid"]),
    }
}

/// Wrap already-escaped `body_html` (see [`paragraph`]) in the Runflow frame. `title` and `footer` are plain text.
pub fn layout(title: &str, body_html: &str, action: Option<Action<'_>>, footer: &str) -> String {
    let c = runflow_colors();
    let header = format!(
        r#"<span style="display:inline-block;width:{s2}px;height:{s2}px;border-radius:{full}px;background:{accent};border:{s1}px solid {brand};vertical-align:middle;margin-right:{s2}px"></span>runflow"#,
        s1 = space("1"),
        s2 = space("2"),
        full = radius("full"),
        accent = c.accent,
        brand = c.brand,
    );
    frame(&c, &header, title, body_html, action, &escape_html(footer))
}

/// The same frame in a club's colors, with its logo and name on top and Runflow credited in the footer (D-036).
pub fn club_layout(
    club: &ClubFrame<'_>,
    title: &str,
    body_html: &str,
    action: Option<Action<'_>>,
    footer: &str,
) -> String {
    let fallback = runflow_colors();
    let c = Colors {
        brand: theme_color(club.theme, "brand", "solid").unwrap_or(fallback.brand),
        on_brand: theme_color(club.theme, "brand", "onSolid").unwrap_or(fallback.on_brand),
        accent: theme_color(club.theme, "accent", "solid").unwrap_or(fallback.accent),
    };
    let logo = club
        .logo_url
        .map(|url| {
            format!(
                r#"<img src="{url}" width="{s10}" height="{s10}" alt="" style="border-radius:{r}px;vertical-align:middle;margin-right:{s3}px">"#,
                url = escape_html(url),
                s10 = space("10"),
                s3 = space("3"),
                r = radius("md"),
            )
        })
        .unwrap_or_default();
    let header = format!("{logo}{}", escape_html(club.name));
    let footer = format!(
        "{}<br>{}",
        escape_html(footer),
        escape_html(&format!("{} usa o Runflow para os treinos.", club.name))
    );
    frame(&c, &header, title, body_html, action, &footer)
}

/// `header_html` and `footer_html` are already escaped.
fn frame(
    c: &Colors,
    header_html: &str,
    title: &str,
    body_html: &str,
    action: Option<Action<'_>>,
    footer_html: &str,
) -> String {
    let (canvas, surface, border, fg, muted) = (
        color(&["bg", "canvas"]),
        color(&["bg", "surface"]),
        color(&["border", "subtle"]),
        color(&["fg", "default"]),
        color(&["fg", "muted"]),
    );
    let (brand, on_brand) = (&c.brand, &c.on_brand);
    let button = action
        .map(|a| {
            format!(
                r#"<p style="margin:{top}px 0 0"><a href="{url}" style="display:inline-block;background:{brand};color:{on_brand};{label_css};text-decoration:none;padding:{py}px {px}px;border-radius:{r}px">{label}</a></p>"#,
                top = space("5"),
                url = escape_html(a.url),
                label_css = text("labelMd"),
                py = space("3"),
                px = space("5"),
                r = radius("md"),
                label = escape_html(a.label),
            )
        })
        .unwrap_or_default();
    format!(
        r#"<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title></head>
<body style="margin:0;padding:0;background:{canvas};color:{fg};{body_css}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{canvas}"><tr><td align="center" style="padding:{s6}px {s4}px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 0 {s4}px;{wordmark_css};color:{fg}">{header}</td></tr>
<tr><td style="background:{surface};border:1px solid {border};border-top:{s1}px solid {brand};border-radius:{r}px;padding:{s6}px">
<h1 style="margin:0 0 {s3}px;{title_css};color:{fg}">{title}</h1>
{body}{button}
</td></tr>
<tr><td style="padding:{s4}px {s1}px 0;{caption_css};color:{muted}">{footer}</td></tr>
</table></td></tr></table></body></html>"#,
        title = escape_html(title),
        body_css = text("bodyMd"),
        wordmark_css = text("displaySm"),
        title_css = text("titleLg"),
        caption_css = text("caption"),
        s1 = space("1"),
        s3 = space("3"),
        s4 = space("4"),
        s6 = space("6"),
        r = radius("lg"),
        header = header_html,
        body = body_html,
        footer = footer_html,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_uses_tokens_and_escapes() {
        let html = layout(
            "Olá <Ana>",
            &paragraph("Oi"),
            Some(Action {
                label: "Abrir",
                url: "https://runflow.club/?a=1&b=2",
            }),
            "Runflow",
        );
        assert!(html.contains("Olá &lt;Ana&gt;"));
        assert!(html.contains("a=1&amp;b=2"));
        let brand = color(&["brand", "solid"]);
        assert!(brand.starts_with('#') && html.contains(&brand));
        assert!(html.contains("lang=\"pt-BR\"") && html.contains("font-size:16px"));
    }

    #[test]
    fn club_frame_wears_the_club_colors() {
        let theme = serde_json::json!({ "roles": { "light": {
            "brand": { "solid": "#D62828", "onSolid": "#FFFFFF" },
            "accent": { "solid": "#FFB703" } } } });
        let club = ClubFrame {
            name: "Pace <Forte>",
            logo_url: Some("https://qa.runflow.club/api/v1/assets/x"),
            theme: &theme,
        };
        let html = club_layout(
            &club,
            "Convite",
            &paragraph("Oi"),
            Some(Action {
                label: "Aceitar",
                url: "https://x",
            }),
            "Rodapé",
        );
        assert!(
            html.contains("background:#D62828") && html.contains("color:#FFFFFF"),
            "button in the club's primary"
        );
        assert!(
            html.contains("Pace &lt;Forte&gt;")
                && html.contains("<img src=\"https://qa.runflow.club/api/v1/assets/x\"")
        );
        assert!(
            html.contains("usa o Runflow para os treinos"),
            "Runflow credited in the footer"
        );
        assert!(
            !html.contains(">runflow</td>"),
            "no Runflow wordmark on top"
        );
        // A malformed theme falls back to Runflow's colors instead of inlining anything.
        let bad =
            serde_json::json!({ "roles": { "light": { "brand": { "solid": "red;}</style>" } } } });
        let club = ClubFrame {
            name: "X",
            logo_url: None,
            theme: &bad,
        };
        let html = club_layout(&club, "T", "", None, "F");
        assert!(!html.contains("red;}") && html.contains(&color(&["brand", "solid"])));
    }
}
