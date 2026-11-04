//! S6b messages and the mural (W13, M10): conversations shared by the staff, read marks, deletions, announcements
//! to the club or some groups with receipts. Same behavior as api/mock/routes/messages.mjs.

mod common;

use axum::http::Method;
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
    sqlx::query("UPDATE users SET name = 'Marcos Lima' WHERE email = 'marcos@email.com'")
        .execute(app.db())
        .await
        .unwrap();
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

async fn titles(app: &TestApp, token: &str, kind: &str) -> Vec<String> {
    app.get("/v1/me/notifications", Some(token)).await.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["kind"] == kind)
        .map(|n| n["title"].as_str().unwrap().to_string())
        .collect()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn conversations_between_a_student_and_the_staff(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let path = format!("/v1/clubs/{}/conversations", c.id);

    // Staff see every student; nobody has written yet.
    let all = app.get(&path, Some(&c.owner)).await;
    assert_eq!(all.ok()["items"].as_array().unwrap().len(), 2);
    assert!(all.body["items"][0]["id"].is_null());

    // Ana's single conversation exists once she opens it; she writes to the staff.
    let mine = app.get(&path, Some(&c.ana.0)).await;
    let conv = mine.ok()["items"][0]["id"].as_str().unwrap().to_string();
    let empty = app
        .post(
            &format!("{path}/{conv}/messages"),
            Some(&c.ana.0),
            json!({ "body": "  " }),
        )
        .await;
    empty.problem(422, "validation.failed");
    let long = app
        .post(
            &format!("{path}/{conv}/messages"),
            Some(&c.ana.0),
            json!({ "body": "x".repeat(4001) }),
        )
        .await;
    long.problem(422, "validation.failed");
    let sent = app
        .post(
            &format!("{path}/{conv}/messages"),
            Some(&c.ana.0),
            json!({ "body": "Posso trocar o treino de quinta?" }),
        )
        .await;
    assert_eq!(sent.status.as_u16(), 201);
    let msg = sent.body["id"].as_str().unwrap().to_string();
    assert_eq!(titles(&app, &c.owner, "message").await, ["Mensagem de Ana"]);

    // The staff list puts her first, with one unread; reading clears it.
    let list = app.get(&path, Some(&c.owner)).await;
    assert_eq!(list.ok()["items"][0]["id"], conv.as_str());
    assert_eq!(list.body["items"][0]["unread_count"], 1);
    assert_eq!(
        list.body["items"][0]["last_message"]["body"],
        "Posso trocar o treino de quinta?"
    );
    assert_eq!(
        app.post(&format!("{path}/{conv}/read"), Some(&c.owner), json!({}))
            .await
            .status
            .as_u16(),
        204
    );
    assert_eq!(
        app.get(&path, Some(&c.owner)).await.ok()["items"][0]["unread_count"],
        0
    );

    // The staff reply reaches Ana; she sees who read her message.
    app.post(
        &format!("{path}/{conv}/messages"),
        Some(&c.owner),
        json!({ "body": "Pode sim!" }),
    )
    .await
    .ok();
    assert_eq!(
        titles(&app, &c.ana.0, "message").await,
        ["Marcos respondeu"]
    );
    let thread = app.get(&format!("{path}/{conv}"), Some(&c.ana.0)).await;
    assert_eq!(thread.ok()["messages"].as_array().unwrap().len(), 2);
    assert_eq!(thread.body["messages"][1]["author"]["role"], "owner");
    assert_eq!(thread.body["reads"][0]["role"], "owner");

    // Bia can't open Ana's conversation; only the author deletes a message (shown empty).
    app.get(&format!("{path}/{conv}"), Some(&c.bia.0))
        .await
        .problem(404, "conversation.not_found");
    app.delete(
        &format!("/v1/clubs/{}/messages/{msg}", c.id),
        Some(&c.owner),
    )
    .await
    .problem(404, "message.not_found");
    assert_eq!(
        app.delete(
            &format!("/v1/clubs/{}/messages/{msg}", c.id),
            Some(&c.ana.0)
        )
        .await
        .status
        .as_u16(),
        204
    );
    let after = app.get(&format!("{path}/{conv}"), Some(&c.owner)).await;
    assert_eq!(after.ok()["messages"][0]["body"], "");
    assert!(after.body["messages"][0]["deleted_at"].is_string());

    // Staff can open a conversation with a student who hasn't written.
    let opened = app
        .post(
            &path,
            Some(&c.owner),
            json!({ "student_membership_id": c.bia.1 }),
        )
        .await;
    assert_eq!(opened.ok()["student"]["membership_id"], c.bia.1.as_str());
    app.post(
        &path,
        Some(&c.owner),
        json!({ "student_membership_id": c.ana.0 }),
    )
    .await
    .problem(422, "validation.failed");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_mural_reaches_the_club_or_some_groups(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let path = format!("/v1/clubs/{}/announcements", c.id);

    app.post(&path, Some(&c.owner), json!({ "title": "", "body": "" }))
        .await
        .problem(422, "validation.failed");
    app.post(
        &path,
        Some(&c.ana.0),
        json!({ "title": "Oi", "body": "Oi" }),
    )
    .await
    .problem(403, "auth.forbidden");
    let all = app
        .post(
            &path,
            Some(&c.owner),
            json!({ "title": "Treino no feriado", "body": "Normal, às 6h30." }),
        )
        .await;
    assert_eq!(all.status.as_u16(), 201);
    assert_eq!(all.body["audience_count"], 2);
    let some = app
        .post(&path, Some(&c.owner), json!({ "title": "Iniciantes: tênis", "body": "Tragam o tênis novo.", "group_ids": [c.group], "pinned": true }))
        .await;
    let some_id = some.ok()["id"].as_str().unwrap().to_string();
    assert_eq!(some.body["audience_count"], 1);

    // Ana (no group) sees only the club-wide one; Bia sees both, the pinned one first. Both were notified as fits.
    let ana: Vec<Value> = app.get(&path, Some(&c.ana.0)).await.ok()["items"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(
        ana.iter()
            .map(|a| a["title"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["Treino no feriado"]
    );
    assert!(
        ana[0].get("audience_count").is_none(),
        "students don't see the counts"
    );
    let bia = app.get(&path, Some(&c.bia.0)).await;
    assert_eq!(bia.ok()["items"][0]["title"], "Iniciantes: tênis");
    assert_eq!(
        titles(&app, &c.ana.0, "announcement").await,
        ["Novo aviso: Treino no feriado"]
    );
    assert_eq!(titles(&app, &c.bia.0, "announcement").await.len(), 2);

    // Read receipts.
    assert_eq!(
        app.post(
            &format!("{path}/read"),
            Some(&c.bia.0),
            json!({ "ids": [some_id] })
        )
        .await
        .status
        .as_u16(),
        204
    );
    let reads = app
        .get(&format!("{path}/{some_id}/reads"), Some(&c.owner))
        .await;
    assert_eq!(reads.ok()["items"][0]["membership_id"], c.bia.1.as_str());
    assert!(reads.body["items"][0]["read_at"].is_string());
    assert_eq!(
        app.get(&path, Some(&c.owner)).await.ok()["items"][0]["reads_count"],
        1
    );

    // Edit (edited_at), unpin, delete.
    let edited = app
        .patch(
            &format!("{path}/{some_id}"),
            Some(&c.owner),
            json!({ "body": "Tênis e garrafa.", "pinned": false }),
        )
        .await;
    assert!(edited.ok()["edited_at"].is_string());
    assert_eq!(edited.body["pinned"], false);
    assert_eq!(
        app.delete(&format!("{path}/{some_id}"), Some(&c.owner))
            .await
            .status
            .as_u16(),
        204
    );
    app.get(&format!("{path}/{some_id}/reads"), Some(&c.owner))
        .await
        .problem(404, "announcement.not_found");
    assert_eq!(
        app.get(&path, Some(&c.bia.0)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

/// `/me` memberships[].unread for the (only) club: what the apps badge Mensagens with (the Feedbacks count,
/// `unread.feedback`, is tested with the inbox in my.rs).
async fn unread(app: &TestApp, token: &str) -> Value {
    let u = app.get("/v1/me", Some(token)).await.ok()["memberships"][0]["unread"].clone();
    json!({ "messages": u["messages"], "announcements": u["announcements"] })
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn mensagens_counts_what_is_unread(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let path = format!("/v1/clubs/{}/conversations", c.id);
    assert_eq!(
        unread(&app, &c.ana.0).await,
        json!({ "messages": 0, "announcements": 0 })
    );

    // Ana writes twice: the staff see 2, Ana nothing (her own).
    let conv = app.get(&path, Some(&c.ana.0)).await.ok()["items"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    for text in ["Oi", "Posso trocar o treino?"] {
        app.post(
            &format!("{path}/{conv}/messages"),
            Some(&c.ana.0),
            json!({ "body": text }),
        )
        .await
        .ok();
    }
    assert_eq!(unread(&app, &c.owner).await["messages"], 2);
    assert_eq!(unread(&app, &c.ana.0).await["messages"], 0);

    // The owner answers (which also reads the thread): Ana has 1, the owner none; reading clears Ana's.
    app.post(
        &format!("{path}/{conv}/messages"),
        Some(&c.owner),
        json!({ "body": "Pode sim" }),
    )
    .await
    .ok();
    assert_eq!(unread(&app, &c.ana.0).await["messages"], 1);
    assert_eq!(unread(&app, &c.owner).await["messages"], 0);
    app.post(&format!("{path}/{conv}/read"), Some(&c.ana.0), json!({}))
        .await;
    assert_eq!(unread(&app, &c.ana.0).await["messages"], 0);

    // Announcements count for the students who can see them; the staff write the mural (always 0).
    let ann = format!("/v1/clubs/{}/announcements", c.id);
    let all = app
        .post(
            &ann,
            Some(&c.owner),
            json!({ "title": "Treino coletivo", "body": "Sábado às 7h" }),
        )
        .await;
    let all = all.body["id"].as_str().unwrap().to_string();
    app.post(
        &ann,
        Some(&c.owner),
        json!({ "title": "Iniciantes", "body": "Só o grupo", "group_ids": [c.group] }),
    )
    .await
    .ok();
    assert_eq!(unread(&app, &c.ana.0).await["announcements"], 1);
    assert_eq!(unread(&app, &c.bia.0).await["announcements"], 2);
    assert_eq!(unread(&app, &c.owner).await["announcements"], 0);
    app.post(
        &format!("{ann}/read"),
        Some(&c.ana.0),
        json!({ "ids": [all] }),
    )
    .await;
    assert_eq!(
        unread(&app, &c.ana.0).await,
        json!({ "messages": 0, "announcements": 0 })
    );
}
