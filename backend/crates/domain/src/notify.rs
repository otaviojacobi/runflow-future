//! Notification control (D-032): per kind, the app center, the phone and e-mail. Stored choices (`notification_prefs.kinds`)
//! override these defaults per kind and field; the same table lives in api/endpoints.md § Notifications and the mock.

use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

pub const KINDS: [&str; 9] = [
    "workout_assigned",
    "workout_changed",
    "week_released",
    "comment",
    "feedback",
    "member_joined",
    "billing",
    "message",
    "announcement",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Email {
    Off,
    Instant,
    Digest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KindPref {
    pub app: bool,
    pub push: bool,
    pub email: Email,
}

pub fn default_for(kind: &str) -> KindPref {
    let (app, push, email) = match kind {
        "week_released" => (true, true, Email::Instant),
        "feedback" | "member_joined" => (true, false, Email::Digest),
        "billing" => (true, false, Email::Instant),
        _ => (true, true, Email::Off),
    };
    KindPref { app, push, email }
}

/// A kind's choice: the default, with whatever the person saved on top (field by field).
pub fn resolve(stored: &Value, kind: &str) -> KindPref {
    let mut p = default_for(kind);
    let s = &stored[kind];
    if let Some(v) = s["app"].as_bool() {
        p.app = v;
    }
    if let Some(v) = s["push"].as_bool() {
        p.push = v;
    }
    if let Ok(e) = serde_json::from_value::<Email>(s["email"].clone()) {
        p.email = e;
    }
    p
}

/// Every kind, resolved (the `/me/prefs` payload's `kinds`).
pub fn all(stored: &Value) -> Value {
    Value::Object(
        KINDS
            .iter()
            .map(|k| ((*k).to_string(), json!(resolve(stored, k))))
            .collect::<Map<_, _>>(),
    )
}

/// Merge a PATCH's `kinds` into the stored choices. `Err` = a pt-BR message for field `kinds`.
pub fn merge(stored: &Value, patch: &Value) -> Result<Value, &'static str> {
    let Some(patch) = patch.as_object() else {
        return Err("Tipo de notificação desconhecido.");
    };
    let mut out = stored.as_object().cloned().unwrap_or_default();
    for (kind, v) in patch {
        let (true, Some(v)) = (KINDS.contains(&kind.as_str()), v.as_object()) else {
            return Err("Tipo de notificação desconhecido.");
        };
        let entry = out
            .entry(kind.clone())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("Tipo de notificação desconhecido.")?;
        for (field, value) in v {
            match field.as_str() {
                "app" | "push" if value.is_boolean() => {
                    entry.insert(field.clone(), value.clone());
                }
                "app" | "push" => return Err("Use ligado ou desligado."),
                "email" if serde_json::from_value::<Email>(value.clone()).is_ok() => {
                    entry.insert(field.clone(), value.clone());
                }
                "email" => return Err("Escolha como receber por e-mail."),
                _ => {}
            }
        }
    }
    Ok(Value::Object(out))
}

/// How a new notification is delivered, per the recipient's choices at creation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Delivery {
    /// Shown in the notification center (and the unread count).
    pub in_app: bool,
    /// The e-mail it owes: `none`, `instant` or `digest`.
    pub email: &'static str,
    /// A push to the person's devices.
    pub push: bool,
}

/// `None` when nothing would reach the person. `paused` holds e-mail and push; push needs a registered device.
pub fn delivery(p: KindPref, paused: bool, has_device: bool) -> Option<Delivery> {
    let email = match (paused, p.email) {
        (true, _) | (_, Email::Off) => "none",
        (_, Email::Instant) => "instant",
        (_, Email::Digest) => "digest",
    };
    let push = p.push && !paused && has_device;
    (p.app || email != "none" || push).then_some(Delivery {
        in_app: p.app,
        email,
        push,
    })
}

/// When a push goes out: now, or when the quiet hours (`start`–`end`, local time in `tz`, possibly across
/// midnight; equal times = none) end.
pub fn push_at(
    now: DateTime<Utc>,
    quiet: Option<(NaiveTime, NaiveTime)>,
    tz: chrono_tz::Tz,
) -> DateTime<Utc> {
    let Some((start, end)) = quiet.filter(|(s, e)| s != e) else {
        return now;
    };
    let local = now.with_timezone(&tz);
    let t = local.time();
    let inside = if start < end {
        t >= start && t < end
    } else {
        t >= start || t < end
    };
    if !inside {
        return now;
    }
    let day = if t >= end {
        local.date_naive() + chrono::Duration::days(1)
    } else {
        local.date_naive()
    };
    day.and_time(end)
        .and_local_timezone(tz)
        .earliest()
        .map_or(now, |d| d.with_timezone(&Utc))
}

/// The groups a staff member's feedback/comment notices are limited to only matter for these kinds.
pub fn filtered_by_group(kind: &str) -> bool {
    kind == "feedback" || kind == "comment"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_overrides() {
        let stored = json!({ "feedback": { "email": "off" }, "comment": { "push": false } });
        assert_eq!(
            resolve(&stored, "feedback"),
            KindPref {
                app: true,
                push: false,
                email: Email::Off
            }
        );
        assert!(!resolve(&stored, "comment").push);
        assert_eq!(resolve(&stored, "week_released").email, Email::Instant);
        assert_eq!(all(&json!({})).as_object().unwrap().len(), KINDS.len());
    }

    #[test]
    fn merging_validates() {
        let merged = merge(
            &json!({ "feedback": { "app": false } }),
            &json!({ "feedback": { "email": "instant" } }),
        )
        .unwrap();
        assert_eq!(
            merged,
            json!({ "feedback": { "app": false, "email": "instant" } })
        );
        assert!(merge(&json!({}), &json!({ "nope": { "app": true } })).is_err());
        assert!(merge(&json!({}), &json!({ "comment": { "email": "weekly" } })).is_err());
        assert!(merge(&json!({}), &json!({ "comment": { "app": "yes" } })).is_err());
    }

    #[test]
    fn delivery_follows_the_choices() {
        let d = |in_app, email, push| {
            Some(Delivery {
                in_app,
                email,
                push,
            })
        };
        let p = default_for("feedback");
        assert_eq!(delivery(p, false, true), d(true, "digest", false));
        assert_eq!(
            delivery(p, true, true),
            d(true, "none", false),
            "paused: the center still fills"
        );
        let push_only = KindPref {
            app: false,
            push: true,
            email: Email::Off,
        };
        assert_eq!(delivery(push_only, false, true), d(false, "none", true));
        assert_eq!(
            delivery(push_only, false, false),
            None,
            "no device: nothing would reach them"
        );
        assert_eq!(delivery(push_only, true, true), None, "paused holds push");
        let mail = KindPref {
            app: false,
            push: false,
            email: Email::Instant,
        };
        assert_eq!(delivery(mail, false, false), d(false, "instant", false));
    }

    #[test]
    fn quiet_hours_hold_push_until_they_end() {
        let sp = chrono_tz::America::Sao_Paulo;
        let at = |s: &str| DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc);
        let hm = |s: &str| NaiveTime::parse_from_str(s, "%H:%M").unwrap();
        let night = Some((hm("22:00"), hm("07:00")));
        // 23:30 in São Paulo (02:30 UTC): held until 07:00 local (10:00 UTC) the next morning.
        assert_eq!(
            push_at(at("2026-11-04T02:30:00Z"), night, sp),
            at("2026-11-04T10:00:00Z")
        );
        // 05:00 local: same morning.
        assert_eq!(
            push_at(at("2026-11-04T08:00:00Z"), night, sp),
            at("2026-11-04T10:00:00Z")
        );
        // 12:00 local: right away; no quiet hours or equal times: right away.
        assert_eq!(
            push_at(at("2026-11-04T15:00:00Z"), night, sp),
            at("2026-11-04T15:00:00Z")
        );
        assert_eq!(
            push_at(at("2026-11-04T02:30:00Z"), None, sp),
            at("2026-11-04T02:30:00Z")
        );
        assert_eq!(
            push_at(
                at("2026-11-04T02:30:00Z"),
                Some((hm("07:00"), hm("07:00"))),
                sp
            ),
            at("2026-11-04T02:30:00Z")
        );
        // A daytime window (13:00–14:00): 13:30 local waits until 14:00.
        assert_eq!(
            push_at(
                at("2026-11-04T16:30:00Z"),
                Some((hm("13:00"), hm("14:00"))),
                sp
            ),
            at("2026-11-04T17:00:00Z")
        );
    }
}
