#!/usr/bin/env node
/**
 * QA's Grafana dashboards (D-041), written as code: an overview plus one dashboard per service. Grafana provisions the
 * JSON files this writes into ./dashboards (folder "Runflow"); edit here, then run `node dashboards.mjs`.
 * `--check` (part of `npm run check`) fails when a JSON file is out of date with this script.
 *
 * Metrics come from Alloy (../alloy.alloy): the API pushes OTLP (job="runflow"); Postgres, Valkey, Garage, the web
 * app's Caddy and the tunnel are scraped with job=<service>; cAdvisor gives job="containers"; the host is node_*.
 * Logs are in Loki with service=<compose service>. Internal tool: English (D-013).
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "dashboards");
const PROM = { type: "prometheus", uid: "prometheus" };
const LOKI = { type: "loki", uid: "loki" };

// ---------------------------------------------------------------- panel builders

const target = (q, i, ds) => {
  const t = typeof q === "string" ? { expr: q } : q;
  return {
    refId: String.fromCharCode(65 + i),
    datasource: ds,
    expr: t.expr,
    ...(t.legend ? { legendFormat: t.legend } : {}),
    ...(t.instant ? { instant: true } : {}),
  };
};

const thresholds = (steps) => ({
  mode: "absolute",
  steps: steps.map(([color, value]) => ({ color, value })),
});

const GREEN = [["green", null]];

/** Time series. `queries`: an expr or { expr, legend }; opts: unit, w, h, stack, min, max, decimals, desc. */
function ts(title, queries, o = {}) {
  return {
    type: "timeseries",
    title,
    ...(o.desc ? { description: o.desc } : {}),
    w: o.w ?? 12,
    h: o.h ?? 8,
    datasource: PROM,
    targets: [].concat(queries).map((q, i) => target(q, i, PROM)),
    fieldConfig: {
      defaults: {
        unit: o.unit ?? "short",
        ...(o.min !== undefined ? { min: o.min } : {}),
        ...(o.max !== undefined ? { max: o.max } : {}),
        ...(o.decimals !== undefined ? { decimals: o.decimals } : {}),
        custom: {
          lineWidth: 1,
          fillOpacity: o.stack ? 30 : 10,
          showPoints: "never",
          spanNulls: true,
          ...(o.stack ? { stacking: { mode: "normal", group: "A" } } : {}),
        },
      },
      overrides: [],
    },
    options: {
      legend: { displayMode: "list", placement: "bottom", showLegend: true },
      tooltip: { mode: "multi", sort: "desc" },
    },
  };
}

/**
 * Single number. opts: unit, w, h, steps ([[color, from], …]), decimals, mappings, text ("value" | "name"),
 * link (a dashboard uid to open), desc.
 */
function stat(title, query, o = {}) {
  return {
    type: "stat",
    title,
    ...(o.desc ? { description: o.desc } : {}),
    w: o.w ?? 4,
    h: o.h ?? 4,
    datasource: PROM,
    targets: [target(query, 0, PROM)],
    ...(o.link ? { links: [{ title: `Open ${title}`, url: `/d/${o.link}` }] } : {}),
    fieldConfig: {
      defaults: {
        unit: o.unit ?? "short",
        ...(o.decimals !== undefined ? { decimals: o.decimals } : {}),
        thresholds: thresholds(o.steps ?? GREEN),
        ...(o.mappings ? { mappings: o.mappings } : {}),
      },
      overrides: [],
    },
    options: {
      colorMode: o.steps ? "background" : "value",
      graphMode: o.graph === false ? "none" : "area",
      textMode: o.text ?? "value",
      justifyMode: "center",
      reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
    },
  };
}

/** Up/down tile: 1 → UP (green), 0 → DOWN (red). */
const UPDOWN = [
  {
    type: "value",
    options: { 0: { text: "DOWN", color: "red", index: 0 }, 1: { text: "UP", color: "green", index: 1 } },
  },
];
const up = (title, expr, o = {}) =>
  stat(title, expr, { steps: [["red", null], ["green", 1]], mappings: UPDOWN, graph: false, decimals: 0, ...o });

/** Horizontal bars of an instant query (top-N lists). */
function bars(title, query, o = {}) {
  return {
    type: "bargauge",
    title,
    ...(o.desc ? { description: o.desc } : {}),
    w: o.w ?? 12,
    h: o.h ?? 8,
    datasource: PROM,
    targets: [target({ ...(typeof query === "string" ? { expr: query } : query), instant: true }, 0, PROM)],
    fieldConfig: {
      defaults: {
        unit: o.unit ?? "short",
        ...(o.decimals !== undefined ? { decimals: o.decimals } : {}),
        thresholds: thresholds(o.steps ?? GREEN),
        color: { mode: o.steps ? "thresholds" : "continuous-BlYlRd" },
      },
      overrides: [],
    },
    options: {
      orientation: "horizontal",
      displayMode: "gradient",
      showUnfilled: true,
      valueMode: "color",
      reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
    },
  };
}

function logs(title, expr, o = {}) {
  return {
    type: "logs",
    title,
    w: o.w ?? 24,
    h: o.h ?? 10,
    datasource: LOKI,
    targets: [target(expr, 0, LOKI)],
    options: {
      showTime: true,
      wrapLogMessage: true,
      prettifyLogMessage: false,
      enableLogDetails: true,
      sortOrder: "Descending",
      dedupStrategy: "none",
    },
  };
}

function logVolume(title, expr, o = {}) {
  const p = ts(title, { expr, legend: o.legend ?? "{{detected_level}}" }, { stack: true, ...o });
  p.datasource = LOKI;
  p.targets = p.targets.map((t) => ({ ...t, datasource: LOKI }));
  p.type = "timeseries";
  p.fieldConfig.defaults.custom.drawStyle = "bars";
  return p;
}

const row = (title) => ({ type: "row", title });

// ---------------------------------------------------------------- layout and dashboard wrapper

/** Packs panels left to right on Grafana's 24-column grid; a row starts a new line. Ids follow the order. */
function layout(items) {
  let x = 0;
  let y = 0;
  let lineH = 0;
  return items.map((item, i) => {
    const { w = 24, h = 1, ...panel } = item;
    if (panel.type === "row") {
      y += lineH;
      x = 0;
      lineH = 0;
      const p = { id: i + 1, type: "row", title: panel.title, collapsed: false, gridPos: { h: 1, w: 24, x: 0, y }, panels: [] };
      y += 1;
      return p;
    }
    if (x + w > 24) {
      y += lineH;
      x = 0;
      lineH = 0;
    }
    const p = { id: i + 1, ...panel, gridPos: { h, w, x, y } };
    x += w;
    lineH = Math.max(lineH, h);
    return p;
  });
}

function dashboard({ uid, title, description, tags = [], templating = [], panels }) {
  return {
    uid,
    title,
    description,
    tags: ["runflow", "qa", ...tags],
    timezone: "America/Sao_Paulo",
    schemaVersion: 41,
    time: { from: "now-6h", to: "now" },
    refresh: "1m",
    editable: true,
    graphTooltip: 1,
    links: [
      { type: "dashboards", title: "Dashboards", tags: ["runflow"], asDropdown: true, keepTime: true, includeVars: false },
    ],
    templating: { list: templating },
    annotations: { list: [] },
    panels: layout(panels),
  };
}

// ---------------------------------------------------------------- shared queries

const HTTP = 'http_server_request_duration_seconds_count{job="runflow"}';
const HTTP_B = 'http_server_request_duration_seconds_bucket{job="runflow"}';
const RI = "$__rate_interval";
const quant = (q, by, metric, range = RI) =>
  `histogram_quantile(${q}, sum by (${["le", ...by].join(", ")}) (rate(${metric}[${range}])))`;
const WORKER_LOGS = '{service="api"} |= "\\"target\\":\\"runflow_jobs"';
const API_LOGS = '{service="api"} != "\\"target\\":\\"runflow_jobs"';

const UIDS = {
  overview: "runflow-qa",
  api: "runflow-api",
  worker: "runflow-worker",
  postgres: "runflow-postgres",
  valkey: "runflow-valkey",
  garage: "runflow-garage",
  web: "runflow-web",
  tunnel: "runflow-tunnel",
  host: "runflow-host",
};

// ---------------------------------------------------------------- the dashboards

const overview = dashboard({
  uid: UIDS.overview,
  title: "Runflow QA",
  description: "QA at a glance: every service's health (click a tile for its dashboard), the API, worker, host and logs.",
  panels: [
    row("Services (click a tile for its dashboard)"),
    up("API", '(count(target_info{job="runflow"}) > bool 0) or vector(0)', {
      w: 3,
      link: UIDS.api,
      desc: "UP while the API pushes metrics (every 30 s).",
    }),
    up("Worker", '(count(runflow_jobs_due) > bool 0) or vector(0)', {
      w: 3,
      link: UIDS.worker,
      desc: "UP while the worker reports its queue.",
    }),
    up("Postgres", 'max(pg_up{job="postgres"}) or vector(0)', { w: 3, link: UIDS.postgres }),
    up("Valkey", 'max(redis_up{job="valkey"}) or vector(0)', { w: 3, link: UIDS.valkey }),
    up("Garage", 'max(up{job="garage"}) or vector(0)', { w: 3, link: UIDS.garage }),
    up("Web (Caddy)", 'max(up{job="web"}) or vector(0)', { w: 3, link: UIDS.web }),
    stat("Tunnel connections", 'max(cloudflared_tunnel_ha_connections{job="cloudflared"}) or vector(0)', {
      w: 3,
      link: UIDS.tunnel,
      steps: [["red", null], ["orange", 1], ["green", 2]],
      graph: false,
      decimals: 0,
      desc: "Connections from the tunnel to Cloudflare's edge (normally 4).",
    }),
    stat("Host CPU", '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))', {
      w: 3,
      link: UIDS.host,
      unit: "percent",
      decimals: 0,
      steps: [["green", null], ["orange", 70], ["red", 90]],
    }),

    row("API"),
    ts("Requests per second, by status", { expr: `sum by (http_response_status_code) (rate(${HTTP}[${RI}]))`, legend: "{{http_response_status_code}}" }, { unit: "reqps" }),
    ts("p95 latency by route", { expr: quant(0.95, ["http_route"], HTTP_B), legend: "{{http_route}}" }, { unit: "s" }),
    stat("5xx errors (5 min)", `round(sum(increase(${HTTP.replace("}", ',http_response_status_code=~"5.."}')}[5m])) or vector(0))`, {
      w: 6,
      h: 6,
      decimals: 0,
      steps: [["green", null], ["red", 1]],
    }),
    stat("Requests in the last hour", `round(sum(increase(${HTTP}[1h])) or vector(0))`, { w: 6, h: 6, decimals: 0 }),
    bars("Busiest routes (1 h)", { expr: `round(topk(10, sum by (http_route) (increase(${HTTP}[1h]))))`, legend: "{{http_route}}" }, { h: 6, decimals: 0 }),

    row("Worker and database"),
    ts("Jobs by kind and outcome", { expr: "sum by (job_kind, job_outcome) (increase(runflow_jobs_runs_total[$__rate_interval]))", legend: "{{job_kind}} {{job_outcome}}" }, { w: 8 }),
    ts("Job queue", [
      { expr: "max(runflow_jobs_due)", legend: "due now" },
      { expr: "max(runflow_jobs_oldest_due_seconds)", legend: "oldest wait (s)" },
    ], { w: 8 }),
    ts("Database connections (API pool)", { expr: "sum by (db_client_connection_state) (db_client_connection_count)", legend: "{{db_client_connection_state}}" }, { w: 8 }),

    row("Host"),
    ts("CPU", '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[$__rate_interval])))', { w: 6, unit: "percent", min: 0, max: 100 }),
    ts("Memory", "100 * (1 - max(node_memory_MemAvailable_bytes) / max(node_memory_MemTotal_bytes))", { w: 6, unit: "percent", min: 0, max: 100 }),
    ts("Disk (/)", '100 * (1 - max(node_filesystem_avail_bytes{mountpoint="/"}) / max(node_filesystem_size_bytes{mountpoint="/"}))', { w: 6, unit: "percent", min: 0, max: 100 }),
    ts("Temperature", "max(node_thermal_zone_temp) or max(node_hwmon_temp_celsius)", { w: 6, unit: "celsius" }),

    row("Logs"),
    logVolume("Log volume by service", 'sum by (service) (count_over_time({environment="qa"}[$__auto]))', { w: 24, legend: "{{service}}" }),
    logs("API errors and warnings", '{service="api"} | detected_level=~"error|warn"'),
    logs("API logs", '{service="api"}'),
  ],
});

const api = dashboard({
  uid: UIDS.api,
  title: "Runflow · API",
  description: "The Rust API (axum): traffic, latency and errors by route, the Valkey caches and the database pool.",
  tags: ["api"],
  panels: [
    row("Now"),
    stat("Requests per second (5 min)", `sum(rate(${HTTP}[5m])) or vector(0)`, { unit: "reqps", decimals: 2 }),
    stat("5xx rate (5 min)", `(sum(rate(${HTTP.replace("}", ',http_response_status_code=~"5.."}')}[5m])) or vector(0)) / clamp_min(sum(rate(${HTTP}[5m])), 1e-9)`, {
      unit: "percentunit",
      decimals: 1,
      steps: [["green", null], ["orange", 0.01], ["red", 0.05]],
    }),
    stat("p95 latency (5 min)", quant(0.95, [], HTTP_B, "5m"), {
      unit: "s",
      steps: [["green", null], ["orange", 0.3], ["red", 1]],
    }),
    stat("Requests (24 h)", `round(sum(increase(${HTTP}[24h])) or vector(0))`, { decimals: 0 }),
    stat("Session cache hit rate (1 h)", 'sum(increase(runflow_cache_lookups_total{cache="session",result="hit"}[1h])) / clamp_min(sum(increase(runflow_cache_lookups_total{cache="session"}[1h])), 1e-9)', {
      unit: "percentunit",
      decimals: 0,
    }),
    stat("Version", { expr: 'max by (service_version) (target_info{job="runflow"})', legend: "{{service_version}}" }, {
      text: "name",
      graph: false,
      desc: "The running build (`/v1/health`).",
    }),

    row("Traffic"),
    ts("Requests per second, by status class", {
      expr: `sum by (class) (label_replace(rate(${HTTP}[${RI}]), "class", "\${1}xx", "http_response_status_code", "(.).."))`,
      legend: "{{class}}",
    }, { unit: "reqps", stack: true }),
    ts("Latency (all routes)", [
      { expr: quant(0.5, [], HTTP_B), legend: "p50" },
      { expr: quant(0.95, [], HTTP_B), legend: "p95" },
      { expr: quant(0.99, [], HTTP_B), legend: "p99" },
    ], { unit: "s" }),
    ts("p95 latency, 10 slowest routes", { expr: `topk(10, ${quant(0.95, ["http_route"], HTTP_B)})`, legend: "{{http_route}}" }, { unit: "s" }),
    ts("Requests per second, 10 busiest routes", { expr: `topk(10, sum by (http_route) (rate(${HTTP}[${RI}])))`, legend: "{{http_route}}" }, { unit: "reqps" }),
    bars("Busiest routes (24 h)", { expr: `round(topk(15, sum by (http_route) (increase(${HTTP}[24h]))))`, legend: "{{http_route}}" }, { h: 10, decimals: 0 }),
    bars("Slowest routes, p95 (24 h)", { expr: `topk(15, ${quant(0.95, ["http_route"], HTTP_B, "24h")})`, legend: "{{http_route}}" }, {
      h: 10,
      unit: "s",
      steps: [["green", null], ["orange", 0.3], ["red", 1]],
    }),

    row("Errors"),
    ts("4xx by route and status", {
      expr: `sum by (http_route, http_response_status_code) (increase(${HTTP.replace("}", ',http_response_status_code=~"4.."}')}[${RI}])) > 0`,
      legend: "{{http_response_status_code}} {{http_route}}",
    }, { desc: "401 on /v1/me is a signed-out visitor; 409/422 are validation answers." }),
    ts("5xx by route and status", {
      expr: `sum by (http_route, http_response_status_code) (increase(${HTTP.replace("}", ',http_response_status_code=~"5.."}')}[${RI}])) > 0`,
      legend: "{{http_response_status_code}} {{http_route}}",
    }, { desc: "Every 5xx also reaches Sentry (D-033)." }),

    row("Caches (Valkey, D-047) and database pool"),
    ts("Cache hit rate by cache", {
      expr: `sum by (cache) (rate(runflow_cache_lookups_total{result="hit"}[${RI}])) / sum by (cache) (rate(runflow_cache_lookups_total[${RI}]))`,
      legend: "{{cache}}",
    }, { w: 8, unit: "percentunit", min: 0, max: 1 }),
    ts("Cache lookups by result", { expr: `sum by (cache, result) (rate(runflow_cache_lookups_total[${RI}]))`, legend: "{{cache}} {{result}}" }, {
      w: 8,
      unit: "ops",
      desc: "`error` means Valkey didn't answer and the API used Postgres instead.",
    }),
    ts("Database pool connections", { expr: "sum by (db_client_connection_state) (db_client_connection_count)", legend: "{{db_client_connection_state}}" }, { w: 8 }),
    ts("Response size, p95 by route (top 10)", {
      expr: `topk(10, ${quant(0.95, ["http_route"], 'http_server_response_body_size_bytes_bucket{job="runflow"}')})`,
      legend: "{{http_route}}",
    }, { w: 24, unit: "bytes" }),

    row("Logs (without the worker's)"),
    logVolume("API log lines by level", `sum by (detected_level) (count_over_time(${API_LOGS} [$__auto]))`, { w: 24, h: 6 }),
    logs("Errors and warnings", `${API_LOGS} | detected_level=~"error|warn"`),
    logs("All API logs", API_LOGS),
  ],
});

const JOB_RUNS = "runflow_jobs_runs_total";
const worker = dashboard({
  uid: UIDS.worker,
  title: "Runflow · Worker",
  description: "Background jobs (e-mails, Strava, activity matching, week release, Stripe seats…): runs, failures, durations and the queue.",
  tags: ["worker"],
  panels: [
    row("Now"),
    stat("Jobs due now", "max(runflow_jobs_due) or vector(0)", { decimals: 0, steps: [["green", null], ["orange", 10], ["red", 50]] }),
    stat("Oldest due job waiting", "max(runflow_jobs_oldest_due_seconds) or vector(0)", {
      unit: "s",
      steps: [["green", null], ["orange", 60], ["red", 300]],
    }),
    stat("Runs (1 h)", `round(sum(increase(${JOB_RUNS}[1h])) or vector(0))`, { decimals: 0 }),
    stat("Retries (1 h)", `round(sum(increase(${JOB_RUNS}{job_outcome="retry"}[1h])) or vector(0))`, {
      decimals: 0,
      steps: [["green", null], ["orange", 1]],
    }),
    stat("Failed for good (24 h)", `round(sum(increase(${JOB_RUNS}{job_outcome="failed"}[24h])) or vector(0))`, {
      decimals: 0,
      steps: [["green", null], ["red", 1]],
      desc: "Jobs that ran out of retries; each also reaches Sentry.",
    }),
    stat("p95 job duration (1 h)", quant(0.95, [], "runflow_jobs_duration_seconds_bucket", "1h"), { unit: "s" }),

    row("Runs"),
    ts("Runs by kind", { expr: `sum by (job_kind) (increase(${JOB_RUNS}[${RI}]))`, legend: "{{job_kind}}" }, { stack: true, decimals: 0 }),
    ts("Runs by outcome", { expr: `sum by (job_outcome) (increase(${JOB_RUNS}[${RI}]))`, legend: "{{job_outcome}}" }, { stack: true, decimals: 0 }),
    ts("p95 duration by kind", { expr: quant(0.95, ["job_kind"], "runflow_jobs_duration_seconds_bucket"), legend: "{{job_kind}}" }, { unit: "s" }),
    ts("Queue", [
      { expr: "max(runflow_jobs_due)", legend: "due now" },
      { expr: "max(runflow_jobs_oldest_due_seconds)", legend: "oldest wait (s)" },
    ], { desc: "The worker wakes on NOTIFY; a growing wait means it's stuck or failing." }),
    bars("Runs by kind (24 h)", { expr: `round(sum by (job_kind) (increase(${JOB_RUNS}[24h])))`, legend: "{{job_kind}}" }, { decimals: 0 }),
    bars("Retries and failures by kind (24 h)", {
      expr: `round(sum by (job_kind, job_outcome) (increase(${JOB_RUNS}{job_outcome!="ok"}[24h]))) > 0`,
      legend: "{{job_kind}} {{job_outcome}}",
    }, { decimals: 0, steps: [["orange", null], ["red", 5]] }),

    row("Logs"),
    logs("Worker errors and warnings", `${WORKER_LOGS} | detected_level=~"error|warn"`),
    logs("Worker logs", WORKER_LOGS),
  ],
});

const PG = (m, extra = "") => `${m}{job="postgres",datname="$db"${extra}}`;
const postgres = dashboard({
  uid: UIDS.postgres,
  title: "Runflow · Postgres",
  description: "PostgreSQL 18 (Alloy's postgres exporter): connections, transactions, cache hits, size, locks and conflicts.",
  tags: ["postgres"],
  templating: [
    {
      name: "db",
      label: "Database",
      type: "query",
      datasource: PROM,
      query: { query: 'label_values(pg_database_size_bytes{job="postgres", datname!~"template.*|postgres"}, datname)', refId: "db" },
      definition: 'label_values(pg_database_size_bytes{job="postgres", datname!~"template.*|postgres"}, datname)',
      refresh: 1,
      current: { text: "runflow", value: "runflow" },
      includeAll: false,
      multi: false,
    },
  ],
  panels: [
    row("Now"),
    up("Postgres", 'max(pg_up{job="postgres"}) or vector(0)'),
    stat("Connections", `sum(${PG("pg_stat_database_numbackends")})`, { decimals: 0 }),
    stat("Max connections", 'max(pg_settings_max_connections{job="postgres"})', { decimals: 0, graph: false }),
    stat("Database size", `max(${PG("pg_database_size_bytes")})`, { unit: "bytes" }),
    stat("Cache hit rate (5 min)", `sum(rate(${PG("pg_stat_database_blks_hit")}[5m])) / clamp_min(sum(rate(${PG("pg_stat_database_blks_hit")}[5m])) + sum(rate(${PG("pg_stat_database_blks_read")}[5m])), 1e-9)`, {
      unit: "percentunit",
      decimals: 1,
      steps: [["red", null], ["orange", 0.9], ["green", 0.99]],
      desc: "Reads served from shared buffers; under 99% the working set no longer fits in memory.",
    }),
    stat("Longest open transaction", `max(${PG("pg_stat_activity_max_tx_duration")}) or vector(0)`, {
      unit: "s",
      steps: [["green", null], ["orange", 30], ["red", 300]],
    }),

    row("Activity"),
    ts("Connections by state", { expr: `sum by (state) (${PG("pg_stat_activity_count")}) > 0`, legend: "{{state}}" }, { stack: true, decimals: 0 }),
    ts("API pool connections", { expr: "sum by (db_client_connection_state) (db_client_connection_count)", legend: "{{db_client_connection_state}}" }, {
      decimals: 0,
      desc: "The API's sqlx pool, as the API reports it.",
    }),
    ts("Transactions per second", [
      { expr: `rate(${PG("pg_stat_database_xact_commit")}[${RI}])`, legend: "commit" },
      { expr: `rate(${PG("pg_stat_database_xact_rollback")}[${RI}])`, legend: "rollback" },
    ], { unit: "ops" }),
    ts("Rows per second", [
      { expr: `rate(${PG("pg_stat_database_tup_fetched")}[${RI}])`, legend: "fetched" },
      { expr: `rate(${PG("pg_stat_database_tup_inserted")}[${RI}])`, legend: "inserted" },
      { expr: `rate(${PG("pg_stat_database_tup_updated")}[${RI}])`, legend: "updated" },
      { expr: `rate(${PG("pg_stat_database_tup_deleted")}[${RI}])`, legend: "deleted" },
    ], { unit: "ops" }),
    ts("Cache hit rate", {
      expr: `rate(${PG("pg_stat_database_blks_hit")}[${RI}]) / (rate(${PG("pg_stat_database_blks_hit")}[${RI}]) + rate(${PG("pg_stat_database_blks_read")}[${RI}]))`,
      legend: "hit rate",
    }, { unit: "percentunit", max: 1 }),
    ts("Blocks read from disk per second", { expr: `rate(${PG("pg_stat_database_blks_read")}[${RI}])`, legend: "blocks read" }, { unit: "ops" }),

    row("Storage, locks and problems"),
    ts("Database size", { expr: `${PG("pg_database_size_bytes")}`, legend: "{{datname}}" }, { w: 8, unit: "bytes" }),
    ts("WAL size", { expr: 'pg_wal_size_bytes{job="postgres"}', legend: "WAL" }, { w: 8, unit: "bytes" }),
    ts("Temporary files written", { expr: `rate(${PG("pg_stat_database_temp_bytes")}[${RI}])`, legend: "temp bytes" }, {
      w: 8,
      unit: "Bps",
      desc: "Sorts and hashes that didn't fit in work_mem.",
    }),
    ts("Locks by mode", { expr: `sum by (mode) (${PG("pg_locks_count")}) > 0`, legend: "{{mode}}" }, { decimals: 0 }),
    ts("Deadlocks and conflicts", [
      { expr: `increase(${PG("pg_stat_database_deadlocks")}[${RI}])`, legend: "deadlocks" },
      { expr: `increase(${PG("pg_stat_database_conflicts")}[${RI}])`, legend: "conflicts" },
    ], { decimals: 0 }),

    row("Logs"),
    logs("Postgres logs", '{service="postgres"}'),
  ],
});

const VK = (m, extra = "") => `${m}{job="valkey"${extra}}`;
const valkey = dashboard({
  uid: UIDS.valkey,
  title: "Runflow · Valkey",
  description: "Valkey (D-047): sign-in codes, rate limits and the session/dashboard/report caches. No persistence; keys expire.",
  tags: ["valkey"],
  panels: [
    row("Now"),
    up("Valkey", `max(${VK("redis_up")}) or vector(0)`),
    stat("Memory used", `max(${VK("redis_memory_used_bytes")}) / max(${VK("redis_memory_max_bytes")})`, {
      unit: "percentunit",
      decimals: 0,
      steps: [["green", null], ["orange", 0.7], ["red", 0.9]],
      desc: "Of maxmemory (128 MB); past it, the least recently used keys with a TTL go first.",
    }),
    stat("Keys", `sum(${VK("redis_db_keys")}) or vector(0)`, { decimals: 0 }),
    stat("Hit rate (5 min)", `sum(rate(${VK("redis_keyspace_hits_total")}[5m])) / clamp_min(sum(rate(${VK("redis_keyspace_hits_total")}[5m])) + sum(rate(${VK("redis_keyspace_misses_total")}[5m])), 1e-9)`, {
      unit: "percentunit",
      decimals: 0,
    }),
    stat("Clients", `max(${VK("redis_connected_clients")})`, { decimals: 0 }),
    stat("Evicted keys (24 h)", `round(sum(increase(${VK("redis_evicted_keys_total")}[24h])) or vector(0))`, {
      decimals: 0,
      steps: [["green", null], ["orange", 1]],
      desc: "Keys dropped for memory; normal is zero.",
    }),

    row("Load"),
    ts("Commands per second", { expr: `rate(${VK("redis_commands_processed_total")}[${RI}])`, legend: "commands" }, { unit: "ops" }),
    ts("Commands per second, top 10", { expr: `topk(10, sum by (cmd) (rate(${VK("redis_commands_total")}[${RI}])))`, legend: "{{cmd}}" }, { unit: "ops" }),
    ts("Keyspace hits and misses", [
      { expr: `rate(${VK("redis_keyspace_hits_total")}[${RI}])`, legend: "hits" },
      { expr: `rate(${VK("redis_keyspace_misses_total")}[${RI}])`, legend: "misses" },
    ], { unit: "ops" }),
    ts("API cache results", { expr: `sum by (cache, result) (rate(runflow_cache_lookups_total[${RI}]))`, legend: "{{cache}} {{result}}" }, {
      unit: "ops",
      desc: "The API's view of the same caches (an `error` falls back to Postgres).",
    }),
    ts("Average time per command, top 10", {
      expr: `topk(10, sum by (cmd) (rate(${VK("redis_commands_duration_seconds_total")}[${RI}])) / sum by (cmd) (rate(${VK("redis_commands_total")}[${RI}])))`,
      legend: "{{cmd}}",
    }, { unit: "s" }),
    ts("Clients", { expr: VK("redis_connected_clients"), legend: "connected" }, { decimals: 0 }),

    row("Memory and keys"),
    ts("Memory", [
      { expr: VK("redis_memory_used_bytes"), legend: "used" },
      { expr: VK("redis_memory_used_rss_bytes"), legend: "resident (RSS)" },
      { expr: VK("redis_memory_max_bytes"), legend: "maxmemory" },
    ], { w: 8, unit: "bytes" }),
    ts("Keys", [
      { expr: `sum(${VK("redis_db_keys")})`, legend: "keys" },
      { expr: `sum(${VK("redis_db_keys_expiring")})`, legend: "with a TTL" },
    ], { w: 8, decimals: 0 }),
    ts("Expired and evicted keys", [
      { expr: `increase(${VK("redis_expired_keys_total")}[${RI}])`, legend: "expired" },
      { expr: `increase(${VK("redis_evicted_keys_total")}[${RI}])`, legend: "evicted" },
    ], { w: 8, decimals: 0 }),

    row("Logs"),
    logs("Valkey logs", '{service="valkey"}'),
  ],
});

const GA = (m, extra = "") => `${m}{job="garage"${extra}}`;
const garage = dashboard({
  uid: UIDS.garage,
  title: "Runflow · Garage (S3)",
  description: "Garage (D-037), the S3-compatible store for logos, avatars and activity files: requests, errors, latency, disk.",
  tags: ["garage"],
  panels: [
    row("Now"),
    up("Garage", `max(${GA("up")}) or vector(0)`),
    up("Cluster healthy", `max(${GA("cluster_healthy")}) or vector(0)`, {
      mappings: [{ type: "value", options: { 0: { text: "NO", color: "red", index: 0 }, 1: { text: "YES", color: "green", index: 1 } } }],
    }),
    stat("Disk free (data)", `max(${GA("garage_local_disk_avail", ',volume="data"')}) / max(${GA("garage_local_disk_total", ',volume="data"')})`, {
      unit: "percentunit",
      decimals: 0,
      steps: [["red", null], ["orange", 0.1], ["green", 0.2]],
    }),
    stat("Objects", `max(${GA("table_size", ',table_name="object"')})`, { decimals: 0 }),
    stat("S3 requests (24 h)", `round(sum(increase(${GA("api_s3_request_counter")}[24h])) or vector(0))`, { decimals: 0 }),
    stat("Blocks to resync", `max(${GA("block_resync_queue_length")}) + max(${GA("block_resync_errored_blocks")})`, {
      decimals: 0,
      steps: [["green", null], ["orange", 1]],
      desc: "Blocks waiting for or failing repair; normal is zero.",
    }),

    row("S3 API (the API's uploads and downloads)"),
    ts("Requests per second by endpoint", { expr: `sum by (api_endpoint) (rate(${GA("api_s3_request_counter")}[${RI}]))`, legend: "{{api_endpoint}}" }, { unit: "reqps", stack: true }),
    ts("Errors per second by status", { expr: `sum by (api_endpoint, status_code) (rate(${GA("api_s3_error_counter")}[${RI}])) > 0`, legend: "{{status_code}} {{api_endpoint}}" }, {
      unit: "reqps",
      desc: "A 404 on GetObject is a missing file (e.g. a removed logo).",
    }),
    ts("p95 latency by endpoint", { expr: quant(0.95, ["api_endpoint"], GA("api_s3_request_duration_bucket")), legend: "{{api_endpoint}}" }, { unit: "s" }),
    ts("Block bytes read and written", [
      { expr: `rate(${GA("block_bytes_read")}[${RI}])`, legend: "read" },
      { expr: `rate(${GA("block_bytes_written")}[${RI}])`, legend: "written" },
    ], { unit: "Bps" }),

    row("Storage"),
    ts("Disk free", { expr: GA("garage_local_disk_avail"), legend: "{{volume}}" }, { w: 8, unit: "bytes" }),
    ts("Table sizes", { expr: `${GA("table_size", ',table_name=~"object|version|block_ref|bucket_v2|key"')}`, legend: "{{table_name}}" }, { w: 8, decimals: 0 }),
    ts("Background queues", [
      { expr: GA("block_resync_queue_length"), legend: "resync" },
      { expr: `sum(${GA("table_gc_todo_queue_length")})`, legend: "table GC" },
      { expr: `sum(${GA("table_merkle_updater_todo_queue_length")})`, legend: "merkle updates" },
    ], { w: 8, decimals: 0 }),

    row("Logs"),
    logs("Garage logs (warnings and errors only, RUST_LOG=garage=warn)", '{service="garage"}'),
  ],
});

const CADDY = (m, extra = "") => `${m}{job="web",handler!="metrics"${extra}}`;
const web = dashboard({
  uid: UIDS.web,
  title: "Runflow · Web (Caddy)",
  description: "The web image's Caddy: the app shell and assets (mostly answered by Cloudflare's edge) and the /api proxy to the API.",
  tags: ["web"],
  panels: [
    row("Now"),
    up("Web", 'max(up{job="web"}) or vector(0)'),
    stat("Requests per second (5 min)", `sum(rate(${CADDY("caddy_http_request_duration_seconds_count")}[5m])) or vector(0)`, { unit: "reqps", decimals: 2 }),
    stat("5xx rate (5 min)", `(sum(rate(${CADDY("caddy_http_request_duration_seconds_count", ',code=~"5.."')}[5m])) or vector(0)) / clamp_min(sum(rate(${CADDY("caddy_http_request_duration_seconds_count")}[5m])), 1e-9)`, {
      unit: "percentunit",
      decimals: 1,
      steps: [["green", null], ["orange", 0.01], ["red", 0.05]],
    }),
    stat("p95 latency (5 min)", quant(0.95, [], CADDY("caddy_http_request_duration_seconds_bucket"), "5m"), { unit: "s" }),
    stat("In flight", `sum(${CADDY("caddy_http_requests_in_flight")})`, { decimals: 0 }),
    up("API upstream", 'min(caddy_reverse_proxy_upstreams_healthy{job="web"}) or vector(0)', {
      mappings: [{ type: "value", options: { 0: { text: "DOWN", color: "red", index: 0 }, 1: { text: "HEALTHY", color: "green", index: 1 } } }],
    }),

    row("Traffic"),
    ts("Requests per second by status", { expr: `sum by (code) (rate(${CADDY("caddy_http_request_duration_seconds_count")}[${RI}]))`, legend: "{{code}}" }, { unit: "reqps", stack: true }),
    ts("Requests per second by handler", { expr: `sum by (handler) (rate(${CADDY("caddy_http_request_duration_seconds_count")}[${RI}]))`, legend: "{{handler}}" }, {
      unit: "reqps",
      desc: "reverse_proxy is /api; file_server is the shell and assets.",
    }),
    ts("Latency", [
      { expr: quant(0.5, [], CADDY("caddy_http_request_duration_seconds_bucket")), legend: "p50" },
      { expr: quant(0.95, [], CADDY("caddy_http_request_duration_seconds_bucket")), legend: "p95" },
    ], { unit: "s" }),
    ts("Bytes sent", { expr: `sum(rate(${CADDY("caddy_http_response_size_bytes_sum")}[${RI}]))`, legend: "sent" }, { unit: "Bps" }),

    row("Logs"),
    logs("Caddy logs", '{service="web"}'),
  ],
});

const CF = (m) => `${m}{job="cloudflared"}`;
const tunnel = dashboard({
  uid: UIDS.tunnel,
  title: "Runflow · Tunnel",
  description: "The Cloudflare Tunnel (cloudflared): its connections to the edge, requests through it and round-trip times.",
  tags: ["tunnel"],
  panels: [
    row("Now"),
    stat("Edge connections", `max(${CF("cloudflared_tunnel_ha_connections")}) or vector(0)`, {
      decimals: 0,
      steps: [["red", null], ["orange", 1], ["green", 2]],
      graph: false,
      desc: "Normally 4, to two or more São Paulo data centers.",
    }),
    stat("Edge locations", { expr: `${CF("cloudflared_tunnel_server_locations")} == 1`, legend: "{{edge_location}}" }, { text: "name", graph: false, w: 6 }),
    stat("Requests per second (5 min)", `sum(rate(${CF("cloudflared_tunnel_total_requests")}[5m])) or vector(0)`, { unit: "reqps", decimals: 2 }),
    stat("Request errors (1 h)", `round(sum(increase(${CF("cloudflared_tunnel_request_errors")}[1h])) or vector(0))`, {
      decimals: 0,
      steps: [["green", null], ["orange", 1], ["red", 20]],
      desc: "Requests the tunnel couldn't deliver to the web container.",
    }),
    stat("Round trip to the edge", `avg(${CF("quic_client_smoothed_rtt")})`, { unit: "ms", decimals: 0, w: 6 }),

    row("Traffic"),
    ts("Requests per second", { expr: `rate(${CF("cloudflared_tunnel_total_requests")}[${RI}])`, legend: "requests" }, { unit: "reqps" }),
    ts("Responses by status", { expr: `sum by (status_code) (rate(${CF("cloudflared_tunnel_response_by_code")}[${RI}]))`, legend: "{{status_code}}" }, { unit: "reqps", stack: true }),
    ts("Errors and concurrent requests", [
      { expr: `increase(${CF("cloudflared_tunnel_request_errors")}[${RI}])`, legend: "errors" },
      { expr: CF("cloudflared_tunnel_concurrent_requests_per_tunnel"), legend: "concurrent" },
    ], { decimals: 0 }),
    ts("Round trip per connection", { expr: CF("quic_client_smoothed_rtt"), legend: "connection {{conn_index}}" }, { unit: "ms" }),
    ts("Edge connections", { expr: CF("cloudflared_tunnel_ha_connections"), legend: "connections" }, { decimals: 0, min: 0 }),
    ts("Lost packets", { expr: `sum by (conn_index) (rate(${CF("quic_client_lost_packets")}[${RI}]))`, legend: "connection {{conn_index}}" }, { unit: "pps" }),

    row("Logs"),
    logs("cloudflared logs", '{service="cloudflared"}'),
  ],
});

const C = (m) => `${m}{job="containers",service!=""}`;
const host = dashboard({
  uid: UIDS.host,
  title: "Runflow · Host and containers",
  description: "The NUC (node metrics) and every container's CPU, memory, network and disk (cAdvisor), by compose service.",
  tags: ["host", "containers"],
  panels: [
    row("Host now"),
    stat("CPU", '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))', {
      unit: "percent",
      decimals: 0,
      steps: [["green", null], ["orange", 70], ["red", 90]],
    }),
    stat("Memory", "100 * (1 - max(node_memory_MemAvailable_bytes) / max(node_memory_MemTotal_bytes))", {
      unit: "percent",
      decimals: 0,
      steps: [["green", null], ["orange", 80], ["red", 92]],
    }),
    stat("Disk (/)", '100 * (1 - max(node_filesystem_avail_bytes{mountpoint="/"}) / max(node_filesystem_size_bytes{mountpoint="/"}))', {
      unit: "percent",
      decimals: 0,
      steps: [["green", null], ["orange", 80], ["red", 90]],
    }),
    stat("Load (1 min)", "max(node_load1)", { decimals: 2 }),
    stat("Temperature", "max(node_thermal_zone_temp) or max(node_hwmon_temp_celsius)", {
      unit: "celsius",
      decimals: 0,
      steps: [["green", null], ["orange", 75], ["red", 90]],
    }),
    stat("Uptime", "time() - max(node_boot_time_seconds)", { unit: "s", graph: false, decimals: 0 }),

    row("Host"),
    ts("CPU by mode", { expr: 'sum by (mode) (rate(node_cpu_seconds_total{mode!="idle"}[$__rate_interval])) / scalar(count(count by (cpu) (node_cpu_seconds_total{mode="idle"})))', legend: "{{mode}}" }, {
      w: 8,
      unit: "percentunit",
      stack: true,
    }),
    ts("Memory", [
      { expr: "max(node_memory_MemTotal_bytes) - max(node_memory_MemAvailable_bytes)", legend: "used" },
      { expr: "max(node_memory_MemTotal_bytes)", legend: "total" },
      { expr: "max(node_memory_SwapTotal_bytes) - max(node_memory_SwapFree_bytes)", legend: "swap used" },
    ], { w: 8, unit: "bytes" }),
    ts("Disk used", { expr: '100 * (1 - max by (mountpoint) (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs|fuse.*",mountpoint!~"/run.*|/boot.*"}) / max by (mountpoint) (node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs|fuse.*",mountpoint!~"/run.*|/boot.*"}))', legend: "{{mountpoint}}" }, {
      w: 8,
      unit: "percent",
      min: 0,
      max: 100,
    }),
    ts("Network", [
      { expr: 'sum(rate(node_network_receive_bytes_total{device!~"lo|veth.*|br-.*|docker.*"}[$__rate_interval]))', legend: "received" },
      { expr: 'sum(rate(node_network_transmit_bytes_total{device!~"lo|veth.*|br-.*|docker.*"}[$__rate_interval]))', legend: "sent" },
    ], { w: 8, unit: "Bps" }),
    ts("Disk I/O", [
      { expr: "sum(rate(node_disk_read_bytes_total[$__rate_interval]))", legend: "read" },
      { expr: "sum(rate(node_disk_written_bytes_total[$__rate_interval]))", legend: "written" },
    ], { w: 8, unit: "Bps" }),
    ts("Temperature", { expr: "max(node_thermal_zone_temp) or max(node_hwmon_temp_celsius)", legend: "max" }, { w: 8, unit: "celsius" }),

    row("Containers (by compose service)"),
    ts("CPU by service", { expr: `sum by (service) (rate(${C("container_cpu_usage_seconds_total")}[${RI}]))`, legend: "{{service}}" }, {
      unit: "percentunit",
      desc: "100% is one full core.",
    }),
    ts("Memory by service", { expr: `sum by (service) (${C("container_memory_working_set_bytes")})`, legend: "{{service}}" }, { unit: "bytes" }),
    bars("Memory against the container's limit", {
      expr: `sum by (service) (${C("container_memory_working_set_bytes")}) / sum by (service) (${C("container_spec_memory_limit_bytes")} > 0)`,
      legend: "{{service}}",
    }, { unit: "percentunit", steps: [["green", null], ["orange", 0.8], ["red", 0.95]], desc: "Only services with a mem_limit in the compose file." }),
    bars("Running for", { expr: `time() - max by (service) (${C("container_start_time_seconds")})`, legend: "{{service}}" }, {
      unit: "s",
      steps: [["orange", null], ["green", 3600]],
      desc: "A short time means a recent restart or deploy.",
    }),
    ts("Network received by service", { expr: `sum by (service) (rate(${C("container_network_receive_bytes_total")}[${RI}]))`, legend: "{{service}}" }, { unit: "Bps" }),
    ts("Network sent by service", { expr: `sum by (service) (rate(${C("container_network_transmit_bytes_total")}[${RI}]))`, legend: "{{service}}" }, { unit: "Bps" }),
    ts("Disk writes by service", { expr: `sum by (service) (rate(${C("container_fs_writes_bytes_total")}[${RI}]))`, legend: "{{service}}" }, { unit: "Bps" }),
    ts("Out-of-memory kills", { expr: `sum by (service) (increase(${C("container_oom_events_total")}[${RI}])) > 0`, legend: "{{service}}" }, { decimals: 0 }),

    row("Logs"),
    logVolume("Log volume by service", 'sum by (service) (count_over_time({environment="qa"}[$__auto]))', { w: 24, legend: "{{service}}" }),
  ],
});

// ---------------------------------------------------------------- write or check

const FILES = {
  "runflow-qa.json": overview,
  "api.json": api,
  "worker.json": worker,
  "postgres.json": postgres,
  "valkey.json": valkey,
  "garage.json": garage,
  "web.json": web,
  "tunnel.json": tunnel,
  "host.json": host,
};

const check = process.argv.includes("--check");
const problems = [];
for (const [file, d] of Object.entries(FILES)) {
  const json = `${JSON.stringify(d, null, 2)}\n`;
  const path = join(OUT, file);
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {}
    if (current !== json) problems.push(`ops/qa/observability/grafana/dashboards/${file} is out of date`);
  } else {
    writeFileSync(path, json);
  }
}
const extra = readdirSync(OUT).filter((f) => f.endsWith(".json") && !(f in FILES));
for (const f of extra) problems.push(`ops/qa/observability/grafana/dashboards/${f} isn't written by dashboards.mjs`);

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}: run node ops/qa/observability/grafana/dashboards.mjs`);
  process.exit(1);
}
console.log(check ? `✓ ${Object.keys(FILES).length} Grafana dashboards are up to date` : `wrote ${Object.keys(FILES).length} dashboards to ${OUT}`);
