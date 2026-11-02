//! S4: workout library (templates, tags) and exercise library (global catalog + club exercises).

mod common;

use common::TestApp;
use serde_json::{Value, json};
use sqlx::PgPool;

async fn setup(app: &TestApp) -> (String, String) {
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
    (owner, club)
}

fn interval() -> Value {
    json!({ "v": 1, "blocks": [
        { "kind": "step", "intent": "warmup", "duration": { "type": "time", "s": 600 }, "target": { "type": "zone", "metric": "pace", "zone": 2 } },
        { "kind": "repeat", "count": 6, "steps": [
            { "kind": "step", "intent": "active", "duration": { "type": "distance", "m": 1000 }, "target": { "type": "pace", "min_s": 265, "max_s": 275 } },
            { "kind": "step", "intent": "recovery", "duration": { "type": "time", "s": 120 }, "target": { "type": "open" } } ] } ] })
}

fn names(v: &Value) -> Vec<String> {
    v["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn templates_validate_normalize_tags_and_search(db: PgPool) {
    let app = TestApp::new(db);
    let (owner, club) = setup(&app).await;
    let path = format!("/v1/clubs/{club}/templates");
    assert_eq!(
        app.get(&path, Some(&owner)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        8,
        "starter library"
    );

    let bad = app.post(&path, Some(&owner), json!({ "name": "", "sport": "chess", "structure": { "v": 1, "blocks": [] }, "tags": ["a","b","c","d","e","f","g","h","i"], "est_duration_s": -5 })).await;
    let fields: Vec<&str> = bad.problem(422, "validation.failed")["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(
        fields,
        ["name", "sport", "structure", "est_duration_s", "tags"]
    );
    let garbage = app.post(&path, Some(&owner), json!({ "name": "x", "sport": "run", "structure": { "v": 1, "blocks": [{ "kind": "teleport" }] } })).await;
    assert_eq!(
        garbage.problem(422, "validation.failed")["errors"][0]["message"],
        "Não entendemos a estrutura do treino. Revise as etapas."
    );

    let created = app.post(&path, Some(&owner), json!({ "name": "Tiros E2E", "sport": "run", "structure": interval(), "est_duration_s": 2700, "est_distance_m": 9000, "tags": ["#Tiros-Curtos", "Ritmo de Prova", "tiros-curtos"] })).await;
    assert_eq!(created.status, 201, "{}", created.body);
    assert_eq!(
        created.body["tags"],
        json!(["tiros-curtos", "ritmo-de-prova"])
    );
    assert_eq!(
        created.body["structure"],
        interval(),
        "stored exactly as sent"
    );
    let id = created.body["id"].as_str().unwrap().to_string();

    assert_eq!(
        names(
            app.get(&format!("{path}?q=%23ritmo"), Some(&owner))
                .await
                .ok()
        ),
        ["Tiros E2E"],
        "#search matches tags only"
    );
    assert!(
        names(
            app.get(&format!("{path}?q=%23tempo"), Some(&owner))
                .await
                .ok()
        )
        .is_empty(),
        "'Tempo run' isn't a tag"
    );
    assert_eq!(
        names(app.get(&format!("{path}?q=tempo"), Some(&owner)).await.ok()),
        ["Tempo run 30′"]
    );
    assert_eq!(
        names(
            app.get(&format!("{path}?tag=Tiros-Curtos"), Some(&owner))
                .await
                .ok()
        ),
        ["Tiros E2E"]
    );
    assert_eq!(
        app.get(&format!("{path}?sport=swim"), Some(&owner))
            .await
            .ok()["items"],
        json!([])
    );
    assert_eq!(
        names(app.get(&format!("{path}?limit=1"), Some(&owner)).await.ok()),
        ["Tiros E2E"],
        "most recently updated first"
    );

    let renamed = app
        .patch(
            &format!("{path}/{id}"),
            Some(&owner),
            json!({ "name": "Tiros curtos", "tags": [] }),
        )
        .await;
    assert_eq!(
        (
            renamed.ok()["name"].as_str(),
            &renamed.body["tags"],
            &renamed.body["structure"]
        ),
        (Some("Tiros curtos"), &json!([]), &interval())
    );
    app.patch(
        &format!("{path}/{id}"),
        Some(&owner),
        json!({ "structure": { "v": 1, "blocks": [] } }),
    )
    .await
    .problem(422, "validation.failed");

    // Students don't see the library; archived templates disappear.
    let student = app.sign_in("ana@email.com").await;
    sqlx::query("INSERT INTO memberships (id, club_id, user_id, role) SELECT gen_random_uuid(), $1::uuid, id, 'student' FROM users WHERE email = 'ana@email.com'").bind(&club).execute(app.db()).await.unwrap();
    app.get(&path, Some(&student))
        .await
        .problem(403, "auth.forbidden");
    assert_eq!(
        app.delete(&format!("{path}/{id}"), Some(&owner))
            .await
            .status,
        204
    );
    app.get(&format!("{path}/{id}"), Some(&owner))
        .await
        .problem(404, "template.not_found");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn exercises_mix_the_global_catalog_with_club_versions(db: PgPool) {
    let app = TestApp::new(db);
    assert_eq!(
        runflow_db::library::sync_exercise_catalog(app.db())
            .await
            .unwrap(),
        24
    );
    assert_eq!(
        runflow_db::library::sync_exercise_catalog(app.db())
            .await
            .unwrap(),
        24,
        "idempotent"
    );
    let (owner, club) = setup(&app).await;
    let path = format!("/v1/clubs/{club}/exercises");
    let student = app.sign_in("ana@email.com").await;
    sqlx::query("INSERT INTO memberships (id, club_id, user_id, role) SELECT gen_random_uuid(), $1::uuid, id, 'student' FROM users WHERE email = 'ana@email.com'").bind(&club).execute(app.db()).await.unwrap();

    let all = app.get(&path, Some(&student)).await;
    assert_eq!(
        all.ok()["items"].as_array().unwrap().len(),
        24,
        "students read the library (videos)"
    );
    assert!(
        all.body["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["scope"] == "global")
    );
    assert_eq!(
        app.get(&format!("{path}?category=core"), Some(&owner))
            .await
            .ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        names(
            app.get(&format!("{path}?q=glúteo"), Some(&owner))
                .await
                .ok()
        )
        .len(),
        9,
        "q matches muscles too (9 catalog exercises work the glutes)"
    );

    app.post(
        &path,
        Some(&student),
        json!({ "name": "x", "category": "core" }),
    )
    .await
    .problem(403, "auth.forbidden");
    let bad = app
        .post(
            &path,
            Some(&owner),
            json!({ "name": " ", "category": "yoga", "video_url": "https://evil.example/v" }),
        )
        .await;
    assert_eq!(
        bad.problem(422, "validation.failed")["errors"]
            .as_array()
            .unwrap()
            .len(),
        3
    );

    // A club version shadows the global one with the same name.
    let mine = app.post(&path, Some(&owner), json!({ "name": "agachamento livre ", "category": "strength", "muscles": ["quadríceps"], "video_url": "https://youtu.be/dQw4w9WgXcQ", "cues": "Do nosso jeito." })).await;
    assert_eq!(
        (mine.status.as_u16(), mine.body["scope"].as_str()),
        (201, Some("club"))
    );
    let listed = app
        .get(&format!("{path}?q=agachamento%20livre"), Some(&owner))
        .await;
    assert_eq!(listed.ok()["items"].as_array().unwrap().len(), 1);
    assert_eq!(listed.body["items"][0]["scope"], "club");
    app.post(
        &path,
        Some(&owner),
        json!({ "name": "Agachamento Livre", "category": "strength" }),
    )
    .await
    .problem(422, "validation.failed");

    let global = all.body["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["name"] == "Prancha")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    app.patch(
        &format!("{path}/{global}"),
        Some(&owner),
        json!({ "cues": "x" }),
    )
    .await
    .problem(403, "exercise.global");
    let mid = mine.body["id"].as_str().unwrap();
    assert_eq!(
        app.patch(
            &format!("{path}/{mid}"),
            Some(&owner),
            json!({ "video_url": null })
        )
        .await
        .ok()["video_url"],
        Value::Null
    );
    assert_eq!(
        app.delete(&format!("{path}/{mid}"), Some(&owner))
            .await
            .status,
        204
    );
    let back = app
        .get(&format!("{path}?q=agachamento%20livre"), Some(&owner))
        .await;
    assert_eq!(
        back.ok()["items"][0]["scope"],
        "global",
        "the global version is back"
    );
}
