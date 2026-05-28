/**
 * Plugin-contributed file icon themes (LYK-1039).
 *
 * Acts as a small resolver: given an active theme id + file/folder name,
 * returns the URL of the icon to render (or null to fall back to E's
 * built-in label icons).
 *
 * Theme format mirrors VS Code's `iconTheme` JSON subset that matters
 * for E's FileTree:
 *
 *   {
 *     iconDefinitions: { id: { iconPath: 'icons/file.svg' } },
 *     file: 'defaultFileIconId',         // optional fallback for files
 *     folder: 'closedFolderIconId',      // optional fallback for closed folders
 *     folderExpanded: 'openFolderIconId',
 *     fileExtensions: { 'ts': 'iconId', ... },
 *     fileNames: { 'package.json': 'iconId', ... },
 *     folderNames: { 'src': 'iconId', ... },
 *     folderNamesExpanded: { 'src': 'iconId', ... }
 *   }
 *
 * Light-theme variants, language ids, and high-contrast variants are
 * accepted in the JSON but ignored in v1 — they layer on as we land
 * dark/light theme awareness.
 */

import { settingsStore } from './settings.svelte';
import { pluginContributionsStore } from './pluginContributions.svelte';
import { getBaseUrl } from '$lib/api/client';

interface IconDefinition {
  iconPath?: string;
}
interface VsCodeIconThemeJson {
  iconDefinitions?: Record<string, IconDefinition>;
  file?: string;
  folder?: string;
  folderExpanded?: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
}

interface LoadedTheme {
  /** Composite id: `${pluginId}.${iconThemeId}`. */
  id: string;
  pluginId: string;
  /** Pre-resolved id → absolute URL of the icon asset. */
  iconUrlById: Map<string, string>;
  byExt: Map<string, string>;
  byFileName: Map<string, string>;
  byFolderName: Map<string, string>;
  byFolderNameExpanded: Map<string, string>;
  fileFallback: string | null;
  folderFallback: string | null;
  folderExpandedFallback: string | null;
}

const cache = new Map<string, LoadedTheme>();
let loadingPromise = new Map<string, Promise<LoadedTheme | null>>();
let bootstrapped = false;

function compositeId(pluginId: string, iconThemeId: string): string {
  return `${pluginId}.${iconThemeId}`;
}

export function bootstrapPluginIconThemes(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // Reactively keep the active theme loaded; drop everything else from the
  // cache to bound memory.
  $effect.root(() => {
    $effect(() => {
      const activeId = settingsStore.activeIconThemeId;
      if (!activeId) {
        cache.clear();
        return;
      }
      // Find the contribution for this id.
      const contrib = pluginContributionsStore.iconThemes.find(
        (t) => compositeId(t.pluginId, t.id) === activeId,
      );
      if (!contrib) {
        // Active theme references a plugin that's no longer enabled —
        // clear selection so the picker doesn't stay pointing at a dead
        // id.
        settingsStore.setActiveIconTheme(null);
        return;
      }
      if (!cache.has(activeId) && !loadingPromise.has(activeId)) {
        const p = loadOne(contrib.pluginId, contrib.id, contrib.path);
        loadingPromise.set(activeId, p);
        void p.finally(() => loadingPromise.delete(activeId));
      }
      // Prune any other cached themes.
      for (const id of Array.from(cache.keys())) {
        if (id !== activeId) cache.delete(id);
      }
    });
  });
}

async function loadOne(
  pluginId: string,
  iconThemeId: string,
  relativePath: string,
): Promise<LoadedTheme | null> {
  const id = compositeId(pluginId, iconThemeId);
  const base = getBaseUrl();
  const url = `${base}/plugins/${encodeURIComponent(pluginId)}/${relativePath}`;
  let raw: VsCodeIconThemeJson;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[plugin-iconthemes] ${id}: HTTP ${res.status} on ${relativePath}`);
      return null;
    }
    raw = (await res.json()) as VsCodeIconThemeJson;
  } catch (err) {
    console.warn(`[plugin-iconthemes] ${id}: load failed`, err);
    return null;
  }

  // Resolve every iconPath to an absolute URL inside the plugin asset
  // route. Theme files reference iconPath relative to the theme file's
  // location, so we strip the file part of relativePath and prefix.
  const themeDir = relativePath.includes('/')
    ? relativePath.slice(0, relativePath.lastIndexOf('/') + 1)
    : '';
  const resolveIconPath = (p: string): string =>
    `${base}/plugins/${encodeURIComponent(pluginId)}/${themeDir}${p}`;

  const iconUrlById = new Map<string, string>();
  for (const [defId, def] of Object.entries(raw.iconDefinitions ?? {})) {
    if (def?.iconPath) iconUrlById.set(defId, resolveIconPath(def.iconPath));
  }

  const theme: LoadedTheme = {
    id,
    pluginId,
    iconUrlById,
    byExt: new Map(Object.entries(raw.fileExtensions ?? {})),
    byFileName: new Map(Object.entries(raw.fileNames ?? {})),
    byFolderName: new Map(Object.entries(raw.folderNames ?? {})),
    byFolderNameExpanded: new Map(Object.entries(raw.folderNamesExpanded ?? {})),
    fileFallback: raw.file ?? null,
    folderFallback: raw.folder ?? null,
    folderExpandedFallback: raw.folderExpanded ?? null,
  };
  cache.set(id, theme);
  // Notify reactive consumers that a previously-empty cache entry is now
  // populated. Touching the settings activeIconThemeId getter triggers
  // FileIcon's $derived to re-run.
  settingsStore.setActiveIconTheme(settingsStore.activeIconThemeId);
  return theme;
}

/**
 * Resolve a file/folder name to a plugin icon-theme URL, or null when
 * no theme is active / the theme doesn't have an entry for this name.
 *
 * Lookup order:
 *   - exact filename → byFileName
 *   - longest matching extension → byExt
 *   - fileFallback (when given)
 * For directories the same shape with byFolderName / folderFallback,
 * and byFolderNameExpanded / folderExpandedFallback when `isOpen`.
 */
export function resolvePluginFileIconUrl(
  name: string,
  isDirectory: boolean,
  isOpen = false,
): string | null {
  const activeId = settingsStore.activeIconThemeId;
  if (!activeId) return null;
  const theme = cache.get(activeId);
  if (!theme) return null;

  if (isDirectory) {
    const expanded = isOpen ? theme.byFolderNameExpanded.get(name) : undefined;
    const closed = theme.byFolderName.get(name);
    const fallback = isOpen
      ? (theme.folderExpandedFallback ?? theme.folderFallback)
      : theme.folderFallback;
    const iconId = expanded ?? closed ?? fallback;
    return iconId ? (theme.iconUrlById.get(iconId) ?? null) : null;
  }

  const exact = theme.byFileName.get(name);
  if (exact) return theme.iconUrlById.get(exact) ?? null;

  // Pick the longest matching extension. VS Code icon themes commonly
  // list keys like "ts" and "test.ts"; we honour the more specific match.
  const lc = name.toLowerCase();
  let bestKey = '';
  for (const key of theme.byExt.keys()) {
    if (lc.endsWith(`.${key}`) && key.length > bestKey.length) bestKey = key;
  }
  if (bestKey) {
    const iconId = theme.byExt.get(bestKey)!;
    const url = theme.iconUrlById.get(iconId);
    if (url) return url;
  }

  const fallback = theme.fileFallback;
  return fallback ? (theme.iconUrlById.get(fallback) ?? null) : null;
}
