//! F35 notification control (D-032): per-kind choices, the staff group filter, and the e-mails the worker sends.

mod common;

use axum::http::Method;
use chrono::Utc;
use common::TestApp;
use serde_json::{Value, json};
use sqlx::PgPool;

struct Club {
    id: String,
    owner: String,
    ana: (String, String),
    bia: (String, String),
    group: String,
}

async fn student(app: &TestApp, club: &str, owner: &str, email: &str) -> (String, String) {
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
    let m = app
        .post(&format!("/v1/invites/{token}/accept"), Some(&t), json!({}))
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
    let ana = student(app, &id, &owner, "ana@email.com").await;
    let bia = student(app, &id, &owner, "bia@email.com").await;
    let group = app
        .post(
            &format!("/v1/clubs/{id}/groups"),
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
        &format!("/v1/clubs/{id}/groups/{group}/members"),
        Some(&owner),
        Some(json!({ "membership_ids": [bia.1] })),
        &[],
    )
    .await
    .ok();
    Club {
        id,
        owner,
        ana,
        bia,
        group,
    }
}

/// A workout today for the student (visible), then the student's feedback: a `feedback` notice for the owner.
async fn feedback(app: &TestApp, c: &Club, who: &(String, String)) {
    let today = Utc::now().date_naive().to_string();
    let w = app
        .post(
            &format!("/v1/clubs/{}/planned-workouts", c.id),
            Some(&c.owner),
            json!({ "athlete_ids": [who.1], "dates": [today], "sport": "run", "title": "Rodagem",
                    "structure": { "v": 1, "blocks": [{ "kind": "step", "intent": "active", "duration": { "type": "time", "s": 1800 }, "target": { "type": "zone", "metric": "pace", "zone": 2 } }] } }),
        )
        .await;
    let id = w.body["items"][0]["id"].as_str().unwrap().to_string();
    app.call(
        Method::PUT,
        &format!("/v1/clubs/{}/my/workouts/{id}/completion", c.id),
        Some(&who.0),
        Some(json!({ "status": "completed", "rpe": 5 })),
        &[],
    )
    .await
    .ok();
}

async fn center(app: &TestApp, token: &str) -> Vec<String> {
    app.get("/v1/me/notifications", Some(token)).await.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["kind"].as_str().unwrap().to_string())
        .collect()
}

fn mails(app: &TestApp, to: &str, kind: &str) -> Vec<String> {
    app.state
        .mailer
        .outbox()
        .unwrap()
        .list()
        .into_iter()
        .filter(|m| {
            m.email.to == [to] && m.email.tags.iter().any(|(k, v)| k == "kind" && v == kind)
        })
        .map(|m| m.email.subject)
        .collect()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn preferences_defaults_validation_and_group_filter(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;

    // Defaults per kind; staff see their clubs' group filters.
    let p = app.get("/v1/me/prefs", Some(&c.owner)).await;
    assert_eq!(
        p.ok()["kinds"]["feedback"],
        json!({ "app": true, "push": false, "email": "digest" })
    );
    assert_eq!(p.ok()["kinds"]["week_released"]["email"], "instant");
    assert_eq!(
        (
            p.ok()["digest_hour"].as_i64(),
            p.ok()["quiet_start"].as_str()
        ),
        (Some(7), Some("22:00"))
    );
    assert_eq!(p.ok()["groups"][0]["club_id"], c.id.as_str());
    assert_eq!(
        app.get("/v1/me/prefs", Some(&c.ana.0)).await.ok()["groups"],
        json!([])
    );

    let bad = app
        .patch(
            "/v1/me/prefs",
            Some(&c.owner),
            json!({ "kinds": { "feedback": { "email": "weekly" } }, "quiet_start": "22:00" }),
        )
        .await;
    let fields: Vec<&str> = bad.problem(422, "validation.failed")["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(fields, ["kinds", "quiet_start"]);
    app.patch(
        "/v1/me/prefs",
        Some(&c.ana.0),
        json!({ "groups": [{ "club_id": c.id, "group_ids": [c.group] }] }),
    )
    .await
    .problem(403, "auth.forbidden");

    // The owner only wants feedback about the "Iniciantes" group (Bia).
    let f = app
        .patch("/v1/me/prefs", Some(&c.owner), json!({ "groups": [{ "club_id": c.id, "group_ids": [c.group, uuid::Uuid::now_v7()] }] }))
        .await;
    assert_eq!(
        f.ok()["groups"][0]["group_ids"],
        json!([c.group]),
        "only the club's groups are kept"
    );
    feedback(&app, &c, &c.ana).await;
    assert!(
        !center(&app, &c.owner)
            .await
            .contains(&"feedback".to_string()),
        "Ana is outside the group"
    );
    feedback(&app, &c, &c.bia).await;
    assert_eq!(
        center(&app, &c.owner)
            .await
            .iter()
            .filter(|k| *k == "feedback")
            .count(),
        1
    );

    // Quiet hours off; then on with both ends.
    let q = app
        .patch(
            "/v1/me/prefs",
            Some(&c.owner),
            json!({ "quiet_start": null, "quiet_end": null }),
        )
        .await;
    assert!(q.ok()["quiet_start"].is_null());
    let q = app
        .patch(
            "/v1/me/prefs",
            Some(&c.owner),
            json!({ "quiet_start": "23:00", "quiet_end": "06:30" }),
        )
        .await;
    assert_eq!(q.ok()["quiet_end"], "06:30");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_center_e_mails_and_the_daily_summary_follow_the_choices(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;

    // Out of the center: Bia turns workout notices off in the app (no e-mail either: nothing is stored).
    app.patch(
        "/v1/me/prefs",
        Some(&c.bia.0),
        json!({ "kinds": { "workout_assigned": { "app": false } } }),
    )
    .await
    .ok();
    feedback(&app, &c, &c.bia).await;
    assert!(
        !center(&app, &c.bia.0)
            .await
            .contains(&"workout_assigned".to_string())
    );
    let me = app.get("/v1/me", Some(&c.bia.0)).await;
    assert_eq!(me.ok()["prefs"]["kinds"]["workout_assigned"]["app"], false);

    // Instant e-mail: Ana wants new workouts by e-mail right away; paused, nothing goes out.
    app.patch(
        "/v1/me/prefs",
        Some(&c.ana.0),
        json!({ "kinds": { "workout_assigned": { "email": "instant" } }, "paused": true }),
    )
    .await
    .ok();
    feedback(&app, &c, &c.ana).await;
    app.tick(Utc::now()).await;
    assert!(
        mails(&app, "ana@email.com", "notification").is_empty(),
        "paused"
    );
    app.patch("/v1/me/prefs", Some(&c.ana.0), json!({ "paused": false }))
        .await
        .ok();
    feedback(&app, &c, &c.ana).await;
    app.tick(Utc::now()).await;
    app.tick(Utc::now()).await;
    assert_eq!(
        mails(&app, "ana@email.com", "notification"),
        ["Novo treino na sua agenda"],
        "sent once"
    );

    // Daily summary: the owner's feedback notices (default: digest) go out once their hour has come.
    app.patch("/v1/me/prefs", Some(&c.owner), json!({ "digest_hour": 0 }))
        .await
        .ok();
    app.tick(Utc::now()).await;
    let summaries = mails(&app, "marcos@email.com", "digest");
    assert_eq!(summaries.len(), 1);
    assert!(
        summaries[0].starts_with("Seu resumo do Runflow: "),
        "{summaries:?}"
    );
    feedback(&app, &c, &c.bia).await;
    app.tick(Utc::now()).await;
    assert_eq!(
        mails(&app, "marcos@email.com", "digest").len(),
        1,
        "one summary a day"
    );
    // The notices stay in the center either way.
    let owner_center: Vec<Value> =
        app.get("/v1/me/notifications", Some(&c.owner)).await.ok()["items"]
            .as_array()
            .unwrap()
            .clone();
    assert!(
        owner_center
            .iter()
            .filter(|n| n["kind"] == "feedback")
            .count()
            >= 3
    );
}
