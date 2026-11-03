//! Personal invites (D-023): one open invite per e-mail per club, 7 days, single use, bound to the e-mail.

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::models::{Invitation, Membership};

/// Every invite that wasn't cancelled.
pub async fn list(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Invitation>> {
    sqlx::query_as!(
        Invitation,
        "SELECT id, club_id, role, email, name, token, group_ids, created_by, expires_at, sent_at, send_count, accepted_at, accepted_by, revoked_at, created_at
           FROM invitations WHERE club_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC",
        club_id
    )
    .fetch_all(db)
    .await
}

pub async fn by_id(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Invitation>> {
    sqlx::query_as!(
        Invitation,
        "SELECT id, club_id, role, email, name, token, group_ids, created_by, expires_at, sent_at, send_count, accepted_at, accepted_by, revoked_at, created_at
           FROM invitations WHERE club_id = $1 AND id = $2",
        club_id,
        id
    )
    .fetch_optional(db)
    .await
}

pub async fn by_id_any(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Option<Invitation>> {
    sqlx::query_as!(
        Invitation,
        "SELECT id, club_id, role, email, name, token, group_ids, created_by, expires_at, sent_at, send_count, accepted_at, accepted_by, revoked_at, created_at
           FROM invitations WHERE id = $1",
        id
    )
    .fetch_optional(db)
    .await
}

pub async fn by_token(db: impl PgExecutor<'_>, token: &str) -> sqlx::Result<Option<Invitation>> {
    sqlx::query_as!(
        Invitation,
        "SELECT id, club_id, role, email, name, token, group_ids, created_by, expires_at, sent_at, send_count, accepted_at, accepted_by, revoked_at, created_at
           FROM invitations WHERE token = $1",
        token
    )
    .fetch_optional(db)
    .await
}

/// The open (not accepted, not cancelled) invite for this e-mail, expired or not.
pub async fn open_for(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    email: &str,
) -> sqlx::Result<Option<Invitation>> {
    sqlx::query_as!(
        Invitation,
        "SELECT id, club_id, role, email, name, token, group_ids, created_by, expires_at, sent_at, send_count, accepted_at, accepted_by, revoked_at, created_at
           FROM invitations WHERE club_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL",
        club_id,
        email
    )
    .fetch_optional(db)
    .await
}

/// Is there an active member with this e-mail?
pub async fn is_member_email(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    email: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
                           WHERE m.club_id = $1 AND lower(u.email) = lower($2) AND u.deleted_at IS NULL AND m.status = 'active') AS "x!""#,
        club_id,
        email
    )
    .fetch_one(db)
    .await
}

pub struct NewInvite<'a> {
    pub club_id: Uuid,
    pub role: &'a str,
    pub email: &'a str,
    pub name: Option<&'a str>,
    pub token: &'a str,
    pub group_ids: &'a [Uuid],
    pub created_by: Uuid,
    pub expires_at: DateTime<Utc>,
}

pub async fn insert(db: impl PgExecutor<'_>, i: NewInvite<'_>) -> sqlx::Result<Invitation> {
    sqlx::query_as!(
        Invitation,
        "INSERT INTO invitations (id, club_id, role, email, name, token, group_ids, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, club_id, role, email, name, token, group_ids, created_by, expires_at, sent_at, send_count, accepted_at, accepted_by, revoked_at, created_at",
        Uuid::now_v7(),
        i.club_id,
        i.role,
        i.email,
        i.name,
        i.token,
        i.group_ids,
        i.created_by,
        i.expires_at
    )
    .fetch_one(db)
    .await
}

/// New link (the old one stops working) and a new expiry.
pub async fn renew(
    db: impl PgExecutor<'_>,
    id: Uuid,
    token: &str,
    expires_at: DateTime<Utc>,
) -> sqlx::Result<Invitation> {
    sqlx::query_as!(
        Invitation,
        "UPDATE invitations SET token = $2, expires_at = $3 WHERE id = $1
         RETURNING id, club_id, role, email, name, token, group_ids, created_by, expires_at, sent_at, send_count, accepted_at, accepted_by, revoked_at, created_at",
        id,
        token,
        expires_at
    )
    .fetch_one(db)
    .await
}

/// The e-mail went out (set by the worker).
pub async fn mark_sent(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE invitations SET sent_at = now(), send_count = send_count + 1 WHERE id = $1",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn revoke(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE invitations SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Join (or rejoin) the club from an invite: membership, invite used, groups joined. Returns the membership.
pub async fn accept(
    tx: &mut PgConnection,
    invite: &Invitation,
    user_id: Uuid,
) -> sqlx::Result<Membership> {
    let m = sqlx::query_as!(
        Membership,
        "INSERT INTO memberships (id, club_id, user_id, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT (club_id, user_id) DO UPDATE SET role = $4, status = 'active', left_at = NULL, joined_at = now()
         RETURNING id, club_id, user_id, role, status, is_billing_owner, joined_at, left_at",
        Uuid::now_v7(),
        invite.club_id,
        user_id,
        invite.role
    )
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1",
        invite.id,
        user_id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "INSERT INTO group_members (group_id, membership_id)
         SELECT g.id, $2 FROM groups g WHERE g.club_id = $3 AND g.id = ANY($1) ON CONFLICT DO NOTHING",
        &invite.group_ids,
        m.id,
        invite.club_id
    )
    .execute(&mut *tx)
    .await?;
    Ok(m)
}

/// Active students now (plan limit checks).
pub async fn active_students(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM memberships WHERE club_id = $1 AND role = 'student' AND status = 'active'"#,
        club_id
    )
    .fetch_one(db)
    .await
}

/// Who invited (name), for the public invite page.
pub async fn inviter_name(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar!(
        "SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.id = $1",
        membership_id
    )
    .fetch_optional(db)
    .await
}
