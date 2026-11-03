//! S6c races (W12, M9): the club's race calendar, sign-ups by students or the staff, the goal race driving the
//! profile goal, results becoming the recent race. Same behavior as api/mock/routes/races.mjs.

mod common;

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

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_race_calendar(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let path = format!("/v1/clubs/{}/races", c.id);

    // Validation, staff only.
    let bad = app
        .post(
            &path,
            Some(&c.owner),
            json!({ "name": " ", "distances_m": [], "sport": "chess", "start_time": "7h" }),
        )
        .await;
    bad.problem(422, "validation.failed");
    let fields: Vec<&str> = bad.body["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(
        fields,
        ["name", "date", "distances_m", "sport", "start_time"]
    );
    app.post(
        &path,
        Some(&c.ana.0),
        json!({ "name": "X", "date": "2026-12-06", "distances_m": [5000] }),
    )
    .await
    .problem(403, "auth.forbidden");

    // Distances are deduplicated and sorted; empty strings clear.
    let created = app
        .post(
            &path,
            Some(&c.owner),
            json!({ "name": " Meia de Porto Alegre ", "date": "2026-12-06", "start_time": "07:00", "city": "Porto Alegre",
                    "state": "rs", "url": "", "distances_m": [21097, 5000, 5000, 10000] }),
        )
        .await;
    assert_eq!(created.status.as_u16(), 201);
    let race = created.body["id"].as_str().unwrap().to_string();
    assert_eq!(created.body["name"], "Meia de Porto Alegre");
    assert_eq!(created.body["sport"], "run");
    assert_eq!(created.body["start_time"], "07:00");
    assert_eq!(created.body["state"], "RS");
    assert!(created.body["url"].is_null());
    assert_eq!(created.body["distances_m"], json!([5000, 10000, 21097]));
    assert_eq!(created.body["entries_count"], 0);
    assert!(created.body["my_entry"].is_null());
    assert_eq!(created.body["entries"], json!([]));
    app.post(
        &path,
        Some(&c.owner),
        json!({ "name": "Travessia", "sport": "swim", "date": "2027-02-14", "distances_m": [1500] }),
    )
    .await
    .ok();

    // Range filter; students don't see the entries list.
    let dec = app
        .get(
            &format!("{path}?from=2026-12-01&to=2026-12-31"),
            Some(&c.ana.0),
        )
        .await;
    assert_eq!(dec.ok()["items"].as_array().unwrap().len(), 1);
    assert!(dec.body["items"][0].get("entries").is_none());
    assert_eq!(
        app.get(&path, Some(&c.ana.0)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    // Edit; clear a field; unknown race.
    let edited = app
        .patch(
            &format!("{path}/{race}"),
            Some(&c.owner),
            json!({ "notes": "Largada no Gasômetro", "start_time": "" }),
        )
        .await;
    assert_eq!(edited.ok()["notes"], "Largada no Gasômetro");
    assert!(edited.body["start_time"].is_null());
    app.get(
        &format!("{path}/00000000-0000-0000-0000-000000000000"),
        Some(&c.ana.0),
    )
    .await
    .problem(404, "race.not_found");

    // Archive: gone from the calendar.
    assert_eq!(
        app.delete(&format!("{path}/{race}"), Some(&c.owner))
            .await
            .status
            .as_u16(),
        204
    );
    app.get(&format!("{path}/{race}"), Some(&c.owner))
        .await
        .problem(404, "race.not_found");
    assert_eq!(
        app.get(&path, Some(&c.owner)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn entries_goals_and_results(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let path = format!("/v1/clubs/{}/races", c.id);
    let race = app
        .post(
            &path,
            Some(&c.owner),
            json!({ "name": "Meia de POA", "date": "2026-12-06", "distances_m": [10000, 21097] }),
        )
        .await
        .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    let entries = format!("{path}/{race}/entries");
    let profile = |m: &str| format!("/v1/clubs/{}/athletes/{m}", c.id);

    // A student signs herself up; the distance must be one of the race's.
    app.post(&entries, Some(&c.ana.0), json!({ "distance_m": 5000 }))
        .await
        .problem(422, "validation.failed");
    app.post(&entries, Some(&c.ana.0), json!({ "goal_time_s": -1 }))
        .await
        .problem(422, "validation.failed");
    let first = app
        .post(
            &entries,
            Some(&c.ana.0),
            json!({ "distance_m": 21097, "goal_time_s": 6300, "is_goal": true }),
        )
        .await;
    assert_eq!(first.status.as_u16(), 201);
    let entry = first.body["id"].as_str().unwrap().to_string();
    assert_eq!(first.body["membership_id"], c.ana.1.as_str());
    assert_eq!(first.body["status"], "registered");

    // The goal race sets the profile goal and date.
    let p = app.get(&profile(&c.ana.1), Some(&c.owner)).await;
    assert_eq!(p.ok()["profile"]["goal"], "21k");
    assert_eq!(p.body["profile"]["goal_date"], "2026-12-06");

    // Signing up again updates the entry (200); a new distance moves the goal.
    let again = app
        .post(&entries, Some(&c.ana.0), json!({ "distance_m": 10000 }))
        .await;
    assert_eq!(again.status.as_u16(), 200);
    assert_eq!(again.body["id"], entry.as_str());
    assert_eq!(again.body["goal_time_s"], 6300);
    assert_eq!(
        app.get(&profile(&c.ana.1), Some(&c.owner)).await.ok()["profile"]["goal"],
        "10k"
    );

    // Staff sign a student up (membership required); the staff view lists the athletes.
    app.post(&entries, Some(&c.owner), json!({ "distance_m": 10000 }))
        .await
        .problem(422, "validation.failed");
    let bia = app
        .post(
            &entries,
            Some(&c.owner),
            json!({ "membership_id": c.bia.1, "distance_m": 10000 }),
        )
        .await;
    assert_eq!(bia.status.as_u16(), 201);
    let bia_entry = bia.body["id"].as_str().unwrap().to_string();
    let staff = app.get(&format!("{path}/{race}"), Some(&c.owner)).await;
    assert_eq!(staff.ok()["entries_count"], 2);
    assert_eq!(
        staff.body["entries"][0]["athlete"]["user"]["email"],
        "ana@email.com"
    );
    let mine = app.get(&format!("{path}/{race}"), Some(&c.ana.0)).await;
    assert_eq!(mine.ok()["my_entry"]["id"], entry.as_str());

    // A used distance can't be removed; moving the race date moves the goal date.
    app.patch(
        &format!("{path}/{race}"),
        Some(&c.owner),
        json!({ "distances_m": [21097] }),
    )
    .await
    .problem(409, "race.distance_in_use");
    app.patch(
        &format!("{path}/{race}"),
        Some(&c.owner),
        json!({ "date": "2026-12-13" }),
    )
    .await
    .ok();
    assert_eq!(
        app.get(&profile(&c.ana.1), Some(&c.owner)).await.ok()["profile"]["goal_date"],
        "2026-12-13"
    );

    // Results: finished needs a time; a finished run becomes the recent race.
    let edit = format!("/v1/clubs/{}/race-entries/{entry}", c.id);
    app.patch(&edit, Some(&c.ana.0), json!({ "status": "finished" }))
        .await
        .problem(422, "validation.failed");
    app.patch(&edit, Some(&c.ana.0), json!({ "status": "won" }))
        .await
        .problem(422, "validation.failed");
    let done = app
        .patch(
            &edit,
            Some(&c.ana.0),
            json!({ "status": "finished", "result_time_s": 2950, "result_position": 12 }),
        )
        .await;
    assert_eq!(done.ok()["result_time_s"], 2950);
    let after = app.get(&profile(&c.ana.1), Some(&c.owner)).await;
    assert_eq!(
        after.ok()["profile"]["recent_race"],
        json!({ "distance_m": 10000, "time_s": 2950, "date": "2026-12-13" })
    );

    // Students only reach their own entries; withdrawing deletes the entry.
    let bia_path = format!("/v1/clubs/{}/race-entries/{bia_entry}", c.id);
    app.patch(&bia_path, Some(&c.ana.0), json!({ "status": "dns" }))
        .await
        .problem(404, "race_entry.not_found");
    assert_eq!(
        app.delete(&bia_path, Some(&c.bia.0)).await.status.as_u16(),
        204
    );
    app.delete(&bia_path, Some(&c.owner))
        .await
        .problem(404, "race_entry.not_found");
    assert_eq!(
        app.get(&format!("{path}/{race}"), Some(&c.owner))
            .await
            .ok()["entries_count"],
        1
    );
}
