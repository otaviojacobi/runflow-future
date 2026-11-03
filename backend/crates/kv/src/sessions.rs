//! A short cache of session lookups (§7.3): token hash → session, so signed-in requests skip Postgres. Postgres
//! stays the truth; every way a session ends writes a tombstone here ([`forget`]) that a concurrent lookup can't
//! overwrite (entries are only ever added with `NX`). Unknown tokens are cached as gone too (a token can't become
//! valid later: sign-in hands out a fresh one). Keys hold the token's hash, never the token.

use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{Kv, Result, ms};

/// How long a lookup is reused, at most.
pub const TTL: Duration = Duration::from_secs(60);
const GONE: &[u8] = b"-";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Uuid,
    pub last_seen_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lookup {
    /// Not cached: ask Postgres.
    Unknown,
    /// Revoked, expired or never existed.
    Gone,
    Live(Session),
}

fn key(kv: &Kv, token_hash: &[u8]) -> String {
    kv.key(format_args!("sess:{}", hex(token_hash)))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub async fn get(kv: &Kv, token_hash: &[u8]) -> Result<Lookup> {
    let raw: Option<Vec<u8>> = redis::cmd("GET")
        .arg(key(kv, token_hash))
        .query_async(&mut kv.conn())
        .await?;
    Ok(match raw {
        None => Lookup::Unknown,
        Some(v) if v == GONE => Lookup::Gone,
        Some(v) => serde_json::from_slice(&v).map_or(Lookup::Unknown, Lookup::Live),
    })
}

/// Remember what Postgres answered (`None`: no live session) for `ttl` (capped at [`TTL`]), unless something is
/// cached already: a tombstone written meanwhile wins.
pub async fn put(
    kv: &Kv,
    token_hash: &[u8],
    session: Option<&Session>,
    ttl: Duration,
) -> Result<()> {
    let value = match session {
        Some(s) => serde_json::to_vec(s).expect("session serializes"),
        None => GONE.to_vec(),
    };
    let _: Option<String> = redis::cmd("SET")
        .arg(key(kv, token_hash))
        .arg(value)
        .arg("NX")
        .arg("PX")
        .arg(ms(ttl.min(TTL)))
        .query_async(&mut kv.conn())
        .await?;
    Ok(())
}

/// These sessions ended (sign-out, revoked, account deleted): tombstones replace whatever is cached, long enough
/// to outlive any request that read the session before it ended.
pub async fn forget(kv: &Kv, token_hashes: &[Vec<u8>]) -> Result<()> {
    if token_hashes.is_empty() {
        return Ok(());
    }
    let mut pipe = redis::pipe();
    for h in token_hashes {
        pipe.cmd("SET")
            .arg(key(kv, h))
            .arg(GONE)
            .arg("PX")
            .arg(ms(TTL))
            .ignore();
    }
    let () = pipe.query_async(&mut kv.conn()).await?;
    Ok(())
}

/// Whether this request should write `last_seen_at`: true at most once per `every` for a session.
pub async fn touch_due(kv: &Kv, token_hash: &[u8], every: Duration) -> Result<bool> {
    let key = kv.key(format_args!("touch:{}", hex(token_hash)));
    let set: Option<String> = redis::cmd("SET")
        .arg(key)
        .arg(1)
        .arg("NX")
        .arg("PX")
        .arg(ms(every))
        .query_async(&mut kv.conn())
        .await?;
    Ok(set.is_some())
}
