#!/usr/bin/env bash
# Pull the newest QA images and restart what changed (run by runflow-update.timer every 5 minutes).
# A push to main builds new images in GitHub Actions; this picks them up. Logs: journalctl -u runflow-update
set -euo pipefail
cd "$(dirname "$0")"

# The whole script is read before it runs: `git pull` below may rewrite this very file.
main() {
  git -C ../.. pull --ff-only --quiet || echo "git pull failed (local changes?); continuing with the current compose file"

  web_image() { docker inspect -f '{{.Image}}' "$(docker compose ps -q web)" 2>/dev/null || true; }
  api_health() { docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo missing; }
  before=$(web_image)
  docker compose pull --quiet
  # Non-zero when the API doesn't come up healthy; the schema check below decides what that means.
  docker compose up -d --remove-orphans || true
  docker image prune -f --filter "until=168h" >/dev/null

  # QA's data is kept (D-051, 2026-11-04): schema changes arrive as new migrations, applied by the API on start.
  # An edited or missing migration makes the API refuse to start; that is a bug to fix in the repo, never a reason to
  # wipe the database (reset-db.sh stays a manual tool).
  for _ in $(seq 1 30); do [ "$(api_health)" = healthy ] && break; sleep 3; done
  if [ "$(api_health)" != healthy ]; then
    if docker compose logs --since 10m api 2>&1 | grep -qE "previously applied but (has been modified|is missing)"; then
      echo "ERROR: an applied migration was edited or removed; the API won't start. Fix it in the repo (D-051); the data is untouched." >&2
    else
      echo "ERROR: the API isn't healthy after the update; see: docker compose logs api" >&2
    fi
  fi

  # A new web image is a new app: drop Cloudflare's cached shell so people get it now, not within the hour.
  if [ "$(web_image)" != "$before" ]; then ./purge-edge.sh; fi
}
main "$@"
exit
