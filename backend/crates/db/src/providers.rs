//! Provider connections (Strava now, Garmin later), synced and manual activities, webhook events (D-011).

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::models::Activity;

pub struct Connection {
    pub id: Uuid,
    pub user_id: Uuid,
    pub provider: String,
    pub external_user_id: String,
    pub athlete_name: Option<String>,
    pub access_token_enc: Option<Vec<u8>>,
    pub refresh_token_enc: Option<Vec<u8>>,
    pub scopes: Vec<String>,
    pub token_expires_at: Option<DateTime<Utc>>,
    pub status: String,
    pub connected_at: DateTime<Utc>,
    pub last_sync_at: Option<DateTime<Utc>>,
}

impl Connection {
    /// What the apps see (never the tokens).
    pub fn public(&self) -> Value {
        serde_json::json!({ "id": self.id, "provider": self.provider, "athlete_name": self.athlete_name, "status": self.status,
                            "connected_at": self.connected_at, "last_sync_at": self.last_sync_at })
    }
}

pub async fn connection(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    provider: &str,
) -> sqlx::Result<Option<Connection>> {
    sqlx::query_as!(
        Connection,
        "SELECT id, user_id, provider, external_user_id, athlete_name, access_token_enc, refresh_token_enc, scopes, token_expires_at, status, connected_at, last_sync_at
           FROM provider_connections WHERE user_id = $1 AND provider = $2",
        user_id,
        provider
    )
    .fetch_optional(db)
    .await
}

pub async fn connection_by_id(
    db: impl PgExecutor<'_>,
    id: Uuid,
) -> sqlx::Result<Option<Connection>> {
    sqlx::query_as!(
        Connection,
        "SELECT id, user_id, provider, external_user_id, athlete_name, access_token_enc, refresh_token_enc, scopes, token_expires_at, status, connected_at, last_sync_at
           FROM provider_connections WHERE id = $1",
        id
    )
    .fetch_optional(db)
    .await
}

pub async fn connection_by_external(
    db: impl PgExecutor<'_>,
    provider: &str,
    external_user_id: &str,
) -> sqlx::Result<Option<Connection>> {
    sqlx::query_as!(
        Connection,
        "SELECT id, user_id, provider, external_user_id, athlete_name, access_token_enc, refresh_token_enc, scopes, token_expires_at, status, connected_at, last_sync_at
           FROM provider_connections WHERE provider = $1 AND external_user_id = $2",
        provider,
        external_user_id
    )
    .fetch_optional(db)
    .await
}

pub struct NewConnection<'a> {
    pub user_id: Uuid,
    pub provider: &'a str,
    pub external_user_id: &'a str,
    pub athlete_name: Option<&'a str>,
    pub access_token_enc: &'a [u8],
    pub refresh_token_enc: &'a [u8],
    pub scopes: &'a [String],
    pub token_expires_at: DateTime<Utc>,
}

/// Connect (or reconnect). A provider account already linked to another person → unique violation.
pub async fn upsert_connection(
    db: impl PgExecutor<'_>,
    c: NewConnection<'_>,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO provider_connections (id, user_id, provider, external_user_id, athlete_name, access_token_enc, refresh_token_enc, scopes, token_expires_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
         ON CONFLICT (user_id, provider) DO UPDATE SET external_user_id = $4, athlete_name = $5, access_token_enc = $6, refresh_token_enc = $7,
                scopes = $8, token_expires_at = $9, status = 'active', connected_at = now()
         RETURNING id",
        Uuid::now_v7(),
        c.user_id,
        c.provider,
        c.external_user_id,
        c.athlete_name,
        c.access_token_enc,
        c.refresh_token_enc,
        c.scopes,
        c.token_expires_at
    )
    .fetch_one(db)
    .await
}

pub async fn update_tokens(
    db: impl PgExecutor<'_>,
    id: Uuid,
    access: &[u8],
    refresh: &[u8],
    expires: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query!("UPDATE provider_connections SET access_token_enc = $2, refresh_token_enc = $3, token_expires_at = $4 WHERE id = $1", id, access, refresh, expires)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn mark_synced(db: impl PgExecutor<'_>, id: Uuid, ok: bool) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE provider_connections SET last_sync_at = CASE WHEN $2 THEN now() ELSE last_sync_at END,
                status = CASE WHEN $2 THEN 'active' ELSE 'error' END WHERE id = $1 AND status <> 'revoked'",
        id,
        ok
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Disconnect (§5): status revoked, tokens wiped, that provider's activities deleted (completions keep the
/// student's own feedback), and the matching sharing consents revoked.
pub async fn revoke(tx: &mut PgConnection, user_id: Uuid, provider: &str) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE provider_connections SET status = 'revoked', access_token_enc = NULL, refresh_token_enc = NULL WHERE user_id = $1 AND provider = $2",
        user_id,
        provider
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "DELETE FROM activities WHERE user_id = $1 AND source = $2",
        user_id,
        provider
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE consents SET revoked_at = now() WHERE user_id = $1 AND kind = 'share_' || $2 AND revoked_at IS NULL",
        user_id,
        provider
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

pub struct NewActivity {
    pub external_id: Option<String>,
    pub sport: String,
    pub name: String,
    pub started_at: DateTime<Utc>,
    pub duration_s: i32,
    pub moving_time_s: Option<i32>,
    pub distance_m: Option<i32>,
    pub elevation_gain_m: Option<i32>,
    pub avg_hr: Option<i32>,
    pub max_hr: Option<i32>,
    pub avg_pace_s_per_km: Option<i32>,
    pub avg_power_w: Option<i32>,
    pub calories: Option<i32>,
    pub laps: Option<Value>,
    pub polyline: Option<String>,
}

/// Insert or update a synced activity (by source + external id).
pub async fn upsert_activity(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    source: &str,
    a: &NewActivity,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO activities (id, user_id, source, external_id, sport, name, started_at, duration_s, moving_time_s, distance_m, elevation_gain_m,
                                 avg_hr, max_hr, avg_pace_s_per_km, avg_power_w, calories, laps, polyline)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (source, external_id) DO UPDATE SET sport = $5, name = $6, started_at = $7, duration_s = $8, moving_time_s = $9,
                distance_m = $10, elevation_gain_m = $11, avg_hr = $12, max_hr = $13, avg_pace_s_per_km = $14, avg_power_w = $15,
                calories = coalesce($16, activities.calories), laps = coalesce($17, activities.laps), polyline = coalesce($18, activities.polyline)
          WHERE activities.user_id = $2
         RETURNING id",
        Uuid::now_v7(),
        user_id,
        source,
        a.external_id,
        a.sport,
        a.name,
        a.started_at,
        a.duration_s,
        a.moving_time_s,
        a.distance_m,
        a.elevation_gain_m,
        a.avg_hr,
        a.max_hr,
        a.avg_pace_s_per_km,
        a.avg_power_w,
        a.calories,
        a.laps,
        a.polyline
    )
    .fetch_one(db)
    .await
}

pub async fn delete_external(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    source: &str,
    external_id: &str,
) -> sqlx::Result<()> {
    sqlx::query!(
        "DELETE FROM activities WHERE user_id = $1 AND source = $2 AND external_id = $3",
        user_id,
        source,
        external_id
    )
    .execute(db)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------------------------ my activities

/// Newest first, each with `matched_workout`. `from`/`to` are UTC days of `started_at`.
pub async fn my_activities(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    limit: i64,
    offset: i64,
    only: Option<Uuid>,
) -> sqlx::Result<Vec<(Activity, Option<Value>)>> {
    let rows = sqlx::query!(
        r#"SELECT a.id, a.user_id, a.source, a.external_id, a.sport, a.name, a.started_at, a.duration_s, a.moving_time_s, a.distance_m, a.elevation_gain_m,
                  a.avg_hr, a.max_hr, a.avg_pace_s_per_km, a.avg_power_w, a.calories, a.laps, a.polyline, a.created_at,
                  (SELECT jsonb_build_object('id', p.id, 'title', p.title, 'date', p.date, 'club_id', p.club_id, 'compliance_pct', c.compliance_pct,
                                             'est_distance_m', p.est_distance_m, 'est_duration_s', p.est_duration_s)
                     FROM workout_completions c JOIN planned_workouts p ON p.id = c.planned_workout_id WHERE c.activity_id = a.id LIMIT 1) AS matched
             FROM activities a
            WHERE a.user_id = $1 AND ($2::date IS NULL OR a.started_at::date >= $2) AND ($3::date IS NULL OR a.started_at::date <= $3)
              AND ($6::uuid IS NULL OR a.id = $6)
            ORDER BY a.started_at DESC LIMIT $4 OFFSET $5"#,
        user_id,
        from,
        to,
        limit,
        offset,
        only
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                Activity {
                    id: r.id,
                    user_id: r.user_id,
                    source: r.source,
                    external_id: r.external_id,
                    sport: r.sport,
                    name: r.name,
                    started_at: r.started_at,
                    duration_s: r.duration_s,
                    moving_time_s: r.moving_time_s,
                    distance_m: r.distance_m,
                    elevation_gain_m: r.elevation_gain_m,
                    avg_hr: r.avg_hr,
                    max_hr: r.max_hr,
                    avg_pace_s_per_km: r.avg_pace_s_per_km,
                    avg_power_w: r.avg_power_w,
                    calories: r.calories,
                    laps: r.laps,
                    polyline: r.polyline,
                    created_at: r.created_at,
                },
                r.matched,
            )
        })
        .collect())
}

pub async fn delete_activity(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("DELETE FROM activities WHERE id = $1", id)
        .execute(db)
        .await?;
    Ok(())
}

// ------------------------------------------------------------------------------------ webhooks

/// Record an incoming event once (`external_id` de-duplicates retries). `None` if seen before.
pub async fn record_event(
    db: impl PgExecutor<'_>,
    provider: &str,
    external_id: &str,
    payload: &Value,
) -> sqlx::Result<Option<i64>> {
    sqlx::query_scalar!(
        "INSERT INTO webhook_events (provider, external_id, payload) VALUES ($1, $2, $3) ON CONFLICT (provider, external_id) DO NOTHING RETURNING id",
        provider,
        external_id,
        payload
    )
    .fetch_optional(db)
    .await
}

pub async fn event(db: impl PgExecutor<'_>, id: i64) -> sqlx::Result<Option<Value>> {
    sqlx::query_scalar!("SELECT payload FROM webhook_events WHERE id = $1", id)
        .fetch_optional(db)
        .await
}

pub async fn event_done(db: impl PgExecutor<'_>, id: i64, error: Option<&str>) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE webhook_events SET processed_at = now(), error = $2 WHERE id = $1",
        id,
        error
    )
    .execute(db)
    .await?;
    Ok(())
}
