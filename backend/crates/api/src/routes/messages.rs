//! Messages and the mural (W13, M10; endpoints.md § Messages and announcements), like api/mock/routes/messages.mjs:
//! one conversation per student shared by the club's staff, and announcements to the club or some groups.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use runflow_db::messages as db;
use runflow_db::notifications::{self, Notice};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{ANY, Member, STAFF, member};
use crate::body::Body;
use crate::session::Auth;
use crate::{AppState, FieldError, Problem};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/conversations", get(list).post(open))
        .route("/clubs/{club_id}/conversations/{id}", get(one))
        .route("/clubs/{club_id}/conversations/{id}/messages", post(send))
        .route("/clubs/{club_id}/conversations/{id}/read", post(read))
        .route("/clubs/{club_id}/messages/{id}", delete(delete_message))
        .route(
            "/clubs/{club_id}/announcements",
            get(announcements).post(publish),
        )
        .route(
            "/clubs/{club_id}/announcements/read",
            post(read_announcements),
        )
        .route(
            "/clubs/{club_id}/announcements/{id}",
            axum::routing::patch(update_announcement).delete(delete_announcement),
        )
        .route(
            "/clubs/{club_id}/announcements/{id}/reads",
            get(announcement_reads),
        )
}

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

fn no_conversation() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "conversation.not_found",
        "Conversa não encontrada",
        "Ela pode ter sido removida.",
    )
}

fn no_announcement() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "announcement.not_found",
        "Aviso não encontrado",
        "Ele pode ter sido apagado.",
    )
}

/// A notification preview: up to 90 characters.
fn preview(s: &str) -> String {
    if s.chars().count() > 90 {
        format!("{}…", s.chars().take(87).collect::<String>())
    } else {
        s.to_string()
    }
}

/// The conversation, if the caller may see it (students only their own).
async fn conversation(state: &AppState, m: &Member, id: &str) -> Result<db::Conversation, Problem> {
    let id = Uuid::parse_str(id).map_err(|_| no_conversation())?;
    db::conversation(&state.db, m.club_id, id)
        .await?
        .filter(|c| m.role != "student" || c.student_membership_id == m.membership_id)
        .ok_or_else(no_conversation)
}

#[derive(Deserialize)]
struct ListQuery {
    q: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let items = if m.role == "student" {
        let id = db::get_or_create(&state.db, m.club_id, m.membership_id).await?;
        vec![db::summary(&state.db, id, m.membership_id).await?]
    } else {
        let q = q.q.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        db::staff_list(&state.db, m.club_id, m.membership_id, q.as_deref()).await?
    };
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

async fn open(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let student = body
        .str("student_membership_id")
        .and_then(|s| Uuid::parse_str(&s).ok());
    let Some(student) = student else {
        return Err(Problem::invalid(vec![fail(
            "student_membership_id",
            "Escolha o aluno.",
        )]));
    };
    if !db::is_active_student(&state.db, m.club_id, student).await? {
        return Err(Problem::invalid(vec![fail(
            "student_membership_id",
            "Escolha o aluno.",
        )]));
    }
    let id = db::get_or_create(&state.db, m.club_id, student).await?;
    Ok(Json(db::summary(&state.db, id, m.membership_id).await?))
}

async fn one(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let c = conversation(&state, &m, &id).await?;
    let mut out = db::summary(&state.db, c.id, m.membership_id).await?;
    out["messages"] = json!(db::messages(&state.db, c.id).await?);
    out["reads"] = json!(db::reads(&state.db, c.id, m.membership_id).await?);
    Ok(Json(out))
}

async fn send(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let c = conversation(&state, &m, &id).await?;
    let text = body
        .str("body")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if text.is_empty() {
        return Err(Problem::invalid(vec![fail(
            "body",
            "Escreva uma mensagem.",
        )]));
    }
    if text.chars().count() > 4000 {
        return Err(Problem::invalid(vec![fail(
            "body",
            "Mensagem muito longa (máximo 4.000 caracteres).",
        )]));
    }
    let mut tx = state.db.begin().await?;
    let message = db::send(&mut tx, c.id, m.membership_id, &text).await?;
    let author = message["author"]["user"]["name"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let link = format!("/messages?c={}", c.id);
    let snippet = preview(&text);
    // A student writes to the whole staff; staff write to the student.
    let (recipients, title) = if m.role == "student" {
        (
            db::staff(&mut *tx, m.club_id).await?,
            format!("Mensagem de {author}"),
        )
    } else {
        let first = author
            .split_whitespace()
            .next()
            .unwrap_or(&author)
            .to_string();
        (vec![c.student_membership_id], format!("{first} respondeu"))
    };
    for r in recipients {
        notifications::to_member(
            &mut tx,
            r,
            Notice {
                club_id: m.club_id,
                kind: "message",
                title: &title,
                body: Some(&snippet),
                link: &link,
            },
            None,
        )
        .await?;
    }
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(message)).into_response())
}

async fn read(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let c = conversation(&state, &m, &id).await?;
    db::mark_read(&state.db, c.id, m.membership_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_message(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let gone = match Uuid::parse_str(&id) {
        Ok(id) => db::delete_message(&state.db, m.club_id, id, m.membership_id).await?,
        Err(_) => false,
    };
    if !gone {
        return Err(Problem::new(
            StatusCode::NOT_FOUND,
            "message.not_found",
            "Mensagem não encontrada",
            "Só quem escreveu pode apagar.",
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------------ mural

async fn announcements(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let items =
        db::announcements(&state.db, m.club_id, m.membership_id, m.role != "student").await?;
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

fn group_ids(body: &Body) -> Option<Vec<Uuid>> {
    body.get("group_ids")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str()?.parse().ok()).collect())
}

fn check(body: &Body, partial: bool) -> Result<(Option<String>, Option<String>), Problem> {
    let mut errors = Vec::new();
    let title = body.str("title").map(|s| s.trim().to_string());
    let text = body.str("body").map(|s| s.trim().to_string());
    if (!partial || body.has("title")) && title.as_deref().unwrap_or("").is_empty() {
        errors.push(fail("title", "Dê um título ao aviso."));
    }
    if (!partial || body.has("body")) && text.as_deref().unwrap_or("").is_empty() {
        errors.push(fail("body", "Escreva o aviso."));
    }
    if title.as_deref().is_some_and(|t| t.chars().count() > 120) {
        errors.push(fail("title", "Título muito longo (máximo 120)."));
    }
    if text.as_deref().is_some_and(|t| t.chars().count() > 4000) {
        errors.push(fail("body", "Aviso muito longo (máximo 4.000 caracteres)."));
    }
    if errors.is_empty() {
        Ok((title, text))
    } else {
        Err(Problem::invalid(errors))
    }
}

/// One announcement as the caller sees it (after a write).
async fn announcement(state: &AppState, m: &Member, id: Uuid) -> Result<Value, Problem> {
    db::announcements(&state.db, m.club_id, m.membership_id, true)
        .await?
        .into_iter()
        .find(|a| a["id"].as_str() == Some(&id.to_string()))
        .ok_or_else(no_announcement)
}

async fn publish(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let (title, text) = check(&body, false)?;
    let (title, text) = (title.unwrap_or_default(), text.unwrap_or_default());
    let groups = group_ids(&body).unwrap_or_default();
    let mut tx = state.db.begin().await?;
    let (id, audience) = db::publish(
        &mut tx,
        m.club_id,
        m.membership_id,
        db::NewAnnouncement {
            title: &title,
            body: &text,
            group_ids: &groups,
            pinned: body.get("pinned").and_then(Value::as_bool).unwrap_or(false),
        },
    )
    .await?;
    let (notice, snippet) = (format!("Novo aviso: {title}"), preview(&text));
    for student in audience {
        notifications::to_member(
            &mut tx,
            student,
            Notice {
                club_id: m.club_id,
                kind: "announcement",
                title: &notice,
                body: Some(&snippet),
                link: "/messages",
            },
            None,
        )
        .await?;
    }
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(announcement(&state, &m, id).await?),
    )
        .into_response())
}

async fn update_announcement(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = Uuid::parse_str(&id).map_err(|_| no_announcement())?;
    let (title, text) = check(&body, true)?;
    let changed = db::update_announcement(
        &state.db,
        m.club_id,
        id,
        db::AnnouncementPatch {
            title,
            body: text,
            pinned: body.get("pinned").and_then(Value::as_bool),
            group_ids: group_ids(&body),
        },
    )
    .await?;
    if !changed {
        return Err(no_announcement());
    }
    Ok(Json(announcement(&state, &m, id).await?))
}

async fn delete_announcement(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = Uuid::parse_str(&id).map_err(|_| no_announcement())?;
    if !db::delete_announcement(&state.db, m.club_id, id).await? {
        return Err(no_announcement());
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn read_announcements(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    let ids: Vec<Uuid> = body
        .get("ids")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str()?.parse().ok()).collect())
        .unwrap_or_default();
    db::read_announcements(&state.db, m.club_id, m.membership_id, &ids).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn announcement_reads(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let id = Uuid::parse_str(&id).map_err(|_| no_announcement())?;
    let mut conn = state.db.acquire().await?;
    let items = db::announcement_reads(&mut conn, m.club_id, id)
        .await?
        .ok_or_else(no_announcement)?;
    Ok(Json(json!({ "items": items })))
}
