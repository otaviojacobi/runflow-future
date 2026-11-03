//! Postgres job queue (§7.2, D-009: no Redis). Workers claim due jobs with `FOR UPDATE SKIP LOCKED`; a claim
//! older than 5 minutes is considered abandoned (crashed worker) and can be claimed again.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgExecutor;

pub struct Job {
    pub id: i64,
    pub kind: String,
    pub payload: Value,
    /// Including this run.
    pub attempts: i32,
}

pub async fn enqueue(
    db: impl PgExecutor<'_>,
    kind: &str,
    payload: &Value,
    run_at: Option<DateTime<Utc>>,
) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        "INSERT INTO jobs (kind, payload, run_at) VALUES ($1, $2, coalesce($3, now())) RETURNING id",
        kind,
        payload,
        run_at
    )
    .fetch_one(db)
    .await
}

pub async fn claim(db: impl PgExecutor<'_>, worker: &str, limit: i64) -> sqlx::Result<Vec<Job>> {
    sqlx::query_as!(
        Job,
        "UPDATE jobs SET locked_at = now(), locked_by = $1, attempts = attempts + 1
          WHERE id IN (SELECT id FROM jobs
                        WHERE done_at IS NULL AND run_at <= now()
                          AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
                        ORDER BY run_at, id LIMIT $2 FOR UPDATE SKIP LOCKED)
          RETURNING id, kind, payload, attempts",
        worker,
        limit
    )
    .fetch_all(db)
    .await
}

pub async fn complete(db: impl PgExecutor<'_>, id: i64) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE jobs SET done_at = now(), locked_at = NULL, last_error = NULL WHERE id = $1",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Try again at `retry_at`, or give up (`None`): the job stays with `done_at` and its last error, for the record.
pub async fn fail(
    db: impl PgExecutor<'_>,
    id: i64,
    error: &str,
    retry_at: Option<DateTime<Utc>>,
) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE jobs SET locked_at = NULL, last_error = $2,
                run_at = coalesce($3, run_at), done_at = CASE WHEN $3::timestamptz IS NULL THEN now() ELSE NULL END
          WHERE id = $1",
        id,
        error,
        retry_at
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Jobs waiting to run now, and how long the oldest has waited (seconds): the worker's health (S13).
pub async fn backlog(db: impl PgExecutor<'_>) -> sqlx::Result<(i64, f64)> {
    let r = sqlx::query!(
        r#"SELECT count(*) AS "due!", coalesce(extract(epoch FROM now() - min(run_at)), 0)::float8 AS "oldest_s!"
             FROM jobs WHERE done_at IS NULL AND run_at <= now()"#
    )
    .fetch_one(db)
    .await?;
    Ok((r.due, r.oldest_s))
}
