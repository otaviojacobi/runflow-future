//! S4: the student side (/my/*), workout threads, the trainer's feedback inbox.

mod common;

use axum::http::Method;
use chrono::{Datelike, Duration, Utc};
use common::TestApp;
use serde_json::json;
use sqlx::PgPool;

struct Club {
    id: String,
    owner: String,
    ana: (String, String),
    bia: (String, String),
}

fn token_of(url: &str) -> String {
    url.rsplit('/').next().unwrap().to_string()
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
    let t = app.sign_in(email).await;
    app.patch("/v1/me", Some(&t), json!({ "name": name }))
        .await
        .ok();
    let m = app
        .post(
            &format!(
                "/v1/invites/{}/accept",
                token_of(i.body["url"].as_str().unwrap())
            ),
            Some(&t),
            json!({}),
        )
        .await;
    (t, m.body["membership"]["id"].as_str().unwrap().to_string())
}

async fn setup(app: &TestApp) -> Club {
    let owner = app.sign_in("marcos@email.com").await;
    let id = app
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
    let ana = student(app, &id, &owner, "ana@email.com", "Ana Souza").await;
    let bia = student(app, &id, &owner, "bia@email.com", "Bia Lima").await;
    Club {
        id,
        owner,
        ana,
        bia,
    }
}

/// Today in the club's timezone (São Paulo), as the API sees it.
fn today() -> chrono::NaiveDate {
    Utc::now()
        .with_timezone(&chrono_tz::America::Sao_Paulo)
        .date_naive()
}

fn day(offset: i64) -> String {
    (today() + Duration::days(offset))
        .format("%Y-%m-%d")
        .to_string()
}

async fn assign(app: &TestApp, c: &Club, athlete: &str, date: &str, title: &str) -> String {
    let structure = json!({ "v": 1, "blocks": [
        { "kind": "step", "intent": "warmup", "duration": { "type": "time", "s": 600 }, "target": { "type": "zone", "metric": "pace", "zone": 2 } },
        { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 8000 }, "target": { "type": "zone", "metric": "hr", "zone": 3 } }
    ] });
    let res = app
        .post(&format!("/v1/clubs/{}/planned-workouts", c.id), Some(&c.owner), json!({ "athlete_ids": [athlete], "dates": [date], "sport": "run", "title": title, "structure": structure, "est_distance_m": 10000, "est_duration_s": 3600 }))
        .await;
    res.body["items"][0]["id"].as_str().unwrap().to_string()
}

async fn activity(app: &TestApp, email: &str, date: &str, sport: &str, distance: i32) -> String {
    let id = uuid::Uuid::now_v7();
    sqlx::query("INSERT INTO activities (id, user_id, source, sport, name, started_at, duration_s, distance_m) SELECT $1, id, 'manual', $3, 'Corrida da manhã', ($4::date + time '09:00') AT TIME ZONE 'America/Sao_Paulo', 3000, $5 FROM users WHERE email = $2")
        .bind(id)
        .bind(email)
        .bind(sport)
        .bind(date)
        .bind(distance)
        .execute(app.db())
        .await
        .unwrap();
    id.to_string()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_student_sees_their_workouts_with_personal_targets_and_gives_feedback(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let w = assign(&app, &c, &c.ana.1, &day(0), "Rodagem 10 km").await;
    assign(&app, &c, &c.bia.1, &day(0), "Treino da Bia").await;
    let my = format!("/v1/clubs/{}/my/workouts", c.id);

    app.get(
        &format!("{my}?from={}&to={}", day(0), day(0)),
        Some(&c.owner),
    )
    .await
    .problem(403, "auth.forbidden");
    app.get(&my, Some(&c.ana.0))
        .await
        .problem(422, "validation.failed");
    let list = app
        .get(
            &format!("{my}?from={}&to={}", day(-7), day(7)),
            Some(&c.ana.0),
        )
        .await;
    assert_eq!(
        list.ok()["items"].as_array().unwrap().len(),
        1,
        "only her own"
    );
    let bias = app
        .get(
            &format!(
                "/v1/clubs/{}/planned-workouts?from={}&to={}&athlete_id={}",
                c.id,
                day(0),
                day(0),
                c.bia.1
            ),
            Some(&c.owner),
        )
        .await
        .body["items"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    app.get(&format!("{my}/{bias}"), Some(&c.ana.0))
        .await
        .problem(404, "workout.not_found");

    // Personal targets from her zones; activities around the day; the coach.
    sqlx::query("INSERT INTO zones (membership_id, kind, source, bounds, valid_from) VALUES ($1::uuid, 'hr', 'test', '[{\"zone\":3,\"min\":150,\"max\":162}]', current_date), ($1::uuid, 'pace', 'race', '[{\"zone\":2,\"min\":330,\"max\":350}]', current_date)")
        .bind(&c.ana.1)
        .execute(app.db())
        .await
        .unwrap();
    let run = activity(&app, "ana@email.com", &day(0), "run", 9000).await;
    activity(&app, "ana@email.com", &day(-1), "bike", 30000).await;
    let detail = app.get(&format!("{my}/{w}"), Some(&c.ana.0)).await;
    let d = detail.ok();
    assert_eq!(
        d["structure"]["blocks"][0]["target"]["resolved"],
        json!({ "min_s": 330, "max_s": 350 })
    );
    assert_eq!(
        d["structure"]["blocks"][1]["target"]["resolved"],
        json!({ "min": 150, "max": 162 })
    );
    assert_eq!(d["candidate_activities"].as_array().unwrap().len(), 2);
    assert_eq!(d["coach"]["email"], "marcos@email.com");

    // Feedback: validation, then a completion matched to the same-day run (9 of 10 km = 90%).
    let done = format!("{my}/{w}/completion");
    let bad = app
        .call(
            Method::PUT,
            &done,
            Some(&c.ana.0),
            Some(json!({ "rpe": 11, "feeling": "sleepy" })),
            &[],
        )
        .await;
    assert_eq!(
        bad.problem(422, "validation.failed")["errors"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    // The same-day pick only takes an activity Ana shares with the club (D-011), as the welcome flow asks.
    app.post(
        "/v1/me/consents",
        Some(&c.ana.0),
        json!({ "kind": "share_training_data", "club_id": c.id }),
    )
    .await
    .ok();
    let res = app.call(Method::PUT, &done, Some(&c.ana.0), Some(json!({ "status": "completed", "rpe": 7, "feeling": "good", "comment": "Pernas pesadas no fim" })), &[]).await;
    let comp = &res.ok()["completion"];
    assert_eq!(
        (
            comp["activity_id"].as_str(),
            comp["compliance_pct"].as_i64(),
            comp["rpe"].as_i64()
        ),
        (Some(run.as_str()), Some(90), Some(7))
    );
    let n = app.get("/v1/me/notifications", Some(&c.owner)).await;
    assert_eq!(
        (
            n.ok()["items"][0]["title"].as_str(),
            n.body["items"][0]["body"].as_str()
        ),
        (
            Some("Ana Souza registrou o treino"),
            Some("Pernas pesadas no fim")
        )
    );
    app.call(
        Method::PUT,
        &done,
        Some(&c.ana.0),
        Some(json!({ "status": "partial" })),
        &[],
    )
    .await
    .ok();
    let feedback_notes = app.get("/v1/me/notifications", Some(&c.owner)).await.body["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["kind"] == "feedback")
        .count();
    assert_eq!(feedback_notes, 1, "only the first completion notifies");
    let foreign = activity(&app, "bia@email.com", &day(0), "run", 5000).await;
    app.call(
        Method::PUT,
        &done,
        Some(&c.ana.0),
        Some(json!({ "status": "completed", "activity_id": foreign })),
        &[],
    )
    .await
    .problem(422, "validation.failed");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn todays_summary_counts_the_week_and_the_streak(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let monday = today() - Duration::days(today().weekday().num_days_from_monday() as i64);
    let d = |n: i64| (monday + Duration::days(n)).format("%Y-%m-%d").to_string();
    let this_week = assign(&app, &c, &c.ana.1, &d(0), "Esta semana").await;
    assign(&app, &c, &c.ana.1, &d(2), "Esta semana 2").await;
    for back in [7, 14] {
        let w = assign(&app, &c, &c.ana.1, &d(-back), "Passado").await;
        sqlx::query("INSERT INTO workout_completions (planned_workout_id, status) VALUES ($1::uuid, 'completed')").bind(&w).execute(app.db()).await.unwrap();
    }
    assign(&app, &c, &c.ana.1, &d(-21), "Sem feito").await;
    sqlx::query(
        "INSERT INTO workout_completions (planned_workout_id, status) VALUES ($1::uuid, 'partial')",
    )
    .bind(&this_week)
    .execute(app.db())
    .await
    .unwrap();
    activity(&app, "ana@email.com", &day(0), "run", 5000).await;

    let s = app
        .get(&format!("/v1/clubs/{}/my/summary", c.id), Some(&c.ana.0))
        .await;
    let s = s.ok();
    assert_eq!(
        (
            s["week"]["planned"].as_i64(),
            s["week"]["done"].as_i64(),
            s["week"]["distance_m"].as_i64()
        ),
        (Some(2), Some(1), Some(20000))
    );
    assert_eq!(
        s["streak_weeks"], 2,
        "two past weeks done, then a week without"
    );
    assert_eq!(
        (
            s["shares_data"].as_bool(),
            s["last_activity"]["distance_m"].as_i64(),
            s.get("next_class").is_none()
        ),
        (Some(false), Some(5000), true)
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn threads_notify_the_other_side_and_feed_the_inbox(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let w = assign(&app, &c, &c.ana.1, &day(-1), "Tiros").await;
    let flagged = assign(&app, &c, &c.bia.1, &day(-2), "Longão").await;
    let thread = format!("/v1/clubs/{}/planned-workouts/{w}/comments", c.id);

    app.post(&thread, Some(&c.bia.0), json!({ "body": "oi" }))
        .await
        .problem(404, "workout.not_found");
    app.post(&thread, Some(&c.ana.0), json!({ "body": "  " }))
        .await
        .problem(422, "validation.failed");
    let posted = app
        .post(
            &thread,
            Some(&c.ana.0),
            json!({ "body": "Posso trocar para amanhã?" }),
        )
        .await;
    assert_eq!(
        (
            posted.status.as_u16(),
            posted.body["author"]["role"].as_str()
        ),
        (201, Some("student"))
    );
    let n = app.get("/v1/me/notifications", Some(&c.owner)).await;
    assert_eq!(
        (
            n.ok()["items"][0]["kind"].as_str(),
            n.body["items"][0]["title"].as_str(),
            n.body["items"][0]["link"].as_str()
        ),
        (
            Some("feedback"),
            Some("Ana Souza comentou no treino"),
            Some(format!("/feedback?workout={w}").as_str())
        )
    );

    // Bia felt awful: flagged without any comment.
    sqlx::query("INSERT INTO workout_completions (planned_workout_id, status, rpe, feeling) VALUES ($1::uuid, 'completed', 9, 'awful')").bind(&flagged).execute(app.db()).await.unwrap();
    let inbox = format!("/v1/clubs/{}/feedback", c.id);
    let first = app.get(&inbox, Some(&c.owner)).await;
    assert_eq!(
        first.ok()["counts"],
        json!({ "needs_reply": 1, "unread": 1, "flagged": 1, "all": 2 })
    );
    assert_eq!(first.body["items"][0]["workout"]["id"], w);
    assert_eq!(
        first.body["items"][0]["last_comment"]["body"],
        "Posso trocar para amanhã?"
    );
    assert_eq!(
        app.get(&format!("{inbox}?filter=flagged"), Some(&c.owner))
            .await
            .ok()["items"][0]["athlete"]["user"]["name"],
        "Bia Lima"
    );
    app.get(&inbox, Some(&c.ana.0))
        .await
        .problem(403, "auth.forbidden");

    // The trainer reads and replies: no longer waiting; Ana is notified.
    let read = app.get(&thread, Some(&c.owner)).await;
    assert_eq!(read.ok()["items"].as_array().unwrap().len(), 1);
    app.post(&thread, Some(&c.owner), json!({ "body": "Pode sim!" }))
        .await
        .ok();
    assert_eq!(
        app.get("/v1/me/notifications", Some(&c.ana.0)).await.ok()["items"][0]["link"],
        format!("/workouts/{w}?conversa=1")
    );
    let after = app.get(&inbox, Some(&c.owner)).await;
    assert_eq!(
        after.ok()["counts"],
        json!({ "needs_reply": 0, "unread": 0, "flagged": 1, "all": 2 })
    );

    // Ana has an unread reply until she opens the thread.
    let mine = app
        .get(
            &format!(
                "/v1/clubs/{}/my/workouts?from={}&to={}",
                c.id,
                day(-1),
                day(-1)
            ),
            Some(&c.ana.0),
        )
        .await;
    assert_eq!(
        (
            mine.ok()["items"][0]["comments_count"].as_i64(),
            mine.body["items"][0]["unread_count"].as_i64()
        ),
        (Some(2), Some(1))
    );
    app.get(&thread, Some(&c.ana.0)).await.ok();
    let mine = app
        .get(
            &format!(
                "/v1/clubs/{}/my/workouts?from={}&to={}",
                c.id,
                day(-1),
                day(-1)
            ),
            Some(&c.ana.0),
        )
        .await;
    assert_eq!(mine.ok()["items"][0]["unread_count"], 0);

    assert_eq!(
        app.post(&format!("{inbox}/read"), Some(&c.owner), json!({}))
            .await
            .status,
        204
    );
}

/// A question on an UPCOMING workout reaches the staff: a `feedback` notification (pushed by default) that opens it,
/// the inbox (by activity, not by the workout's date) and the Feedbacks count in `/me` (unread for that person:
/// opening the conversation clears it, without replying).
#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn a_question_on_an_upcoming_workout_reaches_the_staff(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    // Students see future weeks right away (new clubs release weekly, D-031).
    app.patch(
        &format!("/v1/clubs/{}", c.id),
        Some(&c.owner),
        json!({ "release_mode": "immediate" }),
    )
    .await
    .ok();
    let w = assign(&app, &c, &c.ana.1, &day(9), "Intervalado").await;
    app.post(
        "/v1/me/push-tokens",
        Some(&c.owner),
        json!({ "platform": "android", "token": "ExponentPushToken[owner-phone]" }),
    )
    .await
    .ok();
    let count = |me: &serde_json::Value| me["memberships"][0]["unread"]["feedback"].as_i64();
    assert_eq!(count(app.get("/v1/me", Some(&c.owner)).await.ok()), Some(0));

    let thread = format!("/v1/clubs/{}/planned-workouts/{w}/comments", c.id);
    app.post(
        &thread,
        Some(&c.ana.0),
        json!({ "body": "Posso fazer os tiros na esteira?" }),
    )
    .await
    .ok();

    let n = app.get("/v1/me/notifications", Some(&c.owner)).await;
    assert_eq!(
        (
            n.ok()["items"][0]["kind"].as_str(),
            n.body["items"][0]["link"].as_str()
        ),
        (
            Some("feedback"),
            Some(format!("/feedback?workout={w}").as_str())
        )
    );
    let pushed: Option<chrono::DateTime<Utc>> = sqlx::query_scalar(
        "SELECT push_at FROM notifications WHERE kind = 'feedback' ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_one(app.db())
    .await
    .unwrap();
    assert!(pushed.is_some(), "feedback is pushed by default for staff");

    let inbox = format!("/v1/clubs/{}/feedback", c.id);
    let waiting = app.get(&inbox, Some(&c.owner)).await;
    assert_eq!(waiting.ok()["counts"]["needs_reply"], 1);
    assert_eq!(waiting.body["counts"]["unread"], 1);
    assert_eq!(waiting.body["items"][0]["workout"]["id"], w);
    assert_eq!(
        (
            &waiting.body["items"][0]["needs_reply"],
            &waiting.body["items"][0]["unread"]
        ),
        (&json!(true), &json!(true))
    );
    assert_eq!(count(app.get("/v1/me", Some(&c.owner)).await.ok()), Some(1));
    assert_eq!(
        count(app.get("/v1/me", Some(&c.ana.0)).await.ok()),
        Some(0),
        "students have no Feedbacks count"
    );

    // The trainer only OPENS the conversation: read, so the count clears, though it still waits for a reply.
    app.get(&thread, Some(&c.owner)).await.ok();
    assert_eq!(count(app.get("/v1/me", Some(&c.owner)).await.ok()), Some(0));
    let opened = app.get(&inbox, Some(&c.owner)).await;
    assert_eq!(
        (
            &opened.ok()["counts"]["unread"],
            &opened.body["counts"]["needs_reply"]
        ),
        (&json!(0), &json!(1))
    );

    // A second question makes it unread again; the inbox's read call (what the apps send on open) clears it too.
    app.post(
        &thread,
        Some(&c.ana.0),
        json!({ "body": "E o aquecimento?" }),
    )
    .await
    .ok();
    assert_eq!(count(app.get("/v1/me", Some(&c.owner)).await.ok()), Some(1));
    app.post(
        &format!("{inbox}/read"),
        Some(&c.owner),
        json!({ "workout_ids": [w] }),
    )
    .await;
    assert_eq!(count(app.get("/v1/me", Some(&c.owner)).await.ok()), Some(0));

    // The trainer answers: nothing waits any more, and the student hears it as a comment.
    app.post(
        &thread,
        Some(&c.owner),
        json!({ "body": "Pode, mesmo ritmo." }),
    )
    .await
    .ok();
    assert_eq!(
        app.get(&inbox, Some(&c.owner)).await.ok()["counts"]["needs_reply"],
        0
    );
    assert_eq!(count(app.get("/v1/me", Some(&c.owner)).await.ok()), Some(0));
    assert_eq!(
        app.get("/v1/me/notifications", Some(&c.ana.0)).await.ok()["items"][0]["kind"],
        "comment"
    );
}

/// Regression (founder, 2026-11-04): the owner answered a student's question on QA and she didn't see it (her open
/// conversation never refreshed; the apps now refetch it every 10 s). What the apps rely on: the student's next read
/// of the thread has every staff reply, the owner's and a trainer's, with their roles, in order; her workout counts
/// them as unread until she reads it ("Nova resposta" on Hoje/Agenda); the reply's notification opens the workout at
/// its conversation.
#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_student_sees_every_staff_reply_in_the_workout_conversation(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let invite = app
        .post(
            &format!("/v1/clubs/{}/invites", c.id),
            Some(&c.owner),
            json!({ "email": "julia@email.com", "role": "trainer" }),
        )
        .await;
    let julia = app.sign_in("julia@email.com").await;
    app.post(
        &format!(
            "/v1/invites/{}/accept",
            token_of(invite.ok()["url"].as_str().unwrap())
        ),
        Some(&julia),
        json!({}),
    )
    .await
    .ok();
    let w = assign(&app, &c, &c.ana.1, &day(0), "Rodagem leve 6 km").await;
    let thread = format!("/v1/clubs/{}/planned-workouts/{w}/comments", c.id);
    app.post(
        &thread,
        Some(&c.ana.0),
        json!({ "body": "Colocar rotas com banheiro?" }),
    )
    .await
    .ok();
    // She has the conversation open (her app read it once), then the staff answer.
    assert_eq!(
        app.get(&thread, Some(&c.ana.0)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    for (who, body) in [
        (&c.owner, "Vamos ajustar o próximo treino."),
        (&julia, "Separei duas rotas com banheiro."),
    ] {
        app.post(&thread, Some(who), json!({ "body": body }))
            .await
            .ok();
    }

    // Until she reads it, her calendar marks the workout ("Nova resposta").
    let calendar = format!(
        "/v1/clubs/{}/my/workouts?from={}&to={}",
        c.id,
        day(0),
        day(0)
    );
    let unread = |v: &serde_json::Value| {
        v["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == w)
            .map(|x| x["unread_count"].as_i64())
    };
    assert_eq!(
        unread(app.get(&calendar, Some(&c.ana.0)).await.ok()),
        Some(Some(2))
    );

    // Her next read (the apps poll it while the conversation is on screen) has both replies, with their roles.
    let read = app.get(&thread, Some(&c.ana.0)).await;
    let got: Vec<(&str, &str)> = read.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| {
            (
                x["author"]["role"].as_str().unwrap(),
                x["body"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        got,
        vec![
            ("student", "Colocar rotas com banheiro?"),
            ("owner", "Vamos ajustar o próximo treino."),
            ("trainer", "Separei duas rotas com banheiro."),
        ]
    );
    assert_eq!(
        unread(app.get(&calendar, Some(&c.ana.0)).await.ok()),
        Some(Some(0))
    );

    // The reply's notification opens the workout at its conversation.
    let n = app.get("/v1/me/notifications", Some(&c.ana.0)).await;
    assert_eq!(
        (
            n.ok()["items"][0]["kind"].as_str(),
            n.body["items"][0]["link"].as_str()
        ),
        (
            Some("comment"),
            Some(format!("/workouts/{w}?conversa=1").as_str())
        )
    );
}
