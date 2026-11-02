# backend/: CLAUDE.md

The Runflow server: Rust (edition 2024) · axum · sqlx · PostgreSQL. It implements the contract (`../api/endpoints.md`, `../api/schema.sql`) so the apps switch from the mock with no UI changes.
Read `../root.md` §7.2, §7.3, §7.6 and decisions D-020, D-025, D-026, then `../docs/build-plan.md` Phase 2. Future standalone repo: `runflow-backend`.

## Commands

| From the repo root | What |
|---|---|
| `npm run check:backend` | Design-asset sync, rustfmt, clippy `-D warnings`, every test on a real Postgres (starts the compose `postgres` with the `.env` credentials; CI sets `TEST_DATABASE_URL`). Part of `npm run check` |
| `npm run up` (`docker compose up -d --build`) | Postgres (host :5433) + API (host :3000): migrate, then serve |
| `npm run doctor` | What's configured and what's missing (secrets hidden), database, storage |
| `docker compose run --rm api email-test --to you@email.com` | Send a test e-mail (Resend, or the log). `--preview out.html` writes the HTML instead |
| `cd backend && cargo run -- serve` | Run on the host against the compose Postgres (reads `../.env`) |
| `bash backend/scripts/prepare.sh` | After adding or changing a `sqlx::query!`: migrate the dev database and refresh `.sqlx/` (commit it). Needs `sqlx-cli` 0.9 |

Settings: every variable is documented in `../.env.example`; the real values live in `../.env` (git-ignored).

## Layout

```
crates/
  runflow/       the binary: config.rs (env → typed config), doctor.rs, CLI (all | serve | worker | migrate | doctor | email-test | healthcheck)
  api/           axum router under /v1: problem.rs (pt-BR problem+json), body.rs (JSON + field validation),
                 session.rs (tokens, cookies, Auth extractor), routes/ (one module per contract section)
  db/            pool, migrations (embedded), models.rs (JSON row shapes), one query module per area,
                 tests/contract.rs (migrations == api/schema.sql)
  domain/        pure rules, no I/O: the club color engine (port of design/src/color.js)
  jobs/          the worker: Postgres queue (FOR UPDATE SKIP LOCKED), retries with backoff; job kinds (invite e-mails)
  integrations/  email (Resend + log with a dev outbox, token-based layout), google (ID-token verification);
                 later Strava, Stripe
migrations/      0001_contract.sql = api/schema.sql at S1; one new file per contract change
assets/          synced copies: design/dist/tokens.json + color-fixtures.json, api/starter-library.json (scripts/sync-assets.sh)
```
`domain` holds pure rules with no I/O: `color.rs` is the Rust port of `design/src/color.js`, proven by
`tests/color_fixtures.rs` against the synced golden fixtures (change both together). Workout structure, tags and
estimates join it when needed.

## Rules

- **Contract first (D-020).** A route exists in `api/endpoints.md` before it exists here, with the same JSON (snake_case), status codes, error `code`s and pt-BR `title`/`detail` as the mock. If the mock is wrong, fix the mock and the contract in the same step.
- **Schema changes** go to `api/schema.sql` **and** a new `migrations/NNNN_name.sql` in the same commit; `db/tests/contract.rs` fails otherwise. Never edit an applied migration.
- **Errors** are `Problem` (pt-BR for people, stable English `code`). Logs are English and never contain secrets or personal data beyond ids.
- **Tests** use `#[sqlx::test]` (a fresh, migrated database per test). No database mocks (§8). External APIs are tested against local fakes (see `integrations/tests/resend.rs`).
- **Config** only from the environment (`config.rs`). A new variable goes into `../.env.example` in the same commit. Secrets use `Secret`/redacted `Debug`.
- **Tokens only.** E-mail HTML takes colors, type, spacing and radii from `assets/design/tokens.json` through `email::layout`/`paragraph`. Run `scripts/sync-assets.sh` after design changes.
- **Queries** use `sqlx::query!`/`query_as!` (checked against the real schema at compile time) and live in `db/` modules; handlers never write SQL. The offline data in `.sqlx/` is committed (`scripts/prepare.sh`), and `check.sh`, CI and Docker build with `SQLX_OFFLINE=true`, so a stale `.sqlx` fails the check. Tests may use runtime `sqlx::query` for fixtures.
- **Auth:** handlers take `Auth` (401 `auth.required`) or `MaybeAuth`; club routes call `access::member(…, OWNER | STAFF | ANY)` (404 `club.not_found`, 403 `auth.forbidden`), exactly like the mock.
- **Slow or retryable work** (e-mails other than sign-in codes, later notifications and sync) goes through the job queue (`runflow_jobs::enqueue`); tests run it with `TestApp::run_jobs()`. Jobs must be idempotent and skip work that became stale.
- **Secrets, tokens and codes** are only stored hashed (`session.rs`).
- **Areas stay splittable.** Never import another area's source; the backend reads `api/schema.sql` (contract test) and synced design artifacts only.
