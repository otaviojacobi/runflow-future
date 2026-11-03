//! `/auth/*` (A2 Login): e-mail one-time code, Google ID token, logout. No passwords (D-007).

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use chrono::{Duration, Utc};
use runflow_db::auth as db;
use runflow_db::models::User;
use runflow_integrations::email::{
    Email, code_block, escape_html, is_smoke_address, layout, paragraph,
};
use runflow_integrations::google::GoogleError;
use serde::Serialize;
use serde_json::json;

use crate::body::{Body, is_email};
use crate::session::{
    MaybeAuth, clear_cookie, client_kind, code_matches, hash_code, hash_token, new_code, new_token,
    session_cookie,
};
use crate::{AppState, Problem};

const CODE_TTL_MIN: i64 = 10;
const CODE_COOLDOWN_S: i64 = 30;
const CODES_PER_HOUR: i64 = 5;
const MAX_ATTEMPTS: i32 = 5;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/email/start", post(email_start))
        .route("/auth/email/verify", post(email_verify))
        .route("/auth/google", post(google))
        .route("/auth/logout", post(logout))
}

#[derive(Serialize)]
struct Signed {
    token: String,
    user: User,
    is_new: bool,
}

fn read_email(body: &Body) -> Result<String, Problem> {
    body.str("email")
        .map(|e| e.to_lowercase())
        .filter(|e| is_email(e))
        .ok_or_else(|| Problem::field("email", "Digite um e-mail válido, como nome@email.com."))
}

/// A smoke-test sign-in (D-034): the `SMOKE_KEY` header for a `@smoke.runflow.club` address.
fn smoke(state: &AppState, headers: &HeaderMap, email: &str) -> bool {
    let (Some(key), Some(given)) = (
        state.settings.auth.smoke_key.as_deref(),
        headers.get("x-smoke-key").and_then(|v| v.to_str().ok()),
    ) else {
        return false;
    };
    is_smoke_address(email)
        && aws_lc_rs::constant_time::verify_slices_are_equal(key.as_bytes(), given.as_bytes())
            .is_ok()
}

async fn email_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Result<Json<serde_json::Value>, Problem> {
    let email = read_email(&body)?;
    let now = Utc::now();
    let (recent, last) = db::recent_codes(&state.db, &email, now - Duration::hours(1)).await?;
    if let Some(wait) = last
        .map(|l| CODE_COOLDOWN_S - (now - l).num_seconds())
        .filter(|w| *w > 0)
    {
        return Err(Problem::new(
            StatusCode::TOO_MANY_REQUESTS,
            "auth.code_cooldown",
            "Espere um pouco",
            format!("Você pode pedir um novo código em {wait} segundos."),
        )
        .with_retry_after(wait as u64));
    }
    if recent >= CODES_PER_HOUR {
        return Err(Problem::new(
            StatusCode::TOO_MANY_REQUESTS,
            "auth.too_many_codes",
            "Muitos pedidos de código",
            "Espere alguns minutos antes de pedir outro código.",
        )
        .with_retry_after(600));
    }

    let code = new_code();
    let mut tx = state.db.begin().await?;
    db::create_code(
        &mut tx,
        &email,
        &hash_code(&state.settings.auth, &email, &code),
        Duration::minutes(CODE_TTL_MIN),
    )
    .await?;
    tx.commit().await?;

    if let Err(err) = state.mailer.send(&code_email(&email, &code)).await {
        tracing::error!(error = %err, "sign-in code e-mail failed");
        return Err(Problem::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "email.unavailable",
            "Não conseguimos enviar o e-mail",
            "Tente novamente em instantes ou entre com o Google.",
        ));
    }
    let mut out = json!({ "sent": true, "expires_in_s": CODE_TTL_MIN * 60 });
    if state.settings.auth.dev_affordances || smoke(&state, &headers, &email) {
        // Development without real e-mail (like the mock), or a smoke test (its address gets no e-mail).
        out["dev_code"] = json!(code);
    }
    Ok(Json(out))
}

fn code_email(email: &str, code: &str) -> Email {
    let title = "Seu código de acesso";
    let intro = "Use este código para entrar no Runflow:";
    let outro = format!(
        "Ele vale por {CODE_TTL_MIN} minutos. Se não foi você, ignore este e-mail: sua conta continua segura."
    );
    let footer =
        "Você recebeu este e-mail porque alguém pediu para entrar no Runflow com este endereço.";
    Email {
        to: vec![email.to_string()],
        subject: format!("Seu código do Runflow: {code}"),
        html: layout(
            title,
            &format!(
                "{}{}{}",
                paragraph(intro),
                code_block(code),
                paragraph(&escape_html(&outro))
            ),
            None,
            footer,
        ),
        text: format!("{title}\n\n{intro}\n\n{code}\n\n{outro}\n\n{footer}"),
        tags: vec![("kind".into(), "sign_in_code".into())],
        ..Default::default()
    }
}

async fn email_verify(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, Problem> {
    let email = read_email(&body)?;
    let code: String = body
        .str("code")
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_digit)
        .collect();

    let mut tx = state.db.begin().await?;
    let Some(pending) = db::attempt_code(&mut tx, &email).await? else {
        return Err(Problem::new(
            StatusCode::BAD_REQUEST,
            "auth.code_expired",
            "Código expirado",
            "Peça um novo código para continuar.",
        ));
    };
    if pending.attempts > MAX_ATTEMPTS {
        tx.commit().await?;
        return Err(Problem::new(
            StatusCode::TOO_MANY_REQUESTS,
            "auth.too_many_attempts",
            "Muitas tentativas",
            "Peça um novo código e tente de novo.",
        ));
    }
    if code.len() != 6 || !code_matches(&state.settings.auth, &email, &code, &pending.code_hash) {
        tx.commit().await?; // the attempt counts
        return Err(Problem::new(
            StatusCode::BAD_REQUEST,
            "auth.invalid_code",
            "Código incorreto",
            format!("Confira o código de 6 dígitos que enviamos para {email}."),
        ));
    }
    db::consume_code(&mut *tx, pending.id).await?;
    let signed = sign_in(&state, &mut tx, &headers, "email", &email, &email, None).await?;
    tx.commit().await?;
    Ok(respond(&state, &headers, signed))
}

async fn google(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, Problem> {
    let failed = || {
        Problem::new(
            StatusCode::BAD_REQUEST,
            "auth.google_failed",
            "Não foi possível entrar com o Google",
            "Tente de novo ou use o código por e-mail.",
        )
    };
    let Some(verifier) = state.google.clone() else {
        return Err(Problem::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "auth.google_unavailable",
            "Entrar com o Google não está disponível",
            "Use o código por e-mail por enquanto.",
        ));
    };
    let id_token = body.str("id_token").ok_or_else(failed)?;
    let identity = match verifier.verify(&id_token).await {
        Ok(id) => id,
        Err(GoogleError::Invalid(why)) => {
            tracing::info!(%why, "google sign-in rejected");
            return Err(failed());
        }
        Err(GoogleError::Unavailable(why)) => {
            tracing::error!(%why, "google keys unavailable");
            return Err(Problem::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "auth.google_unavailable",
                "Entrar com o Google não está disponível",
                "Tente de novo em instantes ou use o código por e-mail.",
            ));
        }
    };
    let mut tx = state.db.begin().await?;
    let signed = sign_in(
        &state,
        &mut tx,
        &headers,
        "google",
        &identity.subject,
        &identity.email,
        identity.name.as_deref(),
    )
    .await?;
    tx.commit().await?;
    Ok(respond(&state, &headers, signed))
}

/// Find (by identity, then by e-mail) or create the account, link the identity, open a session.
async fn sign_in(
    state: &AppState,
    tx: &mut sqlx::PgConnection,
    headers: &HeaderMap,
    provider: &str,
    subject: &str,
    email: &str,
    name: Option<&str>,
) -> Result<Signed, Problem> {
    let (user, is_new) = match db::user_by_identity(&mut *tx, provider, subject).await? {
        Some(u) => (u, false),
        None => {
            db::find_or_create_user(
                &mut *tx,
                email,
                &name
                    .map(str::to_string)
                    .unwrap_or_else(|| name_from_email(email)),
            )
            .await?
        }
    };
    db::link_identity(&mut *tx, user.id, provider, subject, email).await?;
    let token = new_token();
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|ua| ua.chars().take(300).collect::<String>());
    db::create_session(
        &mut *tx,
        user.id,
        &hash_token(&token),
        client_kind(headers),
        user_agent.as_deref(),
        state.settings.auth.session_ttl,
    )
    .await?;
    tracing::info!(user_id = %user.id, provider, is_new, "signed in");
    Ok(Signed {
        token,
        user,
        is_new,
    })
}

/// The JSON body for every client; the HttpOnly cookie for the web.
fn respond(state: &AppState, headers: &HeaderMap, signed: Signed) -> Response {
    let mut res = Json(&signed).into_response();
    if client_kind(headers) == "web" {
        res.headers_mut().insert(
            header::SET_COOKIE,
            session_cookie(&state.settings.auth, &signed.token),
        );
    }
    res
}

/// "ana.souza@x.com" → "Ana Souza" (people fix it in their profile).
fn name_from_email(email: &str) -> String {
    let local = email.split('@').next().unwrap_or(email);
    let words: Vec<String> = local
        .split(|c: char| c == '.' || c == '_' || c == '-' || c == '+' || c.is_ascii_digit())
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().chain(c).collect())
                .unwrap_or_default()
        })
        .collect();
    if words.is_empty() {
        local.to_string()
    } else {
        words.join(" ")
    }
}

async fn logout(
    State(state): State<AppState>,
    MaybeAuth(auth): MaybeAuth,
) -> Result<Response, Problem> {
    if let Some(a) = auth {
        db::revoke_session(&state.db, a.user_id, a.session_id).await?;
    }
    Ok((
        [(header::SET_COOKIE, clear_cookie(&state.settings.auth))],
        StatusCode::NO_CONTENT,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::name_from_email;

    #[test]
    fn names_from_emails() {
        assert_eq!(name_from_email("ana.souza@email.com"), "Ana Souza");
        assert_eq!(name_from_email("joao_p-lima2@x.com"), "Joao P Lima");
        assert_eq!(name_from_email("123@x.com"), "123");
    }
}
