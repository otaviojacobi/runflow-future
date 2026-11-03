//! S6c training report (W16): compliance and volume per student and per week, consent-aware activity volume,
//! group filter, period limits. Same answers as api/mock/routes/reports.mjs.

mod common;

use axum::http::Method;
use chrono::{Duration, Utc};
use common::TestApp;
use serde_json::{Value, json};
use sqlx::PgPool;

fn day(offset: i64) -> String {
    (Utc::now()
        .with_timezone(&chrono_tz::America::Sao_Paulo)
        .date_naive()
        + Duration::days(offset))
    .format("%Y-%m-%d")
    .to_string()
}

async fn student(
    app: &TestApp,
    club: &str,
    owner: &str,
    email: &str,
    name: &str,
) -> (String, String) {
    let i = app
        .post(
            &format!("/v1/clubs/{club}/invites"),
            Some(owner),
            json!({ "email": email }),
        )
        .await;
    let token = i.body["url"]
        .as_str()
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_string();
    let t = app.sign_in(email).await;
    app.patch("/v1/me", Some(&t), json!({ "name": name }))
        .await
        .ok();
    let m = app
        .post(&format!("/v1/invites/{token}/accept"), Some(&t), json!({}))
        .await;
    (t, m.body["membership"]["id"].as_str().unwrap().to_string())
}

async fn workout(
    app: &TestApp,
    club: &str,
    owner: &str,
    athlete: &str,
    date: &str,
    status: Option<&str>,
) {
    let structure = json!({ "v": 1, "blocks": [{ "kind": "step", "intent": "active", "duration": { "type": "time", "s": 1800 }, "target": { "type": "open" } }] });
    let res = app
        .post(
            &format!("/v1/clubs/{club}/planned-workouts"),
            Some(owner),
            json!({ "athlete_ids": [athlete], "dates": [date], "sport": "run", "title": "Treino", "structure": structure, "est_duration_s": 1800 }),
        )
        .await;
    let id = res.body["items"][0]["id"].as_str().unwrap().to_string();
    if let Some(status) = status {
        sqlx::query(
            "INSERT INTO workout_completions (planned_workout_id, status) VALUES ($1::uuid, $2)",
        )
        .bind(&id)
        .bind(status)
        .execute(app.db())
        .await
        .unwrap();
    }
}

async fn activity(app: &TestApp, email: &str, date: &str) {
    sqlx::query("INSERT INTO activities (id, user_id, source, sport, name, started_at, duration_s, distance_m) SELECT gen_random_uuid(), id, 'manual', 'run', 'Corrida', ($2::date + time '07:00') AT TIME ZONE 'America/Sao_Paulo', 2000, 6000 FROM users WHERE email = $1")
        .bind(email)
        .bind(date)
        .execute(app.db())
        .await
        .unwrap();
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_training_report(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("marcos@email.com").await;
    let club = app
        .post(
            "/v1/clubs",
            Some(&owner),
            json!({ "name": "Pace Forte", "modalities": ["run"] }),
        )
        .await
        .body["club"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (ana, ana_m) = student(&app, &club, &owner, "ana@email.com", "Ana Souza").await;
    let (bia, bia_m) = student(&app, &club, &owner, "bia@email.com", "Bia Lima").await;
    let group = app
        .post(
            &format!("/v1/clubs/{club}/groups"),
            Some(&owner),
            json!({ "name": "Iniciantes" }),
        )
        .await
        .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    app.call(
        Method::PUT,
        &format!("/v1/clubs/{club}/groups/{group}/members"),
        Some(&owner),
        Some(json!({ "membership_ids": [bia_m] })),
        &[],
    )
    .await
    .ok();

    // Ana: completed, partial, missed (no record), today (doesn't count yet). Bia: skipped.
    workout(&app, &club, &owner, &ana_m, &day(-3), Some("completed")).await;
    workout(&app, &club, &owner, &ana_m, &day(-2), Some("partial")).await;
    workout(&app, &club, &owner, &ana_m, &day(-1), None).await;
    workout(&app, &club, &owner, &ana_m, &day(0), None).await;
    workout(&app, &club, &owner, &bia_m, &day(-2), Some("skipped")).await;
    // Activity volume only for students who share training data.
    app.post(
        "/v1/me/consents",
        Some(&ana),
        json!({ "kind": "share_training_data", "club_id": club }),
    )
    .await
    .ok();
    activity(&app, "ana@email.com", &day(-2)).await;
    activity(&app, "bia@email.com", &day(-2)).await;

    let path = format!("/v1/clubs/{club}/reports/training");
    let r = app.get(&path, Some(&owner)).await;
    let body = r.ok();
    assert_eq!(body["from"], day(-27));
    assert_eq!(body["to"], day(0));
    assert!(body["group_id"].is_null());
    assert_eq!(
        body["totals"],
        json!({ "athletes": 2, "planned": 5, "done": 1, "partial": 1, "missed": 2, "compliance_pct": 38,
                "planned_s": 9000, "done_s": 2000, "distance_m": 6000, "sharing": 1 })
    );
    let a = &body["athletes"][0];
    assert_eq!(a["user"]["name"], "Ana Souza");
    assert_eq!(
        (
            a["planned"].clone(),
            a["done"].clone(),
            a["partial"].clone(),
            a["missed"].clone()
        ),
        (json!(4), json!(1), json!(1), json!(1))
    );
    assert_eq!(a["compliance_pct"], 50);
    assert_eq!(a["planned_s"], 7200);
    assert_eq!(a["shares_data"], true);
    assert_eq!(a["activities"], 1);
    assert_eq!(a["done_s"], 2000);
    let b = &body["athletes"][1];
    assert_eq!(b["compliance_pct"], 0);
    assert_eq!(b["group_ids"], json!([group]));
    assert_eq!(b["shares_data"], false);
    assert!(b["activities"].is_null() && b["distance_m"].is_null());

    // Weeks cover the period from its Monday; the last one is the current week.
    let weekly = body["weekly"].as_array().unwrap();
    assert!(weekly.len() >= 4);
    assert_eq!(weekly.last().unwrap()["current"], true);
    assert_eq!(
        weekly
            .iter()
            .map(|w| w["planned"].as_i64().unwrap())
            .sum::<i64>(),
        5
    );
    assert!(weekly[0]["pct"].is_null());

    // Group filter.
    let g = app
        .get(&format!("{path}?group_id={group}"), Some(&owner))
        .await;
    let g: &Value = g.ok();
    assert_eq!(g["group_id"], group.as_str());
    assert_eq!(g["totals"]["athletes"], 1);
    assert_eq!(g["athletes"][0]["membership_id"], bia_m.as_str());

    // A custom period; limits; staff only.
    let past = app
        .get(
            &format!("{path}?from={}&to={}", day(-2), day(-2)),
            Some(&owner),
        )
        .await;
    assert_eq!(past.ok()["totals"]["planned"], 2);
    app.get(
        &format!("{path}?from={}&to={}", day(0), day(-1)),
        Some(&owner),
    )
    .await
    .problem(422, "validation.failed");
    app.get(
        &format!("{path}?from={}&to={}", day(-400), day(0)),
        Some(&owner),
    )
    .await
    .problem(422, "validation.failed");
    app.get(&path, Some(&bia))
        .await
        .problem(403, "auth.forbidden");
}
