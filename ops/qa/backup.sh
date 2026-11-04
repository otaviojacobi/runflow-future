#!/usr/bin/env bash
# Nightly QA backup (D-051: QA's data is kept). Cron runs it at 03:30 (the runflow user's crontab; `./backup.sh
# --install` adds the line). Keeps 14 days in ~/runflow-backups: the database (pg_dump, gzip, checked complete) and
# the uploads (Garage's data, tar.gz). Restore with ./restore-db.sh. Copy the folder off the NUC now and then.
set -euo pipefail
cd "$(dirname "$0")"
dest="${BACKUP_DIR:-$HOME/runflow-backups}"
mkdir -p "$dest"
if [ "${1:-}" = "--install" ]; then
  line="30 3 * * * $(pwd)/backup.sh >> $dest/backup.log 2>&1"
  { crontab -l 2>/dev/null | grep -v "ops/qa/backup.sh" || true; echo "$line"; } | crontab -
  echo "installed: $line"
  exit 0
fi
stamp=$(date +%Y%m%d-%H%M)
db="$dest/runflow-$stamp.sql.gz"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists' | gzip > "$db.part"
# A finished dump ends with PostgreSQL's footer; anything else is a cut or failed one and must not count as a backup.
if ! gzip -t "$db.part" || ! zcat "$db.part" | tail -n 5 | grep -q "PostgreSQL database dump complete"; then
  rm -f "$db.part"; echo "$(date -Is) backup FAILED: incomplete database dump" >&2; exit 1
fi
mv "$db.part" "$db"
# Uploads: Garage stopped for a few seconds so the copy is consistent (an upload at 03:30 would wait).
st="$dest/storage-$stamp.tar.gz"
docker compose stop garage >/dev/null
if docker compose cp garage:/var/lib/garage - 2>/dev/null | gzip > "$st.part"; then mv "$st.part" "$st"; else rm -f "$st.part"; echo "uploads copy failed (the database backup is fine)" >&2; fi
docker compose start garage >/dev/null
find "$dest" -name 'runflow-*.sql.gz' -mtime +14 -delete
find "$dest" -name 'storage-*.tar.gz' -mtime +14 -delete
echo "$(date -Is) backup: $db ($(du -h "$db" | cut -f1)), $(basename "$st") ($(du -h "$st" 2>/dev/null | cut -f1))"
