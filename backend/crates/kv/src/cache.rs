//! Cached club reads (W1 dashboard, W16 reports). An entry's key carries the club's version, which every write to
//! the club bumps ([`bump`]), so a write makes the club's cached reads unreachable at once; short TTLs cover changes
//! that don't go through a club route.

use std::time::Duration;

use uuid::Uuid;

use crate::{Kv, Result, digest, ms};

/// Versions outlive every entry that could use them (entries live minutes); idle clubs start over at 0.
const VERSION_TTL: Duration = Duration::from_secs(24 * 3600);

fn version_key(kv: &Kv, club: Uuid) -> String {
    kv.key(format_args!("club:{club}:v"))
}

/// The club's current version (0 until its first write).
pub async fn version(kv: &Kv, club: Uuid) -> Result<u64> {
    let v: Option<u64> = redis::cmd("GET")
        .arg(version_key(kv, club))
        .query_async(&mut kv.conn())
        .await?;
    Ok(v.unwrap_or(0))
}

/// Something in these clubs changed: their cached reads are stale.
pub async fn bump(kv: &Kv, clubs: &[Uuid]) -> Result<()> {
    if clubs.is_empty() {
        return Ok(());
    }
    let mut pipe = redis::pipe();
    for c in clubs {
        let k = version_key(kv, *c);
        pipe.cmd("INCR")
            .arg(&k)
            .ignore()
            .cmd("PEXPIRE")
            .arg(&k)
            .arg(ms(VERSION_TTL))
            .ignore();
    }
    let () = pipe.query_async(&mut kv.conn()).await?;
    Ok(())
}

/// The key of one cached read: what (`route`), whose (`club` at `version`) and which (`variant`: viewer, query…).
pub fn key(kv: &Kv, route: &str, club: Uuid, version: u64, variant: &str) -> String {
    kv.key(format_args!(
        "cache:{route}:{club}:{version}:{}",
        digest(variant.as_bytes())
    ))
}

pub async fn get(kv: &Kv, key: &str) -> Result<Option<Vec<u8>>> {
    Ok(redis::cmd("GET")
        .arg(key)
        .query_async(&mut kv.conn())
        .await?)
}

pub async fn put(kv: &Kv, key: &str, value: &[u8], ttl: Duration) -> Result<()> {
    let () = redis::cmd("SET")
        .arg(key)
        .arg(value)
        .arg("PX")
        .arg(ms(ttl))
        .query_async(&mut kv.conn())
        .await?;
    Ok(())
}
