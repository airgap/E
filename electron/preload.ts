/**
 * Electron preload — runs before page JS in an isolated world.
 *
 * Phase 2 responsibilities:
 *  1. Sidecar origin globals — __TAURI_SIDECAR_ORIGIN__ / __TAURI_SIDECAR_PORT__
 *     so packages/client's api/client.ts picks up the API endpoint unchanged.
 *  2. window.__TAURI__ shim — just enough for WindowControls.svelte. Each
 *     method translates to an ipcRenderer.invoke on the e:window:* channels
 *     registered in electron/main.ts.
 *  3. Drag-region CSS — Tauri uses [data-tauri-drag-region] for click-and-drag
 *     window movement; Chromium uses `-webkit-app-region: drag`. A small
 *     stylesheet injected on DOMContentLoaded translates one to the other,
 *     with `no-drag` on common interactive children so clicks still work.
 *
 * Device APIs (capture_screenshot / get_location / etc.) are NOT shimmed yet —
 * tauri-device.ts will see __TAURI__ present but `core.invoke` missing and
 * fall back to its "Tauri not available" path. Add per-command shims as
 * features come online.
 */
import { contextBridge, ipcRenderer } from 'electron';

// ── 1. Sidecar origin ──────────────────────────────────────────────────────
const PREFIX = '--e-sidecar-origin=';
const arg = process.argv.find((a) => a.startsWith(PREFIX));
const origin = arg ? arg.slice(PREFIX.length) : null;
if (origin) {
  contextBridge.exposeInMainWorld('__TAURI_SIDECAR_ORIGIN__', origin);
  const m = /:(\d+)$/.exec(origin);
  if (m) contextBridge.exposeInMainWorld('__TAURI_SIDECAR_PORT__', Number(m[1]));
}

// ── 1b. File-open from OS file association / CLI ──────────────────────────
//
// Two delivery channels:
//   - additionalArguments (--e-open-file=… / --e-open-file-loose) — cold
//     start; the file path is known BEFORE any page JS runs.
//   - IPC channel `e:open-file` — second-instance (E already running and
//     OS hands us another file).
//
// Both are surfaced to the renderer as a CustomEvent on `window` so the
// client doesn't need to know about the difference. The cold-start case
// also exposes the path via `window.__E_OPEN_FILE__` so consumers that
// run before the event fires can pick it up.
const FILE_PREFIX = '--e-open-file=';
const fileArg = process.argv.find((a) => a.startsWith(FILE_PREFIX));
const looseArg = process.argv.includes('--e-open-file-loose');
const initialOpenFile = fileArg
  ? { path: fileArg.slice(FILE_PREFIX.length), loose: looseArg }
  : null;
if (initialOpenFile) {
  contextBridge.exposeInMainWorld('__E_OPEN_FILE__', initialOpenFile);
}

// Dispatch the cold-start event on DOMContentLoaded so any listeners the
// client attached at module load time have a chance to register.
function dispatchOpenFile(detail: { path: string; loose: boolean }) {
  window.dispatchEvent(new CustomEvent('e:open-file', { detail }));
}
if (initialOpenFile) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => dispatchOpenFile(initialOpenFile), {
      once: true,
    });
  } else {
    dispatchOpenFile(initialOpenFile);
  }
}

// Runtime channel: main process sends 'e:open-file' when E is already
// running and the OS hands us another file (macOS open-file event,
// Windows/Linux second-instance argv).
ipcRenderer.on('e:open-file', (_event, detail: { path: string; loose: boolean }) => {
  if (detail && typeof detail.path === 'string') dispatchOpenFile(detail);
});

// ── 1c. Native menu → renderer action dispatch ────────────────────────────
//
// On macOS the application menu lives at the top of the screen (set in
// electron/main.ts). Each item's click handler sends 'e:menu-action' with
// the action id; we forward it as a CustomEvent so the renderer can
// route it through menuActions.ts. The renderer is the source of truth
// for what each id does — main.ts only knows the ids and the labels.
ipcRenderer.on('e:menu-action', (_event, detail: { id: string }) => {
  if (detail && typeof detail.id === 'string') {
    window.dispatchEvent(new CustomEvent('e:menu-action', { detail }));
  }
});

// ── 2. window.__TAURI__ shim ───────────────────────────────────────────────
// Note: contextBridge marshals these functions across the isolated/main world
// boundary; they run in main world but execute in the preload context.
contextBridge.exposeInMainWorld('__TAURI__', {
  window: {
    getCurrentWindow: () => ({
      minimize: () => ipcRenderer.invoke('e:window:minimize'),
      toggleMaximize: () => ipcRenderer.invoke('e:window:maximize-toggle'),
      close: () => ipcRenderer.invoke('e:window:close'),
      isMaximized: () => ipcRenderer.invoke('e:window:is-maximized'),
    }),
  },
});

// ── 2b. window.__E__ — Electron-specific surface (no Tauri analogue) ──
//
// setVibrancy is called by the theme store whenever the user switches
// themes; main applies the OS-appropriate effect (NSVisualEffectView on
// macOS, DWM background-material on Win11, no-op on Linux).
contextBridge.exposeInMainWorld('__E__', {
  setVibrancy: (opts: { glass: boolean }) => ipcRenderer.invoke('e:window:set-vibrancy', opts),
});

// ── 3. Drag-region CSS ─────────────────────────────────────────────────────
function injectDragCSS() {
  // Buttons / inputs / links inside the drag region must remain clickable.
  // The selector list mirrors what users typically put in a titlebar.
  const style = document.createElement('style');
  style.id = 'e-drag-region-shim';
  // The `no-drag` selector list covers more than just <button>: the workspace
  // tabs are <div role="tab" tabindex="0">, the conversation list rows are
  // divs with role="button", menu items use role="menuitem", etc. Catch them
  // by ARIA role + focusable tabindex so we don't have to enumerate every
  // class name a topbar might host.
  // Interactive children inside the drag region must be no-drag — otherwise
  // they inherit window-drag, which (a) routes clicks to the window manager
  // and (b) reports the 'no' cursor during HTML5 drag operations on those
  // regions. Both interactive elements AND their CONTAINERS (tablist /
  // toolbar / menubar) need this, because gaps inside a tablist still
  // inherit drag from the outer region otherwise.
  style.textContent = `
    [data-tauri-drag-region] { -webkit-app-region: drag; }
    [data-tauri-drag-region] button,
    [data-tauri-drag-region] input,
    [data-tauri-drag-region] select,
    [data-tauri-drag-region] textarea,
    [data-tauri-drag-region] a,
    [data-tauri-drag-region] [role="button"],
    [data-tauri-drag-region] [role="tab"],
    [data-tauri-drag-region] [role="tablist"],
    [data-tauri-drag-region] [role="toolbar"],
    [data-tauri-drag-region] [role="menubar"],
    [data-tauri-drag-region] [role="menuitem"],
    [data-tauri-drag-region] [role="link"],
    [data-tauri-drag-region] [tabindex]:not([tabindex="-1"]) {
      -webkit-app-region: no-drag;
    }
  `;
  document.head.appendChild(style);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectDragCSS, { once: true });
} else {
  injectDragCSS();
}
