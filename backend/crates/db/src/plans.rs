//! Planilhas (W7): multi-week plans, their grid, and assignments that materialize planned workouts.

use chrono::NaiveDate;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::models::{Plan, PlanAssignment, PlanItem};

pub async fn list(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    only: Option<Uuid>,
) -> sqlx::Result<Vec<Plan>> {
    sqlx::query_as!(
        Plan,
        r#"SELECT p.id, p.club_id, p.author_membership_id, p.name, p.description, p.weeks, p.created_at, p.updated_at, p.archived_at,
                  (SELECT count(*) FROM training_plan_items i WHERE i.plan_id = p.id) AS "items_count!",
                  (SELECT array_agg(coalesce((SELECT sum(coalesce(i.est_duration_s, 0)) FROM training_plan_items i
                                               WHERE i.plan_id = p.id AND i.week = w), 0)::bigint ORDER BY w)
                     FROM generate_series(1, p.weeks) AS w) AS "weekly_duration_s!",
                  (SELECT count(*) FROM plan_assignments a WHERE a.plan_id = p.id) AS "active_assignments!"
             FROM training_plans p
            WHERE p.club_id = $1 AND p.archived_at IS NULL AND ($2::uuid IS NULL OR p.id = $2)
            ORDER BY p.updated_at DESC"#,
        club_id,
        only
    )
    .fetch_all(db)
    .await
}

pub async fn one(db: impl PgExecutor<'_>, club_id: Uuid, id: Uuid) -> sqlx::Result<Option<Plan>> {
    Ok(list(db, club_id, Some(id)).await?.pop())
}

pub async fn items(db: impl PgExecutor<'_>, plan_id: Uuid) -> sqlx::Result<Vec<PlanItem>> {
    sqlx::query_as!(
        PlanItem,
        "SELECT id, plan_id, week, weekday, template_id, sport, title, structure, est_duration_s, est_distance_m, notes
           FROM training_plan_items WHERE plan_id = $1 ORDER BY week, weekday, id",
        plan_id
    )
    .fetch_all(db)
    .await
}

pub async fn assignments(
    db: impl PgExecutor<'_>,
    plan_id: Uuid,
) -> sqlx::Result<Vec<PlanAssignment>> {
    sqlx::query_as!(
        PlanAssignment,
        r#"SELECT a.id, a.plan_id, a.athlete_membership_id, a.start_date, a.created_by, a.created_at,
                  jsonb_build_object('membership_id', m.id, 'user', jsonb_build_object(
                    'id', u.id, 'email', u.email, 'name', u.name, 'avatar_url', u.avatar_url, 'phone', u.phone,
                    'birth_date', u.birth_date, 'sex', u.sex, 'locale', u.locale, 'created_at', u.created_at)) AS "athlete!",
                  (SELECT count(*) FROM planned_workouts w WHERE w.plan_assignment_id = a.id) AS "workouts!",
                  (SELECT count(*) FROM planned_workouts w JOIN workout_completions c ON c.planned_workout_id = w.id
                    WHERE w.plan_assignment_id = a.id AND c.status IN ('completed', 'partial')) AS "done!"
             FROM plan_assignments a JOIN memberships m ON m.id = a.athlete_membership_id JOIN users u ON u.id = m.user_id
            WHERE a.plan_id = $1 ORDER BY a.created_at"#,
        plan_id
    )
    .fetch_all(db)
    .await
}

pub async fn insert(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    author: Uuid,
    name: &str,
    description: Option<&str>,
    weeks: i32,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO training_plans (id, club_id, author_membership_id, name, description, weeks) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        Uuid::now_v7(),
        club_id,
        author,
        name,
        description,
        weeks
    )
    .fetch_one(db)
    .await
}

/// Update; shrinking `weeks` drops the grid items beyond the new end.
pub async fn update(
    tx: &mut PgConnection,
    id: Uuid,
    name: Option<&str>,
    description: Option<Option<&str>>,
    weeks: Option<i32>,
) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE training_plans SET name = coalesce($2, name), description = CASE WHEN $3 THEN $4 ELSE description END,
                weeks = coalesce($5, weeks), updated_at = now() WHERE id = $1",
        id,
        name,
        description.is_some(),
        description.flatten(),
        weeks
    )
    .execute(&mut *tx)
    .await?;
    if let Some(w) = weeks {
        sqlx::query!(
            "DELETE FROM training_plan_items WHERE plan_id = $1 AND week > $2",
            id,
            w
        )
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

pub async fn archive(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE training_plans SET archived_at = now() WHERE id = $1",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}

pub struct NewItem {
    pub id: Option<Uuid>,
    pub week: i32,
    pub weekday: i32,
    pub template_id: Option<Uuid>,
    pub sport: String,
    pub title: String,
    pub structure: serde_json::Value,
    pub est_duration_s: Option<i32>,
    pub est_distance_m: Option<i32>,
    pub notes: Option<String>,
}

/// Replace the whole grid (existing ids are kept when sent back).
pub async fn replace_items(
    tx: &mut PgConnection,
    plan_id: Uuid,
    items: &[NewItem],
) -> sqlx::Result<()> {
    sqlx::query!(
        "DELETE FROM training_plan_items WHERE plan_id = $1",
        plan_id
    )
    .execute(&mut *tx)
    .await?;
    for it in items {
        sqlx::query!(
            "INSERT INTO training_plan_items (id, plan_id, week, weekday, template_id, sport, title, structure, est_duration_s, est_distance_m, notes)
             VALUES ($1, $2, $3, $4, (SELECT id FROM workout_templates WHERE id = $5), $6, $7, $8, $9, $10, $11)",
            it.id.unwrap_or_else(Uuid::now_v7),
            plan_id,
            it.week,
            it.weekday,
            it.template_id,
            it.sport,
            it.title,
            it.structure,
            it.est_duration_s,
            it.est_distance_m,
            it.notes
        )
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query!(
        "UPDATE training_plans SET updated_at = now() WHERE id = $1",
        plan_id
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

pub async fn insert_assignment(
    tx: &mut PgConnection,
    plan_id: Uuid,
    athlete: Uuid,
    start: NaiveDate,
    by: Uuid,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO plan_assignments (id, plan_id, athlete_membership_id, start_date, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        Uuid::now_v7(),
        plan_id,
        athlete,
        start,
        by
    )
    .fetch_one(&mut *tx)
    .await
}

pub async fn assignment_exists(
    db: impl PgExecutor<'_>,
    plan_id: Uuid,
    id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM plan_assignments WHERE id = $1 AND plan_id = $2) AS "x!""#,
        id,
        plan_id
    )
    .fetch_one(db)
    .await
}

/// Unassign: delete the assignment's workouts from `today` on that weren't done; keep the past ones (detached).
/// → the removed workouts' `(athlete, date)`.
pub async fn unassign(
    tx: &mut PgConnection,
    id: Uuid,
    today: NaiveDate,
) -> sqlx::Result<Vec<(Uuid, NaiveDate)>> {
    let removed = sqlx::query!(
        "DELETE FROM planned_workouts w WHERE w.plan_assignment_id = $1 AND w.date >= $2
            AND NOT EXISTS (SELECT 1 FROM workout_completions c WHERE c.planned_workout_id = w.id)
         RETURNING w.athlete_membership_id, w.date",
        id,
        today
    )
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|r| (r.athlete_membership_id, r.date))
    .collect();
    sqlx::query!(
        "UPDATE planned_workouts SET plan_assignment_id = NULL WHERE plan_assignment_id = $1",
        id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("DELETE FROM plan_assignments WHERE id = $1", id)
        .execute(&mut *tx)
        .await?;
    Ok(removed)
}
