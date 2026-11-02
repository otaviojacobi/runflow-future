//! Request bodies. Like the mock, handlers read fields from a JSON object and validate each one with a
//! pt-BR message, so a bad field becomes a 422 `errors[]` entry instead of a generic parse error.

use axum::body::Bytes;
use axum::extract::{FromRequest, Request};
use axum::http::StatusCode;
use serde_json::{Map, Value};

use crate::Problem;

/// A JSON object body. An empty body is `{}`.
#[derive(Debug, Default)]
pub struct Body(pub Map<String, Value>);

impl<S: Send + Sync> FromRequest<S> for Body {
    type Rejection = Problem;

    async fn from_request(req: Request, state: &S) -> Result<Self, Problem> {
        let bytes = Bytes::from_request(req, state).await.map_err(|e| {
            if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
                Problem::too_large()
            } else {
                Problem::invalid_json()
            }
        })?;
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(Self::default());
        }
        match serde_json::from_slice(&bytes) {
            Ok(Value::Object(map)) => Ok(Self(map)),
            _ => Err(Problem::invalid_json()),
        }
    }
}

impl Body {
    /// The field is present (even if `null`): PATCH semantics.
    pub fn has(&self, key: &str) -> bool {
        self.0.contains_key(key)
    }

    /// Trimmed string; empty or non-string → `None`.
    pub fn str(&self, key: &str) -> Option<String> {
        self.0
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    }

    pub fn bool(&self, key: &str) -> Option<bool> {
        self.0.get(key).and_then(Value::as_bool)
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.get(key)
    }
}

/// Pragmatic e-mail check (same intent as the apps': `nome@dominio.tld`).
pub fn is_email(s: &str) -> bool {
    if s.len() > 254 || s.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = s.split_once('@') else {
        return false;
    };
    let Some((host, tld)) = domain.rsplit_once('.') else {
        return false;
    };
    !local.is_empty() && !host.is_empty() && !domain.contains('@') && tld.chars().count() >= 2
}

#[cfg(test)]
mod tests {
    use super::is_email;

    #[test]
    fn emails() {
        for ok in ["ana@email.com", "a.b+c@sub.dominio.com.br"] {
            assert!(is_email(ok), "{ok}");
        }
        for bad in [
            "",
            "ana",
            "ana@",
            "@x.com",
            "ana@email",
            "ana@email.c",
            "a b@x.com",
            "a@b@c.com",
        ] {
            assert!(!is_email(bad), "{bad}");
        }
    }
}
