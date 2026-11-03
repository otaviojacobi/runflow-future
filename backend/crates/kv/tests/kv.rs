//! The Redis modules against a real Redis (`TEST_REDIS_URL`, default the compose one on :6380), like Postgres (§8).

use std::time::Duration;

use chrono::Utc;
use runflow_kv::codes::{self, Issued, Limits};
use runflow_kv::sessions::{self, Lookup, Session};
use runflow_kv::{cache, rate, test_kv};
use uuid::Uuid;

const LIMITS: Limits = Limits {
    ttl: Duration::from_secs(600),
    cooldown: Duration::from_secs(30),
    per_hour: 3,
};

#[tokio::test]
async fn sign_in_codes() {
    let kv = test_kv();
    assert!(kv.ping().await.is_ok());
    assert!(
        codes::attempt(&kv, "ana@email.com")
            .await
            .unwrap()
            .is_none()
    );

    assert_eq!(
        codes::issue(&kv, "ana@email.com", b"first", LIMITS)
            .await
            .unwrap(),
        Issued::Stored
    );
    match codes::issue(&kv, "Ana@Email.com", b"second", LIMITS)
        .await
        .unwrap()
    {
        Issued::Cooldown(wait) => {
            assert!(wait > Duration::from_secs(28) && wait <= LIMITS.cooldown)
        }
        other => panic!("expected the cooldown, got {other:?}"),
    }
    codes::clear_cooldown(&kv, "ana@email.com").await.unwrap();
    assert_eq!(
        codes::issue(&kv, "ana@email.com", b"second", LIMITS)
            .await
            .unwrap(),
        Issued::Stored,
        "a new code replaces the old one"
    );

    let p = codes::attempt(&kv, "ana@email.com").await.unwrap().unwrap();
    assert_eq!((p.code_hash.as_slice(), p.attempts), (&b"second"[..], 1));
    let p = codes::attempt(&kv, "ana@email.com").await.unwrap().unwrap();
    assert_eq!(p.attempts, 2, "attempts are counted");
    assert!(
        !codes::consume(&kv, "ana@email.com", b"first")
            .await
            .unwrap()
    );
    assert!(
        codes::consume(&kv, "ana@email.com", b"second")
            .await
            .unwrap()
    );
    assert!(
        !codes::consume(&kv, "ana@email.com", b"second")
            .await
            .unwrap(),
        "single use"
    );
    assert!(
        codes::attempt(&kv, "ana@email.com")
            .await
            .unwrap()
            .is_none()
    );

    // The hourly allowance (3 here) counts every code issued.
    codes::clear_cooldown(&kv, "ana@email.com").await.unwrap();
    assert_eq!(
        codes::issue(&kv, "ana@email.com", b"third", LIMITS)
            .await
            .unwrap(),
        Issued::Stored
    );
    codes::clear_cooldown(&kv, "ana@email.com").await.unwrap();
    assert_eq!(
        codes::issue(&kv, "ana@email.com", b"fourth", LIMITS)
            .await
            .unwrap(),
        Issued::TooMany
    );
    assert_eq!(
        codes::issue(&kv, "bia@email.com", b"x", LIMITS)
            .await
            .unwrap(),
        Issued::Stored,
        "limits are per address"
    );
}

#[tokio::test]
async fn codes_expire() {
    let kv = test_kv();
    let short = Limits {
        ttl: Duration::from_millis(150),
        ..LIMITS
    };
    codes::issue(&kv, "caio@email.com", b"h", short)
        .await
        .unwrap();
    assert!(
        codes::attempt(&kv, "caio@email.com")
            .await
            .unwrap()
            .is_some()
    );
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert!(
        codes::attempt(&kv, "caio@email.com")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn concurrent_attempts_are_counted_once_each() {
    let kv = test_kv();
    codes::issue(&kv, "dani@email.com", b"h", LIMITS)
        .await
        .unwrap();
    let tries = (0..20).map(|_| {
        let kv = kv.clone();
        tokio::spawn(async move {
            codes::attempt(&kv, "dani@email.com")
                .await
                .unwrap()
                .unwrap()
                .attempts
        })
    });
    let mut seen: Vec<u32> = Vec::new();
    for t in tries {
        seen.push(t.await.unwrap());
    }
    seen.sort();
    assert_eq!(seen, (1..=20).collect::<Vec<_>>());
}

#[tokio::test]
async fn fixed_window_rate_limits() {
    let kv = test_kv();
    let user = Uuid::now_v7();
    for _ in 0..3 {
        assert!(
            rate::hit(&kv, "ai", user, 3, Duration::from_secs(60))
                .await
                .unwrap()
                .is_none()
        );
    }
    let wait = rate::hit(&kv, "ai", user, 3, Duration::from_secs(60))
        .await
        .unwrap()
        .unwrap();
    assert!(wait > Duration::from_secs(58));
    assert!(
        rate::hit(&kv, "ai", Uuid::now_v7(), 3, Duration::from_secs(60))
            .await
            .unwrap()
            .is_none()
    );

    let quick = Uuid::now_v7();
    assert!(
        rate::hit(&kv, "ai", quick, 1, Duration::from_millis(100))
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        rate::hit(&kv, "ai", quick, 1, Duration::from_millis(100))
            .await
            .unwrap()
            .is_some()
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        rate::hit(&kv, "ai", quick, 1, Duration::from_millis(100))
            .await
            .unwrap()
            .is_none(),
        "a new window"
    );
}

#[tokio::test]
async fn session_cache_and_tombstones() {
    let kv = test_kv();
    let hash = [7u8; 32];
    let s = Session {
        id: Uuid::now_v7(),
        user_id: Uuid::now_v7(),
        last_seen_at: Utc::now(),
        expires_at: Utc::now() + chrono::Duration::days(60),
    };
    assert_eq!(sessions::get(&kv, &hash).await.unwrap(), Lookup::Unknown);
    sessions::put(&kv, &hash, Some(&s), sessions::TTL)
        .await
        .unwrap();
    let Lookup::Live(cached) = sessions::get(&kv, &hash).await.unwrap() else {
        panic!("cached")
    };
    assert_eq!(cached.id, s.id);
    assert_eq!(
        cached.expires_at.timestamp_micros(),
        s.expires_at.timestamp_micros()
    );

    // Ended: the tombstone wins over a late write of what Postgres said before.
    sessions::forget(&kv, &[hash.to_vec()]).await.unwrap();
    assert_eq!(sessions::get(&kv, &hash).await.unwrap(), Lookup::Gone);
    sessions::put(&kv, &hash, Some(&s), sessions::TTL)
        .await
        .unwrap();
    assert_eq!(sessions::get(&kv, &hash).await.unwrap(), Lookup::Gone);

    // Unknown tokens are remembered as gone; entries never outlive the session.
    let other = [8u8; 32];
    sessions::put(&kv, &other, None, sessions::TTL)
        .await
        .unwrap();
    assert_eq!(sessions::get(&kv, &other).await.unwrap(), Lookup::Gone);
    let brief = [9u8; 32];
    sessions::put(&kv, &brief, Some(&s), Duration::from_millis(100))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(sessions::get(&kv, &brief).await.unwrap(), Lookup::Unknown);

    assert!(
        sessions::touch_due(&kv, &hash, Duration::from_secs(300))
            .await
            .unwrap()
    );
    assert!(
        !sessions::touch_due(&kv, &hash, Duration::from_secs(300))
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn versioned_club_reads() {
    let kv = test_kv();
    let (club, other) = (Uuid::now_v7(), Uuid::now_v7());
    assert_eq!(cache::version(&kv, club).await.unwrap(), 0);
    let k0 = cache::key(&kv, "dash", club, 0, "viewer?date=2026-11-03");
    assert!(cache::get(&kv, &k0).await.unwrap().is_none());
    cache::put(&kv, &k0, br#"{"a":1}"#, Duration::from_secs(30))
        .await
        .unwrap();
    assert_eq!(
        cache::get(&kv, &k0).await.unwrap().as_deref(),
        Some(&br#"{"a":1}"#[..])
    );

    cache::bump(&kv, &[club]).await.unwrap();
    let v = cache::version(&kv, club).await.unwrap();
    assert_eq!(v, 1);
    assert_ne!(
        cache::key(&kv, "dash", club, v, "viewer?date=2026-11-03"),
        k0
    );
    assert_eq!(cache::version(&kv, other).await.unwrap(), 0, "per club");
    assert!(
        k0.starts_with(kv.prefix()) && !k0.contains("viewer"),
        "variants are digested"
    );
}
