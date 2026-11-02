//! S3: personal invites (D-023) end to end, members, groups, leaving, and the job queue.

mod common;

use axum::http::Method;
use common::TestApp;
use serde_json::{Value, json};
use sqlx::PgPool;

struct Club {
    id: String,
    owner: String,
}

async fn club(app: &TestApp) -> Club {
    let owner = app.sign_in("marcos@email.com").await;
    sqlx::query("UPDATE users SET name = 'Marcos Lima' WHERE email = 'marcos@email.com'")
        .execute(app.db())
        .await
        .unwrap();
    let res = app
        .post(
            "/v1/clubs",
            Some(&owner),
            json!({ "name": "Pace Forte", "modalities": ["run"] }),
        )
        .await;
    Club {
        id: res.body["club"]["id"].as_str().unwrap().to_string(),
        owner,
    }
}

async fn outbox(app: &TestApp, to: &str) -> Vec<Value> {
    app.get(&format!("/v1/mock/outbox?to={to}"), None)
        .await
        .ok()["items"]
        .as_array()
        .unwrap()
        .clone()
}

fn token_of(url: &str) -> String {
    url.rsplit('/').next().unwrap().to_string()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn an_invite_is_emailed_and_only_the_invited_email_can_accept(db: PgPool) {
    let app = TestApp::new(db);
    let c = club(&app).await;
    let invites = format!("/v1/clubs/{}/invites", c.id);
    let group = app
        .post(
            &format!("/v1/clubs/{}/groups", c.id),
            Some(&c.owner),
            json!({ "name": "Iniciantes" }),
        )
        .await
        .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    app.post(&invites, Some(&c.owner), json!({ "email": "nope" }))
        .await
        .problem(422, "validation.failed");
    let inv = app.post(&invites, Some(&c.owner), json!({ "email": " Joao@Email.com ", "name": "João", "group_ids": [group, "not-a-group"] })).await;
    assert_eq!(inv.status, 201, "{}", inv.body);
    let i = inv.body.clone();
    assert_eq!(
        (
            i["email"].as_str(),
            i["role"].as_str(),
            i["status"].as_str()
        ),
        (Some("joao@email.com"), Some("student"), Some("pending"))
    );
    assert_eq!(i["group_ids"], json!([group]));
    assert!(
        i["url"]
            .as_str()
            .unwrap()
            .starts_with("http://localhost:8080/invite/")
    );
    app.post(
        &invites,
        Some(&c.owner),
        json!({ "email": "joao@email.com" }),
    )
    .await
    .problem(409, "invite.exists");

    // The worker sends the e-mail (pt-BR) with the personal link.
    assert!(
        outbox(&app, "joao@email.com").await.is_empty(),
        "queued, not sent inline"
    );
    assert!(app.run_jobs().await >= 1);
    let mail = &outbox(&app, "joao@email.com").await[0];
    assert_eq!(
        mail["subject"],
        "Marcos Lima convidou você para o Pace Forte no Runflow"
    );
    assert!(mail["text"].as_str().unwrap().starts_with("Olá, João!"));
    assert!(mail["text"].as_str().unwrap().contains("como aluno(a)"));
    assert_eq!(mail["action"]["url"], i["url"]);
    let listed = app.get(&invites, Some(&c.owner)).await;
    assert_eq!(listed.ok()["items"][0]["send_count"], 1);

    // Public page, signed out: masked e-mail, no match info.
    let token = token_of(i["url"].as_str().unwrap());
    let page = app.get(&format!("/v1/public/invites/{token}"), None).await;
    let p = page.ok();
    assert_eq!(
        (
            p["valid"].as_bool(),
            p["email_hint"].as_str(),
            p["invited_by"].as_str(),
            p["role"].as_str()
        ),
        (
            Some(true),
            Some("jo••@email.com"),
            Some("Marcos Lima"),
            Some("student")
        )
    );
    assert_eq!(p["email_matches"], Value::Null);
    assert_eq!(p["club"]["name"], "Pace Forte");

    // Someone else can't use it.
    let other = app.sign_in("bruno@email.com").await;
    assert_eq!(
        app.get(&format!("/v1/public/invites/{token}"), Some(&other))
            .await
            .ok()["email_matches"],
        false
    );
    let wrong = app
        .post(
            &format!("/v1/invites/{token}/accept"),
            Some(&other),
            json!({}),
        )
        .await;
    assert!(
        wrong.problem(403, "invite.email_mismatch")["detail"]
            .as_str()
            .unwrap()
            .contains("jo••@email.com")
    );

    // The invited person joins, lands in the group, staff are notified; the link is single use.
    let joao = app.sign_in("joao@email.com").await;
    assert_eq!(
        app.get(&format!("/v1/public/invites/{token}"), Some(&joao))
            .await
            .ok()["email_matches"],
        true
    );
    let joined = app
        .post(
            &format!("/v1/invites/{token}/accept"),
            Some(&joao),
            json!({}),
        )
        .await;
    assert_eq!(joined.status, 201, "{}", joined.body);
    assert_eq!(
        (
            joined.body["membership"]["role"].as_str(),
            joined.body["already_member"].as_bool()
        ),
        (Some("student"), Some(false))
    );
    let groups = app
        .get(&format!("/v1/clubs/{}/groups", c.id), Some(&c.owner))
        .await;
    assert_eq!(
        groups.ok()["items"][0]["member_ids"],
        json!([joined.body["membership"]["id"]])
    );
    let notes = app.get("/v1/me/notifications", Some(&c.owner)).await;
    assert_eq!(notes.ok()["items"][0]["kind"], "member_joined");
    assert!(
        notes.body["items"][0]["title"]
            .as_str()
            .unwrap()
            .ends_with("entrou no clube")
    );
    let again = app
        .post(
            &format!("/v1/invites/{token}/accept"),
            Some(&joao),
            json!({}),
        )
        .await;
    assert_eq!(again.ok()["already_member"], true);
    assert_eq!(
        app.get(&format!("/v1/public/invites/{token}"), None)
            .await
            .ok()["reason"],
        "accepted"
    );
    app.post(
        &invites,
        Some(&c.owner),
        json!({ "email": "joao@email.com" }),
    )
    .await
    .problem(409, "invite.already_member");
    app.post(
        &format!(
            "/v1/clubs/{}/invites/{}/resend",
            c.id,
            i["id"].as_str().unwrap()
        ),
        Some(&c.owner),
        json!({}),
    )
    .await
    .problem(409, "invite.accepted");
    assert_eq!(
        app.get("/v1/me", Some(&joao)).await.ok()["memberships"][0]["club"]["id"],
        c.id
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn resend_rotates_the_link_and_expired_cancelled_or_full_invites_fail(db: PgPool) {
    let app = TestApp::new(db);
    let c = club(&app).await;
    let invites = format!("/v1/clubs/{}/invites", c.id);
    let i = app
        .post(
            &invites,
            Some(&c.owner),
            json!({ "email": "ana@email.com" }),
        )
        .await
        .body
        .clone();
    let old = token_of(i["url"].as_str().unwrap());

    let resent = app
        .post(
            &format!("{invites}/{}/resend", i["id"].as_str().unwrap()),
            Some(&c.owner),
            json!({}),
        )
        .await;
    let new = token_of(resent.ok()["url"].as_str().unwrap());
    assert_ne!(old, new);
    app.get(&format!("/v1/public/invites/{old}"), None)
        .await
        .problem(404, "invite.not_found");
    app.run_jobs().await;
    let mails = outbox(&app, "ana@email.com").await;
    assert_eq!(
        mails.len(),
        1,
        "the first link was replaced before sending: only the current one goes out"
    );
    assert!(mails[0]["action"]["url"].as_str().unwrap().ends_with(&new));

    let ana = app.sign_in("ana@email.com").await;
    sqlx::query("UPDATE invitations SET expires_at = now() - interval '1 minute'")
        .execute(app.db())
        .await
        .unwrap();
    assert_eq!(
        app.get(&format!("/v1/public/invites/{new}"), None)
            .await
            .ok()["reason"],
        "expired"
    );
    app.post(&format!("/v1/invites/{new}/accept"), Some(&ana), json!({}))
        .await
        .problem(409, "invite.expired");
    assert_eq!(
        app.get(&invites, Some(&c.owner)).await.ok()["items"][0]["status"],
        "expired"
    );

    // Resend revives it; a full club blocks students.
    let fresh = token_of(
        app.post(
            &format!("{invites}/{}/resend", i["id"].as_str().unwrap()),
            Some(&c.owner),
            json!({}),
        )
        .await
        .ok()["url"]
            .as_str()
            .unwrap(),
    );
    sqlx::query("UPDATE club_subscriptions SET student_limit = 0")
        .execute(app.db())
        .await
        .unwrap();
    app.post(
        &format!("/v1/invites/{fresh}/accept"),
        Some(&ana),
        json!({}),
    )
    .await
    .problem(409, "invite.club_full");
    sqlx::query("UPDATE club_subscriptions SET student_limit = 10")
        .execute(app.db())
        .await
        .unwrap();

    // Cancelled: the link stops working.
    assert_eq!(
        app.delete(
            &format!("{invites}/{}", i["id"].as_str().unwrap()),
            Some(&c.owner)
        )
        .await
        .status,
        204
    );
    assert_eq!(
        app.get(&format!("/v1/public/invites/{fresh}"), None)
            .await
            .ok()["reason"],
        "revoked"
    );
    app.post(
        &format!("/v1/invites/{fresh}/accept"),
        Some(&ana),
        json!({}),
    )
    .await
    .problem(409, "invite.revoked");
    assert_eq!(
        app.get(&invites, Some(&c.owner)).await.ok()["items"],
        json!([]),
        "cancelled invites leave the list"
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn trainers_invite_students_and_only_owners_invite_trainers(db: PgPool) {
    let app = TestApp::new(db);
    let c = club(&app).await;
    let invites = format!("/v1/clubs/{}/invites", c.id);
    let t = app
        .post(
            &invites,
            Some(&c.owner),
            json!({ "email": "julia@email.com", "role": "trainer", "group_ids": ["x"] }),
        )
        .await;
    assert_eq!(
        (
            t.status.as_u16(),
            t.body["role"].as_str(),
            &t.body["group_ids"]
        ),
        (201, Some("trainer"), &json!([]))
    );
    app.run_jobs().await;
    assert!(
        outbox(&app, "julia@email.com").await[0]["text"]
            .as_str()
            .unwrap()
            .contains("como treinador(a)")
    );
    let julia = app.sign_in("julia@email.com").await;
    app.post(
        &format!(
            "/v1/invites/{}/accept",
            token_of(t.body["url"].as_str().unwrap())
        ),
        Some(&julia),
        json!({}),
    )
    .await
    .ok();

    app.post(
        &invites,
        Some(&julia),
        json!({ "email": "pedro@email.com", "role": "trainer" }),
    )
    .await
    .problem(403, "auth.forbidden");
    assert_eq!(
        app.post(
            &invites,
            Some(&julia),
            json!({ "email": "pedro@email.com" })
        )
        .await
        .status,
        201
    );
    let student = app.sign_in("aluno@email.com").await;
    sqlx::query("INSERT INTO memberships (id, club_id, user_id, role) SELECT gen_random_uuid(), $1::uuid, id, 'student' FROM users WHERE email = 'aluno@email.com'").bind(&c.id).execute(app.db()).await.unwrap();
    app.get(&invites, Some(&student))
        .await
        .problem(403, "auth.forbidden");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn bulk_import_invites_each_row_once(db: PgPool) {
    let app = TestApp::new(db);
    let c = club(&app).await;
    app.post(
        &format!("/v1/clubs/{}/groups", c.id),
        Some(&c.owner),
        json!({ "name": "Iniciantes" }),
    )
    .await
    .ok();
    let invites = format!("/v1/clubs/{}/invites", c.id);
    app.post(
        &invites,
        Some(&c.owner),
        json!({ "email": "bia@email.com" }),
    )
    .await
    .ok();
    sqlx::query("UPDATE club_subscriptions SET student_limit = 2")
        .execute(app.db())
        .await
        .unwrap();

    app.post(
        &format!("{invites}/bulk"),
        Some(&c.owner),
        json!({ "rows": [] }),
    )
    .await
    .problem(422, "validation.failed");
    let res = app
        .post(
            &format!("{invites}/bulk"),
            Some(&c.owner),
            json!({ "rows": [
                { "name": "Ana", "email": "ana@email.com", "groups": "iniciantes, Avançados" },
                { "email": "nao-e-email" },
                { "email": "ANA@email.com" },
                { "email": "marcos@email.com" },
                { "email": "bia@email.com" },
                { "name": "Caio", "email": "caio@email.com" }
            ] }),
        )
        .await;
    assert_eq!(res.status, 201, "{}", res.body);
    let b = &res.body;
    assert_eq!(b["created"], 3);
    let reasons: Vec<(i64, &str)> = b["skipped"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["row"].as_i64().unwrap(), s["reason"].as_str().unwrap()))
        .collect();
    assert_eq!(
        reasons,
        [
            (2, "invalid_email"),
            (3, "duplicate"),
            (4, "already_member")
        ]
    );
    let resent: Vec<bool> = b["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["resent"].as_bool().unwrap())
        .collect();
    assert_eq!(resent, [false, true, false]);
    assert_eq!(
        b["items"][0]["group_ids"].as_array().unwrap().len(),
        1,
        "unknown group names are ignored"
    );
    assert_eq!(b["over_limit"], 1);
    app.run_jobs().await;
    for to in ["ana@email.com", "bia@email.com", "caio@email.com"] {
        assert_eq!(outbox(&app, to).await.len(), 1, "{to}");
    }
}

/// `email` joins the club as a student (through a real invite).
async fn student(app: &TestApp, c: &Club, email: &str) -> (String, String) {
    let i = app
        .post(
            &format!("/v1/clubs/{}/invites", c.id),
            Some(&c.owner),
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

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn members_roles_limits_and_leaving(db: PgPool) {
    let app = TestApp::new(db);
    let c = club(&app).await;
    let (_, ana) = student(&app, &c, "ana@email.com").await;
    let (bruno_t, bruno) = student(&app, &c, "bruno@email.com").await;
    sqlx::query("UPDATE users SET name = 'Álvaro' WHERE email = 'bruno@email.com'")
        .execute(app.db())
        .await
        .unwrap();
    let members = format!("/v1/clubs/{}/members", c.id);

    let list = app.get(&members, Some(&c.owner)).await;
    let names: Vec<&str> = list.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["user"]["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        ["Marcos Lima", "Álvaro", "Ana"],
        "owner first, then by name (accents folded)"
    );
    assert_eq!(
        app.get(&format!("{members}?role=student&q=alv"), Some(&c.owner))
            .await
            .ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let me_id = list.body["items"][0]["membership"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    app.patch(
        &format!("{members}/{me_id}"),
        Some(&c.owner),
        json!({ "role": "student" }),
    )
    .await
    .problem(409, "member.self");
    app.patch(
        &format!("{members}/{ana}"),
        Some(&c.owner),
        json!({ "role": "coach" }),
    )
    .await
    .problem(422, "validation.failed");
    let suspended = app
        .patch(
            &format!("{members}/{ana}"),
            Some(&c.owner),
            json!({ "status": "suspended" }),
        )
        .await;
    assert_eq!(suspended.ok()["membership"]["status"], "suspended");
    sqlx::query("UPDATE club_subscriptions SET student_limit = 1")
        .execute(app.db())
        .await
        .unwrap();
    app.patch(
        &format!("{members}/{ana}"),
        Some(&c.owner),
        json!({ "status": "active" }),
    )
    .await
    .problem(409, "plan.limit_reached");
    sqlx::query("UPDATE club_subscriptions SET student_limit = 10")
        .execute(app.db())
        .await
        .unwrap();
    let promoted = app
        .patch(
            &format!("{members}/{bruno}"),
            Some(&c.owner),
            json!({ "role": "owner" }),
        )
        .await;
    assert_eq!(promoted.ok()["membership"]["role"], "owner");

    assert_eq!(
        app.delete(&format!("{members}/{ana}"), Some(&c.owner))
            .await
            .status,
        204
    );
    assert_eq!(
        app.get(&format!("{members}?status=left"), Some(&c.owner))
            .await
            .ok()["items"][0]["membership"]["id"],
        ana
    );

    // Leaving: the only owner can't; with a second owner, they can.
    let leave = format!("/v1/clubs/{}/leave", c.id);
    sqlx::query("UPDATE memberships SET role = 'student' WHERE id = $1::uuid")
        .bind(&bruno)
        .execute(app.db())
        .await
        .unwrap();
    app.post(&leave, Some(&c.owner), json!({}))
        .await
        .problem(409, "member.last_owner");
    app.post(
        "/v1/me/consents",
        Some(&bruno_t),
        json!({ "kind": "share_training_data", "club_id": c.id }),
    )
    .await
    .ok();
    assert_eq!(
        app.post(&leave, Some(&bruno_t), json!({})).await.status,
        204
    );
    assert_eq!(
        app.get("/v1/me", Some(&bruno_t)).await.ok()["memberships"],
        json!([])
    );
    let active: i64 = sqlx::query_scalar("SELECT count(*) FROM consents c JOIN users u ON u.id = c.user_id WHERE u.email = 'bruno@email.com' AND c.club_id IS NOT NULL AND c.revoked_at IS NULL")
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(active, 0, "leaving revokes that club's sharing consents");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn groups_crud_and_members(db: PgPool) {
    let app = TestApp::new(db);
    let c = club(&app).await;
    let (_, ana) = student(&app, &c, "ana@email.com").await;
    let groups = format!("/v1/clubs/{}/groups", c.id);

    app.post(&groups, Some(&c.owner), json!({ "name": "" }))
        .await
        .problem(422, "validation.failed");
    let g = app
        .post(
            &groups,
            Some(&c.owner),
            json!({ "name": "Maratona", "description": "Ciclo de 16 semanas" }),
        )
        .await;
    assert_eq!(g.status, 201);
    let gid = g.body["id"].as_str().unwrap().to_string();
    let dup = app
        .post(&groups, Some(&c.owner), json!({ "name": "maratona" }))
        .await;
    assert_eq!(
        dup.problem(422, "validation.failed")["errors"][0]["message"],
        "Já existe um grupo com esse nome."
    );
    app.post(&groups, Some(&c.owner), json!({ "name": "Avançados" }))
        .await
        .ok();

    let renamed = app
        .patch(
            &format!("{groups}/{gid}"),
            Some(&c.owner),
            json!({ "name": "Maratona 2027", "description": null }),
        )
        .await;
    assert_eq!(
        (renamed.ok()["name"].as_str(), &renamed.body["description"]),
        (Some("Maratona 2027"), &Value::Null)
    );
    let other_club = app
        .post(
            "/v1/clubs",
            Some(&c.owner),
            json!({ "name": "Outro", "modalities": ["run"] }),
        )
        .await
        .body["membership"]["id"]
        .clone();
    let set = app
        .call(
            Method::PUT,
            &format!("{groups}/{gid}/members"),
            Some(&c.owner),
            Some(json!({ "membership_ids": [ana, other_club, "junk"] })),
            &[],
        )
        .await;
    assert_eq!(
        set.ok()["member_ids"],
        json!([ana]),
        "only this club's members"
    );

    let names: Vec<String> = app.get(&groups, Some(&c.owner)).await.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(names, ["Avançados", "Maratona 2027"]);
    assert_eq!(
        app.delete(&format!("{groups}/{gid}"), Some(&c.owner))
            .await
            .status,
        204
    );
    app.patch(
        &format!("{groups}/{gid}"),
        Some(&c.owner),
        json!({ "name": "x" }),
    )
    .await
    .problem(404, "group.not_found");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn failing_jobs_retry_then_close_with_the_error(db: PgPool) {
    let app = TestApp::new(db);
    runflow_db::jobs::enqueue(app.db(), "nonsense", &json!({}), None)
        .await
        .unwrap();
    app.run_jobs().await;
    let (done, err): (bool, Option<String>) =
        sqlx::query_as("SELECT done_at IS NOT NULL, last_error FROM jobs")
            .fetch_one(app.db())
            .await
            .unwrap();
    assert!(
        done && err.unwrap().contains("unknown job kind"),
        "permanent errors close the job"
    );

    runflow_db::jobs::enqueue(
        app.db(),
        runflow_jobs::INVITE_EMAIL,
        &json!({ "invite_id": "00000000-0000-0000-0000-000000000000" }),
        None,
    )
    .await
    .unwrap();
    app.run_jobs().await;
    let pending: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE done_at IS NULL")
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(
        pending, 0,
        "an invite that no longer exists is simply skipped"
    );
}
