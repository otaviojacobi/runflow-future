//! Personal calendar feed (C1): a secret `.ics` URL with planned workouts (all-day), booked classes (timed)
//! and race entries, −30 to +120 days. RFC 5545, same content as the mock.

use aws_lc_rs::{digest, rand};
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Duration, Utc};
use runflow_db::my as db;
use serde_json::{Value, json};

use crate::session::Auth;
use crate::time::club_today;
use crate::{AppState, Problem};

const APP: &str = "https://runflow.club";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/me/calendar-feed",
            get(status).post(regenerate).delete(revoke),
        )
        .route("/ics/{file}", get(ics))
}

fn sha_hex(s: &str) -> String {
    digest::digest(&digest::SHA256, s.as_bytes())
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

async fn status(State(state): State<AppState>, auth: Auth) -> Result<Json<Value>, Problem> {
    let at = db::feed(&state.db, auth.user_id).await?;
    Ok(Json(json!({ "active": at.is_some(), "created_at": at })))
}

async fn regenerate(State(state): State<AppState>, auth: Auth) -> Result<Response, Problem> {
    let mut b = [0u8; 24];
    rand::fill(&mut b).expect("system randomness");
    let token = URL_SAFE_NO_PAD.encode(b);
    let created_at = db::set_feed(&state.db, auth.user_id, &sha_hex(&token)).await?;
    let url = format!("{}/v1/ics/{token}.ics", state.settings.public_api_url);
    let webcal = url
        .replacen("https://", "webcal://", 1)
        .replacen("http://", "webcal://", 1);
    Ok((
        StatusCode::CREATED,
        Json(json!({ "url": url, "webcal_url": webcal, "created_at": created_at })),
    )
        .into_response())
}

async fn revoke(State(state): State<AppState>, auth: Auth) -> Result<StatusCode, Problem> {
    db::delete_feed(&state.db, auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// RFC 5545 text escaping.
fn esc(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace("\r\n", "\\n")
        .replace('\n', "\\n")
}

/// RFC 5545 folding: lines longer than 75 octets continue on the next line after a space.
fn fold(line: &str) -> String {
    let mut out = String::new();
    let mut len = 0;
    for c in line.chars() {
        let n = c.len_utf8();
        if len + n > 75 {
            out.push_str("\r\n ");
            len = 1;
        }
        out.push(c);
        len += n;
    }
    out
}

fn stamp(t: DateTime<Utc>) -> String {
    t.format("%Y%m%dT%H%M%SZ").to_string()
}

async fn ics(State(state): State<AppState>, Path(file): Path<String>) -> Result<Response, Problem> {
    let missing = || {
        Problem::new(
            StatusCode::NOT_FOUND,
            "calendar.not_found",
            "Calendário não encontrado",
            "O link foi desativado. Gere um novo no app.",
        )
    };
    let token = file.strip_suffix(".ics").ok_or_else(missing)?;
    let user = db::feed_owner(&state.db, &sha_hex(token))
        .await?
        .ok_or_else(missing)?;
    let today = club_today("America/Sao_Paulo");
    let (from, to) = (today - Duration::days(30), today + Duration::days(120));
    let mut conn = state.db.acquire().await?;
    let (workouts, classes, races) = db::feed_events(&mut conn, user, from, to).await?;
    let now = stamp(Utc::now());
    let day = |d: chrono::NaiveDate| d.format("%Y%m%d").to_string();
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".into(),
        "PRODID:-//Runflow//Treinos//PT-BR".into(),
        "CALSCALE:GREGORIAN".into(),
        "METHOD:PUBLISH".into(),
        "X-WR-CALNAME:Runflow · Treinos".into(),
        "X-WR-TIMEZONE:America/Sao_Paulo".into(),
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H".into(),
    ];
    for w in workouts {
        lines.extend([
            "BEGIN:VEVENT".to_string(),
            format!("UID:workout-{}@runflow.club", w.id),
            format!("DTSTAMP:{now}"),
            format!("DTSTART;VALUE=DATE:{}", day(w.date)),
            format!("DTEND;VALUE=DATE:{}", day(w.date + Duration::days(1))),
            format!("SUMMARY:{}", esc(&w.title)),
            format!(
                "DESCRIPTION:{}",
                esc(&format!("{} · {APP}/workouts/{}", w.club, w.id))
            ),
            format!("URL:{APP}/workouts/{}", w.id),
            "TRANSP:TRANSPARENT".into(),
            "END:VEVENT".into(),
        ]);
    }
    for c in classes {
        lines.extend([
            "BEGIN:VEVENT".to_string(),
            format!("UID:class-{}@runflow.club", c.id),
            format!("DTSTAMP:{now}"),
            format!("DTSTART:{}", stamp(c.starts_at)),
            format!("DTEND:{}", stamp(c.ends_at)),
            format!("SUMMARY:{}", esc(&format!("Aula: {}", c.name))),
        ]);
        if let Some(l) = c.location {
            lines.push(format!("LOCATION:{}", esc(&l)));
        }
        lines.extend([format!("DESCRIPTION:{}", esc(&c.club)), "END:VEVENT".into()]);
    }
    for r in races {
        lines.extend([
            "BEGIN:VEVENT".to_string(),
            format!("UID:race-{}@runflow.club", r.id),
            format!("DTSTAMP:{now}"),
            format!("DTSTART;VALUE=DATE:{}", day(r.date)),
            format!("DTEND;VALUE=DATE:{}", day(r.date + Duration::days(1))),
            format!("SUMMARY:{}", esc(&format!("Prova: {}", r.name))),
        ]);
        if let Some(p) = r.place {
            lines.push(format!("LOCATION:{}", esc(&p)));
        }
        lines.push("END:VEVENT".into());
    }
    lines.push("END:VCALENDAR".into());
    let body = lines
        .iter()
        .map(|l| fold(l))
        .collect::<Vec<_>>()
        .join("\r\n")
        + "\r\n";
    Ok((
        [
            (header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
            (header::CACHE_CONTROL, "private, max-age=900"),
        ],
        body,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escaping_and_folding() {
        assert_eq!(
            esc("Tiros; 6x1km, pista\nlinha 2"),
            "Tiros\\; 6x1km\\, pista\\nlinha 2"
        );
        let long = format!("SUMMARY:{}", "á".repeat(60));
        let folded = fold(&long);
        assert!(folded.split("\r\n").all(|l| l.len() <= 75), "{folded}");
        assert_eq!(folded.replace("\r\n ", ""), long);
    }
}
