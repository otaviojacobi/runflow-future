//! Routes, one module per section of `api/endpoints.md`.

pub mod auth;
pub mod clubs;
pub mod dev;
pub mod health;
pub mod me;

use axum::Router;

use crate::AppState;

/// Everything under `/v1`.
pub fn v1() -> Router<AppState> {
    Router::new()
        .merge(health::routes())
        .merge(auth::routes())
        .merge(clubs::routes())
        .merge(me::routes())
        .merge(dev::routes())
}
