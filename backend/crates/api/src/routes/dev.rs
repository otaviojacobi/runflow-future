//! Development affordances, same paths as the mock (api/CLAUDE.md: `/v1/mock/*`). They exist only when
//! `RUNFLOW_ENV=development` and e-mails go to the log; otherwise these routes answer 404.

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{AppState, Problem};

pub fn routes() -> Router<AppState> {
    Router::new().route("/mock/outbox", get(outbox))
}

#[derive(Deserialize)]
struct Filter {
    to: Option<String>,
}

/// What the server "sent" (`/dev/outbox` in the web app renders it).
async fn outbox(
    State(state): State<AppState>,
    Query(f): Query<Filter>,
) -> Result<Json<Value>, Problem> {
    let outbox = state
        .mailer
        .outbox()
        .filter(|_| state.settings.auth.dev_affordances)
        .ok_or_else(|| Problem::route_not_found("GET", "/v1/mock/outbox"))?;
    let to =
        f.to.map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty());
    let items: Vec<Value> = outbox
        .list()
        .into_iter()
        .filter(|m| to.as_ref().is_none_or(|t| m.email.to.iter().any(|x| x.eq_ignore_ascii_case(t))))
        .take(100)
        .map(|m| {
            json!({
                "id": m.id,
                "created_at": m.created_at,
                "kind": m.email.kind().unwrap_or("message"),
                "to": m.email.to.join(", "),
                "subject": m.email.subject,
                "text": m.email.text,
                "action": m.email.link.as_ref().map(|(label, url)| json!({ "label": label, "url": url })),
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}
