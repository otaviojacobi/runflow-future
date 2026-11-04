//! The student side (M1–M5): own calendar, workout detail with personal targets, completion + feedback, Today.

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{Duration, NaiveDate, Utc};
use runflow_db::models::{Club, Workout};
use runflow_db::{matching, my as db, workouts};
use runflow_domain::matching as matching_engine;
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
            activity_since: None,
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

    // The activity (D-049): the one sent (the student's own link), else the one the workout already has, else the
    // likeliest open activity of that day. Missed or skipped drops the link.
    let done = status != "missed" && status != "skipped";
    let (tz, _) = matching::student_clock(&state.db, auth.user_id).await?;
    let current = w.completion.as_ref().and_then(|c| c.activity_id);
    let planned = matching::MatchWorkout {
        id: w.id,
        club_id: w.club_id,
        date: w.date,
        sport: w.sport.clone(),
        est_distance_m: w.est_distance_m,
        est_duration_s: w.est_duration_s,
    };
    let (activity, by) = match body.str("activity_id") {
        Some(id) => {
            let a = match Uuid::parse_str(&id) {
                Ok(id) => matching::activity(&state.db, auth.user_id, id, &tz).await?,
                Err(_) => None,
            };
            (
                Some(a.ok_or_else(|| Problem::field("activity_id", "Atividade inválida."))?),
                Some("student"),
            )
        }
        None if done && current.is_some() => {
            let by = w
                .completion
                .as_ref()
                .and_then(|c| c.matched_by.clone())
                .unwrap_or_else(|| "auto".into());
            let a = match current {
                Some(id) => matching::activity(&state.db, auth.user_id, id, &tz).await?,
                None => None,
            };
            let by = if by == "student" { "student" } else { "auto" };
            (a, Some(by))
        }
        None if done => {
            // Only an activity the student shares with this club (D-011); sending `activity_id` is their own call.
            let engine_w = planned.engine();
            let sharing = matching::sharing(&state.db, auth.user_id).await?;
            let best = matching::free_activities_on(&state.db, auth.user_id, &tz, w.date)
                .await?
                .into_iter()
                .filter_map(|a| {
                    matching_engine::cost(&a.engine_shared(&sharing), &engine_w).map(|c| (c, a))
                })
                .min_by_key(|(c, _)| *c)
                .map(|(_, a)| a);
            let by = best.as_ref().map(|_| "auto");
            (best, by)
        }
        None => (None, None),
    };
    let compliance = match &activity {
        Some(a) => matching_engine::compliance(&a.engine(), &planned.engine()),
        None => match status.as_str() {
            "completed" => 100,
            "partial" => 60,
            _ => 0,
        },
    };
    let comment = body.str("comment");
    let first = w
        .completion
        .as_ref()
        .is_none_or(|c| c.reported_at.is_none());
    let mut tx = state.db.begin().await?;
    matching::lock(&mut tx, auth.user_id).await?;
    // The activity leaves the workout it completed before; the one this workout had becomes free.
    let previous = match &activity {
        Some(a) => matching::linked_workout(&mut *tx, a.id)
            .await?
            .filter(|(wid, _, _)| *wid != w.id),
        None => None,
    };
    if let Some((wid, _, _)) = previous {
        matching::unlink(&mut tx, wid).await?;
    }
    let dropped = current.is_some() && current != activity.as_ref().map(|a| a.id);
    db::upsert_completion(
        &mut tx,
        w.id,
        db::CompletionInput {
            activity_id: activity.as_ref().map(|a| a.id),
            matched_by: by,
            status: &status,
            compliance_pct: compliance,
            rpe,
            feeling: feeling.as_deref(),
            comment: comment.as_deref(),
        },
    )
    .await?;
    if let Some(a) = &activity {
        matching::settle(&mut tx, a.id, "open").await?;
    }
    if previous.is_some() || dropped {
        matching::rematch(&mut tx, auth.user_id, w.date, w.date).await?;
    }
    // The trainer hears about it the first time the student reports (an automatic match alone doesn't notify).
    if first {
        let me = runflow_db::auth::user_by_id(&mut *tx, auth.user_id)
            .await?
            .ok_or_else(Problem::unauthorized)?;
        let what = if status == "missed" {
            "não fez o treino"
        } else {
            "registrou o treino"
        };
        runflow_db::notifications::to_member(
            &mut tx,
            w.created_by,
            runflow_db::notifications::Notice {
                club_id: m.club_id,
                kind: "feedback",
                title: &format!("{} {what}", me.name),
                body: Some(comment.as_deref().unwrap_or(&w.title)),
                link: &format!("/feedback?workout={}", w.id),
            },
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
            activity_since: None,
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
    })))
}
