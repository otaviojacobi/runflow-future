//! The student side (M1–M5): own calendar, workout detail with personal targets, completion + feedback, Today.

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{Duration, NaiveDate, Utc};
use runflow_db::models::{Club, Workout};
use runflow_db::{my as db, workouts};
use runflow_domain::week;
use runflow_domain::workout::resolve_targets;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{Member, member};
use crate::body::Body;
use crate::routes::weeks::auto_release_at;
use crate::routes::workouts::not_found;
use crate::session::Auth;
use crate::time::{club_today, monday_of, parse_date};
use crate::{AppState, FieldError, Problem};

const STUDENT: &[&str] = &["student"];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/my/workouts", get(list))
        .route("/clubs/{club_id}/my/workouts/{id}", get(one))
        .route(
            "/clubs/{club_id}/my/workouts/{id}/completion",
            put(complete),
        )
        .route("/clubs/{club_id}/my/summary", get(summary))
}

async fn club_tz(state: &AppState, club_id: Uuid) -> Result<String, Problem> {
    Ok(runflow_db::clubs::club(&state.db, club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?
        .timezone)
}

/// One of the caller's own released workouts (another student's, or a draft → 404).
async fn mine(state: &AppState, m: &Member, id: &str) -> Result<Workout, Problem> {
    let id = Uuid::parse_str(id).map_err(|_| not_found())?;
    workouts::one(&state.db, m.club_id, m.membership_id, id)
        .await?
        .filter(|w| w.athlete_membership_id == m.membership_id && w.visible)
        .ok_or_else(not_found)
}

#[derive(Deserialize)]
struct Range {
    from: Option<String>,
    to: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    Query(q): Query<Range>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STUDENT).await?;
    let (Some(from), Some(to)) = (
        q.from.as_deref().and_then(parse_date),
        q.to.as_deref().and_then(parse_date),
    ) else {
        return Err(Problem::field("from", "Informe o período (from e to)."));
    };
    let items = workouts::list(
        &state.db,
        m.club_id,
        m.membership_id,
        workouts::Filter {
            from,
            to,
            athlete: Some(m.membership_id),
            group: None,
            only: None,
            drafts: false,
        },
    )
    .await?;
    let club = runflow_db::clubs::club(&state.db, m.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    let unreleased = unreleased_weeks(&state, &club, m.membership_id, from, to).await?;
    Ok(Json(
        json!({ "items": items, "unreleased_weeks": unreleased, "next_cursor": null }),
    ))
}

/// Future weeks in the range the trainer hasn't released to this student yet (D-031), whether or not anything is
/// planned in them: `[{week_start, auto_release_at}]`.
async fn unreleased_weeks(
    state: &AppState,
    club: &Club,
    athlete: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<Value>, Problem> {
    if club.release_mode != "weekly" {
        return Ok(Vec::new());
    }
    let first_future = week::this_monday(Utc::now(), &club.timezone) + Duration::days(7);
    let weeks: Vec<NaiveDate> = (0..60)
        .map(|i| week::monday_of(from).max(first_future) + Duration::days(7 * i))
        .take_while(|w| *w <= to)
        .collect();
    if weeks.is_empty() {
        return Ok(Vec::new());
    }
    let released = runflow_db::weeks::released_for(&state.db, club.id, athlete, &weeks).await?;
    Ok(weeks
        .into_iter()
        .filter(|w| !released.contains(w))
        .map(|w| json!({ "week_start": w, "auto_release_at": auto_release_at(club, w) }))
        .collect())
}

async fn one(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STUDENT).await?;
    let w = mine(&state, &m, &id).await?;
    let tz = club_tz(&state, m.club_id).await?;
    let zones = db::latest_zones(&state.db, m.membership_id).await?;
    let activity = match w.completion.as_ref().and_then(|c| c.activity_id) {
        Some(a) => workouts::activity(&state.db, a).await?,
        None => None,
    };
    let candidates = db::activities_between(
        &state.db,
        auth.user_id,
        &tz,
        w.date - Duration::days(1),
        w.date + Duration::days(1),
    )
    .await?;
    let coach = runflow_db::workouts::athlete(&state.db, w.created_by)
        .await?
        .map(|(_, a)| a["user"].clone());
    let mut out = serde_json::to_value(&w).map_err(|_| Problem::internal())?;
    out["structure"] = resolve_targets(&w.structure, &zones);
    out["activity"] = json!(activity);
    out["candidate_activities"] = json!(candidates);
    out["coach"] = coach.unwrap_or(Value::Null);
    Ok(Json(out))
}

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

async fn complete(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Workout>, Problem> {
    let m = member(&state, &auth, &club_id, STUDENT).await?;
    let w = mine(&state, &m, &id).await?;
    let mut errors = Vec::new();
    let status = body
        .str("status")
        .filter(|s| ["completed", "partial", "missed", "skipped"].contains(&s.as_str()));
    if status.is_none() {
        errors.push(fail("status", "Diga se você fez o treino."));
    }
    let rpe = match body.get("rpe") {
        None | Some(Value::Null) => None,
        Some(v) => match v.as_i64().filter(|r| (1..=10).contains(r)) {
            Some(r) => Some(r as i32),
            None => {
                errors.push(fail("rpe", "O esforço vai de 1 a 10."));
                None
            }
        },
    };
    let feeling = body.str("feeling");
    if feeling
        .as_ref()
        .is_some_and(|f| !["great", "good", "ok", "bad", "awful"].contains(&f.as_str()))
    {
        errors.push(fail("feeling", "Escolha como você se sentiu."));
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let status = status.unwrap_or_default();

    // The activity: the one chosen (must be theirs), else a same-day activity of the same sport.
    let tz = club_tz(&state, m.club_id).await?;
    let activity = match body.str("activity_id") {
        Some(id) => {
            let a = Uuid::parse_str(&id)
                .ok()
                .map(|id| workouts::activity(&state.db, id));
            let a = match a {
                Some(f) => f.await?,
                None => None,
            };
            Some(
                a.filter(|a| a.user_id == auth.user_id)
                    .ok_or_else(|| Problem::field("activity_id", "Atividade inválida."))?,
            )
        }
        None if status != "missed" && status != "skipped" => {
            db::activities_between(&state.db, auth.user_id, &tz, w.date, w.date)
                .await?
                .into_iter()
                .find(|a| a.sport == w.sport)
        }
        None => None,
    };
    let mut compliance: i64 = match status.as_str() {
        "completed" => 100,
        "partial" => 60,
        _ => 0,
    };
    if let Some(a) = &activity {
        if let (Some(est), Some(d)) = (w.est_distance_m.filter(|e| *e > 0), a.distance_m) {
            compliance = ((d as f64 / est as f64) * 100.0).round() as i64;
        } else if let Some(est) = w.est_duration_s.filter(|e| *e > 0) {
            compliance = ((a.duration_s as f64 / est as f64) * 100.0).round() as i64;
        }
    }
    let comment = body.str("comment");
    let mut tx = state.db.begin().await?;
    let (_, fresh) = db::upsert_completion(
        &mut tx,
        w.id,
        db::CompletionInput {
            activity_id: activity.as_ref().map(|a| a.id),
            status: &status,
            compliance_pct: compliance.clamp(0, 200) as i32,
            rpe,
            feeling: feeling.as_deref(),
            comment: comment.as_deref(),
        },
    )
    .await?;
    if fresh {
        let me = runflow_db::auth::user_by_id(&mut *tx, auth.user_id)
            .await?
            .ok_or_else(Problem::unauthorized)?;
        let what = if status == "missed" {
            "não fez o treino"
        } else {
            "registrou o treino"
        };
        db::notify_membership_user(
            &mut *tx,
            w.created_by,
            m.club_id,
            "feedback",
            &format!("{} {what}", me.name),
            Some(comment.as_deref().unwrap_or(&w.title)),
            "/feedback",
        )
        .await?;
    }
    tx.commit().await?;
    Ok(Json(
        workouts::one(&state.db, m.club_id, m.membership_id, w.id)
            .await?
            .ok_or_else(not_found)?,
    ))
}

async fn summary(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STUDENT).await?;
    let tz = club_tz(&state, m.club_id).await?;
    let monday = monday_of(club_today(&tz));
    let week = workouts::list(
        &state.db,
        m.club_id,
        m.membership_id,
        workouts::Filter {
            from: monday,
            to: monday + Duration::days(6),
            athlete: Some(m.membership_id),
            group: None,
            only: None,
            drafts: false,
        },
    )
    .await?;
    let done = |w: &Workout| {
        w.completion
            .as_ref()
            .is_some_and(|c| c.status == "completed" || c.status == "partial")
    };
    // Streak: consecutive past weeks (before this one) with workouts planned and at least one done.
    let history = db::weeks_done(
        &state.db,
        m.membership_id,
        monday - Duration::days(7 * 52),
        monday - Duration::days(1),
    )
    .await?;
    let mut streak = 0;
    for w in 1..52 {
        let mon = monday - Duration::days(7 * w);
        match history.iter().find(|(wk, _, _)| *wk == mon) {
            Some((_, planned, d)) if *planned > 0 && *d > 0 => streak += 1,
            _ => break,
        }
    }
    Ok(Json(json!({
        "shares_data": workouts::shares_training(&state.db, auth.user_id, m.club_id).await?,
        "streak_weeks": streak,
        "week": {
            "planned": week.len(),
            "done": week.iter().filter(|w| done(w)).count(),
            "duration_s": week.iter().map(|w| w.est_duration_s.unwrap_or(0) as i64).sum::<i64>(),
            "distance_m": week.iter().map(|w| w.est_distance_m.unwrap_or(0) as i64).sum::<i64>(),
        },
        "last_activity": db::last_activity(&state.db, auth.user_id).await?,
        "next_class": db::next_class(&state.db, m.membership_id).await?,
    })))
}
