//! Trainer views of students (W1–W3): summaries, detail, profiles, zones, consent-aware activities; dashboard data.

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::PgExecutor;
use uuid::Uuid;

use crate::models::{Activity, AthleteProfile, Membership, User, ZoneSet};

/// One student as the students list shows them (consent-aware fields resolved by the API).
pub struct Summary {
    pub membership: Membership,
    pub user: User,
    pub group_ids: Vec<Uuid>,
    pub goal: Option<String>,
    pub level: Option<String>,
    pub compliance_pct: Option<i32>,
    pub week_planned: i64,
    pub week_done: i64,
    pub shares_data: bool,
    pub strava_shared: bool,
    pub strava_connected: bool,
    pub last_activity_at: Option<DateTime<Utc>>,
}

/// Active students of a club (optionally one group's, or one student), with 28-day compliance (partial = ½)
/// and this week's progress (`monday`..`monday`+6), computed relative to `today`.
pub async fn summaries(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    today: NaiveDate,
    monday: NaiveDate,
    group: Option<Uuid>,
    only: Option<Uuid>,
) -> sqlx::Result<Vec<Summary>> {
    let rows = sqlx::query!(
        r#"WITH s AS (
             SELECT m.*, (SELECT EXISTS (SELECT 1 FROM consents c WHERE c.user_id = m.user_id AND c.club_id = m.club_id AND c.kind = 'share_training_data' AND c.revoked_at IS NULL)) AS shares,
                         (SELECT EXISTS (SELECT 1 FROM consents c WHERE c.user_id = m.user_id AND c.club_id = m.club_id AND c.kind = 'share_strava' AND c.revoked_at IS NULL)) AS strava_shared
               FROM memberships m
              WHERE m.club_id = $1 AND m.role = 'student' AND m.status = 'active'
                AND ($4::uuid IS NULL OR m.id IN (SELECT membership_id FROM group_members WHERE group_id = $4))
                AND ($5::uuid IS NULL OR m.id = $5))
           SELECT s.id, s.club_id, s.user_id, s.role, s.status, s.is_billing_owner, s.joined_at, s.left_at,
                  u.email, u.name, u.avatar_url, u.phone, u.birth_date, u.sex, u.locale, u.created_at,
                  coalesce((SELECT array_agg(g.group_id ORDER BY g.added_at) FROM group_members g WHERE g.membership_id = s.id), '{}') AS "group_ids!",
                  ap.goal, ap.level,
                  (SELECT CASE WHEN count(*) = 0 THEN NULL
                               ELSE round(100.0 * sum(CASE c.status WHEN 'completed' THEN 1 WHEN 'partial' THEN 0.5 ELSE 0 END) / count(*))::int END
                     FROM planned_workouts p LEFT JOIN workout_completions c ON c.planned_workout_id = p.id
                    WHERE p.athlete_membership_id = s.id AND p.date >= $2::date - 28 AND p.date < $2) AS compliance_pct,
                  (SELECT count(*) FROM planned_workouts p WHERE p.athlete_membership_id = s.id AND p.date BETWEEN $3 AND $3::date + 6) AS "week_planned!",
                  (SELECT count(*) FROM planned_workouts p JOIN workout_completions c ON c.planned_workout_id = p.id
                    WHERE p.athlete_membership_id = s.id AND p.date BETWEEN $3 AND $3::date + 6 AND c.status IN ('completed', 'partial')) AS "week_done!",
                  s.shares AS "shares!", s.strava_shared AS "strava_shared!",
                  (SELECT EXISTS (SELECT 1 FROM provider_connections pc WHERE pc.user_id = s.user_id AND pc.provider = 'strava' AND pc.status = 'active')) AS "strava_connected!",
                  (SELECT max(a.started_at) FROM activities a WHERE a.user_id = s.user_id AND (a.source <> 'strava' OR s.strava_shared)) AS last_activity_at
             FROM s JOIN users u ON u.id = s.user_id LEFT JOIN athlete_profiles ap ON ap.membership_id = s.id"#,
        club_id,
        today,
        monday,
        group,
        only
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Summary {
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
            goal: r.goal,
            level: r.level,
            compliance_pct: r.compliance_pct,
            week_planned: r.week_planned,
            week_done: r.week_done,
            shares_data: r.shares,
            strava_shared: r.strava_shared,
            strava_connected: r.strava_connected,
            last_activity_at: r.last_activity_at,
        })
        .collect())
}

pub async fn profile(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
) -> sqlx::Result<Option<AthleteProfile>> {
    sqlx::query_as!(
        AthleteProfile,
        "SELECT membership_id, goal, goal_date, level, weekly_sessions, max_hr, resting_hr, threshold_pace_s_per_km, css_s_per_100m, ftp_w,
                recent_race, trainer_notes, updated_at
           FROM athlete_profiles WHERE membership_id = $1",
        membership_id
    )
    .fetch_optional(db)
    .await
}

pub async fn save_profile(
    db: impl PgExecutor<'_>,
    p: &AthleteProfile,
) -> sqlx::Result<AthleteProfile> {
    sqlx::query_as!(
        AthleteProfile,
        "INSERT INTO athlete_profiles (membership_id, goal, goal_date, level, weekly_sessions, max_hr, resting_hr, threshold_pace_s_per_km,
                                       css_s_per_100m, ftp_w, recent_race, trainer_notes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
         ON CONFLICT (membership_id) DO UPDATE SET goal = $2, goal_date = $3, level = $4, weekly_sessions = $5, max_hr = $6, resting_hr = $7,
                threshold_pace_s_per_km = $8, css_s_per_100m = $9, ftp_w = $10, recent_race = $11, trainer_notes = $12, updated_at = now()
         RETURNING membership_id, goal, goal_date, level, weekly_sessions, max_hr, resting_hr, threshold_pace_s_per_km, css_s_per_100m, ftp_w,
                   recent_race, trainer_notes, updated_at",
        p.membership_id,
        p.goal,
        p.goal_date,
        p.level,
        p.weekly_sessions,
        p.max_hr,
        p.resting_hr,
        p.threshold_pace_s_per_km,
        p.css_s_per_100m,
        p.ftp_w,
        p.recent_race,
        p.trainer_notes
    )
    .fetch_one(db)
    .await
}

/// Latest pace and HR zone sets (what the apps show).
pub async fn zones(db: impl PgExecutor<'_>, membership_id: Uuid) -> sqlx::Result<Vec<ZoneSet>> {
    sqlx::query_as!(
        ZoneSet,
        "SELECT DISTINCT ON (kind) id, membership_id, kind, source, bounds, valid_from, created_by, created_at
           FROM zones WHERE membership_id = $1 AND kind IN ('pace', 'hr') ORDER BY kind DESC, valid_from DESC, created_at DESC",
        membership_id
    )
    .fetch_all(db)
    .await
}

pub async fn insert_zones(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
    kind: &str,
    source: &str,
    bounds: &Value,
    valid_from: NaiveDate,
    by: Uuid,
) -> sqlx::Result<ZoneSet> {
    sqlx::query_as!(
        ZoneSet,
        "INSERT INTO zones (id, membership_id, kind, source, bounds, valid_from, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, membership_id, kind, source, bounds, valid_from, created_by, created_at",
        Uuid::now_v7(),
        membership_id,
        kind,
        source,
        bounds,
        valid_from,
        by
    )
    .fetch_one(db)
    .await
}

/// Activities a trainer may see (needs `share_training_data`; Strava ones also `share_strava`), newest first,
/// each with the workout it completed (`matched_workout`).
pub async fn visible_activities(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    strava_shared: bool,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<(Activity, Option<Value>)>> {
    let rows = sqlx::query!(
        r#"SELECT a.id, a.user_id, a.source, a.external_id, a.sport, a.name, a.started_at, a.duration_s, a.moving_time_s, a.distance_m, a.elevation_gain_m,
                  a.avg_hr, a.max_hr, a.avg_pace_s_per_km, a.avg_power_w, a.calories, a.laps, a.polyline, a.created_at,
                  (SELECT jsonb_build_object('id', p.id, 'title', p.title, 'date', p.date, 'club_id', p.club_id, 'compliance_pct', c.compliance_pct,
                                             'est_distance_m', p.est_distance_m, 'est_duration_s', p.est_duration_s)
                     FROM workout_completions c JOIN planned_workouts p ON p.id = c.planned_workout_id WHERE c.activity_id = a.id LIMIT 1) AS matched
             FROM activities a WHERE a.user_id = $1 AND (a.source <> 'strava' OR $2)
            ORDER BY a.started_at DESC LIMIT $3 OFFSET $4"#,
        user_id,
        strava_shared,
        limit,
        offset
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                Activity {
                    id: r.id,
                    user_id: r.user_id,
                    source: r.source,
                    external_id: r.external_id,
                    sport: r.sport,
                    name: r.name,
                    started_at: r.started_at,
                    duration_s: r.duration_s,
                    moving_time_s: r.moving_time_s,
                    distance_m: r.distance_m,
                    elevation_gain_m: r.elevation_gain_m,
                    avg_hr: r.avg_hr,
                    max_hr: r.max_hr,
                    avg_pace_s_per_km: r.avg_pace_s_per_km,
                    avg_power_w: r.avg_power_w,
                    calories: r.calories,
                    laps: r.laps,
                    polyline: r.polyline,
                    created_at: r.created_at,
                },
                r.matched,
            )
        })
        .collect())
}

/// Per week (Monday) for 12 weeks: planned seconds, and from visible activities the done seconds, distance, sessions.
pub async fn weekly(
    db: impl PgExecutor<'_>,
    membership_id: Uuid,
    user_id: Uuid,
    timezone: &str,
    first_monday: NaiveDate,
    visible: bool,
    strava_shared: bool,
) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"SELECT jsonb_agg(jsonb_build_object(
                    'week_start', w, 'planned_s',
                    (SELECT coalesce(sum(p.est_duration_s), 0) FROM planned_workouts p WHERE p.athlete_membership_id = $1 AND p.date BETWEEN w AND w + 6),
                    'done_s', (SELECT coalesce(sum(a.duration_s), 0) FROM activities a WHERE $5 AND a.user_id = $2 AND (a.source <> 'strava' OR $6)
                                 AND (a.started_at AT TIME ZONE $3)::date BETWEEN w AND w + 6),
                    'distance_m', (SELECT coalesce(sum(a.distance_m), 0) FROM activities a WHERE $5 AND a.user_id = $2 AND (a.source <> 'strava' OR $6)
                                 AND (a.started_at AT TIME ZONE $3)::date BETWEEN w AND w + 6),
                    'sessions', (SELECT count(*) FROM activities a WHERE $5 AND a.user_id = $2 AND (a.source <> 'strava' OR $6)
                                 AND (a.started_at AT TIME ZONE $3)::date BETWEEN w AND w + 6)) ORDER BY w) AS "weeks!"
             FROM (SELECT ($4::date + 7 * i) AS w FROM generate_series(0, 11) AS i) weeks"#,
        membership_id,
        user_id,
        timezone,
        first_monday,
        visible,
        strava_shared
    )
    .fetch_one(db)
    .await
}

pub async fn groups_of(db: impl PgExecutor<'_>, membership_id: Uuid) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"SELECT coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.name), '[]') AS "x!"
             FROM groups g JOIN group_members x ON x.group_id = g.id WHERE x.membership_id = $1"#,
        membership_id
    )
    .fetch_one(db)
    .await
}

// ------------------------------------------------------------------------------------ dashboard

/// Students with a Strava connection and their last sync.
pub async fn strava_syncs(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
) -> sqlx::Result<Vec<(Uuid, Option<DateTime<Utc>>)>> {
    let rows = sqlx::query!(
        "SELECT m.id, pc.last_sync_at FROM memberships m JOIN provider_connections pc ON pc.user_id = m.user_id
          WHERE m.club_id = $1 AND m.role = 'student' AND m.status = 'active' AND pc.provider = 'strava' AND pc.status = 'active'",
        club_id
    )
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|r| (r.id, r.last_sync_at)).collect())
}

/// Memberships with any workout from `today` on.
pub async fn with_future_workouts(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    today: NaiveDate,
) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!("SELECT DISTINCT athlete_membership_id FROM planned_workouts WHERE club_id = $1 AND date >= $2", club_id, today)
        .fetch_all(db)
        .await
}

/// Next 3 scheduled classes: `{session, class_type, booked, waitlist}`.
pub async fn upcoming_classes(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Value> {
    sqlx::query_scalar!(
        r#"SELECT coalesce(jsonb_agg(x ORDER BY (x->'session'->>'starts_at')), '[]') AS "x!" FROM (
             SELECT jsonb_build_object('session', to_jsonb(s), 'class_type', to_jsonb(t),
                      'booked', (SELECT count(*) FROM bookings b WHERE b.session_id = s.id AND b.status = 'booked'),
                      'waitlist', (SELECT count(*) FROM bookings b WHERE b.session_id = s.id AND b.status = 'waitlisted')) AS x
               FROM class_sessions s JOIN class_types t ON t.id = s.class_type_id
              WHERE s.club_id = $1 AND s.status = 'scheduled' AND s.starts_at > now()
              ORDER BY s.starts_at LIMIT 3) q"#,
        club_id
    )
    .fetch_one(db)
    .await
}

pub struct Onboarding {
    pub logo: bool,
    pub colors: bool,
    pub groups: bool,
    pub strava: bool,
}

pub async fn onboarding(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Onboarding> {
    sqlx::query_as!(
        Onboarding,
        r#"SELECT coalesce((SELECT logo_asset_id IS NOT NULL FROM club_branding WHERE club_id = $1), false) AS "logo!",
                  coalesce((SELECT primary_color IS NOT NULL FROM club_branding WHERE club_id = $1), false) AS "colors!",
                  EXISTS (SELECT 1 FROM groups WHERE club_id = $1) AS "groups!",
                  EXISTS (SELECT 1 FROM memberships m JOIN provider_connections pc ON pc.user_id = m.user_id
                           WHERE m.club_id = $1 AND m.role = 'student' AND m.status = 'active' AND pc.status = 'active') AS "strava!""#,
        club_id
    )
    .fetch_one(db)
    .await
}
