/**
 * Dynamic state for plugin-contributed status bar items (LYK-1042).
 *
 * Manifest declares the initial text + alignment + command for each item;
 * those are static and come from pluginContributionsStore.statusBarItems.
 * This store layers a per-item override on top for everything the iframe
 * can change at runtime via the plugin RPC bridge — current text and
 * visibility.
 *
 * Keys are composite: `${pluginId}.${itemId}` so two plugins can each
 * contribute a status bar item with the same local id without colliding.
 */

interface DynamicState {
  /** Override for the manifest's initial text, or null = unset. */
  text: string | null;
  /** Visible by default; setStatusBarVisible(false) hides. */
  visible: boolean;
}

function compositeKey(pluginId: string, itemId: string): string {
  return `${pluginId}.${itemId}`;
}

function createPluginStatusBarStore() {
  let state = $state<Record<string, DynamicState>>({});

  function ensure(pluginId: string, itemId: string): DynamicState {
    const key = compositeKey(pluginId, itemId);
    if (!state[key]) state = { ...state, [key]: { text: null, visible: true } };
    return state[key];
  }

  return {
    /** Effective text for an item — override if set, otherwise null = fallback to manifest text. */
    textFor(pluginId: string, itemId: string): string | null {
      return state[compositeKey(pluginId, itemId)]?.text ?? null;
    },
    visibilityFor(pluginId: string, itemId: string): boolean {
      return state[compositeKey(pluginId, itemId)]?.visible ?? true;
    },
    setText(pluginId: string, itemId: string, text: string) {
      ensure(pluginId, itemId);
      const key = compositeKey(pluginId, itemId);
      state = { ...state, [key]: { ...state[key], text } };
    },
    setVisible(pluginId: string, itemId: string, visible: boolean) {
      ensure(pluginId, itemId);
      const key = compositeKey(pluginId, itemId);
      state = { ...state, [key]: { ...state[key], visible } };
    },
    /** Drop all overrides for a plugin — used when the plugin is disabled. */
    clearForPlugin(pluginId: string) {
      const prefix = `${pluginId}.`;
      const next: Record<string, DynamicState> = {};
      for (const [k, v] of Object.entries(state)) {
        if (!k.startsWith(prefix)) next[k] = v;
      }
      state = next;
    },
  };
}

export const pluginStatusBarStore = createPluginStatusBarStore();
