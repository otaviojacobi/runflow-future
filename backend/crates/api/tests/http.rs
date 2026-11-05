//! Router-level behavior: health, pt-BR problems, CORS (each test gets its own migrated database).

mod common;

use axum::http::{Method, header};
use common::TestApp;
use sqlx::PgPool;

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn health_reports_database(db: PgPool) {
    let res = TestApp::new(db).get("/v1/health", None).await;
    assert_eq!(res.ok()["ok"], true);
    assert_eq!(res.body["version"], "test");
    assert_eq!(res.body["database"]["ok"], true);
    assert!(res.headers.contains_key("x-request-id"));
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn public_config_tells_the_web_app_what_is_on(db: PgPool) {
    let off = TestApp::new(db.clone())
        .get("/v1/public/config", None)
        .await;
    assert_eq!(off.ok()["google_client_id"], serde_json::Value::Null);
    assert_eq!(off.body["strava"], false);
    assert_eq!(off.body["analytics"], serde_json::Value::Null);
    let google = runflow_integrations::google::GoogleVerifier::new(
        "http://127.0.0.1:9/jwks",
        vec![
            "web-client.apps.googleusercontent.com".into(),
            "android".into(),
        ],
    );
    let on = TestApp::with(db, true, Some(google))
        .get("/v1/public/config", None)
        .await;
    assert_eq!(
        on.ok()["google_client_id"],
        "web-client.apps.googleusercontent.com"
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn public_config_hands_out_umami_when_set(db: PgPool) {
    let mut app = TestApp::new(db);
    let mut s = (*app.state.settings).clone();
    s.web_analytics = Some(runflow_api::WebAnalytics {
        website_id: "8c7e0b1e-5f3a-4f7e-9b2a-1d2c3e4f5a6b".into(),
        script_url: "/insights/script.js".into(),
    });
    app.state.settings = std::sync::Arc::new(s);
    let res = app.get("/v1/public/config", None).await;
    assert_eq!(
        res.ok()["analytics"]["website_id"],
        "8c7e0b1e-5f3a-4f7e-9b2a-1d2c3e4f5a6b"
    );
    assert_eq!(res.body["analytics"]["script_url"], "/insights/script.js");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn unknown_routes_are_pt_br_problems(db: PgPool) {
    let res = TestApp::new(db).get("/v1/nada", None).await;
    res.problem(404, "route.not_found");
    assert_eq!(
        res.headers[header::CONTENT_TYPE],
        "application/problem+json; charset=utf-8"
    );
    assert_eq!(res.body["title"], "Rota não encontrada");
    assert_eq!(res.body["detail"], "GET /v1/nada não existe nesta API.");
    assert_eq!(res.body["type"], "about:blank");
    assert_eq!(res.body["status"], 404);
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn wrong_method_and_bad_json_are_problems(db: PgPool) {
    let app = TestApp::new(db);
    app.delete("/v1/health", None)
        .await
        .problem(405, "route.method_not_allowed");
    let res = app
        .call(
            Method::POST,
            "/v1/auth/email/start",
            None,
            None,
            &[("content-type", "application/json")],
        )
        .await;
    res.problem(422, "validation.failed");
    let raw = axum::http::Request::post("/v1/auth/email/start")
        .header("content-type", "application/json")
        .body(axum::body::Body::from("{oops"))
        .unwrap();
    let res = tower::ServiceExt::oneshot(runflow_api::router(app.state.clone()), raw)
        .await
        .unwrap();
    assert_eq!(res.status(), 400);
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn cors_allows_the_web_app_only(db: PgPool) {
    let app = TestApp::new(db);
    let preflight = |origin: &'static str| {
        [
            ("origin", origin),
            ("access-control-request-method", "GET"),
            ("access-control-request-headers", "authorization,x-client"),
        ]
    };
    let ok = app
        .call(
            Method::OPTIONS,
            "/v1/health",
            None,
            None,
            &preflight("http://localhost:8080"),
        )
        .await;
    assert_eq!(
        ok.headers[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "http://localhost:8080"
    );
    assert_eq!(ok.headers[header::ACCESS_CONTROL_ALLOW_CREDENTIALS], "true");
    let other = app
        .call(
            Method::OPTIONS,
            "/v1/health",
            None,
            None,
            &preflight("https://evil.example"),
        )
        .await;
    assert!(
        !other
            .headers
            .contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN)
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn health_is_a_problem_when_the_database_is_gone(db: PgPool) {
    let app = TestApp::new(db.clone());
    db.close().await;
    let res = app.get("/v1/health", None).await;
    res.problem(503, "health.database_unavailable");
    assert_eq!(res.body["title"], "Serviço indisponível");
}
