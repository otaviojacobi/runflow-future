//! The HTTP API. Implements `api/endpoints.md` (the contract) route by route under `/v1`.

pub mod access;
pub mod body;
pub mod problem;
pub mod routes;
pub mod session;
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
use runflow_integrations::storage::Storage;
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
    pub auth: AuthSettings,
}

#[derive(Clone)]
pub struct AuthSettings {
    /// HMAC key for e-mail codes (`SESSION_SECRET`).
    pub secret: Vec<u8>,
    /// Sessions live this long after their last use.
    pub session_ttl: chrono::Duration,
    pub cookie_domain: Option<String>,
    /// `Secure` cookies (HTTPS deployments).
    pub cookie_secure: bool,
    /// Development with e-mails in the log: answer `dev_code` and serve `/v1/mock/outbox`, like the mock.
    pub dev_affordances: bool,
}

/// Never prints the secret.
impl std::fmt::Debug for AuthSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthSettings")
            .field("session_ttl", &self.session_ttl)
            .field("cookie_domain", &self.cookie_domain)
            .field("cookie_secure", &self.cookie_secure)
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
}

impl AppState {
    pub fn new(
        db: Pool,
        settings: ApiSettings,
        mailer: Mailer,
        google: Option<GoogleVerifier>,
        storage: Storage,
    ) -> Self {
        Self {
            db,
            settings: Arc::new(settings),
            mailer,
            google: google.map(Arc::new),
            storage,
        }
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
        .nest("/v1", v1)
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .layer(
            ServiceBuilder::new()
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
