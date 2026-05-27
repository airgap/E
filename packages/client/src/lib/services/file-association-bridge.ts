/**
 * Bridge between Electron's file-association IPC and the in-app file-open
 * + Zen Mode stores. Wires once at app boot (from +layout.svelte).
 *
 * Triggered when:
 *   - The OS launches E by double-click on an associated file type
 *   - The user opens an associated file while E is already running
 *
 * In both cases the preload script dispatches `window.e:open-file` with
 * `{ path, loose }`. We:
 *   1. Open the file via the canonical editor store API
 *   2. If `loose === true` (no project markers found upstream of the file),
 *      flip Zen Mode on so the loose file gets a distraction-free surface
 *
 * The bridge is also responsible for picking up the cold-start file path
 * exposed at `window.__E_OPEN_FILE__` in case the event listener attaches
 * after preload already dispatched. The listener-vs-global race is real
 * for SvelteKit hydration timing.
 */
import { editorStore } from '$lib/stores/editor.svelte';
import { uiStore } from '$lib/stores/ui.svelte';

interface OpenFileDetail {
  path: string;
  loose: boolean;
}

async function handleOpenFile(detail: OpenFileDetail) {
  if (!detail?.path) return;
  try {
    await editorStore.openFile(detail.path);
  } catch (err) {
    console.warn('[file-association] openFile failed:', err);
    return;
  }
  if (detail.loose) {
    // Defer the Zen toggle until after the file render flush so the toast
    // ("press Esc to exit Zen Mode") doesn't get clobbered by editor-load
    // toasts. Microtask is plenty — no need for setTimeout.
    queueMicrotask(() => {
      if (!uiStore.zenMode) uiStore.setZenMode(true);
    });
  }
}

let installed = false;

/**
 * Install the bridge. Idempotent — repeated calls are safely ignored so
 * SvelteKit HMR doesn't double-fire.
 */
export function installFileAssociationBridge() {
  if (installed) return;
  if (typeof window === 'undefined') return;
  installed = true;

  // Runtime channel — preload dispatches this on second-instance opens
  // and also synthesises it for the cold-start initial path.
  window.addEventListener('e:open-file', ((ev: CustomEvent<OpenFileDetail>) => {
    void handleOpenFile(ev.detail);
  }) as EventListener);

  // Cold-start race guard: if the preload already dispatched before this
  // module finished loading, the listener above won't fire — drain the
  // global instead.
  const initial = (window as any).__E_OPEN_FILE__ as OpenFileDetail | undefined;
  if (initial) {
    // Clear immediately so a HMR-reinstall doesn't re-open the file.
    (window as any).__E_OPEN_FILE__ = undefined;
    void handleOpenFile(initial);
  }
}
