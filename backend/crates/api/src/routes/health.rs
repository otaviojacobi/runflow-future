//! `GET /v1/health`: liveness plus a database round trip. Used by Docker, the apps and uptime checks.
//! `GET /v1/public/config`: what the web app needs before sign-in (the Google client id, Strava on/off).

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
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
    Router::new()
        .route("/health", get(health))
        .route("/public/config", get(config))
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

/// The subdomain a club host names: `paceforte-qa.runflow.club` with suffix `-qa.runflow.club` → `paceforte`.
pub(crate) fn club_subdomain(host: &str, suffix: &str) -> Option<String> {
    let host = host.split(':').next().unwrap_or(host).to_lowercase();
    let sub = host.strip_suffix(suffix)?;
    (!sub.is_empty()
        && sub
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'))
    .then(|| sub.to_string())
}

/// `{google_client_id, strava, club, push_public_key}`: `club` is the club this host serves (S9b), with its name and logo, or null.
async fn config(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, Problem> {
    let sub = match (
        &state.settings.club_host_suffix,
        headers.get(header::HOST).and_then(|h| h.to_str().ok()),
    ) {
        (Some(suffix), Some(host)) => club_subdomain(host, suffix),
        _ => None,
    };
    let club = match sub {
        Some(sub) => {
            match runflow_db::clubs::club_by_host(&state.db, &sub, state.settings.club_host_by_slug)
                .await?
            {
                Some(c) => {
                    let logo = runflow_db::clubs::branding(&state.db, c.id)
                        .await?
                        .and_then(|b| b.logo_url);
                    serde_json::json!({ "id": c.id, "slug": c.slug, "name": c.name, "logo_url": logo })
                }
                None => serde_json::Value::Null,
            }
        }
        None => serde_json::Value::Null,
    };
    Ok(Json(serde_json::json!({
        "google_client_id": state.google.as_ref().and_then(|g| g.web_client_id()),
        "strava": state.strava.is_some(),
        "club": club,
        "push_public_key": state.settings.push_public_key,
    })))
}

#[cfg(test)]
mod tests {
    use super::club_subdomain;

    #[test]
    fn club_hosts() {
        let s = "-qa.runflow.club";
        assert_eq!(
            club_subdomain("paceforte-qa.runflow.club", s).as_deref(),
            Some("paceforte")
        );
        assert_eq!(
            club_subdomain("PaceForte-qa.runflow.club:443", s).as_deref(),
            Some("paceforte")
        );
        assert_eq!(club_subdomain("qa.runflow.club", s), None, "the app itself");
        assert_eq!(
            club_subdomain("a.b-qa.runflow.club", s),
            None,
            "one level only"
        );
        assert_eq!(club_subdomain("paceforte.runflow.club", s), None);
    }
}
