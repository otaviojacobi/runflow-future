//! Reports (W16; endpoints.md § Reports), like api/mock/routes/reports.mjs: training compliance and volume per
//! student and per week over a period of up to a year. Staff only.

use axum::Router;
use axum::extract::{Path, Query, RawQuery, State};
use axum::response::Response;
use axum::routing::get;
use chrono::Duration;
use runflow_db::reports::{self as db, Period};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{Member, STAFF, member};
use crate::cache;
use crate::session::Auth;
use crate::time::{club_today, monday_of, parse_date};
use crate::{AppState, Problem};

pub fn routes() -> Router<AppState> {
    Router::new().route("/clubs/{club_id}/reports/training", get(training))
}

#[derive(Deserialize)]
struct ReportQuery {
    from: Option<String>,
    to: Option<String>,
    group_id: Option<String>,
}

/// Compliance as the apps compute it: past workouts only, completed = 1, partial = ½ (`None` with no past ones).
fn score(past: i64, points2: i64) -> Option<i64> {
    (past > 0).then(|| ((points2 as f64 / 2.0 / past as f64) * 100.0 + 0.5).floor() as i64)
}

/// Cached in Valkey for a few minutes (D-047): any write to the club refreshes it at once. Every staff member sees
/// the same report, so only the query varies.
async fn training(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    RawQuery(raw): RawQuery,
    Query(q): Query<ReportQuery>,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, STAFF).await?;
    cache::json(
        &state,
        "reports",
        m.club_id,
        &raw.unwrap_or_default(),
        cache::REPORTS_TTL,
        report(&state, &m, q),
    )
    .await
}

async fn report(state: &AppState, m: &Member, q: ReportQuery) -> Result<Value, Problem> {
    let club = runflow_db::clubs::club(&state.db, m.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    let today = club_today(&club.timezone);
    let to = q.to.as_deref().and_then(parse_date).unwrap_or(today);
    let from = q
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
    // An unknown group id matches no one (like the mock).
    let group = group_text
        .as_deref()
        .map(|g| Uuid::parse_str(g).unwrap_or(Uuid::nil()));
    let period = Period {
        from,
        to,
        today,
        timezone: &club.timezone,
    };

    let rows = db::athletes(&state.db, m.club_id, group, &period).await?;
    let weeks = db::weeks(&state.db, m.club_id, group, &period).await?;

    let athletes: Vec<Value> = rows
        .iter()
        .map(|a| {
            json!({
                "membership_id": a.membership_id, "user": a.user, "group_ids": a.group_ids,
                "planned": a.planned, "done": a.done, "partial": a.partial, "missed": a.missed,
                "compliance_pct": score(a.past, a.points2), "planned_s": a.planned_s,
                "shares_data": a.shares_data, "activities": a.activities, "done_s": a.done_s, "distance_m": a.distance_m,
            })
        })
        .collect();

    let current = monday_of(today);
    let mut weekly = Vec::new();
    let mut mon = monday_of(from);
    while mon <= to {
        let w = weeks.iter().find(|w| w.week_start == mon);
        weekly.push(json!({
            "week_start": mon,
            "pct": w.and_then(|w| score(w.past, w.points2)),
            "planned": w.map_or(0, |w| w.planned),
            "done": w.map_or(0, |w| w.done),
            "current": mon == current,
        }));
        mon += Duration::days(7);
    }

    let sum = |f: fn(&db::AthleteRow) -> i64| rows.iter().map(f).sum::<i64>();
    let totals = json!({
        "athletes": rows.len(),
        "planned": sum(|a| a.planned),
        "done": sum(|a| a.done),
        "partial": sum(|a| a.partial),
        "missed": sum(|a| a.missed),
        "compliance_pct": score(sum(|a| a.past), sum(|a| a.points2)),
        "planned_s": sum(|a| a.planned_s),
        "done_s": sum(|a| a.done_s.unwrap_or(0)),
        "distance_m": sum(|a| a.distance_m.unwrap_or(0)),
        "sharing": rows.iter().filter(|a| a.shares_data).count(),
    });
    Ok(json!({
        "from": from, "to": to, "group_id": group_text,
        "totals": totals, "weekly": weekly, "athletes": athletes,
    }))
}
