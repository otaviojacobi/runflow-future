//! Google ID-token verification against a local fake JWKS (fixtures/: a test-only RSA key, not Google's).

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::routing::get;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use runflow_integrations::google::{GoogleError, GoogleVerifier};
use serde_json::{Value, json};

const KEY: &str = include_str!("fixtures/google-test-key.pem");
const JWKS: &str = include_str!("fixtures/google-test-jwks.json");
const AUD: &str = "web-client.apps.googleusercontent.com";

async fn fake_google() -> (String, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let app = axum::Router::new().route(
        "/certs",
        get(move || {
            h.fetch_add(1, Ordering::SeqCst);
            async { ([("cache-control", "public, max-age=600")], JWKS) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/certs", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, hits)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn token(claims: Value, kid: &str) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(kid.into());
    encode(
        &header,
        &claims,
        &EncodingKey::from_rsa_pem(KEY.as_bytes()).unwrap(),
    )
    .unwrap()
}

fn claims() -> Value {
    json!({
        "iss": "https://accounts.google.com", "aud": AUD, "sub": "1234567890",
        "email": "Ana.Souza@Gmail.com", "email_verified": true, "name": "Ana Souza",
        "iat": now(), "exp": now() + 600,
    })
}

#[tokio::test]
async fn accepts_a_valid_token_and_caches_keys() {
    let (url, hits) = fake_google().await;
    let v = GoogleVerifier::new(url, vec![AUD.into()]);
    let id = v.verify(&token(claims(), "test-key-1")).await.unwrap();
    assert_eq!(id.subject, "1234567890");
    assert_eq!(id.email, "ana.souza@gmail.com");
    assert_eq!(id.name.as_deref(), Some("Ana Souza"));
    v.verify(&token(claims(), "test-key-1")).await.unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 1, "keys are cached");
}

#[tokio::test]
async fn rejects_wrong_audience_issuer_expiry_and_unverified_email() {
    let (url, _) = fake_google().await;
    let v = GoogleVerifier::new(url, vec![AUD.into()]);
    let mut cases = Vec::new();
    for (k, val) in [
        ("aud", json!("someone-else")),
        ("iss", json!("https://evil.example")),
        ("exp", json!(now() - 3600)),
        ("email_verified", json!(false)),
    ] {
        let mut c = claims();
        c[k] = val;
        cases.push((k, c));
    }
    for (what, c) in cases {
        assert!(
            matches!(
                v.verify(&token(c, "test-key-1")).await,
                Err(GoogleError::Invalid(_))
            ),
            "{what} must be rejected"
        );
    }
    assert!(matches!(
        v.verify("not-a-jwt").await,
        Err(GoogleError::Invalid(_))
    ));
}

#[tokio::test]
async fn unknown_key_refetches_once_then_fails() {
    let (url, hits) = fake_google().await;
    let v = GoogleVerifier::new(url, vec![AUD.into()]);
    assert!(matches!(
        v.verify(&token(claims(), "rotated-away")).await,
        Err(GoogleError::Invalid(_))
    ));
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn unreachable_google_is_unavailable() {
    let v = GoogleVerifier::new("http://127.0.0.1:9/certs", vec![AUD.into()]);
    assert!(matches!(
        v.verify(&token(claims(), "test-key-1")).await,
        Err(GoogleError::Unavailable(_))
    ));
}
