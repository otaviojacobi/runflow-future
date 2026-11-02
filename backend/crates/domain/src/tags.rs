//! Workout hashtags, normalized on write (api/endpoints.md § Tags; same rule as the apps and the mock).

pub const MAX_TAGS: usize = 8;
const MAX_LEN: usize = 30;

/// `"#Ritmo de Prova"` → `"ritmo-de-prova"`; empty when nothing usable is left.
pub fn normalize(raw: &str) -> String {
    let lowered = raw.trim_start_matches('#').trim().to_lowercase();
    let mut out = String::new();
    for c in lowered.chars() {
        let c = if c.is_whitespace() { '-' } else { c };
        if !(c.is_alphanumeric() || c == '-' || c == '_') {
            continue;
        }
        if c == '-' && out.ends_with('-') {
            continue;
        }
        out.push(c);
    }
    let trimmed = out.trim_matches('-');
    trimmed.chars().take(MAX_LEN).collect()
}

/// Normalized, without empties or duplicates (order kept). `Err` when more than `MAX_TAGS` remain.
pub fn clean(raw: &[String]) -> Result<Vec<String>, usize> {
    let mut out: Vec<String> = Vec::new();
    for t in raw {
        let n = normalize(t);
        if !n.is_empty() && !out.contains(&n) {
            out.push(n);
        }
    }
    if out.len() > MAX_TAGS {
        Err(out.len())
    } else {
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_apps() {
        assert_eq!(normalize("#Intervalado"), "intervalado");
        assert_eq!(normalize("  Ritmo de Prova "), "ritmo-de-prova");
        assert_eq!(normalize("#técnica!"), "técnica");
        assert_eq!(normalize("###"), "");
        assert_eq!(normalize(&"a".repeat(40)).chars().count(), 30);
        assert_eq!(
            clean(&["Limiar".into(), "#limiar".into(), "pista".into(), "".into()]).unwrap(),
            ["limiar", "pista"]
        );
        assert_eq!(
            clean(&(0..9).map(|i| format!("t{i}")).collect::<Vec<_>>()),
            Err(9)
        );
    }
}
