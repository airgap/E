/**
 * Launch-configs store (LYK-1020) — reads `<workspace>/.e/launch.json`,
 * tracks the active config, and exposes a single startActive() entry so
 * keybindings (AppShell F5) and UI surfaces (DebugPanel Start button) hit
 * the same code path.
 *
 * Schema lives in `@e/shared/dap` so the server can validate the file
 * shape later without redefining it.
 */

import { api } from '$lib/api/client';
import { dapStore } from './dap.svelte';
import type { LaunchConfig } from '@e/shared';

function createLaunchConfigsStore() {
  let configs = $state<LaunchConfig[]>([]);
  let activeName = $state<string | null>(null);
  let loadingError = $state<string | null>(null);

  const activeConfig = $derived(
    activeName ? (configs.find((c) => c.name === activeName) ?? null) : (configs[0] ?? null),
  );

  return {
    get configs() {
      return configs;
    },
    get activeConfig() {
      return activeConfig;
    },
    get loadingError() {
      return loadingError;
    },

    /**
     * Re-read `.e/launch.json` from the given workspace path. Quietly clears
     * configs when the file is absent — that's the empty-state for users
     * who haven't set anything up yet, not an error.
     */
    async load(workspacePath: string) {
      if (!workspacePath || workspacePath === '.') {
        configs = [];
        loadingError = null;
        return;
      }
      try {
        const res = await api.files.read(`${workspacePath}/.e/launch.json`);
        const parsed = JSON.parse(res.data.content);
        const list: LaunchConfig[] = Array.isArray(parsed?.configurations)
          ? parsed.configurations
          : [];
        configs = list;
        loadingError = null;
        if (list.length > 0 && (!activeName || !list.find((c) => c.name === activeName))) {
          activeName = list[0].name;
        }
      } catch (err) {
        // Missing file is the normal empty-state, not an error to surface.
        // Parse errors / permission issues get captured for the panel to show.
        if (err instanceof Error && /JSON|parse/i.test(err.message)) {
          loadingError = `launch.json: ${err.message}`;
        } else {
          loadingError = null;
        }
        configs = [];
      }
    },

    /** Mark a saved config as the active one (the F5 / Start target). */
    setActive(name: string) {
      if (configs.some((c) => c.name === name)) activeName = name;
    },

    /**
     * Start the active configuration, if any. Used by both DebugPanel's
     * Start button and the F5 keybinding when no session is running.
     */
    async startActive(): Promise<void> {
      const cfg = activeConfig;
      if (!cfg) throw new Error('No launch configuration selected.');
      await dapStore.start({
        adapter: cfg.type,
        cwd: cfg.cwd,
        launchArgs: cfg,
      });
    },
  };
}

export const launchConfigsStore = createLaunchConfigsStore();
