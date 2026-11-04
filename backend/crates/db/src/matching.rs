//! Activity matching (D-049, docs/activity-matching.md): one student's matching pass around some days, the links a
//! student makes by hand, the choices shown for an activity, and the `match.activities` job that runs a pass later.
//! The rules themselves are `runflow_domain::matching` (pure, proven by the golden examples).

use std::collections::HashMap;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use runflow_domain::matching::{self as engine, Act, Planned};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

/// The job that runs a matching pass: `{user_id, from, to}` (days).
pub const JOB: &str = "match.activities";

/// Days a timestamp can fall on in club time (Brazil is behind UTC): the UTC day and the one before.
pub fn days_around(at: DateTime<Utc>) -> (NaiveDate, NaiveDate) {
    let d = at.date_naive();
    (d - Duration::days(1), d)
}

/// Run a matching pass for `user_id` over `[from, to]` once the current transaction commits.
pub async fn enqueue(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> sqlx::Result<()> {
    crate::jobs::enqueue(
        db,
        JOB,
        &json!({ "user_id": user_id, "from": from.min(to), "to": from.max(to) }),
        None,
    )
    .await?;
    Ok(())
}

/// After planned workouts change (`(athlete membership, date)` pairs): a pass per student around the dates that can
/// already have activities (up to 2 days ahead in the club's time).
pub async fn enqueue_for_workouts(
    tx: &mut PgConnection,
    items: &[(Uuid, NaiveDate)],
) -> sqlx::Result<()> {
    if items.is_empty() {
        return Ok(());
    }
    let ids: Vec<Uuid> = items.iter().map(|(m, _)| *m).collect();
    let rows = sqlx::query!(
        r#"SELECT m.id, m.user_id, (now() AT TIME ZONE c.timezone)::date + 2 AS "limit!"
             FROM memberships m JOIN clubs c ON c.id = m.club_id WHERE m.id = ANY($1)"#,
        &ids
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut per_user: HashMap<Uuid, (NaiveDate, NaiveDate)> = HashMap::new();
    for (m, date) in items {
        let Some(r) = rows.iter().find(|r| r.id == *m) else {
            continue;
        };
        if *date > r.limit {
            continue;
        }
        per_user
            .entry(r.user_id)
            .and_modify(|(lo, hi)| {
                *lo = (*lo).min(*date);
                *hi = (*hi).max(*date);
            })
            .or_insert((*date, *date));
    }
    for (user, (from, to)) in per_user {
        enqueue(&mut *tx, user, from, to).await?;
    }
    Ok(())
}

/// The job: one pass in its own transaction (idempotent: a pass only writes what changed).
pub async fn run_job(db: &crate::Pool, payload: &Value) -> Result<(), String> {
    let user = payload["user_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok());
    let date = |k: &str| {
        payload[k]
            .as_str()
            .and_then(|s| s.parse::<NaiveDate>().ok())
    };
    let (Some(user), Some(from), Some(to)) = (user, date("from"), date("to")) else {
        return Err("bad payload".into());
    };
    let mut tx = db.begin().await.map_err(|e| e.to_string())?;
    rematch(&mut tx, user, from, to)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}

/// The student's timezone for matching (the club of their oldest active student membership; São Paulo without one)
/// and today there.
pub async fn student_clock(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
) -> sqlx::Result<(String, NaiveDate)> {
    let r = sqlx::query!(
        r#"WITH z AS (SELECT coalesce((SELECT c.timezone FROM memberships m JOIN clubs c ON c.id = m.club_id
                                         WHERE m.user_id = $1 AND m.role = 'student' AND m.status = 'active'
                                         ORDER BY m.joined_at LIMIT 1), 'America/Sao_Paulo') AS tz)
           SELECT tz AS "tz!", (now() AT TIME ZONE tz)::date AS "today!" FROM z"#,
        user_id
    )
    .fetch_one(db)
    .await?;
    Ok((r.tz, r.today))
}

/// One activity as the engine and the links need it.
#[derive(Debug, Clone)]
pub struct MatchActivity {
    pub id: Uuid,
    pub day: NaiveDate,
    pub sport: String,
    pub source: String,
    pub distance_m: Option<i32>,
    pub duration_s: i32,
    pub moving_time_s: Option<i32>,
    pub started_at: DateTime<Utc>,
}

impl MatchActivity {
    /// As the engine sees it, matchable to any club (the student's own choices, compliance).
    pub fn engine(&self) -> Act {
        Act {
            id: self.id.to_string(),
            day: self.day,
            sport: self.sport.clone(),
            distance_m: self.distance_m.map(i64::from),
            duration_s: self.duration_s.into(),
            moving_time_s: self.moving_time_s.map(i64::from),
            clubs: None,
        }
    }

    /// As the engine sees it for automatic matching: only to the clubs the student shares it with (D-011).
    pub fn engine_shared(&self, sharing: &Sharing) -> Act {
        Act {
            clubs: Some(
                sharing
                    .clubs_for(&self.source)
                    .iter()
                    .map(Uuid::to_string)
                    .collect(),
            ),
            ..self.engine()
        }
    }
}

/// Which clubs a student shares what with (active consents, §5): training data, and each synced provider.
#[derive(Debug, Clone, Default)]
pub struct Sharing {
    training: Vec<Uuid>,
    providers: Vec<(String, Uuid)>,
}

impl Sharing {
    /// The clubs whose staff may see an activity of this source: training data shared and, for a synced source
    /// (`strava`, `garmin`), that provider shared with the club too.
    pub fn clubs_for(&self, source: &str) -> Vec<Uuid> {
        let synced = source == "strava" || source == "garmin";
        self.training
            .iter()
            .copied()
            .filter(|c| !synced || self.providers.iter().any(|(p, pc)| p == source && pc == c))
            .collect()
    }
}

/// The student's active sharing consents.
pub async fn sharing(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<Sharing> {
    let rows = sqlx::query!(
        r#"SELECT kind, club_id AS "club_id!" FROM consents
            WHERE user_id = $1 AND club_id IS NOT NULL AND revoked_at IS NULL
              AND kind IN ('share_training_data', 'share_strava', 'share_garmin')"#,
        user_id
    )
    .fetch_all(db)
    .await?;
    let mut s = Sharing::default();
    for r in rows {
        match r.kind.strip_prefix("share_") {
            Some("training_data") => s.training.push(r.club_id),
            Some(p) => s.providers.push((p.to_string(), r.club_id)),
            None => {}
        }
    }
    Ok(s)
}

/// One planned workout as the engine needs it.
#[derive(Debug, Clone)]
pub struct MatchWorkout {
    pub id: Uuid,
    pub club_id: Uuid,
    pub date: NaiveDate,
    pub sport: String,
    pub est_distance_m: Option<i32>,
    pub est_duration_s: Option<i32>,
}

impl MatchWorkout {
    pub fn engine(&self) -> Planned {
        Planned {
            id: self.id.to_string(),
            date: self.date,
            sport: self.sport.clone(),
            est_distance_m: self.est_distance_m.map(i64::from),
            est_duration_s: self.est_duration_s.map(i64::from),
            club_id: Some(self.club_id.to_string()),
        }
    }
}

/// One of the student's activities (with its club-time day), if it's theirs.
pub async fn activity(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    id: Uuid,
    tz: &str,
) -> sqlx::Result<Option<MatchActivity>> {
    sqlx::query_as!(
        MatchActivity,
        r#"SELECT id, (started_at AT TIME ZONE $3)::date AS "day!", sport, source, distance_m, duration_s, moving_time_s, started_at
             FROM activities WHERE id = $1 AND user_id = $2"#,
        id,
        user_id,
        tz
    )
    .fetch_optional(db)
    .await
}

/// One of the student's own workouts that they can see (any club where they're an active student).
pub async fn visible_workout(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<MatchWorkout>> {
    sqlx::query_as!(
        MatchWorkout,
        "SELECT p.id, p.club_id, p.date, p.sport, p.est_distance_m, p.est_duration_s
           FROM planned_workouts p JOIN memberships m ON m.id = p.athlete_membership_id
          WHERE p.id = $1 AND m.user_id = $2 AND m.role = 'student' AND m.status = 'active'
            AND coalesce(workout_released(p.club_id, p.athlete_membership_id, p.date), false)",
        id,
        user_id
    )
    .fetch_optional(db)
    .await
}

/// Serializes matching writes for one student (a request's and a job's pass could otherwise race); held until the
/// transaction ends, and taken again by every pass (re-entrant).
pub async fn lock(tx: &mut PgConnection, user_id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 7049))",
        user_id.to_string()
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Takes the activity off a workout's completion: a completion that only existed because of the match goes away,
/// one the student reported stays without the activity.
pub async fn unlink(tx: &mut PgConnection, workout_id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "DELETE FROM workout_completions WHERE planned_workout_id = $1 AND reported_at IS NULL",
        workout_id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE workout_completions SET activity_id = NULL, matched_by = NULL, updated_at = now() WHERE planned_workout_id = $1",
        workout_id
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Links an activity to a workout (`by`: `auto` or `student`): the student's completion keeps their answers (a
/// `missed`/`skipped` one takes the status from compliance), else one is made from the match.
pub async fn link(
    tx: &mut PgConnection,
    a: &MatchActivity,
    w: &MatchWorkout,
    by: &str,
) -> sqlx::Result<()> {
    let pct = engine::compliance(&a.engine(), &w.engine());
    let end = a.started_at + Duration::seconds(a.duration_s.into());
    sqlx::query!(
        "INSERT INTO workout_completions (planned_workout_id, activity_id, status, compliance_pct, matched_by, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (planned_workout_id) DO UPDATE SET activity_id = $2, matched_by = $5, compliance_pct = $4, updated_at = now(),
                status = CASE WHEN workout_completions.status IN ('missed', 'skipped') THEN $3 ELSE workout_completions.status END",
        w.id,
        a.id,
        engine::status_for(pct),
        pct,
        by,
        end
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Sets an activity's state and drops its pending choices (an activity the student just placed or dismissed).
pub async fn settle(tx: &mut PgConnection, activity_id: Uuid, state: &str) -> sqlx::Result<()> {
    sqlx::query!(
        "DELETE FROM activity_match_options WHERE activity_id = $1",
        activity_id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE activities SET match_state = $2 WHERE id = $1 AND match_state <> $2",
        activity_id,
        state
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// The workout an activity completes now, with who linked it.
pub async fn linked_workout(
    db: impl PgExecutor<'_>,
    activity_id: Uuid,
) -> sqlx::Result<Option<(Uuid, Option<String>, NaiveDate)>> {
    let r = sqlx::query!(
        "SELECT c.planned_workout_id, c.matched_by, p.date FROM workout_completions c JOIN planned_workouts p ON p.id = c.planned_workout_id
          WHERE c.activity_id = $1",
        activity_id
    )
    .fetch_optional(db)
    .await?;
    Ok(r.map(|r| (r.planned_workout_id, r.matched_by, r.date)))
}

/// The activity a workout's completion has now.
pub async fn workout_activity(
    db: impl PgExecutor<'_>,
    workout_id: Uuid,
) -> sqlx::Result<Option<Uuid>> {
    Ok(sqlx::query_scalar!(
        "SELECT activity_id FROM workout_completions WHERE planned_workout_id = $1",
        workout_id
    )
    .fetch_optional(db)
    .await?
    .flatten())
}

/// The student's open activities of one club-time day that complete no workout (the completion route's fallback).
pub async fn free_activities_on(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    tz: &str,
    day: NaiveDate,
) -> sqlx::Result<Vec<MatchActivity>> {
    sqlx::query_as!(
        MatchActivity,
        r#"SELECT a.id, (a.started_at AT TIME ZONE $2)::date AS "day!", a.sport, a.source, a.distance_m, a.duration_s, a.moving_time_s, a.started_at
             FROM activities a
            WHERE a.user_id = $1 AND a.match_state <> 'dismissed' AND (a.started_at AT TIME ZONE $2)::date = $3
              AND NOT EXISTS (SELECT 1 FROM workout_completions c WHERE c.activity_id = a.id)
            ORDER BY a.started_at, a.id"#,
        user_id,
        tz,
        day
    )
    .fetch_all(db)
    .await
}

/// A matching pass for one student around `[from, to]` (docs/activity-matching.md § Scope). Only changes are written.
pub async fn rematch(
    tx: &mut PgConnection,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> sqlx::Result<()> {
    lock(tx, user_id).await?;
    let (tz, today) = student_clock(&mut *tx, user_id).await?;
    // Completions whose activity is gone (deleted, disconnected).
    sqlx::query!(
        "DELETE FROM workout_completions c USING planned_workouts p, memberships m
          WHERE p.id = c.planned_workout_id AND m.id = p.athlete_membership_id AND m.user_id = $1
            AND c.matched_by IS NOT NULL AND c.activity_id IS NULL AND c.reported_at IS NULL",
        user_id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE workout_completions c SET matched_by = NULL, updated_at = now() FROM planned_workouts p, memberships m
          WHERE p.id = c.planned_workout_id AND m.id = p.athlete_membership_id AND m.user_id = $1
            AND c.matched_by IS NOT NULL AND c.activity_id IS NULL",
        user_id
    )
    .execute(&mut *tx)
    .await?;

    let lo = from.min(to) - Duration::days(engine::MAX_DAYS);
    let hi = from.max(to) + Duration::days(engine::MAX_DAYS);
    // Activities: not dismissed, not placed by the student; with the workout they complete now.
    let acts = sqlx::query!(
        r#"SELECT a.id, (a.started_at AT TIME ZONE $2)::date AS "day!", a.sport, a.source, a.distance_m, a.duration_s, a.moving_time_s, a.started_at,
                  a.match_state, c.planned_workout_id AS "linked?"
             FROM activities a LEFT JOIN workout_completions c ON c.activity_id = a.id
            WHERE a.user_id = $1 AND a.match_state <> 'dismissed' AND (a.started_at AT TIME ZONE $2)::date BETWEEN $3 AND $4
              AND c.matched_by IS DISTINCT FROM 'student'
            ORDER BY a.started_at, a.id"#,
        user_id,
        tz,
        lo,
        hi
    )
    .fetch_all(&mut *tx)
    .await?;
    let in_scope: Vec<Uuid> = acts.iter().map(|a| a.id).collect();
    // Workouts the student can see that are still open (or linked automatically to an activity of this pass).
    let works = sqlx::query_as!(
        MatchWorkout,
        "SELECT p.id, p.club_id, p.date, p.sport, p.est_distance_m, p.est_duration_s
           FROM planned_workouts p JOIN memberships m ON m.id = p.athlete_membership_id
           LEFT JOIN workout_completions c ON c.planned_workout_id = p.id
          WHERE m.user_id = $1 AND m.role = 'student' AND m.status = 'active' AND p.date BETWEEN $2 AND $3
            AND coalesce(workout_released(p.club_id, p.athlete_membership_id, p.date), false)
            AND (c.planned_workout_id IS NULL
                 OR (c.status NOT IN ('missed', 'skipped')
                     AND (c.activity_id IS NULL OR (c.matched_by = 'auto' AND c.activity_id = ANY($4)))))
          ORDER BY p.date, p.position, p.id",
        user_id,
        lo - Duration::days(engine::MAX_DAYS),
        hi + Duration::days(engine::MAX_DAYS),
        &in_scope
    )
    .fetch_all(&mut *tx)
    .await?;

    let ma: Vec<MatchActivity> = acts
        .iter()
        .map(|a| MatchActivity {
            id: a.id,
            day: a.day,
            sport: a.sport.clone(),
            source: a.source.clone(),
            distance_m: a.distance_m,
            duration_s: a.duration_s,
            moving_time_s: a.moving_time_s,
            started_at: a.started_at,
        })
        .collect();
    // Each activity only to the clubs the student shares it with (D-011): links to other clubs are undone.
    let sharing = sharing(&mut *tx, user_id).await?;
    let solution = engine::solve(
        today,
        &ma.iter()
            .map(|a| a.engine_shared(&sharing))
            .collect::<Vec<_>>(),
        &works.iter().map(MatchWorkout::engine).collect::<Vec<_>>(),
    );
    let uuid = |s: &str| Uuid::parse_str(s).unwrap_or_default();
    let want: HashMap<Uuid, (Uuid, i32)> = solution
        .links
        .iter()
        .map(|l| {
            (
                uuid(&l.activity_id),
                (uuid(&l.workout_id), l.compliance_pct),
            )
        })
        .collect();

    // Links that changed go first (one activity per workout).
    for a in &acts {
        if let Some(w) = a.linked
            && want.get(&a.id).map(|(w, _)| *w) != Some(w)
        {
            unlink(tx, w).await?;
        }
    }
    for (aid, (wid, pct)) in &want {
        let a = acts.iter().find(|a| a.id == *aid);
        if a.and_then(|a| a.linked) == Some(*wid) {
            sqlx::query!(
                "UPDATE workout_completions SET compliance_pct = $2 WHERE planned_workout_id = $1 AND compliance_pct IS DISTINCT FROM $2",
                wid,
                pct
            )
            .execute(&mut *tx)
            .await?;
            continue;
        }
        if let (Some(a), Some(w)) = (
            ma.iter().find(|a| a.id == *aid),
            works.iter().find(|w| w.id == *wid),
        ) {
            link(tx, a, w, "auto").await?;
        }
    }
    // Questions: pending activities get their choices, every other activity of the pass is open again.
    let pending: HashMap<Uuid, Vec<Uuid>> = solution
        .pending
        .iter()
        .map(|p| {
            (
                uuid(&p.activity_id),
                p.options.iter().map(|o| uuid(o)).collect(),
            )
        })
        .collect();
    sqlx::query!(
        "DELETE FROM activity_match_options WHERE activity_id = ANY($1)",
        &in_scope
    )
    .execute(&mut *tx)
    .await?;
    for a in &acts {
        let state = if let Some(options) = pending.get(&a.id) {
            for (rank, w) in options.iter().enumerate() {
                sqlx::query!(
                    "INSERT INTO activity_match_options (activity_id, planned_workout_id, rank) VALUES ($1, $2, $3)",
                    a.id,
                    w,
                    rank as i32
                )
                .execute(&mut *tx)
                .await?;
            }
            "pending"
        } else {
            "open"
        };
        if a.match_state != state {
            sqlx::query!(
                "UPDATE activities SET match_state = $2 WHERE id = $1",
                a.id,
                state
            )
            .execute(&mut *tx)
            .await?;
        }
    }
    Ok(())
}

/// The pending choices of these activities, best first (each `{id, title, date, club_id, sport, est_distance_m,
/// est_duration_s}`).
pub async fn pending_options(
    db: impl PgExecutor<'_>,
    activity_ids: &[Uuid],
) -> sqlx::Result<HashMap<Uuid, Vec<Value>>> {
    let rows = sqlx::query!(
        r#"SELECT o.activity_id,
                  jsonb_build_object('id', p.id, 'title', p.title, 'date', p.date, 'club_id', p.club_id, 'sport', p.sport,
                                     'est_distance_m', p.est_distance_m, 'est_duration_s', p.est_duration_s) AS "workout!"
             FROM activity_match_options o JOIN activities a ON a.id = o.activity_id
             JOIN planned_workouts p ON p.id = o.planned_workout_id
            WHERE o.activity_id = ANY($1) AND a.match_state = 'pending'
            ORDER BY o.activity_id, o.rank"#,
        activity_ids
    )
    .fetch_all(db)
    .await?;
    let mut out: HashMap<Uuid, Vec<Value>> = HashMap::new();
    for r in rows {
        out.entry(r.activity_id).or_default().push(r.workout);
    }
    Ok(out)
}

/// What the student could pick for a placed activity ("Trocar treino"): their visible workouts of a compatible sport
/// within 3 days, nearest first, except workouts they linked to another activity.
pub async fn pick_options(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    activity_id: Uuid,
    sport: &str,
    day: NaiveDate,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT jsonb_build_object('id', p.id, 'title', p.title, 'date', p.date, 'club_id', p.club_id, 'sport', p.sport,
                                     'est_distance_m', p.est_distance_m, 'est_duration_s', p.est_duration_s) AS "workout!"
             FROM planned_workouts p JOIN memberships m ON m.id = p.athlete_membership_id
             LEFT JOIN workout_completions c ON c.planned_workout_id = p.id
            WHERE m.user_id = $1 AND m.role = 'student' AND m.status = 'active'
              AND p.date BETWEEN $4::date - 3 AND $4::date + 3
              AND coalesce(workout_released(p.club_id, p.athlete_membership_id, p.date), false)
              AND (p.sport = $3 OR (p.sport IN ('strength', 'mobility') AND $3 IN ('strength', 'mobility')))
              AND NOT (c.matched_by IS NOT DISTINCT FROM 'student' AND c.activity_id IS DISTINCT FROM $2)
            ORDER BY abs(p.date - $4::date), p.date, p.position, p.id"#,
        user_id,
        activity_id,
        sport,
        day
    )
    .fetch_all(db)
    .await
}
