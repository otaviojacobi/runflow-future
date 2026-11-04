//! Members (O2), groups (W2), leaving a club (C1).

use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::models::{Group, Member, Membership, User};

/// Members except those who left (or exactly `status`), optionally limited to `roles`, with their groups.
pub async fn list(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    roles: Option<&[String]>,
    status: Option<&str>,
) -> sqlx::Result<Vec<Member>> {
    let rows = sqlx::query!(
        r#"SELECT m.id, m.club_id, m.user_id, m.role, m.status, m.is_billing_owner, m.joined_at, m.left_at,
                  u.email, u.name, u.avatar_url, u.phone, u.birth_date, u.sex, u.locale, u.created_at,
                  coalesce((SELECT array_agg(g.group_id ORDER BY g.added_at) FROM group_members g WHERE g.membership_id = m.id), '{}') AS "group_ids!"
             FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.club_id = $1
              AND ($2::text[] IS NULL OR m.role = ANY($2))
              AND (CASE WHEN $3::text IS NULL THEN m.status <> 'left' ELSE m.status = $3 END)"#,
        club_id,
        roles,
        status
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Member {
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
            user: User {
                id: r.user_id,
                email: r.email,
                name: r.name,
                avatar_url: r.avatar_url,
                phone: r.phone,
                birth_date: r.birth_date,
                sex: r.sex,
                locale: r.locale,
                created_at: r.created_at,
            },
            group_ids: r.group_ids,
        })
        .collect())
}

pub async fn membership(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Membership>> {
    sqlx::query_as!(
        Membership,
        "SELECT id, club_id, user_id, role, status, is_billing_owner, joined_at, left_at FROM memberships WHERE club_id = $1 AND id = $2",
        club_id,
        id
    )
    .fetch_optional(db)
    .await
}

pub async fn update(
    db: impl PgExecutor<'_>,
    id: Uuid,
    role: Option<&str>,
    status: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE memberships SET role = coalesce($2, role), status = coalesce($3, status) WHERE id = $1",
        id,
        role,
        status
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Out of the club: status `left`, out of its groups. With `revoke_consents`, also revoke this club's
/// sharing consents (when the person leaves by themselves, C1).
pub async fn leave(
    tx: &mut PgConnection,
    membership_id: Uuid,
    revoke_consents: bool,
) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE memberships SET status = 'left', left_at = now() WHERE id = $1",
        membership_id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "DELETE FROM group_members WHERE membership_id = $1",
        membership_id
    )
    .execute(&mut *tx)
    .await?;
    if revoke_consents {
        sqlx::query!(
            "UPDATE consents c SET revoked_at = now() FROM memberships m
              WHERE m.id = $1 AND c.user_id = m.user_id AND c.club_id = m.club_id AND c.revoked_at IS NULL",
            membership_id
        )
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

pub async fn other_active_owners(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    except: Uuid,
) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM memberships WHERE club_id = $1 AND role = 'owner' AND status = 'active' AND id <> $2"#,
        club_id,
        except
    )
    .fetch_one(db)
    .await
}

// ------------------------------------------------------------------------------------ groups

pub async fn groups(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Group>> {
    sqlx::query_as!(
        Group,
        r#"SELECT g.id, g.club_id, g.name, g.description, g.created_at,
                  coalesce((SELECT array_agg(x.membership_id ORDER BY x.added_at) FROM group_members x WHERE x.group_id = g.id), '{}') AS "member_ids!"
             FROM groups g WHERE g.club_id = $1"#,
        club_id
    )
    .fetch_all(db)
    .await
}

pub async fn group(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Group>> {
    sqlx::query_as!(
        Group,
        r#"SELECT g.id, g.club_id, g.name, g.description, g.created_at,
                  coalesce((SELECT array_agg(x.membership_id ORDER BY x.added_at) FROM group_members x WHERE x.group_id = g.id), '{}') AS "member_ids!"
             FROM groups g WHERE g.club_id = $1 AND g.id = $2"#,
        club_id,
        id
    )
    .fetch_optional(db)
    .await
}

pub async fn group_name_taken(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    name: &str,
    except: Option<Uuid>,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM groups WHERE club_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3) AS "x!""#,
        club_id,
        name,
        except
    )
    .fetch_one(db)
    .await
}

pub async fn insert_group(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    name: &str,
    description: Option<&str>,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO groups (id, club_id, name, description) VALUES ($1, $2, $3, $4) RETURNING id",
        Uuid::now_v7(),
        club_id,
        name,
        description
    )
    .fetch_one(db)
    .await
}

pub async fn update_group(
    db: impl PgExecutor<'_>,
    id: Uuid,
    name: Option<&str>,
    description: Option<Option<&str>>,
) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE groups SET name = coalesce($2, name), description = CASE WHEN $3 THEN $4 ELSE description END WHERE id = $1",
        id,
        name,
        description.is_some(),
        description.flatten()
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn delete_group(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("DELETE FROM groups WHERE id = $1", id)
        .execute(db)
        .await?;
    Ok(())
}

/// Replace a group's members with the given memberships of the same club (others are ignored).
pub async fn set_group_members(
    tx: &mut PgConnection,
    club_id: Uuid,
    group_id: Uuid,
    membership_ids: &[Uuid],
) -> sqlx::Result<()> {
    sqlx::query!("DELETE FROM group_members WHERE group_id = $1", group_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query!(
        "INSERT INTO group_members (group_id, membership_id)
         SELECT $1, m.id FROM memberships m WHERE m.club_id = $2 AND m.status <> 'left' AND m.id = ANY($3)
         ON CONFLICT DO NOTHING",
        group_id,
        club_id,
        membership_ids
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Puts one member in exactly these groups of the club: joins the missing ones, leaves the club's others (W2, W3,
/// O2). False, with nothing changed, when an id isn't one of the club's groups.
pub async fn set_member_groups(
    tx: &mut PgConnection,
    club_id: Uuid,
    membership_id: Uuid,
    group_ids: &[Uuid],
) -> sqlx::Result<bool> {
    let mut wanted = group_ids.to_vec();
    wanted.sort();
    wanted.dedup();
    let known = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM groups WHERE club_id = $1 AND id = ANY($2)"#,
        club_id,
        &wanted
    )
    .fetch_one(&mut *tx)
    .await?;
    if known != wanted.len() as i64 {
        return Ok(false);
    }
    sqlx::query!(
        "DELETE FROM group_members x USING groups g
          WHERE x.group_id = g.id AND g.club_id = $1 AND x.membership_id = $2 AND NOT (x.group_id = ANY($3))",
        club_id,
        membership_id,
        &wanted
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "INSERT INTO group_members (group_id, membership_id)
         SELECT g.id, $2 FROM groups g WHERE g.club_id = $1 AND g.id = ANY($3)
         ON CONFLICT DO NOTHING",
        club_id,
        membership_id,
        &wanted
    )
    .execute(&mut *tx)
    .await?;
    Ok(true)
}

/// An active student of the club (staff act on students: sign-ups, assessments, conversations).
pub async fn is_active_student(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    membership_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM memberships WHERE id = $1 AND club_id = $2 AND role = 'student' AND status = 'active') AS "x!""#,
        membership_id,
        club_id
    )
    .fetch_one(db)
    .await
}
