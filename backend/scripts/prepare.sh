#!/usr/bin/env bash
# Refresh the committed sqlx offline data (.sqlx/) after adding or changing a `sqlx::query!`.
# Migrates the dev database from the repo-root .env (docker compose `postgres`), then runs `cargo sqlx prepare`.
# Needs sqlx-cli: cargo install sqlx-cli@0.9.0 --no-default-features --features postgres,rustls --locked
set -euo pipefail
backend="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$backend/.." && pwd)"
cd "$backend"
env_get() { grep -E "^$1=" "$root/.env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
docker compose --project-directory "$root" -f "$root/docker-compose.yaml" up -d --wait postgres >/dev/null
export DATABASE_URL="postgres://$(env_get POSTGRES_USER):$(env_get POSTGRES_PASSWORD)@localhost:$(env_get POSTGRES_HOST_PORT)/$(env_get POSTGRES_DB)"
# Migrations only move forward (D-051). If your dev database ran a migration that was later changed before it was
# pushed, recreate it yourself: docker compose exec postgres dropdb/createdb, or `npm run up` after removing the volume.
sqlx migrate run --source migrations
cargo sqlx prepare --workspace -- --all-targets
echo "✓ .sqlx refreshed; commit it with the queries"
