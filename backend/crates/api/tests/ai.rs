//! S6c assistant (W4, W5, W8, W17): the rules engine behind the contract: description → workout, week plan from
//! the profile, feedback summary, staff only, rate limit. Same answers as api/mock/routes/ai.mjs.

mod common;

use chrono::{Datelike, Duration, NaiveDate, Utc};
use common::TestApp;
use serde_json::json;
use sqlx::PgPool;

fn today() -> NaiveDate {
    Utc::now()
        .with_timezone(&chrono_tz::America::Sao_Paulo)
        .date_naive()
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

async fn club(app: &TestApp, owner: &str) -> String {
    app.post(
        "/v1/clubs",
        Some(owner),
        json!({ "name": "Pace Forte", "modalities": ["run"] }),
    )
    .await
    .body["club"]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn workout(
    app: &TestApp,
    club: &str,
    owner: &str,
    athlete: &str,
    date: NaiveDate,
    done: Option<(&str, i32, &str)>,
) {
    let structure = json!({ "v": 1, "blocks": [{ "kind": "step", "intent": "active", "duration": { "type": "time", "s": 1800 }, "target": { "type": "open" } }] });
    let res = app
        .post(
            &format!("/v1/clubs/{club}/planned-workouts"),
            Some(owner),
            json!({ "athlete_ids": [athlete], "dates": [date.to_string()], "sport": "run", "title": "Tiros", "structure": structure }),
        )
        .await;
    let id = res.body["items"][0]["id"].as_str().unwrap().to_string();
    if let Some((status, rpe, comment)) = done {
        sqlx::query("INSERT INTO workout_completions (planned_workout_id, status, rpe, comment) VALUES ($1::uuid, $2, $3, $4)")
            .bind(&id)
            .bind(status)
            .bind(rpe)
            .bind(comment)
            .execute(app.db())
            .await
            .unwrap();
    }
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn a_description_becomes_a_workout(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("marcos@email.com").await;
    let id = club(&app, &owner).await;
    let (ana, _) = student(&app, &id, &owner, "ana@email.com", "Ana Souza").await;
    let path = format!("/v1/clubs/{id}/ai/workout");

    let w = app
        .post(
            &path,
            Some(&owner),
            json!({ "text": "15 min de aquecimento, 6 tiros de 800 m a 4:10 com 2 min de trote e 10 min de desaquecimento", "sport": "run" }),
        )
        .await;
    let w = w.ok();
    assert_eq!(w["name"], "Intervalado 6×800 m");
    assert_eq!(w["source"], "rules");
    assert_eq!(w["est_duration_s"], 3420);
    assert_eq!(w["est_distance_m"], 11100);
    assert_eq!(w["structure"]["blocks"][1]["count"], 6);
    assert!(w["notes"].is_null());

    let gym = app
        .post(
            &path,
            Some(&owner),
            json!({ "text": "agachamento 4x10 com 40 kg, remada 3x12", "sport": "strength" }),
        )
        .await;
    assert_eq!(gym.ok()["name"], "Força: Agachamento + Remada");
    assert!(gym.body["est_distance_m"].is_null());

    app.post(&path, Some(&owner), json!({ "text": "oi" }))
        .await
        .problem(422, "validation.failed");
    let lost = app
        .post(&path, Some(&owner), json!({ "text": "treino legal hoje" }))
        .await;
    lost.problem(422, "ai.not_understood");
    assert!(
        lost.body["detail"]
            .as_str()
            .unwrap()
            .starts_with("Tente algo como")
    );
    app.post(&path, Some(&ana), json!({ "text": "40 min z3" }))
        .await
        .problem(403, "auth.forbidden");

    // 20 a minute per user, rejected requests included (4 used above).
    for _ in 0..16 {
        app.post(&path, Some(&owner), json!({ "text": "40 min z3" }))
            .await
            .ok();
    }
    let limited = app
        .post(&path, Some(&owner), json!({ "text": "40 min z3" }))
        .await;
    limited.problem(429, "ai.rate_limited");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn a_week_plan_from_the_profile(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("marcos@email.com").await;
    let id = club(&app, &owner).await;
    let (_, ana) = student(&app, &id, &owner, "ana@email.com", "Ana Souza").await;
    let (_, bia) = student(&app, &id, &owner, "bia@email.com", "Bia Lima").await;
    let path = format!("/v1/clubs/{id}/ai/week-plan");
    let next = today() - Duration::days(today().weekday().num_days_from_monday() as i64)
        + Duration::days(7);

    // Ana: intermediate, 4 a week, half marathon; Tuesday already has a workout.
    sqlx::query("INSERT INTO athlete_profiles (membership_id, goal, level, weekly_sessions) VALUES ($1::uuid, '21k', 'intermediate', 4)")
        .bind(&ana)
        .execute(app.db())
        .await
        .unwrap();
    workout(&app, &id, &owner, &ana, next + Duration::days(1), None).await;
    let plan = app
        .post(
            &path,
            Some(&owner),
            json!({ "membership_id": ana, "week_start": (next + Duration::days(3)).to_string() }),
        )
        .await;
    let plan = plan.ok();
    assert_eq!(plan["week_start"], next.to_string());
    assert_eq!(plan["source"], "rules");
    assert_eq!(
        plan["rationale"][0],
        "Ana: objetivo meia maratona, nível intermediário, 4 treinos por semana."
    );
    assert_eq!(
        plan["rationale"].as_array().unwrap().last().unwrap(),
        "Um dia já tem treino: sugeri só os outros."
    );
    let titles: Vec<&str> = plan["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["title"].as_str().unwrap())
        .collect();
    assert_eq!(
        titles,
        ["Rodagem leve", "Ritmo forte contínuo", "Longão 16 km"]
    );
    assert!(plan["items"][0]["est_duration_s"].as_i64().unwrap() > 0);

    // Swimming goals aren't supported; the athlete must be an active student.
    sqlx::query("INSERT INTO athlete_profiles (membership_id, goal) VALUES ($1::uuid, 'swim')")
        .bind(&bia)
        .execute(app.db())
        .await
        .unwrap();
    app.post(&path, Some(&owner), json!({ "membership_id": bia }))
        .await
        .problem(422, "ai.unsupported_goal");
    app.post(&path, Some(&owner), json!({ "membership_id": "x" }))
        .await
        .problem(422, "validation.failed");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_feedback_summary(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("marcos@email.com").await;
    let id = club(&app, &owner).await;
    let (_, ana) = student(&app, &id, &owner, "ana@email.com", "Ana Souza").await;
    let (_, bia) = student(&app, &id, &owner, "bia@email.com", "Bia Lima").await;
    let d = |n: i64| today() - Duration::days(n);
    workout(
        &app,
        &id,
        &owner,
        &ana,
        d(3),
        Some(("completed", 9, "Senti dor no joelho")),
    )
    .await;
    workout(
        &app,
        &id,
        &owner,
        &ana,
        d(2),
        Some(("completed", 6, "Tudo certo")),
    )
    .await;
    workout(&app, &id, &owner, &bia, d(3), None).await;
    workout(&app, &id, &owner, &bia, d(1), None).await;
    // Today's workout doesn't count yet.
    workout(&app, &id, &owner, &bia, d(0), None).await;

    let s = app
        .post(
            &format!("/v1/clubs/{id}/ai/feedback-summary"),
            Some(&owner),
            json!({}),
        )
        .await;
    let s = s.ok();
    assert_eq!(s["to"], today().to_string());
    assert_eq!(s["from"], d(6).to_string());
    assert_eq!(
        s["summary"],
        json!([
            "2 de 4 treinos feitos (50%) por 2 alunos.",
            "Esforço percebido médio: PSE 7,5, alto para a fase: vale aliviar a próxima semana.",
            "3 pontos pedem atenção, abaixo."
        ])
    );
    let kinds: Vec<&str> = s["highlights"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["pain", "rpe", "missed"]);
    assert_eq!(s["highlights"][0]["membership_id"], ana.as_str());
    assert_eq!(
        s["highlights"][2]["text"],
        "Bia não fez 2 treinos no período."
    );
}
