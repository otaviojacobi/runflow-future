#!/usr/bin/env bash
# Record the checksum of every migration that isn't recorded yet (D-051). check.sh fails when a recorded migration
# changes (QA and production already ran it: add a new migration instead) or when one isn't recorded.
# Run it once your new migration is final, before pushing. `--update NNNN` re-records a migration you changed
# again before it was ever pushed (never for one that is on main).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
list="$here/applied-migrations.sha384"
cd "$here/../migrations"
if [ "${1:-}" = "--update" ]; then
  [ -n "${2:-}" ] || { echo "usage: $0 --update NNNN" >&2; exit 1; }
  f=$(ls "${2}"_*.sql)
  grep -v "  $f\$" "$list" > "$list.tmp" || true
  mv "$list.tmp" "$list"
fi
for f in [0-9][0-9][0-9][0-9]_*.sql; do
  grep -q "  $f\$" "$list" || { sha384sum "$f" >> "$list"; echo "recorded $f"; }
done
sort -k2 -o "$list" "$list"
