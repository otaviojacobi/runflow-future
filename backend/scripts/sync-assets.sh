#!/usr/bin/env bash
# Copy the contract/design artifacts the backend embeds into backend/assets (`check.sh` fails when they drift):
#   design/dist/tokens.json, color-fixtures.json  e-mail colors and type; color-engine golden fixtures
#   design/dist/logo.json                        Runflow's mark (e-mail header)
#   api/starter-library.json                      workouts every new club starts with
#   api/exercise-catalog.json                     Runflow's global exercises (upserted after migrations)
#   api/workout-text-examples.json                golden examples of the free-text grammar (domain tests)
#   api/plans.json                                the plan catalog: seats per role and prices (D-043)
#   api/activity-match-examples.json              golden examples of activity matching (D-049, domain tests)
# api/schema.sql is NOT copied any more: since D-051 (2026-11-04) schema changes are new files in migrations/, and
# db/tests/contract.rs proves that all migrations together build exactly api/schema.sql.
set -euo pipefail
backend="$(cd "$(dirname "$0")/.." && pwd)"
cp "$backend/../design/dist/tokens.json" "$backend/../design/dist/color-fixtures.json" "$backend/../design/dist/logo.json" "$backend/assets/design/"
cp "$backend/../api/starter-library.json" "$backend/../api/exercise-catalog.json" "$backend/../api/workout-text-examples.json" "$backend/../api/plans.json" "$backend/../api/activity-match-examples.json" "$backend/assets/"
echo "synced design/dist + api/ artifacts → backend/assets"
