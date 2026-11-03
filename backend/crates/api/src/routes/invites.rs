//! Personal invites (D-023, A3, A5, O2): one per e-mail, e-mailed by the worker, 7 days, single use, only the
//! invited e-mail can accept.

use std::collections::HashSet;

use aws_lc_rs::rand;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{Duration, Utc};
use runflow_db::invites as db;
use runflow_db::models::Invitation;
use serde::Serialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{Member, STAFF, member};
use crate::body::{Body, is_email};
use crate::session::{Auth, MaybeAuth};
use crate::{AppState, Problem};

const INVITE_DAYS: i64 = 7;
const BULK_MAX: usize = 500;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/invites", get(list).post(create))
        .route("/clubs/{club_id}/invites/bulk", post(bulk))
        .route("/clubs/{club_id}/invites/{id}", delete(cancel))
        .route("/clubs/{club_id}/invites/{id}/resend", post(resend))
        .route("/public/invites/{token}", get(public))
        .route("/invites/{token}/accept", post(accept))
}

#[derive(Serialize)]
struct Out {
    #[serde(flatten)]
    invite: Invitation,
    status: &'static str,
    url: String,
}

fn out(state: &AppState, i: Invitation) -> Out {
    Out {
        status: i.status(Utc::now()),
        url: format!("{}/invite/{}", state.settings.public_app_url, i.token),
        invite: i,
    }
}

fn new_token() -> String {
    let mut b = [0u8; 18];
    rand::fill(&mut b).expect("system randomness");
    URL_SAFE_NO_PAD.encode(b)
}

/// `ana@email.com` → `an•@email.com` (the public page never shows the whole address).
pub fn mask_email(e: &str) -> String {
    let (u, d) = e.split_once('@').unwrap_or((e, ""));
    let keep: String = u.chars().take(2).collect();
    format!(
        "{keep}{}@{d}",
        "•".repeat(u.chars().count().saturating_sub(2).max(1))
    )
}

fn trainers_owner_only() -> Problem {
    Problem::new(
        StatusCode::FORBIDDEN,
        "auth.forbidden",
        "Sem permissão",
        "Só o gestor convida treinadores.",
    )
}

fn not_found(detail: &'static str) -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "invite.not_found",
        "Convite não encontrado",
        detail,
    )
}

async fn queue_email(state: &AppState, invite: &Invitation) -> Result<(), Problem> {
    runflow_jobs::enqueue(
        &state.db,
        runflow_jobs::INVITE_EMAIL,
        json!({ "invite_id": invite.id, "token": invite.token }),
    )
    .await?;
    Ok(())
}

async fn list(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let mut items: Vec<Out> = db::list(&state.db, m.club_id)
        .await?
        .into_iter()
        .map(|i| out(&state, i))
        .collect();
    let rank = |s: &str| match s {
        "pending" => 0,
        "expired" => 1,
        _ => 2,
    };
    items.sort_by(|a, b| {
        rank(a.status)
            .cmp(&rank(b.status))
            .then(b.invite.created_at.cmp(&a.invite.created_at))
    });
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

/// Valid group ids of this club (others dropped silently, like the mock).
async fn club_groups(
    state: &AppState,
    club_id: Uuid,
) -> Result<Vec<runflow_db::models::Group>, Problem> {
    Ok(runflow_db::members::groups(&state.db, club_id).await?)
}

async fn create(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let role = if body.str("role").as_deref() == Some("trainer") {
        "trainer"
    } else {
        "student"
    };
    if role == "trainer" && !m.is_owner() {
        return Err(trainers_owner_only());
    }
    let email = body
        .str("email")
        .map(|e| e.to_lowercase())
        .filter(|e| is_email(e))
        .ok_or_else(|| Problem::field("email", "Digite um e-mail válido, como nome@email.com."))?;
    if db::is_member_email(&state.db, m.club_id, &email).await? {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "invite.already_member",
            "Essa pessoa já está no clube",
            "Ela já pode entrar com esse e-mail.",
        ));
    }
    if db::open_for(&state.db, m.club_id, &email).await?.is_some() {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "invite.exists",
            "Já existe um convite para esse e-mail",
            "Use “Reenviar” na lista de convites para mandar de novo.",
        ));
    }
    // Trainer seats are few: open trainer invites count too (D-043).
    if role == "trainer" {
        let pending = db::pending_trainers(&state.db, m.club_id).await?;
        crate::access::ensure_seat(&state, m.club_id, "trainer", 1 + pending).await?;
    }
    let wanted: Vec<Uuid> = body
        .get("group_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str()?.parse().ok())
        .collect();
    let groups: Vec<Uuid> = if role == "student" {
        club_groups(&state, m.club_id)
            .await?
            .into_iter()
            .map(|g| g.id)
            .filter(|g| wanted.contains(g))
            .collect()
    } else {
        Vec::new()
    };
    let name = body.str("name");
    let invite = insert(&state, &m, role, &email, name.as_deref(), &groups).await?;
    queue_email(&state, &invite).await?;
    Ok((StatusCode::CREATED, Json(out(&state, invite))).into_response())
}

async fn insert(
    state: &AppState,
    m: &Member,
    role: &str,
    email: &str,
    name: Option<&str>,
    groups: &[Uuid],
) -> Result<Invitation, Problem> {
    let row = db::insert(
        &state.db,
        db::NewInvite {
            club_id: m.club_id,
            role,
            email,
            name,
            token: &new_token(),
            group_ids: groups,
            created_by: m.membership_id,
            expires_at: Utc::now() + Duration::days(INVITE_DAYS),
        },
    )
    .await;
    match row {
        Ok(i) => Ok(i),
        // A concurrent request created it first (one open invite per e-mail).
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => Err(Problem::new(
            StatusCode::CONFLICT,
            "invite.exists",
            "Já existe um convite para esse e-mail",
            "Use “Reenviar” na lista de convites para mandar de novo.",
        )),
        Err(e) => Err(e.into()),
    }
}

async fn resend(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Out>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let missing = || not_found("Ele pode ter sido cancelado.");
    let id = Uuid::parse_str(&id).map_err(|_| missing())?;
    let i = db::by_id(&state.db, m.club_id, id)
        .await?
        .filter(|i| i.revoked_at.is_none())
        .ok_or_else(missing)?;
    if i.accepted_at.is_some() {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "invite.accepted",
            "Convite já aceito",
            "Essa pessoa já entrou no clube.",
        ));
    }
    if i.role == "trainer" && !m.is_owner() {
        return Err(trainers_owner_only());
    }
    let i = db::renew(
        &state.db,
        i.id,
        &new_token(),
        Utc::now() + Duration::days(INVITE_DAYS),
    )
    .await?;
    queue_email(&state, &i).await?;
    Ok(Json(out(&state, i)))
}

#[derive(Serialize)]
struct BulkItem {
    #[serde(flatten)]
    invite: Out,
    resent: bool,
}

async fn bulk(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let rows: Vec<Value> = body
        .get("rows")
        .and_then(Value::as_array)
        .map(|r| r.iter().take(BULK_MAX).cloned().collect())
        .unwrap_or_default();
    if rows.is_empty() {
        return Err(Problem::field("rows", "Envie pelo menos um aluno."));
    }
    let groups = club_groups(&state, m.club_id).await?;
    let (mut seen, mut items, mut skipped) = (HashSet::new(), Vec::new(), Vec::new());
    for (n, r) in rows.iter().enumerate() {
        let email = r["email"]
            .as_str()
            .unwrap_or_default()
            .trim()
            .to_lowercase();
        let skip = |reason: &str| json!({ "row": n + 1, "email": email, "reason": reason });
        if !is_email(&email) {
            skipped.push(skip("invalid_email"));
            continue;
        }
        if !seen.insert(email.clone()) {
            skipped.push(skip("duplicate"));
            continue;
        }
        if db::is_member_email(&state.db, m.club_id, &email).await? {
            skipped.push(skip("already_member"));
            continue;
        }
        let wanted: Vec<String> = r["groups"]
            .as_str()
            .unwrap_or_default()
            .split([',', '|'])
            .map(|g| g.trim().to_lowercase())
            .filter(|g| !g.is_empty())
            .collect();
        let group_ids: Vec<Uuid> = groups
            .iter()
            .filter(|g| wanted.contains(&g.name.to_lowercase()))
            .map(|g| g.id)
            .collect();
        let (invite, resent) = match db::open_for(&state.db, m.club_id, &email).await? {
            Some(open) => (
                db::renew(
                    &state.db,
                    open.id,
                    &new_token(),
                    Utc::now() + Duration::days(INVITE_DAYS),
                )
                .await?,
                true,
            ),
            None => {
                let name = r["name"].as_str().map(str::trim).filter(|s| !s.is_empty());
                (
                    insert(&state, &m, "student", &email, name, &group_ids).await?,
                    false,
                )
            }
        };
        queue_email(&state, &invite).await?;
        items.push(BulkItem {
            invite: out(&state, invite),
            resent,
        });
    }
    let sub = runflow_db::clubs::subscription(&state.db, m.club_id, &m.role).await?;
    let over_limit = sub
        .and_then(|s| Some((s.active_students + items.len() as i64 - s.student_limit?).max(0)))
        .unwrap_or(0);
    Ok((StatusCode::CREATED, Json(json!({ "created": items.len(), "items": items, "skipped": skipped, "over_limit": over_limit }))).into_response())
}

async fn cancel(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let missing = || not_found("Ele pode já ter sido cancelado.");
    let id = Uuid::parse_str(&id).map_err(|_| missing())?;
    let i = db::by_id(&state.db, m.club_id, id)
        .await?
        .ok_or_else(missing)?;
    db::revoke(&state.db, i.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------------ public side

/// The invite behind a token, its club, and why it can't be used (if so).
async fn resolve(
    state: &AppState,
    token: &str,
) -> Result<(Invitation, runflow_db::models::Club, Option<&'static str>), Problem> {
    let missing = || {
        not_found(
            "O link pode ter sido trocado por um mais novo. Confira seu e-mail ou peça um novo convite.",
        )
    };
    let i = db::by_token(&state.db, token).await?.ok_or_else(missing)?;
    let club = runflow_db::clubs::club(&state.db, i.club_id)
        .await?
        .ok_or_else(missing)?;
    let mut reason = match i.status(Utc::now()) {
        "pending" => None,
        "expired" => Some("expired"),
        "revoked" => Some("revoked"),
        _ => Some("accepted"),
    };
    if reason.is_none()
        && let Some(s) = runflow_db::clubs::subscription(&state.db, club.id, "owner").await?
    {
        let (used, limit) = if i.role == "trainer" {
            (s.active_trainers, s.trainer_limit)
        } else {
            (s.active_students, s.student_limit)
        };
        if limit.is_some_and(|l| used >= l) {
            reason = Some("club_full");
        }
    }
    Ok((i, club, reason))
}

async fn public(
    State(state): State<AppState>,
    MaybeAuth(auth): MaybeAuth,
    Path(token): Path<String>,
) -> Result<Json<Value>, Problem> {
    let (i, c, reason) = resolve(&state, &token).await?;
    let (already, matches) = match auth {
        Some(a) => {
            let me = runflow_db::auth::user_by_id(&state.db, a.user_id).await?;
            let already = runflow_db::clubs::access(&state.db, a.user_id, c.id)
                .await?
                .is_some();
            (already, me.map(|u| u.email.eq_ignore_ascii_case(&i.email)))
        }
        None => (false, None),
    };
    Ok(Json(json!({
        "club": { "id": c.id, "slug": c.slug, "name": c.name, "city": c.city, "state": c.state, "modalities": c.modalities, "trainer_label": c.trainer_label },
        "branding": runflow_db::clubs::branding(&state.db, c.id).await?,
        "role": i.role,
        "valid": reason.is_none(),
        "reason": reason,
        "invited_by": db::inviter_name(&state.db, i.created_by).await?,
        "name": i.name,
        // The token only reached that mailbox: while valid, hand the address back so sign-in can pre-fill it.
        "email": reason.is_none().then_some(&i.email),
        "email_hint": mask_email(&i.email),
        "expires_at": i.expires_at,
        "members": db::active_students(&state.db, c.id).await?,
        "already_member": already,
        "email_matches": matches,
    })))
}

async fn accept(
    State(state): State<AppState>,
    auth: Auth,
    Path(token): Path<String>,
) -> Result<Response, Problem> {
    let (i, club, reason) = resolve(&state, &token).await?;
    let user = runflow_db::auth::user_by_id(&state.db, auth.user_id)
        .await?
        .ok_or_else(Problem::unauthorized)?;
    if let Some(a) = runflow_db::clubs::access(&state.db, user.id, club.id).await? {
        let membership =
            runflow_db::members::membership(&state.db, club.id, a.membership_id).await?;
        return Ok(
            Json(json!({ "membership": membership, "club": club, "already_member": true }))
                .into_response(),
        );
    }
    if !user.email.eq_ignore_ascii_case(&i.email) {
        return Err(Problem::new(
            StatusCode::FORBIDDEN,
            "invite.email_mismatch",
            "Este convite é para outro e-mail",
            format!(
                "Ele foi enviado para {}. Saia e entre com esse e-mail para aceitar.",
                mask_email(&i.email)
            ),
        ));
    }
    if let Some(r) = reason {
        let (title, detail) = match r {
            "revoked" => (
                "Convite cancelado",
                "Peça um novo convite para quem te convidou.",
            ),
            "expired" => (
                "Convite expirado",
                "Os convites valem 7 dias. Peça para quem te convidou reenviar.",
            ),
            "accepted" => (
                "Convite já usado",
                "Este convite já foi aceito. Entre com sua conta para ver o clube.",
            ),
            _ if i.role == "trainer" => (
                "O clube está lotado",
                "O clube atingiu o limite de treinadores do plano. Avise quem te convidou.",
            ),
            _ => (
                "O clube está lotado",
                "O clube atingiu o limite de alunos do plano. Avise quem te convidou.",
            ),
        };
        return Err(Problem::new(
            StatusCode::CONFLICT,
            format!("invite.{r}"),
            title,
            detail,
        ));
    }
    let mut tx = state.db.begin().await?;
    let m = db::accept(&mut tx, &i, user.id).await?;
    let (body, link) = if i.role == "trainer" {
        (
            Some("Novo treinador na equipe."),
            "/club/members".to_string(),
        )
    } else {
        (None, format!("/students/{}", m.id))
    };
    runflow_db::notifications::to_staff(
        &mut tx,
        runflow_db::notifications::Notice {
            club_id: club.id,
            kind: "member_joined",
            title: &format!("{} entrou no clube", user.name),
            body,
            link: &link,
        },
    )
    .await?;
    runflow_db::clubs::audit(
        &mut *tx,
        Some(club.id),
        user.id,
        "member.joined",
        "membership",
        m.id,
    )
    .await?;
    tx.commit().await?;
    crate::routes::billing::seats_changed(&state, club.id).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "membership": m, "club": club, "already_member": false })),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::mask_email;

    #[test]
    fn masks() {
        assert_eq!(mask_email("joao@email.com"), "jo••@email.com");
        assert_eq!(mask_email("ab@x.com"), "ab•@x.com");
    }
}
