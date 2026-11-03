//! Pure domain types and rules: no I/O, no database, no HTTP. Ported logic that must match the apps
//! (and is proven by shared fixtures) lives here.

pub mod assessment;
pub mod assistant;
pub mod color;
pub mod notify;
pub mod plans;
pub mod tags;
pub mod week;
pub mod workout;
pub mod workout_text;
