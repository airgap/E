/**
 * Plugin bridge bootstrap (LYK-1056).
 *
 * Wires the v1 RPC method handlers and the host → iframe broadcasts.
 * Called once at app start (from AppShell.onMount). Splitting bootstrap
 * out of pluginBridge.ts keeps the transport layer free of store
 * imports — pluginBridge is pure infrastructure; this file is the
 * feature-side wiring.
 *
 * Method surface:
 *   - ui.setStatusBarText     → pluginStatusBarStore.setText
 *   - ui.setStatusBarVisible  → pluginStatusBarStore.setVisible
 *   - ui.showNotification     → uiStore.toast
 *   - ui.showQuickPick        → pluginPromptStore.quickPick (modal)
 *   - ui.showInputBox         → pluginPromptStore.inputBox (modal)
 *   - ui.runCommand           → dispatchPluginCommand (plugin-contributed only)
 *   - ui.setTreeData          → pluginTreeViewsStore.setNodes
 *   - editor.openTab          → editorStore.openFile
 *   - editor.applyEdit        → api.files.write per WorkspaceEdit change
 *   - workspace.readFile      → api.files.read (workspace-root scoped)
 *   - workspace.listDir       → api.files.tree depth 1 (workspace-root scoped)
 *   - configuration.get       → settingsStore.pluginConfigValue
 *
 * Broadcasts wired:
 *   - workspace.changed       on workspaceStore.activeWorkspace change
 *   - activeEditor.changed    on editorStore.activeTab change
 *   - selection.changed       on editorStore.activeTab caret change
 *   - theme.changed           on settingsStore.theme change
 *   - configuration.changed   from settingsStore.setPluginConfigValue (there)
 *
 * Constraints enforced here: file methods are confined to the active
 * workspace root (withinWorkspace), and every request is rate-capped +
 * size-capped in the transport (pluginBridge).
 */

import { registerRpcMethod, broadcastEvent, dispatchPluginCommand } from './pluginBridge';
import { pluginStatusBarStore } from './pluginStatusBar.svelte';
import { pluginTreeViewsStore } from './pluginTreeViews.svelte';
import { pluginPromptStore } from './pluginPrompt.svelte';
import { uiStore } from './ui.svelte';
import { editorStore } from './editor.svelte';
import { workspaceStore } from './workspace.svelte';
import { settingsStore } from './settings.svelte';
import { pluginContributionsStore } from './pluginContributions.svelte';
import { api } from '$lib/api/client';
import type {
  UiSetStatusBarTextParams,
  UiSetStatusBarVisibleParams,
  UiShowNotificationParams,
  UiRunCommandParams,
  EditorOpenTabParams,
  ConfigurationGetParams,
  UiSetTreeDataParams,
  TreeViewNode,
  UiShowQuickPickParams,
  UiShowInputBoxParams,
  WorkspaceReadFileParams,
  WorkspaceListDirParams,
  EditorApplyEditParams,
} from '@e/shared';

/**
 * Curated CSS custom-property tokens broadcast in theme.changed. Reading
 * the full custom-property set off computed styles isn't reliably
 * enumerable, so we snapshot a known list — enough for a plugin iframe to
 * match the host's palette.
 */
const THEME_TOKEN_NAMES = [
  '--bg-primary',
  '--bg-secondary',
  '--bg-tertiary',
  '--bg-hover',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--accent-primary',
  '--accent-secondary',
  '--accent-error',
  '--accent-warning',
  '--border-primary',
];

/**
 * Confine a plugin-supplied path to the active workspace root. Returns
 * the path when safe, or null when it escapes the root. Client-side
 * normalization (collapse ./ and ../) + prefix check; the server file
 * routes validate again as defense-in-depth.
 */
function withinWorkspace(path: string): string | null {
  const root = workspaceStore.activeWorkspace?.workspacePath;
  if (!root || root === '.') return null;
  // Resolve relative paths against the root; normalize . / .. segments.
  const abs = path.startsWith('/') ? path : `${root}/${path}`;
  const parts: string[] = [];
  for (const seg of abs.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const normalized = '/' + parts.join('/');
  const rootNorm = root.endsWith('/') ? root.slice(0, -1) : root;
  if (normalized === rootNorm || normalized.startsWith(rootNorm + '/')) return normalized;
  return null;
}

let bootstrapped = false;

export function bootstrapPluginBridge(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // ── Methods (iframe → host) ───────────────────────────────────────────

  registerRpcMethod('ui.setStatusBarText', (pluginId, params) => {
    const p = params as UiSetStatusBarTextParams;
    if (!p || typeof p.id !== 'string' || typeof p.text !== 'string') {
      throw new Error('setStatusBarText requires { id, text }');
    }
    pluginStatusBarStore.setText(pluginId, p.id, p.text);
    return { ok: true };
  });

  registerRpcMethod('ui.setStatusBarVisible', (pluginId, params) => {
    const p = params as UiSetStatusBarVisibleParams;
    if (!p || typeof p.id !== 'string' || typeof p.visible !== 'boolean') {
      throw new Error('setStatusBarVisible requires { id, visible }');
    }
    pluginStatusBarStore.setVisible(pluginId, p.id, p.visible);
    return { ok: true };
  });

  registerRpcMethod('ui.showNotification', (_pluginId, params) => {
    const p = params as UiShowNotificationParams;
    if (!p || typeof p.text !== 'string') throw new Error('showNotification requires { text }');
    const level =
      p.level && ['info', 'success', 'warning', 'error'].includes(p.level) ? p.level : 'info';
    uiStore.toast(p.text, level, p.timeout);
    return { ok: true };
  });

  registerRpcMethod('ui.runCommand', (pluginId, params) => {
    const p = params as UiRunCommandParams;
    if (!p || typeof p.commandId !== 'string') {
      throw new Error('runCommand requires { commandId }');
    }
    // v1 scope: plugins can only invoke commands declared by some enabled
    // plugin. Host built-in commands aren't routable through the bridge
    // yet — that requires a host command registry which is a separate
    // refactor (the command palette currently builds its list inline).
    const target = pluginContributionsStore.commands.find((c) => c.command === p.commandId);
    if (!target) throw new Error(`Unknown plugin command: ${p.commandId}`);
    dispatchPluginCommand({
      pluginId: target.pluginId,
      command: target.command,
      args: p.args,
    });
    return { ok: true, dispatchedTo: target.pluginId };
  });

  // LYK-1041: declarative tree views. Plugin pushes the latest node set
  // for one of its declared treeView ids; the store fans to the
  // PluginTreeView component that's currently mounted for that view.
  // Nodes are normalised shallowly — bad entries are dropped, but the
  // full tree isn't deep-validated; renderer is forgiving.
  function normalizeNode(raw: unknown): TreeViewNode | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.label !== 'string') return null;
    let children: TreeViewNode[] | undefined;
    if (Array.isArray(r.children)) {
      children = r.children.map(normalizeNode).filter((c): c is TreeViewNode => c !== null);
      if (children.length === 0) children = undefined;
    }
    return {
      id: r.id,
      label: r.label,
      icon: typeof r.icon === 'string' ? r.icon : undefined,
      expanded: r.expanded === true,
      command: typeof r.command === 'string' ? r.command : undefined,
      children,
    };
  }
  registerRpcMethod('ui.setTreeData', (pluginId, params) => {
    const p = params as UiSetTreeDataParams;
    if (!p || typeof p.viewId !== 'string')
      throw new Error('setTreeData requires { viewId, nodes }');
    if (!Array.isArray(p.nodes)) throw new Error('setTreeData.nodes must be an array');
    const norm = p.nodes.map(normalizeNode).filter((n): n is TreeViewNode => n !== null);
    pluginTreeViewsStore.setNodes(pluginId, p.viewId, norm);
    return { ok: true };
  });

  registerRpcMethod('editor.openTab', (_pluginId, params) => {
    const p = params as EditorOpenTabParams;
    if (!p || typeof p.path !== 'string') throw new Error('openTab requires { path }');
    const goTo =
      typeof p.line === 'number'
        ? { line: p.line, col: typeof p.character === 'number' ? p.character : 0 }
        : undefined;
    void editorStore.openFile(p.path, false, goTo);
    return { ok: true };
  });

  // LYK-1033: configuration.get reads a single plugin-declared setting.
  // Falls back to the contributed `default` when the user hasn't overridden
  // it. Plugins call this once at start; the configuration.changed event
  // (broadcast from settingsStore.setPluginConfigValue) tells them when
  // to re-read.
  registerRpcMethod('configuration.get', (pluginId, params) => {
    const p = params as ConfigurationGetParams;
    if (!p || typeof p.key !== 'string') throw new Error('configuration.get requires { key }');
    const value = settingsStore.pluginConfigValue(p.key);
    if (value !== undefined) return { value };
    // Look the default up out of the contributing plugin's manifest
    // configuration block. Scoped to the caller's own plugin id — no
    // cross-plugin reads.
    const block = pluginContributionsStore.configurations.find((c) => c.pluginId === pluginId);
    const prop = block?.block.properties?.[p.key];
    return { value: prop?.default };
  });

  // ── v2 methods (LYK-1056) ─────────────────────────────────────────────

  registerRpcMethod('ui.showQuickPick', async (pluginId, params) => {
    const p = params as UiShowQuickPickParams;
    if (!p || !Array.isArray(p.items)) throw new Error('showQuickPick requires { items }');
    const items = p.items.map((it) =>
      typeof it === 'string'
        ? { label: it }
        : { label: it.label, description: it.description, detail: it.detail },
    );
    const picked = await pluginPromptStore.quickPick(pluginId, items, p.placeholder);
    return { picked };
  });

  registerRpcMethod('ui.showInputBox', async (pluginId, params) => {
    const p = (params ?? {}) as UiShowInputBoxParams;
    const value = await pluginPromptStore.inputBox(pluginId, {
      prompt: p.prompt,
      value: p.value,
      placeholder: p.placeholder,
      password: p.password,
    });
    return { value };
  });

  registerRpcMethod('workspace.readFile', async (_pluginId, params) => {
    const p = params as WorkspaceReadFileParams;
    if (!p || typeof p.path !== 'string') throw new Error('readFile requires { path }');
    const safe = withinWorkspace(p.path);
    if (!safe) throw new Error('Path is outside the workspace root.');
    const res = await api.files.read(safe);
    return { content: res.data.content };
  });

  registerRpcMethod('workspace.listDir', async (_pluginId, params) => {
    const p = params as WorkspaceListDirParams;
    if (!p || typeof p.path !== 'string') throw new Error('listDir requires { path }');
    const safe = withinWorkspace(p.path);
    if (!safe) throw new Error('Path is outside the workspace root.');
    const res = await api.files.tree(safe, 1);
    const entries = (Array.isArray(res.data) ? res.data : []).map((e: any) => ({
      name: e.name,
      path: e.path,
      type: e.type === 'directory' ? 'directory' : 'file',
    }));
    return { entries };
  });

  registerRpcMethod('editor.applyEdit', async (_pluginId, params) => {
    const p = params as EditorApplyEditParams;
    if (!p || !p.edit || !Array.isArray(p.edit.changes)) {
      throw new Error('applyEdit requires { edit: { changes: [...] } }');
    }
    // Validate every target up front so a partial apply can't happen due
    // to a containment failure midway.
    const resolved: Array<{ path: string; newText: string }> = [];
    for (const change of p.edit.changes) {
      if (typeof change?.path !== 'string' || typeof change?.newText !== 'string') {
        throw new Error('Each change needs { path, newText }');
      }
      const safe = withinWorkspace(change.path);
      if (!safe) throw new Error(`Path is outside the workspace root: ${change.path}`);
      resolved.push({ path: safe, newText: change.newText });
    }
    for (const change of resolved) {
      await api.files.write(change.path, change.newText);
      // Refresh any open buffer for the edited file so the UI reflects it.
      void editorStore.refreshFile(change.path);
    }
    return { ok: true };
  });

  // ── Broadcasts (host → iframe) ────────────────────────────────────────
  // Effects subscribed to the relevant stores fan a one-shot
  // postMessage out to every registered iframe whenever the source state
  // changes. Doing this in $effect.root so the subscriptions live for
  // the lifetime of the app, not a single component.

  $effect.root(() => {
    $effect(() => {
      const ws = workspaceStore.activeWorkspace;
      broadcastEvent('workspace.changed', { root: ws?.workspacePath ?? null });
    });
    $effect(() => {
      const tab = editorStore.activeTab;
      broadcastEvent('activeEditor.changed', {
        path: tab?.filePath ?? null,
        languageId: tab?.language ?? null,
      });
    });
    $effect(() => {
      // Caret position of the active tab. cursorLine/cursorCol are
      // tracked on the tab; reading them here makes this effect re-run
      // on every caret move.
      const tab = editorStore.activeTab;
      if (!tab?.filePath) return;
      broadcastEvent('selection.changed', {
        path: tab.filePath,
        line: tab.cursorLine,
        character: tab.cursorCol,
      });
    });
    $effect(() => {
      // Theme id drives a token snapshot. Reading computed styles is a
      // side-effect we only want on actual theme changes — gate on the id.
      const id = settingsStore.theme;
      if (typeof document === 'undefined') {
        broadcastEvent('theme.changed', { id, tokens: {} });
        return;
      }
      const cs = getComputedStyle(document.documentElement);
      const tokens: Record<string, string> = {};
      for (const name of THEME_TOKEN_NAMES) {
        const v = cs.getPropertyValue(name).trim();
        if (v) tokens[name] = v;
      }
      broadcastEvent('theme.changed', { id, tokens });
    });
  });
}
