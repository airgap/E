/**
 * Plugin-contributed themes loader (LYK-1038).
 *
 * Watches pluginContributionsStore.themes — when a plugin with theme
 * contributions enables, fetches each theme JSON from the plugin's
 * static asset route, runs it through the existing VS Code theme
 * converter, and registers the result with settingsStore under a
 * `plugin-<pluginId>-<themeId>` id. When the plugin disables (or
 * uninstalls), the corresponding registrations are removed and the
 * activation pipeline falls back to the default theme.
 *
 * Bootstrap is called once from AppShell.onMount — the $effect inside
 * keeps the registry in sync for the rest of the session.
 */

import { settingsStore } from './settings.svelte';
import { pluginContributionsStore } from './pluginContributions.svelte';
import { getBaseUrl } from '$lib/api/client';
import { convertVsCodeTheme, type VsCodeThemeJson } from '$lib/utils/vscode-theme-converter';

let bootstrapped = false;

function pluginThemeId(pluginId: string, themeId: string): string {
  return `plugin-${pluginId}-${themeId}`;
}

export function bootstrapPluginThemes(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // Track which composite ids we've registered so we know what to drop
  // when the wanted set shrinks.
  const loaded = new Set<string>();

  $effect.root(() => {
    $effect(() => {
      const contribs = pluginContributionsStore.themes;
      const wanted = new Set<string>();
      for (const c of contribs) {
        const id = pluginThemeId(c.pluginId, c.id);
        wanted.add(id);
        if (!loaded.has(id)) {
          void loadOne(c.pluginId, c.id, c.label, c.uiTheme, c.path, () => loaded.add(id));
        }
      }
      // Unregister anything that was loaded but is no longer wanted.
      for (const id of Array.from(loaded)) {
        if (!wanted.has(id)) {
          settingsStore.unregisterPluginTheme(id);
          loaded.delete(id);
        }
      }
    });
  });
}

async function loadOne(
  pluginId: string,
  themeId: string,
  label: string,
  uiTheme: 'vs-dark' | 'vs',
  relativePath: string,
  onRegistered: () => void,
): Promise<void> {
  const baseType: 'dark' | 'light' = uiTheme === 'vs' ? 'light' : 'dark';
  // The asset route is path-traversal-safe and only serves files inside
  // the plugin install dir — same route the iframe sandboxes use.
  const url = `${getBaseUrl()}/plugins/${encodeURIComponent(pluginId)}/${relativePath}`;
  let raw: VsCodeThemeJson;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[plugin-themes] ${pluginId}: ${relativePath} → HTTP ${res.status}`);
      return;
    }
    raw = await res.json();
  } catch (err) {
    console.warn(`[plugin-themes] ${pluginId}: failed to load ${relativePath}`, err);
    return;
  }
  // Force the type so the converter doesn't infer light-vs-dark from a
  // missing `type` field in the JSON; the manifest's uiTheme is the
  // authoritative source for that.
  const converted = convertVsCodeTheme({ ...raw, name: label, type: baseType });
  settingsStore.registerPluginTheme(pluginThemeId(pluginId, themeId), {
    name: label,
    type: baseType,
    cssVars: converted.cssVars,
  });
  onRegistered();
}
