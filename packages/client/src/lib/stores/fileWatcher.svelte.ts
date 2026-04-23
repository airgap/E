import { getDirectWsBase } from '$lib/api/client';
import { editorStore } from './editor.svelte';

interface WatchEvent {
  type: 'change' | 'delete' | 'hello';
  path?: string;
  mtime?: number;
  root?: string;
}

function createFileWatcherStore() {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 1000;
  let stopped = false;
  let connected = $state(false);

  function scheduleReconnect() {
    if (stopped) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    // Capped exponential backoff — 1s, 2s, 4s, max 30s
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      const url = `${getDirectWsBase()}/file-watch/ws`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        connected = true;
        reconnectDelay = 1000;
      };

      ws.onmessage = (event) => {
        try {
          const msg: WatchEvent = JSON.parse(String(event.data));
          if (msg.type === 'change' && msg.path) {
            // Only reload if the path is actually open — the editor store
            // does the dirty-buffer reconcile internally.
            const isOpen = editorStore.tabs.some((t) => t.filePath === msg.path);
            if (isOpen) void editorStore.refreshFile(msg.path);
          }
          // 'delete' and 'hello' are currently informational — the editor
          // keeps deleted files open until the user explicitly closes them.
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        connected = false;
        ws = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire right after; reconnect is handled there.
      };
    } catch {
      scheduleReconnect();
    }
  }

  return {
    get connected() {
      return connected;
    },

    /** Start the watcher connection. Idempotent. */
    start() {
      stopped = false;
      connect();
    },

    /** Stop and close the watcher connection. */
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      connected = false;
    },

    /**
     * Ask the server to watch a specific workspace root.
     * Called when the workspace changes.
     */
    async watch(rootPath: string): Promise<void> {
      const { api } = await import('$lib/api/client');
      await api.fileWatch.watch(rootPath);
    },
  };
}

export const fileWatcherStore = createFileWatcherStore();
