#!/usr/bin/env bash
# Put QA's database back to a backup.sh dump: it REPLACES today's data. The API is stopped while it runs.
#   ./restore-db.sh ~/runflow-backups/runflow-20261105-0330.sql.gz --yes
# Uploads (storage-*.tar.gz) are restored by hand if needed: docker compose stop garage, then extract into the volume.
set -euo pipefail
cd "$(dirname "$0")"
file="${1:-}"
[ -f "$file" ] || { echo "usage: $0 <runflow-YYYYMMDD-HHMM.sql.gz> --yes" >&2; exit 1; }
[ "${2:-}" = "--yes" ] || { echo "This replaces QA's database with $file. Run again with --yes to do it." >&2; exit 1; }
docker compose stop api >/dev/null
gunzip -c "$file" | docker compose exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose up -d api >/dev/null
echo "restored $file; the API is starting"
