//! Expo push (X10's server half): notifications to the phone app through Expo's push service, which talks to
//! FCM and APNs for us. Free, no server credentials needed (an access token only if the Expo project turns on
//! enhanced push security).

use std::time::Duration;

use serde_json::{Value, json};

pub const EXPO_PUSH_BASE: &str = "https://exp.host";
/// Messages per request (Expo's limit).
pub const BATCH: usize = 100;

/// `ExponentPushToken[…]` (or the newer `ExpoPushToken[…]`).
pub fn is_expo_token(token: &str) -> bool {
    ["ExponentPushToken[", "ExpoPushToken["].iter().any(|p| {
        token
            .strip_prefix(p)
            .and_then(|rest| rest.strip_suffix(']'))
            .is_some_and(|id| {
                !id.is_empty()
                    && id.len() <= 256
                    && id.chars().all(|c| c.is_ascii_graphic() && c != ']')
            })
    })
}

pub struct Message<'a> {
    pub to: &'a str,
    pub title: &'a str,
    pub body: Option<&'a str>,
    /// Handed to the app when the notification is opened (`{id, link}`).
    pub data: Value,
    /// Seconds Expo keeps it while the phone is offline.
    pub ttl_s: u32,
}

/// What Expo said about one message.
#[derive(Debug, PartialEq, Eq)]
pub enum Ticket {
    Ok,
    /// The app was uninstalled or the token is stale: forget the device.
    Gone,
    Failed(String),
}

#[derive(Debug, thiserror::Error)]
pub enum ExpoError {
    /// Rate limited, Expo down or unreachable: try the batch again later.
    #[error("expo push unavailable: {0}")]
    Retry(String),
    #[error("expo push refused the request: {0}")]
    Rejected(String),
}

pub struct ExpoPush {
    http: reqwest::Client,
    base: String,
    access_token: Option<String>,
}

impl std::fmt::Debug for ExpoPush {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExpoPush")
            .field("base", &self.base)
            .finish_non_exhaustive()
    }
}

impl ExpoPush {
    pub fn new(base: &str, access_token: Option<String>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("runflow/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self {
            http,
            base: base.trim_end_matches('/').to_string(),
            access_token,
        }
    }

    /// Sends up to [`BATCH`] messages; one ticket per message, in order.
    pub async fn send(&self, messages: &[Message<'_>]) -> Result<Vec<Ticket>, ExpoError> {
        let body: Vec<Value> = messages
            .iter()
            .map(|m| {
                json!({ "to": m.to, "title": m.title, "body": m.body, "data": m.data, "sound": "default",
                        "priority": "high", "ttl": m.ttl_s, "channelId": "default" })
            })
            .collect();
        let mut req = self
            .http
            .post(format!("{}/--/api/v2/push/send", self.base))
            .header("accept", "application/json")
            .json(&body);
        if let Some(t) = &self.access_token {
            req = req.bearer_auth(t);
        }
        let res = req
            .send()
            .await
            .map_err(|e| ExpoError::Retry(e.to_string()))?;
        let status = res.status();
        let v: Value = res.json().await.unwrap_or(Value::Null);
        if status.as_u16() == 429 || status.is_server_error() {
            return Err(ExpoError::Retry(format!("expo answered {status}")));
        }
        if !status.is_success() {
            return Err(ExpoError::Rejected(format!("{status}: {}", v["errors"])));
        }
        let tickets = v["data"].as_array().cloned().unwrap_or_default();
        Ok((0..messages.len())
            .map(|i| {
                let t = &tickets.get(i).cloned().unwrap_or(Value::Null);
                match (t["status"].as_str(), t["details"]["error"].as_str()) {
                    (Some("ok"), _) => Ticket::Ok,
                    (_, Some("DeviceNotRegistered")) => Ticket::Gone,
                    _ => Ticket::Failed(t["message"].as_str().unwrap_or("no ticket").to_string()),
                }
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::is_expo_token;

    #[test]
    fn expo_tokens() {
        assert!(is_expo_token("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"));
        assert!(is_expo_token("ExpoPushToken[abc-123]"));
        assert!(!is_expo_token("ExponentPushToken[]"));
        assert!(!is_expo_token("ExponentPushToken[a b]"));
        assert!(!is_expo_token("https://fcm.googleapis.com/fcm/send/x"));
        assert!(!is_expo_token("ExponentPushToken[x]]"));
    }
}
