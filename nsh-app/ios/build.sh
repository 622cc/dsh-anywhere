#!/usr/bin/env bash
# Builds ios/build/DSH.app: the NSH app bundle plus NSH's iOS runtime and the Tailcat client inside the native shell.
#   NSH_SOURCE   an NSH checkout (as android/build.sh) where `cargo xtask ios-embed --no-catalyst --no-dev` has built
#                dist/nsh/embed/ios/NativeShell.xcframework, and `cargo build --release -p nsh-cli` the nsh CLI
#   DEVICE=1     build for a phone (needs DSH_TEAM, the Apple developer team that signs it); default: the simulator
#   DSH_DERIVED  Xcode's build folder (default ios/build/derived)
#   DSH_OUT      where DSH.app goes (default ios/build)
# The Tailcat framework comes from tools/build-tailcat.sh (IOS_ONLY=1) when ios/Frameworks lacks it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS="$ROOT/ios"
[ -n "${NSH_SOURCE:-}" ] || { echo "set NSH_SOURCE to an NSH checkout built as above" >&2; exit 2; }
command -v xcodegen >/dev/null || { echo "xcodegen is required (brew install xcodegen)" >&2; exit 2; }
NSH_BIN="$NSH_SOURCE/target/release/nsh"
mkdir -p "$IOS/Frameworks" "$IOS/build"
rm -rf "$IOS/Frameworks/NativeShell.xcframework"
cp -R "$NSH_SOURCE/dist/nsh/embed/ios/NativeShell.xcframework" "$IOS/Frameworks/"
[ -d "$IOS/Frameworks/Dshtailcat.xcframework" ] || IOS_ONLY=1 "$ROOT/../tools/build-tailcat.sh"
echo "NSH from source: $("$NSH_BIN" --version)"
rm -rf "$IOS/build/nsh"
"$NSH_BIN" build "$ROOT" --release --out "$IOS/build/nsh"
rm -f "$IOS/build/nsh/bundle.js" "$IOS/build/nsh/bundle.js.map"
version="$(python3 -c 'import json,sys; a=json.load(open(sys.argv[1])); print(a["version"], a["build"])' "$ROOT/nsh.json")"
(cd "$IOS" && xcodegen generate --quiet)
derived="${DSH_DERIVED:-$IOS/build/derived}"
if [ "${DEVICE:-}" = 1 ]; then
  [ -n "${DSH_TEAM:-}" ] || { echo "DEVICE=1 needs DSH_TEAM (the signing team id)" >&2; exit 2; }
  dest='generic/platform=iOS'; products=Release-iphoneos; sign=(DSH_TEAM="$DSH_TEAM" -allowProvisioningUpdates)
else
  dest='generic/platform=iOS Simulator'; products=Release-iphonesimulator; sign=(CODE_SIGN_IDENTITY=-)
fi
xcodebuild -quiet -project "$IOS/DSH.xcodeproj" -scheme DSH -configuration Release -destination "$dest" \
  -derivedDataPath "$derived" DSH_VERSION="${version% *}" DSH_BUILD="${version#* }" "${sign[@]}" build
out="${DSH_OUT:-$IOS/build}"; mkdir -p "$out"
rm -rf "$out/DSH.app"; cp -R "$derived/Build/Products/$products/DSH.app" "$out/DSH.app"
echo "→ $out/DSH.app ($(du -sh "$out/DSH.app" | cut -f1 | tr -d ' '))"
