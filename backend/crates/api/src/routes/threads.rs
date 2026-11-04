//! Workout threads (student ⇄ trainers, M2/W8) and the trainer's feedback inbox (W8).

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use runflow_db::my::{self as db, CommentRow};
use runflow_db::workouts;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{ANY, STAFF, member};
use crate::body::Body;
use crate::session::Auth;
use crate::time::club_today;
use crate::{AppState, Problem};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/clubs/{club_id}/planned-workouts/{id}/comments",
            get(list).post(create),
        )
        .route("/clubs/{club_id}/feedback", get(inbox))
        .route("/clubs/{club_id}/feedback/read", post(read))
}

fn comment_json(c: &CommentRow) -> Value {
    json!({
        "id": c.id, "planned_workout_id": c.planned_workout_id, "author_membership_id": c.author_membership_id, "body": c.body,
        "created_at": c.created_at, "edited_at": c.edited_at, "deleted_at": c.deleted_at, "author": c.author,
    })
}

/// The workout, if this member may see its thread (students: only their own).
async fn thread(
    state: &AppState,
    auth: &Auth,
    club_id: &str,
    id: &str,
) -> Result<(crate::access::Member, runflow_db::models::Workout), Problem> {
    let m = member(state, auth, club_id, ANY).await?;
    let missing = || {
        Problem::new(
            StatusCode::NOT_FOUND,
            "workout.not_found",
            "Treino não encontrado",
            "Ele pode ter sido removido.",
        )
    };
    let id = Uuid::parse_str(id).map_err(|_| missing())?;
    let w = workouts::one(&state.db, m.club_id, m.membership_id, id)
        .await?
        .ok_or_else(missing)?;
    if m.role == "student" && (w.athlete_membership_id != m.membership_id || !w.visible) {
        return Err(missing());
    }
    Ok((m, w))
}

async fn list(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
) -> Result<Json<Value>, Problem> {
    let (m, w) = thread(&state, &auth, &club_id, &id).await?;
    let items: Vec<Value> = db::comments(&state.db, &[w.id])
        .await?
        .iter()
        .map(comment_json)
        .collect();
    db::mark_read(&state.db, m.membership_id, &[w.id]).await?;
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

async fn create(
    State(state): State<AppState>,
    auth: Auth,
    Path((club_id, id)): Path<(String, String)>,
    body: Body,
) -> Result<Response, Problem> {
    let (m, w) = thread(&state, &auth, &club_id, &id).await?;
    let text = body
        .str("body")
        .ok_or_else(|| Problem::field("body", "Escreva uma mensagem."))?;
    if text.chars().count() > 4000 {
        return Err(Problem::field("body", "Use no máximo 4.000 caracteres."));
    }
    let mut tx = state.db.begin().await?;
    let cid = db::insert_comment(&mut *tx, w.id, m.membership_id, &text).await?;
    db::mark_read(&mut *tx, m.membership_id, &[w.id]).await?;
    let author = runflow_db::auth::user_by_id(&mut *tx, auth.user_id)
        .await?
        .ok_or_else(Problem::unauthorized)?;
    // A student's message is feedback for the staff (pushed by default, opens that conversation in the inbox); the
    // staff's reply is a comment for the student.
    let (recipients, kind, link) = if m.role == "student" {
        (
            db::staff_memberships(&mut *tx, m.club_id).await?,
            "feedback",
            format!("/feedback?workout={}", w.id),
        )
    } else {
        (
            vec![w.athlete_membership_id],
            "comment",
            format!("/workouts/{}", w.id),
        )
    };
    let preview: String = text.chars().take(120).collect();
    for r in recipients {
        runflow_db::notifications::to_member(
            &mut tx,
            r,
            runflow_db::notifications::Notice {
                club_id: m.club_id,
                kind,
                title: &format!("{} comentou no treino", author.name),
                body: Some(&preview),
                link: &link,
            },
        )
        .await?;
    }
    tx.commit().await?;
    let c = db::comments(&state.db, &[w.id])
        .await?
        .into_iter()
        .find(|c| c.id == cid)
        .ok_or_else(Problem::internal)?;
    Ok((StatusCode::CREATED, Json(comment_json(&c))).into_response())
}

#[derive(Deserialize)]
struct InboxQuery {
    filter: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

/// Workouts with conversation or completion activity in the last 30 days (any date: questions on upcoming workouts)
/// or dated in the last 30 days, that have a thread, a completion comment or a warning sign (PSE ≥ 9, felt bad/awful).
async fn inbox(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    Query(q): Query<InboxQuery>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let club = runflow_db::clubs::club(&state.db, m.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    let today = club_today(&club.timezone);
    let ws = workouts::list(
        &state.db,
        m.club_id,
        m.membership_id,
        workouts::Filter {
            from: today - Duration::days(30),
            to: today,
            athlete: None,
            group: None,
            only: None,
            drafts: true,
            activity_since: Some(Utc::now() - Duration::days(30)),
        },
    )
    .await?;
    let ids: Vec<Uuid> = ws.iter().map(|w| w.id).collect();
    let mut by_workout: HashMap<Uuid, Vec<CommentRow>> = HashMap::new();
    for c in db::comments(&state.db, &ids).await? {
        by_workout.entry(c.planned_workout_id).or_default().push(c);
    }
    let reads: HashMap<Uuid, chrono::DateTime<Utc>> =
        db::last_reads(&state.db, m.membership_id, &ids)
            .await?
            .into_iter()
            .collect();
    let mut athletes: HashMap<Uuid, Value> = HashMap::new();
    let mut items = Vec::new();
    for w in ws {
        let cs = by_workout.remove(&w.id).unwrap_or_default();
        let c = w.completion.as_ref();
        let flagged = c.is_some_and(|c| {
            c.rpe.unwrap_or(0) >= 9 || matches!(c.feeling.as_deref(), Some("bad" | "awful"))
        });
        let has_comment = c.is_some_and(|c| c.comment.is_some());
        if !has_comment && cs.is_empty() && !flagged {
            continue;
        }
        let last = cs.last();
        let staff_replied = cs.iter().any(|x| x.author_role != "student");
        let needs_reply = match last {
            Some(l) => l.author_role == "student",
            None => has_comment && !staff_replied,
        };
        // Unread for the caller: a message from someone else (`unread_count`), or the student's completion comment
        // reported after their last read of this workout.
        let read = reads.get(&w.id).copied();
        let unread = w.unread_count > 0
            || c.is_some_and(|c| {
                c.comment.is_some() && c.reported_at.is_some_and(|t| read.is_none_or(|r| t > r))
            });
        if !athletes.contains_key(&w.athlete_membership_id)
            && let Some((_, a)) = workouts::athlete(&state.db, w.athlete_membership_id).await?
        {
            athletes.insert(w.athlete_membership_id, a);
        }
        // Latest activity: the last message or the completion's last change.
        let sort_at = [last.map(|l| l.created_at), c.map(|c| c.updated_at)]
            .into_iter()
            .flatten()
            .max()
            .map(|t| t.to_rfc3339())
            .unwrap_or_else(|| w.date.to_string());
        items.push((
            sort_at,
            needs_reply,
            flagged,
            unread,
            json!({
                "workout": w, "athlete": athletes.get(&w.athlete_membership_id), "last_comment": last.map(comment_json),
                "needs_reply": needs_reply, "unread": unread, "flagged": flagged,
            }),
        ));
    }
    let counts = json!({
        "needs_reply": items.iter().filter(|i| i.1).count(),
        "unread": items.iter().filter(|i| i.3).count(),
        "flagged": items.iter().filter(|i| i.2).count(),
        "all": items.len(),
    });
    let filter = q.filter.as_deref().unwrap_or("needs_reply");
    let mut shown: Vec<_> = items
        .into_iter()
        .filter(|i| match filter {
            "all" => true,
            "unread" => i.3,
            "flagged" => i.2,
            _ => i.1,
        })
        .collect();
    shown.sort_by(|a, b| b.0.cmp(&a.0));
    let start = q
        .cursor
        .as_deref()
        .and_then(|c| c.parse::<usize>().ok())
        .unwrap_or(0);
    let limit = q.limit.unwrap_or(100).clamp(1, 200);
    let next = (start + limit < shown.len()).then(|| (start + limit).to_string());
    let page: Vec<Value> = shown
        .into_iter()
        .skip(start)
        .take(limit)
        .map(|i| i.4)
        .collect();
    Ok(Json(
        json!({ "items": page, "next_cursor": next, "counts": counts }),
    ))
}

async fn read(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    let ids: Vec<Uuid> = match body.get("workout_ids").and_then(Value::as_array) {
        Some(a) => a.iter().filter_map(|v| v.as_str()?.parse().ok()).collect(),
        None => db::club_workout_ids(&state.db, m.club_id).await?,
    };
    // Only this club's workouts.
    let mine: std::collections::HashSet<Uuid> = db::club_workout_ids(&state.db, m.club_id)
        .await?
        .into_iter()
        .collect();
    let ids: Vec<Uuid> = ids.into_iter().filter(|i| mine.contains(i)).collect();
    db::mark_read(&state.db, m.membership_id, &ids).await?;
    Ok(StatusCode::NO_CONTENT)
}
