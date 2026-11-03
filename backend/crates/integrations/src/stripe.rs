//! Stripe (D-016, D-043): Checkout and the Billing Portal for the paid plans, Max's seat items, the one-time setup
//! (prices by lookup key, the webhook endpoint, the portal configuration) and webhook signatures. We never trust an
//! event that isn't signed with the endpoint's secret.

use std::collections::HashMap;
use std::time::Duration;

use aws_lc_rs::hmac;
use serde_json::Value;

pub const STRIPE_BASE: &str = "https://api.stripe.com";
/// Signed events older (or newer) than this are rejected as replays.
pub const TOLERANCE_S: i64 = 300;

/// Our prices, found by lookup key (created by `runflow stripe-setup` from `api/plans.json`).
pub const PRICE_PRO: &str = "runflow_pro_monthly";
pub const PRICE_MAX: &str = "runflow_max_monthly";
pub const PRICE_MAX_TRAINER: &str = "runflow_max_extra_trainer_monthly";
pub const PRICE_MAX_STUDENT: &str = "runflow_max_extra_student_monthly";
pub const LOOKUP_KEYS: [&str; 4] = [PRICE_PRO, PRICE_MAX, PRICE_MAX_TRAINER, PRICE_MAX_STUDENT];

/// The webhook events the worker applies.
pub const EVENTS: [&str; 12] = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.created",
    "invoice.finalized",
    "invoice.updated",
    "invoice.paid",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
    "invoice.voided",
    "invoice.marked_uncollectible",
];

/// The plan a subscription is on, from its items' price lookup keys, else our metadata.
pub fn plan_of_subscription(subscription: &Value) -> Option<&'static str> {
    let keys: Vec<&str> = subscription["items"]["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|i| i["price"]["lookup_key"].as_str())
        .collect();
    if keys.contains(&PRICE_MAX) {
        return Some("max");
    }
    if keys.contains(&PRICE_PRO) {
        return Some("pro");
    }
    match subscription["metadata"]["plan"].as_str() {
        Some("max") => Some("max"),
        Some("pro") => Some("pro"),
        _ => None,
    }
}

/// The line items for a plan: the base price, plus Max's extra seats (quantities above zero only).
pub fn plan_items<'a>(
    prices: &'a HashMap<String, String>,
    plan: &str,
    extra_trainers: i64,
    extra_students: i64,
) -> Result<Vec<(&'a str, i64)>, StripeError> {
    let price = |key: &str| {
        prices.get(key).map(String::as_str).ok_or_else(|| {
            StripeError::Rejected(
                404,
                format!("price {key} missing: run `runflow stripe-setup`"),
            )
        })
    };
    let mut items = vec![(price(if plan == "max" { PRICE_MAX } else { PRICE_PRO })?, 1)];
    if plan == "max" {
        if extra_trainers > 0 {
            items.push((price(PRICE_MAX_TRAINER)?, extra_trainers));
        }
        if extra_students > 0 {
            items.push((price(PRICE_MAX_STUDENT)?, extra_students));
        }
    }
    Ok(items)
}

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

/// A Checkout session for a club's paid plan; the club and the plan travel as metadata.
pub struct Checkout<'a> {
    /// `(price id, quantity)`: the plan's base price first, then Max's extra seats.
    pub items: &'a [(&'a str, i64)],
    /// `pro` or `max` (D-043).
    pub plan: &'a str,
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
        let req = self.http.post(format!("{}{path}", self.base)).form(form);
        self.send(req).await
    }

    async fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, StripeError> {
        let req = self.http.get(format!("{}{path}", self.base)).query(query);
        self.send(req).await
    }

    async fn delete(&self, path: &str, form: &[(&str, &str)]) -> Result<Value, StripeError> {
        let req = self.http.delete(format!("{}{path}", self.base)).form(form);
        self.send(req).await
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> Result<Value, StripeError> {
        let res = req
            .bearer_auth(&self.secret_key)
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

    /// Our active prices by lookup key → price id.
    pub async fn prices(&self) -> Result<HashMap<String, String>, StripeError> {
        let mut q = vec![("active", "true"), ("limit", "20")];
        q.extend(LOOKUP_KEYS.iter().map(|k| ("lookup_keys[]", *k)));
        let list = self.get("/v1/prices", &q).await?;
        Ok(list["data"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| {
                Some((
                    p["lookup_key"].as_str()?.to_string(),
                    p["id"].as_str()?.to_string(),
                ))
            })
            .collect())
    }

    pub async fn subscription(&self, id: &str) -> Result<Value, StripeError> {
        self.get(&format!("/v1/subscriptions/{id}"), &[]).await
    }

    /// Swaps a subscription's items for `items` right away, prorated (Pro ⇄ Max).
    pub async fn change_plan(
        &self,
        subscription: &Value,
        plan: &str,
        items: &[(&str, i64)],
    ) -> Result<Value, StripeError> {
        let id = subscription["id"].as_str().unwrap_or_default();
        let mut form: Vec<(String, String)> = vec![
            ("proration_behavior".into(), "create_prorations".into()),
            ("metadata[plan]".into(), plan.into()),
        ];
        let mut n = 0;
        for old in subscription["items"]["data"]
            .as_array()
            .into_iter()
            .flatten()
        {
            if let Some(si) = old["id"].as_str() {
                form.push((format!("items[{n}][id]"), si.into()));
                form.push((format!("items[{n}][deleted]"), "true".into()));
                n += 1;
            }
        }
        for (price, quantity) in items {
            form.push((format!("items[{n}][price]"), (*price).into()));
            form.push((format!("items[{n}][quantity]"), quantity.to_string()));
            n += 1;
        }
        let form: Vec<(&str, &str)> = form.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        self.post(&format!("/v1/subscriptions/{id}"), &form).await
    }

    /// Sets the quantity of `price` on a subscription (adds, updates or removes the item), prorated. Returns
    /// whether anything changed.
    pub async fn set_quantity(
        &self,
        subscription: &Value,
        price: &str,
        quantity: i64,
    ) -> Result<bool, StripeError> {
        let item = subscription["items"]["data"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|i| i["price"]["id"].as_str() == Some(price));
        let prorate = ("proration_behavior", "create_prorations");
        let q = quantity.to_string();
        match (item, quantity) {
            (None, 0) => Ok(false),
            (Some(i), 0) => {
                let id = i["id"].as_str().unwrap_or_default();
                self.delete(&format!("/v1/subscription_items/{id}"), &[prorate])
                    .await?;
                Ok(true)
            }
            (Some(i), _) if i["quantity"].as_i64() == Some(quantity) => Ok(false),
            (Some(i), _) => {
                let id = i["id"].as_str().unwrap_or_default();
                self.post(
                    &format!("/v1/subscription_items/{id}"),
                    &[("quantity", &q), prorate],
                )
                .await?;
                Ok(true)
            }
            (None, _) => {
                let sub = subscription["id"].as_str().unwrap_or_default();
                self.post(
                    "/v1/subscription_items",
                    &[
                        ("subscription", sub),
                        ("price", price),
                        ("quantity", &q),
                        prorate,
                    ],
                )
                .await?;
                Ok(true)
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
        let lines: Vec<(String, String)> = c
            .items
            .iter()
            .enumerate()
            .flat_map(|(n, (price, quantity))| {
                [
                    (format!("line_items[{n}][price]"), price.to_string()),
                    (format!("line_items[{n}][quantity]"), quantity.to_string()),
                ]
            })
            .collect();
        let mut form: Vec<(&str, &str)> = lines
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        form.extend([
            ("mode", "subscription"),
            ("client_reference_id", c.club_id),
            ("metadata[club_id]", c.club_id),
            ("subscription_data[metadata][club_id]", c.club_id),
            ("metadata[plan]", c.plan),
            ("subscription_data[metadata][plan]", c.plan),
            ("success_url", c.success_url),
            ("cancel_url", c.cancel_url),
            ("locale", "pt-BR"),
        ]);
        match c.customer {
            Some(customer) => form.push(("customer", customer)),
            None => form.push(("customer_email", c.email)),
        }
        Self::url(&self.post("/v1/checkout/sessions", &form).await?)
    }

    /// The Billing Portal for a customer (card, invoices, cancel), with our portal configuration when it exists.
    pub async fn portal(&self, customer: &str, return_url: &str) -> Result<String, StripeError> {
        let config = self.portal_configuration().await.ok().flatten();
        let mut form = vec![("customer", customer), ("return_url", return_url)];
        if let Some(c) = &config {
            form.push(("configuration", c));
        }
        Self::url(&self.post("/v1/billing_portal/sessions", &form).await?)
    }

    async fn portal_configuration(&self) -> Result<Option<String>, StripeError> {
        let list = self
            .get(
                "/v1/billing_portal/configurations",
                &[("active", "true"), ("limit", "20")],
            )
            .await?;
        Ok(list["data"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|c| c["metadata"]["runflow"] == "portal")
            .and_then(|c| c["id"].as_str().map(str::to_string)))
    }

    /// One-time setup, safe to repeat: the prices (`prices`: lookup key → (product name, cents a month, BRL)), the
    /// portal configuration and the webhook endpoint at `webhook_url`. A price whose amount changed gets a new
    /// price that takes over the lookup key.
    pub async fn setup(
        &self,
        prices: &[(&str, &str, i64)],
        webhook_url: &str,
    ) -> Result<SetupReport, StripeError> {
        let mut report = SetupReport::default();
        let mut q = vec![
            ("active", "true"),
            ("limit", "20"),
            ("expand[]", "data.product"),
        ];
        q.extend(prices.iter().map(|(k, _, _)| ("lookup_keys[]", *k)));
        let existing = self.get("/v1/prices", &q).await?;
        for (key, name, cents) in prices {
            let found = existing["data"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|p| p["lookup_key"] == *key);
            if let Some(p) = found.filter(|p| p["unit_amount"].as_i64() == Some(*cents)) {
                report.prices.push((
                    key.to_string(),
                    p["id"].as_str().unwrap_or_default().to_string(),
                    false,
                ));
                continue;
            }
            let cents = cents.to_string();
            let mut form = vec![
                ("currency", "brl"),
                ("unit_amount", cents.as_str()),
                ("recurring[interval]", "month"),
                ("lookup_key", *key),
                ("transfer_lookup_key", "true"),
            ];
            let product = found.and_then(|p| p["product"]["id"].as_str().or(p["product"].as_str()));
            match product {
                Some(id) => form.push(("product", id)),
                None => form.push(("product_data[name]", *name)),
            }
            let p = self.post("/v1/prices", &form).await?;
            report.prices.push((
                key.to_string(),
                p["id"].as_str().unwrap_or_default().to_string(),
                true,
            ));
        }

        if self.portal_configuration().await?.is_none() {
            self.post(
                "/v1/billing_portal/configurations",
                &[
                    (
                        "business_profile[headline]",
                        "Runflow · assinatura do clube",
                    ),
                    ("features[invoice_history][enabled]", "true"),
                    ("features[payment_method_update][enabled]", "true"),
                    ("features[subscription_cancel][enabled]", "true"),
                    ("features[subscription_cancel][mode]", "at_period_end"),
                    ("metadata[runflow]", "portal"),
                ],
            )
            .await?;
            report.portal_created = true;
        }

        let endpoints = self
            .get("/v1/webhook_endpoints", &[("limit", "100")])
            .await?;
        let events: Vec<(&str, &str)> = EVENTS.iter().map(|e| ("enabled_events[]", *e)).collect();
        let same = endpoints["data"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|e| e["url"] == webhook_url);
        match same.and_then(|e| e["id"].as_str()) {
            Some(id) => {
                self.post(&format!("/v1/webhook_endpoints/{id}"), &events)
                    .await?;
                report.webhook_id = id.to_string();
            }
            None => {
                let mut form = events.clone();
                form.push(("url", webhook_url));
                form.push(("description", "Runflow API"));
                let e = self.post("/v1/webhook_endpoints", &form).await?;
                report.webhook_id = e["id"].as_str().unwrap_or_default().to_string();
                report.webhook_secret = e["secret"].as_str().map(str::to_string);
            }
        }
        Ok(report)
    }
}

/// What `setup` found or created. `webhook_secret` only exists when the endpoint was just created (Stripe shows it
/// once).
#[derive(Default)]
pub struct SetupReport {
    /// `(lookup key, price id, created now)`.
    pub prices: Vec<(String, String, bool)>,
    pub portal_created: bool,
    pub webhook_id: String,
    pub webhook_secret: Option<String>,
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
