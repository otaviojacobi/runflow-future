//! Assistant (W4, W5, W8, W17; endpoints.md § Assistant), like api/mock/routes/ai.mjs: the rules engine in
//! `runflow_domain::assistant` and the free-text grammar in `runflow_domain::workout_text` behind the
//! provider-agnostic contract (`source: "rules"`). Staff only, 20 requests a minute per user.

use std::collections::HashSet;
use std::time::Duration as StdDuration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use chrono::Duration;
use runflow_db::assistant as db;
use runflow_domain::assistant::{self as rules, Athlete, Feedback, SOURCE};
use runflow_domain::workout::estimate;
use runflow_domain::workout_text;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{Member, STAFF, member};
use crate::body::Body;
use crate::session::Auth;
use crate::time::{club_today, monday_of, parse_date};
use crate::{AppState, Problem};

const PER_MINUTE: u32 = 20;
/// The longest description `/ai/workout` reads.
const MAX_TEXT: usize = 2000;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/ai/workout", post(workout))
        .route("/clubs/{club_id}/ai/week-plan", post(week_plan))
        .route(
            "/clubs/{club_id}/ai/feedback-summary",
            post(feedback_summary),
        )
}

/// Requests per user and minute, counted in Valkey so every API process shares the count (D-047; the monthly cap per
/// plan comes with an LLM). If Valkey can't count, the request goes through: the rules engine is cheap.
async fn guard(state: &AppState, user: Uuid) -> Result<(), Problem> {
    match runflow_kv::rate::hit(
        &state.kv,
        "ai",
        user,
        PER_MINUTE,
        StdDuration::from_secs(60),
    )
    .await
    {
        Ok(None) => Ok(()),
        Ok(Some(_)) => Err(Problem::new(
            StatusCode::TOO_MANY_REQUESTS,
            "ai.rate_limited",
            "Muitos pedidos ao assistente",
            "Espere um minuto e tente de novo.",
        )
        .with_retry_after(60)),
        Err(e) => {
            tracing::warn!(error = %e, "assistant rate limit unavailable; allowing the request");
            Ok(())
        }
    }
}

async fn staff(state: &AppState, auth: &Auth, club_id: &str) -> Result<Member, Problem> {
    let m = member(state, auth, club_id, STAFF).await?;
    guard(state, auth.user_id).await?;
    Ok(m)
}

fn first_name(name: &str) -> &str {
    name.split(' ').next().unwrap_or(name)
}

async fn workout(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    staff(&state, &auth, &club_id).await?;
    let text = body.str("text").unwrap_or_default();
    let text = text.trim();
    let sport = body.str("sport").unwrap_or_else(|| "run".into());
    let chars = text.chars().count();
    if chars < 5 {
        return Err(Problem::field("text", "Descreva o treino em uma frase."));
    }
    if chars > MAX_TEXT {
        return Err(Problem::field("text", "Use até 2.000 caracteres."));
    }
    let parsed = workout_text::parse(text, &sport);
    if parsed.structure["blocks"]
        .as_array()
        .is_none_or(Vec::is_empty)
    {
        return Err(Problem::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ai.not_understood",
            "Não entendi o treino",
            rules::example_for(&sport),
        ));
    }
    let (est_duration_s, est_distance_m) = estimate(&sport, &parsed.structure);
    Ok(Json(json!({
        "name": parsed.name, "sport": sport, "structure": parsed.structure,
        "est_duration_s": est_duration_s, "est_distance_m": est_distance_m, "notes": null,
        "warnings": parsed.warnings, "tags": parsed.tags, "source": SOURCE,
    })))
}

async fn week_plan(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let me = staff(&state, &auth, &club_id).await?;
    let athlete = body
        .str("membership_id")
        .and_then(|s| Uuid::parse_str(&s).ok());
    let found = match athlete {
        Some(a) => db::student_name(&state.db, me.club_id, a)
            .await?
            .map(|name| (a, name)),
        None => None,
    };
    let Some((athlete, name)) = found else {
        return Err(Problem::field("membership_id", "Escolha o aluno."));
    };
    let club = runflow_db::clubs::club(&state.db, me.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    let today = club_today(&club.timezone);
    let monday = monday_of(
        body.str("week_start")
            .as_deref()
            .and_then(parse_date)
            .unwrap_or(today),
    );
    let profile = runflow_db::athletes::profile(&state.db, athlete).await?;
    let p = profile.as_ref();
    let recent = db::statuses(
        &state.db,
        athlete,
        monday - Duration::days(14),
        monday.min(today),
    )
    .await?;
    let taken: HashSet<_> = db::taken_days(&state.db, athlete, monday, monday + Duration::days(6))
        .await?
        .into_iter()
        .collect();
    let input = Athlete {
        first_name: first_name(&name),
        goal: p.and_then(|p| p.goal.as_deref()),
        level: p.and_then(|p| p.level.as_deref()),
        weekly_sessions: p.and_then(|p| p.weekly_sessions),
        goal_date: p.and_then(|p| p.goal_date),
    };
    let plan = rules::week_plan(&input, monday, &recent, &taken).map_err(|_| {
        Problem::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ai.unsupported_goal",
            "Sugestão automática só para corrida, por enquanto",
            "Para natação e força, use as planilhas da biblioteca.",
        )
    })?;
    Ok(Json(json!({
        "membership_id": athlete, "week_start": monday, "rationale": plan.rationale, "items": plan.items, "source": SOURCE,
    })))
}

async fn feedback_summary(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let me = staff(&state, &auth, &club_id).await?;
    let club = runflow_db::clubs::club(&state.db, me.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    let today = club_today(&club.timezone);
    let to = body
        .str("to")
        .as_deref()
        .and_then(parse_date)
        .unwrap_or(today);
    let from = body
        .str("from")
        .as_deref()
        .and_then(parse_date)
        .unwrap_or(to - Duration::days(6));
    // An unknown group id matches no one (like the mock).
    let group = body
        .str("group_id")
        .filter(|g| !g.is_empty())
        .map(|g| Uuid::parse_str(&g).unwrap_or(Uuid::nil()));
    let students = db::students(&state.db, me.club_id, group).await?;
    let rows = db::feedback(&state.db, me.club_id, group, from, to, today).await?;
    let ids: Vec<(String, String)> = rows
        .iter()
        .map(|r| {
            (
                r.membership_id.to_string(),
                r.planned_workout_id.to_string(),
            )
        })
        .collect();
    let items: Vec<Feedback> = rows
        .iter()
        .zip(&ids)
        .map(|(r, (m, w))| Feedback {
            membership_id: m,
            planned_workout_id: w,
            first_name: first_name(&r.name),
            title: &r.title,
            status: r.status.as_deref(),
            rpe: r.rpe,
            comment: r.comment.as_deref(),
        })
        .collect();
    let (summary, highlights) = rules::feedback_summary(&items, students as usize);
    Ok(Json(json!({
        "from": from, "to": to, "summary": summary, "highlights": highlights, "source": SOURCE,
    })))
}
