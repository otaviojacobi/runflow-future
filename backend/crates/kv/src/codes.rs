//! E-mail sign-in codes (A2, §7.3). One pending code per address: its keyed hash (never the code) and the attempts,
//! gone when it expires, replaced by a newer code, deleted once used. The per-address limits are counters with TTLs:
//! one code per cooldown and `per_hour` codes an hour. Addresses only appear in keys as digests.

use std::sync::LazyLock;
use std::time::Duration;

use redis::Script;

use crate::{Kv, Result, digest, ms};

/// The rules for issuing codes.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// How long a code works.
    pub ttl: Duration,
    /// Time between two codes for the same address.
    pub cooldown: Duration,
    /// Codes per address in an hour.
    pub per_hour: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Issued {
    /// Stored: it replaced any older code for the address.
    Stored,
    /// Too soon after the previous code: wait this long.
    Cooldown(Duration),
    /// The hourly allowance is used up.
    TooMany,
}

/// Checks both limits, then stores the code and counts it, atomically.
/// KEYS: code, cooldown, hourly counter · ARGV: hash, code ttl ms, cooldown ms, per hour.
static ISSUE: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r#"
local wait = redis.call('PTTL', KEYS[2])
if wait > 0 then return {1, wait} end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[4]) then return {2, 0} end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'h', ARGV[1], 'a', 0)
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
redis.call('INCR', KEYS[3])
if redis.call('PTTL', KEYS[3]) < 0 then redis.call('PEXPIRE', KEYS[3], 3600000) end
return {0, 0}
"#,
    )
});

/// Counts one attempt on the pending code and returns its hash and the attempts so far (nil: none pending).
static ATTEMPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r#"
local h = redis.call('HGET', KEYS[1], 'h')
if not h then return false end
return {h, redis.call('HINCRBY', KEYS[1], 'a', 1)}
"#,
    )
});

/// Deletes the pending code only if it is still the one that was checked (a newer code survives).
static CONSUME: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r#"
if redis.call('HGET', KEYS[1], 'h') == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"#,
    )
});

fn keys(kv: &Kv, email: &str) -> [String; 3] {
    let e = digest(email.to_lowercase().as_bytes());
    [
        kv.key(format_args!("otc:{e}")),
        kv.key(format_args!("otc:cool:{e}")),
        kv.key(format_args!("otc:hour:{e}")),
    ]
}

/// Store a new code (its keyed hash) for `email` if the limits allow it.
pub async fn issue(kv: &Kv, email: &str, code_hash: &[u8], limits: Limits) -> Result<Issued> {
    let [code, cool, hour] = keys(kv, email);
    let (outcome, wait_ms): (u8, u64) = ISSUE
        .key(code)
        .key(cool)
        .key(hour)
        .arg(code_hash)
        .arg(ms(limits.ttl))
        .arg(ms(limits.cooldown))
        .arg(limits.per_hour)
        .invoke_async(&mut kv.conn())
        .await?;
    Ok(match outcome {
        0 => Issued::Stored,
        1 => Issued::Cooldown(Duration::from_millis(wait_ms)),
        _ => Issued::TooMany,
    })
}

/// The pending code of an address, after counting this attempt.
#[derive(Debug, Clone)]
pub struct Pending {
    pub code_hash: Vec<u8>,
    /// Attempts including this one.
    pub attempts: u32,
}

/// Count an attempt on the address's pending code; `None` when there is none (never sent, expired or used).
pub async fn attempt(kv: &Kv, email: &str) -> Result<Option<Pending>> {
    let [code, ..] = keys(kv, email);
    let r: Option<(Vec<u8>, u32)> = ATTEMPT.key(code).invoke_async(&mut kv.conn()).await?;
    Ok(r.map(|(code_hash, attempts)| Pending {
        code_hash,
        attempts,
    }))
}

/// Use up the code that matched. `false`: it was used (or replaced) in the meantime, so it no longer counts.
pub async fn consume(kv: &Kv, email: &str, code_hash: &[u8]) -> Result<bool> {
    let [code, ..] = keys(kv, email);
    let n: u32 = CONSUME
        .key(code)
        .arg(code_hash)
        .invoke_async(&mut kv.conn())
        .await?;
    Ok(n == 1)
}

/// Lift the cooldown for an address (tests that sign the same person in again).
pub async fn clear_cooldown(kv: &Kv, email: &str) -> Result<()> {
    let [_, cool, _] = keys(kv, email);
    let _: u32 = redis::cmd("DEL")
        .arg(cool)
        .query_async(&mut kv.conn())
        .await?;
    Ok(())
}
