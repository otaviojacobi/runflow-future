//! Planned workouts (W4, W3, M1–M3), completions, notifications for students.

use chrono::NaiveDate;
use serde_json::Value;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::models::{Activity, Completion, Workout};

/// Which workouts: a date range, optionally one athlete, one group's members, or a single workout.
pub struct Filter {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub athlete: Option<Uuid>,
    pub group: Option<Uuid>,
    pub only: Option<Uuid>,
    /// Include drafts (staff); students only ever get what was released to them (D-031).
    pub drafts: bool,
}

/// Workouts with completion and thread counters for `viewer` (a membership id) and whether the student sees them.
pub async fn list(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    viewer: Uuid,
    f: Filter,
) -> sqlx::Result<Vec<Workout>> {
    let rows = sqlx::query!(
        r#"SELECT p.id, p.club_id, p.athlete_membership_id, p.date, p.position, p.sport, p.title, p.structure, p.notes,
                  p.est_duration_s, p.est_distance_m, p.template_id, p.plan_assignment_id, p.created_by, p.created_at, p.updated_at,
                  c.planned_workout_id AS "c_id?", c.activity_id AS c_activity_id, c.status AS "c_status?", c.compliance_pct AS c_compliance_pct,
                  c.rpe AS c_rpe, c.feeling AS c_feeling, c.comment AS c_comment, c.completed_at AS "c_completed_at?", c.updated_at AS "c_updated_at?",
                  (SELECT count(*) FROM comments x WHERE x.planned_workout_id = p.id AND x.deleted_at IS NULL) AS "comments_count!",
                  (SELECT count(*) FROM comments x
                     LEFT JOIN thread_reads r ON r.membership_id = $2 AND r.planned_workout_id = p.id
                    WHERE x.planned_workout_id = p.id AND x.deleted_at IS NULL AND x.author_membership_id <> $2
                      AND (r.last_read_at IS NULL OR x.created_at > r.last_read_at)) AS "unread_count!",
                  coalesce(workout_released(p.club_id, p.athlete_membership_id, p.date), false) AS "visible!"
             FROM planned_workouts p LEFT JOIN workout_completions c ON c.planned_workout_id = p.id
            WHERE p.club_id = $1 AND p.date BETWEEN $3 AND $4
              AND ($5::uuid IS NULL OR p.athlete_membership_id = $5)
              AND ($6::uuid IS NULL OR p.athlete_membership_id IN (SELECT membership_id FROM group_members WHERE group_id = $6))
              AND ($7::uuid IS NULL OR p.id = $7)
              AND ($8 OR coalesce(workout_released(p.club_id, p.athlete_membership_id, p.date), false))
            ORDER BY p.date, p.position, p.created_at"#,
        club_id,
        viewer,
        f.from,
        f.to,
        f.athlete,
        f.group,
        f.only,
        f.drafts
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Workout {
            completion: r.c_id.map(|id| Completion {
                planned_workout_id: id,
                activity_id: r.c_activity_id,
                status: r.c_status.unwrap_or_default(),
                compliance_pct: r.c_compliance_pct,
                rpe: r.c_rpe,
                feeling: r.c_feeling,
                comment: r.c_comment,
                completed_at: r.c_completed_at.unwrap_or_default(),
                updated_at: r.c_updated_at.unwrap_or_default(),
            }),
            id: r.id,
            club_id: r.club_id,
            athlete_membership_id: r.athlete_membership_id,
            date: r.date,
            position: r.position,
            sport: r.sport,
            title: r.title,
            structure: r.structure,
            notes: r.notes,
            est_duration_s: r.est_duration_s,
            est_distance_m: r.est_distance_m,
            template_id: r.template_id,
            plan_assignment_id: r.plan_assignment_id,
            created_by: r.created_by,
            created_at: r.created_at,
            updated_at: r.updated_at,
            comments_count: r.comments_count,
            unread_count: r.unread_count,
            visible: r.visible,
        })
        .collect())
}

/// One workout of the club (any date), for `viewer`.
pub async fn one(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    viewer: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Workout>> {
    // Any date Postgres can hold (NaiveDate::MIN/MAX are outside its range).
    let (from, to) = (
        NaiveDate::from_ymd_opt(1900, 1, 1).unwrap_or_default(),
        NaiveDate::from_ymd_opt(9999, 12, 31).unwrap_or_default(),
    );
    Ok(list(
        db,
        club_id,
        viewer,
        Filter {
            from,
            to,
            athlete: None,
            group: None,
            only: Some(id),
            drafts: true,
        },
    )
    .await?
    .pop())
}

/// Active students of the club among `ids` (plus a group's members), de-duplicated.
pub async fn active_students(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    ids: &[Uuid],
    group: Option<Uuid>,
) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!(
        "SELECT m.id FROM memberships m
          WHERE m.club_id = $1 AND m.role = 'student' AND m.status = 'active'
            AND (m.id = ANY($2) OR m.id IN (SELECT membership_id FROM group_members WHERE group_id = $3))
          ORDER BY m.joined_at",
        club_id,
        ids,
        group
    )
    .fetch_all(db)
    .await
}

pub async fn all_active_students(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!(
        "SELECT id FROM memberships WHERE club_id = $1 AND role = 'student' AND status = 'active'",
        club_id
    )
    .fetch_all(db)
    .await
}

pub struct Content<'a> {
    pub sport: &'a str,
    pub title: &'a str,
    pub structure: &'a Value,
    pub notes: Option<&'a str>,
    pub est_duration_s: Option<i32>,
    pub est_distance_m: Option<i32>,
    pub template_id: Option<Uuid>,
    pub plan_assignment_id: Option<Uuid>,
}

/// Add a workout at the end of that athlete's day.
pub async fn insert(
    tx: &mut PgConnection,
    club_id: Uuid,
    athlete: Uuid,
    date: NaiveDate,
    c: &Content<'_>,
    created_by: Uuid,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO planned_workouts (id, club_id, athlete_membership_id, date, position, sport, title, structure, notes,
                                       est_duration_s, est_distance_m, template_id, plan_assignment_id, created_by)
         VALUES ($1, $2, $3, $4, (SELECT count(*)::int FROM planned_workouts WHERE athlete_membership_id = $3 AND date = $4),
                 $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id",
        Uuid::now_v7(),
        club_id,
        athlete,
        date,
        c.sport,
        c.title,
        c.structure,
        c.notes,
        c.est_duration_s,
        c.est_distance_m,
        c.template_id,
        c.plan_assignment_id,
        created_by
    )
    .fetch_one(&mut *tx)
    .await
}

#[derive(Default)]
pub struct Patch {
    pub date: Option<NaiveDate>,
    pub sport: Option<String>,
    pub title: Option<String>,
    pub structure: Option<Value>,
    pub notes: Option<Option<String>>,
    pub est_duration_s: Option<Option<i32>>,
    pub est_distance_m: Option<Option<i32>>,
    pub position: Option<i32>,
}

pub async fn update(db: impl PgExecutor<'_>, id: Uuid, p: Patch) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE planned_workouts SET
            date = coalesce($2, date), sport = coalesce($3, sport), title = coalesce($4, title), structure = coalesce($5, structure),
            notes = CASE WHEN $6 THEN $7 ELSE notes END,
            est_duration_s = CASE WHEN $8 THEN $9 ELSE est_duration_s END,
            est_distance_m = CASE WHEN $10 THEN $11 ELSE est_distance_m END,
            position = coalesce($12, position), updated_at = now()
          WHERE id = $1",
        id,
        p.date,
        p.sport,
        p.title,
        p.structure,
        p.notes.is_some(),
        p.notes.flatten(),
        p.est_duration_s.is_some(),
        p.est_duration_s.flatten(),
        p.est_distance_m.is_some(),
        p.est_distance_m.flatten(),
        p.position
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Completion, comments and read marks go with it (foreign keys cascade).
pub async fn delete(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("DELETE FROM planned_workouts WHERE id = $1", id)
        .execute(db)
        .await?;
    Ok(())
}

/// Copy one week's workouts of `athletes` to another week → how many were created.
pub async fn copy_week(
    tx: &mut PgConnection,
    club_id: Uuid,
    athletes: &[Uuid],
    from_monday: NaiveDate,
    to_monday: NaiveDate,
    by: Uuid,
) -> sqlx::Result<u64> {
    let shift = (to_monday - from_monday).num_days() as i32;
    let r = sqlx::query!(
        "INSERT INTO planned_workouts (id, club_id, athlete_membership_id, date, position, sport, title, structure, notes,
                                       est_duration_s, est_distance_m, template_id, plan_assignment_id, created_by)
         SELECT gen_random_uuid(), club_id, athlete_membership_id, date + $4::int, position, sport, title, structure, notes,
                est_duration_s, est_distance_m, template_id, NULL, $5
           FROM planned_workouts
          WHERE club_id = $1 AND athlete_membership_id = ANY($2) AND date BETWEEN $3::date AND $3::date + 6",
        club_id,
        athletes,
        from_monday,
        shift,
        by
    )
    .execute(&mut *tx)
    .await?;
    Ok(r.rows_affected())
}

/// Who and where, for detail views: `{membership_id, user}`.
pub async fn athlete(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
) -> sqlx::Result<Option<(Uuid, Value)>> {
    let r = sqlx::query!(
        r#"SELECT m.user_id, jsonb_build_object('membership_id', m.id, 'user', jsonb_build_object(
                'id', u.id, 'email', u.email, 'name', u.name, 'avatar_url', u.avatar_url, 'phone', u.phone,
                'birth_date', u.birth_date, 'sex', u.sex, 'locale', u.locale, 'created_at', u.created_at)) AS "athlete!"
             FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.id = $1"#,
        membership_id
    )
    .fetch_optional(db)
    .await?;
    Ok(r.map(|r| (r.user_id, r.athlete)))
}

/// Does this person share their training data with this club (consent `share_training_data`, §5)?
pub async fn shares_training(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    club_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM consents WHERE user_id = $1 AND club_id = $2 AND kind = 'share_training_data' AND revoked_at IS NULL) AS "x!""#,
        user_id,
        club_id
    )
    .fetch_one(db)
    .await
}

pub async fn activity(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Option<Activity>> {
    sqlx::query_as!(
        Activity,
        "SELECT id, user_id, source, external_id, sport, name, started_at, duration_s, moving_time_s, distance_m, elevation_gain_m,
                avg_hr, max_hr, avg_pace_s_per_km, avg_power_w, calories, laps, polyline, created_at
           FROM activities WHERE id = $1",
        id
    )
    .fetch_optional(db)
    .await
}

/// Whether the athlete can already see a workout on that day (D-031: drafts stay silent).
pub async fn released(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    athlete: Uuid,
    date: NaiveDate,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT coalesce(workout_released($1, $2, $3), false) AS "x!""#,
        club_id,
        athlete,
        date
    )
    .fetch_one(db)
    .await
}
