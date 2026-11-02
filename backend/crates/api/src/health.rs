//! `GET /v1/health`: liveness plus a database round trip. Used by Docker, the apps and uptime checks.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::{AppState, Problem};

#[derive(Serialize)]
pub struct Health {
    ok: bool,
    version: &'static str,
    database: Database,
}

#[derive(Serialize)]
struct Database {
    ok: bool,
    latency_ms: f64,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/health", get(health))
}

async fn health(State(state): State<AppState>) -> Result<Json<Health>, Problem> {
    match runflow_db::ping(&state.db).await {
        Ok(rtt) => Ok(Json(Health {
            ok: true,
            version: state.settings.version,
            database: Database {
                ok: true,
                latency_ms: (rtt.as_secs_f64() * 10_000.0).round() / 10.0,
            },
        })),
        Err(err) => {
            tracing::error!(error = %err, "health: database unreachable");
            Err(Problem::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "health.database_unavailable",
                "Serviço indisponível",
                "Não conseguimos acessar o banco de dados. Tente novamente em instantes.",
            ))
        }
    }
}
