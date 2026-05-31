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
 *
 * Standalone (browser) builds have no Electron preload — there the binary
 * forwards the launch target as a query param, which we also drain here:
 *   - `?open=<abs-path>`    → open a file in the editor
 *   - `?openDir=<abs-path>` → open a directory as the active workspace
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

/**
 * Open a directory as the active workspace. Reuses an existing workspace for
 * the same path if one exists (server-side), otherwise creates one. Mirrors
 * what clicking a project in the workspace switcher does.
 */
async function handleOpenDir(dirPath: string) {
  if (!dirPath) return;
  const name = dirPath.split('/').filter(Boolean).pop() || dirPath;
  try {
    // Lazy-load the workspace store + API: they pull in a large store graph,
    // and we only need them on the (rare) directory-open path. Keeping them
    // out of the module's static imports also keeps this bridge cheap to load.
    const [{ workspaceStore }, { api }] = await Promise.all([
      import('$lib/stores/workspace.svelte'),
      import('$lib/api/client'),
    ]);

    // Reuse an existing workspace row for this path if present.
    let id: string | undefined;
    try {
      const res = await api.workspaces.list();
      id = res.data?.find((w: { path?: string }) => w.path === dirPath)?.id;
    } catch {
      // List failed — fall through to create.
    }
    if (!id) {
      const created = await api.workspaces.create({ name, path: dirPath });
      id = created.data.id;
    }
    workspaceStore.openWorkspace({ id, name, path: dirPath });
  } catch (err) {
    console.warn('[file-association] openDir failed:', err);
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

  // Standalone (browser) cold-start: there's no Electron preload here. The
  // standalone binary forwards its launch target as a query param —
  // `?open=<file>` (from `e <file>` or the OS handler `Exec=e %F`) or
  // `?openDir=<dir>` (from `e`, `e <dir>`). Drain whichever is present and
  // strip it so a reload doesn't re-trigger the open.
  try {
    const params = new URLSearchParams(window.location.search);
    const openPath = params.get('open');
    const openDir = params.get('openDir');
    if (openPath || openDir) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('open');
      clean.searchParams.delete('openDir');
      window.history.replaceState(
        window.history.state,
        '',
        clean.pathname + clean.search + clean.hash,
      );
      // A file opened via the OS handler has no project context → loose (Zen).
      if (openPath) void handleOpenFile({ path: openPath, loose: true });
      if (openDir) void handleOpenDir(openDir);
    }
  } catch (err) {
    console.warn('[file-association] open-param handling failed:', err);
  }
}
