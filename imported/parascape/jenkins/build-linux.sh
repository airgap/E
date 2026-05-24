#!/bin/bash
set -euo pipefail

echo "=== Parascape desktop build (Linux) ==="

# This box already has the toolchain (Rust, parabun, webkit2gtk-4.1) — it's
# where the bundles were first built by hand. The Jenkins agent shell doesn't
# inherit a login PATH, so add the usual install locations explicitly.
export PATH="/usr/local/bin:$HOME/.cargo/bin:$HOME/.parabun/bin:$PATH"
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

command -v parabun >/dev/null || { echo "parabun not found on PATH" >&2; exit 1; }
command -v cargo   >/dev/null || { echo "cargo/rust not found on PATH" >&2; exit 1; }
parabun --version
cargo --version

echo "=== Installing dependencies ==="
parabun install

echo "=== Building dist + staging the parabun sidecar ==="
# PARASCAPE_RUNNER=parabun: tauri-prep.mjs shells out to `<runner> run build`,
# and the agent has parabun (not stock `bun`) on PATH.
PARASCAPE_RUNNER=parabun parabun scripts/tauri-prep.mjs

echo "=== Building the Tauri bundles (.deb/.rpm/.AppImage) ==="
parabun x tauri build

echo "=== Bundles ==="
ls -lh src-tauri/target/release/bundle/deb/*.deb \
       src-tauri/target/release/bundle/rpm/*.rpm \
       src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null || true
