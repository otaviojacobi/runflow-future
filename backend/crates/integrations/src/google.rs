//! Sign in with Google (D-007): verify the ID token the web (Google Identity Services) or the mobile
//! SDK hands us, against Google's published keys. No client secret is needed for this flow.

use std::time::{Duration, Instant};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use tokio::sync::RwLock;

pub const GOOGLE_JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS: [&str; 2] = ["accounts.google.com", "https://accounts.google.com"];

/// Who signed in, as asserted by Google.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleIdentity {
    /// Stable account id (`sub`).
    pub subject: String,
    pub email: String,
    pub name: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum GoogleError {
    /// The token is malformed, expired, for another app, or the e-mail isn't verified.
    #[error("invalid Google ID token: {0}")]
    Invalid(String),
    /// Google's keys couldn't be fetched.
    #[error("Google keys unavailable: {0}")]
    Unavailable(String),
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    email: Option<String>,
    #[serde(default)]
    email_verified: bool,
    name: Option<String>,
}

pub struct GoogleVerifier {
    http: reqwest::Client,
    jwks_url: String,
    /// OAuth client ids whose tokens we accept (web, Android, iOS).
    audiences: Vec<String>,
    keys: RwLock<Option<(Instant, JwkSet)>>,
}

impl std::fmt::Debug for GoogleVerifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GoogleVerifier")
            .field("audiences", &self.audiences)
            .finish_non_exhaustive()
    }
}

impl GoogleVerifier {
    pub fn new(jwks_url: impl Into<String>, audiences: Vec<String>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .user_agent(concat!("runflow/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self {
            http,
            jwks_url: jwks_url.into(),
            audiences,
            keys: RwLock::new(None),
        }
    }

    pub async fn verify(&self, id_token: &str) -> Result<GoogleIdentity, GoogleError> {
        let header = decode_header(id_token).map_err(|e| GoogleError::Invalid(e.to_string()))?;
        let kid = header
            .kid
            .ok_or_else(|| GoogleError::Invalid("no kid".into()))?;
        let key = match self.key(&kid, false).await? {
            Some(k) => k,
            // Google rotates keys; refetch once before giving up.
            None => self
                .key(&kid, true)
                .await?
                .ok_or_else(|| GoogleError::Invalid(format!("unknown kid {kid}")))?,
        };
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&self.audiences);
        validation.set_issuer(&ISSUERS);
        validation.leeway = 60;
        let claims = decode::<Claims>(id_token, &key, &validation)
            .map_err(|e| GoogleError::Invalid(e.to_string()))?
            .claims;
        let email = claims
            .email
            .filter(|_| claims.email_verified)
            .ok_or_else(|| GoogleError::Invalid("e-mail missing or not verified".into()))?;
        Ok(GoogleIdentity {
            subject: claims.sub,
            email: email.trim().to_lowercase(),
            name: claims.name.filter(|n| !n.trim().is_empty()),
        })
    }

    async fn key(&self, kid: &str, refresh: bool) -> Result<Option<DecodingKey>, GoogleError> {
        if !refresh
            && let Some((expires, set)) = &*self.keys.read().await
            && *expires > Instant::now()
        {
            return Ok(set
                .find(kid)
                .and_then(|jwk| DecodingKey::from_jwk(jwk).ok()));
        }
        let res = self
            .http
            .get(&self.jwks_url)
            .send()
            .await
            .map_err(|e| GoogleError::Unavailable(e.to_string()))?;
        if !res.status().is_success() {
            return Err(GoogleError::Unavailable(format!(
                "JWKS returned {}",
                res.status()
            )));
        }
        let max_age = res
            .headers()
            .get(reqwest::header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| {
                v.split(',')
                    .find_map(|p| p.trim().strip_prefix("max-age=")?.parse::<u64>().ok())
            })
            .unwrap_or(3600);
        let set: JwkSet = res
            .json()
            .await
            .map_err(|e| GoogleError::Unavailable(e.to_string()))?;
        let key = set
            .find(kid)
            .and_then(|jwk| DecodingKey::from_jwk(jwk).ok());
        *self.keys.write().await = Some((
            Instant::now() + Duration::from_secs(max_age.clamp(60, 86_400)),
            set,
        ));
        Ok(key)
    }
}
