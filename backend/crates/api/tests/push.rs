//! S7b push: devices register their Web Push subscription; notifications go to them per the person's choices
//! (per kind, pause, quiet hours), encrypted (RFC 8291) and signed (VAPID); dead subscriptions are forgotten.
//! A fake push service decrypts what it receives with the browser's keys.

mod common;

use std::sync::{Arc, Mutex};

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
    (club, owner, ana)
}

/// A conversation message from the owner to Ana: a `message` notification (push on by default).
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

    // Quiet hours off, so the push goes out now.
    app.patch(
        "/v1/me/prefs",
        Some(&ana),
        json!({ "quiet_start": null, "quiet_end": null }),
    )
    .await
    .ok();
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
    assert_eq!(msg["title"], "Marcos respondeu");
    assert!(msg["link"].as_str().unwrap().starts_with("/messages"));
    assert!(msg["id"].is_string());
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
async fn quiet_hours_pause_and_reading_first(db: PgPool) {
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

    // Quiet all day long except one minute: the push waits for the window to end.
    let now = chrono::Utc::now().with_timezone(&chrono_tz::America::Sao_Paulo);
    let start = (now - chrono::Duration::hours(1))
        .format("%H:%M")
        .to_string();
    let end = (now + chrono::Duration::hours(2))
        .format("%H:%M")
        .to_string();
    app.patch(
        "/v1/me/prefs",
        Some(&ana),
        json!({ "quiet_start": start, "quiet_end": end }),
    )
    .await
    .ok();
    message(&app, &club, &owner, &ana, "Bom dia").await;
    app.run_jobs().await;
    assert!(
        fake.lock().unwrap().received.is_empty(),
        "held during quiet hours"
    );
    let wait: f64 = sqlx::query_scalar("SELECT extract(epoch FROM push_at - now())::float8 FROM notifications WHERE push_at IS NOT NULL")
        .fetch_one(app.db())
        .await
        .unwrap();
    assert!(wait > 3600.0 && wait <= 7200.0, "{wait}");

    // Read in the app before quiet hours end: the push is dropped.
    app.post(
        "/v1/me/notifications/read",
        Some(&ana),
        json!({ "all": true }),
    )
    .await;
    sqlx::query("UPDATE jobs SET run_at = now() WHERE kind = 'push.send'")
        .execute(app.db())
        .await
        .unwrap();
    app.run_jobs().await;
    assert!(fake.lock().unwrap().received.is_empty());

    // Paused: no push at all.
    app.patch(
        "/v1/me/prefs",
        Some(&ana),
        json!({ "quiet_start": null, "quiet_end": null, "paused": true }),
    )
    .await
    .ok();
    message(&app, &club, &owner, &ana, "Oi").await;
    let held: i64 =
        sqlx::query_scalar("SELECT count(*) FROM notifications WHERE push_at IS NOT NULL")
            .fetch_one(app.db())
            .await
            .unwrap();
    assert_eq!(held, 1, "only the first one was ever scheduled");
}
