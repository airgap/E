#!/usr/bin/env bash
# Build an AppImage for E.
#
# Bun-compiled binaries segfault under LD_TRACE_LOADED_OBJECTS=1 (how ldd
# works), which makes linuxdeploy abort. We work around this by:
#   1. Letting Tauri build deb/rpm (which don't run ldd on sidecars)
#   2. Assembling the AppDir from the deb data
#   3. Running linuxdeploy on the main Tauri binary only
#   4. Injecting the sidecar into the AppDir afterwards
#   5. Packing the AppImage with appimagetool / linuxdeploy --output
set -euo pipefail

ARCH="${ARCH:-x86_64}"
TRIPLE="${ARCH}-unknown-linux-gnu"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE="$ROOT/src-tauri/target/release"
BUNDLE="$RELEASE/bundle"
TOOLS="$HOME/.cache/tauri"
PRODUCT="E"
VERSION="0.1.0"
APPDIR="$BUNDLE/appimage/${PRODUCT}.AppDir"
OUTPUT="$BUNDLE/appimage/${PRODUCT}_${VERSION}_amd64.AppImage"

echo "==> Preparing AppDir from deb data"
rm -rf "$BUNDLE/appimage"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/lib"

# Copy the main Tauri binary
cp "$RELEASE/e" "$APPDIR/usr/bin/e"

# Copy icons and desktop file from deb
DEB_DATA="$BUNDLE/deb/E_${VERSION}_amd64/data"
if [ -d "$DEB_DATA/usr/share" ]; then
  cp -r "$DEB_DATA/usr/share" "$APPDIR/usr/"
fi

# Desktop file and icon at AppDir root (AppImage convention)
DESKTOP=$(find "$APPDIR/usr/share/applications" -name "*.desktop" -print -quit 2>/dev/null || true)
if [ -n "$DESKTOP" ]; then
  ln -sf "$DESKTOP" "$APPDIR/${PRODUCT}.desktop"
fi
ICON=$(find "$APPDIR/usr/share/icons" -name "*.png" -print | sort -t/ -k9 -rn | head -1)
if [ -n "$ICON" ]; then
  cp "$ICON" "$APPDIR/${PRODUCT}.png"
  ln -sf "$APPDIR/${PRODUCT}.png" "$APPDIR/.DirIcon"
fi

# Copy WebKit processes for AppImage portability
for f in WebKitNetworkProcess WebKitWebProcess; do
  for d in /usr/lib/x86_64-linux-gnu /usr/lib64 /usr/lib; do
    src="$d/webkit2gtk-4.1/$f"
    if [ -f "$src" ]; then
      mkdir -p "$APPDIR/$d/webkit2gtk-4.1"
      cp "$src" "$APPDIR/$d/webkit2gtk-4.1/"
      break
    fi
  done
done
INJECTED="$d/webkit2gtk-4.1/injected-bundle/libwebkit2gtkinjectedbundle.so"
if [ -f "$INJECTED" ]; then
  mkdir -p "$APPDIR/$(dirname "$INJECTED")"
  cp "$INJECTED" "$APPDIR/$INJECTED"
fi

# AppRun
APPRUN="$TOOLS/AppRun-${ARCH}"
if [ ! -f "$APPRUN" ]; then
  echo "==> Downloading AppRun"
  curl -fSL "https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-${ARCH}" -o "$APPRUN"
  chmod +x "$APPRUN"
fi
cp "$APPRUN" "$APPDIR/AppRun"

# Run linuxdeploy on the main binary ONLY (no sidecar in AppDir yet)
LINUXDEPLOY="$TOOLS/linuxdeploy-${ARCH}.AppImage"
if [ ! -f "$LINUXDEPLOY" ]; then
  echo "==> Downloading linuxdeploy"
  curl -fSL "https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/linuxdeploy-${ARCH}.AppImage" -o "$LINUXDEPLOY"
  chmod +x "$LINUXDEPLOY"
fi

GTK_PLUGIN="$TOOLS/linuxdeploy-plugin-gtk.sh"
if [ ! -f "$GTK_PLUGIN" ]; then
  curl -fSL "https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh" -o "$GTK_PLUGIN"
  chmod +x "$GTK_PLUGIN"
fi

echo "==> Running linuxdeploy (sidecar excluded)"
APPIMAGE_EXTRACT_AND_RUN=1 "$LINUXDEPLOY" \
  --appimage-extract-and-run \
  --appdir "$APPDIR" \
  --plugin gtk \
  --verbosity 1 \
  --desktop-file "$DESKTOP" \
  --icon-file "$APPDIR/${PRODUCT}.png" \
  --executable "$APPDIR/usr/bin/e"

# NOW inject the sidecar (after linuxdeploy is done scanning)
echo "==> Injecting sidecar binary"
cp "$ROOT/src-tauri/binaries/e-server-${TRIPLE}" "$APPDIR/usr/bin/e-server-${TRIPLE}"

# Pack the AppImage
echo "==> Packing AppImage"
ARCH="$ARCH" OUTPUT="$OUTPUT" APPIMAGE_EXTRACT_AND_RUN=1 "$LINUXDEPLOY" \
  --appimage-extract-and-run \
  --appdir "$APPDIR" \
  --output appimage

echo "==> Built: $OUTPUT"
