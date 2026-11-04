#!/usr/bin/env bash
# Builds ios/build/DSH.app: the NSH app bundle plus NSH's iOS runtime and the Tailcat client inside the native shell.
#   NSH_SOURCE   an NSH checkout (as android/build.sh) where `cargo xtask ios-embed --no-catalyst --no-dev` has built
#                dist/nsh/embed/ios/NativeShell.xcframework, and `cargo build --release -p nsh-cli` the nsh CLI
#   DEVICE=1     build for a phone, signed automatically with your own Apple team; needs DSH_TEAM and DSH_BUNDLE_PREFIX,
#                from the environment or ios/signing.env (see signing.env.example); default: the simulator
#   ARCHIVE=1    archive and export ios/build/export/DSH.ipa for App Store Connect, signed by hand: needs DSH_TEAM and
#                DSH_PROFILE (the name of an App Store profile for this app, installed on this Mac)
#   DSH_DERIVED  Xcode's build folder (default ios/build/derived)
#   DSH_OUT      where DSH.app goes (default ios/build)
# The Tailcat framework comes from tools/build-tailcat.sh (IOS_ONLY=1) when ios/Frameworks lacks it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS="$ROOT/ios"
# What is already in the environment wins over the file.
if [ -f "$IOS/signing.env" ]; then
  team="${DSH_TEAM:-}"; prefix="${DSH_BUNDLE_PREFIX:-}"
  . "$IOS/signing.env"
  DSH_TEAM="${team:-${DSH_TEAM:-}}"; DSH_BUNDLE_PREFIX="${prefix:-${DSH_BUNDLE_PREFIX:-}}"
fi
if [ "${DEVICE:-}" = 1 ]; then
  [ -n "${DSH_TEAM:-}" ] || { echo "DEVICE=1 needs DSH_TEAM, your Apple team id (see ios/signing.env.example)" >&2; exit 2; }
  [ -n "${DSH_BUNDLE_PREFIX:-}" ] || { echo "DEVICE=1 needs DSH_BUNDLE_PREFIX, the start of an app id of yours (see ios/signing.env.example)" >&2; exit 2; }
fi
export DSH_BUNDLE_PREFIX="${DSH_BUNDLE_PREFIX:-io.jingtao}"
[ -n "${NSH_SOURCE:-}" ] || { echo "set NSH_SOURCE to an NSH checkout built as above" >&2; exit 2; }
command -v xcodegen >/dev/null || { echo "xcodegen is required (brew install xcodegen)" >&2; exit 2; }
NSH_BIN="$NSH_SOURCE/target/release/nsh"
[ -x "$NSH_BIN" ] || { echo "no nsh CLI at \$NSH_SOURCE/target/release/nsh: run cargo build --release -p nsh-cli there" >&2; exit 2; }
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
if [ "${ARCHIVE:-}" = 1 ]; then
  [ -n "${DSH_TEAM:-}" ] && [ -n "${DSH_PROFILE:-}" ] || { echo "ARCHIVE=1 needs DSH_TEAM and DSH_PROFILE" >&2; exit 2; }
  out="${DSH_OUT:-$IOS/build}"; archive="$out/DSH.xcarchive"; rm -rf "$archive" "$out/export"; mkdir -p "$out"
  # The profile by target name: DSHKit, a static library in the same build, takes no profile.
  xcodebuild -quiet archive -project "$IOS/DSH.xcodeproj" -scheme DSH -configuration Release \
    -destination 'generic/platform=iOS' -derivedDataPath "$derived" -archivePath "$archive" \
    DSH_VERSION="${version% *}" DSH_BUILD="${version#* }" DSH_BUNDLE_PREFIX="$DSH_BUNDLE_PREFIX" DSH_TEAM="$DSH_TEAM" CODE_SIGN_STYLE=Manual \
    CODE_SIGN_IDENTITY="Apple Distribution" 'PROVISIONING_PROFILE_SPECIFIER=$(DSH_PROFILE_$(TARGET_NAME))' \
    DSH_PROFILE_DSH="$DSH_PROFILE"
  options="$out/ExportOptions.plist"
  cat > "$options" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>teamID</key><string>$DSH_TEAM</string>
<key>signingStyle</key><string>manual</string>
<key>signingCertificate</key><string>Apple Distribution</string>
<key>provisioningProfiles</key><dict><key>$DSH_BUNDLE_PREFIX.dshanywhere</key><string>$DSH_PROFILE</string></dict>
<key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
EOF
  xcodebuild -quiet -exportArchive -archivePath "$archive" -exportOptionsPlist "$options" -exportPath "$out/export"
  "$IOS/check-testflight.sh" "$archive/Products/Applications/DSH.app"
  echo "→ $out/export/DSH.ipa ($(du -sh "$out/export/DSH.ipa" | cut -f1 | tr -d ' '))"
  exit 0
fi
if [ "${DEVICE:-}" = 1 ]; then
  dest='generic/platform=iOS'; products=Release-iphoneos; sign=(DSH_TEAM="$DSH_TEAM" -allowProvisioningUpdates)
else
  dest='generic/platform=iOS Simulator'; products=Release-iphonesimulator; sign=(CODE_SIGN_IDENTITY=-)
fi
xcodebuild -quiet -project "$IOS/DSH.xcodeproj" -scheme DSH -configuration Release -destination "$dest" \
  -derivedDataPath "$derived" DSH_VERSION="${version% *}" DSH_BUILD="${version#* }" \
  DSH_BUNDLE_PREFIX="$DSH_BUNDLE_PREFIX" "${sign[@]}" build
out="${DSH_OUT:-$IOS/build}"; mkdir -p "$out"
rm -rf "$out/DSH.app"; cp -R "$derived/Build/Products/$products/DSH.app" "$out/DSH.app"
echo "→ $out/DSH.app ($(du -sh "$out/DSH.app" | cut -f1 | tr -d ' '))"
