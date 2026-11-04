//! PostgreSQL access: pool, migrations, health.
//!
//! Migrations live in `backend/migrations`. Until the beta there is one, `0001_bootstrap.sql`, a synced copy of
//! `api/schema.sql` (D-030); from the beta on, every contract change lands as a new migration **and** in
//! `api/schema.sql`, and `tests/contract.rs` proves both produce the same database.

pub mod assessments;
pub mod assistant;
pub mod athletes;
pub mod auth;
pub mod billing;
pub mod clubs;
pub mod invites;
pub mod jobs;
pub mod library;
pub mod matching;
pub mod me;
pub mod members;
pub mod messages;
pub mod models;
pub mod my;
pub mod notifications;
pub mod plans;
pub mod providers;
pub mod push;
pub mod races;
pub mod reports;
pub mod weeks;
pub mod workouts;

use std::time::{Duration, Instant};

use sqlx::postgres::{PgPool, PgPoolOptions};

pub use sqlx::PgPool as Pool;

/// Every migration, embedded in the binary at compile time.
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../../migrations");

#[derive(Debug, Clone)]
pub struct DbSettings {
    pub url: String,
    pub max_connections: u32,
}

/// Connect, retrying for up to `wait` (the database may still be starting, e.g. under Docker Compose).
pub async fn connect(settings: &DbSettings, wait: Duration) -> Result<PgPool, sqlx::Error> {
    let started = Instant::now();
    let mut delay = Duration::from_millis(250);
    loop {
        let attempt = PgPoolOptions::new()
            .max_connections(settings.max_connections)
            .acquire_timeout(Duration::from_secs(5))
            .connect(&settings.url)
            .await;
        match attempt {
            Ok(pool) => return Ok(pool),
            Err(err) if started.elapsed() + delay < wait => {
                tracing::warn!(error = %err, "database not reachable yet, retrying");
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(3));
            }
            Err(err) => return Err(err),
        }
    }
}

/// Apply pending migrations, then upsert reference data (Runflow's exercise catalog). Safe to run on every start
/// (sqlx takes an advisory lock; the catalog upsert is idempotent).
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    MIGRATOR.run(pool).await?;
    library::sync_exercise_catalog(pool)
        .await
        .map_err(sqlx::migrate::MigrateError::Execute)?;
    Ok(())
}

/// Round-trip time of a trivial query.
pub async fn ping(pool: &PgPool) -> Result<Duration, sqlx::Error> {
    let started = Instant::now();
    sqlx::query("SELECT 1").execute(pool).await?;
    Ok(started.elapsed())
}
