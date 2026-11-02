#!/usr/bin/env bash
# Nightly database dump (run by runflow-backup.timer). Keeps 14 days in ~/runflow-backups.
# Copy these off the Pi too (another machine, cloud drive): an SD card can die without warning.
set -euo pipefail
cd "$(dirname "$0")"
dest="${BACKUP_DIR:-$HOME/runflow-backups}"
mkdir -p "$dest"
file="$dest/runflow-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > "$file"
# Object storage (Garage, D-037): stopped for a moment so the copy is consistent (uploads wait a few seconds).
docker compose stop garage >/dev/null
docker compose cp garage:/var/lib/garage - 2>/dev/null | gzip > "$dest/storage-$(date +%Y%m%d).tar.gz" || true
docker compose start garage >/dev/null
find "$dest" -name 'runflow-*.sql.gz' -mtime +14 -delete
find "$dest" -name 'storage-*.tar.gz' -mtime +14 -delete
echo "backup: $file ($(du -h "$file" | cut -f1))"
