//! Push (S7b): `push.send {notification_id}` runs at the notification's `push_at` (quiet hours delay it) and sends
//! it to each of the person's web devices. Skipped when it was read in the app meanwhile; devices the push
//! service no longer knows are forgotten. A retry may reach a device twice: the service worker shows one
//! notification per id (`tag`), so the second replaces the first.

use runflow_db::push;
use runflow_integrations::webpush::{Outcome, Subscription};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{JobError, Worker};

pub use runflow_db::notifications::PUSH_SEND;

/// How long a push service keeps an undelivered message (phone off, offline).
const TTL_S: u32 = 24 * 3600;

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max - 1).collect::<String>())
    }
}

pub(crate) async fn send(w: &Worker, payload: &Value) -> Result<(), JobError> {
    let id = payload["notification_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| JobError::permanent("bad payload"))?;
    let Some(n) = push::pending(&w.db, id).await? else {
        return Ok(());
    };
    if n.pushed_at.is_some() || n.read_at.is_some() {
        return Ok(());
    }
    let Some(web) = &w.webpush else {
        // Push isn't configured here (no VAPID keys): the center and e-mail still have it.
        return Ok(());
    };
    let message = json!({
        "id": id,
        "title": clip(&n.title, 120),
        "body": n.body.as_deref().map(|b| clip(b, 400)),
        "link": n.link,
    })
    .to_string();
    let mut retry = None;
    for d in push::devices(&w.db, n.user_id).await? {
        if d.platform != "web" {
            continue; // Expo push arrives with the phone app (X10)
        }
        let key = |k: &str| {
            d.keys
                .as_ref()
                .and_then(|v| v[k].as_str())
                .unwrap_or_default()
                .to_string()
        };
        let (p256dh, auth) = (key("p256dh"), key("auth"));
        let sub = Subscription {
            endpoint: &d.token,
            p256dh: &p256dh,
            auth: &auth,
        };
        match web.send(&sub, message.as_bytes(), TTL_S).await {
            Outcome::Sent => {}
            Outcome::Gone => push::remove(&w.db, d.id).await?,
            Outcome::Retry(e) => retry = Some(e),
            Outcome::Failed(e) => tracing::warn!(device = %d.id, error = %e, "push refused"),
        }
    }
    if let Some(e) = retry {
        return Err(JobError::retry(e));
    }
    push::mark_pushed(&w.db, id).await?;
    Ok(())
}
