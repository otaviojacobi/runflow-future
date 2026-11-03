//! Worker metrics (S13): jobs run by kind and outcome, how long they took, and the queue's backlog. Recorded
//! through the global OpenTelemetry meter: no-ops until the binary installs an exporter (`OTEL_EXPORTER_OTLP_ENDPOINT`).

use std::sync::LazyLock;
use std::time::Duration;

use opentelemetry::KeyValue;
use opentelemetry::metrics::{Counter, Gauge, Histogram};

use crate::JobError;

struct Instruments {
    runs: Counter<u64>,
    duration: Histogram<f64>,
    due: Gauge<u64>,
    oldest: Gauge<f64>,
}

static M: LazyLock<Instruments> = LazyLock::new(|| {
    let m = opentelemetry::global::meter("runflow.worker");
    Instruments {
        runs: m
            .u64_counter("runflow.jobs.runs")
            .with_description("Jobs run, by kind and outcome (ok, retry, failed)")
            .build(),
        duration: m
            .f64_histogram("runflow.jobs.duration")
            .with_unit("s")
            .with_boundaries(vec![0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 15.0, 60.0])
            .build(),
        due: m
            .u64_gauge("runflow.jobs.due")
            .with_description("Jobs waiting to run now")
            .build(),
        oldest: m
            .f64_gauge("runflow.jobs.oldest_due")
            .with_unit("s")
            .with_description("How long the oldest due job has waited")
            .build(),
    }
});

pub(crate) fn job_ran(kind: &str, took: Duration, result: &Result<(), JobError>) {
    let outcome = match result {
        Ok(()) => "ok",
        Err(e) if e.retry => "retry",
        Err(_) => "failed",
    };
    let attrs = [
        KeyValue::new("job.kind", kind.to_string()),
        KeyValue::new("job.outcome", outcome),
    ];
    M.runs.add(1, &attrs);
    M.duration.record(took.as_secs_f64(), &attrs[..1]);
}

pub(crate) fn backlog(due: i64, oldest_s: f64) {
    M.due.record(due.max(0) as u64, &[]);
    M.oldest.record(oldest_s, &[]);
}
