//! Assessments and tests (W14, W3, M7; endpoints.md § Assessments and tests), like api/mock/routes/assessments.mjs:
//! the server computes `result`; with `apply_zones` a test creates zones (source `test`, from the test date) and
//! updates the profile.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get};
use axum::{Json, Router};
use runflow_db::assessments as db;
use runflow_domain::assessment;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{STAFF, member};
use crate::body::Body;
use crate::session::Auth;
use crate::time::{club_today, parse_date};
use crate::{AppState, FieldError, Problem};

const STUDENT: &[&str] = &["student"];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/assessments", get(list).post(create))
        .route("/clubs/{club_id}/my/assessments", get(mine))
        .route("/clubs/{club_id}/assessments/{id}", delete(remove))
}

fn page(items: Vec<Value>) -> Json<Value> {
    Json(json!({ "items": items, "next_cursor": null }))
}

#[derive(Deserialize)]
struct Filter {
    membership_id: Option<String>,
    kind: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    Query(f): Query<Filter>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let athlete = match f.membership_id.as_deref().filter(|s| !s.is_empty()) {
        None => None,
        Some(s) => match Uuid::parse_str(s) {
            Ok(id) => Some(id),
            Err(_) => return Ok(page(Vec::new())),
        },
    };
    let kind = f.kind.as_deref().filter(|s| !s.is_empty());
    Ok(page(db::list(&state.db, m.club_id, athlete, kind).await?))
}

async fn mine(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STUDENT).await?;
    Ok(page(
        db::list(&state.db, m.club_id, Some(m.membership_id), None).await?,
    ))
}

fn error(field: impl Into<String>, message: &'static str) -> FieldError {
    FieldError {
        field: field.into().into(),
        message: message.into(),
    }
}

async fn create(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let me = member(&state, &auth, &club_id, STAFF).await?;
    let club = runflow_db::clubs::club(&state.db, me.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    let mut errors = Vec::new();

    let athlete = body
        .str("membership_id")
        .and_then(|s| Uuid::parse_str(&s).ok());
    let athlete = match athlete {
        Some(a) if runflow_db::members::is_active_student(&state.db, me.club_id, a).await? => {
            Some(a)
        }
        _ => {
            errors.push(error("membership_id", "Escolha o aluno."));
            None
        }
    };
    let kind = body
        .str("kind")
        .filter(|k| assessment::KINDS.contains(&k.as_str()));
    if kind.is_none() {
        errors.push(error("kind", "Escolha o tipo de avaliação."));
    }
    let date = body
        .str("date")
        .as_deref()
        .and_then(parse_date)
        .filter(|d| *d <= club_today(&club.timezone));
    if date.is_none() {
        errors.push(error("date", "Informe a data (hoje ou antes)."));
    }
    let data = body
        .get("data")
        .filter(|d| d.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let result = match kind.as_deref().map(|k| assessment::compute(k, &data)) {
        Some(Ok(r)) => r,
        Some(Err(es)) => {
            errors.extend(es.into_iter().map(|(f, m)| error(f, m)));
            json!({})
        }
        None => json!({}),
    };
    let (Some(athlete), Some(kind), Some(date), true) = (athlete, kind, date, errors.is_empty())
    else {
        return Err(Problem::invalid(errors));
    };

    let mut tx = state.db.begin().await?;
    // Apply: new zones from the test (dated the test day) and the matching profile fields.
    let mut zones_id = None;
    if body.bool("apply_zones") == Some(true)
        && let Some((zone_kind, bounds)) = assessment::zones_from(&kind, &result)
    {
        let z = runflow_db::athletes::insert_zones(
            &mut *tx,
            athlete,
            zone_kind,
            "test",
            &bounds,
            date,
            me.membership_id,
        )
        .await?;
        zones_id = Some(z.id);
        let p = assessment::profile_updates(&result);
        let int = |k: &str| p.get(k).and_then(Value::as_i64).map(|v| v as i32);
        db::apply_profile(
            &mut *tx,
            athlete,
            db::ProfileFromTest {
                threshold_pace_s_per_km: int("threshold_pace_s_per_km"),
                css_s_per_100m: int("css_s_per_100m"),
                ftp_w: int("ftp_w"),
                max_hr: int("max_hr"),
            },
        )
        .await?;
    }
    if kind == "body"
        && let Some(hr) = data
            .get("resting_hr")
            .and_then(Value::as_i64)
            .filter(|v| *v > 0)
    {
        db::set_resting_hr(&mut *tx, athlete, hr as i32).await?;
    }
    let notes = body
        .str("notes")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let id = db::insert(
        &mut *tx,
        db::New {
            club_id: me.club_id,
            membership_id: athlete,
            kind: &kind,
            date,
            data: &data,
            result: &result,
            notes,
            zones_id,
            by: me.membership_id,
        },
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(db::one(&state.db, id).await?)).into_response())
}

async fn remove(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let gone = match Uuid::parse_str(&id) {
        Ok(id) => db::delete(&state.db, m.club_id, id).await?,
        Err(_) => false,
    };
    if !gone {
        return Err(Problem::new(
            StatusCode::NOT_FOUND,
            "assessment.not_found",
            "Avaliação não encontrada",
            "Ela pode já ter sido apagada.",
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}
