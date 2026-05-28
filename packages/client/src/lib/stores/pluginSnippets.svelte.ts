/**
 * Plugin-contributed snippets loader (LYK-1037).
 *
 * Watches pluginContributionsStore.snippets — when a plugin with snippet
 * contributions enables, fetches each per-language snippet JSON from the
 * plugin's static asset route, runs it through the existing VS Code
 * snippet converter, and registers the result with settingsStore under
 * the plugin's id. When the plugin disables (or its set of contributions
 * shrinks), the stale entries are dropped.
 *
 * Bootstrap is called once from AppShell.onMount; the inner $effect
 * keeps the registry in sync for the rest of the session.
 */

import { settingsStore } from './settings.svelte';
import { pluginContributionsStore } from './pluginContributions.svelte';
import { getBaseUrl } from '$lib/api/client';
import { convertVsCodeSnippets } from '$lib/utils/vscode-snippet-converter';

let bootstrapped = false;

export function bootstrapPluginSnippets(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // Track which (pluginId, language) we've fetched so re-runs only load
  // the deltas. Keys are `${pluginId}.${language}` strings.
  const loaded = new Set<string>();

  $effect.root(() => {
    $effect(() => {
      const contribs = pluginContributionsStore.snippets;
      const wantedByPlugin = new Map<string, Set<string>>();
      for (const c of contribs) {
        let langs = wantedByPlugin.get(c.pluginId);
        if (!langs) {
          langs = new Set();
          wantedByPlugin.set(c.pluginId, langs);
        }
        langs.add(c.language);
        const key = `${c.pluginId}.${c.language}`;
        if (!loaded.has(key)) {
          void loadOne(c.pluginId, c.language, c.path, () => loaded.add(key));
        }
      }
      // Whole-plugin unregisters first (handles disable / uninstall).
      const seenPlugins = new Set(wantedByPlugin.keys());
      const knownPlugins = new Set<string>();
      for (const k of loaded) knownPlugins.add(k.slice(0, k.indexOf('.')));
      for (const pid of knownPlugins) {
        if (!seenPlugins.has(pid)) {
          settingsStore.unregisterPluginSnippets(pid);
          // Strip its keys from loaded.
          for (const k of Array.from(loaded)) {
            if (k.startsWith(`${pid}.`)) loaded.delete(k);
          }
        }
      }
      // Per-language drops within a still-enabled plugin: if a previously
      // contributed language is no longer in the manifest, clear it.
      for (const [pid, wantedLangs] of wantedByPlugin) {
        for (const k of Array.from(loaded)) {
          if (!k.startsWith(`${pid}.`)) continue;
          const lang = k.slice(pid.length + 1);
          if (!wantedLangs.has(lang)) {
            settingsStore.registerPluginSnippets(pid, lang, []);
            loaded.delete(k);
          }
        }
      }
    });
  });
}

async function loadOne(
  pluginId: string,
  language: string,
  relativePath: string,
  onRegistered: () => void,
): Promise<void> {
  const url = `${getBaseUrl()}/plugins/${encodeURIComponent(pluginId)}/${relativePath}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[plugin-snippets] ${pluginId}/${language}: HTTP ${res.status} on ${relativePath}`,
      );
      return;
    }
    const raw = await res.json();
    if (!raw || typeof raw !== 'object') {
      console.warn(`[plugin-snippets] ${pluginId}/${language}: malformed JSON`);
      return;
    }
    const converted = convertVsCodeSnippets(raw as Record<string, any>);
    settingsStore.registerPluginSnippets(pluginId, language, converted);
    onRegistered();
  } catch (err) {
    console.warn(`[plugin-snippets] ${pluginId}/${language}: failed`, err);
  }
}
