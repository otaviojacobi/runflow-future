#!/usr/bin/env bash
# The QA APK built on this computer (eas build --local): the same `preview` profile as `npm run apk`, without spending
# the month's EAS cloud builds. Try this first; the cloud build is the fallback. Needs JDK 17 (JAVA_HOME, default
# ~/.local/share/jdk-17) and the Android SDK (ANDROID_HOME, default ~/Android/Sdk; Gradle fetches missing parts),
# plus EXPO_TOKEN in the root .env (the signing key stays on EAS). The APK lands in RUNFLOW_BUILDS (default
# ~/Desktop/runflow-builds) as runflow-qa-<date>-<commit>.apk.
#   npm run apk:local
set -euo pipefail
mobile="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME_17:-${HOME}/.local/share/jdk-17}"
export ANDROID_HOME="${ANDROID_HOME:-${HOME}/Android/Sdk}"
# ~/.local/bin is left out: pip's leftover `cmake` shim there (broken on this machine) would shadow the SDK's CMake,
# which Gradle installs itself when it's missing.
PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -vx "$HOME/.local/bin" | paste -sd:)"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
"$JAVA_HOME/bin/java" -version 2>&1 | grep -q '"17\.' || { echo "JDK 17 not found at $JAVA_HOME (set JAVA_HOME_17)" >&2; exit 1; }
[ -d "$ANDROID_HOME" ] || { echo "Android SDK not found at $ANDROID_HOME" >&2; exit 1; }
# Sentry's source-map upload needs SENTRY_AUTH_TOKEN, an EAS secret that local builds don't get (and npm holds back
# sentry-cli's install script): skip it. The app still reports errors; their stacks are just minified for local builds.
export SENTRY_DISABLE_AUTO_UPLOAD=true
out="${RUNFLOW_BUILDS:-$HOME/Desktop/runflow-builds}"
mkdir -p "$out"
file="$out/runflow-qa-$(date +%Y%m%d-%H%M)-$(git -C "$mobile" rev-parse --short HEAD).apk"
[ -z "$(git -C "$mobile" status --porcelain -- .)" ] || echo "note: mobile/ has uncommitted changes; they go into this build" >&2
bash "$mobile/scripts/eas.sh" build --platform android --profile preview --local --non-interactive --output "$file"
echo "APK: $file"
