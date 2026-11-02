//! Sessions (§7.3): opaque random tokens, stored as SHA-256 hashes, revocable. Mobile sends
//! `Authorization: Bearer <token>`; the web gets the same token in an HttpOnly cookie.

use aws_lc_rs::{digest, hmac, rand};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, header};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::Utc;
use uuid::Uuid;

use crate::{AppState, AuthSettings, Problem};

pub const SESSION_COOKIE: &str = "rf_session";
/// Don't write `last_seen_at` on every request.
const TOUCH_EVERY: chrono::Duration = chrono::Duration::minutes(5);

/// `rf_` + 256 random bits.
pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes).expect("system randomness");
    format!("rf_{}", URL_SAFE_NO_PAD.encode(bytes))
}

pub fn hash_token(token: &str) -> Vec<u8> {
    digest::digest(&digest::SHA256, token.as_bytes())
        .as_ref()
        .to_vec()
}

/// Uniform 6-digit code.
pub fn new_code() -> String {
    const LIMIT: u32 = u32::MAX - (u32::MAX % 1_000_000);
    loop {
        let mut b = [0u8; 4];
        rand::fill(&mut b).expect("system randomness");
        let n = u32::from_le_bytes(b);
        if n < LIMIT {
            return format!("{:06}", n % 1_000_000);
        }
    }
}

fn code_key(settings: &AuthSettings) -> hmac::Key {
    hmac::Key::new(hmac::HMAC_SHA256, &settings.secret)
}

/// Keyed hash of an e-mail code, bound to the address (a code for one e-mail never works for another).
pub fn hash_code(settings: &AuthSettings, email: &str, code: &str) -> Vec<u8> {
    hmac::sign(&code_key(settings), format!("{email}:{code}").as_bytes())
        .as_ref()
        .to_vec()
}

/// Constant-time check.
pub fn code_matches(settings: &AuthSettings, email: &str, code: &str, stored: &[u8]) -> bool {
    hmac::verify(
        &code_key(settings),
        format!("{email}:{code}").as_bytes(),
        stored,
    )
    .is_ok()
}

/// `Set-Cookie` for a new web session.
pub fn session_cookie(settings: &AuthSettings, token: &str) -> HeaderValue {
    cookie(settings, token, settings.session_ttl.num_seconds())
}

/// `Set-Cookie` that removes the session cookie.
pub fn clear_cookie(settings: &AuthSettings) -> HeaderValue {
    cookie(settings, "", 0)
}

fn cookie(settings: &AuthSettings, value: &str, max_age: i64) -> HeaderValue {
    let mut c =
        format!("{SESSION_COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}");
    if settings.cookie_secure {
        c.push_str("; Secure");
    }
    if let Some(domain) = &settings.cookie_domain {
        c.push_str("; Domain=");
        c.push_str(domain);
    }
    HeaderValue::from_str(&c).expect("cookie is a valid header")
}

/// The caller's token: Bearer header first, then the session cookie.
pub fn token_from(headers: &HeaderMap) -> Option<String> {
    if let Some(bearer) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        return Some(bearer.trim().to_string()).filter(|t| !t.is_empty());
    }
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|kv| {
            kv.trim()
                .strip_prefix(SESSION_COOKIE)?
                .strip_prefix('=')
                .map(str::to_string)
        })
        .filter(|t| !t.is_empty())
}

/// `web` or `mobile` (the apps send `X-Client: mobile`).
pub fn client_kind(headers: &HeaderMap) -> &'static str {
    match headers.get("x-client").and_then(|v| v.to_str().ok()) {
        Some(v) if v.eq_ignore_ascii_case("mobile") => "mobile",
        _ => "web",
    }
}

/// A signed-in caller. Rejects with `401 auth.required`.
#[derive(Debug, Clone, Copy)]
pub struct Auth {
    pub user_id: Uuid,
    pub session_id: Uuid,
}

/// The caller, if signed in.
#[derive(Debug, Clone, Copy)]
pub struct MaybeAuth(pub Option<Auth>);

impl FromRequestParts<AppState> for MaybeAuth {
    type Rejection = Problem;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Problem> {
        let Some(token) = token_from(&parts.headers) else {
            return Ok(Self(None));
        };
        let Some(s) = runflow_db::auth::session_by_token(&state.db, &hash_token(&token)).await?
        else {
            return Ok(Self(None));
        };
        if Utc::now() - s.last_seen_at > TOUCH_EVERY {
            runflow_db::auth::touch_session(&state.db, s.id, state.settings.auth.session_ttl)
                .await?;
        }
        Ok(Self(Some(Auth {
            user_id: s.user_id,
            session_id: s.id,
        })))
    }
}

impl FromRequestParts<AppState> for Auth {
    type Rejection = Problem;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Problem> {
        MaybeAuth::from_request_parts(parts, state)
            .await?
            .0
            .ok_or_else(Problem::unauthorized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> AuthSettings {
        AuthSettings {
            secret: b"test-secret-test-secret-test-secret".to_vec(),
            session_ttl: chrono::Duration::days(60),
            cookie_domain: Some(".runflow.club".into()),
            cookie_secure: true,
            dev_affordances: false,
        }
    }

    #[test]
    fn tokens_and_codes() {
        let (a, b) = (new_token(), new_token());
        assert!(a.starts_with("rf_") && a.len() == 46 && a != b);
        assert_eq!(hash_token(&a).len(), 32);
        for _ in 0..50 {
            let c = new_code();
            assert!(c.len() == 6 && c.chars().all(|ch| ch.is_ascii_digit()));
        }
        let s = settings();
        let h = hash_code(&s, "ana@email.com", "123456");
        assert!(code_matches(&s, "ana@email.com", "123456", &h));
        assert!(!code_matches(&s, "ana@email.com", "123457", &h));
        assert!(
            !code_matches(&s, "bia@email.com", "123456", &h),
            "codes are bound to the address"
        );
    }

    #[test]
    fn cookies_and_tokens_from_headers() {
        let s = settings();
        let c = session_cookie(&s, "rf_abc");
        let c = c.to_str().unwrap();
        assert!(
            c.contains("HttpOnly")
                && c.contains("Secure")
                && c.contains("SameSite=Lax")
                && c.contains("Domain=.runflow.club")
        );
        let mut h = HeaderMap::new();
        h.insert(
            header::COOKIE,
            HeaderValue::from_static("theme=dark; rf_session=rf_xyz; rf_club=1"),
        );
        assert_eq!(token_from(&h).as_deref(), Some("rf_xyz"));
        h.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer rf_bearer"),
        );
        assert_eq!(token_from(&h).as_deref(), Some("rf_bearer"), "Bearer wins");
    }
}
