//! `/me/*`: the signed-in person (A4, C1, W11, shell).

use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, NaiveDate, Utc};
use runflow_db::me as db;
use runflow_db::models::{MembershipContext, User};
use runflow_db::notifications;
use runflow_domain::notify;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::body::Body;
use crate::session::{Auth, clear_cookie};
use crate::{AppState, FieldError, Problem};

const CONSENT_KINDS: [&str; 5] = [
    "terms",
    "privacy",
    "share_training_data",
    "share_strava",
    "share_garmin",
];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/me", get(me).patch(update).delete(delete_account))
        .route("/me/export", get(export))
        .route("/me/prefs", get(prefs).patch(update_prefs))
        .route("/me/consents", get(consents).post(grant_consent))
        .route("/me/consents/{id}", delete(revoke_consent))
        .route("/me/notifications", get(notifications))
        .route("/me/notifications/read", post(read_notifications))
        .route("/me/sessions", get(sessions))
        .route("/me/sessions/revoke-others", post(revoke_others))
        .route("/me/sessions/{id}", delete(revoke_session))
        .route("/me/avatar", post(upload_avatar).delete(remove_avatar))
}

#[derive(Serialize)]
pub struct Me {
    user: User,
    memberships: Vec<MembershipContext>,
    prefs: Value,
    unread_notifications: i64,
}

#[derive(Serialize)]
struct List<T> {
    items: Vec<T>,
    next_cursor: Option<String>,
}

/// The `/me` payload (also returned after profile changes).
pub async fn me_payload(state: &AppState, user_id: Uuid) -> Result<Me, Problem> {
    let mut conn = state.db.acquire().await?;
    let user = runflow_db::auth::user_by_id(&mut *conn, user_id)
        .await?
        .ok_or_else(Problem::unauthorized)?;
    Ok(Me {
        memberships: db::memberships(&mut conn, user_id).await?,
        prefs: prefs_json(&mut *conn, user_id).await?,
        unread_notifications: db::unread_notifications(&mut *conn, user_id).await?,
        user,
    })
}

async fn me(State(state): State<AppState>, auth: Auth) -> Result<Json<Me>, Problem> {
    Ok(Json(me_payload(&state, auth.user_id).await?))
}

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

async fn update(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<Json<Me>, Problem> {
    let mut errors = Vec::new();
    let mut patch = db::ProfilePatch::default();
    if body.has("name") {
        match body.str("name") {
            None => errors.push(fail("name", "Informe seu nome.")),
            Some(n) if n.chars().count() > 120 => {
                errors.push(fail("name", "Use no máximo 120 caracteres."))
            }
            Some(n) => patch.name = Some(n),
        }
    }
    if body.has("phone") {
        match body.str("phone") {
            Some(p) if p.chars().count() > 30 => {
                errors.push(fail("phone", "Use no máximo 30 caracteres."))
            }
            p => patch.phone = Some(p),
        }
    }
    if body.has("birth_date") {
        match body.str("birth_date") {
            None => patch.birth_date = Some(None),
            Some(d) => match NaiveDate::parse_from_str(&d, "%Y-%m-%d") {
                Ok(date)
                    if date > NaiveDate::from_ymd_opt(1900, 1, 1).unwrap()
                        && date <= Utc::now().date_naive() =>
                {
                    patch.birth_date = Some(Some(date))
                }
                _ => errors.push(fail("birth_date", "Data inválida.")),
            },
        }
    }
    if body.has("sex") {
        match body.str("sex") {
            None => patch.sex = Some(None),
            Some(s) if ["female", "male", "other"].contains(&s.as_str()) => {
                patch.sex = Some(Some(s))
            }
            Some(_) => errors.push(fail("sex", "Opção inválida.")),
        }
    }
    if body.has("avatar_url") {
        // Only our own uploads (no third-party URLs loaded by other people's browsers).
        match body.str("avatar_url") {
            None => patch.avatar_url = Some(None),
            Some(u)
                if u.strip_prefix("/v1/assets/")
                    .is_some_and(|id| Uuid::parse_str(id).is_ok()) =>
            {
                patch.avatar_url = Some(Some(u))
            }
            Some(_) => errors.push(fail("avatar_url", "Envie a foto pelo app.")),
        }
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    db::update_profile(&state.db, auth.user_id, patch)
        .await?
        .ok_or_else(Problem::unauthorized)?;
    Ok(Json(me_payload(&state, auth.user_id).await?))
}

async fn delete_account(State(state): State<AppState>, auth: Auth) -> Result<Response, Problem> {
    let mut tx = state.db.begin().await?;
    if db::owns_a_club(&mut *tx, auth.user_id).await? {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "account.owns_club",
            "Você ainda é gestor de um clube",
            "Transfira a gestão ou encerre o clube antes de excluir sua conta.",
        ));
    }
    let ended = db::delete_account(&mut tx, auth.user_id).await?;
    tx.commit().await?;
    crate::session::forget(&state, &ended).await;
    tracing::info!(user_id = %auth.user_id, "account deleted");
    Ok((
        [(header::SET_COOKIE, clear_cookie(&state.settings.auth))],
        StatusCode::NO_CONTENT,
    )
        .into_response())
}

async fn export(State(state): State<AppState>, auth: Auth) -> Result<Json<Value>, Problem> {
    Ok(Json(db::export(&state.db, auth.user_id).await?))
}

// ------------------------------------------------------------------------------------ avatar

async fn upload_avatar(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<Json<Me>, Problem> {
    let img = crate::uploads::read_image(&body, false)?;
    let id = crate::uploads::store(&state, auth.user_id, None, "avatar", img).await?;
    runflow_db::clubs::set_avatar(&state.db, auth.user_id, Some(&format!("/v1/assets/{id}")))
        .await?;
    Ok(Json(me_payload(&state, auth.user_id).await?))
}

async fn remove_avatar(State(state): State<AppState>, auth: Auth) -> Result<Json<Me>, Problem> {
    runflow_db::clubs::set_avatar(&state.db, auth.user_id, None).await?;
    Ok(Json(me_payload(&state, auth.user_id).await?))
}

// ------------------------------------------------------------------------------------ prefs

/// `/me/prefs` (D-045): push per kind, resolved with its default, and the pause.
async fn prefs_json(db: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> Result<Value, Problem> {
    let p = notifications::prefs(db, user_id).await?;
    Ok(json!({ "kinds": notify::all(&p.kinds), "paused": p.paused }))
}

async fn prefs(State(state): State<AppState>, auth: Auth) -> Result<Json<Value>, Problem> {
    Ok(Json(prefs_json(&state.db, auth.user_id).await?))
}

async fn update_prefs(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let p = notifications::prefs(&state.db, auth.user_id).await?;
    let mut errors = Vec::new();
    let kinds = match body.get("kinds") {
        Some(patch) => notify::merge(&p.kinds, patch).unwrap_or_else(|msg| {
            errors.push(fail("kinds", msg));
            p.kinds.clone()
        }),
        None => p.kinds.clone(),
    };
    let paused = match body.get("paused") {
        None => p.paused,
        Some(v) => v.as_bool().unwrap_or_else(|| {
            errors.push(fail("paused", "Use ligado ou desligado."));
            p.paused
        }),
    };
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    notifications::save_prefs(&state.db, auth.user_id, &kinds, paused).await?;
    Ok(Json(prefs_json(&state.db, auth.user_id).await?))
}

// ------------------------------------------------------------------------------------ consents

async fn consents(State(state): State<AppState>, auth: Auth) -> Result<Json<Value>, Problem> {
    Ok(Json(json!(List {
        items: db::consents(&state.db, auth.user_id).await?,
        next_cursor: None
    })))
}

async fn grant_consent(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<Response, Problem> {
    let kind = body
        .str("kind")
        .filter(|k| CONSENT_KINDS.contains(&k.as_str()))
        .ok_or_else(|| Problem::field("kind", "Tipo de consentimento inválido."))?;
    let club_id = match body.get("club_id") {
        None | Some(Value::Null) => None,
        Some(v) => Some(
            v.as_str()
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or_else(Problem::club_not_found)?,
        ),
    };
    if let Some(club) = club_id
        && !db::is_member(&state.db, auth.user_id, club).await?
    {
        return Err(Problem::club_not_found());
    }
    if let Some(existing) = db::active_consent(&state.db, auth.user_id, club_id, &kind).await? {
        return Ok(Json(existing).into_response());
    }
    let version = body
        .str("text_version")
        .unwrap_or_else(|| runflow_db::auth::TERMS_VERSION.to_string());
    let mut tx = state.db.begin().await?;
    let row = db::grant_consent(&mut *tx, auth.user_id, club_id, &kind, &version).await?;
    rematch_after_sharing(&mut tx, auth.user_id, &kind).await?;
    tx.commit().await?;
    sharing_changed(&state, club_id).await;
    Ok((StatusCode::CREATED, Json(row)).into_response())
}

/// What a club's staff may see changed (§5: revoking ends it at once): its cached reads (dashboard, report) go.
async fn sharing_changed(state: &AppState, club: Option<Uuid>) {
    if let Some(club) = club
        && let Err(e) = runflow_kv::cache::bump(&state.kv, &[club]).await
    {
        tracing::warn!(error = %e, %club, "cache: version bump failed; reads refresh at their TTL");
    }
}

/// Sharing decides which clubs an activity may complete workouts of (D-011, D-049): after it changes, the last 30
/// days are matched again (in the worker).
pub(crate) async fn rematch_after_sharing(
    tx: &mut sqlx::PgConnection,
    user_id: Uuid,
    kind: &str,
) -> Result<(), Problem> {
    if kind.starts_with("share_") {
        let (_, today) = runflow_db::matching::student_clock(&mut *tx, user_id).await?;
        runflow_db::matching::enqueue(&mut *tx, user_id, today - chrono::Duration::days(30), today)
            .await?;
    }
    Ok(())
}

async fn revoke_consent(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> Result<StatusCode, Problem> {
    let not_found = || {
        Problem::new(
            StatusCode::NOT_FOUND,
            "consent.not_found",
            "Consentimento não encontrado",
            "Ele pode já ter sido revogado.",
        )
    };
    let id = Uuid::parse_str(&id).map_err(|_| not_found())?;
    let c = db::consent(&state.db, auth.user_id, id)
        .await?
        .ok_or_else(not_found)?;
    if c.kind == "terms" || c.kind == "privacy" {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "consent.required",
            "Este consentimento é obrigatório",
            "Para revogar os termos, exclua sua conta.",
        ));
    }
    let mut tx = state.db.begin().await?;
    db::revoke_consent(&mut *tx, id).await?;
    rematch_after_sharing(&mut tx, auth.user_id, &c.kind).await?;
    tx.commit().await?;
    sharing_changed(&state, c.club_id).await;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------------ notifications

#[derive(Deserialize)]
struct Page {
    cursor: Option<String>,
    limit: Option<i64>,
}

fn encode_cursor(at: DateTime<Utc>, id: Uuid) -> String {
    URL_SAFE_NO_PAD.encode(format!("{}|{id}", at.to_rfc3339()))
}

fn decode_cursor(c: &str) -> Option<(DateTime<Utc>, Uuid)> {
    let raw = String::from_utf8(URL_SAFE_NO_PAD.decode(c).ok()?).ok()?;
    let (at, id) = raw.split_once('|')?;
    Some((
        DateTime::parse_from_rfc3339(at).ok()?.with_timezone(&Utc),
        Uuid::parse_str(id).ok()?,
    ))
}

async fn notifications(
    State(state): State<AppState>,
    auth: Auth,
    Query(page): Query<Page>,
) -> Result<Json<Value>, Problem> {
    let limit = page.limit.unwrap_or(50).clamp(1, 200);
    let before = match page.cursor.as_deref().filter(|c| !c.is_empty()) {
        None => None,
        Some(c) => {
            Some(decode_cursor(c).ok_or_else(|| Problem::field("cursor", "Página inválida."))?)
        }
    };
    let mut items = db::notifications(&state.db, auth.user_id, before, limit + 1).await?;
    let next_cursor = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items.last().map(|n| encode_cursor(n.created_at, n.id))
    } else {
        None
    };
    Ok(Json(json!(List { items, next_cursor })))
}

async fn read_notifications(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<StatusCode, Problem> {
    let ids: Option<Vec<Uuid>> = match body.get("ids") {
        Some(Value::Array(a)) => Some(
            a.iter()
                .filter_map(|v| v.as_str().and_then(|s| Uuid::parse_str(s).ok()))
                .collect(),
        ),
        _ => None,
    };
    db::read_notifications(&state.db, auth.user_id, ids.as_deref()).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------------ sessions

async fn sessions(State(state): State<AppState>, auth: Auth) -> Result<Json<Value>, Problem> {
    let items = runflow_db::auth::list_sessions(&state.db, auth.user_id, auth.session_id).await?;
    Ok(Json(json!(List {
        items,
        next_cursor: None
    })))
}

async fn revoke_session(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> Result<StatusCode, Problem> {
    let not_found = || {
        Problem::new(
            StatusCode::NOT_FOUND,
            "session.not_found",
            "Sessão não encontrada",
            "Ela pode já ter sido encerrada.",
        )
    };
    let id = Uuid::parse_str(&id).map_err(|_| not_found())?;
    let hash = runflow_db::auth::revoke_session(&state.db, auth.user_id, id)
        .await?
        .ok_or_else(not_found)?;
    crate::session::forget(&state, &[hash]).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn revoke_others(State(state): State<AppState>, auth: Auth) -> Result<Json<Value>, Problem> {
    let ended =
        runflow_db::auth::revoke_other_sessions(&state.db, auth.user_id, auth.session_id).await?;
    crate::session::forget(&state, &ended).await;
    Ok(Json(json!({ "revoked": ended.len() })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursors_round_trip() {
        let at = Utc::now();
        let id = Uuid::now_v7();
        let (a, b) = decode_cursor(&encode_cursor(at, id)).unwrap();
        assert_eq!((a.timestamp_micros(), b), (at.timestamp_micros(), id));
        assert!(decode_cursor("garbage").is_none());
    }
}
