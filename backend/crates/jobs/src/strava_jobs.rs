//! Strava sync (D-011): `strava.sync {connection_id, days}` imports recent activities after connecting;
//! `strava.event {event_id}` applies a webhook event. Event payloads are never trusted for data: we only use the
//! ids and fetch the activity from Strava with the athlete's token.
//!
//! The completed-training analysis (D-055): every activity is fetched in detail (laps, per-km splits, the full route;
//! `strava.activity {connection_id, strava_id}` for the ones a sync listed), then its time series on its own
//! (`strava.streams {connection_id, activity_id, strava_id}`), so a rate-limited streams call retries without
//! touching the activity. A new activity from the webhook also tells its athlete (`activity_synced`).

use chrono::{Duration, TimeZone, Utc};
use runflow_db::providers::{self, Connection, NewActivity};
use runflow_db::{jobs, matching, notifications};
use runflow_integrations::strava::{Mapped, StravaError, map_activity, map_streams};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{JobError, Worker};

pub const STRAVA_SYNC: &str = "strava.sync";
pub const STRAVA_EVENT: &str = "strava.event";
pub use providers::STRAVA_ACTIVITY;
pub const STRAVA_STREAMS: &str = "strava.streams";

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
        splits: m.splits,
        polyline: m.polyline,
        route_polyline: m.route_polyline,
    }
}

/// "Corrida matinal · 7,5 km · 38:12": what the `activity_synced` notification says (pt-BR, D-013).
pub(crate) fn synced_body(m: &Mapped) -> String {
    let mut parts = vec![m.name.clone()];
    if let Some(d) = m.distance_m.filter(|d| *d > 0) {
        parts.push(if m.sport == "swim" || d < 1000 {
            format!("{d} m")
        } else {
            format!("{:.1} km", f64::from(d) / 1000.0).replace('.', ",")
        });
    }
    let t = m.moving_time_s.unwrap_or(m.duration_s).max(0);
    parts.push(if t >= 3600 {
        format!("{}:{:02}:{:02}", t / 3600, t % 3600 / 60, t % 60)
    } else {
        format!("{}:{:02}", t / 60, t % 60)
    });
    parts.join(" · ")
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

/// `strava.deauthorize`: Strava is told a connection ended that the person didn't end themselves (no club could see
/// the sync any more, `providers::enforce_sharing`). The data is already gone; this only revokes our access on
/// Strava's side, refreshing the token first when it expired. Strava refusing the token means it's already revoked.
pub(crate) async fn deauthorize(w: &Worker, payload: &Value) -> Result<(), JobError> {
    let Some(s) = w.strava.as_ref() else {
        return Ok(());
    };
    let dec = |key: &str| -> Option<String> {
        let raw = providers::from_hex(payload[key].as_str()?)?;
        String::from_utf8(s.cipher.decrypt(&raw).ok()?).ok()
    };
    let fresh = payload["token_expires_at"]
        .as_str()
        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
        .is_some_and(|t| t > Utc::now() + Duration::minutes(2));
    let token = match (fresh, dec("access_token_enc"), dec("refresh_token_enc")) {
        (true, Some(t), _) | (false, Some(t), None) => t,
        (false, _, Some(r)) => match s.client.refresh(&r).await {
            Ok(t) => t.access_token,
            Err(StravaError::Rejected(..)) => return Ok(()),
            Err(e) => return Err(strava_err(e)),
        },
        _ => return Ok(()),
    };
    match s.client.deauthorize(&token).await {
        Ok(()) | Err(StravaError::Rejected(..)) => Ok(()),
        Err(e) => Err(strava_err(e)),
    }
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
    let mut queued: i32 = 0;
    for page in 1..=5 {
        let batch = match client.activities(&token, after, page).await {
            Ok(b) => b,
            Err(e) => return fail_connection(w, &c, strava_err(e)).await,
        };
        for a in &batch {
            if let Some(m) = map_activity(a) {
                let strava_id = a["id"].as_i64().unwrap_or_default();
                let mut tx = w.db.begin().await?;
                providers::upsert_activity(&mut *tx, c.user_id, "strava", &to_new(m)).await?;
                // The list has no laps, splits or route: fetched one by one, a little apart (Strava's rate limits).
                let wait = Duration::seconds(2 * i64::from(queued));
                jobs::enqueue(
                    &mut *tx,
                    STRAVA_ACTIVITY,
                    &json!({ "connection_id": c.id, "strava_id": strava_id }),
                    Some(Utc::now() + wait),
                )
                .await?;
                tx.commit().await?;
                queued += 1;
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

/// One activity fetched in detail and stored (D-055): matched around its day (and the day it had before, when an
/// edit moved it; D-049), its time series queued, and, for a new one when `notify`, its athlete told.
async fn import_activity(
    w: &Worker,
    c: &Connection,
    token: &str,
    strava_id: i64,
    notify: bool,
) -> Result<(), JobError> {
    let client = &w
        .strava
        .as_ref()
        .ok_or_else(|| JobError::permanent("strava not configured"))?
        .client;
    let a = match client.activity(token, strava_id).await {
        Ok(a) => a,
        // Deleted or made inaccessible in between: nothing to import.
        Err(StravaError::Rejected(404, _)) => return Ok(()),
        Err(err) => return fail_connection(w, c, strava_err(err)).await,
    };
    let mut tx = w.db.begin().await?;
    if let Some(m) = map_activity(&a) {
        let before = providers::started_at(&mut *tx, c.user_id, "strava", &m.external_id).await?;
        let (mut from, mut to) = matching::days_around(m.started_at);
        if let Some(b) = before {
            let (f, t) = matching::days_around(b);
            (from, to) = (from.min(f), to.max(t));
        }
        let body = synced_body(&m);
        let (id, inserted) =
            providers::upsert_activity(&mut *tx, c.user_id, "strava", &to_new(m)).await?;
        matching::enqueue(&mut *tx, c.user_id, from, to).await?;
        jobs::enqueue(
            &mut *tx,
            STRAVA_STREAMS,
            &json!({ "connection_id": c.id, "activity_id": id, "strava_id": strava_id }),
            None,
        )
        .await?;
        if notify && inserted {
            notifications::create(
                &mut tx,
                notifications::New {
                    user_id: c.user_id,
                    club_id: None,
                    kind: "activity_synced",
                    title: "Atividade sincronizada",
                    body: Some(&body),
                    link: &format!("/activities/{id}"),
                },
            )
            .await?;
        }
    }
    providers::mark_synced(&mut *tx, c.id, true).await?;
    tx.commit().await?;
    Ok(())
}

/// The live connection a job names, or None when it's gone (a job queued before a disconnect does nothing).
async fn live_connection(w: &Worker, payload: &Value) -> Result<Option<Connection>, JobError> {
    let id = payload["connection_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| JobError::permanent("bad payload"))?;
    Ok(providers::connection_by_id(&w.db, id)
        .await?
        .filter(|c| c.status != "revoked"))
}

/// `strava.activity`: an activity a sync listed, fetched in detail (no notification: it isn't new to the athlete).
pub(crate) async fn activity(w: &Worker, payload: &Value) -> Result<(), JobError> {
    let strava_id = payload["strava_id"]
        .as_i64()
        .ok_or_else(|| JobError::permanent("bad payload"))?;
    let Some(c) = live_connection(w, payload).await? else {
        return Ok(());
    };
    let token = match access_token(w, &c).await {
        Ok(t) => t,
        Err(e) => return fail_connection(w, &c, e).await,
    };
    import_activity(w, &c, &token, strava_id, false).await
}

/// `strava.streams`: an activity's time series, sampled and stored (D-055). Activities without them (entered by hand
/// on Strava) have nothing to keep; only a refused token marks the connection broken.
pub(crate) async fn streams(w: &Worker, payload: &Value) -> Result<(), JobError> {
    let (Some(strava_id), Some(activity_id)) = (
        payload["strava_id"].as_i64(),
        payload["activity_id"]
            .as_str()
            .and_then(|s| Uuid::parse_str(s).ok()),
    ) else {
        return Err(JobError::permanent("bad payload"));
    };
    let Some(c) = live_connection(w, payload).await? else {
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
    let raw = match client.streams(&token, strava_id).await {
        Ok(s) => s,
        Err(StravaError::Rejected(401 | 403, m)) => {
            return fail_connection(w, &c, strava_err(StravaError::Rejected(401, m))).await;
        }
        Err(StravaError::Rejected(..)) => return Ok(()),
        Err(e) => return Err(strava_err(e)),
    };
    if let Some(data) = map_streams(&raw) {
        providers::upsert_streams(&w.db, activity_id, &data).await?;
    }
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
        (Some("activity"), Some(aspect @ ("create" | "update"))) => {
            let token = match access_token(w, &c).await {
                Ok(t) => t,
                Err(err) => return fail_connection(w, &c, err).await,
            };
            let id = e["object_id"].as_i64().unwrap_or_default();
            import_activity(w, &c, &token, id, aspect == "create").await
        }
        _ => Ok(()),
    }
}
