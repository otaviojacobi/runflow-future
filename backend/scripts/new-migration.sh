#!/usr/bin/env bash
# Start a schema change (D-051): writes migrations/NNNN_<name>.sql (the next number) with a header.
# Then: write the SQL, apply the same change to api/schema.sql (the contract: the full current schema), update the mock
# and seed if rows change, run scripts/prepare.sh, then scripts/freeze-migrations.sh before you push. Never edit a
# migration that has been pushed: QA and production already ran it.
#   bash backend/scripts/new-migration.sh add_group_color
set -euo pipefail
[ $# -eq 1 ] && [[ "$1" =~ ^[a-z0-9_]+$ ]] || { echo "usage: $0 <snake_case_name>" >&2; exit 1; }
dir="$(cd "$(dirname "$0")/../migrations" && pwd)"
last=$(ls "$dir" | sed -nE 's/^([0-9]{4})_.*\.sql$/\1/p' | sort | tail -1)
next=$(printf '%04d' $((10#${last:-0} + 1)))
file="$dir/${next}_$1.sql"
printf -- '-- %s: %s (%s)\n-- Keep api/schema.sql equal to all migrations together (db/tests/contract.rs).\n\n' "$next" "$1" "$(date +%F)" > "$file"
echo "created backend/migrations/${next}_$1.sql"
