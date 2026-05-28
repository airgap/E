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

    // ── Mutators (LYK-1020) ──
    // Editing rewrites the whole .e/launch.json — there's no per-config
    // patch route. Callers should follow add/update/remove with save() to
    // persist; saving is separate so the editor can batch edits in-memory
    // and only commit on "Save", giving the user a Cancel option.

    /** Append a new configuration. Errors if `name` collides. */
    addConfig(cfg: LaunchConfig) {
      if (configs.some((c) => c.name === cfg.name)) {
        throw new Error(`A configuration named "${cfg.name}" already exists.`);
      }
      configs = [...configs, cfg];
      if (!activeName) activeName = cfg.name;
    },

    /**
     * Replace the config identified by `originalName` with `next`. If the
     * name changed, the activeName binding is updated to match so the
     * picker doesn't drop selection across the rename.
     */
    updateConfig(originalName: string, next: LaunchConfig) {
      const idx = configs.findIndex((c) => c.name === originalName);
      if (idx < 0) throw new Error(`No configuration named "${originalName}".`);
      if (next.name !== originalName && configs.some((c) => c.name === next.name)) {
        throw new Error(`A configuration named "${next.name}" already exists.`);
      }
      const copy = [...configs];
      copy[idx] = next;
      configs = copy;
      if (activeName === originalName) activeName = next.name;
    },

    /** Remove a configuration by name. No-op if not found. */
    removeConfig(name: string) {
      configs = configs.filter((c) => c.name !== name);
      if (activeName === name) activeName = configs[0]?.name ?? null;
    },

    /**
     * Persist the current in-memory configs to `<workspace>/.e/launch.json`.
     * Re-serializes the whole file. Always writes a v=1 envelope so the
     * shape survives future schema bumps.
     */
    async save(workspacePath: string): Promise<void> {
      if (!workspacePath || workspacePath === '.') {
        throw new Error('No workspace selected — cannot save launch.json.');
      }
      const file = {
        version: '1',
        configurations: configs,
      };
      const { api } = await import('$lib/api/client');
      await api.files.write(
        `${workspacePath}/.e/launch.json`,
        JSON.stringify(file, null, 2) + '\n',
      );
    },
  };
}

export const launchConfigsStore = createLaunchConfigsStore();
