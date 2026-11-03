//! RFC 9457 problem+json, exactly like the mock (api/endpoints.md § Conventions):
//! `title`/`detail` in pt-BR for people (D-013), a stable English `code` for the apps.

use std::borrow::Cow;

use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FieldError {
    pub field: Cow<'static, str>,
    pub message: Cow<'static, str>,
}

/// An API error. Boxed: it travels in every handler's `Result`, and errors are the cold path.
#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct Problem(Box<ProblemBody>);

#[derive(Debug, Clone, Serialize)]
pub struct ProblemBody {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub status: u16,
    pub code: Cow<'static, str>,
    pub title: Cow<'static, str>,
    pub detail: Cow<'static, str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<FieldError>,
    /// Sent as a `Retry-After` header (seconds), not in the body.
    #[serde(skip)]
    pub retry_after: Option<u64>,
}

pub type ApiResult<T> = Result<T, Problem>;

impl Problem {
    pub fn new(
        status: StatusCode,
        code: impl Into<Cow<'static, str>>,
        title: impl Into<Cow<'static, str>>,
        detail: impl Into<Cow<'static, str>>,
    ) -> Self {
        Self(Box::new(ProblemBody {
            kind: "about:blank",
            status: status.as_u16(),
            code: code.into(),
            title: title.into(),
            detail: detail.into(),
            errors: Vec::new(),
            retry_after: None,
        }))
    }

    pub fn body(&self) -> &ProblemBody {
        &self.0
    }

    pub fn with_retry_after(mut self, seconds: u64) -> Self {
        self.0.retry_after = Some(seconds);
        self
    }

    /// 422 for a single field.
    pub fn field(field: &'static str, message: impl Into<Cow<'static, str>>) -> Self {
        Self::invalid(vec![FieldError {
            field: field.into(),
            message: message.into(),
        }])
    }

    pub fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "auth.required",
            "Entre para continuar",
            "Sua sessão expirou ou você ainda não entrou.",
        )
    }

    pub fn invalid_json() -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "request.invalid_json",
            "Requisição inválida",
            "O corpo da requisição não é um JSON válido.",
        )
    }

    pub fn too_large() -> Self {
        Self::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "request.too_large",
            "Arquivo muito grande",
            "O limite é 10 MB.",
        )
    }

    /// Same answer as the mock's `ctx.member()` for clubs the caller isn't in.
    pub fn club_not_found() -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "club.not_found",
            "Clube não encontrado",
            "Você não participa deste clube.",
        )
    }

    /// 422 with per-field messages (pt-BR).
    pub fn invalid(errors: Vec<FieldError>) -> Self {
        let mut p = Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation.failed",
            "Confira os campos",
            "Alguns campos precisam de ajuste.",
        );
        p.0.errors = errors;
        p
    }

    pub fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "Algo deu errado",
            "Tente novamente em instantes.",
        )
    }

    pub fn route_not_found(method: &str, path: &str) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "route.not_found",
            "Rota não encontrada",
            format!("{method} {path} não existe nesta API."),
        )
    }

    pub fn method_not_allowed(method: &str, path: &str) -> Self {
        Self::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "route.method_not_allowed",
            "Método não permitido",
            format!("{path} não aceita {method}."),
        )
    }

    pub fn timeout() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "request.timeout",
            "Demorou demais",
            "O servidor não respondeu a tempo. Tente novamente.",
        )
    }
}

impl IntoResponse for Problem {
    fn into_response(self) -> Response {
        let status =
            StatusCode::from_u16(self.0.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let self_retry = self.0.retry_after;
        let mut res = (status, Json(self)).into_response();
        res.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json; charset=utf-8"),
        );
        if let Some(s) = self_retry {
            res.headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from(s));
        }
        res
    }
}

/// Unexpected database errors: logged in English, answered as a generic pt-BR 500.
impl From<sqlx::Error> for Problem {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!(error = %err, "database error");
        Self::internal()
    }
}

/// Redis errors where Redis holds the data itself (sign-in codes); caches fall back to Postgres instead.
impl From<runflow_kv::Error> for Problem {
    fn from(err: runflow_kv::Error) -> Self {
        tracing::error!(error = %err, "redis error");
        Self::internal()
    }
}
