//! Telemetry (S13, D-033, D-040): traces, metrics and logs pushed over OTLP/HTTP (protobuf) to any OpenTelemetry
//! backend: Grafana Cloud's OTLP gateway in QA and production. Pushing (not scraping) works the same on the Pi and
//! on Lambda. Off without `OTEL_EXPORTER_OTLP_ENDPOINT`; logs always go to stdout as well.

use std::collections::HashMap;
use std::time::Duration;

use anyhow::Context;
use opentelemetry::KeyValue;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{
    LogExporter, MetricExporter, SpanExporter, WithExportConfig, WithHttpConfig,
};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::metrics::{PeriodicReader, SdkMeterProvider};
use opentelemetry_sdk::trace::{Sampler, SdkTracerProvider};
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::{EnvFilter, Layer};

use crate::config::Otel;

/// What the exporter's own HTTP stack logs never goes back into the exporter (it would feed itself).
const QUIET: &str = "info,hyper=off,hyper_util=off,reqwest=off,h2=off,opentelemetry=off,opentelemetry_sdk=off,opentelemetry_otlp=off";

pub struct Telemetry {
    tracer: SdkTracerProvider,
    meter: SdkMeterProvider,
    logger: SdkLoggerProvider,
}

/// `k1=v1,k2=v2` (values URL-decoded), as in `OTEL_EXPORTER_OTLP_HEADERS`.
pub fn parse_headers(raw: &str) -> HashMap<String, String> {
    let decode = |s: &str| {
        let bytes = s.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%'
                && let Some(Ok(b)) = s.get(i + 1..i + 3).map(|h| u8::from_str_radix(h, 16))
            {
                out.push(b);
                i += 3;
                continue;
            }
            out.push(bytes[i]);
            i += 1;
        }
        String::from_utf8_lossy(&out).into_owned()
    };
    raw.split(',')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), decode(v.trim())))
        .filter(|(k, _)| !k.is_empty())
        .collect()
}

impl Telemetry {
    /// Exporters for the three signals; `process` tells the API, the worker and `all` apart.
    pub fn init(o: &Otel, version: &str, environment: &str, process: &str) -> anyhow::Result<Self> {
        let base = o.endpoint.trim_end_matches('/');
        let headers = parse_headers(o.headers.as_ref().map_or("", |h| h.expose()));
        let resource = Resource::builder()
            .with_service_name(o.service_name.clone())
            .with_attributes([
                KeyValue::new("service.version", version.to_string()),
                KeyValue::new("deployment.environment.name", environment.to_string()),
                KeyValue::new("runflow.process", process.to_string()),
            ])
            .build();
        let timeout = Duration::from_secs(10);

        let spans = SpanExporter::builder()
            .with_http()
            .with_endpoint(format!("{base}/v1/traces"))
            .with_headers(headers.clone())
            .with_timeout(timeout)
            .build()
            .context("OTLP trace exporter")?;
        let tracer = SdkTracerProvider::builder()
            .with_batch_exporter(spans)
            .with_sampler(Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(
                o.traces_ratio,
            ))))
            .with_resource(resource.clone())
            .build();

        let metrics = MetricExporter::builder()
            .with_http()
            .with_endpoint(format!("{base}/v1/metrics"))
            .with_headers(headers.clone())
            .with_timeout(timeout)
            .build()
            .context("OTLP metric exporter")?;
        let meter = SdkMeterProvider::builder()
            .with_reader(
                PeriodicReader::builder(metrics)
                    .with_interval(o.metrics_interval)
                    .build(),
            )
            .with_resource(resource.clone())
            .build();
        opentelemetry::global::set_meter_provider(meter.clone());

        let logs = LogExporter::builder()
            .with_http()
            .with_endpoint(format!("{base}/v1/logs"))
            .with_headers(headers)
            .with_timeout(timeout)
            .build()
            .context("OTLP log exporter")?;
        let logger = SdkLoggerProvider::builder()
            .with_batch_exporter(logs)
            .with_resource(resource)
            .build();

        Ok(Self {
            tracer,
            meter,
            logger,
        })
    }

    /// The tracing layers: spans become traces, events become logs (with their trace ids).
    pub fn layer<S>(&self) -> impl Layer<S>
    where
        S: tracing::Subscriber + for<'a> LookupSpan<'a>,
    {
        let traces = tracing_opentelemetry::layer()
            .with_tracer(self.tracer.tracer("runflow"))
            .with_filter(EnvFilter::new(QUIET));
        let logs =
            opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge::new(&self.logger)
                .with_filter(EnvFilter::new(QUIET));
        traces.and_then(logs)
    }
}

/// The database pool's connections, observed at each export (a no-op while telemetry is off).
pub fn observe_pool(pool: runflow_db::Pool) {
    let meter = opentelemetry::global::meter("runflow");
    let _gauge = meter
        .u64_observable_gauge("db.client.connection.count")
        .with_description("Database connections by state")
        .with_callback(move |o| {
            let size = u64::from(pool.size());
            let idle = pool.num_idle() as u64;
            o.observe(
                size.saturating_sub(idle),
                &[KeyValue::new("db.client.connection.state", "used")],
            );
            o.observe(idle, &[KeyValue::new("db.client.connection.state", "idle")]);
        })
        .build();
}

impl Telemetry {
    /// Sends what's buffered now (tests; a Lambda would call it after each invocation).
    #[cfg(test)]
    pub fn flush(&self) {
        let _ = self.tracer.force_flush();
        let _ = self.meter.force_flush();
        let _ = self.logger.force_flush();
    }

    pub fn shutdown(self) {
        let _ = self.tracer.shutdown();
        let _ = self.meter.shutdown();
        let _ = self.logger.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::Router;
    use axum::body::Bytes;
    use axum::extract::State;
    use axum::http::{HeaderMap, Uri};
    use tracing_subscriber::prelude::*;

    use super::*;
    use crate::config::Secret;

    #[test]
    fn headers_like_the_otel_spec() {
        let h = parse_headers("Authorization=Basic%20MTIzOmFiYw==, x-scope = qa ,bad");
        assert_eq!(h["Authorization"], "Basic MTIzOmFiYw==");
        assert_eq!(h["x-scope"], "qa");
        assert_eq!(h.len(), 2);
    }

    type Seen = Arc<Mutex<Vec<(String, Option<String>, usize)>>>;

    /// All three signals reach an OTLP endpoint, with the configured headers.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn exports_traces_metrics_and_logs() {
        let seen: Seen = Arc::default();
        let app = Router::new()
            .fallback(
                |State(s): State<Seen>, uri: Uri, headers: HeaderMap, body: Bytes| async move {
                    let auth = headers
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_string);
                    s.lock()
                        .unwrap()
                        .push((uri.path().to_string(), auth, body.len()));
                    ""
                },
            )
            .with_state(seen.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let otel = Otel {
            endpoint,
            headers: Some(Secret::new("Authorization=Basic%20dGVzdA==")),
            service_name: "runflow-test".into(),
            traces_ratio: 1.0,
            metrics_interval: Duration::from_secs(60),
        };
        let t = Telemetry::init(&otel, "0.1.0+test", "test", "all").unwrap();
        let subscriber = tracing_subscriber::registry().with(t.layer());
        tracing::subscriber::with_default(subscriber, || {
            tracing::info_span!("http", method = "GET").in_scope(|| tracing::info!("served"));
        });
        opentelemetry::global::meter("runflow.test")
            .u64_counter("runflow.test.count")
            .build()
            .add(1, &[]);
        tokio::task::spawn_blocking(move || {
            t.flush();
            t.shutdown();
        })
        .await
        .unwrap();

        let seen = seen.lock().unwrap();
        for path in ["/v1/traces", "/v1/metrics", "/v1/logs"] {
            let hit = seen
                .iter()
                .find(|(p, _, _)| p == path)
                .unwrap_or_else(|| panic!("nothing on {path}: {seen:?}"));
            assert_eq!(hit.1.as_deref(), Some("Basic dGVzdA=="));
            assert!(hit.2 > 0);
        }
    }
}
