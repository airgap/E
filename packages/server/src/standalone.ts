/**
 * standalone.ts — entrypoint for the self-contained binary distribution.
 *
 * Differences from the standard index.ts:
 *
 *  1. CLIENT_DIST defaults to `<binary-dir>/client` (co-located folder) instead
 *     of the monorepo-relative `../../client/build` path.  This means the binary
 *     works correctly when run from any directory — no env var needed.
 *
 *  2. Opens the app in the user's default browser after the server is ready.
 *     `e` / `e <file>` / `e <dir>` all open (the bare form opens the current
 *     directory as a workspace). Suppress with `e serve` or OPEN=0 for
 *     headless/server deployments.
 *
 *  3. Always binds to a fixed port (default 3002, override with PORT=<n>).
 *     Sidecar-style dynamic port (PORT=0) is intentionally unsupported here.
 *
 * Everything else (routes, database, auth, TLS, WebSockets) is identical to the
 * regular server — this file just patches the two env vars before the main
 * module loads, then delegates entirely.
 */

import { resolve, dirname } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { isFileTypesCommand, runFileTypesCommand } from './file-associations/cli';
import { resolveOpenTarget, openTargetUrl, openBrowser, type OpenTarget } from './serve-and-open';

// ── Headless subcommands ─────────────────────────────────────────────────────
// Intercept file-type (un)registration before the server boots so the
// installer can call `e register-file-types` without spinning up a server.
{
  const sub = process.argv[2];
  if (isFileTypesCommand(sub)) {
    await runFileTypesCommand(sub); // exits the process
  }
}

// ── What to open in the browser ──────────────────────────────────────────────
// Default behavior is to open the app:
//   e            → open the current directory as a workspace
//   e <file>     → open the file (also the OS file-handler path, `Exec=e %F`)
//   e <dir>      → open the directory as a workspace
//   e serve      → just run the server, don't open anything (headless)
// OPEN=0 also suppresses opening, for server deployments.
const firstArg = process.argv[2];
const headless = firstArg === 'serve' || process.env.OPEN === '0';
let openTarget: OpenTarget | undefined;
if (!headless) {
  // `serve` is a directive, not a path; everything else (incl. nothing) resolves
  // through resolveOpenTarget, which falls back to cwd for no/flag args.
  openTarget = resolveOpenTarget(firstArg);
}

// ── Resolve CLIENT_DIST relative to the compiled binary ──────────────────────
// The co-located `client/` folder lives next to the executable. In a Bun
// `--compile` binary `import.meta.dir` does NOT point at the executable (it's a
// virtual path inside the bundle), so resolving against it fails and `/` 404s.
// `process.execPath` is the real binary path; resolve the binary's *real* dir
// (the installer symlinks `bin/e -> e-<platform>/e`, so follow the link), then
// fall back to import.meta.dir for `bun run` dev mode.
if (!process.env.CLIENT_DIST) {
  const candidates = [
    resolve(dirname(realpathSync(process.execPath)), 'client'),
    resolve(import.meta.dir, 'client'),
  ];
  process.env.CLIENT_DIST = candidates.find((p) => existsSync(p)) ?? candidates[0];
}

// ── Ensure a non-zero port so the server stays alive ─────────────────────────
// PORT=0 (dynamic sidecar mode) would exit without binding.  Default to 3002.
if (!process.env.PORT) {
  process.env.PORT = '3002';
}

// ── Import the main server (must happen AFTER env is set) ────────────────────
// Dynamic import lets us set env vars first without a separate preload step.
// index.ts calls Bun.serve() at module-eval time; the default export is no
// longer used to wire up the server, so we just read the port from env.
await import('./index');

// ── Open the browser unless running headless ─────────────────────────────────
if (!headless) {
  const port = Number(process.env.PORT);
  const protocol = process.env.TLS_CERT ? 'https' : 'http';
  const base = `${protocol}://localhost:${port}`;
  const url = openTarget ? openTargetUrl(base, openTarget) : base;

  // Brief delay so the server is accepting connections before the browser loads
  setTimeout(() => openBrowser(url), 500);
}
