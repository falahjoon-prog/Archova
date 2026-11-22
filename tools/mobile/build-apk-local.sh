#!/usr/bin/env bash
# Build an installable Android test APK on this machine, no GitHub or Expo account involved.
# Needs: Node 22, pnpm, JDK 17 and the Android SDK (ANDROID_HOME or ANDROID_SDK_ROOT set).
# Usage (from the repo root): tools/mobile/build-apk-local.sh [API_URL] [APP_ORIGIN]
# Both addresses default to the demo tunnel; pass new ones if the tunnel restarted.
# The APK is signed with the debug key: for testing only, never a store upload.
set -euo pipefail

API_URL="${1:-https://tamil-acquisitions-frontpage-biography.trycloudflare.com}"
APP_ORIGIN="${2:-$API_URL}"
cd "$(dirname "$0")/../.."
step() { printf '\n=== %s ===\n' "$*"; }

if [ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]; then
  echo "Set ANDROID_HOME to your Android SDK folder first." >&2
  exit 1
fi
export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
step "Checking tools"
for tool in node pnpm java; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed or not on PATH." >&2; exit 1; }
  printf '%s: ' "$tool"; "$tool" --version 2>&1 | head -n 1
done
echo "ANDROID_HOME=$ANDROID_HOME"
[ -d "$ANDROID_HOME" ] || { echo "ANDROID_HOME folder does not exist." >&2; exit 1; }

export APP_VARIANT=preview
export EXPO_PUBLIC_API_URL="$API_URL"
export EXPO_PUBLIC_APP_ORIGIN="$APP_ORIGIN"

step "1/3 Installing packages (slow the first time)"
pnpm install --frozen-lockfile
cd apps/mobile
step "2/3 Generating the Android project"
npx expo prebuild --platform android --no-install
step "3/3 Building the APK (slow the first time)"
(cd android && ./gradlew assembleRelease --no-daemon)

apk="$(ls android/app/build/outputs/apk/release/*.apk | head -n 1)"
echo
echo "APK ready: $PWD/$apk"
