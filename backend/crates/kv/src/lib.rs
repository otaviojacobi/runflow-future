//! Redis (D-047): ephemeral and cache data only. Postgres stays the system of record **and** the job queue.
//!
//! - [`codes`]: e-mail sign-in codes and their per-address limits.
//! - [`rate`]: fixed-window rate limits (the assistant).
//! - [`sessions`]: a short cache of token hash → session, so signed-in requests skip Postgres.
//! - [`cache`]: cached heavy club reads, keyed by a per-club version that every write bumps.
//!
//! Every key starts with the prefix (`rf:`; each test app gets a random one) and every key has a TTL, so nothing
//! here outlives its purpose and memory pressure may evict anything (`volatile-lru`). Only commands common to
//! Redis ≥ 7 and Valkey are used. Handlers never send Redis commands themselves: they call these modules, like
//! SQL lives in `runflow-db`.

pub mod cache;
pub mod codes;
pub mod rate;
pub mod sessions;

use std::sync::Arc;
use std::time::{Duration, Instant};

use redis::aio::{ConnectionManager, ConnectionManagerConfig};

/// The production key prefix.
pub const PREFIX: &str = "rf:";

#[derive(Debug, thiserror::Error)]
#[error("redis: {0}")]
pub struct Error(#[from] redis::RedisError);

pub type Result<T> = std::result::Result<T, Error>;

/// A Redis client: one multiplexed connection, shared by every request, that reconnects by itself.
#[derive(Clone)]
pub struct Kv {
    conn: ConnectionManager,
    prefix: Arc<str>,
}

impl std::fmt::Debug for Kv {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Kv").field("prefix", &self.prefix).finish()
    }
}

impl Kv {
    /// A client for `url` (`redis://[:password@]host:port[/db]`, `rediss://` for TLS) whose keys start with
    /// `prefix`. Connects on first use; needs a Tokio runtime.
    pub fn new(url: &str, prefix: &str) -> Result<Self> {
        let client = redis::Client::open(url)?;
        let config = ConnectionManagerConfig::new()
            .set_connection_timeout(Some(Duration::from_secs(2)))
            .set_response_timeout(Some(Duration::from_secs(1)))
            .set_number_of_retries(3);
        Ok(Self {
            conn: ConnectionManager::new_lazy_with_config(client, config)?,
            prefix: prefix.into(),
        })
    }

    /// [`Kv::new`], then wait up to `wait` for Redis to answer (it may still be starting, e.g. under Docker Compose).
    pub async fn connect(url: &str, prefix: &str, wait: Duration) -> Result<Self> {
        let kv = Self::new(url, prefix)?;
        let started = Instant::now();
        let mut delay = Duration::from_millis(250);
        loop {
            match kv.ping().await {
                Ok(_) => return Ok(kv),
                Err(err) if started.elapsed() + delay < wait => {
                    tracing::warn!(error = %err, "redis not reachable yet, retrying");
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(Duration::from_secs(3));
                }
                Err(err) => return Err(err),
            }
        }
    }

    /// Round-trip time of a `PING`.
    pub async fn ping(&self) -> Result<Duration> {
        let started = Instant::now();
        let _: String = redis::cmd("PING").query_async(&mut self.conn()).await?;
        Ok(started.elapsed())
    }

    /// The server's name and version (`redis 8.2.1`, `valkey 8.1.0`), for the doctor.
    pub async fn server(&self) -> Result<String> {
        let info: String = redis::cmd("INFO")
            .arg("server")
            .query_async(&mut self.conn())
            .await?;
        let field = |name: &str| {
            info.lines()
                .find_map(|l| l.strip_prefix(name)?.strip_prefix(':'))
                .map(|v| v.trim().to_string())
        };
        Ok(match (field("valkey_version"), field("redis_version")) {
            (Some(v), _) => format!("valkey {v}"),
            (None, Some(v)) => format!("redis {v}"),
            _ => "unknown server".into(),
        })
    }

    pub fn prefix(&self) -> &str {
        &self.prefix
    }

    /// `<prefix><rest>`.
    fn key(&self, rest: impl std::fmt::Display) -> String {
        format!("{}{rest}", self.prefix)
    }

    fn conn(&self) -> ConnectionManager {
        self.conn.clone()
    }
}

/// Hex SHA-256 (first 128 bits): personal data (e-mail addresses) and long inputs never appear in keys as such.
pub(crate) fn digest(input: &[u8]) -> String {
    let d = aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, input);
    d.as_ref()[..16]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Milliseconds for `PX`/`PEXPIRE`, at least 1.
pub(crate) fn ms(d: Duration) -> u64 {
    (d.as_millis() as u64).max(1)
}

/// What the tests share: a client on `TEST_REDIS_URL` (default: the compose Redis on :6380) with a random prefix,
/// so parallel tests never see each other's keys.
#[doc(hidden)]
pub fn test_kv() -> Kv {
    let url = std::env::var("TEST_REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6380".into());
    Kv::new(&url, &format!("rf:test:{}:", uuid::Uuid::now_v7().simple())).expect("TEST_REDIS_URL")
}
