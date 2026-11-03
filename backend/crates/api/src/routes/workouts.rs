//! Planned workouts for staff (W4, W3, W5): calendar, assign in bulk, edit/move, remove, copy a week.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::NaiveDate;
use runflow_db::models::Workout;
use runflow_db::workouts as db;
use runflow_domain::workout::SPORTS;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{STAFF, member};
use crate::body::Body;
use crate::routes::library::{estimate, structure_error};
use crate::session::Auth;
use crate::time::parse_date;
use crate::{AppState, FieldError, Problem};

const MAX_DATES: usize = 62;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/planned-workouts", get(list).post(assign))
        .route(
            "/clubs/{club_id}/planned-workouts/copy-week",
            post(copy_week),
        )
        .route(
            "/clubs/{club_id}/planned-workouts/{id}",
            get(one).patch(update).delete(remove),
        )
}

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

pub fn not_found() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "workout.not_found",
        "Treino não encontrado",
        "Ele pode ter sido removido pelo treinador.",
    )
}

pub(crate) fn uuids(body: &Body, key: &str) -> Vec<Uuid> {
    body.get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str()?.parse().ok())
        .collect()
}

#[derive(Deserialize)]
struct Range {
    from: Option<String>,
    to: Option<String>,
    athlete_id: Option<String>,
    group_id: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    Query(q): Query<Range>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let (Some(from), Some(to)) = (
        q.from.as_deref().and_then(parse_date),
        q.to.as_deref().and_then(parse_date),
    ) else {
        return Err(Problem::field("from", "Informe o período (from e to)."));
    };
    // A malformed id matches nothing (same as the mock's equality filter).
    let parse = |s: &Option<String>| {
        s.as_deref()
            .map(|v| Uuid::parse_str(v).unwrap_or(Uuid::nil()))
    };
    let items = db::list(
        &state.db,
        m.club_id,
        m.membership_id,
        db::Filter {
            from,
            to,
            athlete: parse(&q.athlete_id),
            group: parse(&q.group_id),
            only: None,
            drafts: true,
        },
    )
    .await?;
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

/// Free-form content (`{sport, title, structure, notes?, est_*}`) checked like the mock.
struct Free {
    sport: String,
    title: String,
    structure: Value,
    notes: Option<String>,
    est_duration_s: Option<i32>,
    est_distance_m: Option<i32>,
}

fn read_free(body: &Body) -> Result<Free, Problem> {
    let mut errors = Vec::new();
    let sport = body.str("sport").filter(|s| SPORTS.contains(&s.as_str()));
    if sport.is_none() {
        errors.push(fail("sport", "Escolha a modalidade."));
    }
    let title = body.str("title");
    if title.is_none() {
        errors.push(fail("title", "Dê um nome ao treino."));
    }
    let structure = body.get("structure").cloned().unwrap_or(Value::Null);
    if let Some(e) = structure_error(&structure) {
        errors.push(e);
    }
    let mut est = [None, None];
    for (i, key) in ["est_duration_s", "est_distance_m"].into_iter().enumerate() {
        match estimate(body, key) {
            Ok(v) => est[i] = v.flatten(),
            Err(e) => errors.push(e),
        }
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    Ok(Free {
        sport: sport.unwrap_or_default(),
        title: title.unwrap_or_default(),
        structure,
        notes: body.str("notes"),
        est_duration_s: est[0],
        est_distance_m: est[1],
    })
}

async fn assign(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let group = body.str("group_id").and_then(|g| Uuid::parse_str(&g).ok());
    let athletes =
        db::active_students(&state.db, m.club_id, &uuids(&body, "athlete_ids"), group).await?;
    let mut dates: Vec<NaiveDate> = body
        .get("dates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| parse_date(v.as_str()?))
        .collect();
    dates.sort();
    dates.dedup();
    let mut errors = Vec::new();
    if athletes.is_empty() {
        errors.push(fail("athlete_ids", "Escolha pelo menos um aluno."));
    }
    if dates.is_empty() {
        errors.push(fail("dates", "Escolha pelo menos um dia."));
    } else if dates.len() > MAX_DATES {
        errors.push(fail("dates", "Escolha no máximo 62 dias de uma vez."));
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }

    let template = match body.str("template_id") {
        Some(id) => {
            let missing = || {
                Problem::new(
                    StatusCode::NOT_FOUND,
                    "template.not_found",
                    "Treino da biblioteca não encontrado",
                    "Ele pode ter sido arquivado.",
                )
            };
            let id = Uuid::parse_str(&id).map_err(|_| missing())?;
            Some(
                runflow_db::library::template(&state.db, m.club_id, id)
                    .await?
                    .ok_or_else(missing)?,
            )
        }
        None => None,
    };
    let free = if template.is_none() {
        Some(read_free(&body)?)
    } else {
        None
    };
    // Template notes: the request's (even an explicit null), else the template's description.
    let notes = body.has("notes").then(|| body.str("notes"));
    let template_notes: Option<Option<String>> = template
        .as_ref()
        .map(|t| notes.clone().unwrap_or_else(|| t.description.clone()));
    let content = match (&template, &free) {
        (Some(t), _) => db::Content {
            sport: &t.sport,
            title: &t.name,
            structure: &t.structure,
            notes: template_notes.as_ref().and_then(|n| n.as_deref()),
            est_duration_s: t.est_duration_s,
            est_distance_m: t.est_distance_m,
            template_id: Some(t.id),
            plan_assignment_id: None,
        },
        (None, Some(f)) => db::Content {
            sport: &f.sport,
            title: &f.title,
            structure: &f.structure,
            notes: f.notes.as_deref(),
            est_duration_s: f.est_duration_s,
            est_distance_m: f.est_distance_m,
            template_id: None,
            plan_assignment_id: None,
        },
        (None, None) => return Err(Problem::internal()),
    };

    let mut tx = state.db.begin().await?;
    let mut created = Vec::new();
    for athlete in &athletes {
        for date in &dates {
            created.push((
                *athlete,
                db::insert(
                    &mut tx,
                    m.club_id,
                    *athlete,
                    *date,
                    &content,
                    m.membership_id,
                )
                .await?,
            ));
        }
    }
    // Only what the student can already see (D-031): drafts are announced by the week's release.
    for athlete in &athletes {
        let mut seen = Vec::new();
        for (i, date) in dates.iter().enumerate() {
            if db::released(&mut *tx, m.club_id, *athlete, *date).await? {
                seen.push(i);
            }
        }
        let Some(first) = seen.first().and_then(|i| {
            created
                .iter()
                .filter(|(a, _)| a == athlete)
                .nth(*i)
                .map(|(_, id)| *id)
        }) else {
            continue;
        };
        let title = if seen.len() > 1 {
            format!("{} novos treinos na sua agenda", seen.len())
        } else {
            "Novo treino na sua agenda".to_string()
        };
        runflow_db::notifications::to_member(
            &mut tx,
            *athlete,
            runflow_db::notifications::Notice {
                club_id: m.club_id,
                kind: "workout_assigned",
                title: &title,
                body: Some(content.title),
                link: &format!("/workouts/{first}"),
            },
            None,
        )
        .await?;
    }
    tx.commit().await?;

    let mut items: Vec<Workout> = Vec::with_capacity(created.len());
    for (_, id) in &created {
        items.extend(db::one(&state.db, m.club_id, m.membership_id, *id).await?);
    }
    Ok((
        StatusCode::CREATED,
        Json(json!({ "items": items, "next_cursor": null })),
    )
        .into_response())
}

async fn one(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = Uuid::parse_str(&id).map_err(|_| not_found())?;
    let w = db::one(&state.db, m.club_id, m.membership_id, id)
        .await?
        .ok_or_else(not_found)?;
    let (user_id, athlete) = db::athlete(&state.db, w.athlete_membership_id)
        .await?
        .ok_or_else(not_found)?;
    // The linked activity only with the student's consent (§5, D-011).
    let activity = match w.completion.as_ref().and_then(|c| c.activity_id) {
        Some(a) if db::shares_training(&state.db, user_id, m.club_id).await? => {
            db::activity(&state.db, a).await?
        }
        _ => None,
    };
    let mut out = serde_json::to_value(&w).map_err(|_| Problem::internal())?;
    out["athlete"] = athlete;
    out["activity"] = json!(activity);
    Ok(Json(out))
}

async fn update(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Workout>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = Uuid::parse_str(&id).map_err(|_| not_found())?;
    let w = db::one(&state.db, m.club_id, m.membership_id, id)
        .await?
        .ok_or_else(not_found)?;
    let mut errors = Vec::new();
    let mut p = db::Patch::default();
    if body.has("date") {
        match body.str("date").as_deref().and_then(parse_date) {
            Some(d) => p.date = Some(d),
            None => errors.push(fail("date", "Data inválida.")),
        }
    }
    if body.has("sport") {
        match body.str("sport").filter(|s| SPORTS.contains(&s.as_str())) {
            Some(s) => p.sport = Some(s),
            None => errors.push(fail("sport", "Escolha a modalidade.")),
        }
    }
    if body.has("title") {
        match body.str("title") {
            Some(t) => p.title = Some(t),
            None => errors.push(fail("title", "Dê um nome ao treino.")),
        }
    }
    if body.has("structure") {
        let v = body.get("structure").cloned().unwrap_or(Value::Null);
        match structure_error(&v) {
            Some(e) => errors.push(e),
            None => p.structure = Some(v),
        }
    }
    if body.has("notes") {
        p.notes = Some(body.str("notes"));
    }
    for (key, slot) in [
        ("est_duration_s", &mut p.est_duration_s),
        ("est_distance_m", &mut p.est_distance_m),
    ] {
        match estimate(&body, key) {
            Ok(v) => *slot = v,
            Err(e) => errors.push(e),
        }
    }
    if let Some(pos) = body.get("position").and_then(Value::as_i64) {
        p.position = Some(pos.clamp(0, 50) as i32);
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let moved = p.date.is_some_and(|d| d != w.date);
    let restructured = p.structure.is_some();
    let title = p.title.clone().unwrap_or_else(|| w.title.clone());
    let date = p.date.unwrap_or(w.date);
    db::update(&state.db, w.id, p).await?;
    // A draft changes in silence (D-031).
    if (moved || restructured)
        && db::released(&state.db, m.club_id, w.athlete_membership_id, date).await?
    {
        let what = if moved {
            "Um treino mudou de dia"
        } else {
            "Seu treinador ajustou um treino"
        };
        runflow_db::notifications::to_member(
            &mut *state.db.acquire().await?,
            w.athlete_membership_id,
            runflow_db::notifications::Notice {
                club_id: m.club_id,
                kind: "workout_changed",
                title: what,
                body: Some(&title),
                link: &format!("/workouts/{}", w.id),
            },
            None,
        )
        .await?;
    }
    Ok(Json(
        db::one(&state.db, m.club_id, m.membership_id, w.id)
            .await?
            .ok_or_else(not_found)?,
    ))
}

async fn remove(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = Uuid::parse_str(&id).map_err(|_| not_found())?;
    let w = db::one(&state.db, m.club_id, m.membership_id, id)
        .await?
        .ok_or_else(not_found)?;
    db::delete(&state.db, w.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn copy_week(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let (Some(from), Some(to)) = (
        body.str("from_monday").as_deref().and_then(parse_date),
        body.str("to_monday").as_deref().and_then(parse_date),
    ) else {
        return Err(Problem::field("to_monday", "Escolha a semana de destino."));
    };
    if from == to {
        return Err(Problem::field("to_monday", "Escolha uma semana diferente."));
    }
    let wanted = uuids(&body, "athlete_ids");
    let athletes = if wanted.is_empty() {
        db::all_active_students(&state.db, m.club_id).await?
    } else {
        db::active_students(&state.db, m.club_id, &wanted, None).await?
    };
    let mut tx = state.db.begin().await?;
    let copied = db::copy_week(&mut tx, m.club_id, &athletes, from, to, m.membership_id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({ "copied": copied }))).into_response())
}
