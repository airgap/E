/**
 * Tiny store for which plugin side-pane is currently open in the viewer
 * modal. Kept separate from pluginsStore so opening a pane doesn't
 * trigger a list reload.
 */
import type { InstalledPlugin, SidePaneContribution } from '@e/shared';

interface ActivePane {
  plugin: InstalledPlugin;
  pane: SidePaneContribution;
}

function createStore() {
  let active = $state<ActivePane | null>(null);
  return {
    get active() {
      return active;
    },
    open(plugin: InstalledPlugin, pane: SidePaneContribution) {
      active = { plugin, pane };
    },
    clear() {
      active = null;
    },
  };
}

export const activePluginPaneStore = createStore();
