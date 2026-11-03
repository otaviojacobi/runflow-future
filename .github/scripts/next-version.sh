#!/usr/bin/env bash
# The next semantic version from conventional commits since the last `v*` tag (D-048):
#   breaking (`type!:` or `BREAKING CHANGE`) → major (minor while 0.x), `feat` → minor, anything else → patch.
# No tag yet → 0.2.0 (the first tagged release). Prints the version without the `v`.
# Usage: next-version.sh [rev]   (default HEAD; needs the full history and tags: fetch-depth 0)
set -euo pipefail
rev="${1:-HEAD}"
last=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' "$rev" 2>/dev/null || true)
if [ -z "$last" ]; then
  echo "0.2.0"
  exit 0
fi
IFS=. read -r major minor patch <<<"${last#v}"
log=$(git log --format='%s%n%b%n--end--' "$last..$rev")
if [ -z "$(git rev-list "$last..$rev")" ]; then
  echo "${major}.${minor}.${patch}"
  exit 0
fi
if grep -qE '^[a-z]+(\([^)]*\))?!:|^BREAKING CHANGE' <<<"$log"; then
  bump=major
elif grep -qE '^feat(\([^)]*\))?:' <<<"$log"; then
  bump=minor
else
  bump=patch
fi
# Before 1.0 a breaking change bumps the minor version.
if [ "$bump" = major ] && [ "$major" = 0 ]; then bump=minor; fi
case "$bump" in
  major) echo "$((major + 1)).0.0" ;;
  minor) echo "${major}.$((minor + 1)).0" ;;
  patch) echo "${major}.${minor}.$((patch + 1))" ;;
esac
