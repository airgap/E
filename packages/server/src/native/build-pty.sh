#!/usr/bin/env bash
# Build the pty-helper native binary (cross-platform).
# Exits 0 on success or when skipped (unsupported platform).
# Exits non-zero only on unexpected compile failure.

set -euo pipefail
cd "$(dirname "$0")"

case "$(uname -s)" in
  Linux*)   LIBS="-lutil" ;;
  Darwin*)  LIBS="" ;;          # macOS: forkpty is in libutil built into libc
  FreeBSD*) LIBS="-lutil" ;;
  *)
    echo "pty-helper: skipping build on $(uname -s) (no PTY support)"
    exit 0
    ;;
esac

# Skip if no C compiler available
if ! command -v gcc &>/dev/null && ! command -v cc &>/dev/null; then
  echo "pty-helper: no C compiler found, skipping"
  exit 0
fi

CC="${CC:-$(command -v gcc || command -v cc)}"
exec "$CC" -O2 -o pty-helper pty-helper.c $LIBS
