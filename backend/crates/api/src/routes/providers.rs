//! Provider connections (A4, C1), Strava OAuth + webhooks (D-011), and the person's own activities (M4).

use aws_lc_rs::hmac;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, TimeZone, Utc};
use runflow_db::providers as db;
use runflow_domain::workout::SPORTS;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::body::Body;
use crate::session::Auth;
use crate::time::parse_date;
use crate::{AppState, FieldError, Problem};

const STATE_TTL_S: i64 = 15 * 60;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/me/connections", get(connections))
        .route("/me/connections/strava/start", post(strava_start))
        .route("/me/connections/strava/callback", post(strava_callback))
        .route("/me/connections/{provider}", delete(disconnect))
        .route("/webhooks/strava", get(strava_verify).post(strava_event))
        .route("/me/activities", get(activities).post(log_activity))
        .route("/me/activities/{id}", get(activity).delete(delete_activity))
}

fn unavailable() -> Problem {
    Problem::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "strava.unavailable",
        "Strava indisponível",
        "A conexão com o Strava ainda não está configurada. Tente mais tarde.",
    )
}

/// `user.exp.signature`: proves the OAuth round trip started here, for this person, recently.
fn sign_state(state: &AppState, user: Uuid, exp: i64) -> String {
    let payload = format!("{user}.{exp}");
    let key = hmac::Key::new(hmac::HMAC_SHA256, &state.settings.auth.secret);
    format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(&payload),
        URL_SAFE_NO_PAD.encode(hmac::sign(&key, payload.as_bytes()))
    )
}

fn check_state(state: &AppState, user: Uuid, s: &str) -> bool {
    let Some((p, sig)) = s.split_once('.') else {
        return false;
    };
    let (Ok(p), Ok(sig)) = (URL_SAFE_NO_PAD.decode(p), URL_SAFE_NO_PAD.decode(sig)) else {
        return false;
    };
    let key = hmac::Key::new(hmac::HMAC_SHA256, &state.settings.auth.secret);
    if hmac::verify(&key, &p, &sig).is_err() {
        return false;
    }
    let text = String::from_utf8(p).unwrap_or_default();
    let Some((u, exp)) = text.split_once('.') else {
        return false;
    };
    u == user.to_string()
        && exp
            .parse::<i64>()
            .is_ok_and(|e| e >= Utc::now().timestamp())
}

async fn connections(State(state): State<AppState>, auth: Auth) -> Result<Json<Value>, Problem> {
    let strava = db::connection(&state.db, auth.user_id, "strava")
        .await?
        .filter(|c| c.status != "revoked");
    Ok(Json(json!({ "items": [
        { "provider": "strava", "available": state.strava.is_some(), "connection": strava.map(|c| c.public()) },
        { "provider": "garmin", "available": false, "connection": null },
    ] })))
}

/// The phone app's URL scheme (`mobile/app.json`): Strava sends it back to `runflow://<callback domain>/connect/strava`.
const APP_SCHEME: &str = "runflow";

async fn strava_start(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let client = state.strava.as_ref().ok_or_else(unavailable)?;
    let app = match body.str("client").as_deref() {
        None | Some("web") => false,
        Some("app") => true,
        Some(_) => return Err(Problem::field("client", "Cliente inválido.")),
    };
    let st = sign_state(&state, auth.user_id, Utc::now().timestamp() + STATE_TTL_S);
    let web = state.settings.public_app_url.trim_end_matches('/');
    let (authorize_url, redirect) = if app {
        // Strava accepts a custom scheme when its host is the app's callback domain (PUBLIC_APP_URL's host).
        let host = web
            .split_once("://")
            .map_or(web, |(_, rest)| rest)
            .split(['/', ':'])
            .next()
            .unwrap_or_default();
        let redirect = format!("{APP_SCHEME}://{host}/connect/strava");
        (client.mobile_authorize_url(&redirect, &st), redirect)
    } else {
        let redirect = format!("{web}/connect/strava");
        (client.authorize_url(&redirect, &st), redirect)
    };
    Ok(Json(
        json!({ "authorize_url": authorize_url, "state": st, "redirect_uri": redirect }),
    ))
}

async fn strava_callback(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let client = state.strava.clone().ok_or_else(unavailable)?;
    let denied = || {
        Problem::new(
            StatusCode::BAD_REQUEST,
            "strava.denied",
            "Conexão cancelada",
            "Você não autorizou o acesso no Strava.",
        )
    };
    let code = body.str("code").ok_or_else(denied)?;
    if !body
        .str("state")
        .is_some_and(|s| check_state(&state, auth.user_id, &s))
    {
        return Err(Problem::new(
            StatusCode::BAD_REQUEST,
            "strava.state_invalid",
            "O link de conexão expirou",
            "Tente conectar o Strava de novo.",
        ));
    }
    // Strava returns the scopes the person actually granted; without activities there's nothing to sync.
    let scopes: Vec<String> = body
        .str("scope")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if !scopes.is_empty() && !scopes.iter().any(|s| s.starts_with("activity:read")) {
        return Err(Problem::new(
            StatusCode::BAD_REQUEST,
            "strava.scope",
            "Precisamos ler suas atividades",
            "Marque a permissão de atividades ao autorizar no Strava.",
        ));
    }
    let tokens = client.exchange_code(&code).await.map_err(|e| {
        tracing::info!(error = %e, "strava code exchange failed");
        denied()
    })?;
    let athlete = tokens.athlete.clone().ok_or_else(denied)?;
    let expires = Utc
        .timestamp_opt(tokens.expires_at, 0)
        .single()
        .unwrap_or_else(Utc::now);
    let row = db::upsert_connection(
        &state.db,
        db::NewConnection {
            user_id: auth.user_id,
            provider: "strava",
            external_user_id: &athlete.id.to_string(),
            athlete_name: athlete.name().as_deref(),
            access_token_enc: &state.cipher.encrypt(tokens.access_token.as_bytes()),
            refresh_token_enc: &state.cipher.encrypt(tokens.refresh_token.as_bytes()),
            scopes: &if scopes.is_empty() {
                vec!["read".into(), "activity:read_all".into()]
            } else {
                scopes
            },
            token_expires_at: expires,
        },
    )
    .await;
    let id = match row {
        Ok(id) => id,
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return Err(Problem::new(
                StatusCode::CONFLICT,
                "strava.taken",
                "Este Strava já está ligado a outra conta",
                "Desconecte-o na outra conta do Runflow primeiro.",
            ));
        }
        Err(e) => return Err(e.into()),
    };
    runflow_jobs::enqueue(
        &state.db,
        runflow_jobs::STRAVA_SYNC,
        json!({ "connection_id": id, "days": 30 }),
    )
    .await?;
    let c = db::connection_by_id(&state.db, id)
        .await?
        .ok_or_else(Problem::internal)?;
    Ok(Json(c.public()))
}

async fn disconnect(
    State(state): State<AppState>,
    auth: Auth,
    Path(provider): Path<String>,
) -> Result<StatusCode, Problem> {
    let missing = || {
        Problem::new(
            StatusCode::NOT_FOUND,
            "connection.not_found",
            "Conexão não encontrada",
            "Ela já foi desfeita.",
        )
    };
    let c = db::connection(&state.db, auth.user_id, &provider)
        .await?
        .filter(|c| c.status != "revoked")
        .ok_or_else(missing)?;
    // Tell Strava too (best effort): the person's access is revoked on their side as well.
    if let (Some(client), Some(enc)) = (state.strava.as_ref(), c.access_token_enc.as_ref())
        && let Ok(token) = state.cipher.decrypt(enc)
        && let Err(e) = client.deauthorize(&String::from_utf8_lossy(&token)).await
    {
        tracing::warn!(error = %e, "strava deauthorize failed");
    }
    let mut tx = state.db.begin().await?;
    db::revoke(&mut tx, auth.user_id, &provider).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------------ webhooks

#[derive(Deserialize)]
struct Verify {
    #[serde(rename = "hub.mode")]
    mode: Option<String>,
    #[serde(rename = "hub.verify_token")]
    token: Option<String>,
    #[serde(rename = "hub.challenge")]
    challenge: Option<String>,
}

/// Subscription handshake: echo the challenge when the verify token matches ours.
async fn strava_verify(
    State(state): State<AppState>,
    Query(v): Query<Verify>,
) -> Result<Json<Value>, Problem> {
    let ok = v.mode.as_deref() == Some("subscribe")
        && state
            .settings
            .strava_verify_token
            .as_deref()
            .is_some_and(|t| Some(t) == v.token.as_deref());
    if !ok {
        return Err(Problem::new(
            StatusCode::FORBIDDEN,
            "webhook.forbidden",
            "Acesso negado",
            "Token de verificação inválido.",
        ));
    }
    Ok(Json(
        json!({ "hub.challenge": v.challenge.unwrap_or_default() }),
    ))
}

/// Events must be answered within 2 s: record once, process in the worker.
async fn strava_event(State(state): State<AppState>, body: Body) -> Result<StatusCode, Problem> {
    let e = Value::Object(body.0);
    let key = format!(
        "{}:{}:{}:{}",
        e["object_type"].as_str().unwrap_or("?"),
        e["object_id"],
        e["aspect_type"].as_str().unwrap_or("?"),
        e["event_time"]
    );
    if let Some(id) = db::record_event(&state.db, "strava", &key, &e).await? {
        runflow_jobs::enqueue(
            &state.db,
            runflow_jobs::STRAVA_EVENT,
            json!({ "event_id": id }),
        )
        .await?;
    }
    Ok(StatusCode::OK)
}

// ------------------------------------------------------------------------------------ my activities

fn activity_json((a, matched): (runflow_db::models::Activity, Option<Value>)) -> Value {
    let mut v = serde_json::to_value(a).unwrap_or(Value::Null);
    v["matched_workout"] = matched.unwrap_or(Value::Null);
    v
}

#[derive(Deserialize)]
struct Range {
    from: Option<String>,
    to: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
}

async fn activities(
    State(state): State<AppState>,
    auth: Auth,
    Query(q): Query<Range>,
) -> Result<Json<Value>, Problem> {
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let start = q
        .cursor
        .as_deref()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(0);
    let rows = db::my_activities(
        &state.db,
        auth.user_id,
        q.from.as_deref().and_then(parse_date),
        q.to.as_deref().and_then(parse_date),
        limit + 1,
        start,
        None,
    )
    .await?;
    let next = (rows.len() as i64 > limit).then(|| (start + limit).to_string());
    Ok(Json(
        json!({ "items": rows.into_iter().take(limit as usize).map(activity_json).collect::<Vec<_>>(), "next_cursor": next }),
    ))
}

fn activity_missing() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "activity.not_found",
        "Atividade não encontrada",
        "Ela pode ter sido removida.",
    )
}

async fn mine(
    state: &AppState,
    user: Uuid,
    id: &str,
) -> Result<(runflow_db::models::Activity, Option<Value>), Problem> {
    let id = Uuid::parse_str(id).map_err(|_| activity_missing())?;
    db::my_activities(&state.db, user, None, None, 1, 0, Some(id))
        .await?
        .pop()
        .ok_or_else(activity_missing)
}

async fn activity(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> Result<Json<Value>, Problem> {
    Ok(Json(activity_json(mine(&state, auth.user_id, &id).await?)))
}

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

async fn log_activity(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<Response, Problem> {
    let mut errors = Vec::new();
    let sport = body.str("sport").filter(|s| SPORTS.contains(&s.as_str()));
    if sport.is_none() {
        errors.push(fail("sport", "Escolha a modalidade."));
    }
    let started: Option<DateTime<Utc>> = body.str("started_at").and_then(|s| {
        DateTime::parse_from_rfc3339(&s)
            .map(|d| d.with_timezone(&Utc))
            .ok()
            .or_else(|| {
                // `2026-11-02T07:30` (no zone) from a datetime-local input: club time, São Paulo.
                chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M")
                    .ok()
                    .and_then(|n| n.and_local_timezone(chrono_tz::America::Sao_Paulo).single())
                    .map(|d| d.with_timezone(&Utc))
            })
    });
    if started.is_none() {
        errors.push(fail("started_at", "Informe a data e a hora."));
    }
    let duration = body
        .get("duration_s")
        .and_then(Value::as_i64)
        .filter(|d| *d > 0 && *d <= 86_400 * 7);
    if duration.is_none() {
        errors.push(fail("duration_s", "Informe a duração."));
    }
    let distance = match body.get("distance_m") {
        None | Some(Value::Null) => None,
        Some(v) => match v.as_i64().filter(|d| *d > 0 && *d < 10_000_000) {
            Some(d) => Some(d as i32),
            None => {
                errors.push(fail("distance_m", "Distância inválida."));
                None
            }
        },
    };
    let avg_hr = body
        .get("avg_hr")
        .and_then(Value::as_i64)
        .filter(|h| (30..=240).contains(h))
        .map(|h| h as i32);
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let (sport, duration) = (
        sport.unwrap_or_default(),
        duration.unwrap_or_default() as i32,
    );
    let pace = match (sport.as_str(), distance) {
        ("run", Some(d)) => Some(((duration as f64) / (d as f64 / 1000.0)).round() as i32),
        _ => None,
    };
    let a = db::NewActivity {
        external_id: None,
        name: body
            .str("name")
            .unwrap_or_else(|| "Atividade".into())
            .chars()
            .take(200)
            .collect(),
        sport,
        started_at: started.unwrap_or_else(Utc::now),
        duration_s: duration,
        moving_time_s: Some(duration),
        distance_m: distance,
        elevation_gain_m: None,
        avg_hr,
        max_hr: None,
        avg_pace_s_per_km: pace,
        avg_power_w: None,
        calories: None,
        laps: None,
        polyline: None,
    };
    let id = db::upsert_activity(&state.db, auth.user_id, "manual", &a).await?;
    Ok((
        StatusCode::CREATED,
        Json(activity_json(
            mine(&state, auth.user_id, &id.to_string()).await?,
        )),
    )
        .into_response())
}

async fn delete_activity(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> Result<StatusCode, Problem> {
    let (a, _) = mine(&state, auth.user_id, &id).await?;
    if a.source != "manual" {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "activity.synced",
            "Atividade sincronizada",
            "Para remover, apague no app de origem (Strava).",
        ));
    }
    db::delete_activity(&state.db, a.id).await?;
    Ok(StatusCode::NO_CONTENT)
}
