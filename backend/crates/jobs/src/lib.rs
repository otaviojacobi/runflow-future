//! The worker (§7.2): claims due jobs from the Postgres queue and runs them. Failures retry with exponential
//! backoff; after `MAX_ATTEMPTS` the job is closed with its last error. Runs inside `runflow all` or alone as
//! `runflow worker`.

mod invite_email;

use std::time::Duration;

use chrono::Utc;
use runflow_db::Pool;
use runflow_db::jobs::{self, Job};
use runflow_integrations::email::Mailer;
use serde_json::Value;

pub use invite_email::INVITE_EMAIL;

const MAX_ATTEMPTS: i32 = 8;

/// Why a job failed, and whether trying again could help.
#[derive(Debug)]
pub struct JobError {
    pub message: String,
    pub retry: bool,
}

impl JobError {
    pub fn retry(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retry: true,
        }
    }
    pub fn permanent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retry: false,
        }
    }
}

impl From<sqlx::Error> for JobError {
    fn from(e: sqlx::Error) -> Self {
        Self::retry(format!("database: {e}"))
    }
}

#[derive(Clone)]
pub struct Worker {
    db: Pool,
    mailer: Mailer,
    /// Links in e-mails point here (`PUBLIC_APP_URL`).
    public_app_url: String,
    id: String,
}

/// Enqueue helper for the API: `jobs::enqueue(&db, kind, payload)` with the kinds defined here.
pub async fn enqueue(
    db: impl sqlx::PgExecutor<'_>,
    kind: &str,
    payload: Value,
) -> sqlx::Result<i64> {
    jobs::enqueue(db, kind, &payload, None).await
}

impl Worker {
    pub fn new(db: Pool, mailer: Mailer, public_app_url: impl Into<String>) -> Self {
        let id = format!(
            "{}-{}",
            std::env::var("HOSTNAME").unwrap_or_else(|_| "runflow".into()),
            std::process::id()
        );
        Self {
            db,
            mailer,
            public_app_url: public_app_url.into().trim_end_matches('/').to_string(),
            id,
        }
    }

    /// Run every due job (up to `limit`); returns how many ran.
    pub async fn run_once(&self, limit: i64) -> sqlx::Result<usize> {
        let batch = jobs::claim(&self.db, &self.id, limit).await?;
        for job in &batch {
            match self.handle(job).await {
                Ok(()) => jobs::complete(&self.db, job.id).await?,
                Err(e) => {
                    let retry_at = (e.retry && job.attempts < MAX_ATTEMPTS).then(|| {
                        Utc::now()
                            + chrono::Duration::seconds(
                                (30_i64 << (job.attempts - 1).clamp(0, 7)).min(3600),
                            )
                    });
                    tracing::warn!(job = job.id, kind = %job.kind, attempts = job.attempts, error = %e.message, retry = retry_at.is_some(), "job failed");
                    jobs::fail(&self.db, job.id, &e.message, retry_at).await?;
                }
            }
        }
        Ok(batch.len())
    }

    /// Poll until `shutdown` resolves (idle: once a second).
    pub async fn run(&self, shutdown: impl std::future::Future<Output = ()>) {
        tracing::info!(worker = %self.id, "worker started");
        tokio::pin!(shutdown);
        loop {
            let ran = match self.run_once(10).await {
                Ok(n) => n,
                Err(e) => {
                    tracing::error!(error = %e, "worker: queue unavailable");
                    0
                }
            };
            if ran == 0 {
                tokio::select! {
                    _ = &mut shutdown => break,
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                }
            }
        }
        tracing::info!("worker stopped");
    }

    async fn handle(&self, job: &Job) -> Result<(), JobError> {
        match job.kind.as_str() {
            INVITE_EMAIL => invite_email::run(self, &job.payload).await,
            other => Err(JobError::permanent(format!("unknown job kind {other}"))),
        }
    }
}
