//! What the assistant's rules read (W4, W8, W17): a student's recent compliance and taken days, a period's
//! feedback. Like api/mock/routes/ai.mjs.

use chrono::NaiveDate;
use sqlx::PgExecutor;
use uuid::Uuid;

/// An active student of the club: their name (for the rationale).
pub async fn student_name(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    membership_id: Uuid,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar!(
        "SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.id = $1 AND m.club_id = $2 AND m.role = 'student' AND m.status = 'active'",
        membership_id,
        club_id
    )
    .fetch_optional(db)
    .await
}

/// Completion statuses (`None` = no record) of the student's workouts in `[from, before)`.
pub async fn statuses(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
    from: NaiveDate,
    before: NaiveDate,
) -> sqlx::Result<Vec<Option<String>>> {
    sqlx::query_scalar!(
        r#"SELECT c.status AS "status?" FROM planned_workouts p
             LEFT JOIN workout_completions c ON c.planned_workout_id = p.id
            WHERE p.athlete_membership_id = $1 AND p.date >= $2 AND p.date < $3"#,
        membership_id,
        from,
        before
    )
    .fetch_all(db)
    .await
}

/// Days in `[from, to]` that already have a workout for the student.
pub async fn taken_days(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> sqlx::Result<Vec<NaiveDate>> {
    sqlx::query_scalar!(
        "SELECT DISTINCT date FROM planned_workouts WHERE athlete_membership_id = $1 AND date BETWEEN $2 AND $3",
        membership_id,
        from,
        to
    )
    .fetch_all(db)
    .await
}

/// Active students (optionally of a group).
pub async fn students(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    group_id: Option<Uuid>,
) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM memberships m
            WHERE m.club_id = $1 AND m.role = 'student' AND m.status = 'active'
              AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM group_members g WHERE g.group_id = $2 AND g.membership_id = m.id))"#,
        club_id,
        group_id
    )
    .fetch_one(db)
    .await
}

pub struct FeedbackRow {
    pub membership_id: Uuid,
    pub planned_workout_id: Uuid,
    pub name: String,
    pub title: String,
    pub status: Option<String>,
    pub rpe: Option<i32>,
    pub comment: Option<String>,
}

/// Those students' workouts in `[from, to]` before `today`, with their completions.
pub async fn feedback(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    group_id: Option<Uuid>,
    from: NaiveDate,
    to: NaiveDate,
    today: NaiveDate,
) -> sqlx::Result<Vec<FeedbackRow>> {
    sqlx::query_as!(
        FeedbackRow,
        r#"SELECT m.id AS membership_id, p.id AS planned_workout_id, u.name, p.title,
                  c.status AS "status?", c.rpe AS "rpe?", c.comment AS "comment?"
             FROM planned_workouts p
             JOIN memberships m ON m.id = p.athlete_membership_id
             JOIN users u ON u.id = m.user_id
             LEFT JOIN workout_completions c ON c.planned_workout_id = p.id
            WHERE m.club_id = $1 AND m.role = 'student' AND m.status = 'active'
              AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM group_members g WHERE g.group_id = $2 AND g.membership_id = m.id))
              AND p.date BETWEEN $3 AND $4 AND p.date < $5
            ORDER BY p.date, p.position, p.created_at"#,
        club_id,
        group_id,
        from,
        to,
        today
    )
    .fetch_all(db)
    .await
}
