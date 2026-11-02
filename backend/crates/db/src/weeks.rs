//! Week release (D-031): which weeks the club released to its students, and the drafts still hidden from them.
//! Visibility itself is the SQL function `workout_released` (api/schema.sql), used by every student-facing read.

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

pub struct Release {
    /// `None` = released to everyone in the club.
    pub athlete_membership_id: Option<Uuid>,
    pub released_at: DateTime<Utc>,
}

pub async fn releases(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    week_start: NaiveDate,
) -> sqlx::Result<Vec<Release>> {
    sqlx::query_as!(
        Release,
        "SELECT athlete_membership_id, released_at FROM week_releases WHERE club_id = $1 AND week_start = $2
          ORDER BY released_at",
        club_id,
        week_start
    )
    .fetch_all(db)
    .await
}

/// Students whose workouts that week are still drafts, with how many each (for the release notification).
pub async fn hidden(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    week_start: NaiveDate,
) -> sqlx::Result<Vec<(Uuid, i64)>> {
    let rows = sqlx::query!(
        r#"SELECT p.athlete_membership_id, count(*) AS "n!"
             FROM planned_workouts p
            WHERE p.club_id = $1 AND p.date BETWEEN $2 AND $2 + 6
              AND NOT coalesce(workout_released(p.club_id, p.athlete_membership_id, p.date), false)
            GROUP BY 1"#,
        club_id,
        week_start
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.athlete_membership_id, r.n))
        .collect())
}

/// Release a week to everyone (`athletes` empty) or to some students. Existing releases are kept.
pub async fn release(
    db: &mut PgConnection,
    club_id: Uuid,
    week_start: NaiveDate,
    athletes: &[Uuid],
    by: Option<Uuid>,
) -> sqlx::Result<()> {
    if athletes.is_empty() {
        sqlx::query!(
            "INSERT INTO week_releases (club_id, week_start, released_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            club_id,
            week_start,
            by
        )
        .execute(&mut *db)
        .await?;
    } else {
        sqlx::query!(
            "INSERT INTO week_releases (club_id, week_start, athlete_membership_id, released_by)
             SELECT $1, $2, a, $4 FROM unnest($3::uuid[]) AS a ON CONFLICT DO NOTHING",
            club_id,
            week_start,
            athletes,
            by
        )
        .execute(&mut *db)
        .await?;
    }
    Ok(())
}

/// Undo every release of a week.
pub async fn unrelease(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    week_start: NaiveDate,
) -> sqlx::Result<()> {
    sqlx::query!(
        "DELETE FROM week_releases WHERE club_id = $1 AND week_start = $2",
        club_id,
        week_start
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Switching to `weekly`: release every future week that already has workouts, so nothing students saw disappears.
pub async fn release_planned_future(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO week_releases (club_id, week_start)
         SELECT DISTINCT p.club_id, date_trunc('week', p.date::timestamp)::date
           FROM planned_workouts p JOIN clubs c ON c.id = p.club_id
          WHERE p.club_id = $1 AND date_trunc('week', p.date::timestamp) > date_trunc('week', now() AT TIME ZONE c.timezone)
         ON CONFLICT DO NOTHING",
        club_id
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Of these weeks, the ones released to the student (to everyone or to them).
pub async fn released_for(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    athlete: Uuid,
    weeks: &[NaiveDate],
) -> sqlx::Result<Vec<NaiveDate>> {
    sqlx::query_scalar!(
        "SELECT DISTINCT week_start FROM week_releases
          WHERE club_id = $1 AND week_start = ANY($3) AND (athlete_membership_id IS NULL OR athlete_membership_id = $2)",
        club_id,
        athlete,
        weeks
    )
    .fetch_all(db)
    .await
}

/// A club whose next week is released automatically.
pub struct AutoRelease {
    pub club_id: Uuid,
    pub timezone: String,
    pub weekday: i16,
    pub time: NaiveTime,
}

pub async fn auto_release_clubs(db: impl PgExecutor<'_>) -> sqlx::Result<Vec<AutoRelease>> {
    sqlx::query_as!(
        AutoRelease,
        r#"SELECT id AS club_id, timezone, auto_release_weekday AS "weekday!", auto_release_time AS "time!"
             FROM clubs
            WHERE deleted_at IS NULL AND release_mode = 'weekly'
              AND auto_release_weekday IS NOT NULL AND auto_release_time IS NOT NULL"#
    )
    .fetch_all(db)
    .await
}

/// Whether the week was already released to everyone (the automatic release then has nothing to do).
pub async fn released_to_all(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    week_start: NaiveDate,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM week_releases WHERE club_id = $1 AND week_start = $2 AND athlete_membership_id IS NULL) AS "x!""#,
        club_id,
        week_start
    )
    .fetch_one(db)
    .await
}
