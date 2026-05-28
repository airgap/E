/**
 * Aggregated plugin contributions (LYK-1030+ et al).
 *
 * Per-feature surfaces (command palette, keybinding handler, status bar,
 * theme picker, etc.) read from this store rather than walking
 * pluginsStore.enabled themselves. Keeping the aggregation in one place
 * means:
 *
 *   1. Every consumer sees the same flattened, plugin-id-tagged list.
 *   2. Future filtering (e.g. "skip contributions from a malformed
 *      manifest") happens once, here, instead of in every consumer.
 *   3. The plugin store stays focused on install / enable lifecycle.
 *
 * Each `Contributed<X>` shape extends the raw schema item with the
 * `pluginId` it came from, so consumers can invoke command handlers /
 * unregister on disable without looking the parent plugin back up.
 */

import { pluginsStore } from './plugins.svelte';
import type {
  InstalledPlugin,
  CommandContribution,
  KeybindingContribution,
  StatusBarItemContribution,
  MenuItem,
  ConfigurationContribution,
  ThemeContribution,
  IconThemeContribution,
  SnippetsContribution,
  LanguageConfigurationContribution,
  TerminalProfileContribution,
} from '@e/shared';

export type Contributed<T> = T & { pluginId: string };

function flatten<T>(
  plugins: InstalledPlugin[],
  pick: (p: InstalledPlugin) => T[] | undefined,
): Contributed<T>[] {
  const out: Contributed<T>[] = [];
  for (const p of plugins) {
    const items = pick(p);
    if (!items) continue;
    for (const item of items) {
      out.push({ ...item, pluginId: p.manifest.id });
    }
  }
  return out;
}

function createPluginContributionsStore() {
  // All getters derive from pluginsStore.enabled — the source of truth for
  // "which contributions are live" is just "which plugins are enabled".
  const commands = $derived<Contributed<CommandContribution>[]>(
    flatten(pluginsStore.enabled, (p) => p.manifest.contributes?.commands),
  );
  const keybindings = $derived<Contributed<KeybindingContribution>[]>(
    flatten(pluginsStore.enabled, (p) => p.manifest.contributes?.keybindings),
  );
  const statusBarItems = $derived<Contributed<StatusBarItemContribution>[]>(
    flatten(pluginsStore.enabled, (p) => p.manifest.contributes?.statusBarItems),
  );
  const themes = $derived<Contributed<ThemeContribution>[]>(
    flatten(pluginsStore.enabled, (p) => p.manifest.contributes?.themes),
  );
  const iconThemes = $derived<Contributed<IconThemeContribution>[]>(
    flatten(pluginsStore.enabled, (p) => p.manifest.contributes?.iconThemes),
  );
  const snippets = $derived<Contributed<SnippetsContribution>[]>(
    flatten(pluginsStore.enabled, (p) => p.manifest.contributes?.snippets),
  );
  const languageConfigurations = $derived<Contributed<LanguageConfigurationContribution>[]>(
    flatten(pluginsStore.enabled, (p) => p.manifest.contributes?.languageConfiguration),
  );
  const terminalProfiles = $derived<Contributed<TerminalProfileContribution>[]>(
    flatten(pluginsStore.enabled, (p) => p.manifest.contributes?.terminalProfiles),
  );

  // Menus are a map of menu-id → MenuItem[], so the "flatten" shape is
  // slightly different — we group by menu key.
  const menusByPalette = $derived<Contributed<MenuItem>[]>(
    flatten(pluginsStore.enabled, (p) => p.manifest.contributes?.menus?.commandPalette),
  );

  // Each plugin can declare at most one configuration block; surface the
  // full list keyed by pluginId so the Settings UI can group properties
  // under each plugin's display name.
  const configurations = $derived<Array<{ pluginId: string; block: ConfigurationContribution }>>(
    pluginsStore.enabled
      .filter((p) => p.manifest.contributes?.configuration)
      .map((p) => ({
        pluginId: p.manifest.id,
        block: p.manifest.contributes!.configuration!,
      })),
  );

  return {
    /** Plugin-contributed commands. Each carries the pluginId of origin. */
    get commands() {
      return commands;
    },
    /** Plugin-contributed key bindings (handler matching lives in AppShell). */
    get keybindings() {
      return keybindings;
    },
    /** Plugin-contributed status bar items. */
    get statusBarItems() {
      return statusBarItems;
    },
    /** Plugin-contributed themes (id, label, uiTheme, path). */
    get themes() {
      return themes;
    },
    get iconThemes() {
      return iconThemes;
    },
    get snippets() {
      return snippets;
    },
    get languageConfigurations() {
      return languageConfigurations;
    },
    /** Plugin-contributed terminal profiles (LYK-1043). */
    get terminalProfiles() {
      return terminalProfiles;
    },
    /** Items the plugin asked to inject into the command palette. */
    get paletteMenuItems() {
      return menusByPalette;
    },
    /** Configuration blocks per plugin, for the Settings UI. */
    get configurations() {
      return configurations;
    },
  };
}

export const pluginContributionsStore = createPluginContributionsStore();
