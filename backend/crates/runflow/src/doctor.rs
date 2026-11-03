//! `runflow doctor`: one screen that says what's configured and what's missing, without printing secrets.

use std::time::Duration;

use runflow_integrations::email::Provider;

use crate::VERSION;
use crate::config::{Assistant, Config, RunEnv, Storage};

fn line(name: &str, status: &str, detail: impl AsRef<str>) {
    println!("  {name:<10} {status:<8} {}", detail.as_ref());
}

/// `postgres://user:***@host:port/db`
fn redact_url(url: &str) -> String {
    match (url.find("://"), url.rfind('@')) {
        (Some(scheme), Some(at)) if at > scheme => {
            let creds = &url[scheme + 3..at];
            let user = creds.split(':').next().unwrap_or("");
            format!("{}{}:***{}", &url[..scheme + 3], user, &url[at..])
        }
        _ => url.to_string(),
    }
}

pub async fn run(c: &Config) -> anyhow::Result<()> {
    let prod = c.env == RunEnv::Production;
    println!(
        "Runflow {} · {:?} · listening on {}",
        *VERSION, c.env, c.http.bind
    );
    println!(
        "  app {} · api {} · cors {} · cookie domain {}",
        c.http.public_app_url,
        c.http.public_api_url,
        c.http.cors_origins.join(", "),
        c.http
            .cookie_domain
            .as_deref()
            .unwrap_or("(this host only)")
    );
    let mut ok = true;

    match runflow_db::connect(&c.db, Duration::from_secs(5)).await {
        Ok(pool) => {
            let rtt = runflow_db::ping(&pool).await?;
            let applied: i64 =
                sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations WHERE success")
                    .fetch_one(&pool)
                    .await
                    .unwrap_or(0);
            let total = runflow_db::MIGRATOR.iter().count() as i64;
            let pending = if applied < total {
                format!(" · {} pending (run `runflow migrate`)", total - applied)
            } else {
                String::new()
            };
            line(
                "database",
                "ok",
                format!(
                    "{} · {:.1} ms · {applied}/{total} migrations{pending}",
                    redact_url(&c.db.url),
                    rtt.as_secs_f64() * 1000.0
                ),
            );
            pool.close().await;
        }
        Err(e) => {
            ok = false;
            line(
                "database",
                "ERROR",
                format!("{} · {e}", redact_url(&c.db.url)),
            );
        }
    }

    match c.email.provider {
        Provider::Resend => line(
            "e-mail",
            "resend",
            format!(
                "from {:?}{} · key {}",
                c.email.from,
                c.email
                    .reply_to
                    .as_ref()
                    .map(|r| format!(" · reply-to {r}"))
                    .unwrap_or_default(),
                c.email
                    .resend_api_key
                    .as_deref()
                    .map(|k| format!("{}…", &k[..k.len().min(5)]))
                    .unwrap_or_default()
            ),
        ),
        Provider::Log => line(
            "e-mail",
            "log",
            "e-mails are printed to the server log (paste RESEND_API_KEY in .env to send for real)",
        ),
    }
    match &c.google {
        Some(g) => line(
            "google",
            "ok",
            format!(
                "client {}…{}{}{}",
                &g.client_id[..g.client_id.len().min(12)],
                g.client_secret
                    .as_ref()
                    .map(|s| format!(" · secret {}", s.hint()))
                    .unwrap_or_default(),
                if g.android_client_id.is_some() {
                    " · android"
                } else {
                    ""
                },
                if g.ios_client_id.is_some() {
                    " · ios"
                } else {
                    ""
                }
            ),
        ),
        None => line(
            "google",
            "missing",
            "GOOGLE_CLIENT_ID (sign in with Google; e-mail codes work without it)",
        ),
    }
    match &c.strava {
        Some(s) => line(
            "strava",
            "ok",
            format!(
                "client {} · secret {}{}",
                s.client_id,
                s.client_secret.hint(),
                if s.webhook_verify_token.is_some() {
                    " · webhook token set"
                } else {
                    " · STRAVA_WEBHOOK_VERIFY_TOKEN missing"
                }
            ),
        ),
        None => line(
            "strava",
            "missing",
            "STRAVA_CLIENT_ID + STRAVA_CLIENT_SECRET (activity sync, S5)",
        ),
    }
    match &c.stripe {
        Some(s) => line(
            "stripe",
            "ok",
            format!(
                "key {}{} · webhook secret {} · Pro price {}",
                s.secret_key.hint(),
                if s.secret_key.expose().starts_with("sk_live") {
                    " · LIVE"
                } else {
                    " · test mode"
                },
                if s.webhook_secret.is_some() {
                    "set"
                } else {
                    "missing"
                },
                s.price_pro_monthly.as_deref().unwrap_or("missing")
            ),
        ),
        None if c.billing_simulation => line(
            "stripe",
            "off",
            "STRIPE_SECRET_KEY not set: billing uses the built-in simulation (BILLING_SIMULATION, no charging, D-016)",
        ),
        None => line(
            "stripe",
            "off",
            "STRIPE_SECRET_KEY not set and BILLING_SIMULATION off: owners can't upgrade (D-016: no charging in the beta)",
        ),
    }
    match &c.push {
        Some(p) => line(
            "push",
            "ok",
            format!(
                "Web Push (VAPID {}…, contact {})",
                &p.public_key[..p.public_key.len().min(12)],
                p.subject
            ),
        ),
        None => line(
            "push",
            "off",
            "VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY not set: no push to devices (generate with `runflow vapid-keys`)",
        ),
    }
    match &c.storage {
        Storage::Disk { dir } => {
            let writable = std::fs::create_dir_all(dir).is_ok() && tempfile_in(dir);
            if !writable {
                ok = false;
            }
            line(
                "storage",
                if writable { "disk" } else { "ERROR" },
                format!(
                    "{}{}",
                    dir.display(),
                    if writable {
                        " (writable)"
                    } else {
                        " is not writable"
                    }
                ),
            );
        }
        Storage::S3 {
            bucket,
            region,
            endpoint,
        } => {
            // Write, read back and delete a small object: proves the bucket and the keys work.
            let settings = runflow_integrations::storage::StorageSettings::S3 {
                bucket: bucket.clone(),
                region: region.clone(),
                endpoint: endpoint.clone(),
            };
            let checked = match runflow_integrations::storage::Storage::from_settings(&settings) {
                Ok(store) => store.check().await.map_err(|e| e.to_string()),
                Err(e) => Err(e.to_string()),
            };
            if checked.is_err() {
                ok = false;
            }
            let at = format!(
                "{bucket} · {region}{}",
                endpoint
                    .as_ref()
                    .map(|e| format!(" · {e}"))
                    .unwrap_or_default()
            );
            line(
                "storage",
                if checked.is_ok() { "s3" } else { "ERROR" },
                match checked {
                    Ok(()) => format!("{at} (writable)"),
                    Err(e) => format!("{at}: {e}"),
                },
            );
        }
    }
    match &c.assistant {
        Assistant::Rules => line(
            "assistant",
            "rules",
            "deterministic rules engine (AI provider: root.md §11.4)",
        ),
        Assistant::Anthropic { model, api_key } => line(
            "assistant",
            "anthropic",
            format!("model {model} · key {}", api_key.hint()),
        ),
    }
    let secret = |s: &Option<crate::config::Secret>| match s {
        Some(_) => "set".to_string(),
        None if prod => "MISSING".to_string(),
        None => "not set (required in production)".to_string(),
    };
    line(
        "secrets",
        "",
        format!(
            "SESSION_SECRET {} · ENCRYPTION_KEY {}",
            secret(&c.secrets.session_secret),
            secret(&c.secrets.encryption_key)
        ),
    );
    line(
        "sentry",
        if c.sentry_dsn.is_some() { "on" } else { "off" },
        "",
    );

    anyhow::ensure!(ok, "some checks failed");
    Ok(())
}

fn tempfile_in(dir: &std::path::Path) -> bool {
    let probe = dir.join(".runflow-write-test");
    let ok = std::fs::write(&probe, b"ok").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}
