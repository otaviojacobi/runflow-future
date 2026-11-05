#!/usr/bin/env bash
# One-time Umami setup (D-054), safe to rerun: replaces Umami's default login (admin / umami) with
# UMAMI_ADMIN_PASSWORD from .env, creates this environment's website if it doesn't exist, writes its id to .env as
# UMAMI_WEBSITE_ID and recreates the API so /public/config hands it to the web app. Run it right after the first
# start of the `umami` service, before its tunnel route (analytics-qa.runflow.club) exists.
#   ./umami-setup.sh [domain]     (default qa.runflow.club)
set -euo pipefail
cd "$(dirname "$0")"
domain="${1:-qa.runflow.club}"
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
password="$(env_get UMAMI_ADMIN_PASSWORD)"
[ -n "$password" ] || { echo "set UMAMI_ADMIN_PASSWORD in .env first (openssl rand -hex 24)" >&2; exit 1; }

# Umami's API from inside its container (its port isn't published). JSON goes through stdin, never the command line.
api() { docker compose exec -T umami curl -sf -H 'content-type: application/json' "$@"; }
login() {
  printf '{"username":"admin","password":%s}' "$(json "$1")" |
    api -X POST http://localhost:3000/api/auth/login --data-binary @- | field token
}
json() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
field() { python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"; }

for _ in $(seq 1 40); do docker compose exec -T umami curl -sf http://localhost:3000/api/heartbeat >/dev/null 2>&1 && break; sleep 3; done

if token="$(login umami 2>/dev/null)" && [ -n "$token" ]; then
  printf '{"currentPassword":"umami","newPassword":%s}' "$(json "$password")" |
    api -X POST http://localhost:3000/api/me/password -H "authorization: Bearer $token" --data-binary @- >/dev/null
  echo "Umami: the default password is gone; sign in as admin with UMAMI_ADMIN_PASSWORD"
fi
token="$(login "$password")" || { echo "can't sign in to Umami as admin with UMAMI_ADMIN_PASSWORD" >&2; exit 1; }
auth="authorization: Bearer $token"

id="$(api http://localhost:3000/api/websites -H "$auth" |
  python3 -c 'import json,sys; d=sys.argv[1]; print(next((w["id"] for w in json.load(sys.stdin)["data"] if w["domain"]==d), ""))' "$domain")"
if [ -z "$id" ]; then
  id="$(printf '{"name":"Runflow (%s)","domain":%s}' "$domain" "$(json "$domain")" |
    api -X POST http://localhost:3000/api/websites -H "$auth" --data-binary @- | field id)"
  echo "Umami: website created for $domain"
fi
[ -n "$id" ] || { echo "couldn't find or create the website for $domain" >&2; exit 1; }

if [ "$(env_get UMAMI_WEBSITE_ID)" != "$id" ]; then
  if grep -qE '^UMAMI_WEBSITE_ID=' .env; then sed -i "s/^UMAMI_WEBSITE_ID=.*/UMAMI_WEBSITE_ID=$id/" .env; else echo "UMAMI_WEBSITE_ID=$id" >> .env; fi
  docker compose up -d api >/dev/null 2>&1
  echo "Umami: UMAMI_WEBSITE_ID=$id written to .env; the API was recreated with it"
fi
echo "Umami ready: website $id ($domain)"
