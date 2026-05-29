/**
 * Plugin host bridge (LYK-1030 / LYK-1056).
 *
 * Two responsibilities live here:
 *
 *  1. **Outbound commands.** A window CustomEvent ('e:plugin-command')
 *     publishes "fire this command on this plugin" — each plugin iframe
 *     mount point listens and postMessages its own iframe when the
 *     pluginId matches. Publish-subscribe-via-DOM avoids a central
 *     "mounted iframes" Map that has to be carefully cleaned up.
 *
 *  2. **Inbound RPC.** Each mount point registers its iframe + pluginId
 *     here on mount; the window-level 'message' listener walks
 *     event.source through the registered iframes to identify the
 *     calling plugin. Methods that mutate host state run their handlers;
 *     RPC responses ride back through the iframe's contentWindow.
 *     Broadcasts (host → iframe events) fan out to every registered
 *     iframe.
 */

import type { PluginRpcEnvelope, PluginRpcEvent } from '@e/shared';
import { PLUGIN_RPC_MAX_MESSAGE_BYTES, PLUGIN_RPC_RATE_LIMIT_PER_SEC } from '@e/shared';

/** Detail payload of the `e:plugin-command` window event. */
export interface PluginCommandDetail {
  /** Which plugin the command was contributed by. */
  pluginId: string;
  /** The contributed command id (e.g. `myplugin.doThing`). */
  command: string;
  /** Optional caller-supplied arguments — round-tripped to the iframe. */
  args?: unknown[];
}

const EVENT_NAME = 'e:plugin-command';

/**
 * Fire `e:plugin-command` for the given (plugin, command). The mounted
 * iframe(s) for that plugin will postMessage on receipt; if no iframe is
 * currently mounted the command is silently dropped — the plugin won't
 * hear it. (Future: queue + replay when the iframe mounts.)
 */
export function dispatchPluginCommand(detail: PluginCommandDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PluginCommandDetail>(EVENT_NAME, { detail }));
}

/**
 * Subscribe to plugin-command events. The handler is called for every
 * dispatch — listeners filter by pluginId themselves.
 *
 * Returns an unsubscribe function. Caller should invoke it on unmount.
 */
export function onPluginCommand(handler: (detail: PluginCommandDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const ce = e as CustomEvent<PluginCommandDetail>;
    handler(ce.detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

/**
 * Forward a plugin-command event into an iframe via postMessage. Used by
 * each mount point's listener. Targets `'*'` because the iframe origin
 * is the server's static plugin route, not necessarily a known origin
 * at message-send time. The plugin author opts in by listening for
 * messages with this shape.
 */
export function postCommandToIframe(
  iframe: HTMLIFrameElement | null | undefined,
  command: string,
  args?: unknown[],
): void {
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage(
    {
      type: 'e.commandInvoked',
      command,
      args,
    },
    '*',
  );
}

// ── Inbound RPC + broadcast machinery (LYK-1056) ────────────────────────

/** A live plugin iframe + the plugin id it represents. */
interface RegisteredIframe {
  pluginId: string;
  iframe: HTMLIFrameElement;
}

const registered = new Set<RegisteredIframe>();
type RpcMethodHandler = (pluginId: string, params: unknown) => unknown | Promise<unknown>;
const methodHandlers = new Map<string, RpcMethodHandler>();
let listenerInstalled = false;

/**
 * Per-plugin rolling-window rate limiter. Tracks recent request
 * timestamps per plugin id; rejects once the count in the trailing
 * second exceeds PLUGIN_RPC_RATE_LIMIT_PER_SEC.
 */
const rateBuckets = new Map<string, number[]>();
function rateLimited(pluginId: string, now: number): boolean {
  const win = now - 1000;
  const arr = (rateBuckets.get(pluginId) ?? []).filter((t) => t > win);
  arr.push(now);
  rateBuckets.set(pluginId, arr);
  return arr.length > PLUGIN_RPC_RATE_LIMIT_PER_SEC;
}

/**
 * Register a method handler. Wired by features that own a host capability
 * — e.g. setupPluginRpcMethods() in the bridge bootstrap, called once
 * at app start. Replacing a handler logs a warning so duplicate wiring
 * is visible during development.
 */
export function registerRpcMethod(method: string, handler: RpcMethodHandler): void {
  if (methodHandlers.has(method)) {
    console.warn(`[pluginBridge] re-registering handler for ${method}`);
  }
  methodHandlers.set(method, handler);
}

/**
 * Mark an iframe + its pluginId as live. The bridge will forward broadcast
 * events to it and accept inbound RPC requests from its contentWindow.
 * Returns an unregister function — call it on unmount.
 */
export function registerPluginIframe(pluginId: string, iframe: HTMLIFrameElement): () => void {
  if (typeof window === 'undefined') return () => {};
  if (!listenerInstalled) installListener();
  const entry = { pluginId, iframe };
  registered.add(entry);
  return () => {
    registered.delete(entry);
  };
}

function installListener(): void {
  listenerInstalled = true;
  window.addEventListener('message', (e) => {
    void handleMessage(e);
  });
}

async function handleMessage(e: MessageEvent): Promise<void> {
  // Identify the calling iframe by source. Anything else is dropped —
  // host code talks to plugins through the helpers above, not via
  // window.postMessage, so this is the right filter.
  let caller: RegisteredIframe | null = null;
  for (const r of registered) {
    if (r.iframe.contentWindow === e.source) {
      caller = r;
      break;
    }
  }
  if (!caller) return;

  // Size cap — refuse oversized payloads before parsing further. JSON
  // length is a cheap upper bound on transmitted bytes.
  let serializedBytes = 0;
  try {
    serializedBytes = JSON.stringify(e.data).length;
  } catch {
    return;
  }
  if (serializedBytes > PLUGIN_RPC_MAX_MESSAGE_BYTES) {
    console.warn(`[pluginBridge] dropped oversized message from ${caller.pluginId}`);
    return;
  }

  const env = e.data as PluginRpcEnvelope;
  if (!env || typeof env !== 'object' || !('type' in env)) return;
  if (env.type !== 'e.rpc.request') return; // responses + events flow host→iframe only

  const respond = (result?: unknown, error?: string) => {
    caller!.iframe.contentWindow?.postMessage(
      { type: 'e.rpc.response', id: env.id, result, error },
      '*',
    );
  };

  // Rate cap — reject (with feedback) rather than silently drop so a
  // runaway plugin sees the error and can back off.
  if (rateLimited(caller.pluginId, Date.now())) {
    respond(undefined, 'Rate limit exceeded — slow down requests.');
    return;
  }

  const handler = methodHandlers.get(env.method);
  if (!handler) {
    respond(undefined, `Unknown method: ${env.method}`);
    return;
  }
  try {
    const result = await handler(caller.pluginId, env.params);
    respond(result);
  } catch (err) {
    respond(undefined, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Broadcast a host event to every live plugin iframe. Used by feature
 * code that bridges store state to plugins (active editor, workspace,
 * theme, etc.). Plugins opt in by listening for messages with
 * `type === 'e.rpc.event'`.
 */
export function broadcastEvent(event: PluginRpcEvent, data: unknown): void {
  for (const r of registered) {
    r.iframe.contentWindow?.postMessage({ type: 'e.rpc.event', event, data }, '*');
  }
}
