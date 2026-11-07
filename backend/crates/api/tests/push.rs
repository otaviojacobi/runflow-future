//! S7b push: devices register their Web Push subscription; notifications go to them per the person's switches
//! (per kind, pause; D-045), encrypted (RFC 8291) and signed (VAPID); dead subscriptions are forgotten.
//! A fake push service decrypts what it receives with the browser's keys.

mod common;

use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD;

use aws_lc_rs::aead::{AES_128_GCM, Aad, LessSafeKey, Nonce, UnboundKey};
use aws_lc_rs::agreement::{self, ECDH_P256, PrivateKey, UnparsedPublicKey};
use aws_lc_rs::error::Unspecified;
use aws_lc_rs::hkdf::{HKDF_SHA256, KeyType, Salt};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::routing::post;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use common::TestApp;
use serde_json::{Value, json};
use sqlx::PgPool;

/// A browser: its subscription keys.
struct Browser {
    private: PrivateKey,
    public: Vec<u8>,
    auth: [u8; 16],
}

impl Browser {
    fn new() -> Self {
        let private = PrivateKey::generate(&ECDH_P256).unwrap();
        let public = private.compute_public_key().unwrap().as_ref().to_vec();
        Self {
            private,
            public,
            auth: [9; 16],
        }
    }

    fn keys(&self) -> Value {
        json!({ "p256dh": B64.encode(&self.public), "auth": B64.encode(self.auth) })
    }

    /// RFC 8291 decryption, as the browser does it.
    fn decrypt(&self, body: &[u8]) -> Value {
        struct Len(usize);
        impl KeyType for Len {
            fn len(&self) -> usize {
                self.0
            }
        }
        let hkdf = |salt: &[u8], ikm: &[u8], info: &[u8], len: usize| {
            let prk = Salt::new(HKDF_SHA256, salt).extract(ikm);
            let info = [info];
            let okm = prk.expand(&info, Len(len)).unwrap();
            let mut out = vec![0; len];
            okm.fill(&mut out).unwrap();
            out
        };
        let (salt, rest) = body.split_at(16);
        assert_eq!(&rest[..4], &4096u32.to_be_bytes());
        let id_len = rest[4] as usize;
        let (as_public, ciphertext) = rest[5..].split_at(id_len);
        let ecdh = agreement::agree(
            &self.private,
            UnparsedPublicKey::new(&ECDH_P256, as_public),
            Unspecified,
            |s| Ok(s.to_vec()),
        )
        .unwrap();
        let mut info = b"WebPush: info\0".to_vec();
        info.extend_from_slice(&self.public);
        info.extend_from_slice(as_public);
        let ikm = hkdf(&self.auth, &ecdh, &info, 32);
        let cek = hkdf(salt, &ikm, b"Content-Encoding: aes128gcm\0", 16);
        let nonce = hkdf(salt, &ikm, b"Content-Encoding: nonce\0", 12);
        let key = LessSafeKey::new(UnboundKey::new(&AES_128_GCM, &cek).unwrap());
        let mut buf = ciphertext.to_vec();
        let plain = key
            .open_in_place(
                Nonce::try_assume_unique_for_key(&nonce).unwrap(),
                Aad::empty(),
                &mut buf,
            )
            .unwrap();
        assert_eq!(plain.last(), Some(&2), "single record delimiter");
        serde_json::from_slice(&plain[..plain.len() - 1]).unwrap()
    }
}

#[derive(Default)]
struct Fake {
    /// (device path, headers, body)
    received: Vec<(String, HeaderMap, Vec<u8>)>,
}

async fn fake_push_service() -> (String, Arc<Mutex<Fake>>) {
    let fake = Arc::new(Mutex::new(Fake::default()));
    let receive = |State(f): State<Arc<Mutex<Fake>>>,
                   Path(device): Path<String>,
                   headers: HeaderMap,
                   body: Bytes| async move {
        f.lock()
            .unwrap()
            .received
            .push((device.clone(), headers, body.to_vec()));
        if device == "gone" {
            StatusCode::GONE
        } else {
            StatusCode::CREATED
        }
    };
    let app = Router::new()
        .route("/push/{device}", post(receive))
        .with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, fake)
}

/// Owner + a student who joined; returns (club, owner token, student token).
async fn setup(app: &TestApp) -> (String, String, String) {
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
    let i = app
        .post(
            &format!("/v1/clubs/{club}/invites"),
            Some(&owner),
            json!({ "email": "ana@email.com" }),
        )
        .await;
    let token = i.body["url"]
        .as_str()
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_string();
    let ana = app.sign_in("ana@email.com").await;
    app.post(
        &format!("/v1/invites/{token}/accept"),
        Some(&ana),
        json!({}),
    )
    .await
    .ok();
    // Messages don't push by default (D-045); Ana switches them on, so the tests below have a push to follow.
    app.patch(
        "/v1/me/prefs",
        Some(&ana),
        json!({ "kinds": { "message": { "push": true } } }),
    )
    .await
    .ok();
    (club, owner, ana)
}

/// A conversation message from the owner to Ana: a `message` notification (push switched on in `setup`).
async fn message(app: &TestApp, club: &str, owner: &str, ana: &str, text: &str) {
    let path = format!("/v1/clubs/{club}/conversations");
    let conv = app.get(&path, Some(ana)).await.ok()["items"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    app.post(
        &format!("{path}/{conv}/messages"),
        Some(owner),
        json!({ "body": text }),
    )
    .await
    .ok();
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn devices_register_and_get_pushes(db: PgPool) {
    let (base, fake) = fake_push_service().await;
    let app = TestApp::new(db).with_push();
    let (club, owner, ana) = setup(&app).await;
    assert!(app.get("/v1/public/config", None).await.ok()["push_public_key"].is_string());

    // Validation: platform, a known push service (or the local fake in dev), keys for web.
    let bad = app
        .post(
            "/v1/me/push-tokens",
            Some(&ana),
            json!({ "platform": "fax", "token": "https://evil.example/x" }),
        )
        .await;
    bad.problem(422, "validation.failed");
    assert_eq!(bad.body["errors"][0]["field"], "platform");
    app.post("/v1/me/push-tokens", Some(&ana), json!({ "platform": "web", "token": "https://evil.example/x", "keys": Browser::new().keys() }))
        .await
        .problem(422, "validation.failed");
    app.post(
        "/v1/me/push-tokens",
        Some(&ana),
        json!({ "platform": "web", "token": format!("{base}/push/phone") }),
    )
    .await
    .problem(422, "validation.failed");

    // Two devices: one live, one the push service no longer knows.
    let phone = Browser::new();
    for (device, keys) in [("phone", phone.keys()), ("gone", Browser::new().keys())] {
        let r = app
            .post("/v1/me/push-tokens", Some(&ana), json!({ "platform": "web", "token": format!("{base}/push/{device}"), "keys": keys }))
            .await;
        assert_eq!(r.status.as_u16(), 204);
    }

    message(&app, &club, &owner, &ana, "Bora treinar amanhã?").await;
    app.run_jobs().await;
    let received = std::mem::take(&mut fake.lock().unwrap().received);
    assert_eq!(received.len(), 2);
    let (device, headers, body) = received.iter().find(|r| r.0 == "phone").unwrap();
    assert_eq!(device, "phone");
    assert_eq!(headers["content-encoding"], "aes128gcm");
    assert_eq!(headers["ttl"], "86400");
    assert!(
        headers["authorization"]
            .to_str()
            .unwrap()
            .starts_with("vapid t=")
    );
    let msg = phone.decrypt(body);
    // Signed by the club (D-057): its name over the notice.
    assert_eq!(msg["title"], "Pace Forte");
    assert!(
        msg["body"]
            .as_str()
            .unwrap()
            .starts_with("Marcos respondeu: ")
    );
    assert!(msg["link"].as_str().unwrap().starts_with("/messages"));
    assert!(msg["id"].is_string());
    assert!(msg["club_id"].is_string());
    // The dead subscription is forgotten; the notification is marked pushed.
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM push_tokens")
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(left, 1);
    let pushed: i64 =
        sqlx::query_scalar("SELECT count(*) FROM notifications WHERE pushed_at IS NOT NULL")
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(pushed, 1);

    // Turned off for the kind: no push (the center still has it).
    app.patch(
        "/v1/me/prefs",
        Some(&ana),
        json!({ "kinds": { "message": { "push": false } } }),
    )
    .await
    .ok();
    message(&app, &club, &owner, &ana, "Outra").await;
    app.run_jobs().await;
    assert!(fake.lock().unwrap().received.is_empty());

    // Forgetting the device stops pushes for good.
    app.patch(
        "/v1/me/prefs",
        Some(&ana),
        json!({ "kinds": { "message": { "push": true } } }),
    )
    .await
    .ok();
    app.call(
        Method::DELETE,
        "/v1/me/push-tokens",
        Some(&ana),
        Some(json!({ "token": format!("{base}/push/phone") })),
        &[],
    )
    .await
    .ok();
    message(&app, &club, &owner, &ana, "Mais uma").await;
    app.run_jobs().await;
    assert!(fake.lock().unwrap().received.is_empty());
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn pause_and_reading_first(db: PgPool) {
    let (base, fake) = fake_push_service().await;
    let app = TestApp::new(db).with_push();
    let (club, owner, ana) = setup(&app).await;
    let phone = Browser::new();
    app.post(
        "/v1/me/push-tokens",
        Some(&ana),
        json!({ "platform": "web", "token": format!("{base}/push/phone"), "keys": phone.keys() }),
    )
    .await
    .ok();

    // Read in the app before the worker got to it: the push is dropped.
    message(&app, &club, &owner, &ana, "Bom dia").await;
    app.post(
        "/v1/me/notifications/read",
        Some(&ana),
        json!({ "all": true }),
    )
    .await;
    app.run_jobs().await;
    assert!(fake.lock().unwrap().received.is_empty());

    // Paused: no push at all (the center still gets it).
    app.patch("/v1/me/prefs", Some(&ana), json!({ "paused": true }))
        .await
        .ok();
    message(&app, &club, &owner, &ana, "Oi").await;
    app.run_jobs().await;
    assert!(fake.lock().unwrap().received.is_empty());
    let queued: i64 =
        sqlx::query_scalar("SELECT count(*) FROM notifications WHERE push_at IS NOT NULL")
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(queued, 1, "only the first one was ever queued");
    let center = app.get("/v1/me/notifications", Some(&ana)).await;
    assert_eq!(center.ok()["items"].as_array().unwrap().len(), 2);

    // Back from the pause: pushes again.
    app.patch("/v1/me/prefs", Some(&ana), json!({ "paused": false }))
        .await
        .ok();
    message(&app, &club, &owner, &ana, "Voltou").await;
    app.run_jobs().await;
    let received = std::mem::take(&mut fake.lock().unwrap().received);
    assert_eq!(received.len(), 1);
    assert_eq!(
        phone.decrypt(&received[0].2)["body"],
        "Marcos respondeu: Voltou"
    );
}

/// A PNG's signature and header: enough for the asset check.
const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R',
];

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn a_personal_notice_is_signed_by_the_only_club(db: PgPool) {
    let app = TestApp::new(db);
    let (_club, _owner, ana) = setup(&app).await;
    let user: uuid::Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = 'ana@email.com'")
        .fetch_one(app.db())
        .await
        .unwrap();
    // A Strava sync has no club: Ana studies at one, so it's signed by it.
    let brand = runflow_db::push::brand(app.db(), None, user).await.unwrap();
    assert_eq!(brand.map(|b| b.name).as_deref(), Some("Pace Forte"));
    // In two clubs, no club speaks for a personal notice: it goes out as it is.
    let other = app
        .post(
            "/v1/clubs",
            Some(&ana),
            json!({ "name": "Outro Clube", "modalities": ["run"] }),
        )
        .await;
    assert_eq!(other.status, StatusCode::CREATED);
    assert!(
        runflow_db::push::brand(app.db(), None, user)
            .await
            .unwrap()
            .is_none()
    );
}

type ExpoSeen = Arc<Mutex<Vec<Value>>>;

/// A fake Expo push service: accepts every token except `ExponentPushToken[gone]`.
async fn fake_expo() -> (String, ExpoSeen) {
    let seen: ExpoSeen = Arc::default();
    let send = |State(s): State<ExpoSeen>, axum::Json(batch): axum::Json<Vec<Value>>| async move {
        let tickets: Vec<Value> = batch
            .iter()
            .map(|m| {
                if m["to"] == "ExponentPushToken[gone]" {
                    json!({ "status": "error", "message": "not registered", "details": { "error": "DeviceNotRegistered" } })
                } else {
                    json!({ "status": "ok", "id": "ticket-1" })
                }
            })
            .collect();
        s.lock().unwrap().extend(batch);
        axum::Json(json!({ "data": tickets }))
    };
    let app = Router::new()
        .route("/--/api/v2/push/send", post(send))
        .with_state(seen.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, seen)
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn phones_get_pushes_through_expo(db: PgPool) {
    let (base, seen) = fake_expo().await;
    let app = TestApp::new(db).with_expo(&base);
    let (club, owner, ana) = setup(&app).await;

    app.post(
        "/v1/me/push-tokens",
        Some(&ana),
        json!({ "platform": "android", "token": "not-a-token" }),
    )
    .await
    .problem(422, "validation.failed");
    for token in ["ExponentPushToken[ana-phone]", "ExponentPushToken[gone]"] {
        let r = app
            .post(
                "/v1/me/push-tokens",
                Some(&ana),
                json!({ "platform": "android", "token": token }),
            )
            .await;
        assert_eq!(r.status.as_u16(), 204);
    }
    // The club's logo goes along as the notification's picture (D-057).
    let logo = app
        .post(
            &format!("/v1/clubs/{club}/assets"),
            Some(&owner),
            json!({ "data_url": format!("data:image/png;base64,{}", STANDARD.encode(PNG)), "width": 512, "height": 512 }),
        )
        .await
        .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    let b = app
        .call(
            Method::PUT,
            &format!("/v1/clubs/{club}/branding"),
            Some(&owner),
            Some(json!({ "primary_color": "#D62828", "logo_asset_id": logo })),
            &[],
        )
        .await;
    assert_eq!(b.status, StatusCode::OK);
    message(&app, &club, &owner, &ana, "Bora treinar amanhã?").await;
    app.run_jobs().await;

    let batch = seen.lock().unwrap().clone();
    assert_eq!(batch.len(), 2, "one request with both phones");
    let m = batch
        .iter()
        .find(|m| m["to"] == "ExponentPushToken[ana-phone]")
        .unwrap();
    // Signed by the club: its name, the notice in the body, its logo as the picture.
    assert_eq!(m["title"], "Pace Forte");
    assert_eq!(m["body"], "Marcos respondeu: Bora treinar amanhã?");
    assert_eq!(
        m["richContent"]["image"],
        format!("http://localhost:3000/v1/assets/{logo}")
    );
    assert!(m["data"]["link"].as_str().unwrap().starts_with("/messages"));
    assert!(m["data"]["id"].is_string());
    // The club, so the app opens the link in the right one.
    assert!(m["data"]["club_id"].is_string());
    // The uninstalled app's token is forgotten; the notification counts as pushed.
    let left: Vec<String> = sqlx::query_scalar("SELECT token FROM push_tokens")
        .fetch_all(app.db())
        .await
        .unwrap();
    assert_eq!(left, ["ExponentPushToken[ana-phone]"]);
    let pushed: i64 =
        sqlx::query_scalar("SELECT count(*) FROM notifications WHERE pushed_at IS NOT NULL")
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(pushed, 1);
}
