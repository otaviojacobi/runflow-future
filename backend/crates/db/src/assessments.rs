//! Assessments and field tests (W14, W3, M7): records with the server-computed `result`; a test can create zones
//! and update the athlete profile. Shapes mirror api/mock/routes/assessments.mjs.

use chrono::NaiveDate;
use serde_json::Value;
use sqlx::PgExecutor;
use uuid::Uuid;

/// Newest first, each with its `athlete` and the `zones` it created (null when none, or when they're gone).
pub async fn list(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    membership_id: Option<Uuid>,
    kind: Option<&str>,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT to_jsonb(a) || jsonb_build_object(
                  'athlete', jsonb_build_object('membership_id', a.membership_id, 'user', user_json(u)),
                  'zones', to_jsonb(z)) AS "x!"
             FROM assessments a
             JOIN memberships m ON m.id = a.membership_id
             JOIN users u ON u.id = m.user_id
             LEFT JOIN zones z ON z.id = a.zones_id
            WHERE a.club_id = $1 AND ($2::uuid IS NULL OR a.membership_id = $2) AND ($3::text IS NULL OR a.kind = $3)
            ORDER BY a.date DESC, a.created_at DESC"#,
        club_id,
        membership_id,
        kind
    )
    .fetch_all(db)
    .await
}

pub async fn one(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"SELECT to_jsonb(a) || jsonb_build_object(
                  'athlete', jsonb_build_object('membership_id', a.membership_id, 'user', user_json(u)),
                  'zones', to_jsonb(z)) AS "x!"
             FROM assessments a
             JOIN memberships m ON m.id = a.membership_id
             JOIN users u ON u.id = m.user_id
             LEFT JOIN zones z ON z.id = a.zones_id
            WHERE a.id = $1"#,
        id
    )
    .fetch_one(db)
    .await
}

pub struct New<'a> {
    pub club_id: Uuid,
    pub membership_id: Uuid,
    pub kind: &'a str,
    pub date: NaiveDate,
    pub data: &'a Value,
    pub result: &'a Value,
    pub notes: Option<String>,
    pub zones_id: Option<Uuid>,
    pub by: Uuid,
}

pub async fn insert(db: impl PgExecutor<'_>, a: New<'_>) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO assessments (id, club_id, membership_id, kind, date, data, result, notes, zones_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
        Uuid::now_v7(),
        a.club_id,
        a.membership_id,
        a.kind,
        a.date,
        a.data,
        a.result,
        a.notes,
        a.zones_id,
        a.by
    )
    .fetch_one(db)
    .await
}

/// The profile fields a test sets (`None` = unchanged).
#[derive(Default)]
pub struct ProfileFromTest {
    pub threshold_pace_s_per_km: Option<i32>,
    pub css_s_per_100m: Option<i32>,
    pub ftp_w: Option<i32>,
    pub max_hr: Option<i32>,
}

pub async fn apply_profile(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
    p: ProfileFromTest,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO athlete_profiles (membership_id, threshold_pace_s_per_km, css_s_per_100m, ftp_w, max_hr)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (membership_id) DO UPDATE SET
           threshold_pace_s_per_km = coalesce($2, athlete_profiles.threshold_pace_s_per_km),
           css_s_per_100m = coalesce($3, athlete_profiles.css_s_per_100m),
           ftp_w = coalesce($4, athlete_profiles.ftp_w),
           max_hr = coalesce($5, athlete_profiles.max_hr),
           updated_at = now()",
        membership_id,
        p.threshold_pace_s_per_km,
        p.css_s_per_100m,
        p.ftp_w,
        p.max_hr
    )
    .execute(db)
    .await?;
    Ok(())
}

/// A body assessment's resting HR goes to an existing profile.
pub async fn set_resting_hr(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
    resting_hr: i32,
) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE athlete_profiles SET resting_hr = $2, updated_at = now() WHERE membership_id = $1",
        membership_id,
        resting_hr
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Delete (the zones it created stay: they may already drive workouts). `false` when it isn't the club's.
pub async fn delete(db: impl PgExecutor<'_>, club_id: Uuid, id: Uuid) -> sqlx::Result<bool> {
    let r = sqlx::query!(
        "DELETE FROM assessments WHERE id = $1 AND club_id = $2",
        id,
        club_id
    )
    .execute(db)
    .await?;
    Ok(r.rows_affected() > 0)
}
