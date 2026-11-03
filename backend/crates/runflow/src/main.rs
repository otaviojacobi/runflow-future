//! The Runflow server binary (root.md §7.2). Docker runs `runflow all`.

mod config;
mod doctor;
mod errors;
mod telemetry;

use std::process::ExitCode;
use std::sync::LazyLock;
use std::time::Duration;

use anyhow::Context;
use clap::{Parser, Subcommand};
use runflow_api::{ApiSettings, AppState, AuthSettings, BillingSettings};
use runflow_integrations::email::{
    Action, ClubFrame, Email, Mailer, Provider, club_layout, escape_html, layout, paragraph,
};
use runflow_integrations::google::{GOOGLE_JWKS_URL, GoogleVerifier};
use runflow_integrations::secrets::TokenCipher;
use runflow_integrations::storage::{Storage, StorageSettings};
use runflow_integrations::strava::{STRAVA_BASE, StravaClient};
use runflow_integrations::stripe::{STRIPE_BASE, StripeClient};
use tracing_subscriber::EnvFilter;

use crate::config::{Config, LogFormat, RunEnv};

/// `0.1.0` or `0.1.0+<git sha>` when the image is built with `RUNFLOW_GIT_SHA`.
pub static VERSION: LazyLock<&'static str> =
    LazyLock::new(|| match option_env!("RUNFLOW_GIT_SHA") {
        Some(sha) if !sha.is_empty() => Box::leak(
            format!("{}+{}", env!("CARGO_PKG_VERSION"), &sha[..sha.len().min(7)]).into_boxed_str(),
        ),
        _ => env!("CARGO_PKG_VERSION"),
    });

#[derive(Parser)]
#[command(name = "runflow", version, about = "Runflow API server")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Apply migrations, then serve the API and run the background worker (what Docker and the Pi run).
    All,
    /// Serve the HTTP API only (expects an up-to-date database).
    Serve,
    /// Run the background worker only (e-mails and other queued jobs).
    Worker,
    /// Apply pending database migrations and exit.
    Migrate,
    /// Show what is configured (secrets hidden) and check the database, Valkey and storage.
    Doctor,
    /// Send a test e-mail through the configured provider (checks the Resend setup).
    EmailTest {
        /// Recipient. With `onboarding@resend.dev` as sender, Resend only delivers to your own account e-mail.
        #[arg(long)]
        to: String,
        /// Write the HTML to this file instead of sending (to review the layout).
        #[arg(long)]
        preview: Option<std::path::PathBuf>,
        /// Use this club's e-mail frame (its slug): colors, logo and name, as invites look (D-036).
        #[arg(long)]
        club: Option<String>,
    },
    /// Exit 0 when the local server answers /v1/health (Docker healthcheck; no curl in the image).
    Healthcheck,
    /// Print a new VAPID key pair for Web Push (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
    VapidKeys,
    /// Create or update what Runflow needs in Stripe (STRIPE_SECRET_KEY): the plans' prices (api/plans.json), the
    /// Billing Portal configuration and the webhook endpoint. Safe to repeat.
    StripeSetup {
        /// Webhook URL; default `<PUBLIC_API_URL>/v1/webhooks/stripe`.
        #[arg(long)]
        webhook_url: Option<String>,
        /// When the endpoint is new, write its signing secret here as STRIPE_WEBHOOK_SECRET (an env file) instead of
        /// printing it.
        #[arg(long)]
        env_file: Option<std::path::PathBuf>,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    // `.env` at the repo root when running with cargo; Docker passes the variables directly.
    let _ = dotenvy::dotenv();
    let cli = Cli::parse();
    // Needs no configuration: run it before reading the environment.
    if let Command::VapidKeys = cli.command {
        return match runflow_integrations::webpush::Vapid::generate() {
            Ok((public, private)) => {
                println!("VAPID_PUBLIC_KEY={public}\nVAPID_PRIVATE_KEY={private}");
                ExitCode::SUCCESS
            }
            Err(_) => ExitCode::FAILURE,
        };
    }

    let config = match Config::from_env() {
        Ok(c) => c,
        Err(errors) => {
            eprintln!("Configuration problems (see .env.example):");
            for e in errors {
                eprintln!("  - {e}");
            }
            return ExitCode::from(2);
        }
    };
    let _sentry = errors::init(&config, *VERSION);
    // Telemetry for the long-running processes only (not doctor, migrate…).
    let process = match cli.command {
        Command::All => Some("all"),
        Command::Serve => Some("serve"),
        Command::Worker => Some("worker"),
        _ => None,
    };
    let telemetry = match (process, &config.otel) {
        (Some(p), Some(o)) => {
            match telemetry::Telemetry::init(o, *VERSION, &config.deployment_env, p) {
                Ok(t) => Some(t),
                Err(e) => {
                    eprintln!("telemetry off: {e:#}");
                    None
                }
            }
        }
        _ => None,
    };
    init_logging(config.log_format, _sentry.is_some(), telemetry.as_ref());

    let result = match cli.command {
        Command::All => run(config, true, true).await,
        Command::Serve => run(config, false, false).await,
        Command::Worker => worker(config).await,
        Command::Migrate => migrate(&config).await,
        Command::Doctor => doctor::run(&config).await,
        Command::EmailTest { to, preview, club } => email_test(&config, to, preview, club).await,
        Command::Healthcheck => healthcheck(&config).await,
        Command::VapidKeys => Ok(()),
        Command::StripeSetup {
            webhook_url,
            env_file,
        } => stripe_setup(&config, webhook_url, env_file).await,
    };
    if let Some(t) = telemetry {
        let _ = tokio::task::spawn_blocking(move || t.shutdown()).await;
    }
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            tracing::error!("{err:#}");
            ExitCode::FAILURE
        }
    }
}

/// Expo push for the phone app: always on (free, no server credentials unless enhanced security is enabled).
fn expo(config: &Config) -> std::sync::Arc<runflow_integrations::expo_push::ExpoPush> {
    std::sync::Arc::new(runflow_integrations::expo_push::ExpoPush::new(
        runflow_integrations::expo_push::EXPO_PUSH_BASE,
        config
            .expo_access_token
            .as_ref()
            .map(|t| t.expose().to_string()),
    ))
}

/// The Web Push sender when VAPID keys are set.
fn webpush(
    config: &Config,
) -> anyhow::Result<Option<std::sync::Arc<runflow_integrations::webpush::WebPush>>> {
    let Some(p) = &config.push else {
        return Ok(None);
    };
    let vapid = runflow_integrations::webpush::Vapid::new(
        &p.public_key,
        p.private_key.expose(),
        &p.subject,
    )
    .map_err(|e| anyhow::anyhow!(e))?;
    Ok(Some(std::sync::Arc::new(
        runflow_integrations::webpush::WebPush::new(vapid),
    )))
}

fn init_logging(format: LogFormat, sentry: bool, telemetry: Option<&telemetry::Telemetry>) {
    use tracing_subscriber::prelude::*;
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,runflow=debug"));
    let fmt = match format {
        LogFormat::Json => tracing_subscriber::fmt::layer()
            .json()
            .flatten_event(true)
            .boxed(),
        LogFormat::Pretty => tracing_subscriber::fmt::layer().compact().boxed(),
    };
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt)
        .with(sentry.then(errors::layer))
        .with(telemetry.map(|t| t.layer()))
        .init();
}

async fn connect(config: &Config) -> anyhow::Result<runflow_db::Pool> {
    runflow_db::connect(&config.db, Duration::from_secs(30))
        .await
        .context("connecting to the database (DATABASE_URL)")
}

/// Valkey (D-047), waiting for it like for the database.
async fn connect_kv(config: &Config) -> anyhow::Result<runflow_kv::Kv> {
    runflow_kv::Kv::connect(
        config.redis_url.expose(),
        runflow_kv::PREFIX,
        Duration::from_secs(30),
    )
    .await
    .context("connecting to Valkey (REDIS_URL)")
}

async fn migrate(config: &Config) -> anyhow::Result<()> {
    let pool = connect(config).await?;
    runflow_db::migrate(&pool)
        .await
        .context("applying migrations")?;
    tracing::info!(
        total = runflow_db::MIGRATOR.iter().count(),
        "migrations up to date"
    );
    Ok(())
}

async fn worker(config: Config) -> anyhow::Result<()> {
    let pool = connect(&config).await?;
    telemetry::observe_pool(pool.clone());
    let mailer = Mailer::from_settings(&config.email).context("e-mail settings")?;
    let mut w = runflow_jobs::Worker::new(pool.clone(), mailer, config.http.public_app_url.clone())
        .with_api_url(config.http.public_api_url.clone());
    if let Some(st) = &config.strava {
        w = w.with_strava(
            StravaClient::new(
                STRAVA_BASE,
                st.client_id.clone(),
                st.client_secret.expose().to_string(),
            ),
            token_cipher(&config)?,
        );
    }
    if let Some(web) = webpush(&config)? {
        w = w.with_webpush(web);
    }
    w = w.with_expo(expo(&config));
    if let Some(stripe) = stripe_client(&config) {
        w = w.with_stripe(stripe);
    }
    w.run(shutdown()).await;
    pool.close().await;
    Ok(())
}

async fn run(config: Config, with_migrations: bool, with_worker: bool) -> anyhow::Result<()> {
    let pool = connect(&config).await?;
    let kv = connect_kv(&config).await?;
    telemetry::observe_pool(pool.clone());
    if with_migrations {
        runflow_db::migrate(&pool)
            .await
            .context("applying migrations")?;
    }
    // Fail fast on a broken e-mail setup instead of at the first sign-in.
    let mailer = Mailer::from_settings(&config.email).context("e-mail settings")?;

    let secret = match &config.secrets.session_secret {
        Some(s) => s.expose().as_bytes().to_vec(),
        None => {
            tracing::warn!("SESSION_SECRET is not set: using an insecure development key");
            b"runflow-development-only-insecure-key".to_vec()
        }
    };
    let settings = ApiSettings {
        version: *VERSION,
        cors_origins: config.http.cors_origins.clone(),
        request_timeout: Duration::from_secs(30),
        body_limit: 12 * 1024 * 1024,
        public_app_url: config.http.public_app_url.clone(),
        public_api_url: config.http.public_api_url.clone(),
        strava_verify_token: config
            .strava
            .as_ref()
            .and_then(|s| s.webhook_verify_token.as_ref())
            .map(|t| t.expose().to_string()),
        billing: BillingSettings {
            simulation: config.billing_simulation,
            webhook_secret: config
                .stripe
                .as_ref()
                .and_then(|s| s.webhook_secret.as_ref())
                .map(|w| w.expose().to_string()),
        },
        push_public_key: config.push.as_ref().map(|p| p.public_key.clone()),
        web_sentry: config
            .sentry_web_dsn
            .as_ref()
            .map(|dsn| runflow_api::WebSentry {
                dsn: dsn.clone(),
                environment: config.deployment_env.clone(),
                release: (*VERSION).to_string(),
            }),
        auth: AuthSettings {
            secret,
            session_ttl: chrono::Duration::days(60),
            cookie_name: config.http.cookie_name.clone(),
            cookie_domain: config.http.cookie_domain.clone(),
            cookie_secure: config.http.public_app_url.starts_with("https://"),
            smoke_key: config
                .secrets
                .smoke_key
                .as_ref()
                .map(|k| k.expose().to_string()),
            dev_affordances: config.env == RunEnv::Development
                && mailer.provider() == Provider::Log,
        },
    };
    let cipher = token_cipher(&config)?;
    let strava = config.strava.as_ref().map(|st| {
        StravaClient::new(
            STRAVA_BASE,
            st.client_id.clone(),
            st.client_secret.expose().to_string(),
        )
    });
    let google = config
        .google
        .as_ref()
        .map(|g| GoogleVerifier::new(GOOGLE_JWKS_URL, g.audiences()));
    let storage = Storage::from_settings(&match &config.storage {
        config::Storage::Disk { dir } => StorageSettings::Disk { dir: dir.clone() },
        config::Storage::S3 {
            bucket,
            region,
            endpoint,
        } => StorageSettings::S3 {
            bucket: bucket.clone(),
            region: region.clone(),
            endpoint: endpoint.clone(),
        },
    })
    .context("file storage (STORAGE_*)")?;
    let mut state = AppState::new(
        pool.clone(),
        kv,
        settings,
        mailer.clone(),
        google,
        storage,
        cipher.clone(),
    );
    if let Some(client) = strava.clone() {
        state = state.with_strava(client);
    }
    if let Some(st) = &config.stripe {
        state = state.with_stripe(StripeClient::new(
            STRIPE_BASE,
            st.secret_key.expose().to_string(),
        ));
    }
    let app = runflow_api::router(state);
    let listener = tokio::net::TcpListener::bind(config.http.bind)
        .await
        .with_context(|| format!("binding {}", config.http.bind))?;
    tracing::info!(
        version = *VERSION,
        env = ?config.env,
        addr = %config.http.bind,
        email = ?mailer.provider(),
        google = config.google.is_some(),
        strava = config.strava.is_some(),
        stripe = config.stripe.is_some(),
        push = config.push.is_some(),
        "runflow listening"
    );
    let web = webpush(&config)?;
    // One signal stops both the server and the in-process worker.
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    let worker = with_worker.then(|| {
        let mut w = runflow_jobs::Worker::new(
            pool.clone(),
            mailer.clone(),
            config.http.public_app_url.clone(),
        )
        .with_api_url(config.http.public_api_url.clone());
        if let Some(client) = strava.clone() {
            w = w.with_strava(client, cipher.clone());
        }
        if let Some(web) = web.clone() {
            w = w.with_webpush(web);
        }
        w = w.with_expo(expo(&config));
        if let Some(stripe) = stripe_client(&config) {
            w = w.with_stripe(stripe);
        }
        let mut rx = stop_rx.clone();
        tokio::spawn(async move {
            w.run(async move {
                let _ = rx.wait_for(|stop| *stop).await;
            })
            .await
        })
    });
    let mut rx = stop_rx.clone();
    let served = axum::serve(listener, app).with_graceful_shutdown(async move {
        tokio::select! {
            _ = shutdown() => {}
            _ = rx.wait_for(|stop| *stop) => {}
        }
    });
    let result = served.await;
    let _ = stop_tx.send(true);
    if let Some(w) = worker {
        let _ = w.await;
    }
    result.context("server")?;
    pool.close().await;
    tracing::info!("bye");
    Ok(())
}

/// `ENCRYPTION_KEY` (base64 of 32 bytes); development falls back to a fixed, insecure key.
fn token_cipher(config: &Config) -> anyhow::Result<TokenCipher> {
    use base64::Engine;
    match &config.secrets.encryption_key {
        Some(k) => {
            let raw = base64::engine::general_purpose::STANDARD
                .decode(k.expose().trim())
                .context("ENCRYPTION_KEY must be base64 (openssl rand -base64 32)")?;
            Ok(TokenCipher::new(&raw)?)
        }
        None => {
            tracing::warn!(
                "ENCRYPTION_KEY is not set: provider tokens use an insecure development key"
            );
            Ok(TokenCipher::new(b"runflow-development-only-key-32b")?)
        }
    }
}

async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("shutting down");
}

async fn email_test(
    config: &Config,
    to: String,
    preview: Option<std::path::PathBuf>,
    club: Option<String>,
) -> anyhow::Result<()> {
    let mailer = Mailer::from_settings(&config.email).context("e-mail settings")?;
    let env = if config.env == RunEnv::Production {
        "produção"
    } else {
        "desenvolvimento"
    };
    let title = "Seu e-mail está funcionando";
    let lines = [
        format!("Este é um e-mail de teste enviado pelo servidor do Runflow ({env})."),
        "Se ele chegou, o envio está configurado: convites e códigos de acesso vão chegar assim."
            .to_string(),
    ];
    let html_body: String = lines.iter().map(|l| paragraph(&escape_html(l))).collect();
    let footer = "Você recebeu este e-mail porque alguém testou a configuração do Runflow com o seu endereço.";
    let action = Some(Action {
        label: "Abrir o Runflow",
        url: &config.http.public_app_url,
    });
    // With --club, the club's frame (D-036), read from the database like the invite job does.
    let html = match club {
        Some(slug) => {
            let pool = connect(config).await?;
            let c = runflow_db::clubs::club_by_slug(&pool, &slug)
                .await?
                .with_context(|| format!("no club with slug {slug}"))?;
            let theme = runflow_db::clubs::branding(&pool, c.id)
                .await?
                .map(|b| b.theme)
                .unwrap_or_default();
            let logo = runflow_db::clubs::email_logo(&pool, c.id).await?.map(|id| {
                format!(
                    "{}/v1/assets/{id}",
                    config.http.public_api_url.trim_end_matches('/')
                )
            });
            let frame = ClubFrame {
                name: &c.name,
                logo_url: logo.as_deref(),
                theme: &theme,
            };
            club_layout(&frame, title, &html_body, action, footer)
        }
        None => layout(title, &html_body, action, footer),
    };
    let email = Email {
        to: vec![to.clone()],
        subject: "Runflow: e-mail de teste".into(),
        html,
        text: format!(
            "{title}\n\n{}\n\nAbrir o Runflow: {}\n\n{footer}",
            lines.join("\n\n"),
            config.http.public_app_url
        ),
        tags: vec![("kind".into(), "test".into())],
        ..Default::default()
    };
    if let Some(path) = preview {
        std::fs::write(&path, &email.html)
            .with_context(|| format!("writing {}", path.display()))?;
        println!("preview written to {}", path.display());
        return Ok(());
    }
    let sent = mailer
        .send(&email)
        .await
        .context("sending the test e-mail")?;
    println!("sent via {:?} to {to} (id {})", mailer.provider(), sent.id);
    Ok(())
}

async fn healthcheck(config: &Config) -> anyhow::Result<()> {
    let url = format!("http://127.0.0.1:{}/v1/health", config.http.bind.port());
    let res = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()?
        .get(&url)
        .send()
        .await
        .context("health request")?;
    anyhow::ensure!(
        res.status().is_success(),
        "health returned {}",
        res.status()
    );
    Ok(())
}

fn stripe_client(config: &Config) -> Option<std::sync::Arc<StripeClient>> {
    config.stripe.as_ref().map(|st| {
        std::sync::Arc::new(StripeClient::new(
            STRIPE_BASE,
            st.secret_key.expose().to_string(),
        ))
    })
}

/// `runflow stripe-setup`: prices from the plan catalog, the portal configuration and the webhook endpoint.
async fn stripe_setup(
    config: &Config,
    webhook_url: Option<String>,
    env_file: Option<std::path::PathBuf>,
) -> anyhow::Result<()> {
    use runflow_domain::plans;
    use runflow_integrations::stripe::{
        PRICE_MAX, PRICE_MAX_STUDENT, PRICE_MAX_TRAINER, PRICE_PRO,
    };
    let client = stripe_client(config).context("STRIPE_SECRET_KEY is not set")?;
    let (pro, max) = (plans::plan("pro"), plans::plan("max"));
    let extra = max
        .extra
        .as_ref()
        .context("Max has no extra seat prices in api/plans.json")?;
    let prices = [
        (PRICE_PRO, "Runflow Pro", pro.price_cents),
        (PRICE_MAX, "Runflow Max", max.price_cents),
        (
            PRICE_MAX_TRAINER,
            "Runflow Max · treinador extra",
            extra.trainer_cents,
        ),
        (
            PRICE_MAX_STUDENT,
            "Runflow Max · aluno extra",
            extra.student_cents,
        ),
    ];
    let url = webhook_url.unwrap_or_else(|| {
        format!(
            "{}/v1/webhooks/stripe",
            config.http.public_api_url.trim_end_matches('/')
        )
    });
    let report = client.setup(&prices, &url).await?;
    for (key, id, created) in &report.prices {
        println!(
            "price {key}: {id}{}",
            if *created { " (created)" } else { "" }
        );
    }
    println!(
        "portal configuration: {}",
        if report.portal_created {
            "created"
        } else {
            "found"
        }
    );
    println!("webhook {url}: {}", report.webhook_id);
    match (report.webhook_secret, env_file) {
        (Some(secret), Some(path)) => {
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let line = format!("STRIPE_WEBHOOK_SECRET={secret}");
            let mut found = false;
            let mut out: Vec<String> = text
                .lines()
                .map(|l| {
                    if l.starts_with("STRIPE_WEBHOOK_SECRET=") {
                        found = true;
                        line.clone()
                    } else {
                        l.to_string()
                    }
                })
                .collect();
            if !found {
                out.push(line);
            }
            std::fs::write(&path, out.join("\n") + "\n")
                .with_context(|| format!("writing {}", path.display()))?;
            println!(
                "webhook signing secret written to {} (STRIPE_WEBHOOK_SECRET)",
                path.display()
            );
        }
        (Some(secret), None) => {
            println!("STRIPE_WEBHOOK_SECRET={secret}  (shown once: store it in the env file)")
        }
        (None, _) => println!("webhook signing secret: unchanged (existing endpoint)"),
    }
    Ok(())
}
