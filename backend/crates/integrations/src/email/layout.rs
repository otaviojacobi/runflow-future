//! The Runflow e-mail frame (D-024: e-mails are Runflow's brand). E-mail clients don't support CSS
//! variables, so colors, type, spacing and radii are read from the design tokens
//! (`assets/design/tokens.json`, a synced copy of `design/dist/tokens.json`) and inlined.

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

/// Wrap already-escaped `body_html` (see [`paragraph`]) in the Runflow frame. `title` and `footer` are plain text.
pub fn layout(title: &str, body_html: &str, action: Option<Action<'_>>, footer: &str) -> String {
    let (canvas, surface, border, fg, muted) = (
        color(&["bg", "canvas"]),
        color(&["bg", "surface"]),
        color(&["border", "subtle"]),
        color(&["fg", "default"]),
        color(&["fg", "muted"]),
    );
    let (brand, on_brand, accent) = (
        color(&["brand", "solid"]),
        color(&["brand", "onSolid"]),
        color(&["accent", "solid"]),
    );
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
<tr><td style="padding:0 0 {s4}px;{wordmark_css};color:{fg}"><span style="display:inline-block;width:{s2}px;height:{s2}px;border-radius:{full}px;background:{accent};border:{s1}px solid {brand};vertical-align:middle;margin-right:{s2}px"></span>runflow</td></tr>
<tr><td style="background:{surface};border:1px solid {border};border-radius:{r}px;padding:{s6}px">
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
        s2 = space("2"),
        s3 = space("3"),
        s4 = space("4"),
        s6 = space("6"),
        full = radius("full"),
        r = radius("lg"),
        body = body_html,
        footer = escape_html(footer),
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
}
