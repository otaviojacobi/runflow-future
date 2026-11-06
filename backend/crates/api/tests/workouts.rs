//! S4: planned workouts (calendar, bulk assign, edit/move, copy week) and planilhas (grid, apply, unassign).

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
    group: String,
}

fn token_of(url: &str) -> String {
    url.rsplit('/').next().unwrap().to_string()
}

async fn student(app: &TestApp, club: &str, owner: &str, email: &str) -> (String, String) {
    let i = app
        .post(
            &format!("/v1/clubs/{club}/invites"),
            Some(owner),
            json!({ "email": email }),
        )
        .await;
    let t = app.sign_in(email).await;
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

fn structure() -> Value {
    json!({ "v": 1, "blocks": [{ "kind": "step", "intent": "active", "duration": { "type": "time", "s": 2400 }, "target": { "type": "zone", "metric": "pace", "zone": 2 } }] })
}

fn day(offset: i64) -> String {
    (Utc::now().date_naive() + Duration::days(offset))
        .format("%Y-%m-%d")
        .to_string()
}

fn next_monday() -> chrono::NaiveDate {
    let today = Utc::now().date_naive();
    today + Duration::days(7 - today.weekday().num_days_from_monday() as i64)
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn assign_list_edit_move_and_remove(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let path = format!("/v1/clubs/{}/planned-workouts", c.id);
    let template = app
        .get(
            &format!("/v1/clubs/{}/templates?q=tempo", c.id),
            Some(&c.owner),
        )
        .await
        .body["items"][0]
        .clone();

    let bad = app
        .post(
            &path,
            Some(&c.owner),
            json!({ "athlete_ids": ["x"], "dates": ["31/12"] }),
        )
        .await;
    let fields: Vec<&str> = bad.problem(422, "validation.failed")["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(fields, ["athlete_ids", "dates"]);
    app.post(
        &path,
        Some(&c.owner),
        json!({ "athlete_ids": [c.ana.1], "dates": [day(1)], "template_id": uuid::Uuid::now_v7() }),
    )
    .await
    .problem(404, "template.not_found");
    app.post(&path, Some(&c.owner), json!({ "athlete_ids": [c.ana.1], "dates": [day(1)], "sport": "run", "title": "x", "structure": { "v": 1, "blocks": [] } })).await.problem(422, "validation.failed");

    // Ana by id + Bia through her group; two days each, from the library.
    let res = app.post(&path, Some(&c.owner), json!({ "athlete_ids": [c.ana.1, c.ana.1], "group_id": c.group, "dates": [day(2), day(1), day(1)], "template_id": template["id"] })).await;
    assert_eq!(res.status, 201, "{}", res.body);
    let items = res.body["items"].as_array().unwrap().clone();
    assert_eq!(items.len(), 4);
    assert!(items.iter().all(|w| w["title"] == "Tempo run 30′"
        && w["template_id"] == template["id"]
        && w["completion"].is_null()
        && w["comments_count"] == 0));
    for (t, _) in [&c.ana, &c.bia] {
        let n = app.get("/v1/me/notifications", Some(t)).await;
        assert_eq!(n.ok()["items"][0]["title"], "2 novos treinos na sua agenda");
        assert_eq!(n.body["items"][0]["kind"], "workout_assigned");
    }

    // A free-form one on the same day goes after it.
    let free = app.post(&path, Some(&c.owner), json!({ "athlete_ids": [c.ana.1], "dates": [day(1)], "sport": "run", "title": "Soltar", "structure": structure(), "notes": "Bem leve", "est_duration_s": 2400 })).await;
    assert_eq!(
        (
            free.body["items"][0]["position"].as_i64(),
            free.body["items"][0]["notes"].as_str()
        ),
        (Some(1), Some("Bem leve"))
    );
    let fid = free.body["items"][0]["id"].as_str().unwrap().to_string();

    app.get(&path, Some(&c.owner))
        .await
        .problem(422, "validation.failed");
    let week = app
        .get(
            &format!("{path}?from={}&to={}", day(0), day(7)),
            Some(&c.owner),
        )
        .await;
    assert_eq!(week.ok()["items"].as_array().unwrap().len(), 5);
    assert_eq!(
        app.get(
            &format!(
                "{path}?from={}&to={}&athlete_id={}",
                day(0),
                day(7),
                c.ana.1
            ),
            Some(&c.owner)
        )
        .await
        .ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        app.get(
            &format!("{path}?from={}&to={}&group_id={}", day(0), day(7), c.group),
            Some(&c.owner)
        )
        .await
        .ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    app.get(
        &format!("{path}?from={}&to={}", day(0), day(7)),
        Some(&c.ana.0),
    )
    .await
    .problem(403, "auth.forbidden");

    // Detail: athlete, and the activity only with consent.
    let detail = app.get(&format!("{path}/{fid}"), Some(&c.owner)).await;
    assert_eq!(
        (
            detail.ok()["athlete"]["membership_id"].as_str(),
            &detail.body["activity"]
        ),
        (Some(c.ana.1.as_str()), &Value::Null)
    );
    let activity = uuid::Uuid::now_v7();
    sqlx::query("INSERT INTO activities (id, user_id, source, sport, name, started_at, duration_s, distance_m) SELECT $1, id, 'manual', 'run', 'Corrida', now(), 2400, 7000 FROM users WHERE email = 'ana@email.com'").bind(activity).execute(app.db()).await.unwrap();
    sqlx::query("INSERT INTO workout_completions (planned_workout_id, activity_id, status) VALUES ($1::uuid, $2, 'completed')").bind(&fid).bind(activity).execute(app.db()).await.unwrap();
    assert_eq!(
        app.get(&format!("{path}/{fid}"), Some(&c.owner)).await.ok()["activity"],
        Value::Null,
        "no consent, no activity"
    );
    app.post(
        "/v1/me/consents",
        Some(&c.ana.0),
        json!({ "kind": "share_training_data", "club_id": c.id }),
    )
    .await
    .ok();
    let shared = app.get(&format!("{path}/{fid}"), Some(&c.owner)).await;
    assert_eq!(
        (
            shared.ok()["activity"]["distance_m"].as_i64(),
            shared.body["completion"]["status"].as_str()
        ),
        (Some(7000), Some("completed"))
    );

    // Move: the student hears about it; so does a restructure.
    app.patch(
        &format!("{path}/{fid}"),
        Some(&c.owner),
        json!({ "date": "amanhã" }),
    )
    .await
    .problem(422, "validation.failed");
    // To a day of a week the student already sees: yesterday (UTC) is never past the club's today (Brazil runs
    // behind UTC). "In 3 days" fell in next week, still a draft, from Friday to Sunday, so nothing was announced.
    let moved = app
        .patch(
            &format!("{path}/{fid}"),
            Some(&c.owner),
            json!({ "date": day(-1) }),
        )
        .await;
    assert_eq!(moved.ok()["date"], day(-1));
    assert_eq!(
        app.get("/v1/me/notifications", Some(&c.ana.0)).await.ok()["items"][0]["title"],
        "Um treino mudou de dia"
    );
    app.patch(
        &format!("{path}/{fid}"),
        Some(&c.owner),
        json!({ "structure": structure(), "title": "Soltar 40′" }),
    )
    .await
    .ok();
    let n = app.get("/v1/me/notifications", Some(&c.ana.0)).await;
    assert_eq!(
        (
            n.ok()["items"][0]["title"].as_str(),
            n.body["items"][0]["body"].as_str()
        ),
        (Some("Seu treinador ajustou um treino"), Some("Soltar 40′"))
    );

    assert_eq!(
        app.delete(&format!("{path}/{fid}"), Some(&c.owner))
            .await
            .status,
        204
    );
    app.get(&format!("{path}/{fid}"), Some(&c.owner))
        .await
        .problem(404, "workout.not_found");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn copy_a_week(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let path = format!("/v1/clubs/{}/planned-workouts", c.id);
    let monday = next_monday();
    let d = |n: i64| (monday + Duration::days(n)).format("%Y-%m-%d").to_string();
    app.post(&path, Some(&c.owner), json!({ "athlete_ids": [c.ana.1, c.bia.1], "dates": [d(0), d(2), d(6)], "sport": "run", "title": "Base", "structure": structure() })).await.ok();

    app.post(
        &format!("{path}/copy-week"),
        Some(&c.owner),
        json!({ "from_monday": d(0), "to_monday": d(0) }),
    )
    .await
    .problem(422, "validation.failed");
    let only_ana = app
        .post(
            &format!("{path}/copy-week"),
            Some(&c.owner),
            json!({ "from_monday": d(0), "to_monday": d(7), "athlete_ids": [c.ana.1, "intruder"] }),
        )
        .await;
    assert_eq!(only_ana.body["copied"], 3);
    let all = app
        .post(
            &format!("{path}/copy-week"),
            Some(&c.owner),
            json!({ "from_monday": d(0), "to_monday": d(14) }),
        )
        .await;
    assert_eq!(all.body["copied"], 6);
    let next = app
        .get(
            &format!("{path}?from={}&to={}", d(14), d(20)),
            Some(&c.owner),
        )
        .await;
    let dates: Vec<&str> = next.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["date"].as_str().unwrap())
        .collect();
    assert_eq!(dates, [d(14), d(14), d(16), d(16), d(20), d(20)]);
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn planilhas_grid_apply_and_unassign(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let plans = format!("/v1/clubs/{}/plans", c.id);

    app.post(
        &plans,
        Some(&c.owner),
        json!({ "name": "Maratona", "weeks": 60 }),
    )
    .await
    .problem(422, "validation.failed");
    let p = app
        .post(
            &plans,
            Some(&c.owner),
            json!({ "name": "Base 3 semanas", "weeks": 3 }),
        )
        .await;
    assert_eq!(
        (p.status.as_u16(), &p.body["weekly_duration_s"]),
        (201, &json!([0, 0, 0]))
    );
    let pid = p.body["id"].as_str().unwrap().to_string();

    let monday = next_monday();
    app.post(
        &format!("{plans}/{pid}/assign"),
        Some(&c.owner),
        json!({ "start_date": monday.format("%Y-%m-%d").to_string(), "athlete_ids": [c.ana.1] }),
    )
    .await
    .problem(409, "plan.empty");

    let item = |week: i64, weekday: i64, s: i64| json!({ "week": week, "weekday": weekday, "sport": "run", "title": format!("S{week}D{weekday}"), "structure": structure(), "est_duration_s": s });
    app.call(
        Method::PUT,
        &format!("{plans}/{pid}/items"),
        Some(&c.owner),
        Some(json!({ "items": [item(4, 1, 100)] })),
        &[],
    )
    .await
    .problem(422, "validation.failed");
    let grid = app.call(Method::PUT, &format!("{plans}/{pid}/items"), Some(&c.owner), Some(json!({ "items": [item(1, 1, 2400), item(1, 3, 1800), item(2, 6, 3600), item(3, 7, 3000)] })), &[]).await;
    assert_eq!(
        (
            grid.ok()["items_count"].as_i64(),
            &grid.body["weekly_duration_s"]
        ),
        (Some(4), &json!([4200, 3600, 3000]))
    );

    let not_monday = (monday + Duration::days(1)).format("%Y-%m-%d").to_string();
    app.post(
        &format!("{plans}/{pid}/assign"),
        Some(&c.owner),
        json!({ "start_date": not_monday, "athlete_ids": [c.ana.1] }),
    )
    .await
    .problem(422, "validation.failed");
    let applied = app.post(&format!("{plans}/{pid}/assign"), Some(&c.owner), json!({ "start_date": monday.format("%Y-%m-%d").to_string(), "athlete_ids": [c.ana.1], "group_id": c.group })).await;
    assert_eq!(
        (
            applied.status.as_u16(),
            applied.body["assignments"].as_i64(),
            applied.body["workouts"].as_i64()
        ),
        (201, Some(2), Some(8))
    );
    // Next week is still a draft (D-031): nothing announced until the trainer releases it.
    let quiet = app.get("/v1/me/notifications", Some(&c.bia.0)).await;
    assert_eq!(quiet.ok()["items"], json!([]));
    app.post(
        &format!(
            "/v1/clubs/{}/weeks/{}/release",
            c.id,
            monday.format("%Y-%m-%d")
        ),
        Some(&c.owner),
        json!({}),
    )
    .await
    .ok();
    let note = app.get("/v1/me/notifications", Some(&c.bia.0)).await;
    assert_eq!(
        note.ok()["items"][0]["title"],
        "Sua semana de treinos está liberada"
    );
    assert!(
        note.body["items"][0]["body"]
            .as_str()
            .unwrap()
            .starts_with("2 treinos de ")
    );

    let detail = app.get(&format!("{plans}/{pid}"), Some(&c.owner)).await;
    let a = detail.ok()["assignments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["athlete_membership_id"] == c.ana.1.as_str())
        .unwrap()
        .clone();
    assert_eq!(
        (
            a["workouts"].as_i64(),
            a["done"].as_i64(),
            a["athlete"]["user"]["email"].as_str()
        ),
        (Some(4), Some(0), Some("ana@email.com"))
    );
    assert_eq!(detail.body["active_assignments"], 2);
    let last_sunday = (monday + Duration::days(20)).format("%Y-%m-%d").to_string();
    let ana_workouts = app
        .get(
            &format!(
                "/v1/clubs/{}/planned-workouts?from={}&to={last_sunday}&athlete_id={}",
                c.id,
                monday.format("%Y-%m-%d"),
                c.ana.1
            ),
            Some(&c.owner),
        )
        .await;
    let dates: Vec<&str> = ana_workouts.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["date"].as_str().unwrap())
        .collect();
    assert_eq!(
        dates.first().copied(),
        Some(monday.format("%Y-%m-%d").to_string().as_str())
    );
    assert_eq!(
        dates.last().copied(),
        Some(last_sunday.as_str()),
        "week 3, weekday 7"
    );

    // Unassign: future workouts go, a done one stays (detached).
    let done = ana_workouts.body["items"][0]["id"].as_str().unwrap();
    sqlx::query("INSERT INTO workout_completions (planned_workout_id, status) VALUES ($1::uuid, 'completed')").bind(done).execute(app.db()).await.unwrap();
    let removed = app
        .delete(
            &format!("{plans}/{pid}/assignments/{}", a["id"].as_str().unwrap()),
            Some(&c.owner),
        )
        .await;
    assert_eq!(removed.ok()["removed_workouts"], 3);
    let kept = app
        .get(
            &format!("/v1/clubs/{}/planned-workouts/{done}", c.id),
            Some(&c.owner),
        )
        .await;
    assert_eq!(kept.ok()["plan_assignment_id"], Value::Null);
    app.delete(
        &format!("{plans}/{pid}/assignments/{}", a["id"].as_str().unwrap()),
        Some(&c.owner),
    )
    .await
    .problem(404, "assignment.not_found");

    // Shrinking the plan drops the grid beyond the new end; archiving hides it.
    let shrunk = app
        .patch(
            &format!("{plans}/{pid}"),
            Some(&c.owner),
            json!({ "weeks": 2, "description": "Curta" }),
        )
        .await;
    assert_eq!(
        (
            shrunk.ok()["items_count"].as_i64(),
            &shrunk.body["weekly_duration_s"]
        ),
        (Some(3), &json!([4200, 3600]))
    );
    assert_eq!(
        app.delete(&format!("{plans}/{pid}"), Some(&c.owner))
            .await
            .status,
        204
    );
    assert_eq!(
        app.get(&plans, Some(&c.owner)).await.ok()["items"],
        json!([])
    );
}
