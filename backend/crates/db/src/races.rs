//! Races and events (W12, M9, W4): the club's race calendar and its students' entries. An entry marked `is_goal` is
//! the student's single "A race" (profile goal and date follow it); a finished run result becomes the profile's
//! recent race. Shapes mirror api/mock/routes/races.mjs.

use chrono::{NaiveDate, NaiveTime};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

/// Races as `viewer` sees them (staff also get `entries` with each athlete). `only` narrows to one race.
pub async fn list(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    viewer: Uuid,
    staff: bool,
    range: (Option<NaiveDate>, Option<NaiveDate>),
    only: Option<Uuid>,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT to_jsonb(r) || jsonb_build_object(
                  'start_time', to_char(r.start_time, 'HH24:MI'),
                  'entries_count', (SELECT count(*) FROM race_entries e WHERE e.race_id = r.id),
                  'my_entry', (SELECT to_jsonb(e) FROM race_entries e WHERE e.race_id = r.id AND e.membership_id = $2))
                || CASE WHEN $3 THEN jsonb_build_object('entries', coalesce((
                     SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object('athlete', jsonb_build_object('membership_id', m.id, 'user', user_json(u)))
                                      ORDER BY e.distance_m, u.name)
                       FROM race_entries e JOIN memberships m ON m.id = e.membership_id JOIN users u ON u.id = m.user_id
                      WHERE e.race_id = r.id), '[]'::jsonb))
                   ELSE '{}'::jsonb END AS "x!"
             FROM races r
            WHERE r.club_id = $1 AND r.archived_at IS NULL
              AND ($4::date IS NULL OR r.date >= $4) AND ($5::date IS NULL OR r.date <= $5)
              AND ($6::uuid IS NULL OR r.id = $6)
            ORDER BY r.date, r.created_at"#,
        club_id,
        viewer,
        staff,
        range.0,
        range.1,
        only
    )
    .fetch_all(db)
    .await
}

pub struct Race {
    pub id: Uuid,
    pub sport: String,
    pub date: NaiveDate,
    pub distances_m: Vec<i32>,
}

pub async fn race(db: impl PgExecutor<'_>, club_id: Uuid, id: Uuid) -> sqlx::Result<Option<Race>> {
    sqlx::query_as!(
        Race,
        "SELECT id, sport, date, distances_m FROM races WHERE id = $1 AND club_id = $2 AND archived_at IS NULL",
        id,
        club_id
    )
    .fetch_optional(db)
    .await
}

/// The fields a race is made of (create: all required ones set; patch: `None` = unchanged, `Some(None)` = cleared).
#[derive(Default)]
pub struct Fields {
    pub name: Option<String>,
    pub sport: Option<String>,
    pub date: Option<NaiveDate>,
    pub start_time: Option<Option<NaiveTime>>,
    pub city: Option<Option<String>>,
    pub state: Option<Option<String>>,
    pub url: Option<Option<String>>,
    pub distances_m: Option<Vec<i32>>,
    pub notes: Option<Option<String>>,
}

pub async fn create(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    by: Uuid,
    f: Fields,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "INSERT INTO races (id, club_id, name, sport, date, start_time, city, state, url, distances_m, notes, created_by)
         VALUES ($1, $2, $3, coalesce($4, 'run'), $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id",
        Uuid::now_v7(),
        club_id,
        f.name.unwrap_or_default(),
        f.sport,
        f.date.unwrap_or_default(),
        f.start_time.flatten(),
        f.city.flatten(),
        f.state.flatten(),
        f.url.flatten(),
        &f.distances_m.unwrap_or_default(),
        f.notes.flatten(),
        by
    )
    .fetch_one(db)
    .await
}

pub async fn update(db: impl PgExecutor<'_>, id: Uuid, f: Fields) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE races SET
            name = coalesce($2, name), sport = coalesce($3, sport), date = coalesce($4, date),
            start_time = CASE WHEN $5 THEN $6 ELSE start_time END,
            city = CASE WHEN $7 THEN $8 ELSE city END,
            state = CASE WHEN $9 THEN $10 ELSE state END,
            url = CASE WHEN $11 THEN $12 ELSE url END,
            distances_m = coalesce($13, distances_m),
            notes = CASE WHEN $14 THEN $15 ELSE notes END
          WHERE id = $1",
        id,
        f.name,
        f.sport,
        f.date,
        f.start_time.is_some(),
        f.start_time.flatten(),
        f.city.is_some(),
        f.city.flatten(),
        f.state.is_some(),
        f.state.flatten(),
        f.url.is_some(),
        f.url.flatten(),
        f.distances_m.as_deref(),
        f.notes.is_some(),
        f.notes.flatten()
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Some entry uses a distance that isn't in `distances` (it can't be removed).
pub async fn distance_in_use(
    db: impl PgExecutor<'_>,
    id: Uuid,
    distances: &[i32],
) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM race_entries WHERE race_id = $1 AND NOT (distance_m = ANY($2))) AS "x!""#,
        id,
        distances
    )
    .fetch_one(db)
    .await
}

/// The entries marked as their athlete's goal race (their goal date follows the race).
pub async fn goal_entries(db: impl PgExecutor<'_>, race_id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!(
        "SELECT id FROM race_entries WHERE race_id = $1 AND is_goal",
        race_id
    )
    .fetch_all(db)
    .await
}

pub async fn archive(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("UPDATE races SET archived_at = now() WHERE id = $1", id)
        .execute(db)
        .await?;
    Ok(())
}

// ------------------------------------------------------------------------------------ entries

pub struct Entry {
    pub id: Uuid,
    pub race_id: Uuid,
    pub membership_id: Uuid,
    pub distance_m: i32,
    pub is_goal: bool,
    pub status: String,
    pub result_time_s: Option<i32>,
}

pub async fn entry(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Entry>> {
    sqlx::query_as!(
        Entry,
        "SELECT e.id, e.race_id, e.membership_id, e.distance_m, e.is_goal, e.status, e.result_time_s
           FROM race_entries e JOIN races r ON r.id = e.race_id WHERE e.id = $1 AND r.club_id = $2",
        id,
        club_id
    )
    .fetch_optional(db)
    .await
}

pub async fn entry_json(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"SELECT to_jsonb(e) AS "x!" FROM race_entries e WHERE e.id = $1"#,
        id
    )
    .fetch_one(db)
    .await
}

/// Sign up (or change the signup): `(entry id, created, is_goal)`.
pub async fn upsert_entry(
    db: impl PgExecutor<'_>,
    race_id: Uuid,
    membership_id: Uuid,
    distance_m: i32,
    goal_time_s: Option<Option<i32>>,
    is_goal: Option<bool>,
) -> sqlx::Result<(Uuid, bool, bool)> {
    let r = sqlx::query!(
        r#"INSERT INTO race_entries (id, race_id, membership_id, distance_m, goal_time_s, is_goal)
           VALUES ($1, $2, $3, $4, $6, coalesce($7, false))
           ON CONFLICT (race_id, membership_id) DO UPDATE SET
             distance_m = excluded.distance_m,
             goal_time_s = CASE WHEN $5 THEN $6 ELSE race_entries.goal_time_s END,
             is_goal = coalesce($7, race_entries.is_goal),
             updated_at = now()
           RETURNING id, is_goal, (xmax = 0) AS "created!""#,
        Uuid::now_v7(),
        race_id,
        membership_id,
        distance_m,
        goal_time_s.is_some(),
        goal_time_s.flatten(),
        is_goal
    )
    .fetch_one(db)
    .await?;
    Ok((r.id, r.created, r.is_goal))
}

#[derive(Default)]
pub struct EntryPatch {
    pub distance_m: Option<i32>,
    pub goal_time_s: Option<Option<i32>>,
    pub is_goal: Option<bool>,
    pub status: Option<String>,
    pub result_time_s: Option<Option<i32>>,
    pub result_position: Option<Option<i32>>,
}

/// Returns whether the entry is (now) the goal race.
pub async fn update_entry(db: impl PgExecutor<'_>, id: Uuid, p: EntryPatch) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        "UPDATE race_entries SET
            distance_m = coalesce($2, distance_m),
            goal_time_s = CASE WHEN $3 THEN $4 ELSE goal_time_s END,
            is_goal = coalesce($5, is_goal),
            status = coalesce($6, status),
            result_time_s = CASE WHEN $7 THEN $8 ELSE result_time_s END,
            result_position = CASE WHEN $9 THEN $10 ELSE result_position END,
            updated_at = now()
          WHERE id = $1 RETURNING is_goal",
        id,
        p.distance_m,
        p.goal_time_s.is_some(),
        p.goal_time_s.flatten(),
        p.is_goal,
        p.status,
        p.result_time_s.is_some(),
        p.result_time_s.flatten(),
        p.result_position.is_some(),
        p.result_position.flatten()
    )
    .fetch_one(db)
    .await
}

pub async fn delete_entry(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("DELETE FROM race_entries WHERE id = $1", id)
        .execute(db)
        .await?;
    Ok(())
}

/// The "A race" (single per student): profile goal and date follow it.
pub async fn apply_goal(db: &mut PgConnection, entry_id: Uuid) -> sqlx::Result<()> {
    let e = sqlx::query!(
        "SELECT e.membership_id, e.distance_m, r.sport, r.date FROM race_entries e JOIN races r ON r.id = e.race_id WHERE e.id = $1",
        entry_id
    )
    .fetch_one(&mut *db)
    .await?;
    sqlx::query!(
        "UPDATE race_entries SET is_goal = false WHERE membership_id = $1 AND id <> $2 AND is_goal",
        e.membership_id,
        entry_id
    )
    .execute(&mut *db)
    .await?;
    let goal = match (e.sport.as_str(), e.distance_m) {
        ("run", 5000) => Some("5k"),
        ("run", 10000) => Some("10k"),
        ("run", 21097) => Some("21k"),
        ("run", 42195) => Some("42k"),
        ("swim", _) => Some("swim"),
        ("trail", _) => Some("trail"),
        ("triathlon", _) => Some("triathlon"),
        _ => None,
    };
    sqlx::query!(
        "INSERT INTO athlete_profiles (membership_id, goal, goal_date) VALUES ($1, $2, $3)
         ON CONFLICT (membership_id) DO UPDATE SET goal = coalesce($2, athlete_profiles.goal), goal_date = $3, updated_at = now()",
        e.membership_id,
        goal,
        e.date
    )
    .execute(&mut *db)
    .await?;
    Ok(())
}

/// A finished run becomes the profile's recent race (unless a more recent one is there).
pub async fn apply_result(db: &mut PgConnection, entry_id: Uuid) -> sqlx::Result<()> {
    let e = sqlx::query!(
        "SELECT e.membership_id, e.distance_m, e.status, e.result_time_s, r.sport, r.date
           FROM race_entries e JOIN races r ON r.id = e.race_id WHERE e.id = $1",
        entry_id
    )
    .fetch_one(&mut *db)
    .await?;
    let (Some(time), "finished", "run") = (e.result_time_s, e.status.as_str(), e.sport.as_str())
    else {
        return Ok(());
    };
    let recent = json!({ "distance_m": e.distance_m, "time_s": time, "date": e.date });
    sqlx::query!(
        "INSERT INTO athlete_profiles (membership_id, recent_race) VALUES ($1, $2)
         ON CONFLICT (membership_id) DO UPDATE SET recent_race = $2, updated_at = now()
          WHERE athlete_profiles.recent_race IS NULL OR (athlete_profiles.recent_race->>'date') IS NULL
             OR (athlete_profiles.recent_race->>'date')::date <= $3",
        e.membership_id,
        recent,
        e.date
    )
    .execute(&mut *db)
    .await?;
    Ok(())
}
