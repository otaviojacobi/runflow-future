//! Workout library (templates, W5/W6), exercise library (W18) and Runflow's global exercise catalog.

use serde::Deserialize;
use serde_json::Value;
use sqlx::PgExecutor;
use uuid::Uuid;

use crate::models::{ExerciseRow, Template};

pub async fn templates(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Template>> {
    sqlx::query_as!(
        Template,
        "SELECT id, club_id, author_membership_id, sport, name, description, structure, est_duration_s, est_distance_m, tags, created_at, updated_at, archived_at
           FROM workout_templates WHERE club_id = $1 AND archived_at IS NULL ORDER BY updated_at DESC",
        club_id
    )
    .fetch_all(db)
    .await
}

pub async fn template(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Template>> {
    sqlx::query_as!(
        Template,
        "SELECT id, club_id, author_membership_id, sport, name, description, structure, est_duration_s, est_distance_m, tags, created_at, updated_at, archived_at
           FROM workout_templates WHERE club_id = $1 AND id = $2 AND archived_at IS NULL",
        club_id,
        id
    )
    .fetch_optional(db)
    .await
}

pub struct TemplateInput {
    pub sport: Option<String>,
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub structure: Option<Value>,
    pub est_duration_s: Option<Option<i32>>,
    pub est_distance_m: Option<Option<i32>>,
    pub tags: Option<Vec<String>>,
}

pub async fn insert_template(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    author: Uuid,
    t: TemplateInput,
) -> sqlx::Result<Template> {
    sqlx::query_as!(
        Template,
        "INSERT INTO workout_templates (id, club_id, author_membership_id, sport, name, description, structure, est_duration_s, est_distance_m, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::text[], '{}'))
         RETURNING id, club_id, author_membership_id, sport, name, description, structure, est_duration_s, est_distance_m, tags, created_at, updated_at, archived_at",
        Uuid::now_v7(),
        club_id,
        author,
        t.sport.unwrap_or_default(),
        t.name.unwrap_or_default(),
        t.description.flatten(),
        t.structure.unwrap_or_default(),
        t.est_duration_s.flatten(),
        t.est_distance_m.flatten(),
        t.tags.as_deref()
    )
    .fetch_one(db)
    .await
}

pub async fn update_template(
    db: impl PgExecutor<'_>,
    id: Uuid,
    t: TemplateInput,
) -> sqlx::Result<Template> {
    sqlx::query_as!(
        Template,
        "UPDATE workout_templates SET
            sport = coalesce($2, sport), name = coalesce($3, name),
            description = CASE WHEN $4 THEN $5 ELSE description END,
            structure = coalesce($6, structure),
            est_duration_s = CASE WHEN $7 THEN $8 ELSE est_duration_s END,
            est_distance_m = CASE WHEN $9 THEN $10 ELSE est_distance_m END,
            tags = coalesce($11::text[], tags), updated_at = now()
          WHERE id = $1
          RETURNING id, club_id, author_membership_id, sport, name, description, structure, est_duration_s, est_distance_m, tags, created_at, updated_at, archived_at",
        id,
        t.sport,
        t.name,
        t.description.is_some(),
        t.description.flatten(),
        t.structure,
        t.est_duration_s.is_some(),
        t.est_duration_s.flatten(),
        t.est_distance_m.is_some(),
        t.est_distance_m.flatten(),
        t.tags.as_deref()
    )
    .fetch_one(db)
    .await
}

pub async fn archive_template(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE workout_templates SET archived_at = now() WHERE id = $1",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------------------------ exercises

/// This club's exercises plus the global catalog (archived ones excluded; shadowing is done by the API).
pub async fn exercises(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<ExerciseRow>> {
    sqlx::query_as!(
        ExerciseRow,
        "SELECT id, club_id, name, category, muscles, equipment, cues, video_url, created_by, created_at, archived_at
           FROM exercises WHERE (club_id = $1 OR club_id IS NULL) AND archived_at IS NULL",
        club_id
    )
    .fetch_all(db)
    .await
}

pub async fn exercise(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Option<ExerciseRow>> {
    sqlx::query_as!(
        ExerciseRow,
        "SELECT id, club_id, name, category, muscles, equipment, cues, video_url, created_by, created_at, archived_at
           FROM exercises WHERE id = $1 AND archived_at IS NULL",
        id
    )
    .fetch_optional(db)
    .await
}

pub async fn club_exercise_named(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    name: &str,
    except: Option<Uuid>,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM exercises WHERE club_id = $1 AND archived_at IS NULL AND lower(trim(name)) = lower(trim($2))
                           AND id IS DISTINCT FROM $3) AS "x!""#,
        club_id,
        name,
        except
    )
    .fetch_one(db)
    .await
}

#[derive(Default)]
pub struct ExerciseInput {
    pub name: Option<String>,
    pub category: Option<String>,
    pub muscles: Option<Vec<String>>,
    pub equipment: Option<Vec<String>>,
    pub cues: Option<Option<String>>,
    pub video_url: Option<Option<String>>,
}

pub async fn insert_exercise(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    author: Uuid,
    e: ExerciseInput,
) -> sqlx::Result<ExerciseRow> {
    sqlx::query_as!(
        ExerciseRow,
        "INSERT INTO exercises (id, club_id, name, category, muscles, equipment, cues, video_url, created_by)
         VALUES ($1, $2, $3, $4, coalesce($5::text[], '{}'), coalesce($6::text[], '{}'), $7, $8, $9)
         RETURNING id, club_id, name, category, muscles, equipment, cues, video_url, created_by, created_at, archived_at",
        Uuid::now_v7(),
        club_id,
        e.name.unwrap_or_default(),
        e.category.unwrap_or_default(),
        e.muscles.as_deref(),
        e.equipment.as_deref(),
        e.cues.flatten(),
        e.video_url.flatten(),
        author
    )
    .fetch_one(db)
    .await
}

pub async fn update_exercise(
    db: impl PgExecutor<'_>,
    id: Uuid,
    e: ExerciseInput,
) -> sqlx::Result<ExerciseRow> {
    sqlx::query_as!(
        ExerciseRow,
        "UPDATE exercises SET
            name = coalesce($2, name), category = coalesce($3, category),
            muscles = coalesce($4::text[], muscles), equipment = coalesce($5::text[], equipment),
            cues = CASE WHEN $6 THEN $7 ELSE cues END,
            video_url = CASE WHEN $8 THEN $9 ELSE video_url END
          WHERE id = $1
          RETURNING id, club_id, name, category, muscles, equipment, cues, video_url, created_by, created_at, archived_at",
        id,
        e.name,
        e.category,
        e.muscles.as_deref(),
        e.equipment.as_deref(),
        e.cues.is_some(),
        e.cues.flatten(),
        e.video_url.is_some(),
        e.video_url.flatten()
    )
    .fetch_one(db)
    .await
}

pub async fn archive_exercise(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("UPDATE exercises SET archived_at = now() WHERE id = $1", id)
        .execute(db)
        .await?;
    Ok(())
}

#[derive(Deserialize)]
struct CatalogExercise {
    id: Uuid,
    name: String,
    category: String,
    muscles: Vec<String>,
    equipment: Vec<String>,
    cues: Option<String>,
}

/// Upsert Runflow's global exercise catalog (`api/exercise-catalog.json`, synced to `assets/`). Idempotent.
pub async fn sync_exercise_catalog(db: &sqlx::PgPool) -> sqlx::Result<usize> {
    let items: Vec<CatalogExercise> =
        serde_json::from_str(include_str!("../../../assets/exercise-catalog.json"))
            .expect("exercise-catalog.json");
    let mut tx = db.begin().await?;
    for e in &items {
        sqlx::query!(
            "INSERT INTO exercises (id, club_id, name, category, muscles, equipment, cues) VALUES ($1, NULL, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET name = $2, category = $3, muscles = $4, equipment = $5, cues = $6, archived_at = NULL
              WHERE exercises.club_id IS NULL",
            e.id,
            e.name,
            e.category,
            &e.muscles,
            &e.equipment,
            e.cues
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(items.len())
}
