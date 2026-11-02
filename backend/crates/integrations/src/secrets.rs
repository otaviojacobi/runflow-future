//! Encryption at rest for provider tokens (§7.7): AES-256-GCM, random 96-bit nonce stored in front of the
//! ciphertext. Key: `ENCRYPTION_KEY` (32 bytes, base64). Changing the key makes stored tokens unreadable.

use aws_lc_rs::aead::{AES_256_GCM, Aad, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use aws_lc_rs::rand;

#[derive(Clone)]
pub struct TokenCipher {
    key: std::sync::Arc<LessSafeKey>,
}

impl std::fmt::Debug for TokenCipher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TokenCipher(***)")
    }
}

#[derive(Debug, thiserror::Error)]
#[error("token cipher: {0}")]
pub struct CipherError(&'static str);

impl TokenCipher {
    /// `key` must be exactly 32 bytes.
    pub fn new(key: &[u8]) -> Result<Self, CipherError> {
        let unbound = UnboundKey::new(&AES_256_GCM, key).map_err(|_| {
            CipherError("ENCRYPTION_KEY must be 32 bytes (openssl rand -base64 32)")
        })?;
        Ok(Self {
            key: std::sync::Arc::new(LessSafeKey::new(unbound)),
        })
    }

    pub fn encrypt(&self, plain: &[u8]) -> Vec<u8> {
        let mut nonce = [0u8; NONCE_LEN];
        rand::fill(&mut nonce).expect("system randomness");
        let mut buf = plain.to_vec();
        self.key
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::empty(), &mut buf)
            .expect("seal");
        let mut out = nonce.to_vec();
        out.extend(buf);
        out
    }

    pub fn decrypt(&self, sealed: &[u8]) -> Result<Vec<u8>, CipherError> {
        if sealed.len() < NONCE_LEN + 16 {
            return Err(CipherError("ciphertext too short"));
        }
        let (nonce, rest) = sealed.split_at(NONCE_LEN);
        let nonce =
            Nonce::try_assume_unique_for_key(nonce).map_err(|_| CipherError("bad nonce"))?;
        let mut buf = rest.to_vec();
        let plain = self
            .key
            .open_in_place(nonce, Aad::empty(), &mut buf)
            .map_err(|_| CipherError("cannot decrypt (wrong ENCRYPTION_KEY?)"))?;
        Ok(plain.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_tamper() {
        let c = TokenCipher::new(&[7u8; 32]).unwrap();
        let a = c.encrypt(b"strava-access-token");
        let b = c.encrypt(b"strava-access-token");
        assert_ne!(a, b, "random nonce");
        assert_eq!(c.decrypt(&a).unwrap(), b"strava-access-token");
        let mut bad = a.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(c.decrypt(&bad).is_err());
        assert!(TokenCipher::new(&[1u8; 31]).is_err());
        assert!(
            TokenCipher::new(&[9u8; 32]).unwrap().decrypt(&a).is_err(),
            "other key"
        );
    }
}
