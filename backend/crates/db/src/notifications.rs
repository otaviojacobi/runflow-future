//! Notifications (W11) under each person's control (D-032): every notification is created here, with the
//! recipient's choices applied, and the worker delivers the e-mails it still owes.

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use runflow_domain::notify;
use serde_json::{Value, json};
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

pub struct New<'a> {
    pub user_id: Uuid,
    pub club_id: Option<Uuid>,
    pub kind: &'a str,
    pub title: &'a str,
    pub body: Option<&'a str>,
    pub link: &'a str,
}

/// Create a notification as the recipient wants it. `about`: the student it concerns, for the staff group filter.
/// `None` when the person chose not to get it.
pub async fn create(
    db: &mut PgConnection,
    n: New<'_>,
    about: Option<Uuid>,
) -> sqlx::Result<Option<Uuid>> {
    let p = sqlx::query!(
        r#"SELECT p.kinds AS "kinds?", coalesce(p.paused, false) AS "paused!",
                  (SELECT f.group_ids FROM notification_group_filters f JOIN memberships m ON m.id = f.membership_id
                    WHERE m.user_id = $1 AND m.club_id = $2 AND m.role <> 'student' AND m.status = 'active') AS "filter?"
             FROM (SELECT 1) one LEFT JOIN notification_prefs p ON p.user_id = $1"#,
        n.user_id,
        n.club_id
    )
    .fetch_one(&mut *db)
    .await?;
    if let (Some(student), Some(groups)) = (about, p.filter.filter(|g| !g.is_empty()))
        && notify::filtered_by_group(n.kind)
        && !sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM group_members WHERE membership_id = $1 AND group_id = ANY($2)) AS "x!""#,
            student,
            &groups
        )
        .fetch_one(&mut *db)
        .await?
    {
        return Ok(None);
    }
    let pref = notify::resolve(&p.kinds.unwrap_or_else(|| json!({})), n.kind);
    let Some((in_app, email)) = notify::delivery(pref, p.paused) else {
        return Ok(None);
    };
    sqlx::query_scalar!(
        "INSERT INTO notifications (id, user_id, club_id, kind, title, body, link, in_app, email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
        Uuid::now_v7(),
        n.user_id,
        n.club_id,
        n.kind,
        n.title,
        n.body,
        n.link,
        in_app,
        email
    )
    .fetch_one(&mut *db)
    .await
    .map(Some)
}

/// What a club notice says (the recipient comes separately).
pub struct Notice<'a> {
    pub club_id: Uuid,
    pub kind: &'a str,
    pub title: &'a str,
    pub body: Option<&'a str>,
    pub link: &'a str,
}

/// To the person behind a membership.
pub async fn to_member(
    db: &mut PgConnection,
    membership_id: Uuid,
    n: Notice<'_>,
    about: Option<Uuid>,
) -> sqlx::Result<()> {
    let Some(user_id) = sqlx::query_scalar!(
        "SELECT user_id FROM memberships WHERE id = $1",
        membership_id
    )
    .fetch_optional(&mut *db)
    .await?
    else {
        return Ok(());
    };
    create(
        db,
        New {
            user_id,
            club_id: Some(n.club_id),
            kind: n.kind,
            title: n.title,
            body: n.body,
            link: n.link,
        },
        about,
    )
    .await?;
    Ok(())
}

/// To every active staff member of the club.
pub async fn to_staff(
    db: &mut PgConnection,
    n: Notice<'_>,
    about: Option<Uuid>,
) -> sqlx::Result<()> {
    let staff = sqlx::query_scalar!(
        "SELECT user_id FROM memberships WHERE club_id = $1 AND role <> 'student' AND status = 'active'",
        n.club_id
    )
    .fetch_all(&mut *db)
    .await?;
    for user_id in staff {
        create(
            db,
            New {
                user_id,
                club_id: Some(n.club_id),
                kind: n.kind,
                title: n.title,
                body: n.body,
                link: n.link,
            },
            about,
        )
        .await?;
    }
    Ok(())
}

// ------------------------------------------------------------------------------------ preferences

pub struct Prefs {
    pub kinds: Value,
    pub digest_hour: i16,
    pub quiet_start: Option<String>,
    pub quiet_end: Option<String>,
    pub paused: bool,
}

/// The stored choices, or the defaults.
pub async fn prefs(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<Prefs> {
    Ok(sqlx::query_as!(
        Prefs,
        r#"SELECT kinds, digest_hour, to_char(quiet_start, 'HH24:MI') AS quiet_start, to_char(quiet_end, 'HH24:MI') AS quiet_end, paused
             FROM notification_prefs WHERE user_id = $1"#,
        user_id
    )
    .fetch_optional(db)
    .await?
    .unwrap_or(Prefs {
        kinds: json!({}),
        digest_hour: 7,
        quiet_start: Some("22:00".into()),
        quiet_end: Some("07:00".into()),
        paused: false,
    }))
}

pub async fn save_prefs(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    kinds: &Value,
    digest_hour: i16,
    quiet: Option<(NaiveTime, NaiveTime)>,
    paused: bool,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO notification_prefs (user_id, kinds, digest_hour, quiet_start, quiet_end, paused)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET kinds = $2, digest_hour = $3, quiet_start = $4, quiet_end = $5, paused = $6, updated_at = now()",
        user_id,
        kinds,
        digest_hour,
        quiet.map(|q| q.0),
        quiet.map(|q| q.1),
        paused
    )
    .execute(db)
    .await?;
    Ok(())
}

/// The caller's staff memberships with their group filters: `[{club_id, membership_id, group_ids}]`.
pub async fn group_filters(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<Vec<Value>> {
    let rows = sqlx::query!(
        r#"SELECT m.club_id, m.id, coalesce(f.group_ids, '{}') AS "group_ids!"
             FROM memberships m JOIN clubs c ON c.id = m.club_id LEFT JOIN notification_group_filters f ON f.membership_id = m.id
            WHERE m.user_id = $1 AND m.status = 'active' AND m.role <> 'student' AND c.deleted_at IS NULL
            ORDER BY m.joined_at"#,
        user_id
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| json!({ "club_id": r.club_id, "membership_id": r.id, "group_ids": r.group_ids }))
        .collect())
}

/// Replace a club's filter for a staff member (only that club's groups are kept). `false` = not staff there.
pub async fn set_group_filter(
    db: &mut PgConnection,
    user_id: Uuid,
    club_id: Uuid,
    group_ids: &[Uuid],
) -> sqlx::Result<bool> {
    let Some(membership) = sqlx::query_scalar!(
        "SELECT id FROM memberships WHERE user_id = $1 AND club_id = $2 AND status = 'active' AND role <> 'student'",
        user_id,
        club_id
    )
    .fetch_optional(&mut *db)
    .await?
    else {
        return Ok(false);
    };
    sqlx::query!(
        "INSERT INTO notification_group_filters (membership_id, group_ids)
         SELECT $1, coalesce(array_agg(g.id), '{}') FROM groups g WHERE g.club_id = $2 AND g.id = ANY($3)
         ON CONFLICT (membership_id) DO UPDATE SET group_ids = excluded.group_ids, updated_at = now()",
        membership,
        club_id,
        group_ids
    )
    .execute(&mut *db)
    .await?;
    Ok(true)
}

// ------------------------------------------------------------------------------------ e-mail delivery

pub struct Pending {
    pub id: Uuid,
    pub email: String,
    pub club_id: Option<Uuid>,
    pub title: String,
    pub body: Option<String>,
    pub link: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Claim instant e-mails to send now (marked sent; `unsend` puts one back if sending fails).
pub async fn claim_instant(db: impl PgExecutor<'_>, limit: i64) -> sqlx::Result<Vec<Pending>> {
    sqlx::query_as!(
        Pending,
        r#"UPDATE notifications n SET email = 'sent'
             FROM users u
            WHERE n.id IN (SELECT id FROM notifications WHERE email = 'instant' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
              AND u.id = n.user_id AND u.deleted_at IS NULL
        RETURNING n.id, u.email, n.club_id, n.title, n.body, n.link, n.created_at"#,
        limit
    )
    .fetch_all(db)
    .await
}

pub async fn unsend(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE notifications SET email = 'instant' WHERE id = $1",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}

/// People with a summary pending: `(user_id, e-mail, digest_hour, last_digest_on)`.
pub async fn digest_candidates(
    db: impl PgExecutor<'_>,
) -> sqlx::Result<Vec<(Uuid, String, i16, Option<NaiveDate>)>> {
    let rows = sqlx::query!(
        r#"SELECT u.id, u.email, coalesce(p.digest_hour, 7::smallint) AS "digest_hour!", p.last_digest_on
             FROM users u LEFT JOIN notification_prefs p ON p.user_id = u.id
            WHERE u.deleted_at IS NULL AND EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.email = 'digest')"#
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.id, r.email, r.digest_hour, r.last_digest_on))
        .collect())
}

/// Take a person's pending summary items (marked sent) and record the day.
pub async fn take_digest(
    db: &mut PgConnection,
    user_id: Uuid,
    day: NaiveDate,
) -> sqlx::Result<Vec<Pending>> {
    let items = sqlx::query_as!(
        Pending,
        r#"UPDATE notifications n SET email = 'sent' FROM users u
            WHERE n.user_id = $1 AND n.email = 'digest' AND u.id = n.user_id
        RETURNING n.id, u.email, n.club_id, n.title, n.body, n.link, n.created_at"#,
        user_id
    )
    .fetch_all(&mut *db)
    .await?;
    sqlx::query!(
        "INSERT INTO notification_prefs (user_id, last_digest_on) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET last_digest_on = $2",
        user_id,
        day
    )
    .execute(&mut *db)
    .await?;
    Ok(items)
}
