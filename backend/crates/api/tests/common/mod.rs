//! Shared test harness: the real router on a fresh, migrated Postgres database (`#[sqlx::test]`).
#![allow(dead_code)]

use std::time::Duration;

use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use runflow_api::{ApiSettings, AppState, AuthSettings, router};
use runflow_integrations::email::{EmailSettings, Mailer, Provider};
use runflow_integrations::google::GoogleVerifier;
use runflow_integrations::storage::Storage;
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

pub struct TestApp {
    pub state: AppState,
}

pub struct Res {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Value,
}

impl Res {
    #[track_caller]
    pub fn ok(&self) -> &Value {
        assert!(
            self.status.is_success(),
            "expected success, got {} {}",
            self.status,
            self.body
        );
        &self.body
    }
    #[track_caller]
    pub fn problem(&self, status: u16, code: &str) -> &Value {
        assert_eq!(self.status.as_u16(), status, "{}", self.body);
        assert_eq!(self.body["code"], code, "{}", self.body);
        assert!(
            self.body["title"].as_str().is_some_and(|t| !t.is_empty()),
            "pt-BR title"
        );
        &self.body
    }
}

pub fn settings(dev: bool) -> ApiSettings {
    ApiSettings {
        version: "test",
        cors_origins: vec!["http://localhost:8080".into()],
        request_timeout: Duration::from_secs(10),
        body_limit: 64 * 1024,
        public_app_url: "http://localhost:8080".into(),
        auth: AuthSettings {
            secret: b"test-secret-test-secret-test-secret".to_vec(),
            session_ttl: chrono::Duration::days(60),
            cookie_domain: None,
            cookie_secure: false,
            dev_affordances: dev,
        },
    }
}

fn log_mailer() -> Mailer {
    Mailer::from_settings(&EmailSettings {
        provider: Provider::Log,
        resend_api_key: None,
        resend_api_url: String::new(),
        from: "Runflow <ola@runflow.club>".into(),
        reply_to: None,
    })
    .unwrap()
}

impl TestApp {
    /// Development-like app: e-mails in an outbox, `dev_code` answered.
    pub fn new(db: PgPool) -> Self {
        Self::with(db, true, None)
    }

    pub fn with(db: PgPool, dev: bool, google: Option<GoogleVerifier>) -> Self {
        Self {
            state: AppState::new(db, settings(dev), log_mailer(), google, Storage::memory()),
        }
    }

    /// Like `new`, with a bigger request body limit (upload size checks).
    pub fn with_body_limit(db: PgPool, limit: usize) -> Self {
        let mut s = settings(true);
        s.body_limit = limit;
        Self {
            state: AppState::new(db, s, log_mailer(), None, Storage::memory()),
        }
    }

    pub fn db(&self) -> &PgPool {
        &self.state.db
    }

    pub async fn call(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
        headers: &[(&str, &str)],
    ) -> Res {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(t) = token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        let req = match body {
            Some(b) => req
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(b.to_string())),
            None => req.body(Body::empty()),
        }
        .unwrap();
        let res = router(self.state.clone()).oneshot(req).await.unwrap();
        let (status, headers) = (res.status(), res.headers().clone());
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        Res {
            status,
            headers,
            body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        }
    }

    pub async fn get(&self, path: &str, token: Option<&str>) -> Res {
        self.call(Method::GET, path, token, None, &[]).await
    }
    pub async fn post(&self, path: &str, token: Option<&str>, body: Value) -> Res {
        self.call(Method::POST, path, token, Some(body), &[]).await
    }
    pub async fn patch(&self, path: &str, token: Option<&str>, body: Value) -> Res {
        self.call(Method::PATCH, path, token, Some(body), &[]).await
    }
    pub async fn delete(&self, path: &str, token: Option<&str>) -> Res {
        self.call(Method::DELETE, path, token, None, &[]).await
    }

    /// Sign in with an e-mail code (dev mode hands the code back). Returns the session token.
    pub async fn sign_in(&self, email: &str) -> String {
        let code = self
            .post(
                "/v1/auth/email/start",
                None,
                serde_json::json!({ "email": email }),
            )
            .await
            .ok()["dev_code"]
            .as_str()
            .unwrap()
            .to_string();
        let res = self
            .post(
                "/v1/auth/email/verify",
                None,
                serde_json::json!({ "email": email, "code": code }),
            )
            .await;
        res.ok()["token"].as_str().unwrap().to_string()
    }
}
