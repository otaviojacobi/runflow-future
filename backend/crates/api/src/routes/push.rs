//! Push devices (S7b; endpoints.md § Auth and account → `/me/push-tokens`), like the mock: the installed web app
//! registers its Web Push subscription, the phone app its Expo push token (`ExponentPushToken[…]`).

use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use serde_json::{Value, json};

use crate::body::Body;
use crate::session::Auth;
use crate::{AppState, FieldError, Problem};

pub fn routes() -> Router<AppState> {
    Router::new().route("/me/push-tokens", post(register).delete(forget))
}

/// Push services browsers subscribe with (Chrome, Edge, Samsung via FCM; Firefox; Safari; Windows). The server
/// only ever posts to these, so a subscription can't point it at anything else.
const PUSH_HOSTS: [&str; 4] = [
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
];

/// A Web Push endpoint we'll post to: https on a known push service (dev also allows a local fake).
fn web_endpoint(token: &str, dev: bool) -> bool {
    let Some((scheme, rest)) = token.split_once("://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.contains('@') || token.chars().any(char::is_whitespace) {
        return false;
    }
    let host = match authority.rsplit_once(':') {
        Some((h, port)) if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) => h,
        _ => authority,
    }
    .to_ascii_lowercase();
    let known = PUSH_HOSTS
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")));
    (scheme == "https" && known)
        || (dev && scheme == "http" && (host == "127.0.0.1" || host == "localhost"))
}

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

async fn register(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<StatusCode, Problem> {
    let platform = body.str("platform").unwrap_or_default();
    let token = body.str("token").unwrap_or_default().trim().to_string();
    let mut errors = Vec::new();
    if !matches!(platform.as_str(), "web" | "ios" | "android") {
        errors.push(fail("platform", "Plataforma inválida."));
    }
    let dev = state.settings.auth.dev_affordances;
    let valid = match platform.as_str() {
        "web" => web_endpoint(&token, dev),
        _ => runflow_integrations::expo_push::is_expo_token(&token),
    };
    if token.is_empty() || token.len() > 2048 || !valid {
        errors.push(fail("token", "Informe o token do aparelho."));
    }
    let key = |k: &str| {
        body.get("keys")
            .and_then(|v| v[k].as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.len() <= 256)
            .map(str::to_string)
    };
    let keys: Option<Value> = match (key("p256dh"), key("auth")) {
        (Some(p256dh), Some(auth)) => Some(json!({ "p256dh": p256dh, "auth": auth })),
        _ => None,
    };
    if platform == "web" && keys.is_none() {
        errors.push(fail("keys", "Chaves da inscrição inválidas."));
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let keys = if platform == "web" { keys } else { None };
    runflow_db::push::register(&state.db, auth.user_id, &platform, &token, keys.as_ref()).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn forget(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<StatusCode, Problem> {
    let token = body.str("token").unwrap_or_default();
    runflow_db::push::forget(&state.db, auth.user_id, token.trim()).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::web_endpoint;

    #[test]
    fn only_known_push_services() {
        assert!(web_endpoint(
            "https://fcm.googleapis.com/fcm/send/abc",
            false
        ));
        assert!(web_endpoint(
            "https://updates.push.services.mozilla.com/wpush/v2/x",
            false
        ));
        assert!(web_endpoint("https://web.push.apple.com/QK1", false));
        assert!(web_endpoint(
            "https://wns2-bl2p.notify.windows.com/w/?token=x",
            false
        ));
        assert!(!web_endpoint(
            "https://evil.example/fcm.googleapis.com",
            false
        ));
        assert!(!web_endpoint(
            "https://fcm.googleapis.com.evil.example/x",
            false
        ));
        assert!(!web_endpoint("http://fcm.googleapis.com/x", false));
        assert!(!web_endpoint("http://127.0.0.1:9000/push", false));
        assert!(web_endpoint("http://127.0.0.1:9000/push", true));
        assert!(!web_endpoint("not a url", true));
        assert!(!web_endpoint("https://user@fcm.googleapis.com/x", false));
        assert!(web_endpoint("https://FCM.googleapis.com:443/x", false));
    }
}
