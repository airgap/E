/**
 * Electron main process — E desktop shell.
 *
 * Replaces src-tauri/. Same behaviour as Tauri's main: spawns the e-server
 * sidecar on a free port, opens a BrowserWindow pointed at it, and tears the
 * sidecar down on quit. Sidecar origin is injected into the page via the
 * preload script so packages/client's api/client.ts sees __TAURI_SIDECAR_ORIGIN__
 * exactly as it did under Tauri (no client changes needed for the API path).
 *
 * Phase 1 deliberately keeps the native window frame so we can verify HTML5
 * drag works in Chromium without juggling custom-titlebar shims; Phase 2 will
 * switch to frame:false + the window-controls/device-API shim.
 */
import { app, BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REMOTE = process.env.E_REMOTE ?? null;

let serverProc: ChildProcess | null = null;

function findFreePort(): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rejectP);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolveP(port));
      } else {
        rejectP(new Error('failed to read port from listener'));
      }
    });
  });
}

/** Walk a few likely locations for the compiled e-server binary. */
function findServerBinary(): string {
  const appRoot = app.getAppPath();
  // build:binary writes `e-server`; suffix-binary renames it to
  // `e-server-<triple>` for Tauri. Either is fine for Electron — pick what's
  // there. (In a packaged Electron build, the binary is bundled as a single
  // unsuffixed file under resources/server/.)
  const binDirs = [
    resolve(appRoot, 'src-tauri/binaries'),
    resolve(__dirname, '..', '..', 'src-tauri/binaries'),
    join(process.resourcesPath ?? '', 'server'),
  ];
  const tried: string[] = [];
  for (const dir of binDirs) {
    if (!existsSync(dir)) continue;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    // Prefer the unsuffixed binary; fall back to any `e-server-*` triple.
    const match =
      names.find((n) => n === 'e-server' || n === 'e-server.exe') ??
      names.find((n) => n.startsWith('e-server-') && !n.endsWith('.dwarf'));
    if (match) return join(dir, match);
    tried.push(`${dir}/e-server*`);
  }
  throw new Error(
    `e-server binary not found. Looked in:\n  ${tried.join('\n  ')}\n` +
      `Run: bun run --filter @e/server build:binary`,
  );
}

function findClientDist(): string {
  const appRoot = app.getAppPath();
  const candidates = [
    resolve(appRoot, 'packages/client/build'),
    resolve(__dirname, '..', '..', 'packages/client/build'),
    join(process.resourcesPath ?? '', 'client'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(`client build not found. Run: bun run --filter @e/client build`);
}

async function startSidecar(): Promise<number> {
  const port = await findFreePort();
  const binary = findServerBinary();
  const clientDist = findClientDist();
  console.log(`[e] sidecar: ${binary} (port ${port})`);

  serverProc = spawn(binary, [], {
    env: {
      ...process.env,
      PORT: String(port),
      CLIENT_DIST: clientDist,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout?.on('data', (b: Buffer) => process.stdout.write(`[e-server] ${b}`));
  serverProc.stderr?.on('data', (b: Buffer) => process.stderr.write(`[e-server] ${b}`));
  serverProc.on('exit', (code, sig) => {
    console.error(`[e-server] exited code=${code} signal=${sig ?? '∅'}`);
  });

  return port;
}

async function waitForHealth(origin: string, timeoutMs = 15_000): Promise<boolean> {
  const url = `http://${origin}/health`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function createMainWindow() {
  let origin: string;
  if (REMOTE) {
    console.log(`[e] remote mode: connecting to ${REMOTE}`);
    origin = REMOTE;
  } else {
    const port = await startSidecar();
    origin = `localhost:${port}`;
  }

  const ready = await waitForHealth(origin);
  if (!ready) console.error(`[e] sidecar health-check timed out @ http://${origin}/health`);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'E',
    // Phase 1: native frame on, so we can verify HTML5 drag works without also
    // re-implementing custom window controls. Phase 2 will set frame:false +
    // shim window.__TAURI__.window.* via the preload.
    frame: true,
    webPreferences: {
      preload: resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Passed through to preload via process.argv so the origin is set on
      // window BEFORE any client JS runs (and on every reload).
      additionalArguments: [`--e-sidecar-origin=${origin}`],
    },
  });

  win.loadURL(`http://${origin}/`);
}

app
  .whenReady()
  .then(createMainWindow)
  .catch((err) => {
    console.error('[e] startup failed:', err);
    app.quit();
  });

function killSidecar() {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    serverProc = null;
  }
}

app.on('window-all-closed', () => {
  killSidecar();
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', killSidecar);
app.on('before-quit', killSidecar);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
