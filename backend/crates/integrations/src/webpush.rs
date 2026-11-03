//! Web Push (S7b): system notifications for the installed web app. Messages are encrypted for the browser
//! (RFC 8291, `aes128gcm`) and signed for the push service with VAPID (RFC 8292); the push service only ever sees
//! ciphertext.

use std::time::Duration;

use aws_lc_rs::aead::{AES_128_GCM, Aad, LessSafeKey, Nonce, UnboundKey};
use aws_lc_rs::agreement::{self, ECDH_P256, PrivateKey, UnparsedPublicKey};
use aws_lc_rs::encoding::AsBigEndian;
use aws_lc_rs::error::Unspecified;
use aws_lc_rs::hkdf::{HKDF_SHA256, KeyType, Salt};
use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use aws_lc_rs::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;

/// Record size we declare; one record holds the whole message.
const RECORD_SIZE: u32 = 4096;
/// Largest payload that fits one record (record size − padding delimiter − AEAD tag − header).
pub const MAX_PAYLOAD: usize = 3000;

struct Len(usize);
impl KeyType for Len {
    fn len(&self) -> usize {
        self.0
    }
}

/// HKDF-SHA-256 extract-and-expand.
fn hkdf(salt: &[u8], ikm: &[u8], info: &[u8], len: usize) -> Result<Vec<u8>, Unspecified> {
    let prk = Salt::new(HKDF_SHA256, salt).extract(ikm);
    let info = [info];
    let okm = prk.expand(&info, Len(len))?;
    let mut out = vec![0; len];
    okm.fill(&mut out)?;
    Ok(out)
}

/// RFC 8291 with a given server key and salt (the tests use the RFC's own values).
fn encrypt_with(
    payload: &[u8],
    ua_public: &[u8],
    auth_secret: &[u8],
    as_private: &PrivateKey,
    salt: &[u8; 16],
) -> Result<Vec<u8>, Unspecified> {
    let as_public = as_private.compute_public_key()?;
    let as_public = as_public.as_ref();
    let ecdh_secret = agreement::agree(
        as_private,
        UnparsedPublicKey::new(&ECDH_P256, ua_public),
        Unspecified,
        |s| Ok(s.to_vec()),
    )?;
    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(ua_public);
    key_info.extend_from_slice(as_public);
    let ikm = hkdf(auth_secret, &ecdh_secret, &key_info, 32)?;
    let cek = hkdf(salt, &ikm, b"Content-Encoding: aes128gcm\0", 16)?;
    let nonce = hkdf(salt, &ikm, b"Content-Encoding: nonce\0", 12)?;

    let key = LessSafeKey::new(UnboundKey::new(&AES_128_GCM, &cek)?);
    let mut record = payload.to_vec();
    record.push(2); // last record, no padding
    key.seal_in_place_append_tag(
        Nonce::try_assume_unique_for_key(&nonce)?,
        Aad::empty(),
        &mut record,
    )?;
    let mut body = Vec::with_capacity(86 + record.len());
    body.extend_from_slice(salt);
    body.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    body.push(as_public.len() as u8);
    body.extend_from_slice(as_public);
    body.extend_from_slice(&record);
    Ok(body)
}

/// Encrypts `payload` for a browser subscription (`p256dh` public key and `auth` secret, raw bytes).
pub fn encrypt(
    payload: &[u8],
    ua_public: &[u8],
    auth_secret: &[u8],
) -> Result<Vec<u8>, Unspecified> {
    if payload.len() > MAX_PAYLOAD {
        return Err(Unspecified);
    }
    let rng = SystemRandom::new();
    let mut salt = [0u8; 16];
    rng.fill(&mut salt)?;
    let as_private = PrivateKey::generate(&ECDH_P256)?;
    encrypt_with(payload, ua_public, auth_secret, &as_private, &salt)
}

/// The application server's VAPID identity.
pub struct Vapid {
    key: EcdsaKeyPair,
    public: String,
    subject: String,
}

impl std::fmt::Debug for Vapid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Vapid")
            .field("public", &self.public)
            .field("subject", &self.subject)
            .finish_non_exhaustive()
    }
}

impl Vapid {
    /// From base64url keys (public: uncompressed P-256 point, private: the 32-byte scalar) and a contact
    /// (`mailto:` or `https:`) for the push services.
    pub fn new(public: &str, private: &str, subject: &str) -> Result<Self, String> {
        let pub_bytes = B64
            .decode(public.trim())
            .map_err(|_| "VAPID_PUBLIC_KEY isn't base64url")?;
        let priv_bytes = B64
            .decode(private.trim())
            .map_err(|_| "VAPID_PRIVATE_KEY isn't base64url")?;
        let key = EcdsaKeyPair::from_private_key_and_public_key(
            &ECDSA_P256_SHA256_FIXED_SIGNING,
            &priv_bytes,
            &pub_bytes,
        )
        .map_err(|_| "VAPID keys aren't a P-256 key pair")?;
        Ok(Self {
            key,
            public: B64.encode(&pub_bytes),
            subject: subject.to_string(),
        })
    }

    /// A new key pair, base64url `(public, private)` (`runflow vapid-keys`).
    pub fn generate() -> Result<(String, String), Unspecified> {
        let private = PrivateKey::generate(&ECDH_P256)?;
        let public = private.compute_public_key()?;
        let scalar: aws_lc_rs::encoding::EcPrivateKeyBin = private.as_be_bytes()?;
        Ok((B64.encode(public.as_ref()), B64.encode(scalar.as_ref())))
    }

    /// For the browser's `applicationServerKey` (`/public/config` → `push_public_key`).
    pub fn public_key(&self) -> &str {
        &self.public
    }

    /// The signed claim for one push service (`aud` = its origin), valid for 12 hours from `now`.
    fn jwt(&self, audience: &str, now: i64) -> Result<String, Unspecified> {
        let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims =
            serde_json::json!({ "aud": audience, "exp": now + 12 * 3600, "sub": self.subject });
        let signing_input = format!("{header}.{}", B64.encode(claims.to_string()));
        let sig = self
            .key
            .sign(&SystemRandom::new(), signing_input.as_bytes())?;
        Ok(format!("{signing_input}.{}", B64.encode(sig.as_ref())))
    }

    fn authorization(&self, endpoint: &str, now: i64) -> Option<String> {
        let url = reqwest::Url::parse(endpoint).ok()?;
        let origin = url.origin().ascii_serialization();
        let jwt = self.jwt(&origin, now).ok()?;
        Some(format!("vapid t={jwt}, k={}", self.public))
    }
}

/// What happened to one push.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Sent,
    /// The subscription is gone (404/410): forget the device.
    Gone,
    /// Rate limited or the push service failed: try again later.
    Retry(String),
    /// Refused (bad request, wrong key, too large): don't retry.
    Failed(String),
}

/// A browser's push subscription (from `PushSubscription.toJSON()`).
pub struct Subscription<'a> {
    pub endpoint: &'a str,
    /// base64url
    pub p256dh: &'a str,
    /// base64url
    pub auth: &'a str,
}

pub struct WebPush {
    http: reqwest::Client,
    vapid: Vapid,
}

impl std::fmt::Debug for WebPush {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebPush")
            .field("vapid", &self.vapid)
            .finish_non_exhaustive()
    }
}

impl WebPush {
    pub fn new(vapid: Vapid) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("runflow/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self { http, vapid }
    }

    pub fn public_key(&self) -> &str {
        self.vapid.public_key()
    }

    /// Sends `payload` (JSON, at most [`MAX_PAYLOAD`] bytes); the push service keeps it up to `ttl_s`.
    pub async fn send(&self, sub: &Subscription<'_>, payload: &[u8], ttl_s: u32) -> Outcome {
        let (Ok(p256dh), Ok(auth)) = (B64.decode(sub.p256dh), B64.decode(sub.auth)) else {
            return Outcome::Gone;
        };
        let Ok(body) = encrypt(payload, &p256dh, &auth) else {
            return Outcome::Failed(
                "encryption failed (bad subscription keys or payload too large)".into(),
            );
        };
        let now = chrono::Utc::now().timestamp();
        let Some(authorization) = self.vapid.authorization(sub.endpoint, now) else {
            return Outcome::Gone;
        };
        let res = self
            .http
            .post(sub.endpoint)
            .header("TTL", ttl_s.to_string())
            .header("Content-Encoding", "aes128gcm")
            .header("Content-Type", "application/octet-stream")
            .header("Urgency", "normal")
            .header("Authorization", authorization)
            .body(body)
            .send()
            .await;
        match res {
            Err(e) => Outcome::Retry(e.to_string()),
            Ok(r) => match r.status().as_u16() {
                200..=299 => Outcome::Sent,
                404 | 410 => Outcome::Gone,
                429 | 500..=599 => Outcome::Retry(format!("push service answered {}", r.status())),
                code => Outcome::Failed(format!("push service answered {code}")),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use aws_lc_rs::signature::{ECDSA_P256_SHA256_FIXED, UnparsedPublicKey as VerifyKey};

    use super::*;

    fn b64(s: &str) -> Vec<u8> {
        B64.decode(s.replace([' ', '\n'], "")).unwrap()
    }

    /// RFC 8291 § 5 and appendix A: the same inputs give the RFC's message, byte for byte.
    #[test]
    fn rfc8291_example() {
        let as_private = PrivateKey::from_private_key(
            &ECDH_P256,
            &b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
        )
        .unwrap();
        let ua_public = b64(
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        );
        let auth = b64("BTBZMqHH6r4Tts7J_aSIgg");
        let salt: [u8; 16] = b64("DGv6ra1nlYgDCS1FRnbzlw").try_into().unwrap();
        let body = encrypt_with(
            b"When I grow up, I want to be a watermelon",
            &ua_public,
            &auth,
            &as_private,
            &salt,
        )
        .unwrap();
        let header = b64(
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8",
        );
        let ciphertext =
            b64("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ");
        assert_eq!(body, [header, ciphertext].concat());
    }

    #[test]
    fn vapid_claims_verify_with_the_public_key() {
        let (public, private) = Vapid::generate().unwrap();
        let v = Vapid::new(&public, &private, "mailto:contato@runflow.club").unwrap();
        assert_eq!(v.public_key(), public);
        let auth = v
            .authorization("https://fcm.googleapis.com/fcm/send/abc", 1_800_000_000)
            .unwrap();
        let jwt = auth
            .strip_prefix("vapid t=")
            .unwrap()
            .split(", k=")
            .next()
            .unwrap();
        let parts: Vec<&str> = jwt.split('.').collect();
        let claims: serde_json::Value =
            serde_json::from_slice(&B64.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["aud"], "https://fcm.googleapis.com");
        assert_eq!(claims["exp"], 1_800_000_000i64 + 43_200);
        let key = VerifyKey::new(&ECDSA_P256_SHA256_FIXED, B64.decode(&public).unwrap());
        let signed = format!("{}.{}", parts[0], parts[1]);
        assert!(
            key.verify(signed.as_bytes(), &B64.decode(parts[2]).unwrap())
                .is_ok()
        );
        // Keys that don't belong together are refused.
        let (other, _) = Vapid::generate().unwrap();
        assert!(Vapid::new(&other, &private, "mailto:x@y.z").is_err());
    }

    #[test]
    fn encrypted_messages_have_the_aes128gcm_header() {
        let ua = PrivateKey::generate(&ECDH_P256).unwrap();
        let ua_public = ua.compute_public_key().unwrap();
        let body = encrypt(br#"{"title":"Oi"}"#, ua_public.as_ref(), &[7; 16]).unwrap();
        assert_eq!(&body[16..20], &4096u32.to_be_bytes());
        assert_eq!(body[20], 65);
        assert_eq!(body.len(), 86 + 14 + 1 + 16);
        assert!(encrypt(&vec![b'x'; MAX_PAYLOAD + 1], ua_public.as_ref(), &[7; 16]).is_err());
    }
}
