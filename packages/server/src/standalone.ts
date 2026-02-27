/**
 * standalone.ts — entrypoint for the self-contained binary distribution.
 *
 * Differences from the standard index.ts:
 *
 *  1. CLIENT_DIST defaults to `<binary-dir>/client` (co-located folder) instead
 *     of the monorepo-relative `../../client/build` path.  This means the binary
 *     works correctly when run from any directory — no env var needed.
 *
 *  2. Supports OPEN=1 environment variable: after the server is ready it opens
 *     the URL in the user's default browser, mirroring the "dev mode" experience.
 *
 *  3. Always binds to a fixed port (default 3002, override with PORT=<n>).
 *     Sidecar-style dynamic port (PORT=0) is intentionally unsupported here.
 *
 * Everything else (routes, database, auth, TLS, WebSockets) is identical to the
 * regular server — this file just patches the two env vars before the main
 * module loads, then delegates entirely.
 */

import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// ── Resolve CLIENT_DIST relative to the compiled binary ──────────────────────
// In a Bun compiled binary, import.meta.dir is the directory containing the
// executable, not the source file.  This makes the co-located `client/` folder
// discoverable regardless of where the user invokes the binary from.
if (!process.env.CLIENT_DIST) {
  process.env.CLIENT_DIST = resolve(import.meta.dir, 'client');
}

// ── Ensure a non-zero port so the server stays alive ─────────────────────────
// PORT=0 (dynamic sidecar mode) would exit without binding.  Default to 3002.
if (!process.env.PORT) {
  process.env.PORT = '3002';
}

// ── Import the main server (must happen AFTER env is set) ────────────────────
// Dynamic import lets us set env vars first without a separate preload step.
const { default: serverConfig } = await import('./index');

// ── Auto-open browser when OPEN=1 ────────────────────────────────────────────
if (process.env.OPEN === '1' && serverConfig) {
  const port = serverConfig.port ?? Number(process.env.PORT);
  const protocol = process.env.TLS_CERT ? 'https' : 'http';
  const url = `${protocol}://localhost:${port}`;

  // Brief delay so the server is accepting connections before the browser loads
  setTimeout(() => openBrowser(url), 500);
}

function openBrowser(url: string) {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      execSync(`open ${url}`);
    } else if (platform === 'win32') {
      execSync(`start ${url}`, { shell: 'cmd.exe' });
    } else {
      // Linux — try common launchers in order
      for (const cmd of ['xdg-open', 'sensible-browser', 'x-www-browser']) {
        try {
          execSync(`${cmd} ${url} &`);
          break;
        } catch {
          // try next
        }
      }
    }
  } catch {
    // Opening a browser is best-effort; never crash the server over it
    console.log(`  → Open in browser: ${url}`);
  }
}
