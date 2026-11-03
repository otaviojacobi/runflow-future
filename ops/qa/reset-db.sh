#!/usr/bin/env bash
# Start QA over with an empty database, empty object storage and an empty Valkey (D-030, D-039: QA is disposable,
# no backups).
# The API migrates the fresh database when it starts again.
# Usage (on the QA host, in ~/runflow/ops/qa): ./reset-db.sh --yes
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" != "--yes" ]; then
  echo "This deletes every account, club and upload on QA (nothing is kept). Run: ./reset-db.sh --yes"
  exit 1
fi

docker compose stop api
docker compose exec -T postgres sh -c '
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\""'
# Valkey holds only ephemeral data (D-047: sign-in codes, rate limits, cached sessions and reads): start it empty too.
docker compose exec -T valkey valkey-cli FLUSHALL >/dev/null
# Garage recreates its bucket and the API's key from .env when it starts on an empty volume.
docker compose rm -sf garage
docker volume rm -f runflow-qa_garage >/dev/null
# Then everything (the web container may have been held back while the API was down).
docker compose up -d --wait
echo "QA reset: empty database (migrated by the API at start) and empty storage"
