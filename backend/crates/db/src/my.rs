//! The student side (M1–M5): zones, candidate activities, completions, Today's summary; workout threads.

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::models::{Activity, Completion};

/// Latest zone bounds per kind (`pace`, `hr`, `swim_pace`, `power`) for a membership: `[{zone, min, max}]`.
pub async fn latest_zones(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
) -> sqlx::Result<Vec<(String, Value)>> {
    let rows = sqlx::query!(
        "SELECT DISTINCT ON (kind) kind, bounds FROM zones WHERE membership_id = $1 ORDER BY kind, valid_from DESC, created_at DESC",
        membership_id
    )
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|r| (r.kind, r.bounds)).collect())
}

/// The person's activities started within `[from, to]` (club-local days).
pub async fn activities_between(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    timezone: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> sqlx::Result<Vec<Activity>> {
    sqlx::query_as!(
        Activity,
        "SELECT id, user_id, source, external_id, sport, name, started_at, duration_s, moving_time_s, distance_m, elevation_gain_m,
                avg_hr, max_hr, avg_pace_s_per_km, avg_power_w, calories, laps, polyline, match_state, created_at
           FROM activities WHERE user_id = $1 AND (started_at AT TIME ZONE $2)::date BETWEEN $3 AND $4
          ORDER BY started_at",
        user_id,
        timezone,
        from,
        to
    )
    .fetch_all(db)
    .await
}

pub async fn last_activity(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
) -> sqlx::Result<Option<Activity>> {
    sqlx::query_as!(
        Activity,
        "SELECT id, user_id, source, external_id, sport, name, started_at, duration_s, moving_time_s, distance_m, elevation_gain_m,
                avg_hr, max_hr, avg_pace_s_per_km, avg_power_w, calories, laps, polyline, match_state, created_at
           FROM activities WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1",
        user_id
    )
    .fetch_optional(db)
    .await
}

pub struct CompletionInput<'a> {
    pub activity_id: Option<Uuid>,
    /// Who linked the activity (`auto` | `student`), none without one.
    pub matched_by: Option<&'a str>,
    pub status: &'a str,
    pub compliance_pct: i32,
    pub rpe: Option<i32>,
    pub feeling: Option<&'a str>,
    pub comment: Option<&'a str>,
}

/// The student's report: create or replace the completion; `reported_at` is set the first time.
pub async fn upsert_completion(
    tx: &mut PgConnection,
    workout_id: Uuid,
    c: CompletionInput<'_>,
) -> sqlx::Result<Completion> {
    sqlx::query_as!(
        Completion,
        r#"INSERT INTO workout_completions (planned_workout_id, activity_id, matched_by, status, compliance_pct, rpe, feeling, comment, reported_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (planned_workout_id) DO UPDATE SET activity_id = $2, matched_by = $3, status = $4, compliance_pct = $5, rpe = $6,
                  feeling = $7, comment = $8, reported_at = coalesce(workout_completions.reported_at, now()), updated_at = now()
           RETURNING planned_workout_id, activity_id, status, compliance_pct, rpe, feeling, comment, matched_by, reported_at,
                     completed_at, updated_at"#,
        workout_id,
        c.activity_id,
        c.matched_by,
        c.status,
        c.compliance_pct,
        c.rpe,
        c.feeling,
        c.comment
    )
    .fetch_one(&mut *tx)
    .await
}

/// Planned workouts per week (Monday) with how many were done (completed/partial), for one athlete.
pub async fn weeks_done(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> sqlx::Result<Vec<(NaiveDate, i64, i64)>> {
    let rows = sqlx::query!(
        r#"SELECT date_trunc('week', p.date)::date AS "week!", count(*) AS "planned!",
                  count(*) FILTER (WHERE c.status IN ('completed', 'partial')) AS "done!"
             FROM planned_workouts p LEFT JOIN workout_completions c ON c.planned_workout_id = p.id
            WHERE p.athlete_membership_id = $1 AND p.date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1"#,
        membership_id,
        from,
        to
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.week, r.planned, r.done))
        .collect())
}

// ------------------------------------------------------------------------------------ threads

/// One comment with its author (`{membership_id, role, user}`).
pub struct CommentRow {
    pub id: Uuid,
    pub planned_workout_id: Uuid,
    pub author_membership_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub author: Value,
    pub author_role: String,
}

pub async fn comments(
    db: impl PgExecutor<'_>,
    workout_ids: &[Uuid],
) -> sqlx::Result<Vec<CommentRow>> {
    sqlx::query_as!(
        CommentRow,
        r#"SELECT c.id, c.planned_workout_id, c.author_membership_id, c.body, c.created_at, c.edited_at, c.deleted_at, m.role AS author_role,
                  jsonb_build_object('membership_id', m.id, 'role', m.role, 'user', jsonb_build_object(
                    'id', u.id, 'email', u.email, 'name', u.name, 'avatar_url', u.avatar_url, 'phone', u.phone,
                    'birth_date', u.birth_date, 'sex', u.sex, 'locale', u.locale, 'created_at', u.created_at)) AS "author!"
             FROM comments c JOIN memberships m ON m.id = c.author_membership_id JOIN users u ON u.id = m.user_id
            WHERE c.planned_workout_id = ANY($1) AND c.deleted_at IS NULL
            ORDER BY c.created_at"#,
        workout_ids
    )
    .fetch_all(db)
    .await
}

pub async fn insert_comment(
    db: impl PgExecutor<'_>,
    workout_id: Uuid,
    author: Uuid,
    body: &str,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO comments (id, planned_workout_id, author_membership_id, body) VALUES ($1, $2, $3, $4) RETURNING id",
        Uuid::now_v7(),
        workout_id,
        author,
        body
    )
    .fetch_one(db)
    .await
}

pub async fn mark_read(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
    workout_ids: &[Uuid],
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO thread_reads (membership_id, planned_workout_id, last_read_at)
         SELECT $1, w, now() FROM unnest($2::uuid[]) AS w
         ON CONFLICT (membership_id, planned_workout_id) DO UPDATE SET last_read_at = now()",
        membership_id,
        workout_ids
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn club_workout_ids(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!(
        "SELECT id FROM planned_workouts WHERE club_id = $1",
        club_id
    )
    .fetch_all(db)
    .await
}

/// Active staff of a club (to notify on a student's comment).
pub async fn staff_memberships(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!(
        "SELECT id FROM memberships WHERE club_id = $1 AND role <> 'student' AND status = 'active'",
        club_id
    )
    .fetch_all(db)
    .await
}
