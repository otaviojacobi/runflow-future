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
    // Workouts those activities completed automatically are open again; the rest is matched anew (D-049).
    let today = Utc::now().date_naive();
    crate::matching::enqueue(&mut *tx, user_id, today - chrono::Duration::days(31), today).await?;
    Ok(())
}

/// The job that tells Strava a connection ended without the person pressing "Desconectar" (an automatic disconnect,
/// [`enforce_sharing`]): `{access_token_enc, refresh_token_enc, token_expires_at}`, the tokens still encrypted (hex).
pub const STRAVA_DEAUTHORIZE: &str = "strava.deauthorize";

/// The worker's job that fetches one Strava activity in detail (D-055): `{connection_id, strava_id}`.
pub const STRAVA_ACTIVITY: &str = "strava.activity";

/// Queue a detailed refetch of the Strava activities from the last `days` days whose connection is live (laps,
/// per-km splits, the full route, then the time series; D-055), two seconds apart for Strava's rate limits → how many.
/// For activities imported before the analysis existed (`runflow strava-refetch`).
pub async fn queue_refetch(db: impl PgExecutor<'_>, days: i32) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"WITH todo AS (
             SELECT c.id AS connection_id, a.external_id, row_number() OVER (ORDER BY a.started_at DESC) AS n
               FROM activities a JOIN provider_connections c ON c.user_id = a.user_id AND c.provider = 'strava' AND c.status <> 'revoked'
              WHERE a.source = 'strava' AND a.external_id ~ '^[0-9]+$' AND a.started_at > now() - make_interval(days => $2)
           ), queued AS (
             INSERT INTO jobs (kind, payload, run_at)
             SELECT $1, jsonb_build_object('connection_id', connection_id, 'strava_id', external_id::bigint),
                    now() + (n - 1) * interval '2 seconds'
               FROM todo
             RETURNING id
           )
           SELECT count(*) AS "n!" FROM queued, pg_notify('runflow_jobs', '') AS wake"#,
        STRAVA_ACTIVITY,
        days
    )
    .fetch_one(db)
    .await
}

/// Hex for the encrypted tokens in a job payload (they stay encrypted at rest there, as in `provider_connections`).
pub fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

/// Connecting Strava shares it with every club where the person is an active student (D-011, endpoints.md § Strava
/// sharing): `share_training_data` and `share_strava`, where missing. Returns the clubs that changed.
pub async fn share_with_student_clubs(
    tx: &mut PgConnection,
    user_id: Uuid,
    text_version: &str,
) -> sqlx::Result<Vec<Uuid>> {
    let mut clubs = sqlx::query_scalar!(
        r#"INSERT INTO consents (user_id, club_id, kind, text_version)
           SELECT $1, m.club_id, k.kind, $2
             FROM memberships m
             JOIN clubs c ON c.id = m.club_id
            CROSS JOIN (VALUES ('share_training_data'), ('share_strava')) AS k(kind)
            WHERE m.user_id = $1 AND m.role = 'student' AND m.status = 'active' AND c.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM consents s WHERE s.user_id = $1 AND s.club_id = m.club_id
                                 AND s.kind = k.kind AND s.revoked_at IS NULL)
           RETURNING club_id AS "club_id!""#,
        user_id,
        text_version
    )
    .fetch_all(&mut *tx)
    .await?;
    clubs.sort();
    clubs.dedup();
    Ok(clubs)
}

/// A club's students who are connected to Strava (their sharing is checked again when the club closes, D-011).
pub async fn connected_students(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!(
        r#"SELECT DISTINCT m.user_id AS "user_id!" FROM memberships m
             JOIN provider_connections c ON c.user_id = m.user_id AND c.provider = 'strava' AND c.status <> 'revoked'
            WHERE m.club_id = $1 AND m.role = 'student'"#,
        club_id
    )
    .fetch_all(db)
    .await
}

/// Whether the person is an active student of a club that isn't closed (only they may connect Strava, D-011).
pub async fn is_student(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM memberships m JOIN clubs c ON c.id = m.club_id
                           WHERE m.user_id = $1 AND m.role = 'student' AND m.status = 'active' AND c.deleted_at IS NULL) AS "x!""#,
        user_id
    )
    .fetch_one(db)
    .await
}

/// No sync without sharing (D-011, endpoints.md § Strava sharing): a person connected to Strava whom no club can see
/// (an active student membership, club not closed, holding both `share_training_data` and `share_strava`) is
/// disconnected as if they had pressed "Desconectar": [`revoke`] in this transaction, and Strava deauthorized by the
/// [`STRAVA_DEAUTHORIZE`] job enqueued in it. Returns whether it disconnected.
pub async fn enforce_sharing(tx: &mut PgConnection, user_id: Uuid) -> sqlx::Result<bool> {
    let Some(c) = sqlx::query!(
        r#"SELECT c.access_token_enc, c.refresh_token_enc, c.token_expires_at,
                  EXISTS (SELECT 1 FROM memberships m JOIN clubs k ON k.id = m.club_id
                           WHERE m.user_id = c.user_id AND m.role = 'student' AND m.status = 'active' AND k.deleted_at IS NULL
                             AND EXISTS (SELECT 1 FROM consents s WHERE s.user_id = m.user_id AND s.club_id = m.club_id
                                            AND s.kind = 'share_training_data' AND s.revoked_at IS NULL)
                             AND EXISTS (SELECT 1 FROM consents s WHERE s.user_id = m.user_id AND s.club_id = m.club_id
                                            AND s.kind = 'share_strava' AND s.revoked_at IS NULL)) AS "visible!"
             FROM provider_connections c
            WHERE c.user_id = $1 AND c.provider = 'strava' AND c.status <> 'revoked'"#,
        user_id
    )
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Ok(false);
    };
    if c.visible {
        return Ok(false);
    }
    revoke(&mut *tx, user_id, "strava").await?;
    if let Some(access) = c.access_token_enc.as_deref() {
        crate::jobs::enqueue(
            &mut *tx,
            STRAVA_DEAUTHORIZE,
            &serde_json::json!({
                "access_token_enc": to_hex(access),
                "refresh_token_enc": c.refresh_token_enc.as_deref().map(to_hex),
                "token_expires_at": c.token_expires_at,
            }),
            None,
        )
        .await?;
    }
    Ok(true)
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
    pub splits: Option<Value>,
    pub polyline: Option<String>,
    pub route_polyline: Option<String>,
}

/// Insert or update a synced activity (by source + external id) → its id and whether it's new. What a list sync
/// doesn't carry (laps, splits, the full route) never erases what a detailed fetch stored.
pub async fn upsert_activity(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    source: &str,
    a: &NewActivity,
) -> sqlx::Result<(Uuid, bool)> {
    let r = sqlx::query!(
        r#"INSERT INTO activities (id, user_id, source, external_id, sport, name, started_at, duration_s, moving_time_s, distance_m, elevation_gain_m,
                                 avg_hr, max_hr, avg_pace_s_per_km, avg_power_w, calories, laps, polyline, splits, route_polyline)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         ON CONFLICT (source, external_id) DO UPDATE SET sport = $5, name = $6, started_at = $7, duration_s = $8, moving_time_s = $9,
                distance_m = $10, elevation_gain_m = $11, avg_hr = $12, max_hr = $13, avg_pace_s_per_km = $14, avg_power_w = $15,
                calories = coalesce($16, activities.calories), laps = coalesce($17, activities.laps), polyline = coalesce($18, activities.polyline),
                splits = coalesce($19, activities.splits), route_polyline = coalesce($20, activities.route_polyline)
          WHERE activities.user_id = $2
         RETURNING id, (xmax = 0) AS "inserted!""#,
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
        a.polyline,
        a.splits,
        a.route_polyline
    )
    .fetch_one(db)
    .await?;
    Ok((r.id, r.inserted))
}

/// Store an activity's sampled time series (D-055), replacing what was there; nothing when it was deleted meanwhile.
pub async fn upsert_streams(
    db: impl PgExecutor<'_>,
    activity_id: Uuid,
    data: &Value,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO activity_streams (activity_id, data) SELECT id, $2 FROM activities WHERE id = $1
         ON CONFLICT (activity_id) DO UPDATE SET data = $2, created_at = now()",
        activity_id,
        data
    )
    .execute(db)
    .await?;
    Ok(())
}

/// What only the detail views need (D-055): `{route_polyline, streams}`, or None when the activity has neither.
pub async fn analysis(db: impl PgExecutor<'_>, activity_id: Uuid) -> sqlx::Result<Option<Value>> {
    let r = sqlx::query!(
        r#"SELECT a.route_polyline, s.data AS "streams?"
             FROM activities a LEFT JOIN activity_streams s ON s.activity_id = a.id WHERE a.id = $1"#,
        activity_id
    )
    .fetch_optional(db)
    .await?;
    Ok(r.and_then(|r| {
        (r.route_polyline.is_some() || r.streams.is_some()).then(
            || serde_json::json!({ "route_polyline": r.route_polyline, "streams": r.streams }),
        )
    }))
}

/// The person's Strava activity with this Strava id, if it was imported.
pub async fn activity_id_by_external(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    source: &str,
    external_id: &str,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar!(
        "SELECT id FROM activities WHERE user_id = $1 AND source = $2 AND external_id = $3",
        user_id,
        source,
        external_id
    )
    .fetch_optional(db)
    .await
}

/// Delete a synced activity → when it had started (to match its days again), if it existed.
pub async fn delete_external(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    source: &str,
    external_id: &str,
) -> sqlx::Result<Option<DateTime<Utc>>> {
    sqlx::query_scalar!(
        "DELETE FROM activities WHERE user_id = $1 AND source = $2 AND external_id = $3 RETURNING started_at",
        user_id,
        source,
        external_id
    )
    .fetch_optional(db)
    .await
}

/// When a synced activity started, if it's already here (an update can move it to another day).
pub async fn started_at(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    source: &str,
    external_id: &str,
) -> sqlx::Result<Option<DateTime<Utc>>> {
    sqlx::query_scalar!(
        "SELECT started_at FROM activities WHERE user_id = $1 AND source = $2 AND external_id = $3",
        user_id,
        source,
        external_id
    )
    .fetch_optional(db)
    .await
}

// ------------------------------------------------------------------------------------ my activities

/// Which of my activities: club-time days `from`/`to` (in `tz`), only the ones waiting for my choice since a day
/// (`pending_since`, D-049), or one.
pub struct MyFilter<'a> {
    pub tz: &'a str,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub pending_since: Option<NaiveDate>,
    pub only: Option<Uuid>,
}

/// Newest first, each with `matched_workout`.
pub async fn my_activities(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    f: MyFilter<'_>,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<(Activity, Option<Value>)>> {
    let rows = sqlx::query!(
        r#"SELECT a.id, a.user_id, a.source, a.external_id, a.sport, a.name, a.started_at, a.duration_s, a.moving_time_s, a.distance_m, a.elevation_gain_m,
                  a.avg_hr, a.max_hr, a.avg_pace_s_per_km, a.avg_power_w, a.calories, a.laps, a.splits, a.polyline, a.match_state, a.created_at,
                  (SELECT jsonb_build_object('id', p.id, 'title', p.title, 'date', p.date, 'club_id', p.club_id, 'compliance_pct', c.compliance_pct,
                                             'est_distance_m', p.est_distance_m, 'est_duration_s', p.est_duration_s, 'matched_by', c.matched_by)
                     FROM workout_completions c JOIN planned_workouts p ON p.id = c.planned_workout_id WHERE c.activity_id = a.id LIMIT 1) AS matched
             FROM activities a
            WHERE a.user_id = $1 AND ($2::date IS NULL OR (a.started_at AT TIME ZONE $7)::date >= $2)
              AND ($3::date IS NULL OR (a.started_at AT TIME ZONE $7)::date <= $3)
              AND ($6::uuid IS NULL OR a.id = $6)
              AND ($8::date IS NULL OR (a.match_state = 'pending' AND (a.started_at AT TIME ZONE $7)::date >= $8))
            ORDER BY a.started_at DESC LIMIT $4 OFFSET $5"#,
        user_id,
        f.from,
        f.to,
        limit,
        offset,
        f.only,
        f.tz,
        f.pending_since
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
                    splits: r.splits,
                    polyline: r.polyline,
                    match_state: r.match_state,
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
