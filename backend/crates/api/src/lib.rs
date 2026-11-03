//! The HTTP API. Implements `api/endpoints.md` (the contract) route by route under `/v1`.

pub mod access;
pub mod body;
pub mod metrics;
pub mod problem;
pub mod routes;
pub mod session;
pub mod time;
pub mod uploads;

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::{DefaultBodyLimit, Request};
use axum::http::{HeaderName, HeaderValue, Method, header};
use axum::response::{IntoResponse, Response};
use runflow_db::Pool;
use runflow_integrations::email::Mailer;
use runflow_integrations::google::GoogleVerifier;
use runflow_integrations::secrets::TokenCipher;
use runflow_integrations::storage::Storage;
use runflow_integrations::strava::StravaClient;
use runflow_integrations::stripe::StripeClient;
use tower::ServiceBuilder;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

pub use problem::{ApiResult, FieldError, Problem};

/// What the API needs from the configuration.
#[derive(Debug, Clone)]
pub struct ApiSettings {
    /// Reported by `/v1/health`.
    pub version: &'static str,
    /// Origins allowed to call the API from a browser (the web app, Expo web).
    pub cors_origins: Vec<String>,
    pub request_timeout: Duration,
    /// Largest request body (uploads arrive as data URLs; the mock allows 12 MB).
    pub body_limit: usize,
    /// Where people open the web app (links in e-mails).
    pub public_app_url: String,
    /// Where the API is reachable from outside (calendar feed URLs).
    pub public_api_url: String,
    /// Strava webhook subscription check (`STRAVA_WEBHOOK_VERIFY_TOKEN`).
    pub strava_verify_token: Option<String>,
    /// Club sites (S9b, D-029): `<subdomain><suffix>` serves that club, e.g. `-qa.runflow.club` (QA) or
    /// `.runflow.club` (production). None = no club hosts.
    pub club_host_suffix: Option<String>,
    /// Also match club hosts by slug (QA: every club gets a site while subdomains are Pro and billing isn't live).
    pub club_host_by_slug: bool,
    pub billing: BillingSettings,
    /// The VAPID public key for Web Push (`/public/config`); None = push off.
    pub push_public_key: Option<String>,
    /// The web app's Sentry settings (`/public/config`); None = off.
    pub web_sentry: Option<WebSentry>,
    pub auth: AuthSettings,
}

/// What the web app needs to report its errors to Sentry (browser DSNs are public by design).
#[derive(Debug, Clone, serde::Serialize)]
pub struct WebSentry {
    pub dsn: String,
    pub environment: String,
    pub release: String,
}

/// Billing (D-016): Stripe when its key and Pro price are set; otherwise the simulation (dev and QA, like the
/// mock's `/dev/stripe` pages) when allowed, or no checkout at all.
#[derive(Clone, Default)]
pub struct BillingSettings {
    /// `BILLING_SIMULATION`: owners "pay" on Runflow's own test pages, nothing is charged.
    pub simulation: bool,
    /// `STRIPE_PRICE_PRO_MONTHLY`.
    pub price_pro: Option<String>,
    /// `STRIPE_WEBHOOK_SECRET`: without it `/webhooks/stripe` answers 404.
    pub webhook_secret: Option<String>,
}

impl std::fmt::Debug for BillingSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BillingSettings")
            .field("simulation", &self.simulation)
            .field("price_pro", &self.price_pro)
            .field(
                "webhook_secret",
                &self.webhook_secret.as_ref().map(|_| "***"),
            )
            .finish()
    }
}

#[derive(Clone)]
pub struct AuthSettings {
    /// HMAC key for e-mail codes (`SESSION_SECRET`).
    pub secret: Vec<u8>,
    /// Sessions live this long after their last use.
    pub session_ttl: chrono::Duration,
    /// Session cookie name (`COOKIE_NAME`, default `rf_session`): distinct per environment.
    pub cookie_name: String,
    pub cookie_domain: Option<String>,
    /// `Secure` cookies (HTTPS deployments).
    pub cookie_secure: bool,
    /// Development with e-mails in the log: answer `dev_code` and serve `/v1/mock/outbox`, like the mock.
    pub dev_affordances: bool,
    /// `SMOKE_KEY` (D-034): with it in `X-Smoke-Key`, sign-in for `@smoke.runflow.club` answers the code.
    pub smoke_key: Option<String>,
}

/// Never prints the secret.
impl std::fmt::Debug for AuthSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthSettings")
            .field("session_ttl", &self.session_ttl)
            .field("cookie_name", &self.cookie_name)
            .field("cookie_domain", &self.cookie_domain)
            .field("cookie_secure", &self.cookie_secure)
            .field("smoke_key", &self.smoke_key.as_ref().map(|_| "<set>"))
            .field("dev_affordances", &self.dev_affordances)
            .finish_non_exhaustive()
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: Pool,
    pub settings: Arc<ApiSettings>,
    pub mailer: Mailer,
    /// `None` when Google sign-in isn't configured (`GOOGLE_CLIENT_ID`).
    pub google: Option<Arc<GoogleVerifier>>,
    /// Uploaded files (logos, avatars): disk or S3 (D-010).
    pub storage: Storage,
    /// `None` when Strava isn't configured (`STRAVA_CLIENT_ID`/`SECRET`).
    pub strava: Option<Arc<StravaClient>>,
    /// Encrypts provider tokens at rest (`ENCRYPTION_KEY`).
    pub cipher: TokenCipher,
    /// `None` when Stripe isn't configured (`STRIPE_SECRET_KEY`).
    pub stripe: Option<Arc<StripeClient>>,
}

impl AppState {
    pub fn new(
        db: Pool,
        settings: ApiSettings,
        mailer: Mailer,
        google: Option<GoogleVerifier>,
        storage: Storage,
        cipher: TokenCipher,
    ) -> Self {
        Self {
            db,
            settings: Arc::new(settings),
            mailer,
            google: google.map(Arc::new),
            storage,
            strava: None,
            cipher,
            stripe: None,
        }
    }

    pub fn with_stripe(mut self, client: StripeClient) -> Self {
        self.stripe = Some(Arc::new(client));
        self
    }

    pub fn with_strava(mut self, client: StravaClient) -> Self {
        self.strava = Some(Arc::new(client));
        self
    }
}

const REQUEST_ID: HeaderName = HeaderName::from_static("x-request-id");

pub fn router(state: AppState) -> Router {
    let settings = state.settings.clone();
    let v1 = routes::v1();

    let cors_origins: Vec<HeaderValue> = settings
        .cors_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(cors_origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::IF_NONE_MATCH,
            HeaderName::from_static("x-client"),
        ])
        .expose_headers([header::ETAG, REQUEST_ID])
        .allow_credentials(true)
        .max_age(Duration::from_secs(600));

    Router::new()
        .nest("/v1", v1.route_layer(axum::middleware::from_fn(metrics::track)))
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .layer(
            ServiceBuilder::new()
                // Errors to Sentry (S12): one hub per request (its user and request), off without SENTRY_DSN.
                .layer(sentry::integrations::tower::NewSentryLayer::<Request>::new_from_top())
                .layer(sentry::integrations::tower::SentryHttpLayer::new())
                .layer(SetRequestIdLayer::new(REQUEST_ID, MakeRequestUuid))
                .layer(TraceLayer::new_for_http().make_span_with(|req: &Request| {
                    let id = req.headers().get(REQUEST_ID).and_then(|v| v.to_str().ok()).unwrap_or("-");
                    tracing::info_span!("http", method = %req.method(), path = %req.uri().path(), request_id = %id)
                }))
                .layer(PropagateRequestIdLayer::new(REQUEST_ID))
                .layer(CatchPanicLayer::custom(|_| Problem::internal().into_response()))
                .layer(cors)
                .layer(CompressionLayer::new())
                .layer(DefaultBodyLimit::max(settings.body_limit))
                .layer(axum::middleware::map_response(timeout_as_problem))
                .layer(TimeoutLayer::with_status_code(axum::http::StatusCode::SERVICE_UNAVAILABLE, settings.request_timeout)),
        )
        .with_state(state)
}

async fn not_found(req: Request) -> Problem {
    Problem::route_not_found(req.method().as_str(), req.uri().path())
}

async fn method_not_allowed(req: Request) -> Problem {
    Problem::method_not_allowed(req.method().as_str(), req.uri().path())
}

/// The timeout layer answers with an empty 503; give it the pt-BR problem body.
async fn timeout_as_problem(res: Response) -> Response {
    if res.status() == axum::http::StatusCode::SERVICE_UNAVAILABLE
        && !res.headers().contains_key(header::CONTENT_TYPE)
    {
        return Problem::timeout().into_response();
    }
    res
}
