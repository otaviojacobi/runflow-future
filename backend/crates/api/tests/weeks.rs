//! F34 week release (D-031): drafts stay with the trainer until the week is released, by hand or automatically.

mod common;

use chrono::{Duration, NaiveDate, Utc};
use common::TestApp;
use runflow_domain::week;
use serde_json::{Value, json};
use sqlx::PgPool;

const SP: &str = "America/Sao_Paulo";

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

fn this_monday() -> NaiveDate {
    week::this_monday(Utc::now(), SP)
}

async fn assign(app: &TestApp, c: &Club, athletes: &[&str], date: NaiveDate) -> String {
    let r = app
        .post(
            &format!("/v1/clubs/{}/planned-workouts", c.id),
            Some(&c.owner),
            json!({ "athlete_ids": athletes, "dates": [date], "sport": "run", "title": "Rodagem 40'",
                    "structure": { "v": 1, "blocks": [{ "kind": "step", "intent": "active", "duration": { "type": "time", "s": 2400 }, "target": { "type": "zone", "metric": "pace", "zone": 2 } }] } }),
        )
        .await;
    r.body["items"][0]["id"]
        .as_str()
        .unwrap_or_else(|| panic!("assign: {}", r.body))
        .to_string()
}

async fn kinds(app: &TestApp, token: &str) -> Vec<(String, String)> {
    app.get("/v1/me/notifications", Some(token)).await.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| {
            (
                n["kind"].as_str().unwrap().to_string(),
                n["body"].as_str().unwrap_or("").to_string(),
            )
        })
        .collect()
}

async fn mine(app: &TestApp, c: &Club, from: NaiveDate, to: NaiveDate) -> Value {
    app.get(
        &format!("/v1/clubs/{}/my/workouts?from={from}&to={to}", c.id),
        Some(&c.ana.0),
    )
    .await
    .ok()
    .clone()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn drafts_stay_hidden_until_the_week_is_released(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let (monday, next) = (this_monday(), this_monday() + Duration::days(7));
    let club = app
        .get(&format!("/v1/clubs/{}", c.id), Some(&c.owner))
        .await;
    assert_eq!(
        club.ok()["release_mode"],
        "weekly",
        "new clubs plan ahead in private"
    );
    assert_eq!(club.ok()["auto_release_weekday"], 7);
    assert_eq!(club.ok()["auto_release_time"], "18:00");

    let now_id = assign(&app, &c, &[&c.ana.1], monday + Duration::days(2)).await;
    let draft = assign(&app, &c, &[&c.ana.1], next + Duration::days(1)).await;

    // The trainer sees both; the draft is marked.
    let staff = app
        .get(
            &format!(
                "/v1/clubs/{}/planned-workouts?from={monday}&to={}",
                c.id,
                next + Duration::days(6)
            ),
            Some(&c.owner),
        )
        .await;
    let visible: Vec<(String, bool)> = staff.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| {
            (
                w["id"].as_str().unwrap().to_string(),
                w["visible"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(visible, [(now_id.clone(), true), (draft.clone(), false)]);

    // The student: only this week's workout, one notification, and next week announced as not released yet.
    assert_eq!(
        kinds(&app, &c.ana.0).await.len(),
        1,
        "the draft was assigned in silence"
    );
    let mine_now = mine(&app, &c, monday, next + Duration::days(6)).await;
    let ids: Vec<&str> = mine_now["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [now_id.as_str()]);
    let pending = &mine_now["unreleased_weeks"][0];
    assert_eq!(pending["week_start"], next.to_string());
    assert_eq!(
        pending["auto_release_at"].as_str().unwrap(),
        week::auto_release_at(next, 7, week::parse_hhmm("18:00").unwrap(), SP)
            .unwrap()
            .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
    );
    for path in [
        format!("/v1/clubs/{}/my/workouts/{draft}", c.id),
        format!("/v1/clubs/{}/planned-workouts/{draft}/comments", c.id),
    ] {
        app.get(&path, Some(&c.ana.0))
            .await
            .problem(404, "workout.not_found");
    }
    app.call(
        axum::http::Method::PUT,
        &format!("/v1/clubs/{}/my/workouts/{draft}/completion", c.id),
        Some(&c.ana.0),
        Some(json!({ "status": "completed" })),
        &[],
    )
    .await
    .problem(404, "workout.not_found");

    // The week as the planning screen sees it.
    let week_path = format!("/v1/clubs/{}/weeks/{next}", c.id);
    let w = app.get(&week_path, Some(&c.owner)).await;
    assert_eq!(w.ok()["started"], false);
    assert_eq!(w.ok()["drafts"], 1);
    assert!(w.ok()["released_at"].is_null() && w.ok()["auto_release_at"].is_string());
    app.get(&week_path, Some(&c.ana.0))
        .await
        .problem(403, "auth.forbidden");
    app.get(
        &format!("/v1/clubs/{}/weeks/{}", c.id, next + Duration::days(1)),
        Some(&c.owner),
    )
    .await
    .problem(400, "week.invalid");
    app.post(
        &format!("/v1/clubs/{}/weeks/{monday}/release", c.id),
        Some(&c.owner),
        json!({}),
    )
    .await
    .problem(409, "week.started");

    // Release to Bia only: Ana's draft stays hidden.
    let some = app
        .post(
            &format!("{week_path}/release"),
            Some(&c.owner),
            json!({ "athlete_ids": [c.bia.1] }),
        )
        .await;
    assert_eq!(some.ok()["released_athlete_ids"], json!([c.bia.1]));
    assert_eq!(some.ok()["drafts"], 1);
    app.post(
        &format!("{week_path}/release"),
        Some(&c.owner),
        json!({ "athlete_ids": ["nobody"] }),
    )
    .await
    .problem(422, "validation.failed");

    // Release to everyone: Ana sees it, with one week_released notification.
    let all = app
        .post(&format!("{week_path}/release"), Some(&c.owner), json!({}))
        .await;
    assert!(all.ok()["released_at"].is_string());
    assert_eq!(all.ok()["drafts"], 0);
    assert!(all.ok()["auto_release_at"].is_null());
    let notes = kinds(&app, &c.ana.0).await;
    let expected = week::release_notice(next, 1).1;
    assert_eq!(notes[0], ("week_released".to_string(), expected));
    let after = mine(&app, &c, next, next + Duration::days(6)).await;
    assert_eq!(after["items"][0]["id"], draft.as_str());
    assert_eq!(after["unreleased_weeks"], json!([]));
    app.get(
        &format!("/v1/clubs/{}/my/workouts/{draft}", c.id),
        Some(&c.ana.0),
    )
    .await
    .ok();

    // Undo: back to a draft.
    let undone = app
        .delete(&format!("{week_path}/release"), Some(&c.owner))
        .await;
    assert!(undone.ok()["released_at"].is_null());
    assert_eq!(
        mine(&app, &c, next, next + Duration::days(6)).await["items"],
        json!([])
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn immediate_clubs_and_switching_modes(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let club_path = format!("/v1/clubs/{}", c.id);
    let next = this_monday() + Duration::days(7);

    let bad = app
        .patch(
            &club_path,
            Some(&c.owner),
            json!({ "release_mode": "monthly", "auto_release_weekday": 9 }),
        )
        .await;
    let fields: Vec<&str> = bad.problem(422, "validation.failed")["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(fields, ["release_mode", "auto_release_time"]);
    let off = app
        .patch(
            &club_path,
            Some(&c.owner),
            json!({ "auto_release_weekday": null, "auto_release_time": null }),
        )
        .await;
    assert!(off.ok()["auto_release_weekday"].is_null() && off.ok()["auto_release_time"].is_null());
    let friday = app
        .patch(
            &club_path,
            Some(&c.owner),
            json!({ "auto_release_weekday": 5, "auto_release_time": "07:30" }),
        )
        .await;
    assert_eq!(friday.ok()["auto_release_time"], "07:30");
    app.patch(
        &club_path,
        Some(&c.ana.0),
        json!({ "release_mode": "immediate" }),
    )
    .await
    .problem(403, "auth.forbidden");

    // Immediate: visible and announced at once; nothing to release.
    app.patch(
        &club_path,
        Some(&c.owner),
        json!({ "release_mode": "immediate" }),
    )
    .await
    .ok();
    let id = assign(&app, &c, &[&c.ana.1], next + Duration::days(2)).await;
    assert_eq!(kinds(&app, &c.ana.0).await[0].0, "workout_assigned");
    assert_eq!(
        mine(&app, &c, next, next + Duration::days(6)).await["items"][0]["id"],
        id.as_str()
    );
    app.post(
        &format!("/v1/clubs/{}/weeks/{next}/release", c.id),
        Some(&c.owner),
        json!({}),
    )
    .await
    .problem(409, "week.release_off");

    // Back to weekly: what Ana already saw stays visible; a new week starts as a draft.
    app.patch(
        &club_path,
        Some(&c.owner),
        json!({ "release_mode": "weekly" }),
    )
    .await
    .ok();
    assert_eq!(
        mine(&app, &c, next, next + Duration::days(6)).await["items"][0]["id"],
        id.as_str()
    );
    let later = next + Duration::days(7);
    assign(&app, &c, &[&c.ana.1], later).await;
    assert_eq!(
        mine(&app, &c, later, later + Duration::days(6)).await["items"],
        json!([])
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_worker_releases_next_week_on_schedule(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let next = this_monday() + Duration::days(7);
    assign(&app, &c, &[&c.ana.1, &c.bia.1], next + Duration::days(3)).await;

    // Sunday 18:00 (the default) is still ahead at the start of the week: nothing happens yet.
    let monday_morning =
        week::auto_release_at(this_monday(), 1, week::parse_hhmm("00:01").unwrap(), SP).unwrap()
            + Duration::days(7);
    assert_eq!(app.tick(monday_morning).await, 0);

    // A club that releases on Monday 00:00 is due as soon as its week starts.
    app.patch(
        &format!("/v1/clubs/{}", c.id),
        Some(&c.owner),
        json!({ "auto_release_weekday": 1, "auto_release_time": "00:00" }),
    )
    .await
    .ok();
    assert_eq!(app.tick(Utc::now()).await, 1);
    assert_eq!(app.tick(Utc::now()).await, 0, "idempotent");
    for (token, _) in [&c.ana, &c.bia] {
        assert_eq!(kinds(&app, token).await[0].0, "week_released");
    }
    let w = app
        .get(&format!("/v1/clubs/{}/weeks/{next}", c.id), Some(&c.owner))
        .await;
    assert!(w.ok()["released_at"].is_string());
    assert_eq!(w.ok()["drafts"], 0);
}
