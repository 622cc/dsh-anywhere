#!/bin/sh
# Renders the iOS app icon PNGs from assets/brand/*.svg with headless Chrome (CHROME overrides the browser's path).
# Android needs no PNGs: its adaptive icon is the vector in android/app/src/main/res/drawable/ic_launcher_foreground.xml.
# Usage: sh scripts/app-icon.sh   (run again after changing an SVG; the PNGs are tracked)
set -eu
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT=ios/DSH/Assets.xcassets/AppIcon.appiconset
render() { # svg png [transparent]
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 \
    ${3:+--default-background-color=00000000} --screenshot="$PWD/$2" "file://$PWD/$1" 2>/dev/null
}
render assets/brand/icon.svg "$OUT/icon.png"                        # opaque, no alpha: what the App Store takes
render assets/brand/icon-foreground.svg "$OUT/icon-dark.png" yes    # iOS 18 dark: the system draws the background
render assets/brand/icon-monochrome.svg "$OUT/icon-tinted.png" yes  # iOS 18 tinted: tinted by brightness
