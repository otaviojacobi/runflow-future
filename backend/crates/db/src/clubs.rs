//! Clubs, branding, plan rows, assets (club logos and avatars), audit entries.

use chrono::NaiveTime;
use serde_json::Value;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::models::{Branding, Club, Membership, Subscription};

/// The caller's active membership in a club that still exists.
pub struct Access {
    pub membership_id: Uuid,
    pub role: String,
}

pub async fn access(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    club_id: Uuid,
) -> sqlx::Result<Option<Access>> {
    sqlx::query_as!(
        Access,
        "SELECT m.id AS membership_id, m.role FROM memberships m JOIN clubs c ON c.id = m.club_id
          WHERE m.club_id = $1 AND m.user_id = $2 AND m.status = 'active' AND c.deleted_at IS NULL",
        club_id,
        user_id
    )
    .fetch_optional(db)
    .await
}

pub async fn club(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Option<Club>> {
    sqlx::query_as!(
        Club,
        "SELECT id, slug, name, city, state, timezone, modalities, trainer_label, subdomain, created_at,
                release_mode, auto_release_weekday, to_char(auto_release_time, 'HH24:MI') AS auto_release_time
           FROM clubs WHERE id = $1 AND deleted_at IS NULL",
        id
    )
    .fetch_optional(db)
    .await
}

/// By slug or subdomain (public pages).
pub async fn club_by_slug(db: impl PgExecutor<'_>, slug: &str) -> sqlx::Result<Option<Club>> {
    sqlx::query_as!(
        Club,
        "SELECT id, slug, name, city, state, timezone, modalities, trainer_label, subdomain, created_at,
                release_mode, auto_release_weekday, to_char(auto_release_time, 'HH24:MI') AS auto_release_time
           FROM clubs WHERE (slug = $1 OR subdomain = $1) AND deleted_at IS NULL",
        slug
    )
    .fetch_optional(db)
    .await
}

pub async fn slug_taken(db: impl PgExecutor<'_>, slug: &str) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM clubs WHERE slug = $1) AS "x!""#,
        slug
    )
    .fetch_one(db)
    .await
}

pub async fn subdomain_taken(
    db: impl PgExecutor<'_>,
    subdomain: &str,
    except: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM clubs WHERE subdomain = $1 AND id <> $2) AS "x!""#,
        subdomain,
        except
    )
    .fetch_one(db)
    .await
}

pub struct NewClub<'a> {
    pub name: &'a str,
    pub slug: &'a str,
    pub city: Option<&'a str>,
    pub state: Option<&'a str>,
    pub modalities: &'a [String],
    pub trainer_label: &'a str,
}

pub async fn insert_club(tx: &mut PgConnection, c: NewClub<'_>) -> sqlx::Result<Club> {
    sqlx::query_as!(
        Club,
        "INSERT INTO clubs (id, slug, name, city, state, modalities, trainer_label) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, slug, name, city, state, timezone, modalities, trainer_label, subdomain, created_at,
                   release_mode, auto_release_weekday, to_char(auto_release_time, 'HH24:MI') AS auto_release_time",
        Uuid::now_v7(),
        c.slug,
        c.name,
        c.city,
        c.state,
        c.modalities,
        c.trainer_label
    )
    .fetch_one(&mut *tx)
    .await
}

pub async fn insert_membership(
    tx: &mut PgConnection,
    club_id: Uuid,
    user_id: Uuid,
    role: &str,
    billing_owner: bool,
) -> sqlx::Result<Membership> {
    sqlx::query_as!(
        Membership,
        "INSERT INTO memberships (id, club_id, user_id, role, is_billing_owner) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, club_id, user_id, role, status, is_billing_owner, joined_at, left_at",
        Uuid::now_v7(),
        club_id,
        user_id,
        role,
        billing_owner
    )
    .fetch_one(&mut *tx)
    .await
}

pub async fn insert_free_plan(tx: &mut PgConnection, club_id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO club_subscriptions (club_id) VALUES ($1)",
        club_id
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

pub struct Template<'a> {
    pub sport: &'a str,
    pub name: &'a str,
    pub structure: &'a Value,
    pub tags: &'a [String],
    pub est_duration_s: Option<i32>,
    pub est_distance_m: Option<i32>,
}

pub async fn insert_template(
    tx: &mut PgConnection,
    club_id: Uuid,
    author: Uuid,
    t: Template<'_>,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO workout_templates (id, club_id, author_membership_id, sport, name, structure, est_duration_s, est_distance_m, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        Uuid::now_v7(),
        club_id,
        author,
        t.sport,
        t.name,
        t.structure,
        t.est_duration_s,
        t.est_distance_m,
        t.tags
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Settings fields to change (`Some(None)` clears a nullable one).
#[derive(Debug, Default)]
pub struct ClubPatch {
    pub name: Option<String>,
    pub city: Option<Option<String>>,
    pub state: Option<Option<String>>,
    pub timezone: Option<String>,
    pub modalities: Option<Vec<String>>,
    pub trainer_label: Option<String>,
    pub subdomain: Option<Option<String>>,
    pub release_mode: Option<String>,
    /// `Some(None)` turns the automatic release off.
    pub auto_release: Option<Option<(i16, NaiveTime)>>,
}

pub async fn update_club(
    db: impl PgExecutor<'_>,
    id: Uuid,
    p: ClubPatch,
) -> sqlx::Result<Option<Club>> {
    sqlx::query_as!(
        Club,
        "UPDATE clubs SET
            name = coalesce($2, name),
            city = CASE WHEN $3 THEN $4 ELSE city END,
            state = CASE WHEN $5 THEN $6 ELSE state END,
            timezone = coalesce($7, timezone),
            modalities = coalesce($8, modalities),
            trainer_label = coalesce($9, trainer_label),
            subdomain = CASE WHEN $10 THEN $11 ELSE subdomain END,
            release_mode = coalesce($12, release_mode),
            auto_release_weekday = CASE WHEN $13 THEN $14 ELSE auto_release_weekday END,
            auto_release_time = CASE WHEN $13 THEN $15 ELSE auto_release_time END,
            updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING id, slug, name, city, state, timezone, modalities, trainer_label, subdomain, created_at,
                   release_mode, auto_release_weekday, to_char(auto_release_time, 'HH24:MI') AS auto_release_time",
        id,
        p.name,
        p.city.is_some(),
        p.city.flatten(),
        p.state.is_some(),
        p.state.flatten(),
        p.timezone,
        p.modalities.as_deref(),
        p.trainer_label,
        p.subdomain.is_some(),
        p.subdomain.flatten(),
        p.release_mode,
        p.auto_release.is_some(),
        p.auto_release.flatten().map(|a| a.0),
        p.auto_release.flatten().map(|a| a.1),
    )
    .fetch_optional(db)
    .await
}

/// Close a club: soft delete, subdomain released, plan canceled, open invites revoked.
pub async fn close_club(tx: &mut PgConnection, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE clubs SET deleted_at = now(), updated_at = now(), subdomain = NULL WHERE id = $1",
        id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE club_subscriptions SET status = 'canceled', cancel_at_period_end = false, updated_at = now() WHERE club_id = $1 AND status <> 'canceled'",
        id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("UPDATE invitations SET revoked_at = now() WHERE club_id = $1 AND revoked_at IS NULL AND accepted_at IS NULL", id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

pub async fn audit(
    db: impl PgExecutor<'_>,
    club_id: Option<Uuid>,
    actor: Uuid,
    action: &str,
    target_type: &str,
    target_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO audit_log (club_id, actor_user_id, action, target_type, target_id) VALUES ($1, $2, $3, $4, $5)",
        club_id,
        actor,
        action,
        target_type,
        target_id
    )
    .execute(db)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------------------------ branding

pub async fn branding(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Option<Branding>> {
    Ok(sqlx::query!(
        "SELECT primary_color, secondary_color, logo_asset_id, theme_rev, theme, theme_css FROM club_branding WHERE club_id = $1",
        club_id
    )
    .fetch_optional(db)
    .await?
    .map(|b| Branding {
        primary_color: b.primary_color,
        secondary_color: b.secondary_color,
        logo_url: b.logo_asset_id.map(|id| format!("/v1/assets/{id}")),
        theme_rev: b.theme_rev,
        theme: b.theme,
        theme_css: b.theme_css,
    }))
}

pub async fn logo_asset_id(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Option<Uuid>> {
    Ok(sqlx::query_scalar!(
        "SELECT logo_asset_id FROM club_branding WHERE club_id = $1",
        club_id
    )
    .fetch_optional(db)
    .await?
    .flatten())
}

pub struct BrandingInput<'a> {
    pub primary: Option<&'a str>,
    pub secondary: Option<&'a str>,
    pub logo_asset_id: Option<Uuid>,
    pub theme: &'a Value,
    pub theme_css: &'a str,
}

/// Save choices plus the derived theme; `theme_rev` starts at 1 and bumps on every save (§7.8).
pub async fn save_branding(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    b: BrandingInput<'_>,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO club_branding (club_id, primary_color, secondary_color, logo_asset_id, theme, theme_css)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (club_id) DO UPDATE SET
           primary_color = $2, secondary_color = $3, logo_asset_id = $4, theme = $5, theme_css = $6,
           theme_rev = club_branding.theme_rev + 1, updated_at = now()",
        club_id,
        b.primary,
        b.secondary,
        b.logo_asset_id,
        b.theme,
        b.theme_css
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn subscription(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
) -> sqlx::Result<Option<Subscription>> {
    sqlx::query_as!(
        Subscription,
        r#"SELECT s.plan, s.status, s.student_limit, s.current_period_end, s.cancel_at_period_end,
                  s.stripe_customer_id IS NOT NULL AS "has_billing_account!",
                  (SELECT count(*) FROM memberships x WHERE x.club_id = s.club_id AND x.role = 'student' AND x.status = 'active') AS "active_students!"
             FROM club_subscriptions s WHERE s.club_id = $1"#,
        club_id
    )
    .fetch_optional(db)
    .await
}

// ------------------------------------------------------------------------------------ assets

pub struct NewAsset<'a> {
    pub id: Uuid,
    pub owner_user_id: Uuid,
    pub club_id: Option<Uuid>,
    pub kind: &'a str,
    pub storage_key: &'a str,
    pub content_type: &'a str,
    pub bytes: i32,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub sha256: &'a str,
}

pub async fn insert_asset(db: impl PgExecutor<'_>, a: NewAsset<'_>) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO assets (id, owner_user_id, club_id, kind, storage_key, content_type, bytes, width, height, sha256)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        a.id,
        a.owner_user_id,
        a.club_id,
        a.kind,
        a.storage_key,
        a.content_type,
        a.bytes,
        a.width,
        a.height,
        a.sha256
    )
    .execute(db)
    .await?;
    Ok(())
}

pub struct StoredAsset {
    pub storage_key: String,
    pub content_type: String,
    pub sha256: String,
}

pub async fn asset(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Option<StoredAsset>> {
    sqlx::query_as!(
        StoredAsset,
        "SELECT storage_key, content_type, sha256 FROM assets WHERE id = $1",
        id
    )
    .fetch_optional(db)
    .await
}

pub async fn is_club_logo(db: impl PgExecutor<'_>, id: Uuid, club_id: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar!(r#"SELECT EXISTS (SELECT 1 FROM assets WHERE id = $1 AND club_id = $2 AND kind = 'logo') AS "x!""#, id, club_id)
        .fetch_one(db)
        .await
}

pub async fn set_avatar(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    url: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1",
        user_id,
        url
    )
    .execute(db)
    .await?;
    Ok(())
}
