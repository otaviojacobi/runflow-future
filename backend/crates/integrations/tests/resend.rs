//! Resend client against a local fake of the Resend API (no network, no real key).

use std::sync::{Arc, Mutex};

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use runflow_integrations::email::{Email, EmailError, EmailSettings, Mailer, Provider};
use serde_json::{Value, json};

#[derive(Default)]
struct Seen {
    calls: Vec<(HeaderMap, Value)>,
    /// Statuses to answer with, in order; then 200.
    script: Vec<u16>,
}

async fn fake(
    State(seen): State<Arc<Mutex<Seen>>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let mut s = seen.lock().unwrap();
    s.calls.push((headers, body));
    let status = if s.script.is_empty() {
        200
    } else {
        s.script.remove(0)
    };
    match status {
        200 => (StatusCode::OK, Json(json!({ "id": "em_123" }))),
        422 => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(
                json!({ "statusCode": 422, "name": "validation_error", "message": "The domain is not verified." }),
            ),
        ),
        s => (
            StatusCode::from_u16(s).unwrap(),
            Json(json!({ "name": "rate_limit_exceeded", "message": "Too many requests." })),
        ),
    }
}

async fn start(script: Vec<u16>) -> (String, Arc<Mutex<Seen>>) {
    let seen = Arc::new(Mutex::new(Seen {
        script,
        ..Default::default()
    }));
    let app = axum::Router::new()
        .route("/emails", post(fake))
        .with_state(seen.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, seen)
}

fn mailer(url: &str) -> Mailer {
    Mailer::from_settings(&EmailSettings {
        provider: Provider::Resend,
        resend_api_key: Some("re_test".into()),
        resend_api_url: url.into(),
        from: "Runflow <contato@runflow.club>".into(),
        reply_to: Some("contato@runflow.club".into()),
    })
    .unwrap()
}

fn message() -> Email {
    Email {
        to: vec!["ana@email.com".into()],
        subject: "Seu código".into(),
        html: "<p>123456</p>".into(),
        text: "123456".into(),
        idempotency_key: Some("code-1".into()),
        tags: vec![("kind".into(), "sign_in_code".into())],
        ..Default::default()
    }
}

#[tokio::test]
async fn sends_with_key_headers_and_body() {
    let (url, seen) = start(vec![]).await;
    let sent = mailer(&url).send(&message()).await.unwrap();
    assert_eq!(sent.id, "em_123");
    let s = seen.lock().unwrap();
    let (headers, body) = &s.calls[0];
    assert_eq!(headers["authorization"], "Bearer re_test");
    assert_eq!(headers["idempotency-key"], "code-1");
    assert_eq!(body["from"], "Runflow <contato@runflow.club>");
    assert_eq!(body["to"], json!(["ana@email.com"]));
    assert_eq!(body["reply_to"], "contato@runflow.club");
    assert_eq!(
        body["tags"],
        json!([{ "name": "kind", "value": "sign_in_code" }])
    );
}

#[tokio::test]
async fn validation_errors_are_not_retried() {
    let (url, seen) = start(vec![422]).await;
    let err = mailer(&url).send(&message()).await.unwrap_err();
    assert!(
        matches!(err, EmailError::Rejected { status: 422, ref name, .. } if name == "validation_error"),
        "{err}"
    );
    assert_eq!(seen.lock().unwrap().calls.len(), 1);
}

#[tokio::test]
async fn rate_limits_are_retried() {
    let (url, seen) = start(vec![429, 500]).await;
    assert_eq!(mailer(&url).send(&message()).await.unwrap().id, "em_123");
    assert_eq!(seen.lock().unwrap().calls.len(), 3);
}

#[test]
fn resend_needs_a_key() {
    let err = Mailer::from_settings(&EmailSettings {
        provider: Provider::Resend,
        resend_api_key: None,
        resend_api_url: "http://x".into(),
        from: "a@b.c".into(),
        reply_to: None,
    })
    .unwrap_err();
    assert!(err.to_string().contains("RESEND_API_KEY"));
}
