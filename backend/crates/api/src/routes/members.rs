//! Members (O2), groups (W2) and leaving a club (C1).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post, put};
use axum::{Json, Router};
use runflow_db::members as db;
use runflow_db::models::{Group, Member};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{ANY, OWNER, STAFF, member};
use crate::body::Body;
use crate::session::Auth;
use crate::{AppState, FieldError, Problem};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/members", get(list))
        .route(
            "/clubs/{club_id}/members/{id}",
            patch(update).delete(remove),
        )
        .route("/clubs/{club_id}/groups", get(groups).post(create_group))
        .route(
            "/clubs/{club_id}/groups/{id}",
            patch(update_group).delete(delete_group),
        )
        .route(
            "/clubs/{club_id}/groups/{id}/members",
            put(set_group_members),
        )
        .route("/clubs/{club_id}/leave", post(leave))
}

/// pt-BR-ish sort key: lowercase, accents folded.
pub fn sort_key(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c => c,
        })
        .collect()
}

#[derive(Deserialize)]
struct ListQuery {
    role: Option<String>,
    status: Option<String>,
    q: Option<String>,
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
    let roles: Option<Vec<String>> = f.role.as_deref().map(|r| {
        r.split(',')
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect()
    });
    let status = f
        .status
        .as_deref()
        .filter(|s| ["active", "suspended", "left"].contains(s));
    let needle = f.q.as_deref().map(sort_key).filter(|q| !q.is_empty());
    let mut items: Vec<Member> = db::list(&state.db, m.club_id, roles.as_deref(), status)
        .await?
        .into_iter()
        .filter(|x| {
            needle.as_ref().is_none_or(|q| {
                sort_key(&x.user.name).contains(q) || x.user.email.to_lowercase().contains(q)
            })
        })
        .collect();
    let rank = |r: &str| {
        ["owner", "trainer", "student"]
            .iter()
            .position(|x| *x == r)
            .unwrap_or(3)
    };
    items.sort_by(|a, b| {
        rank(&a.membership.role)
            .cmp(&rank(&b.membership.role))
            .then_with(|| sort_key(&a.user.name).cmp(&sort_key(&b.user.name)))
    });
    // Small lists (a club's people): offset cursor, like the mock.
    let start = f
        .cursor
        .as_deref()
        .and_then(|c| c.parse::<usize>().ok())
        .unwrap_or(0);
    let limit = f.limit.unwrap_or(500).clamp(1, 500);
    let next = (start + limit < items.len()).then(|| (start + limit).to_string());
    let page: Vec<Member> = items.into_iter().skip(start).take(limit).collect();
    Ok(Json(json!({ "items": page, "next_cursor": next })))
}

fn member_not_found() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "member.not_found",
        "Membro não encontrado",
        "Ele pode ter saído do clube.",
    )
}

async fn target(
    state: &AppState,
    club_id: Uuid,
    id: &str,
) -> Result<runflow_db::models::Membership, Problem> {
    let id = Uuid::parse_str(id).map_err(|_| member_not_found())?;
    db::membership(&state.db, club_id, id)
        .await?
        .ok_or_else(member_not_found)
}

async fn row(state: &AppState, club_id: Uuid, membership_id: Uuid) -> Result<Member, Problem> {
    db::list(&state.db, club_id, None, None)
        .await?
        .into_iter()
        .chain(db::list(&state.db, club_id, None, Some("left")).await?)
        .find(|x| x.membership.id == membership_id)
        .ok_or_else(member_not_found)
}

async fn update(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Member>, Problem> {
    let me = member(&state, &auth, &club_id, OWNER).await?;
    let t = target(&state, me.club_id, &id).await?;
    if t.id == me.membership_id {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "member.self",
            "Não é possível alterar o próprio acesso",
            "Peça a outro gestor para fazer essa mudança.",
        ));
    }
    let mut errors = Vec::new();
    let role = body.str("role");
    if role.as_deref() == Some("owner") {
        return Err(Problem::field(
            "role",
            "Cada clube tem um único responsável.",
        ));
    }
    if role
        .as_ref()
        .is_some_and(|r| !["trainer", "student"].contains(&r.as_str()))
        || (body.has("role") && role.is_none())
    {
        errors.push(FieldError {
            field: "role".into(),
            message: "Papel inválido.".into(),
        });
    }
    let status = body.str("status");
    if status
        .as_ref()
        .is_some_and(|s| !["active", "suspended"].contains(&s.as_str()))
        || (body.has("status") && status.is_none())
    {
        errors.push(FieldError {
            field: "status".into(),
            message: "Situação inválida.".into(),
        });
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    // Taking a seat (reactivated, or moved to another role) counts against the plan (D-043).
    let next_role = role.as_deref().unwrap_or(&t.role);
    if status.as_deref().unwrap_or(&t.status) == "active"
        && (t.status != "active" || next_role != t.role)
    {
        crate::access::ensure_seat(&state, me.club_id, next_role, 1).await?;
    }
    db::update(&state.db, t.id, role.as_deref(), status.as_deref()).await?;
    runflow_db::clubs::audit(
        &state.db,
        Some(me.club_id),
        auth.user_id,
        "member.updated",
        "membership",
        t.id,
    )
    .await?;
    Ok(Json(row(&state, me.club_id, t.id).await?))
}

async fn remove(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let me = member(&state, &auth, &club_id, OWNER).await?;
    let t = target(&state, me.club_id, &id).await?;
    if t.id == me.membership_id {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "member.self",
            "Você não pode se remover",
            "Para sair, transfira a gestão do clube primeiro.",
        ));
    }
    let mut tx = state.db.begin().await?;
    db::leave(&mut tx, t.id, false).await?;
    runflow_db::clubs::audit(
        &mut *tx,
        Some(me.club_id),
        auth.user_id,
        "member.removed",
        "membership",
        t.id,
    )
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn leave(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<StatusCode, Problem> {
    let me = member(&state, &auth, &club_id, ANY).await?;
    if me.is_owner() && db::other_active_owners(&state.db, me.club_id, me.membership_id).await? == 0
    {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "member.last_owner",
            "Você é o único gestor",
            "Promova outra pessoa a gestora em Membros ou encerre o clube.",
        ));
    }
    let mut tx = state.db.begin().await?;
    db::leave(&mut tx, me.membership_id, true).await?;
    runflow_db::clubs::audit(
        &mut *tx,
        Some(me.club_id),
        auth.user_id,
        "member.left",
        "membership",
        me.membership_id,
    )
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------------ groups

fn group_not_found() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "group.not_found",
        "Grupo não encontrado",
        "Ele pode ter sido excluído.",
    )
}

async fn group_of(state: &AppState, club_id: Uuid, id: &str) -> Result<Group, Problem> {
    let id = Uuid::parse_str(id).map_err(|_| group_not_found())?;
    db::group(&state.db, club_id, id)
        .await?
        .ok_or_else(group_not_found)
}

async fn group_name(
    state: &AppState,
    club_id: Uuid,
    body: &Body,
    except: Option<Uuid>,
) -> Result<String, Problem> {
    let name = body
        .str("name")
        .ok_or_else(|| Problem::field("name", "Informe o nome do grupo."))?;
    if name.chars().count() > 60 {
        return Err(Problem::field("name", "Use no máximo 60 caracteres."));
    }
    if db::group_name_taken(&state.db, club_id, &name, except).await? {
        return Err(Problem::field("name", "Já existe um grupo com esse nome."));
    }
    Ok(name)
}

async fn groups(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let mut items = db::groups(&state.db, m.club_id).await?;
    items.sort_by_key(|g| sort_key(&g.name));
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

async fn create_group(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let name = group_name(&state, m.club_id, &body, None).await?;
    let id = db::insert_group(
        &state.db,
        m.club_id,
        &name,
        body.str("description").as_deref(),
    )
    .await?;
    let g = db::group(&state.db, m.club_id, id)
        .await?
        .ok_or_else(group_not_found)?;
    Ok((StatusCode::CREATED, Json(g)).into_response())
}

async fn update_group(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Group>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let g = group_of(&state, m.club_id, &id).await?;
    let name = if body.has("name") {
        Some(group_name(&state, m.club_id, &body, Some(g.id)).await?)
    } else {
        None
    };
    let description = body.has("description").then(|| body.str("description"));
    db::update_group(
        &state.db,
        g.id,
        name.as_deref(),
        description.as_ref().map(|d| d.as_deref()),
    )
    .await?;
    Ok(Json(
        db::group(&state.db, m.club_id, g.id)
            .await?
            .ok_or_else(group_not_found)?,
    ))
}

async fn delete_group(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let g = group_of(&state, m.club_id, &id).await?;
    db::delete_group(&state.db, g.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn set_group_members(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Json<Group>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let g = group_of(&state, m.club_id, &id).await?;
    let ids: Vec<Uuid> = body
        .get("membership_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str()?.parse().ok())
        .collect();
    let mut tx = state.db.begin().await?;
    db::set_group_members(&mut tx, m.club_id, g.id, &ids).await?;
    tx.commit().await?;
    Ok(Json(
        db::group(&state.db, m.club_id, g.id)
            .await?
            .ok_or_else(group_not_found)?,
    ))
}
