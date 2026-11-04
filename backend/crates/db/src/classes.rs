//! Aulas (D-052; endpoints.md § Aulas): venues, class types, recurring weekly schedules, sessions (8 weeks ahead),
//! bookings with a waitlist, check-in and attendance. Shapes and rules mirror api/mock/routes/scheduling.mjs; the
//! JSON is built here so rows look exactly like the mock's (the row's columns plus the computed fields).

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use crate::notifications::{self, Notice};

/// Sessions exist from today to 8 weeks ahead (club-local days).
pub const HORIZON_DAYS: i32 = 56;
/// Check-in opens 45 minutes before the start and closes at the end.
pub const CHECKIN_EARLY_MIN: i64 = 45;
/// Why a rule's future sessions were cancelled when the rule ended (the students' notification says it).
pub const RULE_ENDED: &str = "o horário deixou de existir";

// ------------------------------------------------------------------------------------ venues

pub async fn locations(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT to_jsonb(l) AS "x!" FROM locations l WHERE l.club_id = $1 AND l.archived_at IS NULL ORDER BY l.created_at"#,
        club_id
    )
    .fetch_all(db)
    .await
}

/// Any venue of the club, archived or not (edits and archiving find it, like the mock).
pub async fn location_exists(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM locations WHERE id = $1 AND club_id = $2) AS "x!""#,
        id,
        club_id
    )
    .fetch_one(db)
    .await
}

/// A venue the club still uses (references from schedules and sessions must point at one).
pub async fn location_usable(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM locations WHERE id = $1 AND club_id = $2 AND archived_at IS NULL) AS "x!""#,
        id,
        club_id
    )
    .fetch_one(db)
    .await
}

/// Venue fields (create: name and kind set; patch: `None` = unchanged, `Some(None)` = cleared).
#[derive(Default)]
pub struct LocationFields {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub address: Option<Option<String>>,
    pub lanes: Option<Option<i32>>,
}

pub async fn create_location(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    f: LocationFields,
) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"INSERT INTO locations (id, club_id, name, kind, address, lanes) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING to_jsonb(locations.*) AS "x!""#,
        Uuid::now_v7(),
        club_id,
        f.name.unwrap_or_default(),
        f.kind.unwrap_or_default(),
        f.address.flatten(),
        f.lanes.flatten()
    )
    .fetch_one(db)
    .await
}

pub async fn update_location(
    db: impl PgExecutor<'_>,
    id: Uuid,
    f: LocationFields,
) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"UPDATE locations SET name = coalesce($2, name), kind = coalesce($3, kind),
                  address = CASE WHEN $4 THEN $5 ELSE address END,
                  lanes = CASE WHEN $6 THEN $7 ELSE lanes END
            WHERE id = $1
        RETURNING to_jsonb(locations.*) AS "x!""#,
        id,
        f.name,
        f.kind,
        f.address.is_some(),
        f.address.flatten(),
        f.lanes.is_some(),
        f.lanes.flatten()
    )
    .fetch_one(db)
    .await
}

pub async fn archive_location(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE locations SET archived_at = coalesce(archived_at, now()) WHERE id = $1",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------------------------ class types

pub async fn class_types(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT to_jsonb(t) AS "x!" FROM class_types t WHERE t.club_id = $1 AND t.archived_at IS NULL ORDER BY t.created_at"#,
        club_id
    )
    .fetch_all(db)
    .await
}

pub struct ClassType {
    pub id: Uuid,
    pub name: String,
    pub sport: String,
    pub description: Option<String>,
    pub default_capacity: i32,
    pub duration_min: i32,
}

/// Any class type of the club, archived or not (its sessions keep it; edits find it, like the mock).
pub async fn class_type(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<ClassType>> {
    sqlx::query_as!(
        ClassType,
        "SELECT id, name, sport, description, default_capacity, duration_min FROM class_types WHERE id = $1 AND club_id = $2",
        id,
        club_id
    )
    .fetch_optional(db)
    .await
}

pub struct ClassTypeFields {
    pub name: String,
    pub sport: String,
    pub description: Option<String>,
    pub default_capacity: i32,
    pub duration_min: i32,
}

pub async fn create_class_type(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    f: ClassTypeFields,
) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"INSERT INTO class_types (id, club_id, name, sport, description, default_capacity, duration_min)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING to_jsonb(class_types.*) AS "x!""#,
        Uuid::now_v7(),
        club_id,
        f.name,
        f.sport,
        f.description,
        f.default_capacity,
        f.duration_min
    )
    .fetch_one(db)
    .await
}

pub async fn update_class_type(
    db: impl PgExecutor<'_>,
    id: Uuid,
    f: ClassTypeFields,
) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"UPDATE class_types SET name = $2, sport = $3, description = $4, default_capacity = $5, duration_min = $6
            WHERE id = $1 RETURNING to_jsonb(class_types.*) AS "x!""#,
        id,
        f.name,
        f.sport,
        f.description,
        f.default_capacity,
        f.duration_min
    )
    .fetch_one(db)
    .await
}

pub async fn archive_class_type(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE class_types SET archived_at = coalesce(archived_at, now()) WHERE id = $1",
        id
    )
    .execute(db)
    .await?;
    Ok(())
}

/// An active staff member of the club (a schedule's or session's instructor).
pub async fn is_staff(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    membership_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM memberships WHERE id = $1 AND club_id = $2 AND status = 'active' AND role <> 'student') AS "x!""#,
        membership_id,
        club_id
    )
    .fetch_one(db)
    .await
}

// ------------------------------------------------------------------------------------ schedules

/// The rules still in force (`valid_until` today or later, club-local), by weekday and time; `only` narrows to
/// some ids (a POST's answer).
pub async fn schedules(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    only: Option<&[Uuid]>,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT to_jsonb(sc) || jsonb_build_object(
                  'start_time', to_char(sc.start_time, 'HH24:MI'),
                  'class_type', to_jsonb(ct),
                  'location', (SELECT to_jsonb(l) FROM locations l WHERE l.id = sc.location_id),
                  'instructor', (SELECT user_json(u) FROM memberships im JOIN users u ON u.id = im.user_id
                                  WHERE im.id = sc.instructor_membership_id)) AS "x!"
             FROM class_schedules sc
             JOIN class_types ct ON ct.id = sc.class_type_id
             JOIN clubs c ON c.id = sc.club_id
            WHERE sc.club_id = $1
              AND ($2::uuid[] IS NOT NULL OR sc.valid_until IS NULL OR sc.valid_until >= (now() AT TIME ZONE c.timezone)::date)
              AND ($2::uuid[] IS NULL OR sc.id = ANY($2))
            ORDER BY sc.weekday, sc.start_time, sc.created_at"#,
        club_id,
        only
    )
    .fetch_all(db)
    .await
}

pub struct NewSchedule {
    pub class_type_id: Uuid,
    pub location_id: Option<Uuid>,
    pub instructor_membership_id: Option<Uuid>,
    pub weekday: i32,
    pub start_time: NaiveTime,
    pub duration_min: i32,
    pub capacity: i32,
    pub valid_from: NaiveDate,
}

pub async fn create_schedule(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    s: &NewSchedule,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO class_schedules (id, club_id, class_type_id, location_id, instructor_membership_id, weekday,
                                      start_time, duration_min, capacity, valid_from)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
        Uuid::now_v7(),
        club_id,
        s.class_type_id,
        s.location_id,
        s.instructor_membership_id,
        s.weekday,
        s.start_time,
        s.duration_min,
        s.capacity,
        s.valid_from
    )
    .fetch_one(db)
    .await
}

pub async fn schedule_exists(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM class_schedules WHERE id = $1 AND club_id = $2) AS "x!""#,
        id,
        club_id
    )
    .fetch_one(db)
    .await
}

/// Create the sessions of the rules in force (or only `ids`) for club-local days from today (or the rule's start)
/// to 8 weeks ahead, never twice for the same start. Idempotent: the worker runs it on every tick so every rule
/// stays 8 weeks ahead. Returns how many sessions were created.
pub async fn expand(
    db: impl PgExecutor<'_>,
    now: DateTime<Utc>,
    ids: Option<&[Uuid]>,
) -> sqlx::Result<u64> {
    let done = sqlx::query!(
        r#"INSERT INTO class_sessions (id, club_id, class_type_id, schedule_id, location_id, instructor_membership_id,
                                       starts_at, ends_at, capacity, checkin_code)
           SELECT gen_random_uuid(), sc.club_id, sc.class_type_id, sc.id, sc.location_id, sc.instructor_membership_id,
                  (d.day + sc.start_time) AT TIME ZONE c.timezone,
                  ((d.day + sc.start_time) AT TIME ZONE c.timezone) + make_interval(mins => sc.duration_min),
                  sc.capacity,
                  upper(substr(md5(random()::text || clock_timestamp()::text || sc.id::text || d.day::text), 1, 6))
             FROM class_schedules sc
             JOIN clubs c ON c.id = sc.club_id AND c.deleted_at IS NULL
            CROSS JOIN LATERAL (
                  SELECT g::date AS day
                    FROM generate_series(
                           greatest(sc.valid_from, ($1::timestamptz AT TIME ZONE c.timezone)::date)::timestamp,
                           least(coalesce(sc.valid_until, 'infinity'::date),
                                 ($1::timestamptz AT TIME ZONE c.timezone)::date + $2::int)::timestamp,
                           interval '1 day') g) d
            WHERE extract(isodow FROM d.day)::int = sc.weekday
              AND (sc.valid_until IS NULL OR sc.valid_until >= ($1::timestamptz AT TIME ZONE c.timezone)::date)
              AND ($3::uuid[] IS NULL OR sc.id = ANY($3))
           ON CONFLICT (schedule_id, starts_at) WHERE schedule_id IS NOT NULL DO NOTHING"#,
        now,
        HORIZON_DAYS,
        ids
    )
    .execute(db)
    .await?;
    Ok(done.rows_affected())
}

/// End a rule (`valid_until` = the club's yesterday) and cancel its future sessions, telling everyone booked or
/// waiting. Returns how many sessions were cancelled.
pub async fn end_schedule(tx: &mut PgConnection, id: Uuid) -> sqlx::Result<usize> {
    sqlx::query!(
        "UPDATE class_schedules sc SET valid_until = (now() AT TIME ZONE c.timezone)::date - 1
           FROM clubs c WHERE c.id = sc.club_id AND sc.id = $1",
        id
    )
    .execute(&mut *tx)
    .await?;
    let future = sqlx::query_scalar!(
        "SELECT id FROM class_sessions WHERE schedule_id = $1 AND starts_at > now() AND status = 'scheduled' ORDER BY starts_at",
        id
    )
    .fetch_all(&mut *tx)
    .await?;
    for s in &future {
        cancel_session(tx, *s, Some(RULE_ENDED)).await?;
    }
    Ok(future.len())
}

// ------------------------------------------------------------------------------------ sessions

/// What the sessions list shows and to whom.
pub struct SessionQuery<'a> {
    pub club_id: Uuid,
    /// The caller's membership (`my_booking`).
    pub viewer: Uuid,
    /// Staff also get `checkin_code`, `checkin_url` and `roster`, and see cancelled sessions.
    pub staff: bool,
    /// The web app (the QR's check-in link).
    pub app_url: &'a str,
    /// Club-local days, both inclusive.
    pub range: Option<(NaiveDate, NaiveDate)>,
    pub only: Option<Uuid>,
}

pub async fn sessions(db: impl PgExecutor<'_>, q: SessionQuery<'_>) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT (to_jsonb(s) - 'checkin_code') || jsonb_build_object(
                  'class_type', to_jsonb(ct),
                  'location', (SELECT to_jsonb(l) FROM locations l WHERE l.id = s.location_id),
                  'instructor', (SELECT user_json(u) FROM memberships im JOIN users u ON u.id = im.user_id
                                  WHERE im.id = s.instructor_membership_id),
                  'booked', (SELECT count(*) FROM class_bookings b WHERE b.session_id = s.id AND b.status IN ('booked', 'attended')),
                  'waitlist', (SELECT count(*) FROM class_bookings b WHERE b.session_id = s.id AND b.status = 'waitlisted'),
                  'my_booking', (SELECT to_jsonb(b) FROM class_bookings b
                                  WHERE b.session_id = s.id AND b.membership_id = $2 AND b.status <> 'cancelled'))
               || CASE WHEN $3 THEN jsonb_build_object(
                  'checkin_code', s.checkin_code,
                  'checkin_url', $4 || '/classes/check-in?session=' || s.id || '&code=' || s.checkin_code,
                  'roster', coalesce((
                     SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object('athlete', jsonb_build_object('membership_id', m.id, 'user', user_json(u)))
                                      ORDER BY (b.status = 'waitlisted'), coalesce(b.waitlist_position, 0), b.created_at)
                       FROM class_bookings b JOIN memberships m ON m.id = b.membership_id JOIN users u ON u.id = m.user_id
                      WHERE b.session_id = s.id AND b.status <> 'cancelled'), '[]'::jsonb))
                  ELSE '{}'::jsonb END AS "x!"
             FROM class_sessions s
             JOIN class_types ct ON ct.id = s.class_type_id
             JOIN clubs c ON c.id = s.club_id
            WHERE s.club_id = $1
              AND ($3 OR $7::uuid IS NOT NULL OR s.status = 'scheduled')
              AND ($5::date IS NULL OR (s.starts_at AT TIME ZONE c.timezone)::date >= $5)
              AND ($6::date IS NULL OR (s.starts_at AT TIME ZONE c.timezone)::date <= $6)
              AND ($7::uuid IS NULL OR s.id = $7)
            ORDER BY s.starts_at, s.created_at"#,
        q.club_id,
        q.viewer,
        q.staff,
        q.app_url,
        q.range.map(|r| r.0),
        q.range.map(|r| r.1),
        q.only
    )
    .fetch_all(db)
    .await
}

/// A session as the rules need it.
pub struct Session {
    pub id: Uuid,
    pub status: String,
    pub capacity: i32,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub checkin_code: String,
}

pub async fn session(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Session>> {
    sqlx::query_as!(
        Session,
        "SELECT id, status, capacity, starts_at, ends_at, checkin_code FROM class_sessions WHERE id = $1 AND club_id = $2",
        id,
        club_id
    )
    .fetch_optional(db)
    .await
}

pub struct NewSession {
    pub class_type_id: Uuid,
    pub date: NaiveDate,
    pub time: NaiveTime,
    pub duration_min: i32,
    pub capacity: i32,
    pub location_id: Option<Uuid>,
    pub instructor_membership_id: Option<Uuid>,
    pub notes: Option<String>,
}

/// A one-off session at a club-local date and time.
pub async fn create_session(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    s: NewSession,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        r#"INSERT INTO class_sessions (id, club_id, class_type_id, location_id, instructor_membership_id, starts_at,
                                       ends_at, capacity, notes, checkin_code)
           SELECT $1, c.id, $3, $4, $5, ($6::date + $7::time) AT TIME ZONE c.timezone,
                  (($6::date + $7::time) AT TIME ZONE c.timezone) + make_interval(mins => $8::int),
                  $9, $10, upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6))
             FROM clubs c WHERE c.id = $2
        RETURNING id"#,
        Uuid::now_v7(),
        club_id,
        s.class_type_id,
        s.location_id,
        s.instructor_membership_id,
        s.date,
        s.time,
        s.duration_min,
        s.capacity,
        s.notes
    )
    .fetch_one(db)
    .await
}

/// Session edits other than cancelling and capacity (`None` = unchanged, `Some(None)` = cleared).
#[derive(Default)]
pub struct SessionEdit {
    pub notes: Option<Option<String>>,
    pub location_id: Option<Option<Uuid>>,
    pub instructor_membership_id: Option<Option<Uuid>>,
}

pub async fn edit_session(db: impl PgExecutor<'_>, id: Uuid, e: SessionEdit) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE class_sessions SET
            notes = CASE WHEN $2 THEN $3 ELSE notes END,
            location_id = CASE WHEN $4 THEN $5 ELSE location_id END,
            instructor_membership_id = CASE WHEN $6 THEN $7 ELSE instructor_membership_id END
          WHERE id = $1",
        id,
        e.notes.is_some(),
        e.notes.flatten(),
        e.location_id.is_some(),
        e.location_id.flatten(),
        e.instructor_membership_id.is_some(),
        e.instructor_membership_id.flatten()
    )
    .execute(db)
    .await?;
    Ok(())
}

/// New capacity for a scheduled session; a raise promotes the waitlist (a cut never removes anyone).
pub async fn set_capacity(tx: &mut PgConnection, id: Uuid, capacity: i32) -> sqlx::Result<()> {
    let changed = sqlx::query!(
        "UPDATE class_sessions SET capacity = $2 WHERE id = $1 AND status = 'scheduled'",
        id,
        capacity
    )
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() > 0 {
        promote(tx, id).await?;
    }
    Ok(())
}

/// What a class notification says about a session: its type and "dd/mm às HH:MM" in club time.
struct About {
    club_id: Uuid,
    name: String,
    when: String,
}

async fn about(tx: &mut PgConnection, session_id: Uuid) -> sqlx::Result<About> {
    sqlx::query_as!(
        About,
        r#"SELECT s.club_id, ct.name, to_char(s.starts_at AT TIME ZONE c.timezone, 'DD/MM "às" HH24:MI') AS "when!"
             FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id JOIN clubs c ON c.id = s.club_id
            WHERE s.id = $1"#,
        session_id
    )
    .fetch_one(&mut *tx)
    .await
}

/// Cancel a scheduled session: every seat and waitlist place goes, and those people are told why
/// (`class_cancelled`). A session already cancelled stays as it was.
pub async fn cancel_session(
    tx: &mut PgConnection,
    id: Uuid,
    reason: Option<&str>,
) -> sqlx::Result<()> {
    let cancelled = sqlx::query!(
        "UPDATE class_sessions SET status = 'cancelled', cancel_reason = $2 WHERE id = $1 AND status = 'scheduled'",
        id,
        reason
    )
    .execute(&mut *tx)
    .await?;
    if cancelled.rows_affected() == 0 {
        return Ok(());
    }
    let told = sqlx::query_scalar!(
        "UPDATE class_bookings SET status = 'cancelled', waitlist_position = NULL, updated_at = now()
          WHERE session_id = $1 AND status IN ('booked', 'waitlisted')
         RETURNING membership_id",
        id
    )
    .fetch_all(&mut *tx)
    .await?;
    if told.is_empty() {
        return Ok(());
    }
    let a = about(tx, id).await?;
    let body = match reason {
        Some(r) => format!("{} · {}: {r}", a.name, a.when),
        None => format!("{} · {}", a.name, a.when),
    };
    let link = format!("/classes?session={id}");
    for m in told {
        notifications::to_member(
            tx,
            m,
            Notice {
                club_id: a.club_id,
                kind: "class_cancelled",
                title: "Aula cancelada",
                body: Some(&body),
                link: &link,
            },
        )
        .await?;
    }
    Ok(())
}

/// The club's next three scheduled sessions (the staff dashboard).
pub async fn upcoming(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT jsonb_build_object(
                  'session', to_jsonb(s) - 'checkin_code',
                  'class_type', to_jsonb(ct),
                  'booked', (SELECT count(*) FROM class_bookings b WHERE b.session_id = s.id AND b.status IN ('booked', 'attended')),
                  'waitlist', (SELECT count(*) FROM class_bookings b WHERE b.session_id = s.id AND b.status = 'waitlisted')) AS "x!"
             FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id
            WHERE s.club_id = $1 AND s.status = 'scheduled' AND s.starts_at > now()
            ORDER BY s.starts_at, s.created_at LIMIT 3"#,
        club_id
    )
    .fetch_all(db)
    .await
}

/// A student's next booked or waitlisted class that hasn't ended (Hoje).
pub async fn next_class(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
) -> sqlx::Result<Option<Value>> {
    sqlx::query_scalar!(
        r#"SELECT jsonb_build_object(
                  'booking', to_jsonb(b),
                  'session', to_jsonb(s) - 'checkin_code',
                  'class_type', to_jsonb(ct),
                  'location', (SELECT to_jsonb(l) FROM locations l WHERE l.id = s.location_id)) AS "x!"
             FROM class_bookings b
             JOIN class_sessions s ON s.id = b.session_id
             JOIN class_types ct ON ct.id = s.class_type_id
            WHERE b.membership_id = $1 AND b.status IN ('booked', 'waitlisted')
              AND s.status = 'scheduled' AND s.ends_at > now()
            ORDER BY s.starts_at LIMIT 1"#,
        membership_id
    )
    .fetch_optional(db)
    .await
}

// ------------------------------------------------------------------------------------ bookings

pub async fn booking_json(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"SELECT to_jsonb(b) AS "x!" FROM class_bookings b WHERE b.id = $1"#,
        id
    )
    .fetch_one(db)
    .await
}

/// A booking with its session, inside one club.
pub struct Booking {
    pub id: Uuid,
    pub session_id: Uuid,
    pub membership_id: Uuid,
    pub status: String,
    pub session_starts_at: DateTime<Utc>,
}

pub async fn booking(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Booking>> {
    sqlx::query_as!(
        Booking,
        "SELECT b.id, b.session_id, b.membership_id, b.status, s.starts_at AS session_starts_at
           FROM class_bookings b JOIN class_sessions s ON s.id = b.session_id
          WHERE b.id = $1 AND s.club_id = $2",
        id,
        club_id
    )
    .fetch_optional(db)
    .await
}

/// Why a booking can't be made.
pub enum BookError {
    /// Already booked (or waiting at this position).
    Exists {
        waitlist_position: Option<i32>,
    },
    Db(sqlx::Error),
}

impl From<sqlx::Error> for BookError {
    fn from(e: sqlx::Error) -> Self {
        Self::Db(e)
    }
}

/// Lock the session row: seats are counted and taken one request at a time.
async fn lock(tx: &mut PgConnection, session_id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "SELECT id FROM class_sessions WHERE id = $1 FOR UPDATE",
        session_id
    )
    .fetch_one(&mut *tx)
    .await?;
    Ok(())
}

async fn seated(tx: &mut PgConnection, session_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM class_bookings WHERE session_id = $1 AND status IN ('booked', 'attended')"#,
        session_id
    )
    .fetch_one(&mut *tx)
    .await
}

/// A seat if there's one, else the end of the waitlist. Booking again after cancelling reuses the row.
pub async fn book(
    tx: &mut PgConnection,
    session_id: Uuid,
    membership_id: Uuid,
    capacity: i32,
) -> Result<Value, BookError> {
    lock(tx, session_id).await?;
    let existing = sqlx::query!(
        "SELECT status, waitlist_position FROM class_bookings WHERE session_id = $1 AND membership_id = $2",
        session_id,
        membership_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(e) = existing.filter(|e| e.status != "cancelled") {
        return Err(BookError::Exists {
            waitlist_position: (e.status == "waitlisted")
                .then_some(e.waitlist_position)
                .flatten(),
        });
    }
    let full = seated(tx, session_id).await? >= capacity as i64;
    let position = if full {
        let waiting = sqlx::query_scalar!(
            r#"SELECT count(*) AS "n!" FROM class_bookings WHERE session_id = $1 AND status = 'waitlisted'"#,
            session_id
        )
        .fetch_one(&mut *tx)
        .await?;
        Some(waiting as i32 + 1)
    } else {
        None
    };
    let row = sqlx::query_scalar!(
        r#"INSERT INTO class_bookings (id, session_id, membership_id, status, waitlist_position)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (session_id, membership_id) DO UPDATE
              SET status = EXCLUDED.status, waitlist_position = EXCLUDED.waitlist_position, checked_in_at = NULL,
                  updated_at = now()
        RETURNING to_jsonb(class_bookings.*) AS "x!""#,
        Uuid::now_v7(),
        session_id,
        membership_id,
        if full { "waitlisted" } else { "booked" },
        position
    )
    .fetch_one(&mut *tx)
    .await?;
    Ok(row)
}

/// Cancel a booking; the first in the waitlist takes the freed seat.
pub async fn cancel_booking(tx: &mut PgConnection, b: &Booking) -> sqlx::Result<()> {
    lock(tx, b.session_id).await?;
    sqlx::query!(
        "UPDATE class_bookings SET status = 'cancelled', waitlist_position = NULL, updated_at = now() WHERE id = $1",
        b.id
    )
    .execute(&mut *tx)
    .await?;
    promote(tx, b.session_id).await
}

/// Staff attendance: `attended` (checked in now if not yet), `no_show` or back to `booked`.
pub async fn set_attendance(
    tx: &mut PgConnection,
    b: &Booking,
    status: &str,
) -> sqlx::Result<Value> {
    lock(tx, b.session_id).await?;
    let row = sqlx::query_scalar!(
        r#"UPDATE class_bookings SET status = $2, waitlist_position = NULL, updated_at = now(),
                  checked_in_at = CASE WHEN $2 = 'attended' THEN coalesce(checked_in_at, now()) ELSE NULL END
            WHERE id = $1 RETURNING to_jsonb(class_bookings.*) AS "x!""#,
        b.id,
        status
    )
    .fetch_one(&mut *tx)
    .await?;
    if b.status == "waitlisted" {
        renumber(tx, b.session_id).await?;
    }
    Ok(row)
}

/// Check-in: `attended`, taking a seat if the student had none. `Ok(None)` = no seat left for them.
pub async fn check_in(
    tx: &mut PgConnection,
    session_id: Uuid,
    membership_id: Uuid,
    capacity: i32,
) -> sqlx::Result<Option<Value>> {
    lock(tx, session_id).await?;
    let was = sqlx::query_scalar!(
        "SELECT status FROM class_bookings WHERE session_id = $1 AND membership_id = $2",
        session_id,
        membership_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    let has_seat = was
        .as_deref()
        .is_some_and(|s| s == "booked" || s == "attended");
    if !has_seat && seated(tx, session_id).await? >= capacity as i64 {
        return Ok(None);
    }
    let row = sqlx::query_scalar!(
        r#"INSERT INTO class_bookings (id, session_id, membership_id, status, checked_in_at)
           VALUES ($1, $2, $3, 'attended', now())
           ON CONFLICT (session_id, membership_id) DO UPDATE
              SET status = 'attended', waitlist_position = NULL,
                  checked_in_at = coalesce(class_bookings.checked_in_at, now()), updated_at = now()
        RETURNING to_jsonb(class_bookings.*) AS "x!""#,
        Uuid::now_v7(),
        session_id,
        membership_id
    )
    .fetch_one(&mut *tx)
    .await?;
    if was.as_deref() == Some("waitlisted") {
        renumber(tx, session_id).await?;
    }
    Ok(Some(row))
}

/// Waitlist positions 1, 2, 3… in their order.
async fn renumber(tx: &mut PgConnection, session_id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE class_bookings b SET waitlist_position = r.pos
           FROM (SELECT id, row_number() OVER (ORDER BY waitlist_position, created_at)::int AS pos
                   FROM class_bookings WHERE session_id = $1 AND status = 'waitlisted') r
          WHERE b.id = r.id AND b.waitlist_position IS DISTINCT FROM r.pos",
        session_id
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Seats freed in a scheduled session: the waitlist moves up in order, and each promoted student is told
/// (`waitlist_promoted`). The caller holds the session's lock (or takes it here).
pub async fn promote(tx: &mut PgConnection, session_id: Uuid) -> sqlx::Result<()> {
    let s = sqlx::query!(
        "SELECT status, capacity FROM class_sessions WHERE id = $1 FOR UPDATE",
        session_id
    )
    .fetch_one(&mut *tx)
    .await?;
    if s.status == "scheduled" {
        let free = s.capacity as i64 - seated(tx, session_id).await?;
        if free > 0 {
            let promoted = sqlx::query_scalar!(
                "UPDATE class_bookings SET status = 'booked', waitlist_position = NULL, updated_at = now()
                  WHERE id IN (SELECT id FROM class_bookings WHERE session_id = $1 AND status = 'waitlisted'
                                ORDER BY waitlist_position, created_at LIMIT $2)
                 RETURNING membership_id",
                session_id,
                free
            )
            .fetch_all(&mut *tx)
            .await?;
            if !promoted.is_empty() {
                let a = about(tx, session_id).await?;
                let body = format!("{} · {}: sua vaga está garantida.", a.name, a.when);
                let link = format!("/classes?session={session_id}");
                for m in promoted {
                    notifications::to_member(
                        tx,
                        m,
                        Notice {
                            club_id: a.club_id,
                            kind: "waitlist_promoted",
                            title: "Você saiu da lista de espera",
                            body: Some(&body),
                            link: &link,
                        },
                    )
                    .await?;
                }
            }
        }
    }
    renumber(tx, session_id).await
}

/// Leaving a club, being removed or suspended, deleting the account: these memberships' open bookings in classes
/// that haven't started are cancelled, and each waitlist moves up.
pub async fn cancel_open_bookings(
    tx: &mut PgConnection,
    membership_ids: &[Uuid],
) -> sqlx::Result<()> {
    let sessions = sqlx::query_scalar!(
        "UPDATE class_bookings b SET status = 'cancelled', waitlist_position = NULL, updated_at = now()
           FROM class_sessions s
          WHERE s.id = b.session_id AND b.membership_id = ANY($1) AND b.status IN ('booked', 'waitlisted')
            AND s.starts_at > now()
         RETURNING b.session_id",
        membership_ids
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut seen = std::collections::BTreeSet::new();
    for s in sessions {
        if seen.insert(s) {
            promote(tx, s).await?;
        }
    }
    Ok(())
}

/// Every membership of a person (account deletion leaves them all).
pub async fn memberships_of(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!("SELECT id FROM memberships WHERE user_id = $1", user_id)
        .fetch_all(db)
        .await
}

// ------------------------------------------------------------------------------------ attendance report

pub struct HeldSession {
    pub id: Uuid,
    pub class_type_id: Uuid,
    pub capacity: i32,
    pub status: String,
}

/// Sessions that started on club-local days [from, to] and already began (held or cancelled).
pub async fn report_sessions(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> sqlx::Result<Vec<HeldSession>> {
    sqlx::query_as!(
        HeldSession,
        "SELECT s.id, s.class_type_id, s.capacity, s.status
           FROM class_sessions s JOIN clubs c ON c.id = s.club_id
          WHERE s.club_id = $1 AND s.starts_at <= now()
            AND (s.starts_at AT TIME ZONE c.timezone)::date BETWEEN $2 AND $3",
        club_id,
        from,
        to
    )
    .fetch_all(db)
    .await
}

pub struct Seat {
    pub session_id: Uuid,
    pub membership_id: Uuid,
    pub status: String,
}

/// Seats in those sessions (waitlist places and cancelled bookings don't count).
pub async fn report_seats(
    db: impl PgExecutor<'_>,
    session_ids: &[Uuid],
) -> sqlx::Result<Vec<Seat>> {
    sqlx::query_as!(
        Seat,
        "SELECT session_id, membership_id, status FROM class_bookings
          WHERE session_id = ANY($1) AND status IN ('booked', 'attended', 'no_show')",
        session_ids
    )
    .fetch_all(db)
    .await
}

pub struct TypeRow {
    pub id: Uuid,
    pub name: String,
    pub sport: String,
}

/// All the club's class types, archived ones too (their past sessions still count).
pub async fn report_types(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<TypeRow>> {
    sqlx::query_as!(
        TypeRow,
        "SELECT id, name, sport FROM class_types WHERE club_id = $1 ORDER BY created_at",
        club_id
    )
    .fetch_all(db)
    .await
}

pub struct StudentRow {
    pub membership_id: Uuid,
    pub name: String,
    pub user: Value,
}

/// Active students (of one group, if given), by name.
pub async fn report_students(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    group_id: Option<Uuid>,
) -> sqlx::Result<Vec<StudentRow>> {
    sqlx::query_as!(
        StudentRow,
        r#"SELECT m.id AS membership_id, u.name, user_json(u) AS "user!"
             FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.club_id = $1 AND m.role = 'student' AND m.status = 'active'
              AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM group_members g WHERE g.group_id = $2 AND g.membership_id = m.id))
            ORDER BY u.name, m.id"#,
        club_id,
        group_id
    )
    .fetch_all(db)
    .await
}

/// A rounded percentage, `None` when there's nothing to divide by (like the mock's `pct`).
pub fn pct(n: i64, d: i64) -> Option<i64> {
    (d > 0).then(|| ((n as f64 / d as f64) * 100.0).round() as i64)
}

/// `{booked, attended, no_show, attendance_pct}` of some seats.
pub fn tally<'a>(seats: impl Iterator<Item = &'a Seat>) -> Value {
    let (mut booked, mut attended, mut no_show) = (0i64, 0i64, 0i64);
    for s in seats {
        booked += 1;
        match s.status.as_str() {
            "attended" => attended += 1,
            "no_show" => no_show += 1,
            _ => {}
        }
    }
    json!({ "booked": booked, "attended": attended, "no_show": no_show, "attendance_pct": pct(attended, attended + no_show) })
}

#[cfg(test)]
mod tests {
    use super::pct;

    #[test]
    fn percentages() {
        assert_eq!(pct(1, 3), Some(33));
        assert_eq!(pct(2, 3), Some(67));
        assert_eq!(pct(1, 2), Some(50));
        assert_eq!(pct(0, 0), None);
    }
}
