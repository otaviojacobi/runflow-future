//! Notification e-mails (D-032): instant ones on every minute tick (in the club's colors when the notice belongs
//! to a club, D-036), and each person's daily summary once their hour has come (São Paulo time).

use chrono::{DateTime, Timelike, Utc};
use runflow_db::notifications::{self, Pending};
use runflow_domain::week;
use runflow_integrations::email::{
    Action, ClubFrame, Email, club_layout, escape_html, layout, paragraph,
};

use crate::Worker;

const FOOTER: &str = "Você recebe este aviso pelo Runflow. Escolha o que chega até você em Minha conta, Notificações.";
const DIGEST_MAX: usize = 30;

pub async fn run(w: &Worker, now: DateTime<Utc>) -> sqlx::Result<()> {
    for n in notifications::claim_instant(&w.db, 50).await? {
        let email = instant(w, &n).await?;
        if let Err(e) = w.mailer.send(&email).await {
            tracing::warn!(notification = %n.id, error = %e, "notification e-mail failed; retrying on the next tick");
            notifications::unsend(&w.db, n.id).await?;
        }
    }
    let local = now.with_timezone(&week::tz("America/Sao_Paulo"));
    let today = local.date_naive();
    for (user, address, hour, last) in notifications::digest_candidates(&w.db).await? {
        if i64::from(local.hour()) < i64::from(hour) || last == Some(today) {
            continue;
        }
        let mut tx = w.db.begin().await?;
        let items = notifications::take_digest(&mut tx, user, today).await?;
        if items.is_empty() {
            tx.commit().await?;
            continue;
        }
        match w.mailer.send(&digest(w, &address, &items)).await {
            Ok(_) => tx.commit().await?,
            Err(e) => {
                tracing::warn!(user_id = %user, error = %e, "summary e-mail failed; retrying on the next tick");
                tx.rollback().await?;
            }
        }
    }
    Ok(())
}

fn url(w: &Worker, link: Option<&str>) -> String {
    format!("{}{}", w.public_app_url, link.unwrap_or("/notifications"))
}

async fn instant(w: &Worker, n: &Pending) -> sqlx::Result<Email> {
    let link = url(w, n.link.as_deref());
    let body = n
        .body
        .as_deref()
        .map(|b| paragraph(&escape_html(b)))
        .unwrap_or_default();
    let action = Some(Action {
        label: "Abrir no Runflow",
        url: &link,
    });
    let frame = match n.club_id {
        Some(c) => w.club_frame(c).await?,
        None => None,
    };
    let html = match &frame {
        Some((name, theme, logo)) => club_layout(
            &ClubFrame {
                name,
                logo_url: logo.as_deref(),
                theme,
            },
            &n.title,
            &body,
            action,
            FOOTER,
        ),
        None => layout(&n.title, &body, action, FOOTER),
    };
    Ok(Email {
        to: vec![n.email.clone()],
        subject: n.title.clone(),
        html,
        text: format!(
            "{}\n\n{}{link}\n\n{FOOTER}",
            n.title,
            n.body
                .as_deref()
                .map(|b| format!("{b}\n\n"))
                .unwrap_or_default()
        ),
        idempotency_key: Some(format!("notification-{}", n.id)),
        tags: vec![("kind".into(), "notification".into())],
        link: Some(("Abrir no Runflow".into(), link)),
        ..Default::default()
    })
}

fn digest(w: &Worker, address: &str, items: &[Pending]) -> Email {
    let title = "Seu resumo do dia";
    let shown = &items[..items.len().min(DIGEST_MAX)];
    let mut html: String = shown
        .iter()
        .map(|n| {
            let body = n
                .body
                .as_deref()
                .map(|b| format!("<br>{}", escape_html(b)))
                .unwrap_or_default();
            paragraph(&format!("<strong>{}</strong>{body}", escape_html(&n.title)))
        })
        .collect();
    let mut text: Vec<String> = shown
        .iter()
        .map(|n| {
            format!(
                "• {}{}",
                n.title,
                n.body
                    .as_deref()
                    .map(|b| format!(": {b}"))
                    .unwrap_or_default()
            )
        })
        .collect();
    if items.len() > shown.len() {
        let more = format!("E mais {} no app.", items.len() - shown.len());
        html.push_str(&paragraph(&escape_html(&more)));
        text.push(more);
    }
    let link = url(w, None);
    Email {
        to: vec![address.to_string()],
        subject: if items.len() == 1 {
            "Seu resumo do Runflow: 1 aviso".into()
        } else {
            format!("Seu resumo do Runflow: {} avisos", items.len())
        },
        html: layout(
            title,
            &html,
            Some(Action {
                label: "Abrir o Runflow",
                url: &link,
            }),
            FOOTER,
        ),
        text: format!("{title}\n\n{}\n\n{link}\n\n{FOOTER}", text.join("\n")),
        tags: vec![("kind".into(), "digest".into())],
        link: Some(("Abrir o Runflow".into(), link)),
        ..Default::default()
    }
}
