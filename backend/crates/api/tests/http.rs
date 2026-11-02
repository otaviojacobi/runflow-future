//! Router-level tests against a real Postgres (each test gets its own migrated database).

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use runflow_api::{ApiSettings, AppState, router};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

fn app(db: PgPool) -> axum::Router {
    router(AppState::new(
        db,
        ApiSettings {
            version: "test",
            cors_origins: vec!["http://localhost:8080".into()],
            request_timeout: Duration::from_secs(5),
            body_limit: 1024,
        },
    ))
}

async fn call(app: axum::Router, req: Request<Body>) -> (StatusCode, axum::http::HeaderMap, Value) {
    let res = app.oneshot(req).await.unwrap();
    let (status, headers) = (res.status(), res.headers().clone());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn health_reports_database(db: PgPool) {
    let (status, headers, body) = call(
        app(db),
        Request::get("/v1/health").body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["version"], "test");
    assert_eq!(body["database"]["ok"], true);
    assert!(headers.contains_key("x-request-id"));
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn unknown_routes_are_pt_br_problems(db: PgPool) {
    let (status, headers, body) = call(
        app(db),
        Request::get("/v1/nada").body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        headers[header::CONTENT_TYPE],
        "application/problem+json; charset=utf-8"
    );
    assert_eq!(body["code"], "route.not_found");
    assert_eq!(body["title"], "Rota não encontrada");
    assert_eq!(body["detail"], "GET /v1/nada não existe nesta API.");
    assert_eq!(body["type"], "about:blank");
    assert_eq!(body["status"], 404);
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn wrong_method_is_a_problem(db: PgPool) {
    let (status, _, body) = call(
        app(db),
        Request::delete("/v1/health").body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(body["code"], "route.method_not_allowed");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn cors_allows_the_web_app_only(db: PgPool) {
    let preflight = |origin: &str| {
        Request::builder()
            .method("OPTIONS")
            .uri("/v1/health")
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
            .header(
                header::ACCESS_CONTROL_REQUEST_HEADERS,
                "authorization,x-client",
            )
            .body(Body::empty())
            .unwrap()
    };
    let (_, ok, _) = call(app(db.clone()), preflight("http://localhost:8080")).await;
    assert_eq!(
        ok[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "http://localhost:8080"
    );
    let (_, other, _) = call(app(db), preflight("https://evil.example")).await;
    assert!(!other.contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN));
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn health_is_a_problem_when_the_database_is_gone(db: PgPool) {
    let app = app(db.clone());
    db.close().await;
    let (status, _, body) =
        call(app, Request::get("/v1/health").body(Body::empty()).unwrap()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["code"], "health.database_unavailable");
    assert_eq!(body["title"], "Serviço indisponível");
}
