#!/usr/bin/env bash
# Checks a built DSH.app before it goes to App Store Connect: right id and version, built for a phone, signed for
# distribution, the export-compliance answer and the privacy manifest inside, no path from the build machine.
#   check-testflight.sh path/to/DSH.app
# Prints one line per check and exits 1 if any fails.
set -uo pipefail
app="${1:?usage: check-testflight.sh path/to/DSH.app}"
root="$(cd "$(dirname "$0")/.." && pwd)"
plist="$app/Info.plist"
bad=0
ok() { echo "ok    $1"; }
no() { echo "FAIL  $1"; bad=1; }
is() { [ "$2" = "$3" ] && ok "$1 = $3" || no "$1 is '$2', expected '$3'"; }
key() { /usr/libexec/PlistBuddy -c "Print :$1" "$2" 2>/dev/null; }

read -r want_version want_build < <(python3 -I -c 'import json,sys; a=json.load(open(sys.argv[1])); print(a["version"], a["build"])' "$root/nsh.json")
is "bundle id" "$(key CFBundleIdentifier "$plist")" "${DSH_BUNDLE_PREFIX:-io.jingtao}.dshanywhere"
is "version" "$(key CFBundleShortVersionString "$plist")" "$want_version"
is "build" "$(key CFBundleVersion "$plist")" "$want_build"
is "platform" "$(key DTPlatformName "$plist")" iphoneos
is "export compliance answer" "$(key ITSAppUsesNonExemptEncryption "$plist")" false

# Permission texts in all eight languages. Local network: Tailcat dials the computer's Wi-Fi address when it can, and
# Apple asks any app that does to explain why (TN3179).
for text in NSCameraUsageDescription NSLocalNetworkUsageDescription; do
  [ -n "$(key "$text" "$plist")" ] && ok "$text in Info.plist" || no "$text missing from Info.plist"
  for lang in en zh-Hans zh-Hant es fr ko ja ru; do
    [ -n "$(key "$text" "$app/$lang.lproj/InfoPlist.strings")" ] || no "$text missing in $lang"
  done
done

# Every required-reason API the binary imports has to be declared (Apple's list, TN3183 / "Describing use of required
# reason API"), or App Store Connect reports ITMS-91053.
binary="$app/$(key CFBundleExecutable "$plist")"
manifest="$app/PrivacyInfo.xcprivacy"
if [ -f "$manifest" ]; then
  ok "privacy manifest present"
  imports="$(nm -u "$binary" 2>/dev/null)"
  strs="$(strings -a "$binary" 2>/dev/null)"
  need() { # category, regex for imported symbols, regex for selectors in the binary
    if grep -Eq "$2" <<<"$imports" || { [ -n "$3" ] && grep -Eq "$3" <<<"$strs"; }; then
      grep -q "$1" "$manifest" && ok "declared $1" || no "binary uses $1 and the manifest does not declare it"
    fi
  }
  need NSPrivacyAccessedAPICategoryFileTimestamp '^ *_(f?stat(at)?|lstat|f?getattrlist(at|bulk)?)(\$.*)?$' '^(creationDate|modificationDate|fileModificationDate|contentModificationDateKey|creationDateKey)$'
  need NSPrivacyAccessedAPICategorySystemBootTime '^ *_mach_absolute_time$' '^systemUptime$'
  need NSPrivacyAccessedAPICategoryDiskSpace '^ *_f?stat(v)?fs(\$.*)?$' '^(volumeAvailableCapacity|systemFreeSize|systemSize)'
  need NSPrivacyAccessedAPICategoryUserDefaults '^ *_OBJC_CLASS_\$_NSUserDefaults$' ''
else
  no "no PrivacyInfo.xcprivacy in the app"
fi

# Everything inside the app, not only the binary: the NSH bundle and the resources ship to testers as well.
found=0
while IFS= read -r -d '' file; do
  n="$(strings -a "$file" 2>/dev/null | grep -cE '(/Users/[^/ ]+/|/Volumes/[^/ ]+|/var/folders/)')"
  if [ "$n" -gt 0 ]; then echo "      $n in ${file#"$app"/}"; found=$((found + n)); fi
done < <(find "$app" -type f -print0)
[ "$found" = 0 ] && ok "no path from the build machine in the app" || no "$found paths from a machine in the app"

# Only for a build signed for distribution; a simulator build fails here on purpose.
ent="$(mktemp)"
codesign -d --entitlements - --xml "$app" >"$ent" 2>/dev/null
is "get-task-allow" "$(key get-task-allow "$ent")" false
is "beta-reports-active" "$(key beta-reports-active "$ent")" true
rm -f "$ent"
authority="$(codesign -dvv "$app" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
case "$authority" in "Apple Distribution:"*) ok "signed with Apple Distribution";; *) no "signing identity is '${authority:-none}'";; esac

exit "$bad"
