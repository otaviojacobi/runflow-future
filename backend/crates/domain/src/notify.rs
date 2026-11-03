//! Notification control (D-032): per kind, the app center, the phone and e-mail. Stored choices (`notification_prefs.kinds`)
//! override these defaults per kind and field; the same table lives in api/endpoints.md § Notifications and the mock.

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

/// How a new notification is stored: `(in_app, email column)`, or `None` when nothing would reach the person
/// (push isn't delivered yet). `paused` holds e-mail (and push).
pub fn delivery(p: KindPref, paused: bool) -> Option<(bool, &'static str)> {
    let email = match (paused, p.email) {
        (true, _) | (_, Email::Off) => "none",
        (_, Email::Instant) => "instant",
        (_, Email::Digest) => "digest",
    };
    (p.app || email != "none").then_some((p.app, email))
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
        let p = default_for("feedback");
        assert_eq!(delivery(p, false), Some((true, "digest")));
        assert_eq!(
            delivery(p, true),
            Some((true, "none")),
            "paused: the center still fills"
        );
        let quiet = KindPref {
            app: false,
            push: true,
            email: Email::Off,
        };
        assert_eq!(
            delivery(quiet, false),
            None,
            "push only: nothing to deliver yet"
        );
        assert_eq!(
            delivery(
                KindPref {
                    app: false,
                    push: false,
                    email: Email::Instant
                },
                false
            ),
            Some((false, "instant"))
        );
    }
}
