//! Routes, one module per section of `api/endpoints.md`.

pub mod assessments;
pub mod athletes;
pub mod auth;
pub mod calendar;
pub mod clubs;
pub mod dev;
pub mod health;
pub mod invites;
pub mod library;
pub mod me;
pub mod members;
pub mod messages;
pub mod my;
pub mod plans;
pub mod providers;
pub mod races;
pub mod threads;
pub mod weeks;
pub mod workouts;

use axum::Router;

use crate::AppState;

/// Everything under `/v1`.
pub fn v1() -> Router<AppState> {
    Router::new()
        .merge(health::routes())
        .merge(auth::routes())
        .merge(clubs::routes())
        .merge(invites::routes())
        .merge(library::routes())
        .merge(members::routes())
        .merge(messages::routes())
        .merge(workouts::routes())
        .merge(weeks::routes())
        .merge(plans::routes())
        .merge(races::routes())
        .merge(assessments::routes())
        .merge(my::routes())
        .merge(threads::routes())
        .merge(calendar::routes())
        .merge(athletes::routes())
        .merge(providers::routes())
        .merge(me::routes())
        .merge(dev::routes())
}
