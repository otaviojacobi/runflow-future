//! Planilhas (W7): multi-week plans, their grid, applying them to students and unassigning.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use chrono::{Datelike, Duration};
use runflow_db::plans as db;
use runflow_domain::workout::{self, SPORTS};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{STAFF, member};
use crate::body::Body;
use crate::session::Auth;
use crate::time::{club_today, dd_mm, parse_date};
use crate::{AppState, Problem};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/plans", get(list).post(create))
        .route(
            "/clubs/{club_id}/plans/{id}",
            get(one).patch(update).delete(archive),
        )
        .route("/clubs/{club_id}/plans/{id}/items", put(items))
        .route("/clubs/{club_id}/plans/{id}/assign", post(assign))
        .route(
            "/clubs/{club_id}/plans/{id}/assignments/{aid}",
            delete(unassign),
        )
}

fn not_found() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "plan.not_found",
        "Planilha não encontrada",
        "Ela pode ter sido arquivada.",
    )
}

async fn plan(
    state: &AppState,
    club_id: Uuid,
    id: &str,
) -> Result<runflow_db::models::Plan, Problem> {
    let id = Uuid::parse_str(id).map_err(|_| not_found())?;
    db::one(&state.db, club_id, id).await?.ok_or_else(not_found)
}

fn read_name(body: &Body) -> Result<String, Problem> {
    let n = body
        .str("name")
        .ok_or_else(|| Problem::field("name", "Informe o nome da planilha."))?;
    if n.chars().count() > 80 {
        return Err(Problem::field("name", "Use no máximo 80 caracteres."));
    }
    Ok(n)
}

fn read_weeks(body: &Body) -> Result<i32, Problem> {
    body.get("weeks")
        .and_then(|v| v.as_i64().or_else(|| v.as_str()?.parse().ok()))
        .filter(|w| (1..=52).contains(w))
        .map(|w| w as i32)
        .ok_or_else(|| Problem::field("weeks", "De 1 a 52 semanas."))
}

async fn list(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    Ok(Json(
        json!({ "items": db::list(&state.db, m.club_id, None).await?, "next_cursor": null }),
    ))
}

async fn create(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let name = read_name(&body)?;
    let weeks = read_weeks(&body)?;
    let id = db::insert(
        &state.db,
        m.club_id,
        m.membership_id,
        &name,
        body.str("description").as_deref(),
        weeks,
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(
            db::one(&state.db, m.club_id, id)
                .await?
                .ok_or_else(not_found)?,
        ),
    )
        .into_response())
}

async fn detail(state: &AppState, club_id: Uuid, id: Uuid) -> Result<Value, Problem> {
    let p = db::one(&state.db, club_id, id)
        .await?
        .ok_or_else(not_found)?;
    let mut out = serde_json::to_value(&p).map_err(|_| Problem::internal())?;
    out["items"] = json!(db::items(&state.db, id).await?);
    out["assignments"] = json!(db::assignments(&state.db, id).await?);
    Ok(out)
}

async fn one(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let p = plan(&state, m.club_id, &id).await?;
    Ok(Json(detail(&state, m.club_id, p.id).await?))
}

async fn update(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let p = plan(&state, m.club_id, &id).await?;
    let name = if body.has("name") {
        Some(read_name(&body)?)
    } else {
        None
    };
    let weeks = if body.has("weeks") {
        Some(read_weeks(&body)?)
    } else {
        None
    };
    let description = body.has("description").then(|| body.str("description"));
    let mut tx = state.db.begin().await?;
    db::update(
        &mut tx,
        p.id,
        name.as_deref(),
        description.as_ref().map(|d| d.as_deref()),
        weeks,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!(
        db::one(&state.db, m.club_id, p.id)
            .await?
            .ok_or_else(not_found)?
    )))
}

async fn archive(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let p = plan(&state, m.club_id, &id).await?;
    db::archive(&state.db, p.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn items(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let p = plan(&state, m.club_id, &id).await?;
    let invalid = || Problem::field("items", "Há um treino inválido na planilha.");
    let mut out = Vec::new();
    for it in body
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let int = |k: &str| it[k].as_i64();
        let week = int("week")
            .filter(|w| *w >= 1 && *w <= p.weeks as i64)
            .ok_or_else(invalid)?;
        let weekday = int("weekday")
            .filter(|d| (1..=7).contains(d))
            .ok_or_else(invalid)?;
        let sport = it["sport"]
            .as_str()
            .filter(|s| SPORTS.contains(s))
            .ok_or_else(invalid)?;
        let title = it["title"]
            .as_str()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(invalid)?;
        workout::validate(&it["structure"]).map_err(|_| invalid())?;
        let est = |k: &str| it[k].as_i64().filter(|n| *n >= 0).map(|n| n as i32);
        out.push(db::NewItem {
            id: it["id"].as_str().and_then(|s| Uuid::parse_str(s).ok()),
            week: week as i32,
            weekday: weekday as i32,
            template_id: it["template_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok()),
            sport: sport.into(),
            title: title.into(),
            structure: it["structure"].clone(),
            est_duration_s: est("est_duration_s"),
            est_distance_m: est("est_distance_m"),
            notes: it["notes"]
                .as_str()
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(str::to_string),
        });
    }
    let mut tx = state.db.begin().await?;
    db::replace_items(&mut tx, p.id, &out).await?;
    tx.commit().await?;
    let mut res = json!(
        db::one(&state.db, m.club_id, p.id)
            .await?
            .ok_or_else(not_found)?
    );
    res["items"] = json!(db::items(&state.db, p.id).await?);
    Ok(Json(res))
}

async fn assign(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let p = plan(&state, m.club_id, &id).await?;
    let start = body
        .str("start_date")
        .as_deref()
        .and_then(parse_date)
        .filter(|d| d.weekday().num_days_from_monday() == 0);
    let Some(start) = start else {
        return Err(Problem::field(
            "start_date",
            "Escolha uma segunda-feira para começar.",
        ));
    };
    let ids: Vec<Uuid> = body
        .get("athlete_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str()?.parse().ok())
        .collect();
    let group = body.str("group_id").and_then(|g| Uuid::parse_str(&g).ok());
    let athletes = runflow_db::workouts::active_students(&state.db, m.club_id, &ids, group).await?;
    if athletes.is_empty() {
        return Err(Problem::field(
            "athlete_ids",
            "Escolha pelo menos um aluno.",
        ));
    }
    let grid = db::items(&state.db, p.id).await?;
    if grid.is_empty() {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "plan.empty",
            "A planilha está vazia",
            "Adicione treinos antes de aplicar.",
        ));
    }
    let mut tx = state.db.begin().await?;
    let mut workouts = 0;
    let mut around = Vec::new();
    for athlete in &athletes {
        let a = db::insert_assignment(&mut tx, p.id, *athlete, start, m.membership_id).await?;
        for it in &grid {
            let date = start + Duration::days(((it.week - 1) * 7 + it.weekday - 1) as i64);
            let content = runflow_db::workouts::Content {
                sport: &it.sport,
                title: &it.title,
                structure: &it.structure,
                notes: it.notes.as_deref(),
                est_duration_s: it.est_duration_s,
                est_distance_m: it.est_distance_m,
                template_id: it.template_id,
                plan_assignment_id: Some(a),
            };
            runflow_db::workouts::insert(
                &mut tx,
                m.club_id,
                *athlete,
                date,
                &content,
                m.membership_id,
            )
            .await?;
            around.push((*athlete, date));
            workouts += 1;
        }
        // Announced now only if the first week is already visible; otherwise its release does it (D-031).
        if !runflow_db::workouts::released(&mut *tx, m.club_id, *athlete, start).await? {
            continue;
        }
        let body = format!("{} semanas a partir de {}", p.weeks, dd_mm(start));
        runflow_db::notifications::to_member(
            &mut tx,
            *athlete,
            runflow_db::notifications::Notice {
                club_id: m.club_id,
                kind: "workout_assigned",
                title: &format!("Nova planilha: {}", p.name),
                body: Some(&body),
                link: "/schedule",
            },
        )
        .await?;
    }
    // Activities already done around those days may be these workouts (D-049).
    runflow_db::matching::enqueue_for_workouts(&mut tx, &around).await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "assignments": athletes.len(), "workouts": workouts })),
    )
        .into_response())
}

async fn unassign(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id, aid)): Path<(String, String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let p = plan(&state, m.club_id, &id).await?;
    let missing = || {
        Problem::new(
            StatusCode::NOT_FOUND,
            "assignment.not_found",
            "Aplicação não encontrada",
            "Ela pode já ter sido removida.",
        )
    };
    let aid = Uuid::parse_str(&aid).map_err(|_| missing())?;
    if !db::assignment_exists(&state.db, p.id, aid).await? {
        return Err(missing());
    }
    let club = runflow_db::clubs::club(&state.db, m.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    let mut tx = state.db.begin().await?;
    let removed = db::unassign(&mut tx, aid, club_today(&club.timezone)).await?;
    runflow_db::matching::enqueue_for_workouts(&mut tx, &removed).await?;
    tx.commit().await?;
    Ok(Json(json!({ "removed_workouts": removed.len() })))
}
