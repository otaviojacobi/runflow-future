//! Strava sync (D-011): `strava.sync {connection_id, days}` imports recent activities after connecting;
//! `strava.event {event_id}` applies a webhook event. Event payloads are never trusted for data: we only use the
//! ids and fetch the activity from Strava with the athlete's token.

use chrono::{Duration, TimeZone, Utc};
use runflow_db::matching;
use runflow_db::providers::{self, Connection, NewActivity};
use runflow_integrations::strava::{Mapped, StravaError, map_activity};
use serde_json::Value;
use uuid::Uuid;

use crate::{JobError, Worker};

pub const STRAVA_SYNC: &str = "strava.sync";
pub const STRAVA_EVENT: &str = "strava.event";

fn strava_err(e: StravaError) -> JobError {
    match e {
        StravaError::Rejected(..) => JobError::permanent(e.to_string()),
        _ => JobError::retry(e.to_string()),
    }
}

pub(crate) fn to_new(m: Mapped) -> NewActivity {
    NewActivity {
        external_id: Some(m.external_id),
        sport: m.sport.to_string(),
        name: m.name,
        started_at: m.started_at,
        duration_s: m.duration_s,
        moving_time_s: m.moving_time_s,
        distance_m: m.distance_m,
        elevation_gain_m: m.elevation_gain_m,
        avg_hr: m.avg_hr,
        max_hr: m.max_hr,
        avg_pace_s_per_km: m.avg_pace_s_per_km,
        avg_power_w: m.avg_power_w,
        calories: m.calories,
        laps: m.laps,
        polyline: m.polyline,
    }
}

/// A valid access token, refreshing (and storing) it when it's about to expire.
async fn access_token(w: &Worker, c: &Connection) -> Result<String, JobError> {
    let s = w
        .strava
        .as_ref()
        .ok_or_else(|| JobError::permanent("strava not configured"))?;
    let dec = |b: &Option<Vec<u8>>| -> Result<String, JobError> {
        let raw = b
            .as_ref()
            .ok_or_else(|| JobError::permanent("no token (disconnected)"))?;
        String::from_utf8(
            s.cipher
                .decrypt(raw)
                .map_err(|e| JobError::permanent(e.to_string()))?,
        )
        .map_err(|_| JobError::permanent("bad token"))
    };
    if c.token_expires_at
        .is_some_and(|t| t > Utc::now() + Duration::minutes(2))
    {
        return dec(&c.access_token_enc);
    }
    let t = s
        .client
        .refresh(&dec(&c.refresh_token_enc)?)
        .await
        .map_err(strava_err)?;
    let expires = Utc
        .timestamp_opt(t.expires_at, 0)
        .single()
        .unwrap_or_else(Utc::now);
    providers::update_tokens(
        &w.db,
        c.id,
        &s.cipher.encrypt(t.access_token.as_bytes()),
        &s.cipher.encrypt(t.refresh_token.as_bytes()),
        expires,
    )
    .await?;
    Ok(t.access_token)
}

/// Mark the connection broken when Strava refuses our tokens (the person revoked access, or it expired).
async fn fail_connection(w: &Worker, c: &Connection, e: JobError) -> Result<(), JobError> {
    if !e.retry {
        providers::mark_synced(&w.db, c.id, false).await?;
    }
    Err(e)
}

pub(crate) async fn sync(w: &Worker, payload: &Value) -> Result<(), JobError> {
    let id = payload["connection_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| JobError::permanent("bad payload"))?;
    let Some(c) = providers::connection_by_id(&w.db, id)
        .await?
        .filter(|c| c.status != "revoked")
    else {
        return Ok(());
    };
    let token = match access_token(w, &c).await {
        Ok(t) => t,
        Err(e) => return fail_connection(w, &c, e).await,
    };
    let client = &w
        .strava
        .as_ref()
        .ok_or_else(|| JobError::permanent("strava not configured"))?
        .client;
    let days = payload["days"].as_i64().unwrap_or(30).clamp(1, 365) as i32;
    let after = (Utc::now() - Duration::days(days.into())).timestamp();
    for page in 1..=5 {
        let batch = match client.activities(&token, after, page).await {
            Ok(b) => b,
            Err(e) => return fail_connection(w, &c, strava_err(e)).await,
        };
        for a in &batch {
            if let Some(m) = map_activity(a) {
                providers::upsert_activity(&w.db, c.user_id, "strava", &to_new(m)).await?;
            }
        }
        if batch.len() < 100 {
            break;
        }
    }
    // Matched to the plan like any import (D-049); a retried sync matches again, which changes nothing.
    let mut tx = w.db.begin().await?;
    providers::mark_synced(&mut *tx, c.id, true).await?;
    let today = Utc::now().date_naive();
    matching::enqueue(
        &mut *tx,
        c.user_id,
        today - Duration::days(i64::from(days) + 1),
        today,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn event(w: &Worker, payload: &Value) -> Result<(), JobError> {
    let id = payload["event_id"]
        .as_i64()
        .ok_or_else(|| JobError::permanent("bad payload"))?;
    let Some(e) = providers::event(&w.db, id).await? else {
        return Ok(());
    };
    let result = apply_event(w, &e).await;
    let err = result.as_ref().err().map(|e| e.message.clone());
    if result.is_ok() || !result.as_ref().is_err_and(|e| e.retry) {
        providers::event_done(&w.db, id, err.as_deref()).await?;
    }
    result
}

async fn apply_event(w: &Worker, e: &Value) -> Result<(), JobError> {
    let owner = e["owner_id"]
        .as_i64()
        .map(|o| o.to_string())
        .unwrap_or_default();
    let Some(c) = providers::connection_by_external(&w.db, "strava", &owner)
        .await?
        .filter(|c| c.status != "revoked")
    else {
        return Ok(());
    };
    match (e["object_type"].as_str(), e["aspect_type"].as_str()) {
        // The athlete revoked access on Strava's side: same as disconnecting in the app.
        (Some("athlete"), Some("update")) if e["updates"]["authorized"] == "false" => {
            let mut tx = w.db.begin().await?;
            providers::revoke(&mut tx, c.user_id, "strava").await?;
            tx.commit().await?;
            Ok(())
        }
        (Some("activity"), Some("delete")) => {
            let mut tx = w.db.begin().await?;
            if let Some(at) = providers::delete_external(
                &mut *tx,
                c.user_id,
                "strava",
                &e["object_id"].as_i64().unwrap_or_default().to_string(),
            )
            .await?
            {
                let (from, to) = matching::days_around(at);
                matching::enqueue(&mut *tx, c.user_id, from, to).await?;
            }
            tx.commit().await?;
            Ok(())
        }
        (Some("activity"), Some("create" | "update")) => {
            let token = match access_token(w, &c).await {
                Ok(t) => t,
                Err(err) => return fail_connection(w, &c, err).await,
            };
            let client = &w
                .strava
                .as_ref()
                .ok_or_else(|| JobError::permanent("strava not configured"))?
                .client;
            let a = match client
                .activity(&token, e["object_id"].as_i64().unwrap_or_default())
                .await
            {
                Ok(a) => a,
                // Deleted or made inaccessible in between: nothing to import.
                Err(StravaError::Rejected(404, _)) => return Ok(()),
                Err(err) => return fail_connection(w, &c, strava_err(err)).await,
            };
            let mut tx = w.db.begin().await?;
            if let Some(m) = map_activity(&a) {
                // Matched around its day, and the day it had before when an edit moved it (D-049).
                let before =
                    providers::started_at(&mut *tx, c.user_id, "strava", &m.external_id).await?;
                let (mut from, mut to) = matching::days_around(m.started_at);
                if let Some(b) = before {
                    let (f, t) = matching::days_around(b);
                    (from, to) = (from.min(f), to.max(t));
                }
                providers::upsert_activity(&mut *tx, c.user_id, "strava", &to_new(m)).await?;
                matching::enqueue(&mut *tx, c.user_id, from, to).await?;
            }
            providers::mark_synced(&mut *tx, c.id, true).await?;
            tx.commit().await?;
            Ok(())
        }
        _ => Ok(()),
    }
}
