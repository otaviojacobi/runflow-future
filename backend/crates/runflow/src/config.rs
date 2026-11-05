//! Configuration from the environment (12-factor, Lambda-ready). `.env.example` at the repo root
//! documents every variable; keep the two in sync. Problems are collected and reported together.

use std::fmt;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::str::FromStr;

use runflow_db::DbSettings;
use runflow_integrations::email::{EmailSettings, Provider};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunEnv {
    Development,
    Production,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    Pretty,
    Json,
}

/// A value that never shows up in logs or `Debug` output.
#[derive(Clone)]
pub struct Secret(String);

impl Secret {
    #[cfg(test)]
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
    /// `re_ab…` style hint for the doctor.
    pub fn hint(&self) -> String {
        let head: String = self.0.chars().take(5).collect();
        format!("{head}… ({} chars)", self.0.chars().count())
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

#[derive(Debug, Clone)]
pub struct Http {
    pub bind: SocketAddr,
    /// Where people open the web app; links in e-mails point here.
    pub public_app_url: String,
    /// Where the API is reachable from outside (OAuth and webhook callbacks).
    pub public_api_url: String,
    pub cors_origins: Vec<String>,
    /// The session cookie's domain; `None` = host-only (the default).
    pub cookie_domain: Option<String>,
    pub cookie_name: String,
}

#[derive(Debug, Clone)]
pub struct Secrets {
    /// HMAC key for session tokens and e-mail codes (S2).
    pub session_secret: Option<Secret>,
    /// Encrypts provider tokens at rest (S5).
    pub encryption_key: Option<Secret>,
    /// Smoke tests on deployed environments (D-034): unlocks sign-in codes for `@smoke.runflow.club`.
    pub smoke_key: Option<Secret>,
}

#[derive(Debug, Clone)]
pub struct Google {
    /// Web OAuth client (Google Identity Services); also the audience the mobile SDK requests.
    pub client_id: String,
    /// Not needed for ID-token sign-in; kept for future server-side Google APIs.
    pub client_secret: Option<Secret>,
    pub android_client_id: Option<String>,
    pub ios_client_id: Option<String>,
}

impl Google {
    /// Client ids whose ID tokens we accept.
    pub fn audiences(&self) -> Vec<String> {
        std::iter::once(self.client_id.clone())
            .chain(self.android_client_id.clone())
            .chain(self.ios_client_id.clone())
            .collect()
    }
}

#[derive(Debug, Clone)]
pub struct Strava {
    pub client_id: String,
    pub client_secret: Secret,
    pub webhook_verify_token: Option<Secret>,
}

#[derive(Debug, Clone)]
pub struct Stripe {
    pub secret_key: Secret,
    pub webhook_secret: Option<Secret>,
}

/// Telemetry over OTLP (S13): the standard OpenTelemetry variables.
#[derive(Debug, Clone)]
pub struct Otel {
    /// `OTEL_EXPORTER_OTLP_ENDPOINT`: the base URL (`/v1/traces`, `/v1/metrics`, `/v1/logs` are appended).
    pub endpoint: String,
    /// `OTEL_EXPORTER_OTLP_HEADERS`: `Authorization=Basic%20…` for Grafana Cloud.
    pub headers: Option<Secret>,
    /// `OTEL_SERVICE_NAME` (default `runflow`).
    pub service_name: String,
    /// `OTEL_TRACES_SAMPLER_ARG`: share of traces kept, 0–1 (default 1).
    pub traces_ratio: f64,
    /// `OTEL_METRIC_EXPORT_INTERVAL` in ms (default 60000).
    pub metrics_interval: std::time::Duration,
    /// `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`: `otlp` (default) or `none`. QA reads the
    /// containers' logs itself and keeps no traces, so it sends metrics only.
    pub traces: bool,
    pub metrics: bool,
    pub logs: bool,
}

/// Web Push (S7b): the VAPID key pair (`runflow vapid-keys`) and a contact for the push services.
#[derive(Debug, Clone)]
pub struct Push {
    pub public_key: String,
    pub private_key: Secret,
    pub subject: String,
}

#[derive(Debug, Clone)]
pub enum Storage {
    Disk {
        dir: PathBuf,
    },
    S3 {
        bucket: String,
        region: String,
        endpoint: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub enum Assistant {
    /// Deterministic rules, like the mock (no data leaves the server).
    Rules,
    Anthropic {
        api_key: Secret,
        model: String,
    },
}

#[derive(Debug, Clone)]
pub struct Config {
    pub env: RunEnv,
    pub log_format: LogFormat,
    pub http: Http,
    pub db: DbSettings,
    /// `REDIS_URL` (D-047): the Valkey server for ephemeral and cache data, as a Redis-protocol URL (the name every
    /// client and ElastiCache use). A secret: it may carry a password.
    pub redis_url: Secret,
    pub secrets: Secrets,
    pub email: EmailSettings,
    pub google: Option<Google>,
    pub strava: Option<Strava>,
    pub stripe: Option<Stripe>,
    /// `BILLING_SIMULATION` (default: on in development): without Stripe, owners "pay" on Runflow's test pages.
    pub billing_simulation: bool,
    pub push: Option<Push>,
    /// `EXPO_ACCESS_TOKEN`: only if the Expo project turns on enhanced push security (phone push, X10).
    pub expo_access_token: Option<Secret>,
    pub storage: Storage,
    pub assistant: Assistant,
    pub sentry_dsn: Option<String>,
    pub otel: Option<Otel>,
    /// The web app's DSN (`SENTRY_WEB_DSN`), handed to it by `/public/config` (browser DSNs are public).
    pub sentry_web_dsn: Option<String>,
    /// `DEPLOYMENT_ENV`: the environment's name in Sentry and telemetry (default `development` or `production` from
    /// `RUNFLOW_ENV`; QA sets `qa`).
    pub deployment_env: String,
    /// Product analytics in the web app (D-054): the self-hosted Umami's website id, handed out by `/public/config`.
    pub umami: Option<Umami>,
}

/// Umami (D-054): cookieless page views and events from the web app. Both values are public (they sit in the page).
#[derive(Debug, Clone)]
pub struct Umami {
    /// `UMAMI_WEBSITE_ID`: the website's id in Umami (a UUID).
    pub website_id: String,
    /// `UMAMI_SCRIPT_URL`: the tracker. Default `/insights/script.js`, the web container's first-party route to the
    /// self-hosted Umami (`frontend/Caddyfile`); the tracker posts to `api/send` next to it.
    pub script_url: String,
}

/// Reads variables through a function so tests don't touch the process environment.
pub struct Env<F: Fn(&str) -> Option<String>> {
    get: F,
    errors: Vec<String>,
}

impl<F: Fn(&str) -> Option<String>> Env<F> {
    fn opt(&self, name: &str) -> Option<String> {
        (self.get)(name)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    }
    fn or(&self, name: &str, default: &str) -> String {
        self.opt(name).unwrap_or_else(|| default.to_string())
    }
    fn required(&mut self, name: &str, why: &str) -> String {
        self.opt(name).unwrap_or_else(|| {
            self.errors.push(format!("{name} is required ({why})"));
            String::new()
        })
    }
    fn parse<T: FromStr>(&mut self, name: &str, default: T) -> T {
        match self.opt(name) {
            None => default,
            Some(v) => v.parse().unwrap_or_else(|_| {
                self.errors.push(format!("{name}={v:?} is not valid"));
                default
            }),
        }
    }
    fn secret(&self, name: &str) -> Option<Secret> {
        self.opt(name).map(Secret)
    }
    /// Both or neither: `(a, b)` are only useful together.
    fn pair(&mut self, a: &str, b: &str) -> Option<(String, String)> {
        match (self.opt(a), self.opt(b)) {
            (Some(x), Some(y)) => Some((x, y)),
            (None, None) => None,
            _ => {
                self.errors
                    .push(format!("{a} and {b} go together: set both or neither"));
                None
            }
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Self, Vec<String>> {
        Self::from_fn(|k| std::env::var(k).ok())
    }

    pub fn from_fn(get: impl Fn(&str) -> Option<String>) -> Result<Self, Vec<String>> {
        let mut e = Env {
            get,
            errors: Vec::new(),
        };

        let env = match e.or("RUNFLOW_ENV", "development").as_str() {
            "development" | "dev" => RunEnv::Development,
            "production" | "prod" => RunEnv::Production,
            other => {
                e.errors.push(format!(
                    "RUNFLOW_ENV={other:?}: use development or production"
                ));
                RunEnv::Development
            }
        };
        let prod = env == RunEnv::Production;
        let log_format = match e
            .or("LOG_FORMAT", if prod { "json" } else { "pretty" })
            .as_str()
        {
            "json" => LogFormat::Json,
            "pretty" | "text" => LogFormat::Pretty,
            other => {
                e.errors
                    .push(format!("LOG_FORMAT={other:?}: use pretty or json"));
                LogFormat::Pretty
            }
        };

        let host: IpAddr = e.parse("HOST", IpAddr::from([0, 0, 0, 0]));
        let port: u16 = e.parse("PORT", 3000);
        let public_app_url = e
            .or("PUBLIC_APP_URL", "http://localhost:8080")
            .trim_end_matches('/')
            .to_string();
        let public_api_url = e
            .or("PUBLIC_API_URL", "http://localhost:3000")
            .trim_end_matches('/')
            .to_string();
        if prod && !public_app_url.starts_with("https://") {
            e.errors
                .push("PUBLIC_APP_URL must be https:// in production".into());
        }
        let cors_origins = e
            .opt("CORS_ORIGINS")
            .map(|v| {
                v.split(',')
                    .map(|o| o.trim().trim_end_matches('/').to_string())
                    .filter(|o| !o.is_empty())
                    .collect()
            })
            .unwrap_or_else(|| vec![public_app_url.clone()]);
        let http = Http {
            bind: SocketAddr::new(host, port),
            public_app_url,
            public_api_url,
            cors_origins,
            cookie_domain: e.opt("COOKIE_DOMAIN"),
            cookie_name: e.or("COOKIE_NAME", "rf_session"),
        };

        let db = DbSettings {
            url: e.required("DATABASE_URL", "postgres://user:password@host:5432/db"),
            max_connections: e.parse("DATABASE_MAX_CONNECTIONS", 10),
        };
        let redis_url = Secret(e.required(
            "REDIS_URL",
            "the Valkey server: redis://[:password@]host:6379",
        ));
        if !redis_url.0.is_empty()
            && !(redis_url.0.starts_with("redis://") || redis_url.0.starts_with("rediss://"))
        {
            e.errors
                .push("REDIS_URL must start with redis:// (or rediss:// for TLS)".into());
        }

        let secrets = Secrets {
            session_secret: e.secret("SESSION_SECRET"),
            smoke_key: e.secret("SMOKE_KEY"),
            encryption_key: e.secret("ENCRYPTION_KEY"),
        };
        for (name, value) in [
            ("SESSION_SECRET", &secrets.session_secret),
            ("ENCRYPTION_KEY", &secrets.encryption_key),
        ] {
            match value {
                Some(s) if s.expose().len() < 32 => e.errors.push(format!(
                    "{name} is too short: use `openssl rand -base64 32`"
                )),
                None if prod => e.errors.push(format!(
                    "{name} is required in production (`openssl rand -base64 32`)"
                )),
                _ => {}
            }
        }
        if let Some(k) = &secrets.encryption_key {
            use base64::Engine;
            let ok = base64::engine::general_purpose::STANDARD
                .decode(k.expose().trim())
                .is_ok_and(|b| b.len() == 32);
            if !ok {
                e.errors.push(
                    "ENCRYPTION_KEY must be base64 of 32 bytes: `openssl rand -base64 32`".into(),
                );
            }
        }

        let provider = match e
            // Unset: Resend as soon as a key is there (or always in production), else the log.
            .or(
                "EMAIL_PROVIDER",
                if prod || e.opt("RESEND_API_KEY").is_some() {
                    "resend"
                } else {
                    "log"
                },
            )
            .as_str()
        {
            "resend" => Provider::Resend,
            "log" => Provider::Log,
            other => {
                e.errors
                    .push(format!("EMAIL_PROVIDER={other:?}: use resend or log"));
                Provider::Log
            }
        };
        if prod && provider == Provider::Log {
            e.errors.push(
                "EMAIL_PROVIDER=log only works in development: set resend and RESEND_API_KEY"
                    .into(),
            );
        }
        let resend_api_key = e.opt("RESEND_API_KEY");
        if provider == Provider::Resend && resend_api_key.is_none() {
            e.errors
                .push("EMAIL_PROVIDER=resend needs RESEND_API_KEY (resend.com/api-keys)".into());
        }
        let from = e.or("EMAIL_FROM", "Runflow <contato@runflow.club>");
        if !from.contains('@') {
            e.errors.push(format!(
                "EMAIL_FROM={from:?} needs an e-mail address, e.g. Runflow <contato@runflow.club>"
            ));
        }
        let email = EmailSettings {
            provider,
            resend_api_key,
            resend_api_url: e.or("RESEND_API_URL", "https://api.resend.com"),
            from,
            reply_to: e.opt("EMAIL_REPLY_TO"),
        };

        let google = e.opt("GOOGLE_CLIENT_ID").map(|id| Google {
            client_id: id,
            client_secret: e.secret("GOOGLE_CLIENT_SECRET"),
            android_client_id: e.opt("GOOGLE_ANDROID_CLIENT_ID"),
            ios_client_id: e.opt("GOOGLE_IOS_CLIENT_ID"),
        });
        let strava = e
            .pair("STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET")
            .map(|(id, secret)| Strava {
                client_id: id,
                client_secret: Secret(secret),
                webhook_verify_token: e.secret("STRAVA_WEBHOOK_VERIFY_TOKEN"),
            });
        let stripe = e.secret("STRIPE_SECRET_KEY").map(|key| Stripe {
            secret_key: key,
            webhook_secret: e.secret("STRIPE_WEBHOOK_SECRET"),
        });

        let storage = match e.or("STORAGE_BACKEND", "disk").as_str() {
            "disk" => Storage::Disk {
                dir: PathBuf::from(e.or("STORAGE_DIR", "data/uploads")),
            },
            "s3" => Storage::S3 {
                bucket: e.required("S3_BUCKET", "STORAGE_BACKEND=s3"),
                region: e.or("S3_REGION", "sa-east-1"),
                endpoint: e.opt("S3_ENDPOINT"),
            },
            other => {
                e.errors
                    .push(format!("STORAGE_BACKEND={other:?}: use disk or s3"));
                Storage::Disk {
                    dir: PathBuf::from("data/uploads"),
                }
            }
        };

        let assistant = match e.or("AI_PROVIDER", "rules").as_str() {
            "rules" => Assistant::Rules,
            "anthropic" => Assistant::Anthropic {
                api_key: Secret(e.required("ANTHROPIC_API_KEY", "AI_PROVIDER=anthropic")),
                model: e.required(
                    "AI_MODEL",
                    "AI_PROVIDER=anthropic; provider and budget are root.md §11.4",
                ),
            },
            other => {
                e.errors
                    .push(format!("AI_PROVIDER={other:?}: use rules or anthropic"));
                Assistant::Rules
            }
        };

        let otel_service = e.or("OTEL_SERVICE_NAME", "runflow");
        let otel_ratio: f64 = e.parse("OTEL_TRACES_SAMPLER_ARG", 1.0);
        let otel_interval: u64 = e.parse("OTEL_METRIC_EXPORT_INTERVAL", 60_000);
        let otel_headers = e.secret("OTEL_EXPORTER_OTLP_HEADERS");
        let mut signal = |name: &str| match e.or(name, "otlp").as_str() {
            "otlp" => true,
            "none" => false,
            other => {
                e.errors.push(format!("{name}={other:?}: use otlp or none"));
                false
            }
        };
        let (traces, metrics, logs) = (
            signal("OTEL_TRACES_EXPORTER"),
            signal("OTEL_METRICS_EXPORTER"),
            signal("OTEL_LOGS_EXPORTER"),
        );
        let otel = e.opt("OTEL_EXPORTER_OTLP_ENDPOINT").map(|endpoint| Otel {
            endpoint,
            headers: otel_headers,
            service_name: otel_service,
            traces_ratio: otel_ratio.clamp(0.0, 1.0),
            metrics_interval: std::time::Duration::from_millis(otel_interval.max(1000)),
            traces,
            metrics,
            logs,
        });
        let sentry_dsn = e.opt("SENTRY_DSN");
        let sentry_web_dsn = e.opt("SENTRY_WEB_DSN");
        for (name, dsn) in [
            ("SENTRY_DSN", &sentry_dsn),
            ("SENTRY_WEB_DSN", &sentry_web_dsn),
        ] {
            if let Some(d) = dsn
                && d.parse::<sentry::types::Dsn>().is_err()
            {
                e.errors.push(format!(
                    "{name} isn't a Sentry DSN (https://<key>@<host>/<project>)"
                ));
            }
        }
        let deployment_env = e.or(
            "DEPLOYMENT_ENV",
            if env == RunEnv::Development {
                "development"
            } else {
                "production"
            },
        );
        let umami = e.opt("UMAMI_WEBSITE_ID").map(|website_id| Umami {
            website_id,
            script_url: e.or("UMAMI_SCRIPT_URL", "/insights/script.js"),
        });
        if let Some(u) = &umami {
            if uuid::Uuid::parse_str(&u.website_id).is_err() {
                e.errors.push(
                    "UMAMI_WEBSITE_ID isn't a website id (Umami → Settings → Websites → Edit: a UUID)".into(),
                );
            }
            if !(u.script_url.starts_with("https://") || u.script_url.starts_with('/')) {
                e.errors.push(
                    "UMAMI_SCRIPT_URL must be a path on the app's host (/insights/script.js) or an https:// URL"
                        .into(),
                );
            }
        }
        let billing_simulation = e.parse("BILLING_SIMULATION", env == RunEnv::Development);
        let expo_access_token = e.secret("EXPO_ACCESS_TOKEN");
        let subject = e.or("VAPID_SUBJECT", "mailto:contato@runflow.club");
        let push = e
            .pair("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY")
            .map(|(public_key, private)| Push {
                public_key,
                private_key: Secret(private),
                subject: subject.clone(),
            });
        if let Some(p) = &push
            && let Err(err) = runflow_integrations::webpush::Vapid::new(
                &p.public_key,
                p.private_key.expose(),
                &p.subject,
            )
        {
            e.errors
                .push(format!("{err} (generate a pair with `runflow vapid-keys`)"));
        }
        if e.errors.is_empty() {
            Ok(Config {
                env,
                log_format,
                http,
                db,
                redis_url,
                secrets,
                email,
                google,
                strava,
                stripe,
                billing_simulation,
                push,
                expo_access_token,
                storage,
                assistant,
                sentry_dsn,
                otel,
                sentry_web_dsn,
                deployment_env,
                umami,
            })
        } else {
            Err(e.errors)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    /// The given variables, plus a `REDIS_URL` unless they set one.
    fn cfg(pairs: &[(&str, &str)]) -> Result<Config, Vec<String>> {
        let mut map: HashMap<String, String> =
            HashMap::from([("REDIS_URL".into(), "redis://localhost:6380".into())]);
        map.extend(pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        Config::from_fn(move |k| map.get(k).cloned())
    }

    #[test]
    fn redis_is_required_and_secret() {
        let errs = cfg(&[("DATABASE_URL", "postgres://x"), ("REDIS_URL", "")]).unwrap_err();
        assert!(errs.iter().any(|e| e.contains("REDIS_URL is required")));
        let errs = cfg(&[
            ("DATABASE_URL", "postgres://x"),
            ("REDIS_URL", "localhost:6379"),
        ])
        .unwrap_err();
        assert!(errs.iter().any(|e| e.contains("redis://")));
        let c = cfg(&[
            ("DATABASE_URL", "postgres://x"),
            ("REDIS_URL", "rediss://:hunter2@cache.example:6379"),
        ])
        .unwrap();
        assert_eq!(c.redis_url.expose(), "rediss://:hunter2@cache.example:6379");
        assert!(
            !format!("{c:?}").contains("hunter2"),
            "the password leaks through Debug"
        );
    }

    #[test]
    fn umami_needs_a_website_id() {
        let c = cfg(&[("DATABASE_URL", "postgres://x")]).unwrap();
        assert!(c.umami.is_none());
        let c = cfg(&[
            ("DATABASE_URL", "postgres://x"),
            ("UMAMI_WEBSITE_ID", "8c7e0b1e-5f3a-4f7e-9b2a-1d2c3e4f5a6b"),
        ])
        .unwrap();
        let u = c.umami.unwrap();
        assert_eq!(u.website_id, "8c7e0b1e-5f3a-4f7e-9b2a-1d2c3e4f5a6b");
        assert_eq!(u.script_url, "/insights/script.js");
        let errs = cfg(&[
            ("DATABASE_URL", "postgres://x"),
            ("UMAMI_WEBSITE_ID", "runflow-qa"),
            ("UMAMI_SCRIPT_URL", "http://umami.local/script.js"),
        ])
        .unwrap_err();
        assert!(errs.iter().any(|e| e.contains("UMAMI_WEBSITE_ID")));
        assert!(errs.iter().any(|e| e.contains("UMAMI_SCRIPT_URL")));
    }

    #[test]
    fn development_defaults() {
        let c = cfg(&[("DATABASE_URL", "postgres://x")]).unwrap();
        assert_eq!(c.env, RunEnv::Development);
        assert_eq!(c.email.provider, Provider::Log);
        assert_eq!(c.http.bind.port(), 3000);
        assert_eq!(c.http.cors_origins, vec!["http://localhost:8080"]);
        assert!(c.google.is_none() && matches!(c.assistant, Assistant::Rules));
    }

    #[test]
    fn resend_key_switches_the_provider() {
        let c = cfg(&[
            ("DATABASE_URL", "postgres://x"),
            ("RESEND_API_KEY", "re_abc"),
        ])
        .unwrap();
        assert_eq!(c.email.provider, Provider::Resend);
        let c = cfg(&[
            ("DATABASE_URL", "postgres://x"),
            ("RESEND_API_KEY", "re_abc"),
            ("EMAIL_PROVIDER", "log"),
        ])
        .unwrap();
        assert_eq!(c.email.provider, Provider::Log);
    }

    #[test]
    fn production_is_strict() {
        let errs = cfg(&[
            ("RUNFLOW_ENV", "production"),
            ("DATABASE_URL", "postgres://x"),
            ("PUBLIC_APP_URL", "http://app"),
        ])
        .unwrap_err();
        let all = errs.join("\n");
        for needle in [
            "PUBLIC_APP_URL",
            "SESSION_SECRET",
            "ENCRYPTION_KEY",
            "RESEND_API_KEY",
        ] {
            assert!(all.contains(needle), "missing {needle} in {all}");
        }
    }

    #[test]
    fn pairs_and_secrets() {
        let errs = cfg(&[
            ("DATABASE_URL", "postgres://x"),
            ("STRAVA_CLIENT_ID", "id"),
            ("SESSION_SECRET", "short"),
        ])
        .unwrap_err();
        assert!(errs.iter().any(|e| e.contains("STRAVA_CLIENT_SECRET")));
        assert!(
            errs.iter()
                .any(|e| e.contains("SESSION_SECRET is too short"))
        );
        let c = cfg(&[
            ("DATABASE_URL", "postgres://x"),
            ("EMAIL_PROVIDER", "resend"),
            ("RESEND_API_KEY", "re_123"),
        ])
        .unwrap();
        assert_eq!(c.email.resend_api_key.as_deref(), Some("re_123"));
        assert!(
            !format!("{c:?}").contains("re_123"),
            "secrets leak through Debug"
        );
    }
}
