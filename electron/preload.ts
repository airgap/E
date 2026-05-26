/**
 * Electron preload — runs before page JS, in an isolated world.
 *
 * Reads the sidecar origin passed via additionalArguments and exposes it to the
 * page as `window.__TAURI_SIDECAR_ORIGIN__` (and the port variant) so
 * packages/client's api/client.ts picks it up unchanged. With contextIsolation
 * on we go through contextBridge.exposeInMainWorld.
 *
 * Phase 1 sets ONLY the sidecar origin (enough to load the app and prove HTML5
 * drag works in Chromium). Phase 2 will additionally shim `window.__TAURI__`
 * (window controls + device-API invoke surface) so the existing client code in
 * tauri-device.ts and WindowControls.svelte keeps working.
 */
import { contextBridge } from 'electron';

const PREFIX = '--e-sidecar-origin=';
const arg = process.argv.find((a) => a.startsWith(PREFIX));
const origin = arg ? arg.slice(PREFIX.length) : null;

if (origin) {
  // String values are deep-cloned by contextBridge, which is fine for primitives.
  contextBridge.exposeInMainWorld('__TAURI_SIDECAR_ORIGIN__', origin);
  // Port variant (numeric) covers code paths that check the port-only global.
  const portMatch = /:(\d+)$/.exec(origin);
  if (portMatch) {
    contextBridge.exposeInMainWorld('__TAURI_SIDECAR_PORT__', Number(portMatch[1]));
  }
}
