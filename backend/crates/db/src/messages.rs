//! Messages (W13, M10): one conversation per student shared by the club's staff (D-017), and the club's
//! announcements (the "mural") with read receipts. Shapes mirror api/mock/routes/messages.mjs; people and messages
//! come out of the SQL functions `user_json` and `message_json` (api/schema.sql).

use serde_json::Value;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

pub struct Conversation {
    pub id: Uuid,
    pub student_membership_id: Uuid,
}

pub async fn conversation(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Conversation>> {
    sqlx::query_as!(
        Conversation,
        "SELECT id, student_membership_id FROM conversations WHERE id = $1 AND club_id = $2",
        id,
        club_id
    )
    .fetch_optional(db)
    .await
}

/// The student's conversation, created on first use.
pub async fn get_or_create(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    student: Uuid,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO conversations (club_id, student_membership_id) VALUES ($1, $2)
         ON CONFLICT (club_id, student_membership_id) DO UPDATE SET club_id = excluded.club_id RETURNING id",
        club_id,
        student
    )
    .fetch_one(db)
    .await
}

/// `{…conversation, student {membership_id, user}, last_message, unread_count}` as `viewer` sees it.
pub async fn summary(db: impl PgExecutor<'_>, id: Uuid, viewer: Uuid) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"SELECT jsonb_build_object(
                  'id', c.id, 'club_id', c.club_id, 'student_membership_id', c.student_membership_id,
                  'last_message_at', c.last_message_at, 'created_at', c.created_at,
                  'student', jsonb_build_object('membership_id', s.id, 'user', user_json(u)),
                  'last_message', (SELECT message_json(x) FROM messages x WHERE x.conversation_id = c.id ORDER BY x.created_at DESC LIMIT 1),
                  'unread_count', (SELECT count(*) FROM messages x
                                     LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.membership_id = $2
                                    WHERE x.conversation_id = c.id AND x.deleted_at IS NULL AND x.author_membership_id <> $2
                                      AND (r.last_read_at IS NULL OR x.created_at > r.last_read_at))) AS "x!"
             FROM conversations c JOIN memberships s ON s.id = c.student_membership_id JOIN users u ON u.id = s.user_id
            WHERE c.id = $1"#,
        id,
        viewer
    )
    .fetch_one(db)
    .await
}

/// Staff's list: every active student (`id: null` until the first message), conversations with messages first.
pub async fn staff_list(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    viewer: Uuid,
    q: Option<&str>,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT jsonb_build_object(
                  'id', c.id, 'club_id', m.club_id, 'student_membership_id', m.id,
                  'last_message_at', c.last_message_at, 'created_at', c.created_at,
                  'student', jsonb_build_object('membership_id', m.id, 'user', user_json(u)),
                  'last_message', (SELECT message_json(x) FROM messages x WHERE x.conversation_id = c.id ORDER BY x.created_at DESC LIMIT 1),
                  'unread_count', (SELECT count(*) FROM messages x
                                     LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.membership_id = $2
                                    WHERE x.conversation_id = c.id AND x.deleted_at IS NULL AND x.author_membership_id <> $2
                                      AND (r.last_read_at IS NULL OR x.created_at > r.last_read_at))) AS "x!"
             FROM memberships m JOIN users u ON u.id = m.user_id
             LEFT JOIN conversations c ON c.club_id = m.club_id AND c.student_membership_id = m.id
            WHERE m.club_id = $1 AND m.role = 'student' AND m.status = 'active'
              AND ($3::text IS NULL OR u.name ILIKE '%' || $3 || '%')
            ORDER BY c.last_message_at DESC NULLS LAST, u.name"#,
        club_id,
        viewer,
        q
    )
    .fetch_all(db)
    .await
}

pub async fn messages(db: impl PgExecutor<'_>, conversation_id: Uuid) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT message_json(x) AS "x!" FROM messages x WHERE x.conversation_id = $1 ORDER BY x.created_at"#,
        conversation_id
    )
    .fetch_all(db)
    .await
}

/// The other participants' read marks (`{membership_id, user, role, last_read_at}`), for "Visto".
pub async fn reads(
    db: impl PgExecutor<'_>,
    conversation_id: Uuid,
    viewer: Uuid,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT jsonb_build_object('membership_id', m.id, 'user', user_json(u), 'role', m.role, 'last_read_at', r.last_read_at) AS "x!"
             FROM conversation_reads r JOIN memberships m ON m.id = r.membership_id JOIN users u ON u.id = m.user_id
            WHERE r.conversation_id = $1 AND r.membership_id <> $2
            ORDER BY r.last_read_at DESC"#,
        conversation_id,
        viewer
    )
    .fetch_all(db)
    .await
}

pub async fn mark_read(
    db: impl PgExecutor<'_>,
    conversation_id: Uuid,
    membership_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO conversation_reads (conversation_id, membership_id, last_read_at) VALUES ($1, $2, now())
         ON CONFLICT (conversation_id, membership_id) DO UPDATE SET last_read_at = now()",
        conversation_id,
        membership_id
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Send: the message (as JSON), the conversation's last activity, and the author's own read mark.
pub async fn send(
    db: &mut PgConnection,
    conversation_id: Uuid,
    author: Uuid,
    body: &str,
) -> sqlx::Result<Value> {
    let id = sqlx::query_scalar!(
        "INSERT INTO messages (id, conversation_id, author_membership_id, body) VALUES ($1, $2, $3, $4) RETURNING id",
        Uuid::now_v7(),
        conversation_id,
        author,
        body
    )
    .fetch_one(&mut *db)
    .await?;
    sqlx::query!(
        "UPDATE conversations SET last_message_at = now() WHERE id = $1",
        conversation_id
    )
    .execute(&mut *db)
    .await?;
    mark_read(&mut *db, conversation_id, author).await?;
    sqlx::query_scalar!(
        r#"SELECT message_json(x) AS "x!" FROM messages x WHERE x.id = $1"#,
        id
    )
    .fetch_one(&mut *db)
    .await
}

/// The author deletes their message (kept, shown as deleted). `false` = not theirs or not found.
pub async fn delete_message(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
    author: Uuid,
) -> sqlx::Result<bool> {
    let r = sqlx::query!(
        "UPDATE messages x SET deleted_at = now() FROM conversations c
          WHERE x.id = $1 AND x.author_membership_id = $3 AND c.id = x.conversation_id AND c.club_id = $2",
        id,
        club_id,
        author
    )
    .execute(db)
    .await?;
    Ok(r.rows_affected() > 0)
}

/// Active staff memberships (a student's message notifies them all).
pub async fn staff(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!(
        "SELECT id FROM memberships WHERE club_id = $1 AND role <> 'student' AND status = 'active'",
        club_id
    )
    .fetch_all(db)
    .await
}

// ------------------------------------------------------------------------------------ announcements (mural)

/// The mural as `viewer` sees it: students only club-wide ones and their groups'; staff also get
/// `audience_count` and `reads_count`. Pinned first, then newest.
pub async fn announcements(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    viewer: Uuid,
    staff: bool,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT jsonb_build_object(
                  'id', a.id, 'club_id', a.club_id, 'author_membership_id', a.author_membership_id, 'title', a.title, 'body', a.body,
                  'group_ids', a.group_ids, 'pinned', a.pinned, 'created_at', a.created_at, 'edited_at', a.edited_at, 'deleted_at', a.deleted_at,
                  'author', jsonb_build_object('membership_id', am.id, 'user', user_json(au)),
                  'read_at', (SELECT read_at FROM announcement_reads WHERE announcement_id = a.id AND membership_id = $2))
                || CASE WHEN $3 THEN jsonb_build_object(
                  'audience_count', (SELECT count(*) FROM announcement_audience(a)),
                  'reads_count', (SELECT count(*) FROM announcement_reads r WHERE r.announcement_id = a.id
                                    AND r.membership_id IN (SELECT id FROM announcement_audience(a))))
                   ELSE '{}'::jsonb END AS "x!"
             FROM announcements a JOIN memberships am ON am.id = a.author_membership_id JOIN users au ON au.id = am.user_id
            WHERE a.club_id = $1 AND a.deleted_at IS NULL
              AND ($3 OR cardinality(a.group_ids) = 0
                   OR EXISTS (SELECT 1 FROM group_members g WHERE g.membership_id = $2 AND g.group_id = ANY(a.group_ids)))
            ORDER BY a.pinned DESC, a.created_at DESC"#,
        club_id,
        viewer,
        staff
    )
    .fetch_all(db)
    .await
}

pub struct NewAnnouncement<'a> {
    pub title: &'a str,
    pub body: &'a str,
    pub group_ids: &'a [Uuid],
    pub pinned: bool,
}

/// Publish; returns the id and its audience (active students it reaches).
pub async fn publish(
    db: &mut PgConnection,
    club_id: Uuid,
    author: Uuid,
    a: NewAnnouncement<'_>,
) -> sqlx::Result<(Uuid, Vec<Uuid>)> {
    let id = sqlx::query_scalar!(
        "INSERT INTO announcements (id, club_id, author_membership_id, title, body, group_ids, pinned)
         VALUES ($1, $2, $3, $4, $5, ARRAY(SELECT id FROM groups WHERE club_id = $2 AND id = ANY($6)), $7)
         RETURNING id",
        Uuid::now_v7(),
        club_id,
        author,
        a.title,
        a.body,
        a.group_ids,
        a.pinned
    )
    .fetch_one(&mut *db)
    .await?;
    Ok((id, audience(&mut *db, id).await?))
}

/// Active students an announcement reaches.
pub async fn audience(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!(
        r#"SELECT au.id AS "id!" FROM announcements a, LATERAL announcement_audience(a) au WHERE a.id = $1"#,
        id
    )
    .fetch_all(db)
    .await
}

pub struct AnnouncementPatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub pinned: Option<bool>,
    pub group_ids: Option<Vec<Uuid>>,
}

pub async fn update_announcement(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
    p: AnnouncementPatch,
) -> sqlx::Result<bool> {
    let r = sqlx::query!(
        "UPDATE announcements SET
            title = coalesce($3, title), body = coalesce($4, body), pinned = coalesce($5, pinned),
            group_ids = CASE WHEN $6::uuid[] IS NULL THEN group_ids
                             ELSE ARRAY(SELECT g.id FROM groups g WHERE g.club_id = $2 AND g.id = ANY($6)) END,
            edited_at = CASE WHEN $3::text IS NOT NULL OR $4::text IS NOT NULL THEN now() ELSE edited_at END
          WHERE id = $1 AND club_id = $2 AND deleted_at IS NULL",
        id,
        club_id,
        p.title,
        p.body,
        p.pinned,
        p.group_ids.as_deref()
    )
    .execute(db)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete_announcement(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<bool> {
    let r = sqlx::query!(
        "UPDATE announcements SET deleted_at = now() WHERE id = $1 AND club_id = $2 AND deleted_at IS NULL",
        id,
        club_id
    )
    .execute(db)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn read_announcements(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    membership_id: Uuid,
    ids: &[Uuid],
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO announcement_reads (announcement_id, membership_id)
         SELECT a.id, $2 FROM announcements a WHERE a.club_id = $1 AND a.id = ANY($3)
         ON CONFLICT DO NOTHING",
        club_id,
        membership_id,
        ids
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Who an announcement reached and who read it: `[{membership_id, user, read_at}]`, readers first.
pub async fn announcement_reads(
    db: &mut PgConnection,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Vec<Value>>> {
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM announcements WHERE id = $1 AND club_id = $2 AND deleted_at IS NULL) AS "x!""#,
        id,
        club_id
    )
    .fetch_one(&mut *db)
    .await?;
    if !exists {
        return Ok(None);
    }
    Ok(Some(
        sqlx::query_scalar!(
            r#"SELECT jsonb_build_object('membership_id', m.id, 'user', user_json(u), 'read_at', r.read_at) AS "x!"
                 FROM announcements a CROSS JOIN LATERAL announcement_audience(a) au
                 JOIN memberships m ON m.id = au.id JOIN users u ON u.id = m.user_id
                 LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.membership_id = m.id
                WHERE a.id = $1
                ORDER BY r.read_at IS NULL, u.name"#,
            id
        )
        .fetch_all(&mut *db)
        .await?,
    ))
}
