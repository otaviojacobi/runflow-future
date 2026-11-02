//! Week release (D-031): the planning screen's view of a week, and releasing it to the students (W4).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Datelike, NaiveDate, Utc, Weekday};
use runflow_db::models::Club;
use runflow_db::{weeks, workouts};
use runflow_domain::week;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{STAFF, member};
use crate::body::Body;
use crate::routes::workouts::uuids;
use crate::session::Auth;
use crate::time::parse_date;
use crate::{AppState, Problem};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/weeks/{week_start}", get(show))
        .route(
            "/clubs/{club_id}/weeks/{week_start}/release",
            post(release).delete(undo),
        )
}

fn monday(s: &str) -> Result<NaiveDate, Problem> {
    parse_date(s)
        .filter(|d| d.weekday() == Weekday::Mon)
        .ok_or_else(|| {
            Problem::new(
                StatusCode::BAD_REQUEST,
                "week.invalid",
                "Semana inválida",
                "Use a data de uma segunda-feira (AAAA-MM-DD).",
            )
        })
}

fn started() -> Problem {
    Problem::new(
        StatusCode::CONFLICT,
        "week.started",
        "Esta semana já começou",
        "Os alunos já veem todos os treinos dela.",
    )
}

/// When a week of this club is released automatically, if the club does that.
pub(crate) fn auto_release_at(club: &Club, week_start: NaiveDate) -> Option<DateTime<Utc>> {
    let weekday = club.auto_release_weekday?;
    let time = week::parse_hhmm(club.auto_release_time.as_deref()?)?;
    (club.release_mode == "weekly")
        .then(|| week::auto_release_at(week_start, weekday, time, &club.timezone))
        .flatten()
}

async fn club_of(state: &AppState, club_id: Uuid) -> Result<Club, Problem> {
    runflow_db::clubs::club(&state.db, club_id)
        .await?
        .ok_or_else(Problem::club_not_found)
}

/// `{week_start, release_mode, started, released_at, released_athlete_ids, auto_release_at, drafts}`.
async fn state_of(state: &AppState, club: &Club, week_start: NaiveDate) -> Result<Value, Problem> {
    let started = week_start <= week::this_monday(Utc::now(), &club.timezone);
    let releases = weeks::releases(&state.db, club.id, week_start).await?;
    let released_at = releases
        .iter()
        .find(|r| r.athlete_membership_id.is_none())
        .map(|r| r.released_at);
    let released_ids: Vec<Uuid> = releases
        .iter()
        .filter_map(|r| r.athlete_membership_id)
        .collect();
    let auto = (!started && released_at.is_none())
        .then(|| auto_release_at(club, week_start))
        .flatten();
    let drafts: i64 = weeks::hidden(&state.db, club.id, week_start)
        .await?
        .iter()
        .map(|(_, n)| n)
        .sum();
    Ok(json!({
        "week_start": week_start,
        "release_mode": club.release_mode,
        "started": started,
        "released_at": released_at,
        "released_athlete_ids": released_ids,
        "auto_release_at": auto,
        "drafts": drafts,
    }))
}

async fn show(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, week_start)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let week_start = monday(&week_start)?;
    let club = club_of(&state, m.club_id).await?;
    Ok(Json(state_of(&state, &club, week_start).await?))
}

async fn release(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, week_start)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let week_start = monday(&week_start)?;
    let club = club_of(&state, m.club_id).await?;
    if club.release_mode != "weekly" {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "week.release_off",
            "A liberação semanal está desligada",
            "Os alunos veem cada treino assim que ele é salvo. Mude isso nas configurações do clube.",
        ));
    }
    if week_start <= week::this_monday(Utc::now(), &club.timezone) {
        return Err(started());
    }
    // Everyone, or the chosen students (a scope that matches nobody is a mistake, not "everyone").
    let group = body.str("group_id").and_then(|g| Uuid::parse_str(&g).ok());
    let scoped = body.has("athlete_ids") || group.is_some();
    let athletes = if scoped {
        let a =
            workouts::active_students(&state.db, m.club_id, &uuids(&body, "athlete_ids"), group)
                .await?;
        if a.is_empty() {
            return Err(Problem::field(
                "athlete_ids",
                "Escolha pelo menos um aluno.",
            ));
        }
        a
    } else {
        Vec::new()
    };
    let notify = body.get("notify").and_then(Value::as_bool).unwrap_or(true);

    let mut tx = state.db.begin().await?;
    let hidden = weeks::hidden(&mut *tx, m.club_id, week_start).await?;
    weeks::release(
        &mut tx,
        m.club_id,
        week_start,
        &athletes,
        Some(m.membership_id),
    )
    .await?;
    if notify {
        for (athlete, n) in hidden
            .iter()
            .filter(|(a, _)| athletes.is_empty() || athletes.contains(a))
        {
            let (title, text) = week::release_notice(week_start, *n);
            workouts::notify_member(
                &mut *tx,
                *athlete,
                m.club_id,
                "week_released",
                &title,
                Some(&text),
                "/schedule",
            )
            .await?;
        }
    }
    tx.commit().await?;
    tracing::info!(club_id = %m.club_id, %week_start, students = athletes.len(), "week released");
    Ok(Json(state_of(&state, &club, week_start).await?))
}

async fn undo(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, week_start)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let week_start = monday(&week_start)?;
    let club = club_of(&state, m.club_id).await?;
    if week_start <= week::this_monday(Utc::now(), &club.timezone) {
        return Err(started());
    }
    weeks::unrelease(&state.db, m.club_id, week_start).await?;
    Ok(Json(state_of(&state, &club, week_start).await?))
}
