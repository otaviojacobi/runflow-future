//! N1 notifications (D-045): everything lands in the app's center; people only switch push per kind (or pause it);
//! no notification e-mails at all.

mod common;

use axum::http::Method;
use chrono::Utc;
use common::TestApp;
use serde_json::json;
use sqlx::PgPool;

struct Club {
    id: String,
    owner: String,
    ana: (String, String),
    bia: (String, String),
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
    Club {
        id,
        owner,
        ana,
        bia,
    }
}

/// A workout today for the student (visible, `workout_assigned`), then the student's feedback (`feedback` for the
/// owner).
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

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn preferences_are_push_switches_per_kind(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;

    // Defaults: push on for the week's release, changed workouts, feedback, new members, billing, a student's own
    // class news (D-052) and each training synced from Strava (D-055); off for the rest. Nothing but the switches and the pause.
    let p = app.get("/v1/me/prefs", Some(&c.owner)).await;
    let body = p.ok();
    for (kind, on) in [
        ("workout_assigned", false),
        ("workout_changed", true),
        ("week_released", true),
        ("comment", false),
        ("feedback", true),
        ("member_joined", true),
        ("billing", true),
        ("message", false),
        ("announcement", false),
        ("class_cancelled", true),
        ("waitlist_promoted", true),
        ("activity_synced", true),
    ] {
        assert_eq!(body["kinds"][kind], json!({ "push": on }), "{kind}");
    }
    assert_eq!(body["kinds"].as_object().unwrap().len(), 12);
    assert_eq!(body["paused"], false);
    let mut keys: Vec<&String> = body.as_object().unwrap().keys().collect();
    keys.sort();
    assert_eq!(keys, ["kinds", "paused"]);

    // Validation: unknown kinds, switches that aren't on/off, a pause that isn't either.
    let bad = app
        .patch(
            "/v1/me/prefs",
            Some(&c.owner),
            json!({ "kinds": { "feedback": { "push": "yes" } }, "paused": "no" }),
        )
        .await;
    let fields: Vec<&str> = bad.problem(422, "validation.failed")["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(fields, ["kinds", "paused"]);
    assert_eq!(bad.body["errors"][0]["message"], "Use ligado ou desligado.");
    let unknown = app
        .patch(
            "/v1/me/prefs",
            Some(&c.owner),
            json!({ "kinds": { "digest": { "push": true } } }),
        )
        .await;
    assert_eq!(
        unknown.problem(422, "validation.failed")["errors"][0]["message"],
        "Tipo de notificação desconhecido."
    );

    // Switches merge per kind; old fields are ignored; /me carries the same prefs.
    let p = app
        .patch(
            "/v1/me/prefs",
            Some(&c.owner),
            json!({ "kinds": { "feedback": { "push": false, "email": "digest" } }, "digest_hour": 7 }),
        )
        .await;
    assert_eq!(p.ok()["kinds"]["feedback"], json!({ "push": false }));
    let p = app
        .patch(
            "/v1/me/prefs",
            Some(&c.owner),
            json!({ "kinds": { "comment": { "push": true } }, "paused": true }),
        )
        .await;
    assert_eq!(
        (
            p.ok()["kinds"]["feedback"]["push"].as_bool(),
            p.ok()["kinds"]["comment"]["push"].as_bool(),
            p.ok()["paused"].as_bool()
        ),
        (Some(false), Some(true), Some(true))
    );
    let me = app.get("/v1/me", Some(&c.owner)).await;
    assert_eq!(me.ok()["prefs"], p.body);
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn everything_lands_in_the_center_and_no_notice_is_e_mailed(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;

    // Switches and the pause only concern push: the center always fills.
    app.patch(
        "/v1/me/prefs",
        Some(&c.bia.0),
        json!({ "kinds": { "workout_assigned": { "push": false } } }),
    )
    .await
    .ok();
    app.patch("/v1/me/prefs", Some(&c.ana.0), json!({ "paused": true }))
        .await
        .ok();
    feedback(&app, &c, &c.bia).await;
    feedback(&app, &c, &c.ana).await;
    assert!(
        center(&app, &c.bia.0)
            .await
            .contains(&"workout_assigned".to_string())
    );
    assert!(
        center(&app, &c.ana.0)
            .await
            .contains(&"workout_assigned".to_string())
    );
    let owner = center(&app, &c.owner).await;
    assert_eq!(owner.iter().filter(|k| *k == "feedback").count(), 2);
    assert!(owner.contains(&"member_joined".to_string()));
    let unread = app.get("/v1/me", Some(&c.owner)).await.ok()["unread_notifications"]
        .as_i64()
        .unwrap();
    assert_eq!(unread, owner.len() as i64);

    // Nobody has a device: nothing was queued for push.
    let queued: i64 =
        sqlx::query_scalar("SELECT count(*) FROM notifications WHERE push_at IS NOT NULL")
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(queued, 0);

    // The worker's minute tick and the queue send no notification e-mails: only sign-in codes and invites go out.
    app.tick(Utc::now()).await;
    app.run_jobs().await;
    let kinds: Vec<String> = app
        .state
        .mailer
        .outbox()
        .unwrap()
        .list()
        .into_iter()
        .flat_map(|m| m.email.tags)
        .filter(|(k, _)| k == "kind")
        .map(|(_, v)| v)
        .collect();
    assert!(!kinds.is_empty());
    assert!(
        kinds.iter().all(|k| k == "sign_in_code" || k == "invite"),
        "{kinds:?}"
    );
}
