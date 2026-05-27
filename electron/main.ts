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
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';

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

// ── File-open from OS / CLI ───────────────────────────────────────────

/**
 * Project markers we walk UP from the opened file looking for. A file is
 * "loose" when none of these exist anywhere from its parent directory up
 * to the filesystem root — i.e. it isn't inside a recognizable project.
 *
 * Conservative on purpose: a stray `.git` or `package.json` upstream is
 * enough to consider the file "in a project" and skip Zen Mode.
 */
const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'nx.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'deno.json',
  'deno.jsonc',
  'bun.lockb',
  'bun.lock',
  '.svelte-kit',
];

/**
 * Walk up from `filePath`'s parent looking for any PROJECT_MARKER. Returns
 * true when none are found by the time we reach the filesystem root.
 *
 * Sync fs because this fires at startup and we want the answer ready by
 * the time we call createMainWindow — no measurable cost for a handful of
 * existsSync checks per level.
 */
function isLooseFile(filePath: string): boolean {
  let dir: string;
  try {
    const st = statSync(filePath);
    dir = st.isDirectory() ? filePath : dirname(filePath);
  } catch {
    // Can't stat → can't be sure; default to NOT loose so we don't accidentally
    // open Zen on something nonsensical.
    return false;
  }
  let prev = '';
  while (dir && dir !== prev) {
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(join(dir, marker))) return false;
    }
    prev = dir;
    dir = dirname(dir);
  }
  return true;
}

/**
 * Pluck a single file path from a process-argv-style array. Filters
 * obvious non-paths (the executable, electron flags, --switch=value
 * arguments). Returns the first plain path-shaped argument that exists
 * on disk, or null.
 */
function pickFilePathFromArgv(argv: readonly string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.startsWith('-')) continue;
    // Skip the chrome-style key=value flags that survived the dash check.
    if (a.includes('=') && !a.includes('/') && !a.includes('\\')) continue;
    try {
      if (existsSync(a)) return resolve(a);
    } catch {
      /* not a path */
    }
  }
  return null;
}

/**
 * Pending file-open request captured during startup (before any window
 * exists). Drained when createMainWindow finishes setting up its window.
 */
let pendingOpenFile: { path: string; loose: boolean } | null = null;

function noteFileToOpen(filePath: string) {
  const loose = isLooseFile(filePath);
  pendingOpenFile = { path: filePath, loose };
}

/**
 * Forward a file-open into all currently-open windows. Used by the
 * second-instance path (when E is already running and the OS hands us
 * another file).
 */
function dispatchFileOpenToWindows(filePath: string) {
  const loose = isLooseFile(filePath);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('e:open-file', { path: filePath, loose });
    // Bring window forward so the user actually sees the freshly-opened file.
    if (win.isMinimized()) win.restore();
    win.focus();
  }
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

  // Bake the pending file-open (if any) into the preload's additionalArguments
  // so the client can read it BEFORE any user code runs — race-free vs sending
  // an IPC event after window load.
  const additionalArguments = [`--e-sidecar-origin=${origin}`];
  if (pendingOpenFile) {
    additionalArguments.push(`--e-open-file=${pendingOpenFile.path}`);
    if (pendingOpenFile.loose) additionalArguments.push('--e-open-file-loose');
    pendingOpenFile = null;
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'E',
    // Phase 2: frame off so the client's data-tauri-drag-region topbar is the
    // titlebar. Drag is provided by `-webkit-app-region: drag` (CSS rule
    // injected by the preload); window controls go through the __TAURI__ shim
    // and the e:window:* IPC handlers below.
    frame: false,
    webPreferences: {
      preload: resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Passed through to preload via process.argv so the origin is set on
      // window BEFORE any client JS runs (and on every reload).
      additionalArguments,
    },
  });

  win.loadURL(`http://${origin}/`);
}

/**
 * Window-control IPC. WindowControls.svelte calls window.__TAURI__.window
 * .getCurrentWindow().{minimize,toggleMaximize,close,isMaximized}; the preload
 * shim translates each into an ipcRenderer.invoke on these channels. Each
 * handler resolves the window from the calling WebContents so this stays
 * window-scoped if we ever add a second window.
 */
function registerWindowIpc() {
  ipcMain.handle('e:window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.handle('e:window:maximize-toggle', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.handle('e:window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
  ipcMain.handle('e:window:is-maximized', (e) => {
    return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false;
  });
}
registerWindowIpc();

// ── File-association wiring ───────────────────────────────────────────
//
// macOS: the OS calls `open-file` BEFORE app-ready when the user
// launches by double-clicking a file. We register it via
// `will-finish-launching` so we don't miss the cold-start event.
//
// Win/Linux: the file path arrives as a command-line argument. We
// parse it from process.argv at startup AND from the
// `second-instance` event when E is already running.
//
// Single-instance lock: without it, double-clicking a second file
// would spawn a new Electron process + sidecar, leaving two windows
// fighting over preferences/sockets. The primary instance receives
// the secondary's argv and routes the file open in-place.

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  // Another instance is already running — defer to it and exit.
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = pickFilePathFromArgv(argv);
    if (filePath) dispatchFileOpenToWindows(filePath);
    // Whether or not a file came in, bring an existing window forward
    // so the user sees the response to their action.
    const wins = BrowserWindow.getAllWindows();
    if (wins[0]) {
      if (wins[0].isMinimized()) wins[0].restore();
      wins[0].focus();
    }
  });

  app.on('will-finish-launching', () => {
    // macOS-only: register BEFORE app-ready so cold-start file opens
    // (`open-file` fired before whenReady resolves) aren't lost.
    app.on('open-file', (event, filePath) => {
      event.preventDefault();
      if (app.isReady() && BrowserWindow.getAllWindows().length > 0) {
        dispatchFileOpenToWindows(filePath);
      } else {
        noteFileToOpen(filePath);
      }
    });
  });

  // Win/Linux cold-start: pick up the file path from the launch argv.
  const initialFile = pickFilePathFromArgv(process.argv);
  if (initialFile) noteFileToOpen(initialFile);
}

app
  .whenReady()
  .then(async () => {
    // Local sidecar serves from disk; never serve stale cached assets across
    // a relaunch when the client has been rebuilt.
    await session.defaultSession.clearCache();
    return createMainWindow();
  })
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
