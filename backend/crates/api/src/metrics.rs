//! Request metrics (S13): duration by route template, method and status (OpenTelemetry's HTTP server semantic
//! conventions), through the global meter: no-ops until the binary installs an exporter. Route templates keep the
//! number of series small (`/v1/clubs/{club_id}/races`, never ids).

use std::sync::LazyLock;
use std::time::Instant;

use axum::extract::{MatchedPath, Request};
use axum::middleware::Next;
use axum::response::Response;
use opentelemetry::KeyValue;
use opentelemetry::metrics::{Counter, Histogram};

static CACHE: LazyLock<Counter<u64>> = LazyLock::new(|| {
    opentelemetry::global::meter("runflow.api")
        .u64_counter("runflow.cache.lookups")
        .with_description(
            "Redis cache lookups (D-047) by cache and result: hit, miss, or error (answered from Postgres)",
        )
        .build()
});

/// One lookup in a Redis cache (`session`, `dashboard`, `reports`): `hit`, `miss` or `error`.
pub fn cache_lookup(cache: &'static str, result: &'static str) {
    CACHE.add(
        1,
        &[
            KeyValue::new("cache", cache),
            KeyValue::new("result", result),
        ],
    );
}

static DURATION: LazyLock<Histogram<f64>> = LazyLock::new(|| {
    opentelemetry::global::meter("runflow.api")
        .f64_histogram("http.server.request.duration")
        .with_unit("s")
        .with_description("Time to answer an API request")
        .with_boundaries(vec![
            0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
        ])
        .build()
});

pub async fn track(route: Option<MatchedPath>, req: Request, next: Next) -> Response {
    let started = Instant::now();
    let method = req.method().as_str().to_string();
    let route = route.map_or_else(|| "unmatched".to_string(), |r| r.as_str().to_string());
    let res = next.run(req).await;
    DURATION.record(
        started.elapsed().as_secs_f64(),
        &[
            KeyValue::new("http.request.method", method),
            KeyValue::new("http.route", route),
            KeyValue::new(
                "http.response.status_code",
                i64::from(res.status().as_u16()),
            ),
        ],
    );
    res
}
