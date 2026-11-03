#!/usr/bin/env bash
# EAS CLI for the app (builds on Expo's servers, mobile/eas.json), authenticated with EXPO_TOKEN from the repo-root
# .env (never printed). `npm run eas -- <args>`, e.g. `npm run eas -- build:list`; `npm run apk` builds the QA APK.
set -euo pipefail
mobile="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$mobile/.." && pwd)"
if [ -z "${EXPO_TOKEN:-}" ] && [ -f "$root/.env" ]; then
  EXPO_TOKEN="$(grep -E '^EXPO_TOKEN=' "$root/.env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
fi
if [ -z "${EXPO_TOKEN:-}" ]; then
  echo "EXPO_TOKEN is missing: create one at expo.dev → Account settings → Access tokens and put it in .env" >&2
  exit 1
fi
export EXPO_TOKEN EXPO_NO_TELEMETRY=1
cd "$mobile"
exec npx --yes eas-cli@25.2.0 "$@"
