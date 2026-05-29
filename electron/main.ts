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
import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  session,
  type MenuItemConstructorOptions,
} from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { release } from 'node:os';

const REMOTE = process.env.E_REMOTE ?? null;

let serverProc: ChildProcess | null = null;

// ── Glass / window vibrancy ──────────────────────────────────────────
//
// The renderer persists the active theme to localStorage but main needs
// to know at BrowserWindow construction time whether the theme is glass
// (so it can pass `transparent: true` + `vibrancy:` / `backgroundMaterial:`
// in the constructor — these flags can't be flipped on later on macOS).
//
// Bridge: when the renderer calls `e:window:set-vibrancy` (via the
// __E__.setVibrancy preload), main writes the boolean to a tiny JSON in
// userData. At next launch we read it back. First launch has no file →
// defaults to opaque (non-glass).
//
// Live theme changes use win.setVibrancy() / win.setBackgroundMaterial()
// which DO work at runtime on both platforms — the only thing that has
// to be decided up front is `transparent:` on macOS.

interface PersistedGlass {
  glass: boolean;
}

function glassStateFile(): string {
  return join(app.getPath('userData'), 'glass-state.json');
}

function readPersistedGlass(): boolean {
  try {
    const raw = readFileSync(glassStateFile(), 'utf-8');
    const parsed = JSON.parse(raw) as PersistedGlass;
    return parsed?.glass === true;
  } catch {
    return false;
  }
}

function writePersistedGlass(glass: boolean): void {
  try {
    const dir = dirname(glassStateFile());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload: PersistedGlass = { glass };
    writeFileSync(glassStateFile(), JSON.stringify(payload));
  } catch (err) {
    console.error('[e] failed to persist glass state:', err);
  }
}

/** Win11 22H2 (build 22000+) is the floor for `backgroundMaterial:`. */
function isWin11OrLater(): boolean {
  if (process.platform !== 'win32') return false;
  // os.release() returns e.g. "10.0.22631" on Win11 22H2.
  const m = release().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const build = parseInt(m[3], 10);
  return Number.isFinite(build) && build >= 22000;
}

/**
 * BrowserWindow constructor options for the requested glass state.
 * Linux always returns `{}` — we filter glass themes out of the picker
 * there, so this defends against a manually-edited config.
 */
function glassConstructorOptions(glass: boolean): Electron.BrowserWindowConstructorOptions {
  if (!glass) return {};
  if (process.platform === 'darwin') {
    return {
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    };
  }
  if (isWin11OrLater()) {
    // NOT transparent — DWM handles the effect; transparent + Acrylic conflict.
    return { backgroundMaterial: 'acrylic' };
  }
  return {};
}

/** Apply glass state to a live window. Called from the IPC handler. */
function applyGlassToWindow(win: BrowserWindow, glass: boolean): void {
  if (process.platform === 'darwin') {
    // setVibrancy(null) clears; vibrancy still requires the window to have
    // been created with transparent:true. If it wasn't, this is a no-op
    // visually — user will see it after the next launch.
    // Electron's setVibrancy type accepts the same union as the
    // constructor option plus null; casting to satisfy TS.
    win.setVibrancy((glass ? 'sidebar' : null) as Parameters<BrowserWindow['setVibrancy']>[0]);
    return;
  }
  if (isWin11OrLater() && typeof win.setBackgroundMaterial === 'function') {
    win.setBackgroundMaterial(glass ? 'acrylic' : 'none');
    return;
  }
  // Linux + Win10: no-op.
}

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
    // 127.0.0.1 (not `localhost`) — on macOS, `localhost` resolves to
    // IPv6 (::1) first, and the sidecar binds IPv4 by default. Without
    // this the page request hangs indefinitely waiting for an IPv6
    // listener that doesn't exist.
    origin = `127.0.0.1:${port}`;
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

  // Decide glass mode from the persisted state. Some BrowserWindow options
  // (notably `transparent:` on macOS) MUST be passed at construction; live
  // toggles handle the rest.
  const glass = readPersistedGlass();

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
    ...glassConstructorOptions(glass),
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
  ipcMain.handle('e:window:set-vibrancy', (e, opts: { glass: boolean }) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    const glass = opts?.glass === true;
    applyGlassToWindow(w, glass);
    writePersistedGlass(glass);
  });
}
registerWindowIpc();

// ── Native application menu ───────────────────────────────────────────
//
// macOS: the OS menu bar at the top of the screen is mandatory; we
// populate it so it matches the in-window MainToolbar item-for-item
// (the in-window bar is hidden on mac via a `data-mac` html attribute
// the renderer sets — see AppShell.svelte).
//
// Windows / Linux: we clear Electron's default menu so the in-window
// MainToolbar is the only menu surface.
//
// Each click sends an 'e:menu-action' IPC message to the focused
// BrowserWindow; the renderer routes it through menuActions.ts. Dynamic
// submenus (Theme, Switch Workspace, Open Recent) are represented here
// as single "…" picker entries that open the relevant in-app surface —
// reactive lists from store state don't translate cleanly to a static
// native menu without per-change IPC, which we defer.
function fire(action: string) {
  // Electron's click signature passes a BaseWindow, which doesn't expose
  // webContents directly — fall back to BrowserWindow.getFocusedWindow()
  // when the BaseWindow isn't already a BrowserWindow.
  return () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    win?.webContents?.send('e:menu-action', { id: action });
  };
}

function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const tpl: MenuItemConstructorOptions[] = [];

  // macOS: the app menu (with `role: 'appMenu'`) carries About/Quit/Hide
  // and must be the first entry. Other platforms skip it.
  if (isMac) {
    tpl.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: fire('file.settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  tpl.push({
    label: 'File',
    submenu: [
      {
        label: 'New Conversation',
        accelerator: 'CmdOrCtrl+N',
        click: fire('file.newConversation'),
      },
      { type: 'separator' },
      { label: 'Open File…', accelerator: 'CmdOrCtrl+P', click: fire('file.openFile') },
      {
        label: 'Go to Symbol in Workspace…',
        accelerator: 'CmdOrCtrl+T',
        click: fire('file.gotoSymbolWorkspace'),
      },
      {
        label: 'Go to Symbol in File…',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: fire('file.gotoSymbolFile'),
      },
      { type: 'separator' },
      { label: 'Close Editor Tab', accelerator: 'CmdOrCtrl+W', click: fire('file.closeTab') },
      {
        label: 'Reopen Closed Editor',
        accelerator: 'CmdOrCtrl+Shift+T',
        click: fire('file.reopenClosedTab'),
      },
      { type: 'separator' },
      { label: 'Snapshots…', click: fire('file.snapshots') },
      { label: 'Workspace Setup…', click: fire('file.workspaceSetup') },
      { label: 'Open Recent…', click: fire('file.openRecentPicker') },
      { label: 'Switch Workspace…', click: fire('file.switchWorkspacePicker') },
      { type: 'separator' },
      // Settings already lives in the app menu on mac; non-mac keeps it here.
      ...(isMac
        ? []
        : [
            {
              label: 'Settings',
              accelerator: 'CmdOrCtrl+,',
              click: fire('file.settings'),
            } as MenuItemConstructorOptions,
            { type: 'separator' } as MenuItemConstructorOptions,
            { label: 'Exit', click: fire('file.exit') } as MenuItemConstructorOptions,
          ]),
    ],
  });

  tpl.push({
    label: 'Edit',
    submenu: [
      // Standard text editing roles — wire to host shortcuts so the
      // native menu's Cmd+C/V/X etc. don't surprise users when they
      // expect them to behave the same as in any other app.
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Search Across Files',
        accelerator: 'CmdOrCtrl+Shift+F',
        click: fire('edit.searchAcrossFiles'),
      },
      {
        label: 'Find Symbol in Workspace',
        accelerator: 'CmdOrCtrl+T',
        click: fire('edit.findSymbolWorkspace'),
      },
      {
        label: 'Find Symbol in File',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: fire('edit.findSymbolFile'),
      },
      { type: 'separator' },
      { label: 'Stop Generation', click: fire('edit.stopGeneration') },
    ],
  });

  tpl.push({
    label: 'View',
    submenu: [
      { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+/', click: fire('view.toggleSidebar') },
      { label: 'Toggle Terminal', click: fire('view.toggleTerminal') },
      {
        label: 'Toggle Split Pane',
        accelerator: 'CmdOrCtrl+\\',
        click: fire('view.toggleSplit'),
      },
      { type: 'separator' },
      { label: 'Zen Mode', accelerator: 'CmdOrCtrl+Alt+Z', click: fire('view.zenMode') },
      { label: 'Show Breadcrumbs', click: fire('view.toggleBreadcrumbs') },
      { type: 'separator' },
      { label: 'Theme…', click: fire('view.themePicker') },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  tpl.push({
    label: 'Run',
    submenu: [
      { label: 'Start Debugging…', click: fire('run.startDebugging') },
      { label: 'Continue', accelerator: 'F5', click: fire('run.continue') },
      { label: 'Pause', accelerator: 'F6', click: fire('run.pause') },
      { label: 'Stop', accelerator: 'Shift+F5', click: fire('run.stop') },
      { type: 'separator' },
      { label: 'Step Over', accelerator: 'F10', click: fire('run.stepOver') },
      { label: 'Step Into', accelerator: 'F11', click: fire('run.stepInto') },
      { label: 'Step Out', accelerator: 'Shift+F11', click: fire('run.stepOut') },
      { type: 'separator' },
      { label: 'Problems', click: fire('run.problems') },
      { label: 'Debug Panel', click: fire('run.debugPanel') },
    ],
  });

  tpl.push({
    label: 'Go',
    submenu: [
      { label: 'Conversations', click: fire('go.conversations') },
      { label: 'Files', click: fire('go.files') },
      { label: 'Search', click: fire('go.search') },
      { label: 'Work', click: fire('go.work') },
      { label: 'Memory', click: fire('go.memory') },
      { label: 'Agents', click: fire('go.agents') },
      { type: 'separator' },
      { label: 'Symbols', click: fire('go.symbols') },
      { label: 'Todos', click: fire('go.todos') },
      { label: 'Git', click: fire('go.git') },
      { label: 'Git Graph', click: fire('go.gitGraph') },
      { label: 'Problems', click: fire('go.problems') },
      { label: 'Debug', click: fire('go.debug') },
      { label: 'Notes', click: fire('go.notes') },
      { label: 'Artifacts', click: fire('go.artifacts') },
      { label: 'Initiatives', click: fire('go.initiatives') },
      { label: 'Learning', click: fire('go.learning') },
      { label: 'Costs', click: fire('go.costs') },
      { label: 'Ambient', click: fire('go.ambient') },
      { label: 'Digest', click: fire('go.digest') },
      { label: 'Command History', click: fire('go.commandHistory') },
    ],
  });

  tpl.push({
    label: 'Tools',
    submenu: [
      {
        label: 'Command Palette…',
        accelerator: 'CmdOrCtrl+K',
        click: fire('tools.commandPalette'),
      },
      { label: 'Keyboard Shortcuts…', click: fire('tools.keybindings') },
      { type: 'separator' },
      { label: 'MCP Servers', click: fire('tools.mcp') },
      { label: 'Custom Tools', click: fire('tools.customTools') },
      { label: 'Scripts', click: fire('tools.scripts') },
      { label: 'Manager', click: fire('tools.manager') },
    ],
  });

  tpl.push({
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'close' },
      ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
    ],
  });

  tpl.push({
    label: 'Help',
    submenu: [
      { label: 'Help Panel', click: fire('help.helpPanel') },
      { label: 'Documentation', click: fire('help.docs') },
      { type: 'separator' },
      { label: 'Welcome Tips', click: fire('help.welcomeTips') },
      { label: 'Plugin Walkthroughs…', click: fire('help.walkthroughs') },
      { label: 'Keyboard Shortcuts…', click: fire('help.keybindings') },
    ],
  });

  return Menu.buildFromTemplate(tpl);
}

function installAppMenu() {
  if (process.platform === 'darwin') {
    // macOS: install our menu — the OS draws it at the top of the screen.
    Menu.setApplicationMenu(buildAppMenu());
  } else {
    // Win/Linux: kill Electron's default menu so only the in-window
    // MainToolbar shows. Passing null removes the menu entirely.
    Menu.setApplicationMenu(null);
  }
}
installAppMenu();

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
