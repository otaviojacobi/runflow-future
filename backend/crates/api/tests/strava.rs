//! S5: Strava (OAuth with signed state, encrypted tokens, sync, webhooks, refresh, disconnect) against a local
//! fake of Strava's API, and the person's own activities.

mod common;

use std::sync::{Arc, Mutex};

use axum::extract::{Form, Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use common::TestApp;
use serde_json::{Value, json};
use sqlx::PgPool;

#[derive(Default)]
struct Fake {
    calls: Vec<String>,
}

fn run(id: i64, name: &str, days_ago: i64) -> Value {
    let start = (chrono::Utc::now() - chrono::Duration::days(days_ago))
        .format("%Y-%m-%dT09:20:00Z")
        .to_string();
    json!({ "id": id, "name": name, "sport_type": "Run", "start_date": start, "elapsed_time": 2100, "moving_time": 2040, "distance": 6000.0,
            "average_heartrate": 150.0, "map": { "summary_polyline": "xyz" } })
}

async fn fake_strava() -> (String, Arc<Mutex<Fake>>) {
    let fake = Arc::new(Mutex::new(Fake::default()));
    let token = |State(f): State<Arc<Mutex<Fake>>>,
                 Form(p): Form<std::collections::HashMap<String, String>>| async move {
        let grant = p.get("grant_type").cloned().unwrap_or_default();
        f.lock().unwrap().calls.push(format!("token:{grant}"));
        let exp = chrono::Utc::now().timestamp() + 6 * 3600;
        match (grant.as_str(), p.get("code").map(String::as_str)) {
            ("authorization_code", Some("good")) => (
                axum::http::StatusCode::OK,
                Json(
                    json!({ "access_token": "acc-1", "refresh_token": "ref-1", "expires_at": exp, "athlete": { "id": 777, "firstname": "Ana", "lastname": "Souza" } }),
                ),
            ),
            ("refresh_token", _) => (
                axum::http::StatusCode::OK,
                Json(
                    json!({ "access_token": "acc-2", "refresh_token": "ref-2", "expires_at": exp }),
                ),
            ),
            _ => (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({ "message": "Bad Request" })),
            ),
        }
    };
    let list = |State(f): State<Arc<Mutex<Fake>>>, headers: axum::http::HeaderMap| async move {
        f.lock().unwrap().calls.push(format!(
            "list:{}",
            headers["authorization"].to_str().unwrap()
        ));
        Json(json!([
            run(1001, "Rodagem leve", 2),
            run(1002, "Longão", 5)
        ]))
    };
    let detail = |State(f): State<Arc<Mutex<Fake>>>, Path(id): Path<i64>| async move {
        f.lock().unwrap().calls.push(format!("activity:{id}"));
        let mut a = run(id, "Tiros na pista", 0);
        a["laps"] = json!([{ "distance": 400.0, "moving_time": 92, "average_heartrate": 171.0 }]);
        a["calories"] = json!(420.0);
        Json(a)
    };
    let deauth = |State(f): State<Arc<Mutex<Fake>>>| async move {
        f.lock().unwrap().calls.push("deauthorize".into());
        Json(json!({}))
    };
    let app = Router::new()
        .route("/oauth/token", post(token))
        .route("/oauth/deauthorize", post(deauth))
        .route("/api/v3/athlete/activities", get(list))
        .route("/api/v3/activities/{id}", get(detail))
        .with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, fake)
}

async fn connect(app: &TestApp, token: &str) -> Value {
    let start = app
        .post("/v1/me/connections/strava/start", Some(token), json!({}))
        .await;
    let state = start.ok()["state"].as_str().unwrap().to_string();
    let res = app
        .post(
            "/v1/me/connections/strava/callback",
            Some(token),
            json!({ "code": "good", "state": state, "scope": "read,activity:read_all" }),
        )
        .await;
    res.ok().clone()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn connect_sync_and_disconnect(db: PgPool) {
    let (url, fake) = fake_strava().await;
    let app = TestApp::new(db).with_strava(&url);
    let ana = app.sign_in("ana@email.com").await;

    let conns = app.get("/v1/me/connections", Some(&ana)).await;
    assert_eq!(
        (
            conns.ok()["items"][0]["available"].as_bool(),
            &conns.body["items"][0]["connection"]
        ),
        (Some(true), &Value::Null)
    );
    let start = app
        .post("/v1/me/connections/strava/start", Some(&ana), json!({}))
        .await;
    let authorize = start.ok()["authorize_url"].as_str().unwrap().to_string();
    assert!(authorize.starts_with(&format!("{url}/oauth/authorize?client_id=123&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fconnect%2Fstrava")));
    let state = start.body["state"].as_str().unwrap().to_string();
    assert_eq!(
        start.body["redirect_uri"],
        "http://localhost:8080/connect/strava"
    );
    // The phone app: Strava's mobile page and a redirect back into the app on the callback domain.
    let app_start = app
        .post(
            "/v1/me/connections/strava/start",
            Some(&ana),
            json!({ "client": "app" }),
        )
        .await;
    assert_eq!(
        app_start.ok()["redirect_uri"],
        "runflow://localhost/connect/strava"
    );
    assert!(
        app_start.body["authorize_url"]
            .as_str()
            .unwrap()
            .starts_with(&format!("{url}/oauth/mobile/authorize?client_id=123&redirect_uri=runflow%3A%2F%2Flocalhost%2Fconnect%2Fstrava"))
    );
    app.post(
        "/v1/me/connections/strava/start",
        Some(&ana),
        json!({ "client": "tv" }),
    )
    .await
    .problem(422, "validation.failed");

    // Bad state, missing code, missing activity scope, a refused code.
    let cb = "/v1/me/connections/strava/callback";
    app.post(
        cb,
        Some(&ana),
        json!({ "code": "good", "state": "forged.state" }),
    )
    .await
    .problem(400, "strava.state_invalid");
    let bia = app.sign_in("bia@email.com").await;
    app.post(cb, Some(&bia), json!({ "code": "good", "state": state }))
        .await
        .problem(400, "strava.state_invalid");
    app.post(cb, Some(&ana), json!({ "state": state }))
        .await
        .problem(400, "strava.denied");
    app.post(
        cb,
        Some(&ana),
        json!({ "code": "good", "state": state, "scope": "read" }),
    )
    .await
    .problem(400, "strava.scope");
    app.post(cb, Some(&ana), json!({ "code": "nope", "state": state }))
        .await
        .problem(400, "strava.denied");

    let c = app
        .post(
            cb,
            Some(&ana),
            json!({ "code": "good", "state": state, "scope": "read,activity:read_all" }),
        )
        .await;
    assert_eq!(
        (c.ok()["athlete_name"].as_str(), c.body["status"].as_str()),
        (Some("Ana Souza"), Some("active"))
    );
    let enc: Vec<u8> = sqlx::query_scalar("SELECT access_token_enc FROM provider_connections")
        .fetch_one(app.db())
        .await
        .unwrap();
    assert!(
        !enc.windows(5).any(|w| w == b"acc-1"),
        "tokens are encrypted at rest"
    );

    // The first sync imports recent activities.
    app.run_jobs().await;
    let acts = app.get("/v1/me/activities", Some(&ana)).await;
    let names: Vec<&str> = acts.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Rodagem leve", "Longão"]);
    assert_eq!(
        (
            acts.body["items"][0]["source"].as_str(),
            acts.body["items"][0]["avg_pace_s_per_km"].as_i64()
        ),
        (Some("strava"), Some(340))
    );
    assert!(
        fake.lock()
            .unwrap()
            .calls
            .contains(&"list:Bearer acc-1".to_string())
    );
    let synced = app.get("/v1/me/connections", Some(&ana)).await;
    assert!(synced.ok()["items"][0]["connection"]["last_sync_at"].is_string());

    // Another Runflow account can't take the same Strava athlete.
    let st = app
        .post("/v1/me/connections/strava/start", Some(&bia), json!({}))
        .await
        .body["state"]
        .as_str()
        .unwrap()
        .to_string();
    app.post(cb, Some(&bia), json!({ "code": "good", "state": st }))
        .await
        .problem(409, "strava.taken");

    // Synced activities can't be deleted here; disconnecting removes them and the Strava sharing consent.
    let synced_id = acts.body["items"][0]["id"].as_str().unwrap();
    app.delete(&format!("/v1/me/activities/{synced_id}"), Some(&ana))
        .await
        .problem(409, "activity.synced");
    assert_eq!(
        app.delete("/v1/me/connections/strava", Some(&ana))
            .await
            .status,
        204
    );
    assert!(
        fake.lock()
            .unwrap()
            .calls
            .contains(&"deauthorize".to_string())
    );
    assert_eq!(
        app.get("/v1/me/activities", Some(&ana)).await.ok()["items"],
        json!([])
    );
    assert_eq!(
        app.get("/v1/me/connections", Some(&ana)).await.ok()["items"][0]["connection"],
        Value::Null
    );
    app.delete("/v1/me/connections/strava", Some(&ana))
        .await
        .problem(404, "connection.not_found");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn webhooks_refresh_and_athlete_revocation(db: PgPool) {
    let (url, fake) = fake_strava().await;
    let app = TestApp::new(db).with_strava(&url);
    let ana = app.sign_in("ana@email.com").await;
    connect(&app, &ana).await;
    app.run_jobs().await;

    // Subscription handshake.
    let ok = app.get("/v1/webhooks/strava?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123", None).await;
    assert_eq!(ok.ok()["hub.challenge"], "abc123");
    app.get(
        "/v1/webhooks/strava?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x",
        None,
    )
    .await
    .problem(403, "webhook.forbidden");

    // A new activity: fetched from Strava (the event's own content is never trusted), recorded once.
    let event = json!({ "object_type": "activity", "object_id": 2001, "aspect_type": "create", "owner_id": 777, "subscription_id": 1, "event_time": 1700000000 });
    for _ in 0..2 {
        assert_eq!(
            app.post("/v1/webhooks/strava", None, event.clone())
                .await
                .status,
            200
        );
    }
    // Expired token: refreshed before calling Strava.
    sqlx::query("UPDATE provider_connections SET token_expires_at = now() - interval '1 hour'")
        .execute(app.db())
        .await
        .unwrap();
    app.run_jobs().await;
    let calls = fake.lock().unwrap().calls.clone();
    assert_eq!(
        calls.iter().filter(|c| *c == "activity:2001").count(),
        1,
        "duplicate event processed once"
    );
    assert!(calls.contains(&"token:refresh_token".to_string()));
    let acts = app.get("/v1/me/activities", Some(&ana)).await;
    let track = acts.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["name"] == "Tiros na pista")
        .unwrap()
        .clone();
    assert_eq!(
        (
            track["calories"].as_i64(),
            track["laps"][0]["avg_pace_s_per_km"].as_i64()
        ),
        (Some(420), Some(230))
    );

    // Deleted on Strava → deleted here; unknown athletes are ignored.
    app.post("/v1/webhooks/strava", None, json!({ "object_type": "activity", "object_id": 2001, "aspect_type": "delete", "owner_id": 777, "event_time": 1700000100 })).await;
    app.post("/v1/webhooks/strava", None, json!({ "object_type": "activity", "object_id": 9, "aspect_type": "create", "owner_id": 999, "event_time": 1700000200 })).await;
    app.run_jobs().await;
    assert_eq!(
        app.get("/v1/me/activities", Some(&ana)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    // The athlete revokes access on Strava: same as disconnecting.
    app.post("/v1/webhooks/strava", None, json!({ "object_type": "athlete", "object_id": 777, "aspect_type": "update", "owner_id": 777, "updates": { "authorized": "false" }, "event_time": 1700000300 })).await;
    app.run_jobs().await;
    assert_eq!(
        app.get("/v1/me/activities", Some(&ana)).await.ok()["items"],
        json!([])
    );
    assert_eq!(
        app.get("/v1/me/connections", Some(&ana)).await.ok()["items"][0]["connection"],
        Value::Null
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn without_strava_config_and_manual_activities(db: PgPool) {
    let app = TestApp::new(db);
    let ana = app.sign_in("ana@email.com").await;
    assert_eq!(
        app.get("/v1/me/connections", Some(&ana)).await.ok()["items"][0]["available"],
        false
    );
    app.post("/v1/me/connections/strava/start", Some(&ana), json!({}))
        .await
        .problem(503, "strava.unavailable");

    let bad = app
        .post(
            "/v1/me/activities",
            Some(&ana),
            json!({ "sport": "chess", "started_at": "ontem", "duration_s": 0, "distance_m": -1 }),
        )
        .await;
    assert_eq!(
        bad.problem(422, "validation.failed")["errors"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    let a = app.post("/v1/me/activities", Some(&ana), json!({ "sport": "run", "name": "Corrida na esteira", "started_at": "2026-11-01T07:30", "duration_s": 1800, "distance_m": 5000, "avg_hr": 150 })).await;
    assert_eq!(a.status, 201, "{}", a.body);
    assert_eq!(
        (
            a.body["source"].as_str(),
            a.body["avg_pace_s_per_km"].as_i64(),
            a.body["started_at"].as_str()
        ),
        (Some("manual"), Some(360), Some("2026-11-01T10:30:00Z"))
    );
    let id = a.body["id"].as_str().unwrap();
    assert_eq!(
        app.get(&format!("/v1/me/activities/{id}"), Some(&ana))
            .await
            .ok()["matched_workout"],
        Value::Null
    );
    let bia = app.sign_in("bia@email.com").await;
    app.get(&format!("/v1/me/activities/{id}"), Some(&bia))
        .await
        .problem(404, "activity.not_found");
    assert_eq!(
        app.get("/v1/me/activities?from=2026-11-02", Some(&ana))
            .await
            .ok()["items"],
        json!([])
    );
    assert_eq!(
        app.delete(&format!("/v1/me/activities/{id}"), Some(&ana))
            .await
            .status,
        204
    );
}

/// R3 (D-049): synced runs are matched to the plan by the worker, and a better fit arriving later takes the workout.
#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn synced_runs_are_matched_to_the_plan(db: PgPool) {
    let (url, _fake) = fake_strava().await;
    let app = TestApp::new(db).with_strava(&url);
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
    app.patch(
        &format!("/v1/clubs/{club}"),
        Some(&owner),
        json!({ "release_mode": "immediate" }),
    )
    .await
    .ok();
    let invite = app
        .post(
            &format!("/v1/clubs/{club}/invites"),
            Some(&owner),
            json!({ "email": "ana@email.com" }),
        )
        .await;
    let ana = app.sign_in("ana@email.com").await;
    let token = invite.body["url"]
        .as_str()
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_string();
    let athlete = app
        .post(
            &format!("/v1/invites/{token}/accept"),
            Some(&ana),
            json!({}),
        )
        .await
        .body["membership"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    // Ana shares her training data and her Strava with the club, as the welcome flow asks (D-011).
    for kind in ["share_training_data", "share_strava"] {
        app.post(
            "/v1/me/consents",
            Some(&ana),
            json!({ "kind": kind, "club_id": club }),
        )
        .await
        .ok();
    }
    // A 6 km run planned on the day the fake's new run happens (09:20 UTC is 06:20 in São Paulo, same date).
    let day = chrono::Utc::now().date_naive().to_string();
    let structure = json!({ "v": 1, "blocks": [{ "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 6000 },
                                                 "target": { "type": "zone", "metric": "pace", "zone": 2 } }] });
    let w = app
        .post(
            &format!("/v1/clubs/{club}/planned-workouts"),
            Some(&owner),
            json!({ "athlete_ids": [athlete], "dates": [day], "sport": "run", "title": "Rodagem 6 km", "structure": structure,
                    "est_distance_m": 6000, "est_duration_s": 2100 }),
        )
        .await
        .body["items"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let matched = |items: &Value, name: &str| {
        items
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["name"] == name)
            .map(|a| a["matched_workout"]["id"].clone())
            .unwrap()
    };
    let drain = || async {
        for _ in 0..5 {
            if app.run_jobs().await == 0 {
                break;
            }
        }
    };

    // The first sync: the run from 2 days ago is the only candidate, so it completes the workout (done early).
    connect(&app, &ana).await;
    drain().await;
    let acts = app.get("/v1/me/activities", Some(&ana)).await;
    assert_eq!(matched(&acts.ok()["items"], "Rodagem leve"), w.as_str());

    // Today's run arrives by webhook: same day, same size, so it takes the workout.
    app.post("/v1/webhooks/strava", None, json!({ "object_type": "activity", "object_id": 3001, "aspect_type": "create", "owner_id": 777, "event_time": 1700000400 })).await;
    drain().await;
    let acts = app.get("/v1/me/activities", Some(&ana)).await;
    assert_eq!(matched(&acts.ok()["items"], "Tiros na pista"), w.as_str());
    assert_eq!(matched(&acts.ok()["items"], "Rodagem leve"), Value::Null);

    // Deleted on Strava: the workout goes back to the earlier run.
    app.post("/v1/webhooks/strava", None, json!({ "object_type": "activity", "object_id": 3001, "aspect_type": "delete", "owner_id": 777, "event_time": 1700000500 })).await;
    drain().await;
    let acts = app.get("/v1/me/activities", Some(&ana)).await;
    assert_eq!(matched(&acts.ok()["items"], "Rodagem leve"), w.as_str());

    // Disconnecting removes the synced runs: the automatic completion goes too.
    app.delete("/v1/me/connections/strava", Some(&ana)).await;
    drain().await;
    let mine = app
        .get(&format!("/v1/clubs/{club}/my/workouts/{w}"), Some(&ana))
        .await;
    assert_eq!(mine.ok()["completion"], Value::Null);
}
