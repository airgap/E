/**
 * Plugin RPC protocol (LYK-1056).
 *
 * Three message kinds traverse the iframe boundary in v1:
 *
 *   - rpc.request  iframe → host. Carries a correlation id; host replies
 *                  with rpc.response carrying the same id.
 *   - rpc.response host → iframe. Reply to a prior request.
 *   - rpc.event    host → iframe. Broadcast (no reply expected).
 *
 * Wire shape lives in this module so the host implementation and any
 * future plugin SDK can both depend on it without re-defining strings.
 * v1 keeps things untyped beyond the discriminator + method names —
 * params/result are passed through; the host's method handlers do the
 * narrowing. Tightening to a fully typed router is a follow-up.
 *
 * Constraints (enforced host-side, not in this file):
 *   - Per-message JSON byte cap (1 MB) — drop oversized messages.
 *   - All file/workspace methods scoped to workspace roots — file paths
 *     outside the active workspace are rejected.
 *   - Cross-plugin reads are disallowed; the host derives the calling
 *     plugin id from event.source and routes accordingly.
 */

/** Top-level discriminator for every message that crosses the bridge. */
export type PluginRpcEnvelope =
  | { type: 'e.rpc.request'; id: string; method: PluginRpcMethod; params?: unknown }
  | { type: 'e.rpc.response'; id: string; result?: unknown; error?: string }
  | { type: 'e.rpc.event'; event: PluginRpcEvent; data: unknown };

/** Method names the iframe may invoke on the host (v1 subset). */
export type PluginRpcMethod =
  | 'ui.setStatusBarText'
  | 'ui.setStatusBarVisible'
  | 'ui.showNotification'
  | 'ui.runCommand'
  | 'ui.setTreeData'
  | 'editor.openTab'
  | 'configuration.get';

/** Broadcast event names the host pushes to mounted iframes. */
export type PluginRpcEvent =
  | 'workspace.changed'
  | 'activeEditor.changed'
  | 'selection.changed'
  | 'theme.changed'
  | 'configuration.changed';

// ── Per-method payload sketches ────────────────────────────────────────
// These are documentation-grade and not enforced at the type level on the
// envelope — the dispatcher narrows from `unknown` at runtime. Listed
// here so plugin authors have a single reference for what to send.

export interface UiSetStatusBarTextParams {
  /** Item id declared in manifest.contributes.statusBarItems[].id. */
  id: string;
  /** New text. Empty string is allowed (renders an empty slot). */
  text: string;
}
export interface UiSetStatusBarVisibleParams {
  id: string;
  visible: boolean;
}
export interface UiShowNotificationParams {
  text: string;
  level?: 'info' | 'success' | 'warning' | 'error';
  timeout?: number;
}
export interface UiRunCommandParams {
  /** Plugin-contributed command id. Host commands are not routable in v1. */
  commandId: string;
  args?: unknown[];
}
export interface EditorOpenTabParams {
  path: string;
  line?: number;
  character?: number;
}
export interface ConfigurationGetParams {
  key: string;
}

// ── Broadcast payload sketches ────────────────────────────────────────

export interface WorkspaceChangedEvent {
  root: string | null;
}
export interface ActiveEditorChangedEvent {
  path: string | null;
  languageId: string | null;
}
export interface SelectionChangedEvent {
  path: string;
  line: number;
  character: number;
}

/** Maximum bytes the host accepts for any single inbound message. */
export const PLUGIN_RPC_MAX_MESSAGE_BYTES = 1_000_000;
