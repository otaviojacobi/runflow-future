//! Notifications (D-045): every one lands in the app (the center and the unread count); per kind, the person only
//! switches push to their devices on or off, and can pause every push. Stored choices (`notification_prefs.kinds`,
//! `{"<kind>": {"push": bool}}`) override these defaults; the same table lives in api/endpoints.md § Notifications
//! and the mock.

use serde_json::{Map, Value, json};

pub const KINDS: [&str; 11] = [
    "workout_assigned",
    "workout_changed",
    "week_released",
    "comment",
    "feedback",
    "member_joined",
    "billing",
    "message",
    "announcement",
    "class_cancelled",
    "waitlist_promoted",
];

/// Push by default (founder, 2026-11-04): students get the week's release and changed workouts, and their own class
/// news (a cancelled class, a seat from the waitlist; D-052); staff get feedback, new members and billing.
/// Everything else (new workouts, comments, messages, announcements) starts off: it still lands in the app, and
/// Mensagens shows its unread count.
pub fn push_default(kind: &str) -> bool {
    matches!(
        kind,
        "week_released"
            | "workout_changed"
            | "feedback"
            | "member_joined"
            | "billing"
            | "class_cancelled"
            | "waitlist_promoted"
    )
}

/// A kind's push switch: the saved choice, or the default.
pub fn push_on(stored: &Value, kind: &str) -> bool {
    stored[kind]["push"]
        .as_bool()
        .unwrap_or_else(|| push_default(kind))
}

/// Every kind, resolved (the `/me/prefs` payload's `kinds`): `{"<kind>": {"push": bool}}`.
pub fn all(stored: &Value) -> Value {
    Value::Object(
        KINDS
            .iter()
            .map(|k| ((*k).to_string(), json!({ "push": push_on(stored, k) })))
            .collect::<Map<_, _>>(),
    )
}

/// Merge a PATCH's `kinds` (`{"<kind>": {"push": bool}}`) into the stored choices. `Err` = a pt-BR message for
/// field `kinds`.
pub fn merge(stored: &Value, patch: &Value) -> Result<Value, &'static str> {
    let Some(patch) = patch.as_object() else {
        return Err("Tipo de notificação desconhecido.");
    };
    let mut out = stored.as_object().cloned().unwrap_or_default();
    for (kind, v) in patch {
        let (true, Some(v)) = (KINDS.contains(&kind.as_str()), v.as_object()) else {
            return Err("Tipo de notificação desconhecido.");
        };
        match v.get("push") {
            None => {}
            Some(Value::Bool(on)) => {
                out.insert(kind.clone(), json!({ "push": on }));
            }
            Some(_) => return Err("Use ligado ou desligado."),
        }
    }
    Ok(Value::Object(out))
}

/// Whether a new notification also goes out as a push: its kind is switched on, push isn't paused, and the person
/// has a device to reach.
pub fn pushes(stored: &Value, kind: &str, paused: bool, has_device: bool) -> bool {
    push_on(stored, kind) && !paused && has_device
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_overrides() {
        let stored = json!({ "feedback": { "push": false }, "comment": { "push": true } });
        assert!(!push_on(&stored, "feedback"));
        assert!(push_on(&stored, "comment"));
        assert!(push_on(&stored, "week_released"));
        assert!(push_on(&json!({}), "member_joined"));
        assert!(push_on(&json!({}), "billing"));
        let all = all(&json!({}));
        assert_eq!(all.as_object().unwrap().len(), KINDS.len());
        let on: Vec<&str> = KINDS
            .iter()
            .copied()
            .filter(|k| all[*k]["push"] == json!(true))
            .collect();
        assert_eq!(
            on,
            [
                "workout_changed",
                "week_released",
                "feedback",
                "member_joined",
                "billing",
                "class_cancelled",
                "waitlist_promoted"
            ]
        );
    }

    #[test]
    fn merging_validates() {
        let merged = merge(
            &json!({ "feedback": { "push": true } }),
            &json!({ "comment": { "push": false }, "message": {} }),
        )
        .unwrap();
        assert_eq!(
            merged,
            json!({ "feedback": { "push": true }, "comment": { "push": false } })
        );
        assert!(merge(&json!({}), &json!({ "nope": { "push": true } })).is_err());
        assert!(merge(&json!({}), &json!({ "comment": { "push": "yes" } })).is_err());
        assert!(merge(&json!({}), &json!({ "comment": true })).is_err());
        assert!(merge(&json!({}), &json!(["comment"])).is_err());
    }

    #[test]
    fn push_follows_the_switches() {
        let off = json!({ "feedback": { "push": false } });
        assert!(pushes(&json!({}), "feedback", false, true));
        assert!(!pushes(&off, "feedback", false, true), "switched off");
        assert!(!pushes(&json!({}), "feedback", true, true), "paused");
        assert!(!pushes(&json!({}), "feedback", false, false), "no device");
        assert!(
            !pushes(&json!({}), "message", false, true),
            "off by default"
        );
        let on = json!({ "message": { "push": true } });
        assert!(pushes(&on, "message", false, true), "switched on");
    }
}
