/**
 * Plugin store. Loads the installed-plugin list, surfaces install /
 * uninstall / enable-disable flows, and keeps the list reactive so UI
 * subscribers update without manual refetches.
 *
 * Lifecycle:
 *   - install/uninstall/setEnabled always reload the list afterward so
 *     server-side state (warnings, computed installedAt) stays in sync
 *   - Errors from install propagate as InstallError so the Settings UI
 *     can render the validation messages verbatim
 */
import { api } from '$lib/api/client';
import type { InstalledPlugin } from '@e/shared';

export interface InstallError {
  errors: string[];
}

function createStore() {
  let plugins = $state<InstalledPlugin[]>([]);
  let loading = $state(false);
  let lastLoadedAt = $state<number | null>(null);

  async function reload() {
    loading = true;
    try {
      const res = await api.plugins.list();
      if (res.ok) {
        plugins = res.data;
        lastLoadedAt = Date.now();
      }
    } catch (err) {
      console.warn('[plugins] list failed:', err);
    } finally {
      loading = false;
    }
  }

  return {
    get plugins() {
      return plugins;
    },
    get loading() {
      return loading;
    },
    get lastLoadedAt() {
      return lastLoadedAt;
    },
    /** Convenience: enabled plugins only. Used to drive sidePane contributions. */
    get enabled(): InstalledPlugin[] {
      return plugins.filter((p) => p.enabled);
    },
    reload,
    /**
     * Install a plugin from a File. Returns the new InstalledPlugin on
     * success, or an InstallError carrying the manifest / extraction
     * messages. The list is reloaded on success.
     */
    async install(file: File): Promise<InstalledPlugin | InstallError> {
      const res = await api.plugins.install(file);
      if (res.ok) {
        await reload();
        return res.data;
      }
      // Normalize the error shape — server can return errors[] (validation)
      // or a single error string (extraction failure).
      const errors =
        'errors' in res && res.errors ? res.errors : res.error ? [res.error] : ['install failed'];
      return { errors };
    },
    async uninstall(id: string): Promise<boolean> {
      const res = await api.plugins.uninstall(id);
      if (res.ok) await reload();
      return res.ok;
    },
    async setEnabled(id: string, enabled: boolean): Promise<boolean> {
      const res = await api.plugins.setEnabled(id, enabled);
      if (res.ok) await reload();
      return res.ok;
    },
  };
}

export const pluginsStore = createStore();
