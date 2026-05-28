/**
 * Plugin host bridge (LYK-1030 / LYK-1056 foundation).
 *
 * Cross-cutting helpers for getting messages between the host renderer
 * and plugin iframes. v1 is host → iframe only (command invocation);
 * iframe → host (status bar updates, registry queries) lands with the
 * postMessage protocol work in LYK-1056.
 *
 * Why a window CustomEvent instead of a central registry: plugin iframes
 * are spread across several mount points (sandboxed modal, primary
 * editor tabs, future inline panels). Each mount point listens for the
 * single `e:plugin-command` event and forwards to its own iframe when
 * the pluginId matches. That keeps each surface in charge of its own
 * iframe lifecycle without a global "mounted iframes" Map that has to
 * be carefully cleaned up on unmount.
 */

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
