//! Notifications (W11, D-045): every notification is created here and always lands in the person's center; it is
//! also queued for push when the person keeps that kind switched on, hasn't paused push and has a device. There are
//! no notification e-mails.

use chrono::Utc;
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

/// Create a notification, and queue its push when the recipient's switches allow it.
pub async fn create(db: &mut PgConnection, n: New<'_>) -> sqlx::Result<Uuid> {
    let p = sqlx::query!(
        r#"SELECT p.kinds AS "kinds?", coalesce(p.paused, false) AS "paused!",
                  EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id = $1) AS "has_device!"
             FROM (SELECT 1) one LEFT JOIN notification_prefs p ON p.user_id = $1"#,
        n.user_id
    )
    .fetch_one(&mut *db)
    .await?;
    let kinds = p.kinds.unwrap_or_else(|| json!({}));
    let push_at = notify::pushes(&kinds, n.kind, p.paused, p.has_device).then(Utc::now);
    let id = sqlx::query_scalar!(
        "INSERT INTO notifications (id, user_id, club_id, kind, title, body, link, push_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        Uuid::now_v7(),
        n.user_id,
        n.club_id,
        n.kind,
        n.title,
        n.body,
        n.link,
        push_at
    )
    .fetch_one(&mut *db)
    .await?;
    if push_at.is_some() {
        crate::jobs::enqueue(&mut *db, PUSH_SEND, &json!({ "notification_id": id }), None).await?;
    }
    Ok(id)
}

/// The worker's job that pushes a notification to the person's devices.
pub const PUSH_SEND: &str = "push.send";

/// What a club notice says (the recipient comes separately).
pub struct Notice<'a> {
    pub club_id: Uuid,
    pub kind: &'a str,
    pub title: &'a str,
    pub body: Option<&'a str>,
    pub link: &'a str,
}

/// To the person behind a membership. `_about` (the student a notice concerns) fed the staff group filter that
/// D-045 removed; it stays in this signature and `to_staff`'s until the billing v2 work merges, then goes.
pub async fn to_member(
    db: &mut PgConnection,
    membership_id: Uuid,
    n: Notice<'_>,
    _about: Option<Uuid>,
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
    )
    .await?;
    Ok(())
}

/// To every active staff member of the club.
pub async fn to_staff(
    db: &mut PgConnection,
    n: Notice<'_>,
    _about: Option<Uuid>,
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
        )
        .await?;
    }
    Ok(())
}

// ------------------------------------------------------------------------------------ preferences

/// What a person switched: push per kind (`{"<kind>": {"push": bool}}`, defaults elsewhere) and the pause.
pub struct Prefs {
    pub kinds: Value,
    pub paused: bool,
}

/// The stored choices, or the defaults.
pub async fn prefs(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<Prefs> {
    Ok(sqlx::query_as!(
        Prefs,
        "SELECT kinds, paused FROM notification_prefs WHERE user_id = $1",
        user_id
    )
    .fetch_optional(db)
    .await?
    .unwrap_or(Prefs {
        kinds: json!({}),
        paused: false,
    }))
}

pub async fn save_prefs(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    kinds: &Value,
    paused: bool,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO notification_prefs (user_id, kinds, paused) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET kinds = $2, paused = $3, updated_at = now()",
        user_id,
        kinds,
        paused
    )
    .execute(db)
    .await?;
    Ok(())
}
