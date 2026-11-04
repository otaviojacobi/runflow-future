//! Aulas (D-052; endpoints.md § Aulas), like api/mock/routes/scheduling.mjs and the attendance report in
//! api/mock/routes/reports.mjs: venues, class types, recurring schedules, sessions, bookings with a waitlist,
//! check-in and attendance. Frozen clubs refuse staff writes in `access::member` (D-043); students keep booking.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use chrono::{Duration, NaiveDate, NaiveTime, Utc};
use runflow_db::classes::{self as db, BookError, SessionQuery};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{ANY, Member, STAFF, member};
use crate::body::Body;
use crate::session::Auth;
use crate::time::{club_today, parse_date};
use crate::{AppState, FieldError, Problem};

const SPORTS: [&str; 6] = ["run", "swim", "bike", "strength", "mobility", "other"];
const KINDS: [&str; 6] = ["track", "pool", "gym", "park", "studio", "other"];
const ATTENDANCE: [&str; 3] = ["attended", "no_show", "booked"];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/clubs/{club_id}/locations",
            get(locations).post(create_location),
        )
        .route(
            "/clubs/{club_id}/locations/{id}",
            patch(update_location).delete(archive_location),
        )
        .route(
            "/clubs/{club_id}/class-types",
            get(class_types).post(create_class_type),
        )
        .route(
            "/clubs/{club_id}/class-types/{id}",
            patch(update_class_type).delete(archive_class_type),
        )
        .route(
            "/clubs/{club_id}/class-schedules",
            get(schedules).post(create_schedules),
        )
        .route(
            "/clubs/{club_id}/class-schedules/{id}",
            delete(end_schedule),
        )
        .route(
            "/clubs/{club_id}/class-sessions",
            get(sessions).post(create_session),
        )
        .route(
            "/clubs/{club_id}/class-sessions/{id}",
            get(session).patch(update_session),
        )
        .route("/clubs/{club_id}/class-sessions/{id}/bookings", post(book))
        .route(
            "/clubs/{club_id}/class-sessions/{id}/check-in",
            post(check_in),
        )
        .route(
            "/clubs/{club_id}/bookings/{id}",
            patch(attendance).delete(cancel_booking),
        )
        .route("/clubs/{club_id}/reports/attendance", get(report))
}

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

fn not_found(what: &str) -> Problem {
    let (code, title) = match what {
        "location" => ("location.not_found", "Local não encontrado"),
        "class_type" => ("class_type.not_found", "Tipo de aula não encontrado"),
        "schedule" => ("schedule.not_found", "Horário não encontrado"),
        _ => ("session.not_found", "Aula não encontrada"),
    };
    Problem::new(
        StatusCode::NOT_FOUND,
        code,
        title,
        "Ele pode ter sido removido.",
    )
}

fn no_booking() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "booking.not_found",
        "Reserva não encontrada",
        "Ela pode já ter sido cancelada.",
    )
}

fn conflict(code: &'static str, title: &'static str, detail: impl Into<String>) -> Problem {
    Problem::new(StatusCode::CONFLICT, code, title, detail.into())
}

fn parse_id(id: &str) -> Option<Uuid> {
    Uuid::parse_str(id).ok()
}

/// A whole number from a JSON number or a numeric string; `Err` when present but not one.
fn int(body: &Body, key: &str) -> Option<Result<i64, ()>> {
    let v = body.get(key)?;
    if v.is_null() {
        return None;
    }
    let n = v
        .as_i64()
        .or_else(|| v.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64))
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<i64>().ok()));
    Some(n.ok_or(()))
}

/// A positive whole number, or `None` when absent; pushes `message` when present but invalid.
fn positive(
    body: &Body,
    key: &'static str,
    message: &'static str,
    errors: &mut Vec<FieldError>,
) -> Option<i32> {
    match int(body, key) {
        None => None,
        Some(Ok(n)) if n > 0 && n <= i32::MAX as i64 => Some(n as i32),
        Some(_) => {
            errors.push(fail(key, message));
            None
        }
    }
}

/// An optional reference: absent → `None`, `null`/"" → `Some(None)`, an id → `Some(Some(id))`; an unparsable id is a
/// field error.
fn reference(
    body: &Body,
    key: &'static str,
    message: &'static str,
    errors: &mut Vec<FieldError>,
) -> Option<Option<Uuid>> {
    if !body.has(key) {
        return None;
    }
    match body.str(key) {
        None => Some(None),
        Some(s) => match Uuid::parse_str(&s) {
            Ok(id) => Some(Some(id)),
            Err(_) => {
                errors.push(fail(key, message));
                None
            }
        },
    }
}

/// The optional references and numbers shared by schedules and sessions, checked against the club (the mock's
/// `refs`): a venue still in use, an active staff member as instructor, positive capacity and duration.
struct Refs {
    location_id: Option<Option<Uuid>>,
    instructor_membership_id: Option<Option<Uuid>>,
    capacity: Option<i32>,
    duration_min: Option<i32>,
}

async fn refs(
    state: &AppState,
    club_id: Uuid,
    body: &Body,
    errors: &mut Vec<FieldError>,
) -> Result<Refs, Problem> {
    let location_id = reference(body, "location_id", "Local inválido.", errors);
    if let Some(Some(id)) = location_id
        && !db::location_usable(&state.db, club_id, id).await?
    {
        errors.push(fail("location_id", "Local inválido."));
    }
    let instructor = reference(
        body,
        "instructor_membership_id",
        "Escolha alguém da equipe.",
        errors,
    );
    if let Some(Some(id)) = instructor
        && !db::is_staff(&state.db, club_id, id).await?
    {
        errors.push(fail(
            "instructor_membership_id",
            "Escolha alguém da equipe.",
        ));
    }
    Ok(Refs {
        location_id,
        instructor_membership_id: instructor,
        capacity: positive(body, "capacity", "Informe as vagas.", errors),
        duration_min: positive(body, "duration_min", "Informe a duração.", errors),
    })
}

/// "HH:MM", 00:00–23:59.
fn hhmm(s: &str) -> Option<NaiveTime> {
    let ok = s.len() == 5 && s.as_bytes()[2] == b':';
    ok.then(|| NaiveTime::parse_from_str(s, "%H:%M").ok())
        .flatten()
}

async fn club_tz(state: &AppState, club_id: Uuid) -> Result<String, Problem> {
    Ok(runflow_db::clubs::club(&state.db, club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?
        .timezone)
}

// ------------------------------------------------------------------------------------ venues

async fn locations(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let items = db::locations(&state.db, m.club_id).await?;
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

fn location_fields(body: &Body, partial: bool) -> Result<db::LocationFields, Problem> {
    let mut errors = Vec::new();
    let mut f = db::LocationFields::default();
    if !partial || body.has("name") {
        match body.str("name") {
            Some(n) => f.name = Some(n.chars().take(80).collect()),
            None => errors.push(fail("name", "Informe o nome do local.")),
        }
    }
    if !partial || body.has("kind") {
        match body.str("kind").filter(|k| KINDS.contains(&k.as_str())) {
            Some(k) => f.kind = Some(k),
            None => errors.push(fail("kind", "Escolha o tipo de local.")),
        }
    }
    if body.has("address") {
        f.address = Some(body.str("address"));
    }
    if body.has("lanes") {
        f.lanes = Some(positive(
            body,
            "lanes",
            "Número de raias inválido.",
            &mut errors,
        ));
    }
    if errors.is_empty() {
        Ok(f)
    } else {
        Err(Problem::invalid(errors))
    }
}

async fn create_location(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let row = db::create_location(&state.db, m.club_id, location_fields(&body, false)?).await?;
    Ok((StatusCode::CREATED, Json(row)).into_response())
}

async fn own_location(state: &AppState, m: &Member, id: &str) -> Result<Uuid, Problem> {
    match parse_id(id) {
        Some(id) if db::location_exists(&state.db, m.club_id, id).await? => Ok(id),
        _ => Err(not_found("location")),
    }
}

async fn update_location(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = own_location(&state, &m, &id).await?;
    let f = location_fields(&body, true)?;
    Ok(Json(db::update_location(&state.db, id, f).await?))
}

async fn archive_location(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = own_location(&state, &m, &id).await?;
    db::archive_location(&state.db, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------------ class types

async fn class_types(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let items = db::class_types(&state.db, m.club_id).await?;
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

/// The whole class type from the body over `current` (PATCH validates the merged result, like the mock).
fn class_type_fields(
    body: &Body,
    current: Option<&db::ClassType>,
) -> Result<db::ClassTypeFields, Problem> {
    let mut errors = Vec::new();
    let name = if body.has("name") || current.is_none() {
        body.str("name")
    } else {
        current.map(|c| c.name.clone())
    };
    if name.is_none() {
        errors.push(fail("name", "Dê um nome à aula."));
    }
    let sport = if body.has("sport") || current.is_none() {
        body.str("sport")
    } else {
        current.map(|c| c.sport.clone())
    };
    if !sport.as_deref().is_some_and(|s| SPORTS.contains(&s)) {
        errors.push(fail("sport", "Escolha a modalidade."));
    }
    let number = |key: &'static str,
                  message: &'static str,
                  now: Option<i32>,
                  errors: &mut Vec<FieldError>| {
        if body.has(key) || now.is_none() {
            let n = positive(body, key, message, errors);
            if n.is_none() && !errors.iter().any(|e| e.field == key) {
                errors.push(fail(key, message));
            }
            n
        } else {
            now
        }
    };
    let default_capacity = number(
        "default_capacity",
        "Informe as vagas.",
        current.map(|c| c.default_capacity),
        &mut errors,
    );
    let duration_min = number(
        "duration_min",
        "Informe a duração.",
        current.map(|c| c.duration_min),
        &mut errors,
    );
    let description = if body.has("description") {
        body.str("description")
    } else {
        current.and_then(|c| c.description.clone())
    };
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    Ok(db::ClassTypeFields {
        name: name.unwrap_or_default().chars().take(80).collect(),
        sport: sport.unwrap_or_default(),
        description,
        default_capacity: default_capacity.unwrap_or(1),
        duration_min: duration_min.unwrap_or(1),
    })
}

async fn create_class_type(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let row = db::create_class_type(&state.db, m.club_id, class_type_fields(&body, None)?).await?;
    Ok((StatusCode::CREATED, Json(row)).into_response())
}

async fn own_type(
    state: &AppState,
    club_id: Uuid,
    id: Option<&str>,
) -> Result<db::ClassType, Problem> {
    let id = id
        .and_then(parse_id)
        .ok_or_else(|| not_found("class_type"))?;
    db::class_type(&state.db, club_id, id)
        .await?
        .ok_or_else(|| not_found("class_type"))
}

async fn update_class_type(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let t = own_type(&state, m.club_id, Some(&id)).await?;
    let f = class_type_fields(&body, Some(&t))?;
    Ok(Json(db::update_class_type(&state.db, t.id, f).await?))
}

async fn archive_class_type(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let t = own_type(&state, m.club_id, Some(&id)).await?;
    db::archive_class_type(&state.db, t.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------------ schedules

async fn schedules(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let items = db::schedules(&state.db, m.club_id, None).await?;
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

async fn create_schedules(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let t = own_type(&state, m.club_id, body.str("class_type_id").as_deref()).await?;
    let mut errors = Vec::new();
    let r = refs(&state, m.club_id, &body, &mut errors).await?;
    let mut weekdays: Vec<i32> = body
        .get("weekdays")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    v.as_i64()
                        .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
                })
                .filter(|d| (1..=7).contains(d))
                .map(|d| d as i32)
                .collect()
        })
        .unwrap_or_default();
    weekdays.sort_unstable();
    weekdays.dedup();
    if weekdays.is_empty() {
        errors.push(fail("weekdays", "Escolha pelo menos um dia da semana."));
    }
    let start = body.str("start_time").as_deref().and_then(hhmm);
    if start.is_none() {
        errors.push(fail("start_time", "Informe o horário."));
    }
    let valid_from = match body.get("valid_from").filter(|v| !v.is_null()) {
        None => None,
        Some(v) => match v.as_str().and_then(parse_date) {
            Some(d) => Some(d),
            None => {
                errors.push(fail("valid_from", "Data inválida."));
                None
            }
        },
    };
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let tz = club_tz(&state, m.club_id).await?;
    let valid_from = valid_from.unwrap_or_else(|| club_today(&tz));
    let mut tx = state.db.begin().await?;
    let mut ids = Vec::new();
    for weekday in weekdays {
        let s = db::NewSchedule {
            class_type_id: t.id,
            location_id: r.location_id.flatten(),
            instructor_membership_id: r.instructor_membership_id.flatten(),
            weekday,
            start_time: start.unwrap_or_default(),
            duration_min: r.duration_min.unwrap_or(t.duration_min),
            capacity: r.capacity.unwrap_or(t.default_capacity),
            valid_from,
        };
        ids.push(db::create_schedule(&mut *tx, m.club_id, &s).await?);
    }
    let sessions = db::expand(&mut *tx, Utc::now(), Some(&ids)).await?;
    tx.commit().await?;
    let items = db::schedules(&state.db, m.club_id, Some(&ids)).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "items": items, "sessions": sessions })),
    )
        .into_response())
}

async fn end_schedule(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = match parse_id(&id) {
        Some(id) if db::schedule_exists(&state.db, m.club_id, id).await? => id,
        _ => return Err(not_found("schedule")),
    };
    let mut tx = state.db.begin().await?;
    let cancelled = db::end_schedule(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "cancelled_sessions": cancelled })))
}

// ------------------------------------------------------------------------------------ sessions

#[derive(Deserialize)]
struct Range {
    from: Option<String>,
    to: Option<String>,
}

fn query<'a>(state: &'a AppState, m: &Member, staff: bool) -> SessionQuery<'a> {
    SessionQuery {
        club_id: m.club_id,
        viewer: m.membership_id,
        staff,
        app_url: &state.settings.public_app_url,
        range: None,
        only: None,
    }
}

/// One session as `m` sees it (staff: roster, code and link).
async fn session_json(state: &AppState, m: &Member, id: Uuid) -> Result<Value, Problem> {
    db::sessions(
        &state.db,
        SessionQuery {
            only: Some(id),
            ..query(state, m, m.role != "student")
        },
    )
    .await?
    .pop()
    .ok_or_else(|| not_found("session"))
}

async fn own_session(state: &AppState, m: &Member, id: &str) -> Result<db::Session, Problem> {
    let id = parse_id(id).ok_or_else(|| not_found("session"))?;
    db::session(&state.db, m.club_id, id)
        .await?
        .ok_or_else(|| not_found("session"))
}

async fn sessions(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    Query(q): Query<Range>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let (Some(from), Some(to)) = (
        q.from.as_deref().and_then(parse_date),
        q.to.as_deref().and_then(parse_date),
    ) else {
        return Err(Problem::field("from", "Informe o período (from e to)."));
    };
    let items = db::sessions(
        &state.db,
        SessionQuery {
            range: Some((from, to)),
            ..query(&state, &m, m.role != "student")
        },
    )
    .await?;
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

async fn create_session(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let t = own_type(&state, m.club_id, body.str("class_type_id").as_deref()).await?;
    let mut errors = Vec::new();
    let r = refs(&state, m.club_id, &body, &mut errors).await?;
    let date = body.str("date").as_deref().and_then(parse_date);
    let time = body.str("time").as_deref().and_then(hhmm);
    let (Some(date), Some(time)) = (date, time) else {
        errors.push(fail("date", "Informe a data e o horário."));
        return Err(Problem::invalid(errors));
    };
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let id = db::create_session(
        &state.db,
        m.club_id,
        db::NewSession {
            class_type_id: t.id,
            date,
            time,
            duration_min: r.duration_min.unwrap_or(t.duration_min),
            capacity: r.capacity.unwrap_or(t.default_capacity),
            location_id: r.location_id.flatten(),
            instructor_membership_id: r.instructor_membership_id.flatten(),
            notes: body.str("notes"),
        },
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(session_json(&state, &m, id).await?),
    )
        .into_response())
}

async fn session(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let s = own_session(&state, &m, &id).await?;
    Ok(Json(session_json(&state, &m, s.id).await?))
}

async fn update_session(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let s = own_session(&state, &m, &id).await?;
    let mut errors = Vec::new();
    let r = refs(&state, m.club_id, &body, &mut errors).await?;
    let cancel = body.has("status");
    if cancel && body.str("status").as_deref() != Some("cancelled") {
        errors.push(fail("status", "Só é possível cancelar a aula."));
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let mut tx = state.db.begin().await?;
    db::edit_session(
        &mut *tx,
        s.id,
        db::SessionEdit {
            notes: body.has("notes").then(|| body.str("notes")),
            location_id: r.location_id,
            instructor_membership_id: r.instructor_membership_id,
        },
    )
    .await?;
    if let Some(capacity) = r.capacity {
        db::set_capacity(&mut tx, s.id, capacity).await?;
    }
    if cancel {
        db::cancel_session(&mut tx, s.id, body.str("cancel_reason").as_deref()).await?;
    }
    tx.commit().await?;
    Ok(Json(session_json(&state, &m, s.id).await?))
}

// ------------------------------------------------------------------------------------ bookings

async fn book(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let s = own_session(&state, &m, &id).await?;
    if s.status == "cancelled" {
        return Err(conflict(
            "session.cancelled",
            "Aula cancelada",
            "Escolha outro horário.",
        ));
    }
    if s.ends_at <= Utc::now() {
        return Err(conflict(
            "session.past",
            "Esta aula já aconteceu",
            "Escolha um horário futuro.",
        ));
    }
    let target = if m.role == "student" {
        Some(m.membership_id)
    } else {
        body.str("membership_id").and_then(|s| parse_id(&s))
    };
    let target = match target {
        Some(t) if runflow_db::members::is_active_student(&state.db, m.club_id, t).await? => t,
        _ => {
            return Err(Problem::invalid(vec![fail(
                "membership_id",
                "Escolha um aluno do clube.",
            )]));
        }
    };
    let mut tx = state.db.begin().await?;
    let row = match db::book(&mut tx, s.id, target, s.capacity).await {
        Ok(row) => row,
        Err(BookError::Exists { waitlist_position }) => {
            return Err(conflict(
                "booking.exists",
                "Essa reserva já existe",
                match waitlist_position {
                    Some(p) => format!("Na lista de espera, posição {p}."),
                    None => "A vaga já está garantida.".to_string(),
                },
            ));
        }
        Err(BookError::Db(e)) => return Err(e.into()),
    };
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(row)).into_response())
}

/// A booking in this club the caller may touch (a student only their own).
async fn own_booking(state: &AppState, m: &Member, id: &str) -> Result<db::Booking, Problem> {
    let id = parse_id(id).ok_or_else(no_booking)?;
    match db::booking(&state.db, m.club_id, id).await? {
        Some(b) if m.role != "student" || b.membership_id == m.membership_id => Ok(b),
        _ => Err(no_booking()),
    }
}

async fn cancel_booking(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let b = own_booking(&state, &m, &id).await?;
    if b.status == "cancelled" {
        return Ok(StatusCode::NO_CONTENT);
    }
    if m.role == "student" && b.session_starts_at <= Utc::now() {
        return Err(conflict(
            "booking.started",
            "A aula já começou",
            "Não é possível cancelar depois do início. Fale com a equipe.",
        ));
    }
    let mut tx = state.db.begin().await?;
    db::cancel_booking(&mut tx, &b).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn attendance(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let b = own_booking(&state, &m, &id).await?;
    if m.role == "student" {
        return Err(Problem::new(
            StatusCode::FORBIDDEN,
            "auth.forbidden",
            "Sem permissão",
            "Só a equipe marca presença.",
        ));
    }
    let Some(status) = body
        .str("status")
        .filter(|s| ATTENDANCE.contains(&s.as_str()))
    else {
        return Err(Problem::field("status", "Situação inválida."));
    };
    let mut tx = state.db.begin().await?;
    let row = db::set_attendance(&mut tx, &b, &status).await?;
    tx.commit().await?;
    Ok(Json(row))
}

async fn check_in(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, &["student"]).await?;
    let s = own_session(&state, &m, &id).await?;
    let code = body.str("checkin_code").unwrap_or_default().to_uppercase();
    if code != s.checkin_code {
        return Err(Problem::new(
            StatusCode::BAD_REQUEST,
            "checkin.invalid_code",
            "Código incorreto",
            "Confira o código mostrado no local da aula.",
        ));
    }
    if s.status == "cancelled" {
        return Err(conflict(
            "session.cancelled",
            "Aula cancelada",
            "Esta aula foi cancelada.",
        ));
    }
    let now = Utc::now();
    if now < s.starts_at - Duration::minutes(db::CHECKIN_EARLY_MIN) || now > s.ends_at {
        return Err(conflict(
            "checkin.window",
            "Fora do horário",
            "O check-in abre 45 minutos antes da aula e fecha no fim dela.",
        ));
    }
    let mut tx = state.db.begin().await?;
    let Some(row) = db::check_in(&mut tx, s.id, m.membership_id, s.capacity).await? else {
        return Err(conflict(
            "session.full",
            "Aula lotada",
            "Não há vagas para fazer check-in.",
        ));
    };
    tx.commit().await?;
    Ok(Json(row))
}

// ------------------------------------------------------------------------------------ attendance report

#[derive(Deserialize)]
struct ReportQuery {
    from: Option<String>,
    to: Option<String>,
    group_id: Option<String>,
}

async fn report(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    Query(q): Query<ReportQuery>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let tz = club_tz(&state, m.club_id).await?;
    let to =
        q.to.as_deref()
            .and_then(parse_date)
            .unwrap_or_else(|| club_today(&tz));
    let from: NaiveDate = q
        .from
        .as_deref()
        .and_then(parse_date)
        .unwrap_or(to - Duration::days(27));
    if from > to {
        return Err(Problem::field("from", "O início precisa ser antes do fim."));
    }
    if (to - from).num_days() > 366 {
        return Err(Problem::field("from", "Escolha um período de até 1 ano."));
    }
    let group_text = q.group_id.filter(|g| !g.is_empty());
    // An unknown group id matches no one (like the mock and the training report).
    let group = group_text
        .as_deref()
        .map(|g| Uuid::parse_str(g).unwrap_or(Uuid::nil()));

    let sessions = db::report_sessions(&state.db, m.club_id, from, to).await?;
    let held: Vec<&db::HeldSession> = sessions
        .iter()
        .filter(|s| s.status == "scheduled")
        .collect();
    let held_ids: Vec<Uuid> = held.iter().map(|s| s.id).collect();
    let seats = db::report_seats(&state.db, &held_ids).await?;
    let type_of: HashMap<Uuid, Uuid> = held.iter().map(|s| (s.id, s.class_type_id)).collect();
    let capacity = |ss: &[&db::HeldSession]| ss.iter().map(|s| s.capacity as i64).sum::<i64>();

    let by_type: Vec<Value> = db::report_types(&state.db, m.club_id)
        .await?
        .into_iter()
        .filter_map(|t| {
            let ss: Vec<&db::HeldSession> = held
                .iter()
                .copied()
                .filter(|s| s.class_type_id == t.id)
                .collect();
            let cancelled = sessions
                .iter()
                .filter(|s| s.class_type_id == t.id && s.status == "cancelled")
                .count();
            if ss.is_empty() && cancelled == 0 {
                return None;
            }
            let bs: Vec<&db::Seat> = seats
                .iter()
                .filter(|b| type_of.get(&b.session_id) == Some(&t.id))
                .collect();
            let cap = capacity(&ss);
            let mut row = json!({
                "class_type": { "id": t.id, "name": t.name, "sport": t.sport },
                "sessions": ss.len(),
                "cancelled": cancelled,
                "capacity": cap,
                "occupancy_pct": db::pct(bs.len() as i64, cap),
            });
            merge(&mut row, db::tally(bs.into_iter()));
            Some(row)
        })
        .collect();

    let students = db::report_students(&state.db, m.club_id, group).await?;
    let mut athletes: Vec<(i64, String, Value)> = students
        .iter()
        .filter_map(|st| {
            let mine = seats.iter().filter(|b| b.membership_id == st.membership_id);
            let t = db::tally(mine);
            if t["booked"].as_i64().unwrap_or(0) == 0 {
                return None;
            }
            let attended = t["attended"].as_i64().unwrap_or(0);
            let mut row = json!({ "membership_id": st.membership_id, "user": st.user });
            merge(&mut row, t);
            Some((attended, st.name.to_lowercase(), row))
        })
        .collect();
    athletes.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));

    let counted: Vec<&db::Seat> = match group {
        Some(_) => {
            let ids: std::collections::HashSet<Uuid> =
                students.iter().map(|s| s.membership_id).collect();
            seats
                .iter()
                .filter(|b| ids.contains(&b.membership_id))
                .collect()
        }
        None => seats.iter().collect(),
    };
    let mut totals = json!({
        "sessions": held.len(),
        "cancelled": sessions.len() - held.len(),
        "occupancy_pct": db::pct(seats.len() as i64, capacity(&held)),
    });
    merge(&mut totals, db::tally(counted.into_iter()));
    Ok(Json(json!({
        "from": from,
        "to": to,
        "group_id": group_text,
        "totals": totals,
        "by_type": by_type,
        "athletes": athletes.into_iter().map(|a| a.2).collect::<Vec<_>>(),
    })))
}

fn merge(into: &mut Value, from: Value) {
    if let (Some(a), Value::Object(b)) = (into.as_object_mut(), from) {
        a.extend(b);
    }
}
