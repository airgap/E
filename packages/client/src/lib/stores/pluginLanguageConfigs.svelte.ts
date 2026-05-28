/**
 * Plugin-contributed language configurations loader (LYK-1034).
 *
 * Watches pluginContributionsStore.languageConfigurations — when a plugin
 * enables, fetches each per-language JSON from the plugin static asset
 * route and registers it with settingsStore. When the plugin disables,
 * its registrations are dropped.
 *
 * v1 scope: parses VS Code's language-configuration.json subset that
 * the editor wiring uses today — `comments` (lineComment / blockComment)
 * and `autoClosingPairs`. Other VS Code fields (brackets,
 * surroundingPairs, indentationRules, onEnterRules, wordPattern, folding)
 * are accepted but not yet consumed by the editor; they'll plug in as
 * the corresponding CM6 extensions land.
 *
 * Conflict policy: last-plugin-to-load wins for any given language id.
 * Plugin authors are expected to scope their language configurations to
 * languages they own; collision is treated as a configuration error in
 * the plugin's manifest rather than something the host resolves.
 */

import { settingsStore } from './settings.svelte';
import { pluginContributionsStore } from './pluginContributions.svelte';
import { getBaseUrl } from '$lib/api/client';

let bootstrapped = false;

interface VsCodeLanguageConfigJson {
  comments?: { lineComment?: string; blockComment?: [string, string] };
  autoClosingPairs?: Array<{ open: string; close: string } | [string, string]>;
}

export function bootstrapPluginLanguageConfigs(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // Track (pluginId, language) so we can fetch deltas and prune drops.
  const loaded = new Set<string>();

  $effect.root(() => {
    $effect(() => {
      const contribs = pluginContributionsStore.languageConfigurations;
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
      // Unregister any contribution that's no longer in the wanted set.
      // This catches both plugin disables (everything for that pluginId
      // is gone) and per-language drops within a still-enabled plugin.
      for (const k of Array.from(loaded)) {
        const dot = k.indexOf('.');
        const pid = k.slice(0, dot);
        const lang = k.slice(dot + 1);
        if (!wantedByPlugin.get(pid)?.has(lang)) {
          // unregisterPluginLanguageConfigsForPlugin is whole-plugin; for a
          // single-language drop we want to leave the plugin's other langs
          // alone, so we re-derive the right strategy:
          if (!wantedByPlugin.has(pid)) {
            // Whole plugin gone — drop everything for that id at once.
            settingsStore.unregisterPluginLanguageConfigsForPlugin(pid);
            for (const k2 of Array.from(loaded)) {
              if (k2.startsWith(`${pid}.`)) loaded.delete(k2);
            }
          } else {
            // Plugin still around, just lost one language. Re-register
            // with an empty stub for that language so the in-editor
            // facet falls back to defaults; settingsStore will then
            // drop it via unregisterPluginLanguageConfigsForPlugin
            // when the plugin itself disables.
            settingsStore.registerPluginLanguageConfig(lang, { pluginId: '__none__' });
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
        `[plugin-langconfig] ${pluginId}/${language}: HTTP ${res.status} on ${relativePath}`,
      );
      return;
    }
    const raw = (await res.json()) as VsCodeLanguageConfigJson;
    if (!raw || typeof raw !== 'object') {
      console.warn(`[plugin-langconfig] ${pluginId}/${language}: malformed JSON`);
      return;
    }
    settingsStore.registerPluginLanguageConfig(language, {
      pluginId,
      comments: raw.comments,
      autoClosingPairs: raw.autoClosingPairs,
    });
    onRegistered();
  } catch (err) {
    console.warn(`[plugin-langconfig] ${pluginId}/${language}: failed`, err);
  }
}
