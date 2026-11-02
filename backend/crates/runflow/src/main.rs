//! The Runflow server binary (root.md §7.2). Docker runs `runflow all`.

mod config;
mod doctor;

use std::process::ExitCode;
use std::sync::LazyLock;
use std::time::Duration;

use anyhow::Context;
use clap::{Parser, Subcommand};
use runflow_api::{ApiSettings, AppState};
use runflow_integrations::email::{Action, Email, Mailer, escape_html, layout, paragraph};
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
    /// Apply migrations, then serve the API (what Docker runs).
    All,
    /// Serve the HTTP API (expects an up-to-date database).
    Serve,
    /// Apply pending database migrations and exit.
    Migrate,
    /// Show what is configured (secrets hidden) and check the database and storage.
    Doctor,
    /// Send a test e-mail through the configured provider (checks the Resend setup).
    EmailTest {
        /// Recipient. With `onboarding@resend.dev` as sender, Resend only delivers to your own account e-mail.
        #[arg(long)]
        to: String,
        /// Write the HTML to this file instead of sending (to review the layout).
        #[arg(long)]
        preview: Option<std::path::PathBuf>,
    },
    /// Exit 0 when the local server answers /v1/health (Docker healthcheck; no curl in the image).
    Healthcheck,
}

#[tokio::main]
async fn main() -> ExitCode {
    // `.env` at the repo root when running with cargo; Docker passes the variables directly.
    let _ = dotenvy::dotenv();
    let cli = Cli::parse();

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
    init_logging(config.log_format);

    let result = match cli.command {
        Command::All => run(config, true).await,
        Command::Serve => run(config, false).await,
        Command::Migrate => migrate(&config).await,
        Command::Doctor => doctor::run(&config).await,
        Command::EmailTest { to, preview } => email_test(&config, to, preview).await,
        Command::Healthcheck => healthcheck(&config).await,
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            tracing::error!("{err:#}");
            ExitCode::FAILURE
        }
    }
}

fn init_logging(format: LogFormat) {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,runflow=debug"));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    match format {
        LogFormat::Json => builder.json().flatten_event(true).init(),
        LogFormat::Pretty => builder.compact().init(),
    }
}

async fn connect(config: &Config) -> anyhow::Result<runflow_db::Pool> {
    runflow_db::connect(&config.db, Duration::from_secs(30))
        .await
        .context("connecting to the database (DATABASE_URL)")
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

async fn run(config: Config, with_migrations: bool) -> anyhow::Result<()> {
    let pool = connect(&config).await?;
    if with_migrations {
        runflow_db::migrate(&pool)
            .await
            .context("applying migrations")?;
    }
    // Fail fast on a broken e-mail setup instead of at the first sign-in.
    let mailer = Mailer::from_settings(&config.email).context("e-mail settings")?;

    let settings = ApiSettings {
        version: *VERSION,
        cors_origins: config.http.cors_origins.clone(),
        request_timeout: Duration::from_secs(30),
        body_limit: 12 * 1024 * 1024,
    };
    let app = runflow_api::router(AppState::new(pool.clone(), settings));
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
        "runflow listening"
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await
        .context("server")?;
    pool.close().await;
    tracing::info!("bye");
    Ok(())
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
    let email = Email {
        to: vec![to.clone()],
        subject: "Runflow: e-mail de teste".into(),
        html: layout(
            title,
            &html_body,
            Some(Action {
                label: "Abrir o Runflow",
                url: &config.http.public_app_url,
            }),
            footer,
        ),
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
