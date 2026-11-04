//! R3 activity matching (D-049): activities are linked to the likeliest planned workout, the student is asked when
//! two are about equally likely, their choice sticks, and planning changes rematch through the worker.

mod common;

use chrono::{Duration, Utc};
use common::TestApp;
use serde_json::{Value, json};
use sqlx::PgPool;

struct Club {
    id: String,
    owner: String,
    ana: String,
}

fn token_of(url: &str) -> String {
    url.rsplit('/').next().unwrap().to_string()
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
    // Every workout visible at once: these tests aren't about week release.
    app.patch(
        &format!("/v1/clubs/{id}"),
        Some(&owner),
        json!({ "release_mode": "immediate" }),
    )
    .await
    .ok();
    let i = app
        .post(
            &format!("/v1/clubs/{id}/invites"),
            Some(&owner),
            json!({ "email": "ana@email.com" }),
        )
        .await;
    let ana = app.sign_in("ana@email.com").await;
    app.patch("/v1/me", Some(&ana), json!({ "name": "Ana Souza" }))
        .await
        .ok();
    app.post(
        &format!(
            "/v1/invites/{}/accept",
            token_of(i.body["url"].as_str().unwrap())
        ),
        Some(&ana),
        json!({}),
    )
    .await
    .ok();
    Club { id, owner, ana }
}

async fn athlete_id(app: &TestApp, c: &Club) -> String {
    let m = app
        .get(
            &format!("/v1/clubs/{}/members?role=student", c.id),
            Some(&c.owner),
        )
        .await;
    m.ok()["items"][0]["membership"]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

/// Today in the club's timezone (São Paulo).
fn day(offset: i64) -> String {
    (Utc::now()
        .with_timezone(&chrono_tz::America::Sao_Paulo)
        .date_naive()
        + Duration::days(offset))
    .format("%Y-%m-%d")
    .to_string()
}

async fn plan(
    app: &TestApp,
    c: &Club,
    athlete: &str,
    date: &str,
    meters: i32,
    secs: i32,
) -> String {
    let structure = json!({ "v": 1, "blocks": [
        { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": meters }, "target": { "type": "zone", "metric": "pace", "zone": 2 } }
    ] });
    let res = app
        .post(
            &format!("/v1/clubs/{}/planned-workouts", c.id),
            Some(&c.owner),
            json!({ "athlete_ids": [athlete], "dates": [date], "sport": "run", "title": format!("Corrida {meters} m"),
                    "structure": structure, "est_distance_m": meters, "est_duration_s": secs }),
        )
        .await;
    res.body["items"][0]["id"].as_str().unwrap().to_string()
}

async fn log(app: &TestApp, token: &str, date: &str, meters: i32, secs: i32) -> Value {
    let res = app
        .post(
            "/v1/me/activities",
            Some(token),
            json!({ "sport": "run", "name": "Corrida", "started_at": format!("{date}T09:00"), "duration_s": secs, "distance_m": meters }),
        )
        .await;
    assert_eq!(res.status, 201, "{}", res.body);
    res.body
}

async fn completion(app: &TestApp, c: &Club, workout: &str) -> Value {
    app.get(
        &format!("/v1/clubs/{}/my/workouts/{workout}", c.id),
        Some(&c.ana),
    )
    .await
    .ok()["completion"]
        .clone()
}

async fn feedback_notices(app: &TestApp) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM notifications WHERE kind = 'feedback'")
        .fetch_one(app.db())
        .await
        .unwrap()
}

async fn put(app: &TestApp, path: &str, token: &str, body: Value) -> common::Res {
    app.call(axum::http::Method::PUT, path, Some(token), Some(body), &[])
        .await
}

async fn drain(app: &TestApp) {
    for _ in 0..5 {
        if app.run_jobs().await == 0 {
            break;
        }
    }
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn a_logged_run_completes_its_workout_and_the_first_report_notifies(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let athlete = athlete_id(&app, &c).await;
    let w = plan(&app, &c, &athlete, &day(0), 8000, 2880).await;

    let a = log(&app, &c.ana, &day(0), 8240, 2990).await;
    assert_eq!(a["match_state"], "open");
    assert_eq!(a["matched_workout"]["id"], w.as_str());
    assert_eq!(a["matched_workout"]["matched_by"], "auto");
    assert_eq!(a["matched_workout"]["compliance_pct"], 103);
    let done = completion(&app, &c, &w).await;
    assert_eq!(
        (
            done["status"].as_str(),
            done["matched_by"].as_str(),
            done["reported_at"].is_null()
        ),
        (Some("completed"), Some("auto"), true)
    );
    // The match alone doesn't tell the trainer.
    assert_eq!(feedback_notices(&app).await, 0);

    // The student's PSE: the first report notifies, the next one doesn't; the activity stays linked.
    let path = format!("/v1/clubs/{}/my/workouts/{w}/completion", c.id);
    let r = put(
        &app,
        &path,
        &c.ana,
        json!({ "status": "completed", "rpe": 4, "feeling": "good" }),
    )
    .await;
    assert_eq!(r.ok()["completion"]["activity_id"], a["id"]);
    assert!(!r.ok()["completion"]["reported_at"].is_null());
    assert_eq!(feedback_notices(&app).await, 1);
    put(
        &app,
        &path,
        &c.ana,
        json!({ "status": "completed", "rpe": 5 }),
    )
    .await
    .ok();
    assert_eq!(feedback_notices(&app).await, 1);

    // Removing the activity keeps the student's report, without the activity.
    let id = a["id"].as_str().unwrap();
    assert_eq!(
        app.delete(&format!("/v1/me/activities/{id}"), Some(&c.ana))
            .await
            .status,
        204
    );
    let kept = completion(&app, &c, &w).await;
    assert_eq!(
        (
            kept["status"].as_str(),
            kept["activity_id"].is_null(),
            kept["matched_by"].is_null(),
            kept["rpe"].as_i64()
        ),
        (Some("completed"), true, true, Some(5))
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn an_automatic_completion_goes_with_its_activity(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let athlete = athlete_id(&app, &c).await;
    let w = plan(&app, &c, &athlete, &day(0), 8000, 2880).await;
    let a = log(&app, &c.ana, &day(0), 4000, 1500).await;
    // Half the distance on the same day: still that workout, partial.
    assert_eq!(completion(&app, &c, &w).await["status"], "partial");
    let id = a["id"].as_str().unwrap();
    app.delete(&format!("/v1/me/activities/{id}"), Some(&c.ana))
        .await;
    assert_eq!(completion(&app, &c, &w).await, Value::Null);
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn a_doubt_is_asked_and_the_students_choice_sticks(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let athlete = athlete_id(&app, &c).await;
    let yesterday = plan(&app, &c, &athlete, &day(-1), 9500, 3000).await;
    let today = plan(&app, &c, &athlete, &day(0), 6000, 2100).await;

    // 6.6 km yesterday: yesterday's 9.5 km cut short, or today's 6 km done early?
    let a = log(&app, &c.ana, &day(-1), 6600, 2178).await;
    let id = a["id"].as_str().unwrap().to_string();
    assert_eq!(a["match_state"], "pending");
    assert_eq!(a["matched_workout"], Value::Null);
    let options: Vec<&str> = a["match_options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["id"].as_str().unwrap())
        .collect();
    assert_eq!(options, [yesterday.as_str(), today.as_str()]);
    assert_eq!(a["match_options"][0]["sport"], "run");
    let pending = app
        .get("/v1/me/activities?match=pending", Some(&c.ana))
        .await;
    assert_eq!(pending.ok()["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        pending.ok()["items"][0]["match_options"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(completion(&app, &c, &yesterday).await, Value::Null);

    // Only the student's own visible workouts, within 7 days.
    let path = format!("/v1/me/activities/{id}/match");
    let bad = put(&app, &path, &c.ana, json!({ "planned_workout_id": "nope" })).await;
    assert_eq!(
        bad.problem(422, "validation.failed")["errors"][0]["field"],
        "planned_workout_id"
    );

    // She picks today's workout: her link.
    let chosen = put(&app, &path, &c.ana, json!({ "planned_workout_id": today })).await;
    let chosen = chosen.ok();
    assert_eq!(chosen["match_state"], "open");
    assert_eq!(chosen["matched_workout"]["id"], today.as_str());
    assert_eq!(chosen["matched_workout"]["matched_by"], "student");
    assert!(!chosen["match_options"].as_array().unwrap().is_empty());
    assert_eq!(
        app.get("/v1/me/activities?match=pending", Some(&c.ana))
            .await
            .ok()["items"],
        json!([])
    );
    assert_eq!(completion(&app, &c, &today).await["status"], "completed");

    // A run that fits today's workout better doesn't take it from her choice.
    let second = log(&app, &c.ana, &day(0), 6000, 2100).await;
    assert_eq!(second["matched_workout"]["id"], yesterday.as_str());

    // "Nenhum destes": dismissed, and today's workout goes to the run that fits it.
    let none = put(&app, &path, &c.ana, json!({ "planned_workout_id": null })).await;
    assert_eq!(none.ok()["match_state"], "dismissed");
    assert_eq!(none.ok()["matched_workout"], Value::Null);
    let second_id = second["id"].as_str().unwrap();
    let again = app
        .get(&format!("/v1/me/activities/{second_id}"), Some(&c.ana))
        .await;
    assert_eq!(again.ok()["matched_workout"]["id"], today.as_str());
    assert_eq!(completion(&app, &c, &yesterday).await, Value::Null);

    // A dismissed activity stays alone through later passes.
    log(&app, &c.ana, &day(-1), 3000, 1100).await;
    let first = app
        .get(&format!("/v1/me/activities/{id}"), Some(&c.ana))
        .await;
    assert_eq!(first.ok()["match_state"], "dismissed");
    assert_eq!(first.ok()["matched_workout"], Value::Null);
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn planning_after_the_run_matches_through_the_worker(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let athlete = athlete_id(&app, &c).await;
    let a = log(&app, &c.ana, &day(-1), 10000, 3600).await;
    assert_eq!(a["matched_workout"], Value::Null);
    let id = a["id"].as_str().unwrap();

    // The trainer plans yesterday's run afterwards: the worker links it.
    let w = plan(&app, &c, &athlete, &day(-1), 10000, 3600).await;
    drain(&app).await;
    let linked = app
        .get(&format!("/v1/me/activities/{id}"), Some(&c.ana))
        .await;
    assert_eq!(linked.ok()["matched_workout"]["id"], w.as_str());

    // Moved to next week: the run isn't that workout any more.
    app.patch(
        &format!("/v1/clubs/{}/planned-workouts/{w}", c.id),
        Some(&c.owner),
        json!({ "date": day(6) }),
    )
    .await
    .ok();
    drain(&app).await;
    let unlinked = app
        .get(&format!("/v1/me/activities/{id}"), Some(&c.ana))
        .await;
    assert_eq!(unlinked.ok()["matched_workout"], Value::Null);
    assert_eq!(completion(&app, &c, &w).await, Value::Null);

    // Planned again for yesterday, then deleted: linked, then free.
    let again = plan(&app, &c, &athlete, &day(-1), 10000, 3600).await;
    drain(&app).await;
    assert_eq!(
        app.get(&format!("/v1/me/activities/{id}"), Some(&c.ana))
            .await
            .ok()["matched_workout"]["id"],
        again.as_str()
    );
    app.delete(
        &format!("/v1/clubs/{}/planned-workouts/{again}", c.id),
        Some(&c.owner),
    )
    .await;
    drain(&app).await;
    assert_eq!(
        app.get(&format!("/v1/me/activities/{id}"), Some(&c.ana))
            .await
            .ok()["matched_workout"],
        Value::Null
    );
}
