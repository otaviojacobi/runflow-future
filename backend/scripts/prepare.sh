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
# Until the beta the bootstrap migration changes in place (D-030): a dev database built from an older one starts over.
if ! out=$(sqlx migrate run --source migrations 2>&1); then
  if grep -q "previously applied but has been modified" <<<"$out"; then
    echo "bootstrap migration changed: recreating the dev database"
    docker compose --project-directory "$root" -f "$root/docker-compose.yaml" exec -T postgres sh -c \
      'psql -U "$POSTGRES_USER" -d postgres -q -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\""'
    sqlx migrate run --source migrations
  else
    echo "$out" >&2; exit 1
  fi
else
  echo "$out"
fi
cargo sqlx prepare --workspace -- --all-targets
echo "✓ .sqlx refreshed; commit it with the queries"
