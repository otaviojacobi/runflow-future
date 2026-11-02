#!/usr/bin/env bash
# Pull the newest QA images and restart what changed (run by runflow-update.timer every 5 minutes).
# A push to main builds new images in GitHub Actions; this picks them up. Logs: journalctl -u runflow-update
set -euo pipefail
cd "$(dirname "$0")"
git -C ../.. pull --ff-only --quiet || echo "git pull failed (local changes?); continuing with the current compose file"
docker compose pull --quiet
docker compose up -d --remove-orphans
docker image prune -f --filter "until=168h" >/dev/null
