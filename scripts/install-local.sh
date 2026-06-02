#!/usr/bin/env bash
#
# Local installer for a checked-out E repo.
#
# Builds the standalone distribution from the working tree and installs it into
# ~/.e — with NO network and NO release download. Use this when the public
# `curl … | install.sh` route is blocked (corporate proxy, offline, air-gapped)
# or when you want to install exactly what's in your working tree.
#
# Usage:
#   bun run install:local                     # build, then install
#   bash scripts/install-local.sh
#   bash scripts/install-local.sh --no-build  # install the last build as-is
#   bash scripts/install-local.sh --register-file-types   # flags pass through
#                                                          # to install.sh
#
# Honors $E_INSTALL (default ~/.e), same as install.sh.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# ── Parse args (avoid "$@" expansion for old bash 3.2 / set -u on macOS) ──────
build=1
passthrough=()
while [ "$#" -gt 0 ]; do
    case $1 in
    --no-build) build=0 ;;
    *) passthrough+=("$1") ;;
    esac
    shift
done

# ── Host target suffix — must match scripts/build-standalone.ts platformSuffix ─
case "$(uname -s)" in
'Darwin') plat=darwin ;;
'Linux') plat=linux ;;
MINGW* | MSYS* | CYGWIN*) plat=windows ;;
*)
    echo "install-local: unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac
case "$(uname -m)" in
arm64 | aarch64) arch=arm64 ;;
*) arch=x64 ;;
esac
suffix="$plat-$arch"

# build-standalone.ts leaves the un-tarred staged dir here (binary renamed to
# `e`, plus client/ and e.png) — exactly the layout install.sh's local mode wants.
staged="$root/dist/standalone/pkg/e-$suffix"

if [ "$build" = 1 ]; then
    echo "▸ Building standalone for $suffix…"
    (cd "$root" && bun run build:standalone)
fi

if [ ! -f "$staged/e" ] && [ ! -f "$staged/e.exe" ]; then
    echo "install-local: no build found at $staged" >&2
    echo "  run without --no-build to build it first." >&2
    exit 1
fi

echo "▸ Installing from $staged"
# Hand off to the canonical installer in local mode so all the symlink / PATH /
# desktop-entry logic is shared. Safe empty-array expansion for bash 3.2.
E_LOCAL_DIST="$staged" bash "$root/install.sh" ${passthrough[@]+"${passthrough[@]}"}
