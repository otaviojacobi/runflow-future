//! Users, sign-in identities, e-mail codes and sessions (§7.3). Tokens and codes arrive here already
//! hashed; this module never sees a raw secret.

use chrono::{DateTime, Duration, Utc};
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::models::{SessionInfo, User};

/// Version of the terms and privacy texts accepted at sign-up (same as the mock).
pub const TERMS_VERSION: &str = "2026-10";

pub async fn user_by_id(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Option<User>> {
    sqlx::query_as!(
        User,
        "SELECT id, email, name, avatar_url, phone, birth_date, sex, locale, created_at
           FROM users WHERE id = $1 AND deleted_at IS NULL",
        id
    )
    .fetch_optional(db)
    .await
}

/// The user behind a sign-in identity (`google` + `sub`, or `email` + address).
pub async fn user_by_identity(
    db: impl PgExecutor<'_>,
    provider: &str,
    subject: &str,
) -> sqlx::Result<Option<User>> {
    sqlx::query_as!(
        User,
        "SELECT u.id, u.email, u.name, u.avatar_url, u.phone, u.birth_date, u.sex, u.locale, u.created_at
           FROM auth_identities i JOIN users u ON u.id = i.user_id
          WHERE i.provider = $1 AND i.subject = $2 AND u.deleted_at IS NULL",
        provider,
        subject
    )
    .fetch_optional(db)
    .await
}

pub async fn user_by_email(db: impl PgExecutor<'_>, email: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as!(
        User,
        "SELECT id, email, name, avatar_url, phone, birth_date, sex, locale, created_at
           FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL",
        email
    )
    .fetch_optional(db)
    .await
}

/// Find the account for this e-mail or create it (with default notification prefs and the accepted
/// terms/privacy consents). Returns `(user, is_new)`. Safe under concurrent sign-ins.
pub async fn find_or_create_user(
    tx: &mut PgConnection,
    email: &str,
    name: &str,
) -> sqlx::Result<(User, bool)> {
    let created = sqlx::query_as!(
        User,
        "INSERT INTO users (id, email, name) VALUES ($1, $2, $3)
         ON CONFLICT (lower(email)) WHERE deleted_at IS NULL DO NOTHING
         RETURNING id, email, name, avatar_url, phone, birth_date, sex, locale, created_at",
        Uuid::now_v7(),
        email,
        name
    )
    .fetch_optional(&mut *tx)
    .await?;
    match created {
        Some(user) => {
            sqlx::query!(
                "INSERT INTO notification_prefs (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
                user.id
            )
            .execute(&mut *tx)
            .await?;
            for kind in ["terms", "privacy"] {
                sqlx::query!(
                    "INSERT INTO consents (id, user_id, kind, text_version) VALUES ($1, $2, $3, $4)",
                    Uuid::now_v7(),
                    user.id,
                    kind,
                    TERMS_VERSION
                )
                .execute(&mut *tx)
                .await?;
            }
            Ok((user, true))
        }
        None => {
            let user = user_by_email(&mut *tx, email)
                .await?
                .ok_or(sqlx::Error::RowNotFound)?;
            Ok((user, false))
        }
    }
}

pub async fn link_identity(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    provider: &str,
    subject: &str,
    email: &str,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO auth_identities (id, user_id, provider, subject, email) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (provider, subject) DO NOTHING",
        Uuid::now_v7(),
        user_id,
        provider,
        subject,
        email
    )
    .execute(db)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------------------------ e-mail codes

/// How many codes this address got recently, and when the last one was issued.
pub async fn recent_codes(
    db: impl PgExecutor<'_>,
    email: &str,
    since: DateTime<Utc>,
) -> sqlx::Result<(i64, Option<DateTime<Utc>>)> {
    let r = sqlx::query!(
        r#"SELECT count(*) AS "count!", max(created_at) AS last FROM email_codes WHERE lower(email) = lower($1) AND created_at > $2"#,
        email,
        since
    )
    .fetch_one(db)
    .await?;
    Ok((r.count, r.last))
}

/// Store a new code; older pending codes for the same address stop working.
pub async fn create_code(
    tx: &mut PgConnection,
    email: &str,
    code_hash: &[u8],
    ttl: Duration,
) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE email_codes SET consumed_at = now() WHERE lower(email) = lower($1) AND consumed_at IS NULL",
        email
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "INSERT INTO email_codes (id, email, code_hash, expires_at) VALUES ($1, $2, $3, $4)",
        Uuid::now_v7(),
        email,
        code_hash,
        Utc::now() + ttl
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

pub struct PendingCode {
    pub id: Uuid,
    pub code_hash: Vec<u8>,
    /// Attempts including the current one.
    pub attempts: i32,
}

/// Lock the newest usable code for this address and count this attempt.
pub async fn attempt_code(tx: &mut PgConnection, email: &str) -> sqlx::Result<Option<PendingCode>> {
    sqlx::query_as!(
        PendingCode,
        "UPDATE email_codes SET attempts = attempts + 1
          WHERE id = (SELECT id FROM email_codes
                       WHERE lower(email) = lower($1) AND consumed_at IS NULL AND expires_at > now()
                       ORDER BY created_at DESC LIMIT 1 FOR UPDATE)
          RETURNING id, code_hash, attempts",
        email
    )
    .fetch_optional(&mut *tx)
    .await
}

pub async fn consume_code(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE email_codes SET consumed_at = now() WHERE id = $1",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------------------------ sessions

pub async fn create_session(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    token_hash: &[u8],
    kind: &str,
    user_agent: Option<&str>,
    ttl: Duration,
) -> sqlx::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO sessions (id, user_id, token_hash, kind, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
        id,
        user_id,
        token_hash,
        kind,
        user_agent,
        Utc::now() + ttl
    )
    .execute(db)
    .await?;
    Ok(id)
}

/// A live session for this token: not revoked, not expired, user not deleted.
pub struct LiveSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub last_seen_at: DateTime<Utc>,
}

pub async fn session_by_token(
    db: impl PgExecutor<'_>,
    token_hash: &[u8],
) -> sqlx::Result<Option<LiveSession>> {
    sqlx::query_as!(
        LiveSession,
        "SELECT s.id, s.user_id, s.last_seen_at
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL",
        token_hash
    )
    .fetch_optional(db)
    .await
}

/// Sliding expiry: a session in use stays alive for `ttl` after its last use.
pub async fn touch_session(db: impl PgExecutor<'_>, id: Uuid, ttl: Duration) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE sessions SET last_seen_at = now(), expires_at = now() + $2::interval WHERE id = $1",
        id,
        pg_interval(ttl)
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn revoke_session(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    id: Uuid,
) -> sqlx::Result<bool> {
    let r = sqlx::query!(
        "UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
        id,
        user_id
    )
    .execute(db)
    .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn revoke_other_sessions(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    keep: Uuid,
) -> sqlx::Result<u64> {
    let r = sqlx::query!(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        user_id,
        keep
    )
    .execute(db)
    .await?;
    Ok(r.rows_affected())
}

/// Live sessions, the current one first, then most recently used.
pub async fn list_sessions(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    current: Uuid,
) -> sqlx::Result<Vec<SessionInfo>> {
    sqlx::query_as!(
        SessionInfo,
        r#"SELECT id, kind, user_agent, created_at, last_seen_at, (id = $2) AS "current!"
             FROM sessions
            WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
            ORDER BY (id = $2) DESC, last_seen_at DESC"#,
        user_id,
        current
    )
    .fetch_all(db)
    .await
}

fn pg_interval(d: Duration) -> sqlx::postgres::types::PgInterval {
    sqlx::postgres::types::PgInterval {
        months: 0,
        days: 0,
        microseconds: d.num_microseconds().unwrap_or(i64::MAX),
    }
}
