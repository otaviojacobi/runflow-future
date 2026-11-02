//! Transactional e-mail (D-026): Resend in production, the server log in development.
//! Content is pt-BR (D-013); build bodies with [`layout`] so every message looks like Runflow.

mod layout;
mod resend;

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};

pub use layout::{Action, ClubFrame, club_layout, code_block, escape_html, layout, paragraph};
pub use resend::Resend;

/// One message. `html` and `text` should say the same thing (text is the fallback for plain clients).
#[derive(Debug, Clone, Default)]
pub struct Email {
    pub to: Vec<String>,
    pub subject: String,
    pub html: String,
    pub text: String,
    /// Overrides the configured default reply-to.
    pub reply_to: Option<String>,
    /// Same key within 24 h = Resend sends once (safe retries from jobs).
    pub idempotency_key: Option<String>,
    /// Shown in the Resend dashboard, e.g. `("kind", "invite")`. ASCII letters, digits, `_` and `-` only.
    pub tags: Vec<(String, String)>,
    /// The main call to action `(label, url)`, also rendered by the dev outbox.
    pub link: Option<(String, String)>,
}

impl Email {
    /// The `kind` tag, if any.
    pub fn kind(&self) -> Option<&str> {
        self.tags
            .iter()
            .find(|(k, _)| k == "kind")
            .map(|(_, v)| v.as_str())
    }
}

/// E-mails "sent" by the log provider, newest first (dev outbox, tests). Bounded.
#[derive(Clone, Default)]
pub struct Outbox(Arc<Mutex<VecDeque<Logged>>>);

#[derive(Debug, Clone)]
pub struct Logged {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub email: Email,
}

impl Outbox {
    const MAX: usize = 200;

    fn push(&self, logged: Logged) {
        let mut q = self.0.lock().unwrap_or_else(|e| e.into_inner());
        q.push_front(logged);
        q.truncate(Self::MAX);
    }

    pub fn list(&self) -> Vec<Logged> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .cloned()
            .collect()
    }
}

impl std::fmt::Debug for Outbox {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Outbox({} e-mails)", self.list().len())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Resend,
    Log,
}

#[derive(Clone)]
pub struct EmailSettings {
    pub provider: Provider,
    pub resend_api_key: Option<String>,
    pub resend_api_url: String,
    /// `Runflow <contato@runflow.club>`. The domain must be verified in Resend.
    pub from: String,
    pub reply_to: Option<String>,
}

/// Never prints the API key.
impl std::fmt::Debug for EmailSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EmailSettings")
            .field("provider", &self.provider)
            .field(
                "resend_api_key",
                &self.resend_api_key.as_ref().map(|_| "***"),
            )
            .field("resend_api_url", &self.resend_api_url)
            .field("from", &self.from)
            .field("reply_to", &self.reply_to)
            .finish()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum EmailError {
    #[error("e-mail is not configured: {0}")]
    Config(String),
    #[error("e-mail provider rejected the message ({status} {name}): {message}")]
    Rejected {
        status: u16,
        name: String,
        message: String,
    },
    #[error("e-mail provider unreachable: {0}")]
    Transport(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sent {
    /// Provider message id (`log-…` for the log provider).
    pub id: String,
}

/// The configured sender. Cheap to clone.
#[derive(Debug, Clone)]
pub enum Mailer {
    Resend(Resend),
    /// Development: print to the log and keep a copy in the outbox.
    Log {
        from: String,
        outbox: Outbox,
    },
}

impl Mailer {
    pub fn from_settings(s: &EmailSettings) -> Result<Self, EmailError> {
        match s.provider {
            Provider::Log => Ok(Self::Log {
                from: s.from.clone(),
                outbox: Outbox::default(),
            }),
            Provider::Resend => {
                let key = s
                    .resend_api_key
                    .clone()
                    .filter(|k| !k.trim().is_empty())
                    .ok_or_else(|| {
                        EmailError::Config("EMAIL_PROVIDER=resend needs RESEND_API_KEY".into())
                    })?;
                Ok(Self::Resend(Resend::new(
                    &s.resend_api_url,
                    key,
                    s.from.clone(),
                    s.reply_to.clone(),
                    Duration::from_secs(10),
                )?))
            }
        }
    }

    pub fn provider(&self) -> Provider {
        match self {
            Self::Resend(_) => Provider::Resend,
            Self::Log { .. } => Provider::Log,
        }
    }

    /// The dev outbox (log provider only).
    pub fn outbox(&self) -> Option<&Outbox> {
        match self {
            Self::Log { outbox, .. } => Some(outbox),
            Self::Resend(_) => None,
        }
    }

    pub async fn send(&self, email: &Email) -> Result<Sent, EmailError> {
        if email.to.is_empty() {
            return Err(EmailError::Config("no recipients".into()));
        }
        match self {
            Self::Resend(r) => r.send(email).await,
            Self::Log { from, outbox } => {
                let created_at = Utc::now();
                let id = format!(
                    "log-{}",
                    created_at.timestamp_nanos_opt().unwrap_or_default()
                );
                outbox.push(Logged {
                    id: id.clone(),
                    created_at,
                    email: email.clone(),
                });
                tracing::info!(
                    target: "runflow::email",
                    %from, to = ?email.to, subject = %email.subject,
                    "e-mail not sent (EMAIL_PROVIDER=log):\n{}", email.text
                );
                Ok(Sent { id })
            }
        }
    }
}
