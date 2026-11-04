//! Trainer views of students (W1–W3), student profiles (A4, M7), zones, and the dashboard (W1).

use std::collections::HashMap;

use axum::extract::{Path, Query, RawQuery, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use runflow_db::athletes::{self as db, Summary};
use runflow_db::models::{AthleteProfile, Workout};
use runflow_db::workouts;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{Member, STAFF, member};
use crate::body::Body;
use crate::cache;
use crate::session::Auth;
use crate::time::{club_today, monday_of, parse_date};
use crate::{AppState, FieldError, Problem};

const GOALS: [&str; 10] = [
    "health",
    "5k",
    "10k",
    "21k",
    "42k",
    "trail",
    "triathlon",
    "swim",
    "strength",
    "other",
];
const LEVELS: [&str; 3] = ["beginner", "intermediate", "advanced"];
/// Pace zones as factors of the threshold pace (s/km; bigger = slower), HR zones as fractions of max HR.
const ZF_PACE: [f64; 5] = [1.3, 1.17, 1.08, 1.0, 0.94];
const ZF_HR: [f64; 5] = [0.6, 0.7, 0.8, 0.9, 1.0];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/athletes", get(list))
        .route("/clubs/{club_id}/athletes/{membership_id}", get(detail))
        .route(
            "/clubs/{club_id}/athletes/{membership_id}/profile",
            put(trainer_profile),
        )
        .route(
            "/clubs/{club_id}/athletes/{membership_id}/zones",
            put(set_zones),
        )
        .route(
            "/clubs/{club_id}/athletes/{membership_id}/activities",
            get(activities),
        )
        .route(
            "/clubs/{club_id}/my/profile",
            get(my_profile).put(update_my_profile),
        )
        .route("/clubs/{club_id}/dashboard", get(dashboard))
}

async fn club(state: &AppState, club_id: Uuid) -> Result<runflow_db::models::Club, Problem> {
    runflow_db::clubs::club(&state.db, club_id)
        .await?
        .ok_or_else(Problem::club_not_found)
}

/// The summary JSON (the mock's `athleteSummary`): last activity and Strava status respect consent.
fn summary_json(s: &Summary) -> Value {
    json!({
        "membership": s.membership, "user": s.user, "group_ids": s.group_ids, "goal": s.goal, "level": s.level,
        "compliance_pct": s.compliance_pct, "week": { "planned": s.week_planned, "done": s.week_done },
        "last_activity_at": if s.shares_data { json!(s.last_activity_at) } else { Value::Null },
        "strava": if !s.strava_connected { "none" } else if s.strava_shared { "shared" } else { "private" },
        "shares_data": s.shares_data,
    })
}

#[derive(Deserialize)]
struct ListQuery {
    q: Option<String>,
    group_id: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn list(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    Query(f): Query<ListQuery>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let today = club_today(&club(&state, m.club_id).await?.timezone);
    let group = f
        .group_id
        .as_deref()
        .map(|g| Uuid::parse_str(g).unwrap_or(Uuid::nil()));
    let needle =
        f.q.as_deref()
            .map(crate::routes::members::sort_key)
            .filter(|q| !q.is_empty());
    let mut items: Vec<Summary> =
        db::summaries(&state.db, m.club_id, today, monday_of(today), group, None)
            .await?
            .into_iter()
            .filter(|s| {
                needle
                    .as_ref()
                    .is_none_or(|q| crate::routes::members::sort_key(&s.user.name).contains(q))
            })
            .collect();
    items.sort_by_key(|s| crate::routes::members::sort_key(&s.user.name));
    let start = f
        .cursor
        .as_deref()
        .and_then(|c| c.parse::<usize>().ok())
        .unwrap_or(0);
    let limit = f.limit.unwrap_or(500).clamp(1, 500);
    let next = (start + limit < items.len()).then(|| (start + limit).to_string());
    Ok(Json(
        json!({ "items": items.iter().skip(start).take(limit).map(summary_json).collect::<Vec<_>>(), "next_cursor": next }),
    ))
}

/// An active student of this club (staff only).
async fn athlete(
    state: &AppState,
    auth: &Auth,
    club_id: &str,
    id: &str,
) -> Result<(Member, Summary, NaiveDate, String), Problem> {
    let m = member(state, auth, club_id, STAFF).await?;
    let missing = || {
        Problem::new(
            StatusCode::NOT_FOUND,
            "athlete.not_found",
            "Aluno não encontrado",
            "Ele pode ter saído do clube.",
        )
    };
    let id = Uuid::parse_str(id).map_err(|_| missing())?;
    let c = club(state, m.club_id).await?;
    let today = club_today(&c.timezone);
    let s = db::summaries(
        &state.db,
        m.club_id,
        today,
        monday_of(today),
        None,
        Some(id),
    )
    .await?
    .pop()
    .ok_or_else(missing)?;
    Ok((m, s, today, c.timezone))
}

fn empty_profile(membership_id: Uuid) -> AthleteProfile {
    AthleteProfile {
        membership_id,
        goal: None,
        goal_note: None,
        goal_date: None,
        level: None,
        weekly_sessions: None,
        max_hr: None,
        resting_hr: None,
        threshold_pace_s_per_km: None,
        css_s_per_100m: None,
        ftp_w: None,
        recent_race: None,
        trainer_notes: None,
        updated_at: Utc::now(),
    }
}

async fn detail(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let (_, s, today, tz) = athlete(&state, &auth, &club_id, &id).await?;
    let mid = s.membership.id;
    let profile = db::profile(&state.db, mid)
        .await?
        .unwrap_or_else(|| empty_profile(mid));
    let first_monday = monday_of(today) - Duration::days(7 * 11);
    let mut weekly = db::weekly(
        &state.db,
        mid,
        s.user.id,
        &tz,
        first_monday,
        s.shares_data,
        s.strava_shared,
    )
    .await?;
    if let Some(weeks) = weekly.as_array_mut() {
        for w in weeks {
            let current = w["week_start"].as_str() == Some(monday_of(today).to_string().as_str());
            w["current"] = json!(current);
        }
    }
    let recent = if s.shares_data {
        activities_json(
            &state,
            db::visible_activities(&state.db, s.user.id, s.strava_shared, 10, 0).await?,
        )
        .await?
    } else {
        Vec::new()
    };
    let mut out = summary_json(&s);
    out["profile"] = json!(profile);
    out["zones"] = json!(db::zones(&state.db, mid).await?);
    out["consents"] = json!({ "training_data": s.shares_data, "strava": s.strava_shared });
    out["weekly"] = weekly;
    out["recent_activities"] = json!(recent);
    out["groups"] = db::groups_of(&state.db, mid).await?;
    Ok(Json(out))
}

use crate::routes::providers::activities_json;

#[derive(Deserialize)]
struct Page {
    cursor: Option<String>,
    limit: Option<i64>,
}

async fn activities(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    Query(p): Query<Page>,
) -> Result<Json<Value>, Problem> {
    let (_, s, _, _) = athlete(&state, &auth, &club_id, &id).await?;
    let limit = p.limit.unwrap_or(50).clamp(1, 200);
    let start = p
        .cursor
        .as_deref()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(0);
    if !s.shares_data {
        return Ok(Json(json!({ "items": [], "next_cursor": null })));
    }
    let rows =
        db::visible_activities(&state.db, s.user.id, s.strava_shared, limit + 1, start).await?;
    let next = (rows.len() as i64 > limit).then(|| (start + limit).to_string());
    let items = activities_json(&state, rows.into_iter().take(limit as usize).collect()).await?;
    Ok(Json(json!({ "items": items, "next_cursor": next })))
}

// ------------------------------------------------------------------------------------ profiles

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

/// Riegel: a race time projected to 10 km, as s/km (≈ threshold pace).
fn threshold_from_race(distance_m: f64, time_s: f64) -> i32 {
    ((time_s * (10_000.0 / distance_m).powf(1.06)) / 10.0).round() as i32
}

/// Apply profile fields (the mock's `applyProfile`); a trainer may also set physiology and notes.
fn apply_profile(p: &mut AthleteProfile, b: &Body, trainer: bool) -> Result<(), Problem> {
    let mut errors = Vec::new();
    let opt_str = |k: &str| match b.get(k) {
        None => None,
        Some(Value::Null) => Some(None),
        Some(v) => Some(
            v.as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
        ),
    };
    if let Some(goal) = opt_str("goal") {
        match goal {
            Some(g) if !GOALS.contains(&g.as_str()) => {
                errors.push(fail("goal", "Escolha um objetivo."))
            }
            g => p.goal = g,
        }
    }
    if let Some(level) = opt_str("level") {
        match level {
            Some(l) if !LEVELS.contains(&l.as_str()) => {
                errors.push(fail("level", "Escolha o nível."))
            }
            l => p.level = l,
        }
    }
    if let Some(note) = opt_str("goal_note") {
        match note {
            Some(n) if n.chars().count() > 120 => {
                errors.push(fail("goal_note", "Use no máximo 120 caracteres."))
            }
            n => p.goal_note = n,
        }
    }
    if let Some(d) = opt_str("goal_date") {
        match d.as_deref().map(parse_date) {
            Some(None) => errors.push(fail("goal_date", "Data inválida.")),
            Some(Some(date)) => p.goal_date = Some(date),
            None => p.goal_date = None,
        }
    }
    let mut int = |k: &'static str,
                   range: std::ops::RangeInclusive<i64>,
                   msg: &'static str|
     -> Option<Option<i32>> {
        match b.get(k) {
            None => None,
            Some(Value::Null) => Some(None),
            Some(v) => match v.as_i64().filter(|n| range.contains(n)) {
                Some(n) => Some(Some(n as i32)),
                None => {
                    errors.push(fail(k, msg));
                    None
                }
            },
        }
    };
    if let Some(v) = int(
        "weekly_sessions",
        0..=14,
        "Entre 0 e 14 treinos por semana.",
    ) {
        p.weekly_sessions = v;
    }
    if let Some(v) = int(
        "max_hr",
        100..=240,
        "Informe uma FC máxima entre 100 e 240 bpm.",
    ) {
        p.max_hr = v;
    }
    if let Some(v) = int(
        "resting_hr",
        25..=120,
        "Informe uma FC de repouso entre 25 e 120 bpm.",
    ) {
        p.resting_hr = v;
    }
    if trainer {
        if let Some(v) = int(
            "threshold_pace_s_per_km",
            150..=900,
            "Informe um pace de limiar entre 2:30 e 15:00 /km.",
        ) {
            p.threshold_pace_s_per_km = v;
        }
        if let Some(v) = int("css_s_per_100m", 50..=300, "Valor inválido.") {
            p.css_s_per_100m = v;
        }
        if let Some(v) = int("ftp_w", 50..=600, "Valor inválido.") {
            p.ftp_w = v;
        }
    }
    match b.get("recent_race") {
        None => {}
        Some(Value::Null) => p.recent_race = None,
        Some(r) => {
            let (d, t) = (
                r["distance_m"].as_f64().unwrap_or(0.0),
                r["time_s"].as_f64().unwrap_or(0.0),
            );
            if d > 0.0 && t > 0.0 {
                p.recent_race = Some(r.clone());
                // A recent race estimates the threshold pace when none is set.
                if p.threshold_pace_s_per_km.is_none() {
                    p.threshold_pace_s_per_km = Some(threshold_from_race(d, t));
                }
            } else {
                errors.push(fail("recent_race", "Informe a distância e o tempo."));
            }
        }
    }
    if trainer && b.has("trainer_notes") {
        p.trainer_notes = b.str("trainer_notes");
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(Problem::invalid(errors))
    }
}

async fn trainer_profile(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<AthleteProfile>, Problem> {
    let (_, s, _, _) = athlete(&state, &auth, &club_id, &id).await?;
    let mut p = db::profile(&state.db, s.membership.id)
        .await?
        .unwrap_or_else(|| empty_profile(s.membership.id));
    apply_profile(&mut p, &body, true)?;
    Ok(Json(db::save_profile(&state.db, &p).await?))
}

/// The student's view of their profile: no trainer notes, plus their zones (read-only).
async fn student_view(state: &AppState, mid: Uuid, p: AthleteProfile) -> Result<Value, Problem> {
    let mut v = serde_json::to_value(p).map_err(|_| Problem::internal())?;
    if let Some(o) = v.as_object_mut() {
        o.remove("trainer_notes");
    }
    v["zones"] = json!(db::zones(&state.db, mid).await?);
    Ok(v)
}

async fn my_profile(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, &["student"]).await?;
    let p = db::profile(&state.db, m.membership_id)
        .await?
        .unwrap_or_else(|| empty_profile(m.membership_id));
    Ok(Json(student_view(&state, m.membership_id, p).await?))
}

async fn update_my_profile(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, &["student"]).await?;
    let mut p = db::profile(&state.db, m.membership_id)
        .await?
        .unwrap_or_else(|| empty_profile(m.membership_id));
    apply_profile(&mut p, &body, false)?;
    let saved = db::save_profile(&state.db, &p).await?;
    Ok(Json(student_view(&state, m.membership_id, saved).await?))
}

// ------------------------------------------------------------------------------------ zones

async fn set_zones(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let (m, s, today, _) = athlete(&state, &auth, &club_id, &id).await?;
    let mid = s.membership.id;
    let mut profile = db::profile(&state.db, mid).await?;
    let race = body.get("race").filter(|r| {
        r["distance_m"].as_f64().unwrap_or(0.0) > 0.0 && r["time_s"].as_f64().unwrap_or(0.0) > 0.0
    });
    let (kind, bounds) = match body.str("kind").as_deref() {
        Some("pace") => {
            let thr = body
                .get("threshold_pace_s_per_km")
                .and_then(Value::as_i64)
                .map(|t| t as i32)
                .or_else(|| {
                    race.map(|r| {
                        threshold_from_race(
                            r["distance_m"].as_f64().unwrap_or(1.0),
                            r["time_s"].as_f64().unwrap_or(0.0),
                        )
                    })
                })
                .filter(|t| (150..=900).contains(t))
                .ok_or_else(|| {
                    Problem::field(
                        "threshold_pace_s_per_km",
                        "Informe um pace de limiar entre 2:30 e 15:00 /km, ou uma prova.",
                    )
                })?;
            let t = thr as f64;
            let bounds: Vec<Value> =
                (0..5).map(|i| json!({ "zone": i + 1, "min": (t * ZF_PACE.get(i + 1).copied().unwrap_or(0.85)).round() as i64, "max": (t * ZF_PACE[i]).round() as i64 })).collect();
            if let Some(p) = profile.as_mut() {
                p.threshold_pace_s_per_km = Some(thr);
            }
            ("pace", bounds)
        }
        Some("hr") => {
            let max = body
                .get("max_hr")
                .and_then(Value::as_i64)
                .filter(|h| (120..=230).contains(h))
                .ok_or_else(|| {
                    Problem::field("max_hr", "Informe uma FC máxima entre 120 e 230 bpm.")
                })?;
            let h = max as f64;
            let bounds: Vec<Value> =
                (0..5).map(|i| json!({ "zone": i + 1, "min": (h * if i == 0 { 0.5 } else { ZF_HR[i - 1] }).round() as i64, "max": (h * ZF_HR[i]).round() as i64 })).collect();
            if let Some(p) = profile.as_mut() {
                p.max_hr = Some(max as i32);
            }
            ("hr", bounds)
        }
        _ => return Err(Problem::field("kind", "Tipo de zona inválido.")),
    };
    let source = if race.is_some() {
        "race"
    } else if body.str("source").as_deref() == Some("test") {
        "test"
    } else {
        "manual"
    };
    let z = db::insert_zones(
        &state.db,
        mid,
        kind,
        source,
        &json!(bounds),
        today,
        m.membership_id,
    )
    .await?;
    if let Some(p) = profile {
        db::save_profile(&state.db, &p).await?;
    }
    Ok(Json(json!(z)))
}

// ------------------------------------------------------------------------------------ dashboard

#[derive(Deserialize)]
struct DashQuery {
    date: Option<String>,
}

/// Compliance of past workouts (completed = 1, partial = ½); `None` when nothing is in the past.
fn score(ws: &[&Workout], today: NaiveDate) -> Option<i64> {
    let past: Vec<&&Workout> = ws.iter().filter(|w| w.date < today).collect();
    if past.is_empty() {
        return None;
    }
    let pts: f64 = past
        .iter()
        .map(|w| match w.completion.as_ref().map(|c| c.status.as_str()) {
            Some("completed") => 1.0,
            Some("partial") => 0.5,
            _ => 0.0,
        })
        .sum();
    Some((pts / past.len() as f64 * 100.0).round() as i64)
}

fn is_done(w: &Workout) -> bool {
    w.completion
        .as_ref()
        .is_some_and(|c| c.status == "completed" || c.status == "partial")
}

/// Cached briefly in Valkey (D-047): any write to the club refreshes it at once.
async fn dashboard(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    RawQuery(raw): RawQuery,
    Query(q): Query<DashQuery>,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    // The answer depends on who looks (their unread threads, the plan as their role sees it) and on the query.
    let variant = format!("{}?{}", m.membership_id, raw.unwrap_or_default());
    cache::json(
        &state,
        "dashboard",
        m.club_id,
        &variant,
        cache::DASHBOARD_TTL,
        dashboard_json(&state, &m, q),
    )
    .await
}

async fn dashboard_json(state: &AppState, m: &Member, q: DashQuery) -> Result<Value, Problem> {
    let today = q
        .date
        .as_deref()
        .and_then(parse_date)
        .unwrap_or(club_today(&club(state, m.club_id).await?.timezone));
    let monday = monday_of(today);
    let students = db::summaries(&state.db, m.club_id, today, monday, None, None).await?;
    let ids: std::collections::HashSet<Uuid> = students.iter().map(|s| s.membership.id).collect();
    let user_of: HashMap<Uuid, Value> = students
        .iter()
        .map(|s| {
            (
                s.membership.id,
                json!({ "membership_id": s.membership.id, "user": s.user }),
            )
        })
        .collect();
    let from = (monday - Duration::days(49)).min(today - Duration::days(60));
    let all: Vec<Workout> = workouts::list(
        &state.db,
        m.club_id,
        m.membership_id,
        workouts::Filter {
            from,
            to: monday + Duration::days(6),
            athlete: None,
            group: None,
            only: None,
            drafts: true,
        },
    )
    .await?
    .into_iter()
    .filter(|w| ids.contains(&w.athlete_membership_id))
    .collect();

    let todays: Vec<&Workout> = all.iter().filter(|w| w.date == today).collect();
    let week: Vec<&Workout> = all
        .iter()
        .filter(|w| w.date >= monday && w.date <= monday + Duration::days(6))
        .collect();
    let trend: Vec<Value> = (0..8)
        .map(|i| {
            let mon = monday - Duration::days(7 * (7 - i));
            let ws: Vec<&Workout> = all.iter().filter(|w| w.date >= mon && w.date <= mon + Duration::days(6)).collect();
            json!({ "week_start": mon, "pct": score(&ws, today), "planned": ws.len(), "done": ws.iter().filter(|w| is_done(w)).count(), "current": mon == monday })
        })
        .collect();

    // Feedback waiting (7 days): unread threads, or a completion comment no staff answered yet.
    let recent: Vec<&Workout> = all
        .iter()
        .filter(|w| w.date >= today - Duration::days(7) && w.date <= today)
        .collect();
    let comments =
        runflow_db::my::comments(&state.db, &recent.iter().map(|w| w.id).collect::<Vec<_>>())
            .await?;
    let mut waiting: Vec<(&Workout, Option<&runflow_db::my::CommentRow>)> = recent
        .iter()
        .filter(|w| {
            let staff_replied = comments
                .iter()
                .any(|c| c.planned_workout_id == w.id && c.author_role != "student");
            w.unread_count > 0
                || (w.completion.as_ref().is_some_and(|c| c.comment.is_some()) && !staff_replied)
        })
        .map(|w| {
            (
                *w,
                comments
                    .iter()
                    .filter(|c| c.planned_workout_id == w.id)
                    .max_by_key(|c| c.created_at),
            )
        })
        .collect();
    let at = |w: &Workout| {
        w.completion
            .as_ref()
            .map(|c| c.updated_at.to_rfc3339())
            .unwrap_or_else(|| w.date.to_string())
    };
    waiting.sort_by_key(|(w, _)| std::cmp::Reverse(at(w)));
    let feedback: Vec<Value> = waiting
        .into_iter()
        .take(6)
        .map(|(w, last)| {
            json!({
                "workout": w, "athlete": user_of.get(&w.athlete_membership_id),
                "last_comment": last.map(|c| json!({ "id": c.id, "planned_workout_id": c.planned_workout_id, "author_membership_id": c.author_membership_id,
                                                     "body": c.body, "created_at": c.created_at, "edited_at": c.edited_at, "deleted_at": c.deleted_at })),
            })
        })
        .collect();

    // Alerts.
    let mut alerts = Vec::new();
    let syncs: HashMap<Uuid, Option<chrono::DateTime<Utc>>> =
        db::strava_syncs(&state.db, m.club_id)
            .await?
            .into_iter()
            .collect();
    let with_future: std::collections::HashSet<Uuid> =
        db::with_future_workouts(&state.db, m.club_id, today)
            .await?
            .into_iter()
            .collect();
    for s in &students {
        let (name, mid) = (&s.user.name, s.membership.id);
        let athlete = user_of.get(&mid).cloned();
        let link = format!("/students/{mid}");
        let mut past: Vec<&Workout> = all
            .iter()
            .filter(|w| w.athlete_membership_id == mid && w.date < today)
            .collect();
        past.sort_by_key(|w| std::cmp::Reverse(w.date));
        let missed = past
            .iter()
            .take_while(|w| w.completion.as_ref().is_some_and(|c| c.status == "missed"))
            .count();
        if missed >= 2 {
            alerts.push(json!({ "kind": "missed_streak", "severity": "danger", "athlete": athlete, "text": format!("{name} não fez os últimos {missed} treinos"), "link": link }));
        }
        let hard = past
            .iter()
            .take(3)
            .filter(|w| w.completion.as_ref().and_then(|c| c.rpe).unwrap_or(0) >= 9)
            .count();
        if hard >= 2 {
            alerts.push(json!({ "kind": "high_rpe", "severity": "warning", "athlete": athlete, "text": format!("{name} relatou esforço muito alto em {hard} treinos seguidos"), "link": link }));
        }
        if let Some(Some(last)) = syncs.get(&mid)
            && (today - last.date_naive()).num_days() >= 7
        {
            alerts.push(json!({ "kind": "no_sync", "severity": "info", "athlete": athlete, "text": format!("O Strava de {name} não sincroniza há mais de 7 dias"), "link": link }));
        }
        if let Some(b) = s.user.birth_date {
            let upcoming = (0..7).any(|d| {
                let day = today + Duration::days(d);
                day.month() == b.month() && day.day() == b.day()
            });
            if upcoming {
                alerts.push(json!({ "kind": "birthday", "severity": "accent", "athlete": athlete, "text": format!("Aniversário de {name} em {}", b.format("%d/%m")), "link": link }));
            }
        }
        if (today - s.membership.joined_at.date_naive()).num_days() <= 3
            && !with_future.contains(&mid)
        {
            alerts.push(json!({ "kind": "new_member", "severity": "brand", "athlete": athlete, "text": format!("{name} entrou e ainda não tem treinos"), "link": "/planning" }));
        }
    }
    let sub = runflow_db::clubs::subscription(&state.db, m.club_id, &m.role).await?;
    if let Some(s) = &sub
        && let Some(limit) = s.student_limit
        && s.active_students as f64 >= limit as f64 * 0.9
    {
        let plan = &runflow_domain::plans::plan(&s.plan).name;
        alerts.push(json!({ "kind": "plan_limit", "severity": "warning", "athlete": null, "text": format!("{} de {limit} alunos no plano {plan}", s.active_students), "link": "/club/billing" }));
    }

    let ob = db::onboarding(&state.db, m.club_id).await?;
    Ok(json!({
        "date": today,
        "students": students.len(),
        "today": {
            "planned": todays.len(),
            "done": todays.iter().filter(|w| is_done(w)).count(),
            "items": todays.iter().map(|w| json!({ "workout": w, "athlete": user_of.get(&w.athlete_membership_id) })).collect::<Vec<_>>(),
        },
        "week": {
            "planned": week.len(), "done": week.iter().filter(|w| is_done(w)).count(), "compliance_pct": score(&week, today),
            "duration_s": week.iter().map(|w| w.est_duration_s.unwrap_or(0) as i64).sum::<i64>(),
            "distance_m": week.iter().map(|w| w.est_distance_m.unwrap_or(0) as i64).sum::<i64>(),
        },
        "compliance_trend": trend,
        "feedback": feedback,
        "alerts": alerts,
        "onboarding": {
            "logo": ob.logo, "colors": ob.colors, "students": !students.is_empty(),
            "workouts": all.iter().any(|w| w.date >= monday), "groups": ob.groups, "strava": ob.strava,
        },
        "subscription": sub,
    }))
}

#[cfg(test)]
mod tests {
    use super::threshold_from_race;

    #[test]
    fn riegel() {
        // 5 km in 25:00 → ~5:12 /km at 10 km.
        assert_eq!(threshold_from_race(5000.0, 1500.0), 313);
        assert_eq!(threshold_from_race(10_000.0, 3000.0), 300);
    }
}
