//! The worker (§7.2): claims due jobs from the Postgres queue and runs them. Failures retry with exponential
//! backoff; after `MAX_ATTEMPTS` the job is closed with its last error. Runs inside `runflow all` or alone as
//! `runflow worker`.

mod billing_jobs;
mod invite_email;
mod notify_email;
mod strava_jobs;
mod week_release;

use std::time::Duration;

use chrono::{DateTime, Utc};
use runflow_db::Pool;
use runflow_db::jobs::{self, Job};
use runflow_integrations::email::Mailer;
use runflow_integrations::secrets::TokenCipher;
use runflow_integrations::strava::StravaClient;
use serde_json::Value;

pub use billing_jobs::STRIPE_EVENT;
pub use invite_email::INVITE_EMAIL;
pub use strava_jobs::{STRAVA_EVENT, STRAVA_SYNC};

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
    /// Absolute base for `/v1/assets/…` links in e-mails (club logos); none = no images.
    public_api_url: Option<String>,
    id: String,
    strava: Option<StravaCtx>,
}

#[derive(Clone)]
pub(crate) struct StravaCtx {
    pub client: StravaClient,
    pub cipher: TokenCipher,
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
            public_api_url: None,
            id,
            strava: None,
        }
    }

    /// Enable the Strava jobs.
    pub fn with_api_url(mut self, url: impl Into<String>) -> Self {
        self.public_api_url = Some(url.into().trim_end_matches('/').to_string());
        self
    }

    pub fn with_strava(mut self, client: StravaClient, cipher: TokenCipher) -> Self {
        self.strava = Some(StravaCtx { client, cipher });
        self
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
    /// Time-based work, once a minute: automatic week releases (D-031), then the notification e-mails they and
    /// everything else owe (D-032). Returns how many clubs released a week.
    pub async fn tick(&self, now: DateTime<Utc>) -> sqlx::Result<usize> {
        let released = week_release::run(self, now).await?;
        notify_email::run(self, now).await?;
        Ok(released)
    }

    /// A club's e-mail identity (D-036): name, stored theme and a logo URL e-mail clients can show.
    pub(crate) async fn club_frame(
        &self,
        club_id: uuid::Uuid,
    ) -> sqlx::Result<Option<(String, Value, Option<String>)>> {
        let Some(club) = runflow_db::clubs::club(&self.db, club_id).await? else {
            return Ok(None);
        };
        let theme = runflow_db::clubs::branding(&self.db, club_id)
            .await?
            .map(|b| b.theme)
            .unwrap_or(Value::Null);
        let logo = match (
            &self.public_api_url,
            runflow_db::clubs::email_logo(&self.db, club_id).await?,
        ) {
            (Some(api), Some(id)) => Some(format!("{api}/v1/assets/{id}")),
            _ => None,
        };
        Ok(Some((club.name, theme, logo)))
    }

    pub async fn run(&self, shutdown: impl std::future::Future<Output = ()>) {
        tracing::info!(worker = %self.id, "worker started");
        tokio::pin!(shutdown);
        let mut last_tick: Option<std::time::Instant> = None;
        loop {
            if last_tick.is_none_or(|t| t.elapsed() >= Duration::from_secs(60)) {
                last_tick = Some(std::time::Instant::now());
                if let Err(e) = self.tick(Utc::now()).await {
                    tracing::error!(error = %e, "worker: scheduled work failed");
                }
            }
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
            STRAVA_SYNC => strava_jobs::sync(self, &job.payload).await,
            STRAVA_EVENT => strava_jobs::event(self, &job.payload).await,
            STRIPE_EVENT => billing_jobs::event(self, &job.payload).await,
            other => Err(JobError::permanent(format!("unknown job kind {other}"))),
        }
    }
}
