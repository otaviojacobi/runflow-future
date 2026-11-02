#!/usr/bin/env bash
# Copy the contract/design artifacts the backend embeds into backend/assets (`check.sh` fails when they drift):
#   design/dist/tokens.json, color-fixtures.json  e-mail colors and type; color-engine golden fixtures
#   api/starter-library.json                      workouts every new club starts with
set -euo pipefail
backend="$(cd "$(dirname "$0")/.." && pwd)"
cp "$backend/../design/dist/tokens.json" "$backend/../design/dist/color-fixtures.json" "$backend/assets/design/"
cp "$backend/../api/starter-library.json" "$backend/assets/"
echo "synced design/dist + api/starter-library.json → backend/assets"
