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

// ── 3. Drag-region CSS ─────────────────────────────────────────────────────
function injectDragCSS() {
  // Buttons / inputs / links inside the drag region must remain clickable.
  // The selector list mirrors what users typically put in a titlebar.
  const style = document.createElement('style');
  style.id = 'e-drag-region-shim';
  style.textContent = `
    [data-tauri-drag-region] { -webkit-app-region: drag; }
    [data-tauri-drag-region] button,
    [data-tauri-drag-region] input,
    [data-tauri-drag-region] select,
    [data-tauri-drag-region] textarea,
    [data-tauri-drag-region] a {
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
