#!/usr/bin/env bash
# Copy the design artifacts the backend uses (e-mail colors and type; color-engine fixtures for S3)
# from design/dist into backend/assets/design. `check.sh` fails when they drift.
set -euo pipefail
backend="$(cd "$(dirname "$0")/.." && pwd)"
cp "$backend/../design/dist/tokens.json" "$backend/../design/dist/color-fixtures.json" "$backend/assets/design/"
echo "synced design/dist → backend/assets/design"
