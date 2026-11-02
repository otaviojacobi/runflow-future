#!/usr/bin/env bash
# Start QA over with an empty database and no uploads (D-030: data is disposable until the beta).
# Takes a backup first, then the API migrates a fresh database when it starts again.
# Usage (on the Pi, in ~/runflow/ops/qa): ./reset-db.sh --yes
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" != "--yes" ]; then
  echo "This deletes every account, club and upload on QA (a backup is taken first). Run: ./reset-db.sh --yes"
  exit 1
fi

./backup.sh
docker compose stop api
docker compose exec -T postgres sh -c '
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\""'
docker compose run --rm --no-deps -T --entrypoint sh api -c 'find /data/uploads -mindepth 1 -delete'
docker compose start api
echo "QA reset: empty database (migrated by the API at start), uploads cleared"
