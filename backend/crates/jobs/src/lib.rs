//! The worker (§7.2): claims due jobs from the Postgres queue and runs them. Failures retry with exponential
//! backoff; after `MAX_ATTEMPTS` the job is closed with its last error. Runs inside `runflow all` or alone as
//! `runflow worker`. It `LISTEN`s on the queue's channel, so a job starts as soon as its transaction commits; the
//! idle poll catches retries that come due and anything sent while the listener was reconnecting (D-047).

mod billing_jobs;
mod invite_email;
mod metrics;
mod push_jobs;
mod strava_jobs;
mod week_release;

use std::time::Duration;

use chrono::{DateTime, Utc};
use runflow_db::Pool;
use runflow_db::jobs::{self, Job};
use runflow_integrations::email::Mailer;
use runflow_integrations::expo_push::ExpoPush;
use runflow_integrations::secrets::TokenCipher;
use runflow_integrations::strava::StravaClient;
use runflow_integrations::webpush::WebPush;
use serde_json::Value;

pub use billing_jobs::{STRIPE_EVENT, STRIPE_SEATS};
pub use invite_email::INVITE_EMAIL;
pub use push_jobs::PUSH_SEND;
/// A matching pass for one student (D-049): `{user_id, from, to}`.
pub use runflow_db::matching::JOB as MATCH_ACTIVITIES;
/// Deauthorize at Strava after an automatic disconnect (D-011): the encrypted tokens.
pub use runflow_db::providers::STRAVA_DEAUTHORIZE;
pub use strava_jobs::{STRAVA_ACTIVITY, STRAVA_EVENT, STRAVA_STREAMS, STRAVA_SYNC};

const MAX_ATTEMPTS: i32 = 8;
/// How often an idle worker looks for due jobs without being woken (retries come due; a missed notification).
const IDLE_POLL: Duration = Duration::from_secs(5);

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
    /// Web Push (VAPID keys set); none = notifications aren't pushed.
    webpush: Option<std::sync::Arc<WebPush>>,
    /// Expo push for the phone app (X10).
    expo: Option<std::sync::Arc<ExpoPush>>,
    /// Stripe (Max's seat quantities); none = billing simulation or no billing.
    stripe: Option<std::sync::Arc<runflow_integrations::stripe::StripeClient>>,
    idle_poll: Duration,
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
            webpush: None,
            expo: None,
            stripe: None,
            idle_poll: IDLE_POLL,
        }
    }

    /// Another idle poll interval (tests prove the wake-up with a long one).
    pub fn with_idle_poll(mut self, every: Duration) -> Self {
        self.idle_poll = every;
        self
    }

    pub fn with_stripe(
        mut self,
        stripe: std::sync::Arc<runflow_integrations::stripe::StripeClient>,
    ) -> Self {
        self.stripe = Some(stripe);
        self
    }

    pub fn with_expo(mut self, expo: std::sync::Arc<ExpoPush>) -> Self {
        self.expo = Some(expo);
        self
    }

    pub fn with_webpush(mut self, web: std::sync::Arc<WebPush>) -> Self {
        self.webpush = Some(web);
        self
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
            let started = std::time::Instant::now();
            let result = self.handle(job).await;
            metrics::job_ran(&job.kind, started.elapsed(), &result);
            match result {
                Ok(()) => jobs::complete(&self.db, job.id).await?,
                Err(e) => {
                    let retry_at = (e.retry && job.attempts < MAX_ATTEMPTS).then(|| {
                        Utc::now()
                            + chrono::Duration::seconds(
                                (30_i64 << (job.attempts - 1).clamp(0, 7)).min(3600),
                            )
                    });
                    if retry_at.is_some() {
                        tracing::warn!(job = job.id, kind = %job.kind, attempts = job.attempts, error = %e.message, "job failed, will retry");
                    } else {
                        tracing::error!(job = job.id, kind = %job.kind, attempts = job.attempts, error = %e.message, "job failed for good");
                    }
                    jobs::fail(&self.db, job.id, &e.message, retry_at).await?;
                }
            }
        }
        Ok(batch.len())
    }

    /// Time-based work, once a minute: automatic week releases (D-031), every class schedule kept 8 weeks ahead
    /// (D-052; idempotent, so a minute's run finds nothing new until a new day comes into the window) and the queue's
    /// backlog metrics. Returns how many clubs released a week.
    pub async fn tick(&self, now: DateTime<Utc>) -> sqlx::Result<usize> {
        let released = week_release::run(self, now).await?;
        let created = runflow_db::classes::expand(&self.db, now, None).await?;
        if created > 0 {
            tracing::info!(sessions = created, "class sessions created ahead");
        }
        let (due, oldest_s) = jobs::backlog(&self.db).await?;
        metrics::backlog(due, oldest_s);
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

    /// Work until `shutdown` resolves. Idle, it waits for a `NOTIFY` from `jobs::enqueue` or the idle poll.
    pub async fn run(&self, shutdown: impl std::future::Future<Output = ()>) {
        tracing::info!(worker = %self.id, "worker started");
        tokio::pin!(shutdown);
        // A dedicated connection; it reconnects by itself (notifications sent meanwhile are lost, the poll covers).
        let mut listener = match sqlx::postgres::PgListener::connect_with(&self.db).await {
            Ok(mut l) => match l.listen(jobs::CHANNEL).await {
                Ok(()) => Some(l),
                Err(e) => {
                    tracing::warn!(error = %e, "worker: LISTEN failed, polling only");
                    None
                }
            },
            Err(e) => {
                tracing::warn!(error = %e, "worker: no listener connection, polling only");
                None
            }
        };
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
                let woken = async {
                    match listener.as_mut() {
                        Some(l) => {
                            if let Err(e) = l.recv().await {
                                tracing::warn!(error = %e, "worker: listener lost, reconnecting");
                                tokio::time::sleep(self.idle_poll).await;
                            }
                        }
                        None => std::future::pending().await,
                    }
                };
                tokio::select! {
                    _ = &mut shutdown => break,
                    _ = woken => {}
                    _ = tokio::time::sleep(self.idle_poll) => {}
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
            STRAVA_ACTIVITY => strava_jobs::activity(self, &job.payload).await,
            STRAVA_STREAMS => strava_jobs::streams(self, &job.payload).await,
            STRAVA_DEAUTHORIZE => strava_jobs::deauthorize(self, &job.payload).await,
            STRIPE_EVENT => billing_jobs::event(self, &job.payload).await,
            STRIPE_SEATS => billing_jobs::seats(self, &job.payload).await,
            PUSH_SEND => push_jobs::send(self, &job.payload).await,
            MATCH_ACTIVITIES => runflow_db::matching::run_job(&self.db, &job.payload)
                .await
                .map_err(JobError::retry),
            other => Err(JobError::permanent(format!("unknown job kind {other}"))),
        }
    }
}
