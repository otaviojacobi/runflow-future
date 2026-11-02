//! S4: trainer views of students (summary, detail, profile, zones, activities), the student's profile, the dashboard.

mod common;

use axum::http::Method;
use chrono::{Datelike, Duration, Utc};
use common::TestApp;
use serde_json::{Value, json};
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

/// A workout for `athlete` on `date`, optionally completed with `status` / `rpe` / `comment`.
async fn workout(
    app: &TestApp,
    c: &Club,
    athlete: &str,
    date: &str,
    done: Option<(&str, Option<i32>, Option<&str>)>,
) -> String {
    let structure = json!({ "v": 1, "blocks": [{ "kind": "step", "intent": "active", "duration": { "type": "time", "s": 1800 }, "target": { "type": "open" } }] });
    let res = app.post(&format!("/v1/clubs/{}/planned-workouts", c.id), Some(&c.owner), json!({ "athlete_ids": [athlete], "dates": [date], "sport": "run", "title": "Treino", "structure": structure, "est_duration_s": 1800, "est_distance_m": 5000 })).await;
    let id = res.body["items"][0]["id"].as_str().unwrap().to_string();
    if let Some((status, rpe, comment)) = done {
        sqlx::query("INSERT INTO workout_completions (planned_workout_id, status, rpe, comment) VALUES ($1::uuid, $2, $3, $4)").bind(&id).bind(status).bind(rpe).bind(comment).execute(app.db()).await.unwrap();
    }
    id
}

async fn activity(app: &TestApp, email: &str, date: &str, source: &str) {
    sqlx::query("INSERT INTO activities (id, user_id, source, external_id, sport, name, started_at, duration_s, distance_m) SELECT gen_random_uuid(), id, $3, gen_random_uuid()::text, 'run', 'Corrida', ($2::date + time '07:00') AT TIME ZONE 'America/Sao_Paulo', 2000, 6000 FROM users WHERE email = $1")
        .bind(email)
        .bind(date)
        .bind(source)
        .execute(app.db())
        .await
        .unwrap();
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn students_list_and_detail_respect_consent(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    workout(
        &app,
        &c,
        &c.ana.1,
        &day(-3),
        Some(("completed", Some(6), None)),
    )
    .await;
    workout(&app, &c, &c.ana.1, &day(-2), Some(("partial", None, None))).await;
    workout(&app, &c, &c.ana.1, &day(-1), None).await;
    activity(&app, "ana@email.com", &day(-1), "manual").await;
    activity(&app, "ana@email.com", &day(0), "strava").await;
    let path = format!("/v1/clubs/{}/athletes", c.id);

    app.get(&path, Some(&c.ana.0))
        .await
        .problem(403, "auth.forbidden");
    let list = app.get(&path, Some(&c.owner)).await;
    let items = list.ok()["items"].as_array().unwrap().clone();
    assert_eq!(
        items
            .iter()
            .map(|a| a["user"]["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["Ana Souza", "Bia Lima"]
    );
    let ana = &items[0];
    assert_eq!(ana["compliance_pct"], 50, "(1 + 0.5 + 0) / 3");
    assert_eq!(
        (
            ana["last_activity_at"].clone(),
            ana["shares_data"].as_bool(),
            ana["strava"].as_str()
        ),
        (Value::Null, Some(false), Some("none"))
    );
    assert_eq!(
        app.get(&format!("{path}?q=bia"), Some(&c.owner)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // With consent: the last activity shows (but not Strava's without its own consent).
    app.post(
        "/v1/me/consents",
        Some(&c.ana.0),
        json!({ "kind": "share_training_data", "club_id": c.id }),
    )
    .await
    .ok();
    let detail = app
        .get(&format!("{path}/{}", c.ana.1), Some(&c.owner))
        .await;
    let d = detail.ok();
    assert_eq!(
        d["consents"],
        json!({ "training_data": true, "strava": false })
    );
    assert_eq!(
        d["recent_activities"].as_array().unwrap().len(),
        1,
        "the Strava one stays hidden"
    );
    assert_eq!(d["weekly"].as_array().unwrap().len(), 12);
    assert_eq!(d["weekly"][11]["current"], true);
    assert_eq!(d["profile"]["goal"], Value::Null);
    app.post(
        "/v1/me/consents",
        Some(&c.ana.0),
        json!({ "kind": "share_strava", "club_id": c.id }),
    )
    .await
    .ok();
    let acts = app
        .get(&format!("{path}/{}/activities", c.ana.1), Some(&c.owner))
        .await;
    assert_eq!(acts.ok()["items"].as_array().unwrap().len(), 2);
    app.get(&format!("{path}/{}", uuid::Uuid::now_v7()), Some(&c.owner))
        .await
        .problem(404, "athlete.not_found");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn profiles_and_zones(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let athlete = format!("/v1/clubs/{}/athletes/{}", c.id, c.ana.1);
    let mine = format!("/v1/clubs/{}/my/profile", c.id);

    let bad = app
        .call(
            Method::PUT,
            &mine,
            Some(&c.ana.0),
            Some(json!({ "goal": "fame", "weekly_sessions": 20, "goal_date": "logo" })),
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
    let me = app.call(Method::PUT, &mine, Some(&c.ana.0), Some(json!({ "goal": "21k", "goal_date": day(90), "level": "intermediate", "recent_race": { "distance_m": 5000, "time_s": 1500 }, "trainer_notes": "hack" })), &[]).await;
    let p = me.ok();
    assert_eq!(
        (p["goal"].as_str(), p["threshold_pace_s_per_km"].as_i64()),
        (Some("21k"), Some(313)),
        "Riegel estimate from the 5 km"
    );
    assert!(
        p.get("trainer_notes").is_none(),
        "students never see trainer notes"
    );

    let t = app
        .call(
            Method::PUT,
            &format!("{athlete}/profile"),
            Some(&c.owner),
            Some(json!({ "trainer_notes": "Cuidar da canela", "max_hr": 188 })),
            &[],
        )
        .await;
    assert_eq!(
        (t.ok()["trainer_notes"].as_str(), t.body["goal"].as_str()),
        (Some("Cuidar da canela"), Some("21k"))
    );
    app.call(
        Method::PUT,
        &format!("{athlete}/profile"),
        Some(&c.ana.0),
        Some(json!({})),
        &[],
    )
    .await
    .problem(403, "auth.forbidden");

    // Zones: pace from a race (threshold = zone 4 top), HR from max.
    app.call(
        Method::PUT,
        &format!("{athlete}/zones"),
        Some(&c.owner),
        Some(json!({ "kind": "pace" })),
        &[],
    )
    .await
    .problem(422, "validation.failed");
    app.call(
        Method::PUT,
        &format!("{athlete}/zones"),
        Some(&c.owner),
        Some(json!({ "kind": "power" })),
        &[],
    )
    .await
    .problem(422, "validation.failed");
    let pace = app
        .call(
            Method::PUT,
            &format!("{athlete}/zones"),
            Some(&c.owner),
            Some(json!({ "kind": "pace", "race": { "distance_m": 10000, "time_s": 3000 } })),
            &[],
        )
        .await;
    assert_eq!(
        (pace.ok()["source"].as_str(), &pace.body["bounds"][3]),
        (Some("race"), &json!({ "zone": 4, "min": 282, "max": 300 }))
    );
    let hr = app
        .call(
            Method::PUT,
            &format!("{athlete}/zones"),
            Some(&c.owner),
            Some(json!({ "kind": "hr", "max_hr": 190, "source": "test" })),
            &[],
        )
        .await;
    assert_eq!(
        (
            hr.ok()["source"].as_str(),
            &hr.body["bounds"][0],
            &hr.body["bounds"][4]
        ),
        (
            Some("test"),
            &json!({ "zone": 1, "min": 95, "max": 114 }),
            &json!({ "zone": 5, "min": 171, "max": 190 })
        )
    );
    let seen = app.get(&mine, Some(&c.ana.0)).await;
    assert_eq!(
        (
            seen.ok()["zones"].as_array().unwrap().len(),
            seen.body["threshold_pace_s_per_km"].as_i64(),
            seen.body["max_hr"].as_i64()
        ),
        (2, Some(300), Some(190))
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_dashboard_puts_the_day_week_feedback_and_alerts_together(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let (_, carla) = student(&app, &c.id, &c.owner, "carla@email.com", "Carla Dias").await;
    // Ana missed the last two; Bia went too hard twice and left a comment; Carla just joined with nothing planned.
    workout(
        &app,
        &c,
        &c.ana.1,
        &day(-3),
        Some(("completed", Some(5), None)),
    )
    .await;
    workout(&app, &c, &c.ana.1, &day(-2), Some(("missed", None, None))).await;
    workout(&app, &c, &c.ana.1, &day(-1), Some(("missed", None, None))).await;
    workout(
        &app,
        &c,
        &c.bia.1,
        &day(-2),
        Some(("completed", Some(9), None)),
    )
    .await;
    workout(
        &app,
        &c,
        &c.bia.1,
        &day(-1),
        Some(("completed", Some(10), Some("Muito cansada"))),
    )
    .await;
    workout(&app, &c, &c.ana.1, &day(0), None).await;
    workout(
        &app,
        &c,
        &c.bia.1,
        &day(0),
        Some(("completed", Some(6), None)),
    )
    .await;
    let birthday = today() + Duration::days(2);
    sqlx::query(
        "UPDATE users SET birth_date = make_date(1990, $1, $2) WHERE email = 'bia@email.com'",
    )
    .bind(birthday.month() as i32)
    .bind(birthday.day() as i32)
    .execute(app.db())
    .await
    .unwrap();
    sqlx::query("UPDATE club_subscriptions SET student_limit = 3")
        .execute(app.db())
        .await
        .unwrap();

    let res = app
        .get(&format!("/v1/clubs/{}/dashboard", c.id), Some(&c.owner))
        .await;
    let d = res.ok();
    assert_eq!(
        (d["date"].as_str(), d["students"].as_i64()),
        (Some(day(0).as_str()), Some(3))
    );
    assert_eq!(
        (d["today"]["planned"].as_i64(), d["today"]["done"].as_i64()),
        (Some(2), Some(1))
    );
    assert_eq!(d["compliance_trend"].as_array().unwrap().len(), 8);
    assert_eq!(d["compliance_trend"][7]["current"], true);
    let kinds: Vec<&str> = d["alerts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["kind"].as_str().unwrap())
        .collect();
    for k in [
        "missed_streak",
        "high_rpe",
        "birthday",
        "new_member",
        "plan_limit",
    ] {
        assert!(kinds.contains(&k), "{k} in {kinds:?}");
    }
    let missed = d["alerts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "missed_streak")
        .unwrap();
    assert_eq!(missed["text"], "Ana Souza não fez os últimos 2 treinos");
    let new = d["alerts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "new_member")
        .unwrap();
    assert_eq!(new["athlete"]["membership_id"], carla);
    assert_eq!(d["feedback"].as_array().unwrap().len(), 1);
    assert_eq!(d["feedback"][0]["athlete"]["user"]["name"], "Bia Lima");
    assert_eq!(
        d["onboarding"],
        json!({ "logo": false, "colors": false, "students": true, "workouts": true, "groups": false, "strava": false })
    );
    assert_eq!(d["subscription"]["active_students"], 3);
    assert!(
        d.get("upcoming_classes").is_none(),
        "classes are gone (D-035)"
    );

    let earlier = app
        .get(
            &format!("/v1/clubs/{}/dashboard?date={}", c.id, day(-1)),
            Some(&c.owner),
        )
        .await;
    assert_eq!(earlier.ok()["today"]["planned"], 2);
}
