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

#[derive(Debug, Clone, Serialize)]
pub struct Problem {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub status: u16,
    pub code: Cow<'static, str>,
    pub title: Cow<'static, str>,
    pub detail: Cow<'static, str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<FieldError>,
}

pub type ApiResult<T> = Result<T, Problem>;

impl Problem {
    pub fn new(
        status: StatusCode,
        code: impl Into<Cow<'static, str>>,
        title: impl Into<Cow<'static, str>>,
        detail: impl Into<Cow<'static, str>>,
    ) -> Self {
        Self {
            kind: "about:blank",
            status: status.as_u16(),
            code: code.into(),
            title: title.into(),
            detail: detail.into(),
            errors: Vec::new(),
        }
    }

    /// 422 with per-field messages (pt-BR).
    pub fn invalid(errors: Vec<FieldError>) -> Self {
        Self {
            errors,
            ..Self::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation.failed",
                "Confira os campos",
                "Alguns campos precisam de ajuste.",
            )
        }
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
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let mut res = (status, Json(self)).into_response();
        res.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json; charset=utf-8"),
        );
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
