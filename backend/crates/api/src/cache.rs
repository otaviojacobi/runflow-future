//! Cached heavy club reads (D-047): the W1 dashboard and the W16 training report come from Redis while nothing in the
//! club changed. An entry's key holds the club's version; [`invalidate`] bumps it after every successful write under
//! `/v1/clubs/{club_id}/…`, so the next read recomputes. Short TTLs cover changes that arrive any other way (a
//! person's own profile or activities, Strava sync, the worker's week releases and Stripe events). Redis being down
//! only means reading from Postgres.

use std::time::Duration;

use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use runflow_kv::cache;
use serde_json::Value;
use uuid::Uuid;

use crate::{AppState, Problem, metrics};

/// The coach's dashboard (W1): what's happening now, so a short TTL.
pub const DASHBOARD_TTL: Duration = Duration::from_secs(30);
/// The training report (W16): periods of weeks; minutes old is fine.
pub const REPORTS_TTL: Duration = Duration::from_secs(300);

/// The club a request writes to: any method but GET/HEAD/OPTIONS under `/v1/clubs/{club_id}` (the assistant aside).
fn written_club(method: &Method, path: &str) -> Option<Uuid> {
    if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return None;
    }
    let path = path.strip_prefix("/v1").unwrap_or(path);
    match path
        .trim_matches('/')
        .split('/')
        .collect::<Vec<_>>()
        .as_slice()
    {
        // The assistant's POSTs only compute (W4, W5, W17).
        ["clubs", _, "ai", ..] => None,
        ["clubs", id, ..] => Uuid::parse_str(id).ok(),
        _ => None,
    }
}

/// Middleware: after a successful write to a club, its cached reads are stale.
pub async fn invalidate(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let Some(club) = written_club(req.method(), req.uri().path()) else {
        return next.run(req).await;
    };
    let res = next.run(req).await;
    if res.status().is_success()
        && let Err(e) = cache::bump(&state.kv, &[club]).await
    {
        tracing::warn!(error = %e, %club, "cache: version bump failed; reads refresh at their TTL");
    }
    res
}

/// Answer a club read from the cache, or compute it, answer it and keep it for `ttl`. `name` names the read in keys
/// and metrics; `variant` holds everything else the answer depends on (viewer, query). Same JSON either way.
pub async fn json(
    state: &AppState,
    name: &'static str,
    club: Uuid,
    variant: &str,
    ttl: Duration,
    compute: impl Future<Output = Result<Value, Problem>>,
) -> Result<Response, Problem> {
    let key = match cache::version(&state.kv, club).await {
        Ok(v) => Some(cache::key(&state.kv, name, club, v, variant)),
        Err(e) => {
            tracing::warn!(error = %e, read = name, "cache: unavailable, reading from Postgres");
            None
        }
    };
    match &key {
        Some(k) => match cache::get(&state.kv, k).await {
            Ok(Some(body)) => {
                metrics::cache_lookup(name, "hit");
                return Ok(body_response(body));
            }
            Ok(None) => metrics::cache_lookup(name, "miss"),
            Err(e) => {
                metrics::cache_lookup(name, "error");
                tracing::warn!(error = %e, read = name, "cache: lookup failed, reading from Postgres");
            }
        },
        None => metrics::cache_lookup(name, "error"),
    }
    let body = serde_json::to_vec(&compute.await?).map_err(|e| {
        tracing::error!(error = %e, "cache: response didn't serialize");
        Problem::internal()
    })?;
    if let Some(k) = &key
        && let Err(e) = cache::put(&state.kv, k, &body, ttl).await
    {
        tracing::warn!(error = %e, read = name, "cache: store failed");
    }
    Ok(body_response(body))
}

/// What `Json(value)` answers, from bytes.
fn body_response(body: Vec<u8>) -> Response {
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        )],
        body,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_to_a_club_refresh_its_reads() {
        let club = "0190a3c4-0000-7000-8000-000000000000";
        let id = Uuid::parse_str(club).ok();
        for (method, path, want) in [
            (Method::GET, format!("/v1/clubs/{club}/dashboard"), None),
            (
                Method::POST,
                format!("/v1/clubs/{club}/planned-workouts"),
                id,
            ),
            (
                Method::PUT,
                format!("/clubs/{club}/my/workouts/x/completion"),
                id,
            ),
            (Method::PATCH, format!("/v1/clubs/{club}"), id),
            (Method::DELETE, format!("/v1/clubs/{club}/members/y"), id),
            (Method::POST, "/v1/clubs".into(), None),
            (Method::POST, format!("/v1/clubs/{club}/ai/workout"), None),
            (Method::POST, "/v1/clubs/not-a-uuid/groups".into(), None),
            (Method::PATCH, "/v1/me".into(), None),
        ] {
            assert_eq!(written_club(&method, &path), want, "{method} {path}");
        }
    }
}
