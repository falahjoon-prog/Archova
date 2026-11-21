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

if [ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]; then
  echo "Set ANDROID_HOME to your Android SDK folder first." >&2
  exit 1
fi
export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
command -v java >/dev/null || { echo "Java 17 is not installed." >&2; exit 1; }

export APP_VARIANT=preview
export EXPO_PUBLIC_API_URL="$API_URL"
export EXPO_PUBLIC_APP_ORIGIN="$APP_ORIGIN"

pnpm install --frozen-lockfile
cd apps/mobile
npx expo prebuild --platform android --no-install
(cd android && ./gradlew assembleRelease --no-daemon)

apk="$(ls android/app/build/outputs/apk/release/*.apk | head -n 1)"
echo
echo "APK ready: $PWD/$apk"
