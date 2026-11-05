#!/usr/bin/env bash
# Builds the Tailcat helper binaries into host/dist/tailcat/, the Android AAR into
# nsh-app/android/app/libs/dshtailcat.aar and, with IOS_ONLY=1, the iOS framework into
# nsh-app/ios/Frameworks/Dshtailcat.xcframework (all gitignored). Contract: docs/TAILCAT.md.
#   HELPERS_ONLY=1  build only the helper binaries
#   AAR_ONLY=1      build only the Android AAR (needs ANDROID_HOME/ANDROID_SDK_ROOT and ANDROID_NDK_HOME)
#   IOS_ONLY=1      build only the iOS xcframework, device and simulator (needs Xcode)
# Go 1.27.3 (toolchain line in tailcat/go.mod; fixes stdlib advisories in 1.27.1) is downloaded by any Go >=1.21.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
module="$root/tailcat"
go_version="1.27.3"
tailcat_pin="github.com/tailscale/tailcat v0.6.0"

fail() { echo "build-tailcat: $*" >&2; exit 1; }

if [[ "$(uname -s)" == Darwin ]]; then
  clang="$(xcrun --find clang)"
  mac_sdk="$(xcrun --sdk macosx --show-sdk-path)"
  mac_flags="-mmacosx-version-min=14.0 -isysroot $mac_sdk"
  export SSL_CERT_FILE="${SSL_CERT_FILE:-/etc/ssl/cert.pem}"
fi
command -v go >/dev/null 2>&1 || fail "go is not on PATH; install Go ${go_version} or any Go >=1.21 that can download it"
export GOTOOLCHAIN="go${go_version}"
export GOFLAGS="-mod=readonly"
cd "$module"
[[ "$(go version)" == *"go${go_version} "* ]] || fail "toolchain is '$(go version)', tailcat/go.mod requires go${go_version}"
[[ "$(go list -m github.com/tailscale/tailcat)" == "$tailcat_pin" ]] || fail "tailcat module is not the pinned ${tailcat_pin#* }"
mobile_version="$(go list -m -f '{{.Version}}' golang.org/x/mobile)"

# gomobile writes the folder it binds into the library's Go build info (-trimpath leaves it), so it binds a copy in a
# fixed folder: the checkout's path, the user name and macOS's per-user temporary folder all stay out of the app.
bind_folder="/tmp/dsh-anywhere-bind"
bind_copy() {
  rm -rf "$bind_folder"
  mkdir -p "$bind_folder"
  cp -R "$module/." "$bind_folder/tailcat"
}
refuse_machine_paths() { # <folder to read> <library to remove on failure>
  if LC_ALL=C grep -a -r -q -F -e "/var/folders/" -e "$HOME" -e "$root" "$1"; then
    rm -rf "$2"
    fail "a path from this machine is in the library; removed it"
  fi
}

build_helpers() {
  local out="$root/host/dist/tailcat"
  mkdir -p "$out"
  local target goos goarch name
  for target in darwin/arm64 darwin/amd64 windows/amd64 linux/amd64; do
    goos="${target%/*}"; goarch="${target#*/}"
    name="dsh-tailcat-host-${goos}-${goarch}"
    [[ "$goos" == windows ]] && name="${name}.exe"
    if [[ "$goos" == darwin ]]; then
      CGO_ENABLED=1 GOOS="$goos" GOARCH="$goarch" CC="$clang" CGO_CFLAGS="$mac_flags" CGO_LDFLAGS="$mac_flags" \
        go build -trimpath -tags ts_omit_ssh -ldflags='-s -w' -o "$out/$name" ./host
    else
      CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
        go build -trimpath -tags ts_omit_ssh -ldflags='-s -w' -o "$out/$name" ./host
    fi
    echo "helper ready: host/dist/tailcat/$name"
  done
}

build_aar() {
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  [[ -n "$sdk" && -d "$sdk" ]] || fail "ANDROID_HOME (or ANDROID_SDK_ROOT) must point to an Android SDK with platform 36"
  [[ -n "${ANDROID_NDK_HOME:-}" && -d "$ANDROID_NDK_HOME" ]] || fail "ANDROID_NDK_HOME must point to an installed Android NDK"
  command -v javac >/dev/null 2>&1 || fail "javac (JDK 17+) is required by gomobile bind"
  local bin="$root/build/tailcat-gobin"
  mkdir -p "$bin" "$root/nsh-app/android/app/libs"
  # gomobile and gobind must match the golang.org/x/mobile version pinned in tailcat/go.mod.
  GOBIN="$bin" GOFLAGS= go install "golang.org/x/mobile/cmd/gomobile@${mobile_version}" "golang.org/x/mobile/cmd/gobind@${mobile_version}"
  bind_copy
  (cd "$bind_folder/tailcat" && PATH="$bin:$PATH" ANDROID_HOME="$sdk" "$bin/gomobile" bind \
    -target=android/arm64,android/arm,android/amd64 -androidapi 26 \
    -javapkg dev.dshmobile.tailcat -trimpath -ldflags='-s -w' -tags ts_omit_ssh \
    -o "$root/nsh-app/android/app/libs/dshtailcat.aar" ./mobile) || { rm -rf "$bind_folder"; fail "gomobile bind failed"; }
  rm -rf "$bind_folder"
  local unpacked; unpacked="$(mktemp -d)" # the AAR is a zip: its libraries are unpacked to be read
  unzip -q "$root/nsh-app/android/app/libs/dshtailcat.aar" 'jni/*' -d "$unpacked"
  refuse_machine_paths "$unpacked" "$root/nsh-app/android/app/libs/dshtailcat.aar"
  rm -rf "$unpacked"
  echo "aar ready: nsh-app/android/app/libs/dshtailcat.aar"
}

build_xcframework() {
  [[ "$(uname -s)" == Darwin ]] || fail "the iOS framework builds only on macOS with Xcode"
  local bin="$root/build/tailcat-gobin" out="$root/nsh-app/ios/Frameworks"
  mkdir -p "$bin" "$out"
  GOBIN="$bin" GOFLAGS= go install "golang.org/x/mobile/cmd/gomobile@${mobile_version}" "golang.org/x/mobile/cmd/gobind@${mobile_version}"
  bind_copy
  rm -rf "$out/Dshtailcat.xcframework"
  (cd "$bind_folder/tailcat" && PATH="$bin:$PATH" "$bin/gomobile" bind \
    -target=ios/arm64,iossimulator/arm64 -iosversion 16.0 \
    -trimpath -ldflags='-s -w' -tags ts_omit_ssh \
    -o "$out/Dshtailcat.xcframework" ./mobile) || { rm -rf "$bind_folder"; fail "gomobile bind failed"; }
  rm -rf "$bind_folder"
  refuse_machine_paths "$out/Dshtailcat.xcframework" "$out/Dshtailcat.xcframework"
  echo "xcframework ready: nsh-app/ios/Frameworks/Dshtailcat.xcframework"
}

if [[ "${IOS_ONLY:-}" == 1 ]]; then build_xcframework; exit 0; fi
[[ "${HELPERS_ONLY:-}" == 1 && "${AAR_ONLY:-}" == 1 ]] && fail "choose at most one of HELPERS_ONLY and AAR_ONLY"
if [[ "${AAR_ONLY:-}" != 1 ]]; then build_helpers; fi
if [[ "${HELPERS_ONLY:-}" != 1 ]]; then
  if [[ "${AAR_ONLY:-}" == 1 || -n "${ANDROID_NDK_HOME:-}" ]]; then
    build_aar
  else
    echo "build-tailcat: ANDROID_NDK_HOME not set; skipped the Android AAR (set it, or AAR_ONLY=1 to require it)" >&2
  fi
fi
