//! The signed-in person's own data: profile, clubs, prefs, consents, notifications, export, deletion.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::models::{
    Branding, Club, Consent, Membership, MembershipContext, Notification, SubscriptionRow, Unread,
    User,
};

/// Active memberships in clubs that still exist, with branding and plan. Oldest membership first.
pub async fn memberships(
    db: &mut PgConnection,
    user_id: Uuid,
) -> sqlx::Result<Vec<MembershipContext>> {
    let rows = sqlx::query!(
        "SELECT m.id, m.club_id, m.user_id, m.role, m.status, m.is_billing_owner, m.joined_at, m.left_at,
                c.slug, c.name, c.city, c.state, c.timezone, c.modalities, c.trainer_label,
                c.created_at AS club_created_at, c.release_mode, c.auto_release_weekday,
                to_char(c.auto_release_time, 'HH24:MI') AS auto_release_time
           FROM memberships m JOIN clubs c ON c.id = m.club_id
          WHERE m.user_id = $1 AND m.status = 'active' AND c.deleted_at IS NULL
          ORDER BY m.joined_at",
        user_id
    )
    .fetch_all(&mut *db)
    .await?;
    let club_ids: Vec<Uuid> = rows.iter().map(|r| r.club_id).collect();

    let mut branding: HashMap<Uuid, Branding> = sqlx::query!(
        "SELECT club_id, primary_color, secondary_color, logo_asset_id, theme_rev, theme, theme_css
           FROM club_branding WHERE club_id = ANY($1)",
        &club_ids
    )
    .fetch_all(&mut *db)
    .await?
    .into_iter()
    .map(|b| {
        (
            b.club_id,
            Branding {
                primary_color: b.primary_color,
                secondary_color: b.secondary_color,
                logo_url: b.logo_asset_id.map(|id| format!("/v1/assets/{id}")),
                theme_rev: b.theme_rev,
                theme: b.theme,
                theme_css: b.theme_css,
            },
        )
    })
    .collect();

    let mut subscriptions: HashMap<Uuid, SubscriptionRow> = sqlx::query!(
        r#"SELECT s.club_id, s.plan, s.status, s.past_due_since, s.current_period_end, s.cancel_at_period_end,
                  s.stripe_customer_id IS NOT NULL AS "has_billing_account!",
                  (SELECT count(*) FROM memberships x
                    WHERE x.club_id = s.club_id AND x.role = 'student' AND x.status = 'active') AS "active_students!",
                  (SELECT count(*) FROM memberships x
                    WHERE x.club_id = s.club_id AND x.role = 'trainer' AND x.status = 'active') AS "active_trainers!"
             FROM club_subscriptions s WHERE s.club_id = ANY($1)"#,
        &club_ids
    )
    .fetch_all(&mut *db)
    .await?
    .into_iter()
    .map(|s| {
        (
            s.club_id,
            SubscriptionRow {
                plan: s.plan,
                status: s.status,
                past_due_since: s.past_due_since,
                current_period_end: s.current_period_end,
                cancel_at_period_end: s.cancel_at_period_end,
                has_billing_account: s.has_billing_account,
                active_students: s.active_students,
                active_trainers: s.active_trainers,
            },
        )
    })
    .collect();

    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let unread: HashMap<Uuid, Unread> = sqlx::query!(
        r#"SELECT m.id AS "id!",
                  (SELECT count(*) FROM conversations c
                     JOIN memberships s ON s.id = c.student_membership_id AND s.status = 'active'
                     JOIN messages x ON x.conversation_id = c.id
                     LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.membership_id = m.id
                    WHERE c.club_id = m.club_id
                      AND (m.role <> 'student' OR c.student_membership_id = m.id)
                      AND x.deleted_at IS NULL AND x.author_membership_id <> m.id
                      AND (r.last_read_at IS NULL OR x.created_at > r.last_read_at)) AS "messages!",
                  CASE WHEN m.role = 'student' THEN
                    (SELECT count(*) FROM announcements a
                      WHERE a.club_id = m.club_id AND a.deleted_at IS NULL
                        AND (cardinality(a.group_ids) = 0 OR EXISTS (
                              SELECT 1 FROM group_members g WHERE g.membership_id = m.id AND g.group_id = ANY (a.group_ids)))
                        AND NOT EXISTS (
                              SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.membership_id = m.id))
                  ELSE 0 END AS "announcements!",
                  -- Staff: the feedback inbox's unread count for this person, same window and rule as GET /feedback
                  -- (threads.rs): dated in the club's last 30 days, or a message / completion change in the last 30
                  -- days (any date); a message from someone else, or the student's completion comment, after their
                  -- last read of that workout. Opening the conversation (thread_reads) clears it.
                  CASE WHEN m.role <> 'student' THEN
                    (SELECT count(*) FROM planned_workouts p
                       JOIN clubs cl ON cl.id = p.club_id
                       LEFT JOIN workout_completions wc ON wc.planned_workout_id = p.id
                       LEFT JOIN thread_reads tr ON tr.membership_id = m.id AND tr.planned_workout_id = p.id
                      WHERE p.club_id = m.club_id
                        AND (p.date BETWEEN (now() AT TIME ZONE cl.timezone)::date - 30 AND (now() AT TIME ZONE cl.timezone)::date
                             OR EXISTS (SELECT 1 FROM comments x WHERE x.planned_workout_id = p.id AND x.deleted_at IS NULL
                                          AND x.created_at >= now() - interval '30 days')
                             OR wc.updated_at >= now() - interval '30 days')
                        AND (EXISTS (SELECT 1 FROM comments x
                                      WHERE x.planned_workout_id = p.id AND x.deleted_at IS NULL AND x.author_membership_id <> m.id
                                        AND (tr.last_read_at IS NULL OR x.created_at > tr.last_read_at))
                             OR (wc.comment IS NOT NULL AND wc.reported_at IS NOT NULL
                                 AND (tr.last_read_at IS NULL OR wc.reported_at > tr.last_read_at))))
                  ELSE 0 END AS "feedback!"
             FROM memberships m WHERE m.id = ANY ($1)"#,
        &ids
    )
    .fetch_all(&mut *db)
    .await?
    .into_iter()
    .map(|u| {
        (
            u.id,
            Unread {
                messages: u.messages,
                announcements: u.announcements,
                feedback: u.feedback,
            },
        )
    })
    .collect();

    Ok(rows
        .into_iter()
        .map(|r| MembershipContext {
            unread: unread.get(&r.id).copied().unwrap_or_default(),
            branding: branding.remove(&r.club_id),
            subscription: subscriptions.remove(&r.club_id).map(|s| s.view(&r.role)),
            club: Club {
                id: r.club_id,
                slug: r.slug,
                name: r.name,
                city: r.city,
                state: r.state,
                timezone: r.timezone,
                modalities: r.modalities,
                trainer_label: r.trainer_label,
                created_at: r.club_created_at,
                release_mode: r.release_mode,
                auto_release_weekday: r.auto_release_weekday,
                auto_release_time: r.auto_release_time,
            },
            membership: Membership {
                id: r.id,
                club_id: r.club_id,
                user_id: r.user_id,
                role: r.role,
                status: r.status,
                is_billing_owner: r.is_billing_owner,
                joined_at: r.joined_at,
                left_at: r.left_at,
            },
        })
        .collect())
}

pub async fn unread_notifications(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM notifications WHERE user_id = $1 AND read_at IS NULL"#,
        user_id
    )
    .fetch_one(db)
    .await
}

/// Profile fields to change. `Some(None)` clears a nullable field.
#[derive(Debug, Default)]
pub struct ProfilePatch {
    pub name: Option<String>,
    pub phone: Option<Option<String>>,
    pub birth_date: Option<Option<NaiveDate>>,
    pub sex: Option<Option<String>>,
    pub avatar_url: Option<Option<String>>,
}

pub async fn update_profile(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    p: ProfilePatch,
) -> sqlx::Result<Option<User>> {
    sqlx::query_as!(
        User,
        "UPDATE users SET
            name       = coalesce($2, name),
            phone      = CASE WHEN $3 THEN $4 ELSE phone END,
            birth_date = CASE WHEN $5 THEN $6 ELSE birth_date END,
            sex        = CASE WHEN $7 THEN $8 ELSE sex END,
            avatar_url = CASE WHEN $9 THEN $10 ELSE avatar_url END,
            updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING id, email, name, avatar_url, phone, birth_date, sex, locale, created_at",
        user_id,
        p.name,
        p.phone.is_some(),
        p.phone.flatten(),
        p.birth_date.is_some(),
        p.birth_date.flatten(),
        p.sex.is_some(),
        p.sex.flatten(),
        p.avatar_url.is_some(),
        p.avatar_url.flatten(),
    )
    .fetch_optional(db)
    .await
}

/// Owner of a club that's still open (closing the club is one way out, as the error message says).
pub async fn owns_a_club(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM memberships m JOIN clubs c ON c.id = m.club_id
                           WHERE m.user_id = $1 AND m.role = 'owner' AND m.status = 'active' AND c.deleted_at IS NULL) AS "x!""#,
        user_id
    )
    .fetch_one(db)
    .await
}

/// LGPD deletion: anonymize the person, leave every club, end every session and provider link, and
/// drop sign-in identities (the same Google account or e-mail can start over). Training history stays
/// with the clubs, attached to the anonymized account. Returns the ended sessions' token hashes (the session cache
/// drops them).
pub async fn delete_account(tx: &mut PgConnection, user_id: Uuid) -> sqlx::Result<Vec<Vec<u8>>> {
    sqlx::query!(
        "UPDATE users SET deleted_at = now(), updated_at = now(), email = 'deleted+' || id || '@runflow.club',
                name = 'Conta excluída', phone = NULL, birth_date = NULL, sex = NULL, avatar_url = NULL
          WHERE id = $1",
        user_id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("UPDATE memberships SET status = 'left', left_at = now() WHERE user_id = $1 AND status <> 'left'", user_id)
        .execute(&mut *tx)
        .await?;
    let ended = sqlx::query_scalar!(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING token_hash",
        user_id
    )
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE provider_connections SET status = 'revoked', access_token_enc = NULL, refresh_token_enc = NULL WHERE user_id = $1",
        user_id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("UPDATE consents SET revoked_at = now() WHERE user_id = $1 AND club_id IS NOT NULL AND revoked_at IS NULL", user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query!("DELETE FROM auth_identities WHERE user_id = $1", user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query!(
        "INSERT INTO audit_log (actor_user_id, action, target_type, target_id) VALUES ($1, 'account.deleted', 'user', $1)",
        user_id
    )
    .execute(&mut *tx)
    .await?;
    Ok(ended)
}

/// Everything about this person, as JSON (LGPD portability). Provider tokens are never included.
pub async fn export(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"WITH mine AS (SELECT id FROM memberships WHERE user_id = $1)
           SELECT jsonb_build_object(
             'exported_at', now(),
             'user', (SELECT to_jsonb(u) - 'deleted_at' FROM users u WHERE u.id = $1),
             'memberships', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.joined_at), '[]') FROM memberships m WHERE m.user_id = $1),
             'athlete_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]') FROM athlete_profiles a WHERE a.membership_id IN (SELECT id FROM mine)),
             'consents', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.granted_at), '[]') FROM consents c WHERE c.user_id = $1),
             'connections', (SELECT coalesce(jsonb_agg(to_jsonb(p) - 'access_token_enc' - 'refresh_token_enc'), '[]') FROM provider_connections p WHERE p.user_id = $1),
             'activities', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.started_at), '[]') FROM activities x WHERE x.user_id = $1),
             'planned_workouts', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.date), '[]') FROM planned_workouts p WHERE p.athlete_membership_id IN (SELECT id FROM mine)
                AND coalesce(workout_released(p.club_id, p.athlete_membership_id, p.date), false)),
             'completions', (SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM workout_completions c
                              JOIN planned_workouts p ON p.id = c.planned_workout_id WHERE p.athlete_membership_id IN (SELECT id FROM mine)),
             'comments', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.created_at), '[]') FROM comments c WHERE c.author_membership_id IN (SELECT id FROM mine)),
             'notifications', (SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC), '[]') FROM notifications n WHERE n.user_id = $1)
           ) AS "export!""#,
        user_id
    )
    .fetch_one(db)
    .await
}

// ------------------------------------------------------------------------------------ consents

pub async fn consents(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<Vec<Consent>> {
    sqlx::query_as!(
        Consent,
        "SELECT id, user_id, club_id, kind, text_version, granted_at, revoked_at FROM consents WHERE user_id = $1 ORDER BY granted_at",
        user_id
    )
    .fetch_all(db)
    .await
}

pub async fn active_consent(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    club_id: Option<Uuid>,
    kind: &str,
) -> sqlx::Result<Option<Consent>> {
    sqlx::query_as!(
        Consent,
        "SELECT id, user_id, club_id, kind, text_version, granted_at, revoked_at FROM consents
          WHERE user_id = $1 AND club_id IS NOT DISTINCT FROM $2 AND kind = $3 AND revoked_at IS NULL",
        user_id,
        club_id,
        kind
    )
    .fetch_optional(db)
    .await
}

pub async fn grant_consent(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    club_id: Option<Uuid>,
    kind: &str,
    text_version: &str,
) -> sqlx::Result<Consent> {
    sqlx::query_as!(
        Consent,
        "INSERT INTO consents (id, user_id, club_id, kind, text_version) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, club_id, kind, text_version, granted_at, revoked_at",
        Uuid::now_v7(),
        user_id,
        club_id,
        kind,
        text_version
    )
    .fetch_one(db)
    .await
}

pub async fn consent(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Consent>> {
    sqlx::query_as!(
        Consent,
        "SELECT id, user_id, club_id, kind, text_version, granted_at, revoked_at FROM consents WHERE id = $1 AND user_id = $2",
        id,
        user_id
    )
    .fetch_optional(db)
    .await
}

pub async fn revoke_consent(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE consents SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn is_member(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    club_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM memberships m JOIN clubs c ON c.id = m.club_id
                           WHERE m.user_id = $1 AND m.club_id = $2 AND m.status = 'active' AND c.deleted_at IS NULL) AS "x!""#,
        user_id,
        club_id
    )
    .fetch_one(db)
    .await
}

// ------------------------------------------------------------------------------------ notifications

/// Newest first, keyset-paginated on `(created_at, id)`.
pub async fn notifications(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    before: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> sqlx::Result<Vec<Notification>> {
    let (at, id) = before.unzip();
    sqlx::query_as!(
        Notification,
        "SELECT id, user_id, club_id, kind, title, body, link, read_at, created_at FROM notifications
          WHERE user_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3))
          ORDER BY created_at DESC, id DESC LIMIT $4",
        user_id,
        at,
        id,
        limit
    )
    .fetch_all(db)
    .await
}

/// Mark as read: the given ids, or everything when `ids` is `None`.
pub async fn read_notifications(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    ids: Option<&[Uuid]>,
) -> sqlx::Result<u64> {
    let r = sqlx::query!(
        "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))",
        user_id,
        ids as Option<&[Uuid]>
    )
    .execute(db)
    .await?;
    Ok(r.rows_affected())
}
