//! Push devices (S7b): Web Push subscriptions of the installed web app (and Expo tokens with X10), and the
//! notifications the worker pushes to them.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgExecutor;
use uuid::Uuid;

/// Register (or move to `user_id`) a device.
pub async fn register(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    platform: &str,
    token: &str,
    keys: Option<&Value>,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO push_tokens (id, user_id, platform, token, keys) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, keys = excluded.keys,
           last_seen_at = now()",
        Uuid::now_v7(),
        user_id,
        platform,
        token,
        keys
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn forget(db: impl PgExecutor<'_>, user_id: Uuid, token: &str) -> sqlx::Result<()> {
    sqlx::query!(
        "DELETE FROM push_tokens WHERE user_id = $1 AND token = $2",
        user_id,
        token
    )
    .execute(db)
    .await?;
    Ok(())
}

pub struct Device {
    pub id: Uuid,
    pub platform: String,
    pub token: String,
    pub keys: Option<Value>,
}

pub async fn devices(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<Vec<Device>> {
    sqlx::query_as!(
        Device,
        "SELECT id, platform, token, keys FROM push_tokens WHERE user_id = $1 ORDER BY last_seen_at DESC",
        user_id
    )
    .fetch_all(db)
    .await
}

/// A device the push service no longer knows.
pub async fn remove(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("DELETE FROM push_tokens WHERE id = $1", id)
        .execute(db)
        .await?;
    Ok(())
}

pub struct Pending {
    pub user_id: Uuid,
    pub club_id: Option<Uuid>,
    pub title: String,
    pub body: Option<String>,
    pub link: Option<String>,
    pub read_at: Option<DateTime<Utc>>,
    pub pushed_at: Option<DateTime<Utc>>,
}

pub async fn pending(
    db: impl PgExecutor<'_>,
    notification_id: Uuid,
) -> sqlx::Result<Option<Pending>> {
    sqlx::query_as!(
        Pending,
        "SELECT user_id, club_id, title, body, link, read_at, pushed_at FROM notifications WHERE id = $1 AND push_at IS NOT NULL",
        notification_id
    )
    .fetch_optional(db)
    .await
}

/// Whose name a push carries (D-057): the notice's club, or the person's only active club for a personal notice (a
/// Strava sync); none when that's ambiguous. `logo` only when it's an image phones show (PNG, JPEG, WebP).
pub struct Brand {
    pub name: String,
    pub logo: Option<Uuid>,
}

pub async fn brand(
    db: impl PgExecutor<'_>,
    club_id: Option<Uuid>,
    user_id: Uuid,
) -> sqlx::Result<Option<Brand>> {
    sqlx::query_as!(
        Brand,
        r#"SELECT c.name, a.id AS "logo?"
             FROM clubs c
             LEFT JOIN club_branding b ON b.club_id = c.id
             LEFT JOIN assets a ON a.id = b.logo_asset_id AND a.content_type IN ('image/png', 'image/jpeg', 'image/webp')
            WHERE c.deleted_at IS NULL
              AND c.id = coalesce($1, (SELECT min(m.club_id::text)::uuid FROM memberships m
                                        WHERE m.user_id = $2 AND m.status = 'active' HAVING count(*) = 1))"#,
        club_id,
        user_id
    )
    .fetch_optional(db)
    .await
}

pub async fn mark_pushed(db: impl PgExecutor<'_>, notification_id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE notifications SET pushed_at = now() WHERE id = $1",
        notification_id
    )
    .execute(db)
    .await?;
    Ok(())
}
