//! Push (S7b, X10, D-045): `push.send {notification_id}` is queued when a notification is created with push on, and
//! sends it to each of the person's devices: Web Push for the installed web app, Expo push for the phone app.
//! Skipped when it was read in the app meanwhile; devices the push service no longer knows are forgotten. A retry may reach a device twice: the service worker shows one
//! notification per id (`tag`), so the second replaces the first.

use runflow_db::push;
use runflow_integrations::expo_push::{self, Message, Ticket};
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
    let message = json!({
        "id": id,
        "title": clip(&n.title, 120),
        "body": n.body.as_deref().map(|b| clip(b, 400)),
        "link": n.link,
        "club_id": n.club_id,
    })
    .to_string();
    let mut retry = None;
    let devices = push::devices(&w.db, n.user_id).await?;
    // The phone app: one Expo request for all of the person's phones.
    let phones: Vec<&push::Device> = devices.iter().filter(|d| d.platform != "web").collect();
    if let (Some(expo), false) = (&w.expo, phones.is_empty()) {
        // The app switches to the notice's club before opening its link (club-scoped paths).
        let data = json!({ "id": id, "link": n.link, "club_id": n.club_id });
        let title = clip(&n.title, 120);
        let body = n.body.as_deref().map(|b| clip(b, 400));
        for chunk in phones.chunks(expo_push::BATCH) {
            let messages: Vec<Message> = chunk
                .iter()
                .map(|d| Message {
                    to: &d.token,
                    title: &title,
                    body: body.as_deref(),
                    data: data.clone(),
                    ttl_s: TTL_S,
                })
                .collect();
            match expo.send(&messages).await {
                Ok(tickets) => {
                    for (d, t) in chunk.iter().zip(tickets) {
                        match t {
                            Ticket::Ok => {}
                            Ticket::Gone => push::remove(&w.db, d.id).await?,
                            Ticket::Failed(e) => {
                                tracing::warn!(device = %d.id, error = %e, "expo push refused")
                            }
                        }
                    }
                }
                Err(expo_push::ExpoError::Retry(e)) => retry = Some(e),
                Err(e) => tracing::warn!(error = %e, "expo push refused the batch"),
            }
        }
    }
    // The installed web app (VAPID keys set).
    let web_devices = devices.iter().filter(|d| d.platform == "web");
    for d in web_devices {
        let Some(web) = &w.webpush else { break };
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
