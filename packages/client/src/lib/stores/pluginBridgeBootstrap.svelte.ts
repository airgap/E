/**
 * Plugin bridge bootstrap (LYK-1056).
 *
 * Wires the v1 RPC method handlers and the host → iframe broadcasts.
 * Called once at app start (from AppShell.onMount). Splitting bootstrap
 * out of pluginBridge.ts keeps the transport layer free of store
 * imports — pluginBridge is pure infrastructure; this file is the
 * feature-side wiring.
 *
 * v1 method surface (intentional scope):
 *   - ui.setStatusBarText     → pluginStatusBarStore.setText
 *   - ui.setStatusBarVisible  → pluginStatusBarStore.setVisible
 *   - ui.showNotification     → uiStore.toast
 *   - ui.runCommand           → dispatchPluginCommand (plugin-contributed only)
 *   - editor.openTab          → editorStore.openFile
 *
 * Deferred for v2:
 *   - workspace.readFile / listDir (need workspace-root containment + a
 *     server route that's plugin-id-scoped)
 *   - editor.applyEdit (needs WorkspaceEdit semantics)
 *   - ui.showQuickPick / showInputBox (modal UI surface)
 *   - configuration.get / configuration.changed (needs LYK-1033 storage)
 *
 * Broadcasts wired:
 *   - workspace.changed       on workspaceStore.activeWorkspace change
 *   - activeEditor.changed    on editorStore.activeTab change
 */

import { registerRpcMethod, broadcastEvent, dispatchPluginCommand } from './pluginBridge';
import { pluginStatusBarStore } from './pluginStatusBar.svelte';
import { uiStore } from './ui.svelte';
import { editorStore } from './editor.svelte';
import { workspaceStore } from './workspace.svelte';
import { settingsStore } from './settings.svelte';
import { pluginContributionsStore } from './pluginContributions.svelte';
import type {
  UiSetStatusBarTextParams,
  UiSetStatusBarVisibleParams,
  UiShowNotificationParams,
  UiRunCommandParams,
  EditorOpenTabParams,
  ConfigurationGetParams,
} from '@e/shared';

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
  });
}
