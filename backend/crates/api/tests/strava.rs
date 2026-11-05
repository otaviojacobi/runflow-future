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
    // The detailed activity (D-055): laps, Strava's per-km splits and the full route on top of the list's fields.
    let detail = |State(f): State<Arc<Mutex<Fake>>>, Path(id): Path<i64>| async move {
        f.lock().unwrap().calls.push(format!("activity:{id}"));
        let mut a = match id {
            1001 => run(id, "Rodagem leve", 2),
            1002 => run(id, "Longão", 5),
            _ => run(id, "Tiros na pista", 0),
        };
        a["laps"] = json!([{ "lap_index": 1, "distance": 400.0, "moving_time": 92, "elapsed_time": 95, "average_heartrate": 171.0, "max_heartrate": 180.0 }]);
        a["splits_metric"] = json!([{ "split": 1, "distance": 1000.0, "moving_time": 335, "elapsed_time": 340, "average_heartrate": 149.0, "elevation_difference": 4.0 }]);
        a["map"]["polyline"] = json!("full-route");
        a["calories"] = json!(420.0);
        Json(a)
    };
    let streams = |State(f): State<Arc<Mutex<Fake>>>, Path(id): Path<i64>| async move {
        f.lock().unwrap().calls.push(format!("streams:{id}"));
        Json(json!({
            "time": { "data": [0, 60, 120] },
            "distance": { "data": [0.0, 170.4, 340.9] },
            "heartrate": { "data": [118, 151, 163] },
            "latlng": { "data": [[-30.03, -51.22], [-30.031, -51.221], [-30.032, -51.222]] }
        }))
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
        .route("/api/v3/activities/{id}/streams", get(streams))
        .with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, fake)
}

/// The person's `activity_synced` notifications (D-055).
async fn activity_synced(app: &TestApp, token: &str) -> Vec<Value> {
    app.get("/v1/me/notifications", Some(token)).await.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["kind"] == "activity_synced")
        .cloned()
        .collect()
}

/// A new club (immediate release) owned by `owner`'s account → its id.
async fn club(app: &TestApp, owner: &str, name: &str) -> String {
    let id = app
        .post(
            "/v1/clubs",
            Some(owner),
            json!({ "name": name, "modalities": ["run"] }),
        )
        .await
        .body["club"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    app.patch(
        &format!("/v1/clubs/{id}"),
        Some(owner),
        json!({ "release_mode": "immediate" }),
    )
    .await
    .ok();
    id
}

/// `email` joins `club` as a student through an invite → (their token, their membership id). Only students connect
/// Strava (D-011).
async fn student(app: &TestApp, owner: &str, club: &str, email: &str) -> (String, String) {
    let token = app.sign_in(email).await;
    let membership = join(app, owner, club, email, &token).await;
    (token, membership)
}

/// The signed-in `email` (`token`) accepts an invite to `club` as a student → the membership id.
async fn join(app: &TestApp, owner: &str, club: &str, email: &str, token: &str) -> String {
    let invite = app
        .post(
            &format!("/v1/clubs/{club}/invites"),
            Some(owner),
            json!({ "email": email }),
        )
        .await;
    let link = invite.body["url"]
        .as_str()
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_string();
    app.post(
        &format!("/v1/invites/{link}/accept"),
        Some(token),
        json!({}),
    )
    .await
    .body["membership"]["id"]
        .as_str()
        .unwrap()
        .to_string()
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
    let owner = app.sign_in("marcos@email.com").await;
    let pace = club(&app, &owner, "Pace Forte").await;
    let (ana, _) = student(&app, &owner, &pace, "ana@email.com").await;

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
    let (bia, _) = student(&app, &owner, &pace, "bia@email.com").await;
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

    // D-055: the list has no laps or splits, so each listed run is fetched in detail by its own job (a few seconds
    // apart), then its time series; and `runflow strava-refetch` queues the imported ones again.
    sqlx::query("UPDATE jobs SET run_at = now() WHERE kind = 'strava.activity'")
        .execute(app.db())
        .await
        .unwrap();
    app.run_jobs().await;
    app.run_jobs().await;
    let calls = fake.lock().unwrap().calls.clone();
    for c in [
        "activity:1001",
        "activity:1002",
        "streams:1001",
        "streams:1002",
    ] {
        assert!(calls.contains(&c.to_string()), "{c} in {calls:?}");
    }
    let detailed = app.get("/v1/me/activities", Some(&ana)).await;
    assert_eq!(detailed.ok()["items"][0]["splits"][0]["n"], 1);
    assert_eq!(
        activity_synced(&app, &ana).await.len(),
        0,
        "a sync's activities aren't news"
    );
    assert_eq!(
        runflow_db::providers::queue_refetch(app.db(), 30)
            .await
            .unwrap(),
        2
    );

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
    let owner = app.sign_in("marcos@email.com").await;
    let pace = club(&app, &owner, "Pace Forte").await;
    let (ana, _) = student(&app, &owner, &pace, "ana@email.com").await;
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

    // D-055: the detail carries the laps with their pauses, Strava's per-km splits, the full route and the sampled
    // time series (fetched by its own job); lists don't carry the route or the series.
    let track_id = track["id"].as_str().unwrap().to_string();
    assert_eq!(
        (
            track["laps"][0]["elapsed_s"].as_i64(),
            track["laps"][0]["max_hr"].as_i64(),
            track["splits"][0]["avg_pace_s_per_km"].as_i64()
        ),
        (Some(95), Some(180), Some(335))
    );
    assert!(track.get("analysis").is_none() && track.get("route_polyline").is_none());
    app.run_jobs().await;
    assert!(
        fake.lock()
            .unwrap()
            .calls
            .contains(&"streams:2001".to_string())
    );
    let d = app
        .get(&format!("/v1/me/activities/{track_id}"), Some(&ana))
        .await;
    assert_eq!(d.ok()["analysis"]["route_polyline"], "full-route");
    assert_eq!(
        d.body["analysis"]["streams"]["heartrate"],
        json!([118.0, 151.0, 163.0])
    );
    assert_eq!(
        d.body["analysis"]["streams"]["latlng"][2],
        json!([-30.032, -51.222])
    );

    // The new activity told its athlete once (a duplicate event or an edit doesn't), linking to it; the activities a
    // sync listed and fetched in detail don't notify. The push is on by default and can be switched off (C1).
    let notes = activity_synced(&app, &ana).await;
    assert_eq!(notes.len(), 1);
    assert_eq!(
        (
            notes[0]["title"].as_str(),
            notes[0]["body"].as_str(),
            notes[0]["link"].as_str()
        ),
        (
            Some("Atividade sincronizada"),
            Some("Tiros na pista · 6,0 km · 34:00"),
            Some(format!("/activities/{track_id}").as_str())
        )
    );
    app.post("/v1/webhooks/strava", None, json!({ "object_type": "activity", "object_id": 2001, "aspect_type": "update", "owner_id": 777, "event_time": 1700000050 })).await;
    app.run_jobs().await;
    assert_eq!(activity_synced(&app, &ana).await.len(), 1);
    assert_eq!(
        app.get("/v1/me/prefs", Some(&ana)).await.ok()["kinds"]["activity_synced"]["push"],
        true
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

/// D-011, § Strava sharing: only students connect; connecting shares Strava with every club where they're a student;
/// a sync that no club can see any more is disconnected (deleted here, deauthorized at Strava).
#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn strava_needs_a_club_and_follows_sharing(db: PgPool) {
    let (url, fake) = fake_strava().await;
    let app = TestApp::new(db).with_strava(&url);
    let owner = app.sign_in("marcos@email.com").await;
    let pace = club(&app, &owner, "Pace Forte").await;
    let mare_owner = app.sign_in("renata@email.com").await;
    let mare = club(&app, &mare_owner, "Equipe Maré").await;

    // Staff only (no student membership): no Strava, at start and at the callback.
    app.post("/v1/me/connections/strava/start", Some(&owner), json!({}))
        .await
        .problem(409, "strava.no_club");
    app.post(
        "/v1/me/connections/strava/callback",
        Some(&owner),
        json!({ "code": "good", "state": "x.y" }),
    )
    .await
    .problem(400, "strava.state_invalid");

    // Ana trains with both clubs and hasn't consented to anything yet: connecting shares with both.
    let (ana, _) = student(&app, &owner, &pace, "ana@email.com").await;
    join(&app, &mare_owner, &mare, "ana@email.com", &ana).await;
    connect(&app, &ana).await;
    app.run_jobs().await;
    let active = |kind: &'static str| {
        let app = &app;
        let ana = ana.clone();
        async move {
            let mut clubs: Vec<String> = app.get("/v1/me/consents", Some(&ana)).await.ok()["items"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|c| c["kind"] == kind && c["revoked_at"].is_null())
                .map(|c| c["club_id"].as_str().unwrap().to_string())
                .collect();
            clubs.sort();
            clubs
        }
    };
    let mut both = vec![pace.clone(), mare.clone()];
    both.sort();
    assert_eq!(active("share_training_data").await, both);
    assert_eq!(active("share_strava").await, both);
    let synced = || async {
        app.get("/v1/me/activities", Some(&ana)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len()
    };
    assert_eq!(synced().await, 2);
    let consent = |kind: &'static str, club: String| {
        let app = &app;
        let ana = ana.clone();
        async move {
            app.get("/v1/me/consents", Some(&ana)).await.ok()["items"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| {
                    c["kind"] == kind && c["club_id"] == club.as_str() && c["revoked_at"].is_null()
                })
                .unwrap()["id"]
                .as_str()
                .unwrap()
                .to_string()
        }
    };

    // Stopping Strava sharing with one club: Equipe Maré still sees it, the connection stays.
    let id = consent("share_strava", pace.clone()).await;
    assert_eq!(
        app.delete(&format!("/v1/me/consents/{id}"), Some(&ana))
            .await
            .status,
        204
    );
    app.run_jobs().await;
    let conns = app.get("/v1/me/connections", Some(&ana)).await;
    assert_eq!(conns.ok()["items"][0]["connection"]["status"], "active");
    assert_eq!(synced().await, 2);
    assert!(
        !fake
            .lock()
            .unwrap()
            .calls
            .contains(&"deauthorize".to_string())
    );

    // Stopping training-data sharing with the last club that saw it: nobody sees the sync, so it's disconnected.
    let id = consent("share_training_data", mare.clone()).await;
    assert_eq!(
        app.delete(&format!("/v1/me/consents/{id}"), Some(&ana))
            .await
            .status,
        204
    );
    app.run_jobs().await;
    assert_eq!(
        app.get("/v1/me/connections", Some(&ana)).await.ok()["items"][0]["connection"],
        Value::Null
    );
    assert_eq!(synced().await, 0);
    assert!(active("share_strava").await.is_empty());
    assert!(
        fake.lock()
            .unwrap()
            .calls
            .contains(&"deauthorize".to_string()),
        "Strava told too"
    );
}

/// D-011: being suspended by the owner, or the club closing, leaves no club seeing the sync → disconnected.
#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn suspension_and_closing_disconnect_strava(db: PgPool) {
    let (url, _fake) = fake_strava().await;
    let app = TestApp::new(db).with_strava(&url);
    let owner = app.sign_in("marcos@email.com").await;
    let pace = club(&app, &owner, "Pace Forte").await;
    let (ana, member) = student(&app, &owner, &pace, "ana@email.com").await;
    connect(&app, &ana).await;
    app.run_jobs().await;
    let connected = |token: String| {
        let app = &app;
        async move {
            !app.get("/v1/me/connections", Some(&token)).await.ok()["items"][0]["connection"]
                .is_null()
        }
    };
    assert!(connected(ana.clone()).await);
    app.patch(
        &format!("/v1/clubs/{pace}/members/{member}"),
        Some(&owner),
        json!({ "status": "suspended" }),
    )
    .await
    .ok();
    assert!(!connected(ana.clone()).await, "suspended: disconnected");

    // Reactivated, connected again; then the owner closes the club.
    app.patch(
        &format!("/v1/clubs/{pace}/members/{member}"),
        Some(&owner),
        json!({ "status": "active" }),
    )
    .await
    .ok();
    connect(&app, &ana).await;
    assert!(connected(ana.clone()).await);
    assert_eq!(
        app.call(
            axum::http::Method::DELETE,
            &format!("/v1/clubs/{pace}"),
            Some(&owner),
            Some(json!({ "confirm_name": "Pace Forte" })),
            &[],
        )
        .await
        .status,
        204
    );
    assert!(!connected(ana.clone()).await, "club closed: disconnected");
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
