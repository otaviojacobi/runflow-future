//! S3: clubs, settings, branding (Rust color engine), uploads, public club page, closing a club.

mod common;

use axum::http::{Method, header};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use common::TestApp;
use serde_json::{Value, json};
use sqlx::PgPool;

const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R',
];
const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 16, b'J', b'F', b'I', b'F'];

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

async fn create(app: &TestApp, t: &str, name: &str, modalities: Value) -> Value {
    let res = app
        .post(
            "/v1/clubs",
            Some(t),
            json!({ "name": name, "city": "São Paulo", "state": "sp", "modalities": modalities }),
        )
        .await;
    assert_eq!(res.status, 201, "{}", res.body);
    res.body
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn creating_a_club_sets_up_owner_branding_plan_and_library(db: PgPool) {
    let app = TestApp::new(db);
    let t = app.sign_in("marcos@email.com").await;

    let bad = app
        .post(
            "/v1/clubs",
            Some(&t),
            json!({ "name": " ", "state": "XX", "modalities": ["chess"] }),
        )
        .await;
    let fields: Vec<&str> = bad.problem(422, "validation.failed")["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(fields, ["name", "state", "modalities"]);
    assert_eq!(bad.body["errors"][0]["message"], "Informe o nome do clube.");

    let c = create(
        &app,
        &t,
        "Pace Forte Assessoria",
        json!(["run", "strength", "run"]),
    )
    .await;
    assert_eq!(c["club"]["slug"], "pace-forte-assessoria");
    assert_eq!(
        (
            c["club"]["state"].as_str(),
            c["club"]["timezone"].as_str(),
            c["club"]["trainer_label"].as_str()
        ),
        (Some("SP"), Some("America/Sao_Paulo"), Some("treinador"))
    );
    assert_eq!(c["club"]["modalities"], json!(["run", "strength"]));
    assert_eq!(
        (
            c["membership"]["role"].as_str(),
            c["membership"]["is_billing_owner"].as_bool()
        ),
        (Some("owner"), Some(true))
    );
    assert_eq!(
        (
            c["branding"]["theme_rev"].as_i64(),
            c["branding"]["theme"]["source"].as_str()
        ),
        (Some(1), Some("default"))
    );
    assert!(
        c["branding"]["theme_css"]
            .as_str()
            .unwrap()
            .contains("--rf-brand-solid: #4B4FE8;")
    );
    assert_eq!(
        (
            c["subscription"]["plan"].as_str(),
            c["subscription"]["student_limit"].as_i64()
        ),
        (Some("free"), Some(10))
    );

    let club_id = c["club"]["id"].as_str().unwrap();
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM workout_templates WHERE club_id = $1::uuid")
            .bind(club_id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(n, 10, "8 running + 2 strength starter workouts");
    let tags: Vec<String> = sqlx::query_scalar("SELECT unnest(tags) FROM workout_templates WHERE club_id = $1::uuid AND name = 'Tempo run 30′'").bind(club_id).fetch_all(app.db()).await.unwrap();
    assert_eq!(tags, ["limiar"]);
    let audit: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action = 'club.created'")
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(audit, 1);

    let me = app.get("/v1/me", Some(&t)).await;
    assert_eq!(me.ok()["memberships"][0]["club"]["id"], club_id);

    // Same name again: next free slug. Swimming-only club: "professor".
    let again = create(&app, &t, "Pace Forte Assessoria", json!(["swim"])).await;
    assert_eq!(again["club"]["slug"], "pace-forte-assessoria-2");
    assert_eq!(again["club"]["trainer_label"], "professor");
}

/// A second person who joins `club` as `role` (direct insert; invites come in S3c).
async fn join(app: &TestApp, club: &str, email: &str, role: &str) -> String {
    let t = app.sign_in(email).await;
    sqlx::query("INSERT INTO memberships (id, club_id, user_id, role) SELECT gen_random_uuid(), $1::uuid, id, $3 FROM users WHERE email = $2")
        .bind(club)
        .bind(email)
        .bind(role)
        .execute(app.db())
        .await
        .unwrap();
    t
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn settings_follow_roles_plan_and_subdomain_rules(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("marcos@email.com").await;
    let c = create(&app, &owner, "Pace Forte", json!(["run"])).await;
    let id = c["club"]["id"].as_str().unwrap().to_string();
    let path = format!("/v1/clubs/{id}");
    let student = join(&app, &id, "ana@email.com", "student").await;
    let outsider = app.sign_in("x@email.com").await;

    app.get(&path, Some(&outsider))
        .await
        .problem(404, "club.not_found");
    app.get("/v1/clubs/not-a-uuid", Some(&owner))
        .await
        .problem(404, "club.not_found");
    assert_eq!(
        app.get(&path, Some(&student)).await.ok()["name"],
        "Pace Forte"
    );
    app.patch(&path, Some(&student), json!({ "name": "Hack" }))
        .await
        .problem(403, "auth.forbidden");

    let bad = app
        .patch(
            &path,
            Some(&owner),
            json!({ "timezone": "Europe/Lisbon", "trainer_label": "coach", "modalities": [] }),
        )
        .await;
    assert_eq!(
        bad.problem(422, "validation.failed")["errors"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let ok = app
        .patch(
            &path,
            Some(&owner),
            json!({ "name": "Pace Forte Assessoria", "timezone": "America/Manaus", "city": null }),
        )
        .await;
    assert_eq!(
        (
            ok.ok()["name"].as_str(),
            ok.body["timezone"].as_str(),
            &ok.body["city"]
        ),
        (
            Some("Pace Forte Assessoria"),
            Some("America/Manaus"),
            &Value::Null
        )
    );

    app.patch(&path, Some(&owner), json!({ "subdomain": "paceforte" }))
        .await
        .problem(402, "plan.required");
    sqlx::query("UPDATE club_subscriptions SET plan = 'pro', student_limit = 100")
        .execute(app.db())
        .await
        .unwrap();
    for (sub, msg) in [
        ("app", "Este endereço é reservado. Escolha outro."),
        ("-x-", "Use de 3 a 32 letras, números ou hífens."),
        ("ab", "Use de 3 a 32 letras, números ou hífens."),
        (
            "paceforte-qa",
            "Endereços terminados em -qa são reservados.",
        ),
    ] {
        let r = app
            .patch(&path, Some(&owner), json!({ "subdomain": sub }))
            .await;
        assert_eq!(
            r.problem(422, "validation.failed")["errors"][0]["message"],
            msg,
            "{sub}"
        );
    }
    assert_eq!(
        app.patch(&path, Some(&owner), json!({ "subdomain": "PaceForte" }))
            .await
            .ok()["subdomain"],
        "paceforte"
    );
    // Its site (S9b): the host names the club; other hosts name none.
    for (host, club) in [
        ("paceforte-qa.runflow.club", json!("Pace Forte Assessoria")),
        ("qa.runflow.club", Value::Null),
        ("nobody-qa.runflow.club", Value::Null),
    ] {
        let r = app
            .call(
                Method::GET,
                "/v1/public/config",
                None,
                None,
                &[("host", host)],
            )
            .await;
        assert_eq!(
            r.ok()["club"].get("name").cloned().unwrap_or(Value::Null),
            club,
            "{host}"
        );
    }
    let other = create(&app, &owner, "Outro", json!(["run"])).await;
    sqlx::query("UPDATE club_subscriptions SET plan = 'pro'")
        .execute(app.db())
        .await
        .unwrap();
    let taken = app
        .patch(
            &format!("/v1/clubs/{}", other["club"]["id"].as_str().unwrap()),
            Some(&owner),
            json!({ "subdomain": "paceforte" }),
        )
        .await;
    assert_eq!(
        taken.problem(422, "validation.failed")["errors"][0]["message"],
        "Este endereço já está em uso."
    );

    // Public page by slug or subdomain.
    let public = app.get("/v1/public/clubs/paceforte", None).await;
    assert_eq!(
        (
            public.ok()["club"]["name"].as_str(),
            public.body["branding"]["theme"]["source"].as_str()
        ),
        (Some("Pace Forte Assessoria"), Some("default"))
    );
    assert!(
        public.body["club"].get("subdomain").is_none(),
        "public shape only"
    );
    app.get("/v1/public/clubs/nao-existe", None)
        .await
        .problem(404, "club.not_found");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn branding_derives_the_theme_on_the_server(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("marcos@email.com").await;
    let id = create(&app, &owner, "Pace Forte", json!(["run"])).await["club"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let path = format!("/v1/clubs/{id}/branding");

    let bad = app
        .call(
            Method::PUT,
            &path,
            Some(&owner),
            Some(json!({ "primary_color": "red", "secondary_color": "#12345" })),
            &[],
        )
        .await;
    assert_eq!(
        bad.problem(422, "validation.failed")["errors"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let one = app
        .call(
            Method::PUT,
            &path,
            Some(&owner),
            Some(json!({ "primary_color": "#d62828" })),
            &[],
        )
        .await;
    let b = one.ok();
    assert_eq!(
        (
            b["primary_color"].as_str(),
            b["secondary_color"].as_str(),
            b["theme_rev"].as_i64()
        ),
        (Some("#D62828"), None, Some(2))
    );
    assert_eq!(
        (
            b["theme"]["source"].as_str(),
            b["theme"]["secondary"].as_str()
        ),
        (Some("derived"), Some("#FFC8C1")),
        "same as the design fixtures"
    );
    assert_eq!(b["theme"]["roles"]["light"]["brand"]["solid"], "#D62828");
    assert!(
        b["theme_css"]
            .as_str()
            .unwrap()
            .starts_with(":root { --rf-brand-50:")
    );

    // Only a secondary: promoted to primary (like the mock and color.js).
    let promoted = app
        .call(
            Method::PUT,
            &path,
            Some(&owner),
            Some(json!({ "secondary_color": "#2D6A4F" })),
            &[],
        )
        .await;
    assert_eq!(
        (
            promoted.ok()["primary_color"].as_str(),
            promoted.body["theme_rev"].as_i64()
        ),
        (Some("#2D6A4F"), Some(3))
    );

    // Everyone in the club reads it; /me carries it too.
    let student = join(&app, &id, "ana@email.com", "student").await;
    assert_eq!(
        app.get(&path, Some(&student)).await.ok()["primary_color"],
        "#2D6A4F"
    );
    app.call(Method::PUT, &path, Some(&student), Some(json!({})), &[])
        .await
        .problem(403, "auth.forbidden");
    let me = app.get("/v1/me", Some(&student)).await;
    assert_eq!(me.ok()["memberships"][0]["branding"]["theme_rev"], 3);
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn logos_and_avatars_are_checked_stored_and_served_safely(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("marcos@email.com").await;
    let id = create(&app, &owner, "Pace Forte", json!(["run"])).await["club"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let assets = format!("/v1/clubs/{id}/assets");

    app.post(
        &assets,
        Some(&owner),
        json!({ "data_url": data_url("image/gif", b"GIF89a") }),
    )
    .await
    .problem(415, "asset.unsupported");
    app.post(
        &assets,
        Some(&owner),
        json!({ "data_url": data_url("image/png", JPEG) }),
    )
    .await
    .problem(415, "asset.unsupported");
    app.post(
        &assets,
        Some(&owner),
        json!({ "data_url": data_url("image/svg+xml", b"<svg onload=\"x()\"></svg>") }),
    )
    .await
    .problem(415, "asset.unsupported");
    let big = [PNG, &vec![0u8; 5 * 1024 * 1024 + 10]].concat();
    let small = TestApp::with_body_limit(app.db().clone(), 16 * 1024 * 1024);
    small
        .post(
            &assets,
            Some(&owner),
            json!({ "data_url": data_url("image/png", &big) }),
        )
        .await
        .problem(413, "asset.too_large");

    let up = app
        .post(
            &assets,
            Some(&owner),
            json!({ "data_url": data_url("image/png", PNG), "width": 512, "height": 512 }),
        )
        .await;
    assert_eq!(up.status, 201);
    let url = up.body["url"].as_str().unwrap().to_string();
    let logo_id = up.body["id"].as_str().unwrap().to_string();

    let got = app.call(Method::GET, &url, None, None, &[]).await;
    assert_eq!(got.status, 200);
    assert_eq!(got.headers[header::CONTENT_TYPE], "image/png");
    assert!(
        got.headers[header::CACHE_CONTROL]
            .to_str()
            .unwrap()
            .contains("immutable")
    );
    assert!(
        got.headers[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .contains("sandbox")
    );
    let etag = got.headers[header::ETAG].to_str().unwrap().to_string();
    assert_eq!(
        app.call(Method::GET, &url, None, None, &[("if-none-match", &etag)])
            .await
            .status,
        304
    );
    app.get(&format!("/v1/assets/{}", uuid::Uuid::now_v7()), None)
        .await
        .problem(404, "asset.not_found");

    let svg = app.post(&assets, Some(&owner), json!({ "data_url": data_url("image/svg+xml", br##"<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#D62828"/></svg>"##) })).await;
    assert_eq!(svg.status, 201, "{}", svg.body);

    // The logo goes into the branding; someone else's asset doesn't.
    let b = app
        .call(
            Method::PUT,
            &format!("/v1/clubs/{id}/branding"),
            Some(&owner),
            Some(json!({ "primary_color": "#D62828", "logo_asset_id": logo_id })),
            &[],
        )
        .await;
    assert_eq!(b.ok()["logo_url"], url);
    let kept = app
        .call(
            Method::PUT,
            &format!("/v1/clubs/{id}/branding"),
            Some(&owner),
            Some(json!({ "primary_color": "#0096C7" })),
            &[],
        )
        .await;
    assert_eq!(kept.ok()["logo_url"], url, "logo kept when not sent");
    let other = create(&app, &owner, "Outro", json!(["run"])).await["club"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let foreign = app
        .call(
            Method::PUT,
            &format!("/v1/clubs/{other}/branding"),
            Some(&owner),
            Some(json!({ "logo_asset_id": logo_id })),
            &[],
        )
        .await;
    assert_eq!(
        foreign.problem(422, "validation.failed")["errors"][0]["field"],
        "logo_asset_id"
    );

    // Avatars: photos only.
    app.post(
        "/v1/me/avatar",
        Some(&owner),
        json!({ "data_url": data_url("image/svg+xml", b"<svg></svg>") }),
    )
    .await
    .problem(415, "asset.unsupported");
    let me = app
        .post(
            "/v1/me/avatar",
            Some(&owner),
            json!({ "data_url": data_url("image/jpeg", JPEG) }),
        )
        .await;
    let avatar = me.ok()["user"]["avatar_url"].as_str().unwrap().to_string();
    assert!(avatar.starts_with("/v1/assets/"));
    assert_eq!(app.get(&avatar, None).await.status, 200);
    assert_eq!(
        app.delete("/v1/me/avatar", Some(&owner)).await.ok()["user"]["avatar_url"],
        Value::Null
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn closing_a_club_needs_its_name_and_releases_everything(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("marcos@email.com").await;
    let id = create(&app, &owner, "Pace Forte", json!(["run"])).await["club"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    sqlx::query("UPDATE club_subscriptions SET plan = 'pro'")
        .execute(app.db())
        .await
        .unwrap();
    app.patch(
        &format!("/v1/clubs/{id}"),
        Some(&owner),
        json!({ "subdomain": "paceforte" }),
    )
    .await
    .ok();
    let student = join(&app, &id, "ana@email.com", "student").await;

    app.call(
        Method::DELETE,
        &format!("/v1/clubs/{id}"),
        Some(&student),
        Some(json!({ "confirm_name": "Pace Forte" })),
        &[],
    )
    .await
    .problem(403, "auth.forbidden");
    let wrong = app
        .call(
            Method::DELETE,
            &format!("/v1/clubs/{id}"),
            Some(&owner),
            Some(json!({ "confirm_name": "Pace" })),
            &[],
        )
        .await;
    assert_eq!(
        wrong.problem(422, "validation.failed")["errors"][0]["field"],
        "confirm_name"
    );
    let closed = app
        .call(
            Method::DELETE,
            &format!("/v1/clubs/{id}"),
            Some(&owner),
            Some(json!({ "confirm_name": "pace forte" })),
            &[],
        )
        .await;
    assert_eq!(closed.status, 204);

    app.get(&format!("/v1/clubs/{id}"), Some(&owner))
        .await
        .problem(404, "club.not_found");
    assert_eq!(
        app.get("/v1/me", Some(&student)).await.ok()["memberships"],
        json!([])
    );
    app.get("/v1/public/clubs/paceforte", None)
        .await
        .problem(404, "club.not_found");
    let status: String =
        sqlx::query_scalar("SELECT status FROM club_subscriptions WHERE club_id = $1::uuid")
            .bind(&id)
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(status, "canceled");
    // The subdomain is free again for another club.
    let other = create(&app, &owner, "Outro", json!(["run"])).await["club"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    sqlx::query("UPDATE club_subscriptions SET plan = 'pro' WHERE club_id = $1::uuid")
        .bind(&other)
        .execute(app.db())
        .await
        .unwrap();
    assert_eq!(
        app.patch(
            &format!("/v1/clubs/{other}"),
            Some(&owner),
            json!({ "subdomain": "paceforte" })
        )
        .await
        .ok()["subdomain"],
        "paceforte"
    );
}
