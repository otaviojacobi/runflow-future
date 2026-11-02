//! Resend HTTP API (`POST /emails`). Retries rate limits and server errors a couple of times.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{Email, EmailError, Sent};

#[derive(Clone)]
pub struct Resend {
    http: reqwest::Client,
    endpoint: String,
    api_key: String,
    from: String,
    reply_to: Option<String>,
}

/// Never prints the API key.
impl std::fmt::Debug for Resend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Resend")
            .field("endpoint", &self.endpoint)
            .field("from", &self.from)
            .finish_non_exhaustive()
    }
}

#[derive(Serialize)]
struct Body<'a> {
    from: &'a str,
    to: &'a [String],
    subject: &'a str,
    html: &'a str,
    text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to: Option<&'a str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tags: Vec<Tag<'a>>,
}

#[derive(Serialize)]
struct Tag<'a> {
    name: &'a str,
    value: &'a str,
}

#[derive(Deserialize)]
struct Created {
    id: String,
}

#[derive(Deserialize, Default)]
struct ApiError {
    #[serde(default)]
    name: String,
    #[serde(default)]
    message: String,
}

const ATTEMPTS: u32 = 3;

impl Resend {
    pub fn new(
        base_url: &str,
        api_key: String,
        from: String,
        reply_to: Option<String>,
        timeout: Duration,
    ) -> Result<Self, EmailError> {
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .user_agent(concat!("runflow/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| EmailError::Config(format!("http client: {e}")))?;
        Ok(Self {
            http,
            endpoint: format!("{}/emails", base_url.trim_end_matches('/')),
            api_key,
            from,
            reply_to,
        })
    }

    pub async fn send(&self, email: &Email) -> Result<Sent, EmailError> {
        let body = Body {
            from: &self.from,
            to: &email.to,
            subject: &email.subject,
            html: &email.html,
            text: &email.text,
            reply_to: email.reply_to.as_deref().or(self.reply_to.as_deref()),
            tags: email
                .tags
                .iter()
                .map(|(name, value)| Tag { name, value })
                .collect(),
        };
        let mut attempt = 0;
        loop {
            attempt += 1;
            let mut req = self
                .http
                .post(&self.endpoint)
                .bearer_auth(&self.api_key)
                .json(&body);
            if let Some(key) = &email.idempotency_key {
                req = req.header("Idempotency-Key", key);
            }
            let outcome = match req.send().await {
                Ok(res) if res.status().is_success() => {
                    let created: Created = res
                        .json()
                        .await
                        .map_err(|e| EmailError::Transport(format!("unexpected response: {e}")))?;
                    return Ok(Sent { id: created.id });
                }
                Ok(res) => {
                    let status = res.status();
                    let retry_after = res
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok())
                        .map(Duration::from_secs);
                    let err: ApiError = res.json().await.unwrap_or_default();
                    let retryable = status.as_u16() == 429 || status.is_server_error();
                    let error = EmailError::Rejected {
                        status: status.as_u16(),
                        name: err.name,
                        message: err.message,
                    };
                    (retryable, retry_after, error)
                }
                Err(e) => (
                    e.is_timeout() || e.is_connect(),
                    None,
                    EmailError::Transport(e.to_string()),
                ),
            };
            let (retryable, retry_after, error) = outcome;
            if !retryable || attempt >= ATTEMPTS {
                return Err(error);
            }
            let wait = retry_after
                .unwrap_or(Duration::from_millis(400 * 3u64.pow(attempt - 1)))
                .min(Duration::from_secs(5));
            tracing::warn!(%error, attempt, ?wait, "resend: retrying");
            tokio::time::sleep(wait).await;
        }
    }
}
