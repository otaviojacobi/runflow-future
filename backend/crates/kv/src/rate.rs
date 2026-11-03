//! Rate limits as fixed-window counters: the first hit starts a window of `window`, at most `limit` hits fit in it.
//! Shared by every API process (unlike an in-memory counter, which a second process or a Lambda would not see).

use std::sync::LazyLock;
use std::time::Duration;

use redis::Script;

use crate::{Kv, Result, ms};

/// KEYS: counter · ARGV: window ms, limit. Returns -1 when allowed, else the window's remaining ms.
static HIT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r#"
local n = redis.call('INCR', KEYS[1])
if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if n > tonumber(ARGV[2]) then return redis.call('PTTL', KEYS[1]) end
return -1
"#,
    )
});

/// Count a hit of `who` against the `name` limit. `None`: allowed; `Some(wait)`: over the limit for `wait` more.
pub async fn hit(
    kv: &Kv,
    name: &str,
    who: impl std::fmt::Display,
    limit: u32,
    window: Duration,
) -> Result<Option<Duration>> {
    let key = kv.key(format_args!("rl:{name}:{who}"));
    let remaining_ms: i64 = HIT
        .key(key)
        .arg(ms(window))
        .arg(limit)
        .invoke_async(&mut kv.conn())
        .await?;
    Ok((remaining_ms >= 0).then(|| Duration::from_millis(remaining_ms as u64)))
}
