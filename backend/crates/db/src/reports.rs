//! Reports (W16): training compliance and volume per student and per week, aggregated in SQL. Shapes mirror
//! api/mock/routes/reports.mjs; the route turns the counts into percentages.

use chrono::NaiveDate;
use serde_json::Value;
use sqlx::PgExecutor;
use uuid::Uuid;

/// The period, `today` (compliance only counts past days), the club's timezone (activity dates).
pub struct Period<'a> {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub today: NaiveDate,
    pub timezone: &'a str,
}

/// One active student over the period. `past`/`points2` feed the compliance score (completed = 2, partial = 1);
/// activity volume is `None` unless the student shares training data with the club.
pub struct AthleteRow {
    pub membership_id: Uuid,
    pub user: Value,
    pub group_ids: Value,
    pub planned: i64,
    pub done: i64,
    pub partial: i64,
    pub missed: i64,
    pub past: i64,
    pub points2: i64,
    pub planned_s: i64,
    pub shares_data: bool,
    pub activities: Option<i64>,
    pub done_s: Option<i64>,
    pub distance_m: Option<i64>,
}

pub async fn athletes(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    group_id: Option<Uuid>,
    p: &Period<'_>,
) -> sqlx::Result<Vec<AthleteRow>> {
    sqlx::query_as!(
        AthleteRow,
        r#"SELECT m.id AS "membership_id!", user_json(u) AS "user!",
                  coalesce((SELECT jsonb_agg(g.group_id ORDER BY g.added_at) FROM group_members g WHERE g.membership_id = m.id), '[]') AS "group_ids!",
                  w.planned AS "planned!", w.done AS "done!", w.partial AS "partial!", w.missed AS "missed!",
                  w.past AS "past!", w.points2 AS "points2!", w.planned_s AS "planned_s!",
                  s.shares AS "shares_data!",
                  CASE WHEN s.shares THEN a.n END AS activities,
                  CASE WHEN s.shares THEN a.secs END AS done_s,
                  CASE WHEN s.shares THEN a.meters END AS distance_m
             FROM memberships m
             JOIN users u ON u.id = m.user_id
             CROSS JOIN LATERAL (
               SELECT count(*) AS planned,
                      count(*) FILTER (WHERE c.status = 'completed') AS done,
                      count(*) FILTER (WHERE c.status = 'partial') AS partial,
                      count(*) FILTER (WHERE pw.date < $5 AND (c.status IS NULL OR c.status IN ('missed', 'skipped'))) AS missed,
                      count(*) FILTER (WHERE pw.date < $5) AS past,
                      coalesce(sum(CASE WHEN pw.date >= $5 THEN 0 WHEN c.status = 'completed' THEN 2 WHEN c.status = 'partial' THEN 1 ELSE 0 END), 0)::bigint AS points2,
                      coalesce(sum(pw.est_duration_s), 0)::bigint AS planned_s
                 FROM planned_workouts pw
                 LEFT JOIN workout_completions c ON c.planned_workout_id = pw.id
                WHERE pw.athlete_membership_id = m.id AND pw.date BETWEEN $3 AND $4) w
             CROSS JOIN LATERAL (
               SELECT EXISTS (SELECT 1 FROM consents k WHERE k.user_id = m.user_id AND k.club_id = m.club_id
                                 AND k.kind = 'share_training_data' AND k.revoked_at IS NULL) AS shares) s
             CROSS JOIN LATERAL (
               SELECT count(*) AS n, coalesce(sum(x.duration_s), 0)::bigint AS secs, coalesce(sum(x.distance_m), 0)::bigint AS meters
                 FROM activities x
                WHERE x.user_id = m.user_id AND (x.started_at AT TIME ZONE $6)::date BETWEEN $3 AND $4
                  -- A synced activity counts only when its provider is shared with the club too (D-011).
                  AND (x.source NOT IN ('strava', 'garmin')
                       OR EXISTS (SELECT 1 FROM consents k WHERE k.user_id = m.user_id AND k.club_id = m.club_id
                                     AND k.kind = 'share_' || x.source AND k.revoked_at IS NULL))) a
            WHERE m.club_id = $1 AND m.role = 'student' AND m.status = 'active'
              AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM group_members g WHERE g.group_id = $2 AND g.membership_id = m.id))
            ORDER BY u.name, m.id"#,
        club_id,
        group_id,
        p.from,
        p.to,
        p.today,
        p.timezone
    )
    .fetch_all(db)
    .await
}

/// Planned workouts per week (Monday) for the same students: `done` counts completed and partial.
pub struct WeekRow {
    pub week_start: NaiveDate,
    pub planned: i64,
    pub done: i64,
    pub past: i64,
    pub points2: i64,
}

pub async fn weeks(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    group_id: Option<Uuid>,
    p: &Period<'_>,
) -> sqlx::Result<Vec<WeekRow>> {
    sqlx::query_as!(
        WeekRow,
        r#"SELECT date_trunc('week', pw.date)::date AS "week_start!",
                  count(*) AS "planned!",
                  count(*) FILTER (WHERE c.status IN ('completed', 'partial')) AS "done!",
                  count(*) FILTER (WHERE pw.date < $5) AS "past!",
                  coalesce(sum(CASE WHEN pw.date >= $5 THEN 0 WHEN c.status = 'completed' THEN 2 WHEN c.status = 'partial' THEN 1 ELSE 0 END), 0)::bigint AS "points2!"
             FROM planned_workouts pw
             JOIN memberships m ON m.id = pw.athlete_membership_id
             LEFT JOIN workout_completions c ON c.planned_workout_id = pw.id
            WHERE m.club_id = $1 AND m.role = 'student' AND m.status = 'active'
              AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM group_members g WHERE g.group_id = $2 AND g.membership_id = m.id))
              AND pw.date BETWEEN $3 AND $4
            GROUP BY 1 ORDER BY 1"#,
        club_id,
        group_id,
        p.from,
        p.to,
        p.today
    )
    .fetch_all(db)
    .await
}
