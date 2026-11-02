//! Outbound integrations. Each one is configured from the environment by the binary and exposes a
//! small, provider-neutral API to the rest of the backend.

pub mod email;
pub mod google;
pub mod secrets;
pub mod storage;
pub mod strava;
