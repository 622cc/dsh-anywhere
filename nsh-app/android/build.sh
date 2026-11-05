#!/usr/bin/env bash
# Builds android/build/DSH.apk: the NSH app bundle plus NSH's runtime inside the native shell.
# NSH comes from a checkout of the dsh-anywhere branch of github.com/jt-wang/nsh, built with `cargo build --release -p nsh-cli`
# and `cargo xtask android --release --abi arm64-v8a`, in NSH_SOURCE: the app uses its line-clamp and value events and
# needs its Android text-width and wss fixes, none of which v0.3.0 (the latest release) has. Until upstream has them, the
# checkout also carries Android fixes prepared as NSH pull requests: Keyboard.dismiss() after the focused field is removed; an
# input's text field keeping its content box when the input shrinks (without it the composer stops taking text after a
# wrapped message is sent); a list inside a swipe-to-close sheet scrolling (the model list); a tap in a scroll view hiding
# the keyboard when the field is outside it; a readonly input keeping its selection (Select text); and sheets moving on
# Material 3's emphasized curves.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
NSH_HOME="${NSH_HOME:-$HOME/.nsh}"
NSH_BIN="nsh"
APP="$ROOT/android/app"
mkdir -p "$APP/libs"; cp "$NSH_HOME/embed/android/nsh.aar" "$APP/libs/nsh.aar"
[ -n "${NSH_SOURCE:-}" ] || { echo "set NSH_SOURCE to an NSH checkout built as above" >&2; exit 2; }
NSH_BIN="$NSH_SOURCE/target/release/nsh"
built="$NSH_SOURCE/target/android/release"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/jni/arm64-v8a"
cp "$built/classes.jar" "$work/classes.jar"; cp "$built/lib/arm64-v8a/libnsh.so" "$work/jni/arm64-v8a/libnsh.so"
zip -q -d "$APP/libs/nsh.aar" 'jni/*' >/dev/null
(cd "$work" && zip -q -0 "$APP/libs/nsh.aar" classes.jar jni/arm64-v8a/libnsh.so)
echo "NSH from source: $("$NSH_BIN" --version)"
rm -rf "$APP/src/main/assets/nsh"
"$NSH_BIN" build "$ROOT" --release --out "$APP/src/main/assets/nsh"
rm -f "$APP/src/main/assets/nsh/bundle.js" "$APP/src/main/assets/nsh/bundle.js.map"
(cd "$ROOT/android" && ./gradlew --quiet assembleRelease)
mkdir -p "$ROOT/android/build"; cp "$APP/build/outputs/apk/release/app-release.apk" "$ROOT/android/build/DSH.apk"
echo "→ android/build/DSH.apk ($(du -h "$ROOT/android/build/DSH.apk" | cut -f1 | tr -d ' '))"
