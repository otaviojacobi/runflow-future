//! Stripe (D-016): Checkout and the Billing Portal for the Pro plan, and webhook signatures. We never trust an
//! event that isn't signed with the endpoint's secret.

use std::time::Duration;

use aws_lc_rs::hmac;
use serde_json::Value;

pub const STRIPE_BASE: &str = "https://api.stripe.com";
/// Signed events older (or newer) than this are rejected as replays.
pub const TOLERANCE_S: i64 = 300;

#[derive(Debug, thiserror::Error)]
pub enum StripeError {
    /// Bad key, unknown price or customer, invalid parameters (4xx).
    #[error("stripe rejected the request ({0}): {1}")]
    Rejected(u16, String),
    #[error("stripe unreachable: {0}")]
    Transport(String),
}

pub struct StripeClient {
    http: reqwest::Client,
    base: String,
    secret_key: String,
}

impl std::fmt::Debug for StripeClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StripeClient")
            .field("base", &self.base)
            .finish_non_exhaustive()
    }
}

/// A Checkout session for the Pro subscription of a club.
pub struct Checkout<'a> {
    pub price: &'a str,
    pub club_id: &'a str,
    /// The club's customer from an earlier subscription (keeps one customer per club).
    pub customer: Option<&'a str>,
    /// Pre-fills Checkout for a first subscription.
    pub email: &'a str,
    pub success_url: &'a str,
    pub cancel_url: &'a str,
}

impl StripeClient {
    pub fn new(base: &str, secret_key: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("runflow/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self {
            http,
            base: base.trim_end_matches('/').to_string(),
            secret_key,
        }
    }

    async fn post(&self, path: &str, form: &[(&str, &str)]) -> Result<Value, StripeError> {
        let res = self
            .http
            .post(format!("{}{path}", self.base))
            .bearer_auth(&self.secret_key)
            .form(form)
            .send()
            .await
            .map_err(|e| StripeError::Transport(e.to_string()))?;
        let status = res.status();
        let body: Value = res
            .json()
            .await
            .map_err(|e| StripeError::Transport(e.to_string()))?;
        if status.is_success() {
            Ok(body)
        } else {
            let message = body["error"]["message"].as_str().unwrap_or("").to_string();
            if status.is_server_error() {
                Err(StripeError::Transport(format!("{status}: {message}")))
            } else {
                Err(StripeError::Rejected(status.as_u16(), message))
            }
        }
    }

    fn url(v: &Value) -> Result<String, StripeError> {
        v["url"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| StripeError::Transport("response without url".into()))
    }

    /// A hosted Checkout page for the subscription; the club travels as `client_reference_id` and metadata.
    pub async fn checkout(&self, c: Checkout<'_>) -> Result<String, StripeError> {
        let mut form = vec![
            ("mode", "subscription"),
            ("line_items[0][price]", c.price),
            ("line_items[0][quantity]", "1"),
            ("client_reference_id", c.club_id),
            ("metadata[club_id]", c.club_id),
            ("subscription_data[metadata][club_id]", c.club_id),
            ("success_url", c.success_url),
            ("cancel_url", c.cancel_url),
            ("locale", "pt-BR"),
        ];
        match c.customer {
            Some(customer) => form.push(("customer", customer)),
            None => form.push(("customer_email", c.email)),
        }
        Self::url(&self.post("/v1/checkout/sessions", &form).await?)
    }

    /// The Billing Portal for a customer (card, invoices, cancel).
    pub async fn portal(&self, customer: &str, return_url: &str) -> Result<String, StripeError> {
        let form = [("customer", customer), ("return_url", return_url)];
        Self::url(&self.post("/v1/billing_portal/sessions", &form).await?)
    }
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

/// Checks a `Stripe-Signature` header (`t=…,v1=…[,v1=…]`): HMAC-SHA256 of `"{t}.{payload}"` with the endpoint
/// secret, and a timestamp within [`TOLERANCE_S`] of `now` (Unix seconds).
pub fn verify_signature(secret: &str, header: &str, payload: &[u8], now: i64) -> bool {
    let mut t = None;
    let mut signatures = Vec::new();
    for part in header.split(',') {
        match part.trim().split_once('=') {
            Some(("t", v)) => t = v.parse::<i64>().ok(),
            Some(("v1", v)) => signatures.extend(unhex(v)),
            _ => {}
        }
    }
    let Some(t) = t else { return false };
    if (now - t).abs() > TOLERANCE_S {
        return false;
    }
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    let mut message = format!("{t}.").into_bytes();
    message.extend_from_slice(payload);
    signatures
        .iter()
        .any(|s| hmac::verify(&key, &message, s).is_ok())
}

/// A `Stripe-Signature` header for `payload` (tests and local tools).
pub fn sign(secret: &str, payload: &[u8], t: i64) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    let mut message = format!("{t}.").into_bytes();
    message.extend_from_slice(payload);
    let tag = hmac::sign(&key, &message);
    let hex: String = tag.as_ref().iter().map(|b| format!("{b:02x}")).collect();
    format!("t={t},v1={hex}")
}

// ------------------------------------------------------------------------------------ event payloads

/// Our status for a Stripe subscription status; `None` while checkout hasn't finished (`incomplete`).
pub fn plan_status(stripe_status: &str) -> Option<&'static str> {
    match stripe_status {
        "active" => Some("active"),
        "trialing" => Some("trialing"),
        "past_due" | "unpaid" | "paused" => Some("past_due"),
        "canceled" | "incomplete_expired" => Some("canceled"),
        _ => None,
    }
}

/// A subscription's current period end (Unix seconds): on the subscription in older API versions, on its items
/// from 2025-03-31 on.
pub fn period_end(subscription: &Value) -> Option<i64> {
    subscription["current_period_end"]
        .as_i64()
        .or_else(|| subscription["items"]["data"][0]["current_period_end"].as_i64())
}

/// An invoice's billed period (Unix seconds): its first line's, else the invoice's own.
pub fn invoice_period(invoice: &Value) -> Option<(i64, i64)> {
    let line = &invoice["lines"]["data"][0]["period"];
    match (line["start"].as_i64(), line["end"].as_i64()) {
        (Some(a), Some(b)) => Some((a, b)),
        _ => Some((
            invoice["period_start"].as_i64()?,
            invoice["period_end"].as_i64()?,
        )),
    }
}

/// The id in a field that is either an id or an expanded object.
pub fn id_of(v: &Value) -> Option<&str> {
    v.as_str().or_else(|| v["id"].as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signatures() {
        let body = br#"{"id":"evt_1","type":"invoice.paid"}"#;
        let header = sign("whsec_test", body, 1_800_000_000);
        assert!(verify_signature("whsec_test", &header, body, 1_800_000_100));
        // Another secret, a changed body, an old timestamp, garbage.
        assert!(!verify_signature(
            "whsec_other",
            &header,
            body,
            1_800_000_100
        ));
        assert!(!verify_signature(
            "whsec_test",
            &header,
            b"{}",
            1_800_000_100
        ));
        assert!(!verify_signature(
            "whsec_test",
            &header,
            body,
            1_800_000_301
        ));
        assert!(!verify_signature("whsec_test", "t=1,v1=zz", body, 1));
        assert!(!verify_signature("whsec_test", "", body, 1));
        // Several v1 (secret rotation): any one may match.
        let rotated = format!("{header},v1=00ff");
        assert!(verify_signature(
            "whsec_test",
            &rotated,
            body,
            1_800_000_000
        ));
    }

    #[test]
    fn payload_shapes() {
        use serde_json::json;
        assert_eq!(plan_status("unpaid"), Some("past_due"));
        assert_eq!(plan_status("incomplete"), None);
        assert_eq!(period_end(&json!({ "current_period_end": 10 })), Some(10));
        assert_eq!(
            period_end(&json!({ "items": { "data": [{ "current_period_end": 20 }] } })),
            Some(20)
        );
        assert_eq!(
            invoice_period(
                &json!({ "period_start": 1, "period_end": 2, "lines": { "data": [{ "period": { "start": 5, "end": 9 } }] } })
            ),
            Some((5, 9))
        );
        assert_eq!(
            invoice_period(&json!({ "period_start": 1, "period_end": 2 })),
            Some((1, 2))
        );
        assert_eq!(id_of(&json!("cus_1")), Some("cus_1"));
        assert_eq!(id_of(&json!({ "id": "cus_2" })), Some("cus_2"));
    }
}
