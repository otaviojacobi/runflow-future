#!/usr/bin/env bash
# Pull the newest QA images and restart what changed (run by runflow-update.timer every 5 minutes).
# A push to main builds new images in GitHub Actions; this picks them up. Logs: journalctl -u runflow-update
set -euo pipefail
cd "$(dirname "$0")"
git -C ../.. pull --ff-only --quiet || echo "git pull failed (local changes?); continuing with the current compose file"

web_image() { docker inspect -f '{{.Image}}' "$(docker compose ps -q web)" 2>/dev/null || true; }
before=$(web_image)
docker compose pull --quiet
docker compose up -d --remove-orphans
docker image prune -f --filter "until=168h" >/dev/null

# A new web image is a new app: drop Cloudflare's cached shell so people get it now, not within the hour.
if [ "$(web_image)" != "$before" ]; then ./purge-edge.sh; fi
