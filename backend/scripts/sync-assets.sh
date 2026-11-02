#!/usr/bin/env bash
# Copy the contract/design artifacts the backend embeds into backend/assets (`check.sh` fails when they drift):
#   design/dist/tokens.json, color-fixtures.json  e-mail colors and type; color-engine golden fixtures
#   api/starter-library.json                      workouts every new club starts with
#   api/exercise-catalog.json                     Runflow's global exercises (upserted after migrations)
#   api/schema.sql → migrations/0001_bootstrap.sql  until the beta the only migration is the contract itself (D-030)
set -euo pipefail
backend="$(cd "$(dirname "$0")/.." && pwd)"
cp "$backend/../design/dist/tokens.json" "$backend/../design/dist/color-fixtures.json" "$backend/assets/design/"
cp "$backend/../api/starter-library.json" "$backend/../api/exercise-catalog.json" "$backend/assets/"
cp "$backend/../api/schema.sql" "$backend/migrations/0001_bootstrap.sql"
echo "synced design/dist + api/ artifacts → backend/assets, api/schema.sql → migrations/0001_bootstrap.sql"
