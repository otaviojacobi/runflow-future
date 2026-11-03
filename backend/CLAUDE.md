# backend/: CLAUDE.md

The Runflow server: Rust (edition 2024) · axum · sqlx · PostgreSQL. It implements the contract (`../api/endpoints.md`, `../api/schema.sql`) so the apps switch from the mock with no UI changes.
Read `../root.md` §7.2, §7.3, §7.6 and decisions D-020, D-025, D-026, then `../docs/build-plan.md` Phase 2. Future standalone repo: `runflow-backend`.

## Commands

| From the repo root | What |
|---|---|
| `npm run check:backend` | Design-asset sync, rustfmt, clippy `-D warnings`, every test on a real Postgres and Redis (starts the compose `postgres` and `redis` with the `.env` credentials; CI sets `TEST_DATABASE_URL` and `TEST_REDIS_URL`). Part of `npm run check` |
| `npm run up` (`docker compose up -d --build`) | Postgres (host :5433), Redis (host :6380), Garage + API (host :3000): migrate, then serve |
| `npm run doctor` | What's configured and what's missing (secrets hidden), database, Redis, storage |
| `docker compose run --rm api email-test --to you@email.com` | Send a test e-mail (Resend, or the log). `--preview out.html` writes the HTML instead |
| `cd backend && cargo run -- serve` | Run on the host against the compose Postgres and Redis (reads `../.env`) |
| `bash backend/scripts/prepare.sh` | After adding or changing a `sqlx::query!`: migrate the dev database and refresh `.sqlx/` (commit it). Needs `sqlx-cli` 0.9 |

Settings: every variable is documented in `../.env.example`; the real values live in `../.env` (git-ignored).

## Layout

```
crates/
  runflow/       the binary: config.rs (env → typed config), doctor.rs, CLI (all | serve | worker | migrate | doctor | email-test | healthcheck)
  api/           axum router under /v1: problem.rs (pt-BR problem+json), body.rs (JSON + field validation),
                 session.rs (tokens, cookies, Auth extractor + its Redis cache), cache.rs (cached club reads and the
                 per-club version bump after writes), routes/ (one module per contract section)
  db/            pool, migrations (embedded), models.rs (JSON row shapes), one query module per area,
                 tests/contract.rs (migrations == api/schema.sql)
  kv/            Redis (D-047): codes (sign-in codes + per-address limits), rate (fixed-window limits), sessions
                 (session lookup cache with tombstones), cache (per-club versions, cached reads); Lua where atomic
  domain/        pure rules, no I/O: the club color engine (port of design/src/color.js), workout structure and
                 estimates, the free-text workout grammar (workout_text.rs), week release timing, notification rules,
                 assessment formulas, the assistant's rules engine
  jobs/          the worker: Postgres queue (FOR UPDATE SKIP LOCKED, woken by NOTIFY on commit), retries with backoff;
                 job kinds (invite e-mails, Strava, Stripe, push)
  integrations/  email (Resend + log with a dev outbox, token-based layout), google (ID-token verification),
                 strava, stripe (Checkout, portal, webhook signatures), webpush (RFC 8291 + VAPID), storage
migrations/      0001_bootstrap.sql = api/schema.sql (synced; the only migration until the beta, D-030)
assets/          synced copies: design/dist/tokens.json + color-fixtures.json, api/starter-library.json,
                 api/exercise-catalog.json, api/workout-text-examples.json (scripts/sync-assets.sh)
```
`domain` holds pure rules with no I/O: `color.rs` is the Rust port of `design/src/color.js`, proven by
`tests/color_fixtures.rs` against the synced golden fixtures (change both together). `workout_text.rs` is the
port of the free-text grammar (`api/mock/lib/workout-text.mjs`, `docs/workout-text.md`), proven by
`tests/workout_text.rs` against the synced golden examples; its ignored `corpus` test compares a random corpus from
the mock (`node api/mock/workout-text-examples.mjs --corpus /tmp/c.json`, then
`WORKOUT_TEXT_CORPUS=/tmp/c.json cargo test -p runflow-domain --test workout_text -- --ignored`).

## Rules

- **Contract first (D-020).** A route exists in `api/endpoints.md` before it exists here, with the same JSON (snake_case), status codes, error `code`s and pt-BR `title`/`detail` as the mock. If the mock is wrong, fix the mock and the contract in the same step.
- **Schema changes (until the beta, D-030)** go to `api/schema.sql` only; `scripts/sync-assets.sh` copies it to the single migration `migrations/0001_bootstrap.sql` (`check.sh` fails when they differ) and `scripts/prepare.sh` recreates the dev database when the bootstrap changed. QA resets itself when the bootstrap changes (`ops/qa/update.sh`). From the beta on: a new `migrations/NNNN_name.sql` per change, never editing an applied one; `db/tests/contract.rs` keeps proving migrations == schema.
- **Errors** are `Problem` (pt-BR for people, stable English `code`). Logs are English and never contain secrets or personal data beyond ids.
- **Tests** use `#[sqlx::test]` (a fresh, migrated database per test) and the real Redis (`TEST_REDIS_URL`, default `redis://127.0.0.1:6380`; `runflow_kv::test_kv()` gives each app a random key prefix). No database mocks (§8). External APIs are tested against local fakes (see `integrations/tests/resend.rs`).
- **Ephemeral and cache data in Redis, records in Postgres (D-047).** Redis gets what may vanish without harm: codes, counters, caches, all with a TTL (every key; prefix `rf:`). Anything people list, audit, resend or pay for is a record (invites are records: they're listed, resent and cancelled). Redis commands live in `kv/` modules, never in handlers. Where Redis holds the data itself (sign-in codes) an error answers 500; caches fall back to Postgres and log a warning. A cached read is keyed by the club's version (`api/src/cache.rs`); writes under `/clubs/{id}` bump it, anything else relies on the short TTL.
- **Config** only from the environment (`config.rs`). A new variable goes into `../.env.example` in the same commit. Secrets use `Secret`/redacted `Debug`.
- **Tokens only.** E-mail HTML takes colors, type, spacing and radii from `assets/design/tokens.json` through `email::layout`/`paragraph`. Run `scripts/sync-assets.sh` after design changes.
- **Queries** use `sqlx::query!`/`query_as!` (checked against the real schema at compile time) and live in `db/` modules; handlers never write SQL. The offline data in `.sqlx/` is committed (`scripts/prepare.sh`), and `check.sh`, CI and Docker build with `SQLX_OFFLINE=true`, so a stale `.sqlx` fails the check. Tests may use runtime `sqlx::query` for fixtures.
- **Auth:** handlers take `Auth` (401 `auth.required`) or `MaybeAuth`; club routes call `access::member(…, OWNER | STAFF | ANY)` (404 `club.not_found`, 403 `auth.forbidden`), exactly like the mock.
- **Slow or retryable work** (e-mails other than sign-in codes, later notifications and sync) goes through the job queue (`runflow_jobs::enqueue`), in the same transaction as the write that causes it (never Redis: a job must exist if and only if its write committed); tests run it with `TestApp::run_jobs()`. Jobs must be idempotent and skip work that became stale.
- **Secrets, tokens and codes** are only stored hashed (`session.rs`), in Postgres and in Redis alike; e-mail addresses appear in Redis keys only as digests.
- **Every way a session ends** (sign-out, revoking one or the others, account deletion) gets the token hashes back from the query and calls `session::forget`, or the cached lookup keeps it alive for up to 60 s.
- **Areas stay splittable.** Never import another area's source; the backend reads `api/schema.sql` (contract test) and synced design artifacts only.
