//! S2: sign-in (e-mail code, Google), sessions and `/me`, against a real Postgres.

mod common;

use std::time::{SystemTime, UNIX_EPOCH};

use axum::http::{Method, header};
use common::TestApp;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use runflow_integrations::google::GoogleVerifier;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn email_code_sign_in_creates_an_account_once(db: PgPool) {
    let app = TestApp::new(db);
    let start = app
        .post(
            "/v1/auth/email/start",
            None,
            json!({ "email": "  Ana.Souza@Email.com " }),
        )
        .await;
    let code = start.ok()["dev_code"].as_str().unwrap().to_string();
    assert_eq!(start.body["expires_in_s"], 600);

    // The e-mail went out (dev outbox), in pt-BR, with the code.
    let outbox = app
        .get("/v1/mock/outbox?to=ana.souza@email.com", None)
        .await;
    let mail = &outbox.ok()["items"][0];
    assert_eq!(mail["kind"], "sign_in_code");
    assert_eq!(mail["subject"], format!("Seu código do Runflow: {code}"));
    assert!(
        mail["text"]
            .as_str()
            .unwrap()
            .contains("Ele vale por 10 minutos")
    );

    let res = app.post("/v1/auth/email/verify", None, json!({ "email": "ana.souza@email.com", "code": format!("{} {}", &code[..3], &code[3..]) })).await;
    let body = res.ok();
    assert_eq!(body["is_new"], true);
    assert_eq!(body["user"]["email"], "ana.souza@email.com");
    assert_eq!(body["user"]["name"], "Ana Souza");
    assert_eq!(body["user"]["locale"], "pt-BR");
    let token = body["token"].as_str().unwrap().to_string();
    let cookie = res.headers[header::SET_COOKIE].to_str().unwrap();
    assert!(cookie.starts_with(&format!("rf_session={token};")) && cookie.contains("HttpOnly"));

    // Bearer and cookie both work.
    let me = app.get("/v1/me", Some(&token)).await;
    assert_eq!(me.ok()["user"]["email"], "ana.souza@email.com");
    assert_eq!(me.body["memberships"], json!([]));
    assert_eq!(me.body["prefs"]["push_workouts"], true);
    assert_eq!(me.body["unread_notifications"], 0);
    let by_cookie = app
        .call(
            Method::GET,
            "/v1/me",
            None,
            None,
            &[("cookie", &format!("a=1; rf_session={token}"))],
        )
        .await;
    assert_eq!(by_cookie.ok()["user"]["name"], "Ana Souza");

    // Codes are single use; signing in again finds the same account.
    app.post(
        "/v1/auth/email/verify",
        None,
        json!({ "email": "ana.souza@email.com", "code": code }),
    )
    .await
    .problem(400, "auth.code_expired");
    sqlx::query("UPDATE email_codes SET created_at = created_at - interval '1 minute'")
        .execute(app.db())
        .await
        .unwrap();
    let again = app.sign_in("ANA.SOUZA@email.com").await;
    assert_ne!(again, token);
    let consents = app.get("/v1/me/consents", Some(&again)).await;
    let kinds: Vec<&str> = consents.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["terms", "privacy"], "accepted once, at sign-up");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn codes_are_rate_limited_and_attempts_capped(db: PgPool) {
    let app = TestApp::new(db);
    app.post(
        "/v1/auth/email/start",
        None,
        json!({ "email": "nao-e-email" }),
    )
    .await
    .problem(422, "validation.failed");
    app.post(
        "/v1/auth/email/verify",
        None,
        json!({ "email": "bia@email.com", "code": "123456" }),
    )
    .await
    .problem(400, "auth.code_expired");

    let code = app
        .post(
            "/v1/auth/email/start",
            None,
            json!({ "email": "bia@email.com" }),
        )
        .await
        .ok()["dev_code"]
        .as_str()
        .unwrap()
        .to_string();
    let cooldown = app
        .post(
            "/v1/auth/email/start",
            None,
            json!({ "email": "bia@email.com" }),
        )
        .await;
    cooldown.problem(429, "auth.code_cooldown");
    assert!(cooldown.headers.contains_key(header::RETRY_AFTER));

    // A code only works for its own address.
    app.post(
        "/v1/auth/email/start",
        None,
        json!({ "email": "caio@email.com" }),
    )
    .await
    .ok();
    app.post(
        "/v1/auth/email/verify",
        None,
        json!({ "email": "caio@email.com", "code": code }),
    )
    .await
    .problem(400, "auth.invalid_code");

    let wrong = if code == "000000" { "111111" } else { "000000" };
    for _ in 0..5 {
        let r = app
            .post(
                "/v1/auth/email/verify",
                None,
                json!({ "email": "bia@email.com", "code": wrong }),
            )
            .await;
        assert!(
            r.problem(400, "auth.invalid_code")["detail"]
                .as_str()
                .unwrap()
                .contains("bia@email.com")
        );
    }
    // Even the right code is refused after too many attempts.
    app.post(
        "/v1/auth/email/verify",
        None,
        json!({ "email": "bia@email.com", "code": code }),
    )
    .await
    .problem(429, "auth.too_many_attempts");

    // At most 5 codes per hour per address.
    for _ in 0..4 {
        sqlx::query("UPDATE email_codes SET created_at = created_at - interval '1 minute'")
            .execute(app.db())
            .await
            .unwrap();
        app.post(
            "/v1/auth/email/start",
            None,
            json!({ "email": "bia@email.com" }),
        )
        .await
        .ok();
    }
    sqlx::query("UPDATE email_codes SET created_at = created_at - interval '1 minute'")
        .execute(app.db())
        .await
        .unwrap();
    app.post(
        "/v1/auth/email/start",
        None,
        json!({ "email": "bia@email.com" }),
    )
    .await
    .problem(429, "auth.too_many_codes");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn production_never_reveals_codes_or_the_outbox(db: PgPool) {
    let app = TestApp::with(db, false, None);
    let start = app
        .post(
            "/v1/auth/email/start",
            None,
            json!({ "email": "ana@email.com" }),
        )
        .await;
    assert!(start.ok().get("dev_code").is_none());
    app.get("/v1/mock/outbox", None)
        .await
        .problem(404, "route.not_found");
    app.post("/v1/auth/google", None, json!({ "id_token": "x" }))
        .await
        .problem(503, "auth.google_unavailable");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn sessions_list_revoke_and_logout(db: PgPool) {
    let app = TestApp::new(db);
    app.get("/v1/me", None).await.problem(401, "auth.required");
    app.get("/v1/me", Some("rf_nope"))
        .await
        .problem(401, "auth.required");

    let phone = app.sign_in("ana@email.com").await;
    sqlx::query("UPDATE email_codes SET created_at = created_at - interval '1 minute'")
        .execute(app.db())
        .await
        .unwrap();
    let laptop = app.sign_in("ana@email.com").await;

    let list = app.get("/v1/me/sessions", Some(&laptop)).await;
    let items = list.ok()["items"].as_array().unwrap().clone();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["current"], true);
    let other = items[1]["id"].as_str().unwrap();

    app.delete(
        &format!("/v1/me/sessions/{}", Uuid::now_v7()),
        Some(&laptop),
    )
    .await
    .problem(404, "session.not_found");
    app.delete("/v1/me/sessions/not-a-uuid", Some(&laptop))
        .await
        .problem(404, "session.not_found");
    assert_eq!(
        app.delete(&format!("/v1/me/sessions/{other}"), Some(&laptop))
            .await
            .status,
        204
    );
    app.get("/v1/me", Some(&phone))
        .await
        .problem(401, "auth.required");

    sqlx::query("UPDATE email_codes SET created_at = created_at - interval '1 minute'")
        .execute(app.db())
        .await
        .unwrap();
    let tablet = app.sign_in("ana@email.com").await;
    assert_eq!(
        app.post("/v1/me/sessions/revoke-others", Some(&laptop), json!({}))
            .await
            .ok()["revoked"],
        1
    );
    app.get("/v1/me", Some(&tablet))
        .await
        .problem(401, "auth.required");

    let out = app.post("/v1/auth/logout", Some(&laptop), json!({})).await;
    assert_eq!(out.status, 204);
    assert!(
        out.headers[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );
    app.get("/v1/me", Some(&laptop))
        .await
        .problem(401, "auth.required");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn mobile_sessions_get_no_cookie(db: PgPool) {
    let app = TestApp::new(db);
    let code = app
        .post(
            "/v1/auth/email/start",
            None,
            json!({ "email": "ana@email.com" }),
        )
        .await
        .ok()["dev_code"]
        .as_str()
        .unwrap()
        .to_string();
    let res = app
        .call(
            Method::POST,
            "/v1/auth/email/verify",
            None,
            Some(json!({ "email": "ana@email.com", "code": code })),
            &[
                ("x-client", "mobile"),
                ("user-agent", "Runflow/1.0 Android"),
            ],
        )
        .await;
    assert!(!res.headers.contains_key(header::SET_COOKIE));
    let token = res.ok()["token"].as_str().unwrap().to_string();
    let s = app.get("/v1/me/sessions", Some(&token)).await.ok()["items"][0].clone();
    assert_eq!(s["kind"], "mobile");
    assert_eq!(s["user_agent"], "Runflow/1.0 Android");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn profile_prefs_and_consents(db: PgPool) {
    let app = TestApp::new(db);
    let t = app.sign_in("ana@email.com").await;

    let bad = app.patch("/v1/me", Some(&t), json!({ "name": " ", "birth_date": "31/12/1990", "sex": "x", "avatar_url": "https://evil.example/p.png" })).await;
    let fields: Vec<&str> = bad.problem(422, "validation.failed")["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(fields, ["name", "birth_date", "sex", "avatar_url"]);
    assert_eq!(bad.body["errors"][0]["message"], "Informe seu nome.");

    let ok = app.patch("/v1/me", Some(&t), json!({ "name": "Ana Souza", "phone": " 11 99999-0000 ", "birth_date": "1990-05-20", "sex": "female" })).await;
    let user = &ok.ok()["user"];
    assert_eq!(
        (
            user["name"].as_str(),
            user["phone"].as_str(),
            user["birth_date"].as_str(),
            user["sex"].as_str()
        ),
        (
            Some("Ana Souza"),
            Some("11 99999-0000"),
            Some("1990-05-20"),
            Some("female")
        )
    );
    let cleared = app
        .patch("/v1/me", Some(&t), json!({ "phone": null }))
        .await;
    assert_eq!(cleared.ok()["user"]["phone"], Value::Null);
    assert_eq!(
        cleared.body["user"]["sex"], "female",
        "untouched fields stay"
    );

    let prefs = app
        .patch(
            "/v1/me/prefs",
            Some(&t),
            json!({ "email_weekly": false, "push_classes": "nope" }),
        )
        .await;
    assert_eq!(
        (
            prefs.ok()["email_weekly"].as_bool(),
            prefs.body["push_classes"].as_bool()
        ),
        (Some(false), Some(true))
    );
    assert_eq!(
        app.get("/v1/me/prefs", Some(&t)).await.ok()["email_weekly"],
        false
    );

    app.post("/v1/me/consents", Some(&t), json!({ "kind": "marketing" }))
        .await
        .problem(422, "validation.failed");
    app.post(
        "/v1/me/consents",
        Some(&t),
        json!({ "kind": "share_training_data", "club_id": Uuid::now_v7() }),
    )
    .await
    .problem(404, "club.not_found");
    let granted = app
        .post(
            "/v1/me/consents",
            Some(&t),
            json!({ "kind": "share_strava" }),
        )
        .await;
    assert_eq!(granted.status, 201);
    let again = app
        .post(
            "/v1/me/consents",
            Some(&t),
            json!({ "kind": "share_strava" }),
        )
        .await;
    assert_eq!(
        (again.status.as_u16(), &again.body["id"]),
        (200, &granted.body["id"]),
        "idempotent"
    );
    let terms = app.get("/v1/me/consents", Some(&t)).await.ok()["items"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    app.delete(&format!("/v1/me/consents/{terms}"), Some(&t))
        .await
        .problem(409, "consent.required");
    assert_eq!(
        app.delete(
            &format!("/v1/me/consents/{}", granted.body["id"].as_str().unwrap()),
            Some(&t)
        )
        .await
        .status,
        204
    );
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn notifications_page_and_read(db: PgPool) {
    let app = TestApp::new(db);
    let t = app.sign_in("ana@email.com").await;
    let uid: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = 'ana@email.com'")
        .fetch_one(app.db())
        .await
        .unwrap();
    for i in 0..3 {
        sqlx::query("INSERT INTO notifications (id, user_id, kind, title, created_at) VALUES ($1, $2, 'message', $3, now() - make_interval(mins => $4))")
            .bind(Uuid::now_v7())
            .bind(uid)
            .bind(format!("Aviso {i}"))
            .bind(i)
            .execute(app.db())
            .await
            .unwrap();
    }
    assert_eq!(
        app.get("/v1/me", Some(&t)).await.ok()["unread_notifications"],
        3
    );
    let p1 = app.get("/v1/me/notifications?limit=2", Some(&t)).await;
    let titles: Vec<&str> = p1.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, ["Aviso 0", "Aviso 1"], "newest first");
    let cursor = p1.body["next_cursor"].as_str().unwrap();
    let p2 = app
        .get(
            &format!("/v1/me/notifications?limit=2&cursor={cursor}"),
            Some(&t),
        )
        .await;
    assert_eq!(p2.ok()["items"][0]["title"], "Aviso 2");
    assert_eq!(p2.body["next_cursor"], Value::Null);
    app.get("/v1/me/notifications?cursor=garbage", Some(&t))
        .await
        .problem(422, "validation.failed");

    let first = p1.body["items"][0]["id"].as_str().unwrap();
    assert_eq!(
        app.post(
            "/v1/me/notifications/read",
            Some(&t),
            json!({ "ids": [first] })
        )
        .await
        .status,
        204
    );
    assert_eq!(
        app.get("/v1/me", Some(&t)).await.ok()["unread_notifications"],
        2
    );
    app.post("/v1/me/notifications/read", Some(&t), json!({}))
        .await;
    assert_eq!(
        app.get("/v1/me", Some(&t)).await.ok()["unread_notifications"],
        0
    );
}

/// A club with branding and a plan, the caller as `role`.
async fn club_with(app: &TestApp, user_email: &str, role: &str) -> Uuid {
    let club = Uuid::now_v7();
    let uid: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(user_email)
        .fetch_one(app.db())
        .await
        .unwrap();
    sqlx::query("INSERT INTO clubs (id, slug, name, modalities) VALUES ($1, $2, 'Pace Forte', '{run,swim}')").bind(club).bind(format!("pace-{}", &club.simple().to_string()[..8])).execute(app.db()).await.unwrap();
    sqlx::query("INSERT INTO club_branding (club_id, primary_color, theme, theme_css) VALUES ($1, '#E4572E', '{\"primary\":\"#E4572E\",\"source\":\"derived\"}', ':root{}')").bind(club).execute(app.db()).await.unwrap();
    sqlx::query(
        "INSERT INTO club_subscriptions (club_id, plan, student_limit) VALUES ($1, 'pro', 100)",
    )
    .bind(club)
    .execute(app.db())
    .await
    .unwrap();
    sqlx::query("INSERT INTO memberships (id, club_id, user_id, role) VALUES ($1, $2, $3, $4)")
        .bind(Uuid::now_v7())
        .bind(club)
        .bind(uid)
        .bind(role)
        .execute(app.db())
        .await
        .unwrap();
    club
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn me_lists_clubs_with_branding_and_plan(db: PgPool) {
    let app = TestApp::new(db);
    let t = app.sign_in("ana@email.com").await;
    let club = club_with(&app, "ana@email.com", "trainer").await;
    let me = app.get("/v1/me", Some(&t)).await;
    let m = &me.ok()["memberships"][0];
    assert_eq!(m["club"]["id"], club.to_string());
    assert_eq!(m["club"]["modalities"], json!(["run", "swim"]));
    assert_eq!(m["membership"]["role"], "trainer");
    assert_eq!(m["branding"]["primary_color"], "#E4572E");
    assert_eq!(m["branding"]["theme"]["source"], "derived");
    assert_eq!(m["branding"]["logo_url"], Value::Null);
    assert_eq!(
        (
            m["subscription"]["plan"].as_str(),
            m["subscription"]["student_limit"].as_i64(),
            m["subscription"]["active_students"].as_i64()
        ),
        (Some("pro"), Some(100), Some(0))
    );
    app.post(
        "/v1/me/consents",
        Some(&t),
        json!({ "kind": "share_training_data", "club_id": club }),
    )
    .await
    .ok();
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn delete_account_anonymizes_and_allows_a_fresh_start(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("dona@email.com").await;
    club_with(&app, "dona@email.com", "owner").await;
    app.delete("/v1/me", Some(&owner))
        .await
        .problem(409, "account.owns_club");

    let t = app.sign_in("ana@email.com").await;
    let export = app.get("/v1/me/export", Some(&t)).await;
    assert_eq!(export.ok()["user"]["email"], "ana@email.com");
    assert_eq!(export.body["consents"].as_array().unwrap().len(), 2);
    assert!(export.body.get("exported_at").is_some());

    let gone = app.delete("/v1/me", Some(&t)).await;
    assert_eq!(gone.status, 204);
    app.get("/v1/me", Some(&t))
        .await
        .problem(401, "auth.required");
    let (name, email): (String, String) =
        sqlx::query_as("SELECT name, email FROM users WHERE deleted_at IS NOT NULL")
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(name, "Conta excluída");
    assert!(email.starts_with("deleted+") && email.ends_with("@runflow.club"));

    sqlx::query("UPDATE email_codes SET created_at = created_at - interval '1 minute'")
        .execute(app.db())
        .await
        .unwrap();
    let code = app
        .post(
            "/v1/auth/email/start",
            None,
            json!({ "email": "ana@email.com" }),
        )
        .await
        .ok()["dev_code"]
        .as_str()
        .unwrap()
        .to_string();
    let fresh = app
        .post(
            "/v1/auth/email/verify",
            None,
            json!({ "email": "ana@email.com", "code": code }),
        )
        .await;
    assert_eq!(fresh.ok()["is_new"], true, "a deleted account starts over");
}

// ------------------------------------------------------------------------------------ Google

const KEY: &str = include_str!("../../integrations/tests/fixtures/google-test-key.pem");
const JWKS: &str = include_str!("../../integrations/tests/fixtures/google-test-jwks.json");
const AUD: &str = "web.apps.googleusercontent.com";

async fn fake_jwks() -> String {
    let app = axum::Router::new().route("/certs", axum::routing::get(|| async { JWKS }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/certs", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}

fn id_token(sub: &str, email: &str, name: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("test-key-1".into());
    let claims = json!({ "iss": "accounts.google.com", "aud": AUD, "sub": sub, "email": email, "email_verified": true, "name": name, "iat": now, "exp": now + 600 });
    encode(
        &header,
        &claims,
        &EncodingKey::from_rsa_pem(KEY.as_bytes()).unwrap(),
    )
    .unwrap()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn google_sign_in_creates_and_links_accounts(db: PgPool) {
    let app = TestApp::with(
        db,
        true,
        Some(GoogleVerifier::new(fake_jwks().await, vec![AUD.into()])),
    );
    app.post("/v1/auth/google", None, json!({ "id_token": "forged" }))
        .await
        .problem(400, "auth.google_failed");

    let first = app
        .post(
            "/v1/auth/google",
            None,
            json!({ "id_token": id_token("g-1", "Bruno@Gmail.com", "Bruno Lima") }),
        )
        .await;
    assert_eq!(
        (
            first.ok()["is_new"].as_bool(),
            first.body["user"]["name"].as_str(),
            first.body["user"]["email"].as_str()
        ),
        (Some(true), Some("Bruno Lima"), Some("bruno@gmail.com"))
    );
    let again = app
        .post(
            "/v1/auth/google",
            None,
            json!({ "id_token": id_token("g-1", "bruno@gmail.com", "Bruno") }),
        )
        .await;
    assert_eq!(
        (again.ok()["is_new"].as_bool(), &again.body["user"]["id"]),
        (Some(false), &first.body["user"]["id"])
    );

    // Someone who signed up with an e-mail code and later uses Google with the same address: same account.
    let t = app.sign_in("carla@gmail.com").await;
    let me = app.get("/v1/me", Some(&t)).await.ok()["user"]["id"].clone();
    let g = app
        .post(
            "/v1/auth/google",
            None,
            json!({ "id_token": id_token("g-2", "carla@gmail.com", "Carla") }),
        )
        .await;
    assert_eq!(
        (g.ok()["is_new"].as_bool(), &g.body["user"]["id"]),
        (Some(false), &me)
    );
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM auth_identities WHERE user_id = $1")
        .bind(Uuid::parse_str(me.as_str().unwrap()).unwrap())
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(n, 2, "email + google identities");
}
