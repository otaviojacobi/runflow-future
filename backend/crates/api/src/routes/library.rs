//! Workout library (W5, W6) and exercise library (W18).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use runflow_db::library as db;
use runflow_db::models::{ExerciseRow, Template};
use runflow_domain::{tags, workout};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{ANY, STAFF, member};
use crate::body::Body;
use crate::session::Auth;
use crate::{AppState, FieldError, Problem};

const CATEGORIES: [&str; 6] = [
    "strength",
    "core",
    "mobility",
    "stretch",
    "plyometrics",
    "drill",
];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/templates", get(list).post(create))
        .route(
            "/clubs/{club_id}/templates/{id}",
            get(one).patch(update).delete(archive),
        )
        .route(
            "/clubs/{club_id}/exercises",
            get(exercises).post(create_exercise),
        )
        .route(
            "/clubs/{club_id}/exercises/{id}",
            axum::routing::patch(update_exercise).delete(archive_exercise),
        )
}

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

/// Shared by templates, planned workouts and planilha items: a structure problem as a pt-BR field error.
pub fn structure_error(v: &Value) -> Option<FieldError> {
    match workout::validate(v) {
        Ok(_) => None,
        Err(workout::StructureError::Empty) => {
            Some(fail("structure", "Adicione pelo menos uma etapa."))
        }
        Err(workout::StructureError::Invalid(why)) => {
            tracing::info!(%why, "invalid workout structure");
            Some(fail(
                "structure",
                "Não entendemos a estrutura do treino. Revise as etapas.",
            ))
        }
    }
}

/// `est_*`: a non-negative integer or null.
pub fn estimate(body: &Body, key: &'static str) -> Result<Option<Option<i32>>, FieldError> {
    match body.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(v) => v
            .as_i64()
            .filter(|n| (0..=10_000_000).contains(n))
            .map(|n| Some(Some(n as i32)))
            .ok_or(FieldError {
                field: key.into(),
                message: "Valor inválido.".into(),
            }),
    }
}

fn not_found() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "template.not_found",
        "Treino não encontrado",
        "Ele pode ter sido arquivado.",
    )
}

#[derive(Deserialize)]
struct Filter {
    sport: Option<String>,
    q: Option<String>,
    tag: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn list(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    Query(f): Query<Filter>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let raw = f.q.unwrap_or_default();
    let (q, hash, tq) = (
        raw.trim().to_lowercase(),
        raw.trim().starts_with('#'),
        tags::normalize(&raw),
    );
    let tag = f.tag.map(|t| tags::normalize(&t)).filter(|t| !t.is_empty());
    let items: Vec<Template> = db::templates(&state.db, m.club_id)
        .await?
        .into_iter()
        .filter(|t| f.sport.as_ref().is_none_or(|s| &t.sport == s))
        .filter(|t| tag.as_ref().is_none_or(|g| t.tags.contains(g)))
        .filter(|t| {
            q.is_empty()
                || (!hash && t.name.to_lowercase().contains(&q))
                || (!tq.is_empty() && t.tags.iter().any(|x| x.contains(&tq)))
        })
        .collect();
    let start = f
        .cursor
        .as_deref()
        .and_then(|c| c.parse::<usize>().ok())
        .unwrap_or(0);
    let limit = f.limit.unwrap_or(200).clamp(1, 500);
    let next = (start + limit < items.len()).then(|| (start + limit).to_string());
    Ok(Json(
        json!({ "items": items.into_iter().skip(start).take(limit).collect::<Vec<_>>(), "next_cursor": next }),
    ))
}

async fn one(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Template>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = Uuid::parse_str(&id).map_err(|_| not_found())?;
    Ok(Json(
        db::template(&state.db, m.club_id, id)
            .await?
            .ok_or_else(not_found)?,
    ))
}

/// Validate a template body (`partial` = PATCH).
fn read_template(body: &Body, partial: bool) -> Result<db::TemplateInput, Problem> {
    let mut errors = Vec::new();
    let mut t = db::TemplateInput {
        sport: None,
        name: None,
        description: None,
        structure: None,
        est_duration_s: None,
        est_distance_m: None,
        tags: None,
    };
    if !partial || body.has("name") {
        match body.str("name") {
            None => errors.push(fail("name", "Dê um nome ao treino.")),
            Some(n) if n.chars().count() > 120 => {
                errors.push(fail("name", "Use no máximo 120 caracteres."))
            }
            Some(n) => t.name = Some(n),
        }
    }
    if !partial || body.has("sport") {
        match body
            .str("sport")
            .filter(|s| workout::SPORTS.contains(&s.as_str()))
        {
            Some(s) => t.sport = Some(s),
            None => errors.push(fail("sport", "Escolha a modalidade.")),
        }
    }
    if !partial || body.has("structure") {
        let v = body.get("structure").cloned().unwrap_or(Value::Null);
        match structure_error(&v) {
            Some(e) => errors.push(e),
            None => t.structure = Some(v),
        }
    }
    if body.has("description") {
        t.description = Some(body.str("description"));
    }
    for (key, slot) in [
        ("est_duration_s", &mut t.est_duration_s),
        ("est_distance_m", &mut t.est_distance_m),
    ] {
        match estimate(body, key) {
            Ok(v) => *slot = v,
            Err(e) => errors.push(e),
        }
    }
    if body.has("tags") {
        let raw: Vec<String> = body
            .get("tags")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        match tags::clean(&raw) {
            Ok(clean) => t.tags = Some(clean),
            Err(_) => errors.push(fail("tags", "Use até 8 tags.")),
        }
    }
    if errors.is_empty() {
        Ok(t)
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
    let t = read_template(&body, false)?;
    let row = db::insert_template(&state.db, m.club_id, m.membership_id, t).await?;
    Ok((StatusCode::CREATED, Json(row)).into_response())
}

async fn update(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Template>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = Uuid::parse_str(&id).map_err(|_| not_found())?;
    db::template(&state.db, m.club_id, id)
        .await?
        .ok_or_else(not_found)?;
    let t = read_template(&body, true)?;
    Ok(Json(db::update_template(&state.db, id, t).await?))
}

async fn archive(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = Uuid::parse_str(&id).map_err(|_| not_found())?;
    db::template(&state.db, m.club_id, id)
        .await?
        .ok_or_else(not_found)?;
    db::archive_template(&state.db, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------------ exercises

#[derive(Serialize)]
struct ExerciseOut {
    #[serde(flatten)]
    row: ExerciseRow,
    scope: &'static str,
}

fn key(s: &str) -> String {
    s.trim().to_lowercase()
}

/// YouTube (watch, youtu.be, shorts) or Vimeo links only (embedded privacy-enhanced by the apps).
pub fn video_ok(u: &str) -> bool {
    let rest = |p: &str| u.strip_prefix(p).map(str::to_string);
    let id_ok = |id: &str, min: usize| {
        id.chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .count()
            >= min
    };
    for host in ["https://www.youtube.com/", "https://youtube.com/"] {
        if let Some(r) = rest(host)
            && let Some(id) = r
                .strip_prefix("watch?v=")
                .or_else(|| r.strip_prefix("shorts/"))
        {
            return id_ok(id, 6);
        }
    }
    if let Some(id) = rest("https://youtu.be/") {
        return id_ok(&id, 6);
    }
    for host in ["https://vimeo.com/", "https://www.vimeo.com/"] {
        if let Some(id) = rest(host) {
            return id.chars().next().is_some_and(|c| c.is_ascii_digit());
        }
    }
    false
}

#[derive(Deserialize)]
struct ExerciseFilter {
    q: Option<String>,
    category: Option<String>,
}

async fn exercises(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    Query(f): Query<ExerciseFilter>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let all = db::exercises(&state.db, m.club_id).await?;
    let mine: std::collections::HashSet<String> = all
        .iter()
        .filter(|e| e.club_id.is_some())
        .map(|e| key(&e.name))
        .collect();
    let q = f.q.as_deref().map(key).unwrap_or_default();
    let mut items: Vec<ExerciseOut> = all
        .into_iter()
        .filter(|e| e.club_id.is_some() || !mine.contains(&key(&e.name)))
        .filter(|e| f.category.as_ref().is_none_or(|c| &e.category == c))
        .filter(|e| {
            q.is_empty() || key(&e.name).contains(&q) || e.muscles.iter().any(|m| m.contains(&q))
        })
        .map(|row| ExerciseOut {
            scope: if row.club_id.is_some() {
                "club"
            } else {
                "global"
            },
            row,
        })
        .collect();
    items.sort_by_key(|e| crate::routes::members::sort_key(&e.row.name));
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

fn read_exercise(body: &Body, partial: bool) -> Result<db::ExerciseInput, Problem> {
    let mut errors = Vec::new();
    let mut e = db::ExerciseInput::default();
    if !partial || body.has("name") {
        match body.str("name") {
            Some(n) => e.name = Some(n),
            None => errors.push(fail("name", "Dê um nome ao exercício.")),
        }
    }
    if !partial || body.has("category") {
        match body
            .str("category")
            .filter(|c| CATEGORIES.contains(&c.as_str()))
        {
            Some(c) => e.category = Some(c),
            None => errors.push(fail("category", "Escolha a categoria.")),
        }
    }
    let list = |k: &str| {
        body.get(k).and_then(Value::as_array).map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
    };
    if body.has("muscles") {
        e.muscles = Some(list("muscles").unwrap_or_default());
    }
    if body.has("equipment") {
        e.equipment = Some(list("equipment").unwrap_or_default());
    }
    if body.has("cues") {
        e.cues = Some(body.str("cues"));
    }
    if body.has("video_url") {
        match body.str("video_url") {
            Some(u) if !video_ok(&u) => {
                errors.push(fail("video_url", "Use um link do YouTube ou do Vimeo."))
            }
            u => e.video_url = Some(u),
        }
    }
    if errors.is_empty() {
        Ok(e)
    } else {
        Err(Problem::invalid(errors))
    }
}

async fn create_exercise(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let e = read_exercise(&body, false)?;
    if db::club_exercise_named(
        &state.db,
        m.club_id,
        e.name.as_deref().unwrap_or_default(),
        None,
    )
    .await?
    {
        return Err(Problem::field(
            "name",
            "O clube já tem um exercício com esse nome.",
        ));
    }
    let row = db::insert_exercise(&state.db, m.club_id, m.membership_id, e).await?;
    Ok((
        StatusCode::CREATED,
        Json(ExerciseOut { row, scope: "club" }),
    )
        .into_response())
}

/// A club exercise this caller may change; the global catalog answers `403 exercise.global`.
async fn own(
    state: &AppState,
    auth: &Auth,
    club_id: &str,
    id: &str,
) -> Result<(Uuid, ExerciseRow), Problem> {
    let m = member(state, auth, club_id, STAFF).await?;
    let missing = || {
        Problem::new(
            StatusCode::NOT_FOUND,
            "exercise.not_found",
            "Exercício não encontrado",
            "Ele pode ter sido removido.",
        )
    };
    let id = Uuid::parse_str(id).map_err(|_| missing())?;
    let e = db::exercise(&state.db, id).await?.ok_or_else(missing)?;
    match e.club_id {
        Some(c) if c == m.club_id => Ok((m.club_id, e)),
        None => Err(Problem::new(
            StatusCode::FORBIDDEN,
            "exercise.global",
            "Exercício do catálogo Runflow",
            "Crie uma versão do clube para mudar o vídeo ou as dicas.",
        )),
        Some(_) => Err(missing()),
    }
}

async fn update_exercise(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<ExerciseOut>, Problem> {
    let (club, e) = own(&state, &auth, &club_id, &id).await?;
    let input = read_exercise(&body, true)?;
    if let Some(n) = &input.name
        && db::club_exercise_named(&state.db, club, n, Some(e.id)).await?
    {
        return Err(Problem::field(
            "name",
            "O clube já tem um exercício com esse nome.",
        ));
    }
    let row = db::update_exercise(&state.db, e.id, input).await?;
    Ok(Json(ExerciseOut { row, scope: "club" }))
}

async fn archive_exercise(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let (_, e) = own(&state, &auth, &club_id, &id).await?;
    db::archive_exercise(&state.db, e.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::video_ok;

    #[test]
    fn videos() {
        for ok in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://youtube.com/shorts/abcdef12",
            "https://vimeo.com/76979871",
        ] {
            assert!(video_ok(ok), "{ok}");
        }
        for bad in [
            "http://youtube.com/watch?v=dQw4w9WgXcQ",
            "https://evil.com/watch?v=x",
            "https://vimeo.com/abc",
            "https://youtu.be/ab",
        ] {
            assert!(!video_ok(bad), "{bad}");
        }
    }
}
