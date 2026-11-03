//! Errors to Sentry (S12, D-033): panics, `error`-level logs (with the `info`/`warn` before them as breadcrumbs)
//! and failed jobs, from the API and the worker. Off without `SENTRY_DSN`. Events carry the user id only: request
//! headers, cookies, bodies and query strings are dropped, and token-like path segments (invites, for example)
//! are masked.

use sentry::protocol::{Event, Request};
use tracing_subscriber::Layer;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::registry::LookupSpan;

use crate::config::Config;

/// Starts Sentry when configured; keep the guard alive until exit (it flushes pending events).
pub fn init(config: &Config, release: &'static str) -> Option<sentry::ClientInitGuard> {
    let dsn = config.sentry_dsn.as_deref()?;
    let options = sentry::ClientOptions::new()
        .dsn(dsn)
        .release(release)
        .environment(config.deployment_env.clone())
        .send_default_pii(false)
        .attach_stacktrace(true)
        .before_send(|e| Some(scrub(e)));
    Some(sentry::init(options))
}

/// `error!` logs become Sentry events; `info!` and `warn!` before them ride along as breadcrumbs.
pub fn layer<S>() -> impl Layer<S>
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    use sentry::integrations::tracing::{BreadcrumbLayer, ErrorLayer};
    ErrorLayer::new()
        .with_filter(LevelFilter::ERROR)
        .and_then(BreadcrumbLayer::new().with_filter(LevelFilter::INFO))
}

/// A path segment that looks like a secret (invite and feed tokens are long random strings).
fn tokenish(segment: &str) -> bool {
    let core = segment.split('.').next().unwrap_or(segment);
    core.len() >= 20
        && core
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && uuid::Uuid::parse_str(core).is_err()
}

pub fn mask_path(path: &str) -> String {
    path.split('/')
        .map(|s| if tokenish(s) { "[token]" } else { s })
        .collect::<Vec<_>>()
        .join("/")
}

/// Keeps what helps debugging (method, masked URL, user id) and drops everything personal.
pub fn scrub(mut event: Event<'static>) -> Event<'static> {
    if let Some(req) = event.request.take() {
        let url = req.url.map(|mut u| {
            u.set_query(None);
            let path = mask_path(u.path());
            u.set_path(&path);
            u
        });
        event.request = Some(Request {
            url,
            method: req.method,
            ..Default::default()
        });
    }
    if let Some(user) = event.user.take() {
        event.user = Some(sentry::User {
            id: user.id,
            ..Default::default()
        });
    }
    event
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_tokens_but_not_ids() {
        assert_eq!(
            mask_path("/v1/invites/Zm9vYmFyYmF6cXV4cXV1eDEyMzQ1/accept"),
            "/v1/invites/[token]/accept"
        );
        assert_eq!(
            mask_path("/download/abcdefghijklmnopqrstuvwxyz012345.csv"),
            "/download/[token]"
        );
        assert_eq!(
            mask_path("/v1/clubs/0195f3a0-1111-7000-8000-000000000000/races"),
            "/v1/clubs/0195f3a0-1111-7000-8000-000000000000/races"
        );
    }

    #[test]
    fn scrub_drops_personal_data() {
        let event = Event {
            request: Some(Request {
                url: "https://qa.runflow.club/api/v1/invites/Zm9vYmFyYmF6cXV4cXV1eDEyMzQ1?email=ana@email.com"
                    .parse()
                    .ok(),
                method: Some("POST".into()),
                cookies: Some("rf_session=secret".into()),
                headers: [("authorization".to_string(), "Bearer secret".to_string())].into(),
                data: Some(r#"{"email":"ana@email.com"}"#.into()),
                query_string: Some("email=ana@email.com".into()),
                ..Default::default()
            }),
            user: Some(sentry::User {
                id: Some("u-1".into()),
                email: Some("ana@email.com".into()),
                ip_address: Some(sentry::protocol::IpAddress::Auto),
                ..Default::default()
            }),
            ..Default::default()
        };
        let clean = scrub(event);
        let req = clean.request.unwrap();
        assert_eq!(
            req.url.unwrap().as_str(),
            "https://qa.runflow.club/api/v1/invites/[token]"
        );
        assert_eq!(req.method.as_deref(), Some("POST"));
        assert!(
            req.cookies.is_none()
                && req.headers.is_empty()
                && req.data.is_none()
                && req.query_string.is_none()
        );
        let user = clean.user.unwrap();
        assert_eq!(user.id.as_deref(), Some("u-1"));
        assert!(user.email.is_none() && user.ip_address.is_none());
    }

    #[test]
    fn error_logs_become_scrubbed_events_with_breadcrumbs() {
        use tracing_subscriber::prelude::*;
        let subscriber = tracing_subscriber::registry().with(layer());
        let events = tracing::subscriber::with_default(subscriber, || {
            sentry::test::with_captured_events_options(
                || {
                    sentry::configure_scope(|s| {
                        s.set_user(Some(sentry::User {
                            id: Some("u-1".into()),
                            email: Some("ana@email.com".into()),
                            ..Default::default()
                        }))
                    });
                    tracing::info!("job claimed");
                    tracing::warn!("retrying");
                    tracing::error!(job = 7, "job failed for good");
                    tracing::warn!("not an event");
                },
                sentry::ClientOptions::new().before_send(|e| Some(scrub(e))),
            )
        });
        assert_eq!(events.len(), 1);
        let e = &events[0];
        assert_eq!(e.message.as_deref(), Some("job failed for good"));
        assert_eq!(e.breadcrumbs.len(), 2);
        let user = e.user.as_ref().unwrap();
        assert_eq!(user.id.as_deref(), Some("u-1"));
        assert!(user.email.is_none());
    }
}
