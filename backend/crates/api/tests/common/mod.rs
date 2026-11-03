//! Shared test harness: the real router on a fresh, migrated Postgres database (`#[sqlx::test]`).
#![allow(dead_code)]

use std::time::Duration;

use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use runflow_api::{ApiSettings, AppState, AuthSettings, BillingSettings, router};
use runflow_integrations::email::{EmailSettings, Mailer, Provider};
use runflow_integrations::google::GoogleVerifier;
use runflow_integrations::secrets::TokenCipher;
use runflow_integrations::storage::Storage;
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

pub struct TestApp {
    pub state: AppState,
    /// The worker's Web Push sender (`with_push`).
    pub webpush: Option<std::sync::Arc<runflow_integrations::webpush::WebPush>>,
    /// The worker's Expo push sender (`with_expo`).
    pub expo: Option<std::sync::Arc<runflow_integrations::expo_push::ExpoPush>>,
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
        public_api_url: "http://localhost:3000".into(),
        strava_verify_token: Some("verify-me".into()),
        billing: BillingSettings {
            simulation: true,
            price_pro: None,
            webhook_secret: None,
        },
        push_public_key: None,
        web_sentry: None,
        auth: AuthSettings {
            secret: b"test-secret-test-secret-test-secret".to_vec(),
            session_ttl: chrono::Duration::days(60),
            cookie_name: "rf_session".into(),
            cookie_domain: None,
            cookie_secure: false,
            dev_affordances: dev,
            smoke_key: Some("smoke-test-key".into()),
        },
    }
}

pub fn cipher() -> TokenCipher {
    TokenCipher::new(&[42u8; 32]).unwrap()
}

fn log_mailer() -> Mailer {
    Mailer::from_settings(&EmailSettings {
        provider: Provider::Log,
        resend_api_key: None,
        resend_api_url: String::new(),
        from: "Runflow <contato@runflow.club>".into(),
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
        // Server logs in the test output (cargo shows them only for failing tests).
        let _ = tracing_subscriber::fmt()
            .with_test_writer()
            .with_env_filter("warn,runflow=info")
            .try_init();
        Self {
            webpush: None,
            expo: None,
            state: AppState::new(
                db,
                settings(dev),
                log_mailer(),
                google,
                Storage::memory(),
                cipher(),
            ),
        }
    }

    /// Like `new`, with a bigger request body limit (upload size checks).
    pub fn with_body_limit(db: PgPool, limit: usize) -> Self {
        let mut s = settings(true);
        s.body_limit = limit;
        Self {
            webpush: None,
            expo: None,
            state: AppState::new(db, s, log_mailer(), None, Storage::memory(), cipher()),
        }
    }

    /// Run every due background job now (what the worker does in production).
    pub async fn run_jobs(&self) -> usize {
        let mut w = runflow_jobs::Worker::new(
            self.state.db.clone(),
            self.state.mailer.clone(),
            self.state.settings.public_app_url.clone(),
        )
        .with_api_url(self.state.settings.public_api_url.clone());
        if let Some(s) = &self.state.strava {
            w = w.with_strava((**s).clone(), self.state.cipher.clone());
        }
        if let Some(web) = &self.webpush {
            w = w.with_webpush(web.clone());
        }
        if let Some(expo) = &self.expo {
            w = w.with_expo(expo.clone());
        }
        w.run_once(500).await.unwrap()
    }

    /// The worker's minute tick at `now` (automatic week releases).
    pub async fn tick(&self, now: chrono::DateTime<chrono::Utc>) -> usize {
        runflow_jobs::Worker::new(
            self.state.db.clone(),
            self.state.mailer.clone(),
            self.state.settings.public_app_url.clone(),
        )
        .tick(now)
        .await
        .unwrap()
    }

    /// Strava pointed at a fake server (`base`).
    pub fn with_strava(mut self, base: &str) -> Self {
        self.state = self
            .state
            .with_strava(runflow_integrations::strava::StravaClient::new(
                base,
                "123".into(),
                "secret".into(),
            ));
        self
    }

    /// Other billing settings (simulation off, Stripe price and webhook secret).
    pub fn with_billing(mut self, billing: BillingSettings) -> Self {
        let mut s = (*self.state.settings).clone();
        s.billing = billing;
        self.state.settings = std::sync::Arc::new(s);
        self
    }

    /// Stripe pointed at a fake server (`base`), with a Pro price and a webhook secret.
    pub fn with_stripe(self, base: &str) -> Self {
        let mut app = self.with_billing(BillingSettings {
            simulation: false,
            price_pro: Some("price_pro".into()),
            webhook_secret: Some("whsec_test".into()),
        });
        app.state = app
            .state
            .with_stripe(runflow_integrations::stripe::StripeClient::new(
                base,
                "sk_test_123".into(),
            ));
        app
    }

    /// Expo push pointed at a fake server (`base`).
    pub fn with_expo(mut self, base: &str) -> Self {
        self.expo = Some(std::sync::Arc::new(
            runflow_integrations::expo_push::ExpoPush::new(base, None),
        ));
        self
    }

    /// Web Push on: a fresh VAPID pair, its public key in `/public/config`.
    pub fn with_push(mut self) -> Self {
        use runflow_integrations::webpush::{Vapid, WebPush};
        let (public, private) = Vapid::generate().unwrap();
        let mut s = (*self.state.settings).clone();
        s.push_public_key = Some(public.clone());
        self.state.settings = std::sync::Arc::new(s);
        let vapid = Vapid::new(&public, &private, "mailto:contato@runflow.club").unwrap();
        self.webpush = Some(std::sync::Arc::new(WebPush::new(vapid)));
        self
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
