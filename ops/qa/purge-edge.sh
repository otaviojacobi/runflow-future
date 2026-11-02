#!/usr/bin/env bash
# Drop Cloudflare's cached copy of the QA web app (app shell, icons, bundles) so a deploy shows up at
# once instead of within the hour. update.sh runs it when the web image changed; run it by hand anytime.
# Needs CF_ZONE_ID and CF_CACHE_PURGE_TOKEN in .env (docs/ops/qa-pi.md §6); skipped while they're empty.
set -euo pipefail
cd "$(dirname "$0")"

# Read one key from .env without sourcing it (values like EMAIL_FROM aren't shell-safe).
env_value() { sed -n "s/^$1=//p" .env | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }
zone=$(env_value CF_ZONE_ID)
token=$(env_value CF_CACHE_PURGE_TOKEN)
host=$(env_value PUBLIC_APP_URL | sed -E 's#^https?://##; s#/.*$##')

if [ -z "$zone" ] || [ -z "$token" ]; then
  echo "edge purge skipped: CF_ZONE_ID / CF_CACHE_PURGE_TOKEN not set (the old app shell expires within an hour)"
  exit 0
fi

# The token goes in through stdin, so it never shows up in the process list.
res=$(printf 'Authorization: Bearer %s\n' "$token" | curl -sS -m 20 -X POST -H @- \
  -H 'Content-Type: application/json' --data "{\"hosts\":[\"$host\"]}" \
  "https://api.cloudflare.com/client/v4/zones/$zone/purge_cache") || {
  echo "edge purge failed: Cloudflare unreachable" >&2
  exit 1
}
if printf '%s' "$res" | grep -q '"success": *true'; then
  echo "edge cache purged for $host"
else
  echo "edge purge failed: $res" >&2
  exit 1
fi
