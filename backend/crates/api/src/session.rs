//! Sessions (§7.3): opaque random tokens, stored as SHA-256 hashes, revocable. Mobile sends
//! `Authorization: Bearer <token>`; the web gets the same token in an HttpOnly cookie. Lookups are cached in Redis for
//! up to a minute (D-047); every way a session ends calls [`forget`].

use aws_lc_rs::{digest, hmac, rand};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, header};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::Utc;
use runflow_kv::sessions::{self as cached, Lookup, Session};
use uuid::Uuid;

use crate::{AppState, AuthSettings, Problem, metrics};

/// The default session cookie name; `COOKIE_NAME` changes it per environment (QA: `rf_session_qa`).
pub const SESSION_COOKIE: &str = "rf_session";
/// Don't write `last_seen_at` on every request.
const TOUCH_EVERY: chrono::Duration = chrono::Duration::minutes(5);

/// The live session behind a token hash: from the cache, else from Postgres (then cached, a miss included).
async fn lookup(state: &AppState, token_hash: &[u8]) -> Result<Option<Session>, Problem> {
    let now = Utc::now();
    match cached::get(&state.kv, token_hash).await {
        Ok(Lookup::Live(s)) if s.expires_at > now => {
            metrics::cache_lookup("session", "hit");
            return Ok(Some(s));
        }
        Ok(Lookup::Live(_) | Lookup::Gone) => {
            metrics::cache_lookup("session", "hit");
            return Ok(None);
        }
        Ok(Lookup::Unknown) => metrics::cache_lookup("session", "miss"),
        Err(e) => {
            metrics::cache_lookup("session", "error");
            tracing::warn!(error = %e, "session cache unavailable, reading from Postgres");
            return Ok(from_db(state, token_hash).await?);
        }
    }
    let s = from_db(state, token_hash).await?;
    // Never cached past the session's own expiry.
    let ttl = s.map_or(cached::TTL, |s| {
        (s.expires_at - now).to_std().unwrap_or_default()
    });
    if let Err(e) = cached::put(&state.kv, token_hash, s.as_ref(), ttl).await {
        tracing::warn!(error = %e, "session cache: store failed");
    }
    Ok(s)
}

async fn from_db(state: &AppState, token_hash: &[u8]) -> sqlx::Result<Option<Session>> {
    Ok(runflow_db::auth::session_by_token(&state.db, token_hash)
        .await?
        .map(|s| Session {
            id: s.id,
            user_id: s.user_id,
            last_seen_at: s.last_seen_at,
            expires_at: s.expires_at,
        }))
}

/// These sessions ended (sign-out, revoked, account deleted; Postgres already says so): drop them from the cache.
/// If Redis can't be told, a cached lookup lives on for at most `runflow_kv::sessions::TTL`.
pub async fn forget(state: &AppState, token_hashes: &[Vec<u8>]) {
    if let Err(e) = cached::forget(&state.kv, token_hashes).await {
        tracing::error!(error = %e, sessions = token_hashes.len(), "session cache: ended sessions not dropped");
    }
}

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
    let mut c = format!(
        "{}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}",
        settings.cookie_name
    );
    if settings.cookie_secure {
        c.push_str("; Secure");
    }
    if let Some(domain) = &settings.cookie_domain {
        c.push_str("; Domain=");
        c.push_str(domain);
    }
    HeaderValue::from_str(&c).expect("cookie is a valid header")
}

/// The caller's token: Bearer header first, then the session cookie (`cookie_name`).
pub fn token_from(headers: &HeaderMap, cookie_name: &str) -> Option<String> {
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
                .strip_prefix(cookie_name)?
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
        let Some(token) = token_from(&parts.headers, &state.settings.auth.cookie_name) else {
            return Ok(Self(None));
        };
        let hash = hash_token(&token);
        let Some(s) = lookup(state, &hash).await? else {
            return Ok(Self(None));
        };
        // Sliding expiry, written at most once per TOUCH_EVERY (the cached `last_seen_at` can be a minute old, so
        // Redis also remembers when this session was last touched).
        if Utc::now() - s.last_seen_at > TOUCH_EVERY
            && cached::touch_due(&state.kv, &hash, TOUCH_EVERY.to_std().expect("positive"))
                .await
                .unwrap_or(true)
        {
            runflow_db::auth::touch_session(&state.db, s.id, state.settings.auth.session_ttl)
                .await?;
        }
        // Errors in this request carry the user id only (S12, D-033: no personal data in Sentry).
        sentry::configure_scope(|scope| {
            scope.set_user(Some(sentry::User {
                id: Some(s.user_id.to_string()),
                ..Default::default()
            }));
        });
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
            cookie_name: "rf_session_qa".into(),
            cookie_domain: Some(".runflow.club".into()),
            cookie_secure: true,
            dev_affordances: false,
            smoke_key: None,
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
            HeaderValue::from_static(
                "theme=dark; rf_session=rf_prod; rf_session_qa=rf_xyz; rf_club=1",
            ),
        );
        assert!(c.starts_with("rf_session_qa=rf_abc;"));
        assert_eq!(
            token_from(&h, "rf_session_qa").as_deref(),
            Some("rf_xyz"),
            "another environment's cookie is ignored"
        );
        h.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer rf_bearer"),
        );
        assert_eq!(
            token_from(&h, "rf_session_qa").as_deref(),
            Some("rf_bearer"),
            "Bearer wins"
        );
    }
}
