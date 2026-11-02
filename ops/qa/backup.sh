#!/usr/bin/env bash
# Nightly database dump (run by runflow-backup.timer). Keeps 14 days in ~/runflow-backups.
# Copy these off the Pi too (another machine, cloud drive): an SD card can die without warning.
set -euo pipefail
cd "$(dirname "$0")"
dest="${BACKUP_DIR:-$HOME/runflow-backups}"
mkdir -p "$dest"
file="$dest/runflow-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > "$file"
docker compose cp api:/data/uploads - 2>/dev/null | gzip > "$dest/uploads-$(date +%Y%m%d).tar.gz" || true
find "$dest" -name 'runflow-*.sql.gz' -mtime +14 -delete
find "$dest" -name 'uploads-*.tar.gz' -mtime +14 -delete
echo "backup: $file ($(du -h "$file" | cut -f1))"
