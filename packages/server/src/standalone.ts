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

import { resolve, dirname, join } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { isRegistrarCommand, runRegistrarCommand } from './file-associations/cli';
import { resolveOpenTarget, openTargetUrl, openBrowser, type OpenTarget } from './serve-and-open';

/**
 * Locate the Electron desktop launcher so `e` opens the native app by default.
 * Order: explicit override → dev electron (node_modules) → installed app.
 * Returns null when no Electron is available (server-only box), so the caller
 * falls back to the built-in server + browser.
 */
function findElectronLaunch(): { cmd: string; args: string[] } | null {
  if (process.env.E_ELECTRON && existsSync(process.env.E_ELECTRON)) {
    return { cmd: process.env.E_ELECTRON, args: [] };
  }
  // dev / monorepo checkout: node_modules electron + the electron entry
  try {
    let dir = dirname(realpathSync(process.execPath));
    for (let i = 0; i < 7; i++) {
      const elBin = resolve(dir, 'node_modules/.bin/electron');
      if (existsSync(elBin) && existsSync(resolve(dir, 'electron/dist/main.cjs'))) {
        return { cmd: elBin, args: [dir] };
      }
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {
    /* execPath unreadable — skip */
  }
  // installed desktop app (electron-builder productName "E")
  const home = process.env.HOME ?? '';
  const installed =
    process.platform === 'darwin'
      ? ['/Applications/E.app/Contents/MacOS/E']
      : process.platform === 'win32'
        ? [join(process.env.LOCALAPPDATA ?? '', 'Programs', 'E', 'E.exe')]
        : ['/opt/E/e', join(home, '.e', 'desktop', 'e')];
  for (const c of installed) if (c && existsSync(c)) return { cmd: c, args: [] };
  return null;
}

/** Best-effort probe: does something already answer HTTP at `base`? */
async function isServerUp(base: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 400);
    // Any response (even 401/404) means the port is taken by a live server.
    await fetch(base, { signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

// ── Headless subcommands ─────────────────────────────────────────────────────
// Intercept registrar commands (file-type association + applications-menu
// entry) before the server boots so the installer can call e.g.
// `e install-desktop` / `e register-file-types` without spinning up a server.
{
  const sub = process.argv[2];
  if (isRegistrarCommand(sub)) {
    // Extra tokens (e.g. the extension subset for `register-file-types ts py`)
    // are forwarded as args.
    await runRegistrarCommand(sub, process.argv.slice(3)); // exits the process
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
// Server-only mode: `e --headless` (explicit), legacy `e serve`, or OPEN=0.
// Otherwise `e` launches the desktop (Electron) app by default.
const headless =
  firstArg === 'serve' || process.argv.slice(2).includes('--headless') || process.env.OPEN === '0';
let openTarget: OpenTarget | undefined;
if (!headless) {
  // `serve` is a directive, not a path; everything else (incl. nothing) resolves
  // through resolveOpenTarget, which falls back to cwd for no/flag args.
  openTarget = resolveOpenTarget(firstArg);

  // If an instance is already serving (e.g. launched again from the
  // applications menu), don't try to bind the port — that would fail. Just
  // point the browser at the running app and exit.
  const port = Number(process.env.PORT) || 3002;
  const protocol = process.env.TLS_CERT ? 'https' : 'http';
  const base = `${protocol}://localhost:${port}`;
  if (await isServerUp(base)) {
    openBrowser(openTarget ? openTargetUrl(base, openTarget) : base);
    process.exit(0);
  }

  // This is the SERVER artifact (the curl|bash install): it serves by default
  // and opens a browser. The native window lives in the separate E Desktop
  // package. `e --desktop` is an opt-in shortcut that launches the desktop app
  // if it happens to be installed; otherwise we just serve.
  if (process.argv.slice(2).includes('--desktop')) {
    const electron = findElectronLaunch();
    if (electron) {
      const fileArgs = openTarget?.kind === 'file' ? [`--e-open-file=${openTarget.path}`] : [];
      try {
        spawn(electron.cmd, [...electron.args, ...fileArgs], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        process.exit(0);
      } catch {
        /* couldn't launch — fall through to server + browser */
      }
    } else {
      console.warn('[e] --desktop: no E Desktop app found; starting the server instead.');
    }
  }
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
