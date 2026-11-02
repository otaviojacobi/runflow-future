#!/usr/bin/env bash
# Backend check: design-asset sync, rustfmt, clippy (offline query data), then every test against a real
# Postgres (§8: no DB mocks).
# Postgres: $TEST_DATABASE_URL if set (CI), otherwise the docker compose `postgres` service with the
# credentials from the repo-root .env (started if needed).
set -euo pipefail
backend="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$backend/.." && pwd)"
cd "$backend"

echo "› design assets in sync with design/dist"
if [ -d "$root/design/dist" ]; then
  for f in tokens.json color-fixtures.json; do
    if ! cmp -s "$root/design/dist/$f" "assets/design/$f"; then
      echo "  assets/design/$f is stale: run backend/scripts/sync-design.sh"; exit 1
    fi
  done
fi

echo "› rustfmt"
cargo fmt --all --check
# Queries compile from the committed .sqlx data, like CI and Docker (scripts/prepare.sh refreshes it).
export SQLX_OFFLINE=true
echo "› clippy"
cargo clippy --workspace --all-targets --locked -q -- -D warnings

if [ -z "${TEST_DATABASE_URL:-}" ]; then
  if [ ! -f "$root/.env" ]; then
    echo "  no .env: run \`cp .env.example .env\` and set POSTGRES_PASSWORD (or export TEST_DATABASE_URL)"; exit 1
  fi
  env_get() { grep -E "^$1=" "$root/.env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
  echo "› Postgres (docker compose service \`postgres\`)"
  docker compose --project-directory "$root" -f "$root/docker-compose.yaml" up -d --wait postgres >/dev/null
  user="$(env_get POSTGRES_USER)"; pass="$(env_get POSTGRES_PASSWORD)"; port="$(env_get POSTGRES_HOST_PORT)"; db="$(env_get POSTGRES_DB)"
  TEST_DATABASE_URL="postgres://${user:-runflow}:${pass}@localhost:${port:-5433}/${db:-runflow}"
fi

echo "› tests"
DATABASE_URL="$TEST_DATABASE_URL" cargo test --workspace --locked -q
echo "✓ backend check passed"
