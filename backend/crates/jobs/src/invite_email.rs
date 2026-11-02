//! `email.invite {invite_id, token}`: e-mail a personal invite (D-023), pt-BR, in the club's colors (D-036).

use chrono_tz::Tz;
use runflow_db::{clubs, invites};
use runflow_integrations::email::{Action, ClubFrame, Email, club_layout, escape_html, paragraph};
use serde_json::Value;
use uuid::Uuid;

use crate::{JobError, Worker};

pub const INVITE_EMAIL: &str = "email.invite";

pub(crate) async fn run(w: &Worker, payload: &Value) -> Result<(), JobError> {
    let id = payload["invite_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| JobError::permanent("bad payload"))?;
    let Some(invite) = invites::by_id_any(&w.db, id).await? else {
        return Ok(());
    };
    // Cancelled, used or expired since it was queued, or its link was replaced by a resend (that resend
    // queued its own e-mail): nothing to send.
    if invite.status(chrono::Utc::now()) != "pending"
        || payload["token"].as_str().is_some_and(|t| t != invite.token)
    {
        return Ok(());
    }
    let Some(club) = clubs::club(&w.db, invite.club_id).await? else {
        return Ok(());
    };
    let inviter = invites::inviter_name(&w.db, invite.created_by)
        .await?
        .unwrap_or_else(|| "Seu clube".into());

    let tz: Tz = club
        .timezone
        .parse()
        .unwrap_or(chrono_tz::America::Sao_Paulo);
    let until = invite
        .expires_at
        .with_timezone(&tz)
        .format("%d/%m/%Y")
        .to_string();
    let who = match (invite.role.as_str(), club.trainer_label.as_str()) {
        ("trainer", "professor") => "professor(a)",
        ("trainer", _) => "treinador(a)",
        _ => "aluno(a)",
    };
    let url = format!("{}/invite/{}", w.public_app_url, invite.token);
    let hello = match &invite.name {
        Some(n) => format!("Olá, {n}!"),
        None => "Olá!".to_string(),
    };
    let lines = [
        hello,
        format!(
            "{inviter} convidou você para entrar no {} como {who}.",
            club.name
        ),
        format!(
            "Aceite pelo link abaixo. Ele vale até {until} e só funciona com este e-mail ({}).",
            invite.email
        ),
    ];
    let theme = clubs::branding(&w.db, club.id)
        .await?
        .map(|b| b.theme)
        .unwrap_or(Value::Null);
    let logo = match (&w.public_api_url, clubs::email_logo(&w.db, club.id).await?) {
        (Some(api), Some(id)) => Some(format!("{api}/v1/assets/{id}")),
        _ => None,
    };
    let frame = ClubFrame {
        name: &club.name,
        logo_url: logo.as_deref(),
        theme: &theme,
    };
    let title = format!("Convite para o {}", club.name);
    let footer = "Se você não esperava este convite, pode ignorar este e-mail.";
    let email = Email {
        to: vec![invite.email.clone()],
        subject: format!("{inviter} convidou você para o {} no Runflow", club.name),
        html: club_layout(
            &frame,
            &title,
            &lines
                .iter()
                .map(|l| paragraph(&escape_html(l)))
                .collect::<String>(),
            Some(Action {
                label: "Aceitar convite",
                url: &url,
            }),
            footer,
        ),
        text: format!(
            "{}\n\nAceitar convite: {url}\n\n{footer}",
            lines.join("\n\n")
        ),
        // The token changes on resend, so a resend is a new e-mail; retries of the same send are not.
        idempotency_key: Some(format!("invite-{}-{}", invite.id, invite.token)),
        tags: vec![("kind".into(), "invite".into())],
        link: Some(("Aceitar convite".into(), url.clone())),
        ..Default::default()
    };
    w.mailer
        .send(&email)
        .await
        .map_err(|e| JobError::retry(e.to_string()))?;
    invites::mark_sent(&w.db, invite.id).await?;
    Ok(())
}
