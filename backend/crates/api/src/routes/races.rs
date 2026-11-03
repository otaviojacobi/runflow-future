//! Races and events (W12, M9; endpoints.md § Races and events), like api/mock/routes/races.mjs.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use runflow_db::races as db;
use runflow_domain::week;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{ANY, Member, STAFF, member};
use crate::body::Body;
use crate::session::Auth;
use crate::time::parse_date;
use crate::{AppState, FieldError, Problem};

const SPORTS: [&str; 6] = ["run", "trail", "swim", "bike", "triathlon", "other"];
const STATUSES: [&str; 4] = ["registered", "finished", "dns", "dnf"];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/races", get(list).post(create))
        .route(
            "/clubs/{club_id}/races/{id}",
            get(one).patch(update).delete(archive),
        )
        .route("/clubs/{club_id}/races/{id}/entries", post(sign_up))
        .route(
            "/clubs/{club_id}/race-entries/{id}",
            patch(update_entry).delete(delete_entry),
        )
}

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

fn no_race() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "race.not_found",
        "Prova não encontrada",
        "Ela pode ter sido removida do calendário.",
    )
}

fn no_entry() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "race_entry.not_found",
        "Inscrição não encontrada",
        "Ela pode ter sido cancelada.",
    )
}

async fn race(state: &AppState, m: &Member, id: &str) -> Result<db::Race, Problem> {
    let id = Uuid::parse_str(id).map_err(|_| no_race())?;
    db::race(&state.db, m.club_id, id)
        .await?
        .ok_or_else(no_race)
}

async fn race_json(state: &AppState, m: &Member, id: Uuid) -> Result<Value, Problem> {
    db::list(
        &state.db,
        m.club_id,
        m.membership_id,
        m.role != "student",
        (None, None),
        Some(id),
    )
    .await?
    .pop()
    .ok_or_else(no_race)
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
    let m = member(&state, &auth, &club_id, ANY).await?;
    let range = (
        q.from.as_deref().and_then(parse_date),
        q.to.as_deref().and_then(parse_date),
    );
    let items = db::list(
        &state.db,
        m.club_id,
        m.membership_id,
        m.role != "student",
        range,
        None,
    )
    .await?;
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

async fn one(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let r = race(&state, &m, &id).await?;
    Ok(Json(race_json(&state, &m, r.id).await?))
}

/// The race fields in a body; `partial` = PATCH (only what's there).
fn fields(body: &Body, partial: bool) -> Result<db::Fields, Problem> {
    let mut errors = Vec::new();
    let mut f = db::Fields::default();
    let text = |k: &str| {
        body.str(k)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    if !partial || body.has("name") {
        match text("name") {
            Some(n) => f.name = Some(n),
            None => errors.push(fail("name", "Dê um nome à prova.")),
        }
    }
    if !partial || body.has("date") {
        match body.str("date").as_deref().and_then(parse_date) {
            Some(d) => f.date = Some(d),
            None => errors.push(fail("date", "Informe a data.")),
        }
    }
    if !partial || body.has("distances_m") {
        let ds: Option<Vec<i32>> = body
            .get("distances_m")
            .and_then(Value::as_array)
            .filter(|a| !a.is_empty())
            .and_then(|a| {
                a.iter()
                    .map(|v| v.as_i64().filter(|d| *d > 0).map(|d| d as i32))
                    .collect()
            });
        match ds {
            Some(mut ds) => {
                ds.sort_unstable();
                ds.dedup();
                f.distances_m = Some(ds);
            }
            None => errors.push(fail("distances_m", "Escolha pelo menos uma distância.")),
        }
    }
    if body.has("sport") {
        match body.str("sport").filter(|s| SPORTS.contains(&s.as_str())) {
            Some(s) => f.sport = Some(s),
            None => errors.push(fail("sport", "Modalidade inválida.")),
        }
    }
    if body.has("start_time") {
        match text("start_time") {
            None => f.start_time = Some(None),
            Some(t) => match week::parse_hhmm(&t) {
                Some(t) => f.start_time = Some(Some(t)),
                None => errors.push(fail("start_time", "Horário inválido.")),
            },
        }
    }
    for (k, slot) in [
        ("city", &mut f.city),
        ("url", &mut f.url),
        ("notes", &mut f.notes),
    ] {
        if body.has(k) {
            *slot = Some(text(k));
        }
    }
    if body.has("state") {
        f.state = Some(
            text("state")
                .map(|s| s.to_uppercase())
                .filter(|s| s.chars().count() == 2),
        );
    }
    if errors.is_empty() {
        Ok(f)
    } else {
        Err(Problem::invalid(errors))
    }
}

async fn create(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = db::create(&state.db, m.club_id, m.membership_id, fields(&body, false)?).await?;
    Ok((StatusCode::CREATED, Json(race_json(&state, &m, id).await?)).into_response())
}

async fn update(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let r = race(&state, &m, &id).await?;
    let f = fields(&body, true)?;
    if let Some(ds) = &f.distances_m
        && db::distance_in_use(&state.db, r.id, ds).await?
    {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "race.distance_in_use",
            "Há alunos inscritos nessa distância",
            "Mude a inscrição deles antes de remover a distância.",
        ));
    }
    let moved = f.date.is_some_and(|d| d != r.date);
    let mut tx = state.db.begin().await?;
    db::update(&mut *tx, r.id, f).await?;
    // The goal date follows the race.
    if moved {
        for e in db::goal_entries(&mut *tx, r.id).await? {
            db::apply_goal(&mut tx, e).await?;
        }
    }
    tx.commit().await?;
    Ok(Json(race_json(&state, &m, r.id).await?))
}

async fn archive(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let r = race(&state, &m, &id).await?;
    db::archive(&state.db, r.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Entry fields shared by sign-up and edits, checked against the race.
struct EntryInput {
    distance_m: Option<i32>,
    goal_time_s: Option<Option<i32>>,
    is_goal: Option<bool>,
}

fn entry_input(body: &Body, race: &db::Race, errors: &mut Vec<FieldError>) -> EntryInput {
    let positive = |k: &str| -> Option<Option<i32>> {
        body.has(k).then(|| {
            body.get(k)
                .and_then(Value::as_i64)
                .filter(|v| *v > 0)
                .map(|v| v as i32)
        })
    };
    let distance_m = body
        .get("distance_m")
        .map(|v| v.as_i64().unwrap_or(0) as i32);
    if distance_m.is_some_and(|d| !race.distances_m.contains(&d)) {
        errors.push(fail("distance_m", "Escolha uma das distâncias da prova."));
    }
    let goal_time_s = positive("goal_time_s");
    if body.get("goal_time_s").is_some_and(|v| !v.is_null()) && goal_time_s == Some(None) {
        errors.push(fail("goal_time_s", "Tempo inválido."));
    }
    EntryInput {
        distance_m,
        goal_time_s,
        is_goal: body.get("is_goal").and_then(Value::as_bool),
    }
}

async fn sign_up(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let r = race(&state, &m, &id).await?;
    let target = if m.role == "student" {
        Some(m.membership_id)
    } else {
        body.str("membership_id")
            .and_then(|s| Uuid::parse_str(&s).ok())
    };
    let target = match target {
        Some(t) if db::is_active_student(&state.db, m.club_id, t).await? => t,
        _ => {
            return Err(Problem::invalid(vec![fail(
                "membership_id",
                "Escolha o aluno.",
            )]));
        }
    };
    let mut errors = Vec::new();
    let input = entry_input(&body, &r, &mut errors);
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let distance = input
        .distance_m
        .or_else(|| r.distances_m.first().copied())
        .unwrap_or_default();
    let mut tx = state.db.begin().await?;
    let (entry, created, goal) = db::upsert_entry(
        &mut *tx,
        r.id,
        target,
        distance,
        input.goal_time_s,
        input.is_goal,
    )
    .await?;
    if goal {
        db::apply_goal(&mut tx, entry).await?;
    }
    tx.commit().await?;
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(db::entry_json(&state.db, entry).await?)).into_response())
}

async fn entry(state: &AppState, m: &Member, id: &str) -> Result<(db::Entry, db::Race), Problem> {
    let id = Uuid::parse_str(id).map_err(|_| no_entry())?;
    let e = db::entry(&state.db, m.club_id, id)
        .await?
        .filter(|e| m.role != "student" || e.membership_id == m.membership_id)
        .ok_or_else(no_entry)?;
    let r = db::race(&state.db, m.club_id, e.race_id)
        .await?
        .ok_or_else(no_entry)?;
    Ok((e, r))
}

async fn update_entry(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let (e, r) = entry(&state, &m, &id).await?;
    let mut errors = Vec::new();
    let input = entry_input(&body, &r, &mut errors);
    let status = body.str("status");
    if status.as_deref().is_some_and(|s| !STATUSES.contains(&s)) {
        errors.push(fail("status", "Situação inválida."));
    }
    let result_time_s = body.has("result_time_s").then(|| {
        body.get("result_time_s")
            .and_then(Value::as_i64)
            .filter(|v| *v > 0)
            .map(|v| v as i32)
    });
    if body.get("result_time_s").is_some_and(|v| !v.is_null()) && result_time_s == Some(None) {
        errors.push(fail("result_time_s", "Tempo inválido."));
    }
    let finished_time = result_time_s.unwrap_or(e.result_time_s);
    if status.as_deref() == Some("finished") && finished_time.is_none() {
        errors.push(fail("result_time_s", "Informe o tempo de prova."));
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let position = body.has("result_position").then(|| {
        body.get("result_position")
            .and_then(Value::as_i64)
            .filter(|v| *v > 0)
            .map(|v| v as i32)
    });
    let mut tx = state.db.begin().await?;
    let goal = db::update_entry(
        &mut *tx,
        e.id,
        db::EntryPatch {
            distance_m: input.distance_m,
            goal_time_s: input.goal_time_s,
            is_goal: input.is_goal,
            status,
            result_time_s,
            result_position: position,
        },
    )
    .await?;
    // The goal follows the entry (a new distance changes the profile goal too).
    if goal && (input.is_goal == Some(true) || input.distance_m.is_some_and(|d| d != e.distance_m))
    {
        db::apply_goal(&mut tx, e.id).await?;
    }
    db::apply_result(&mut tx, e.id).await?;
    tx.commit().await?;
    Ok(Json(db::entry_json(&state.db, e.id).await?))
}

async fn delete_entry(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let (e, _) = entry(&state, &m, &id).await?;
    db::delete_entry(&state.db, e.id).await?;
    Ok(StatusCode::NO_CONTENT)
}
