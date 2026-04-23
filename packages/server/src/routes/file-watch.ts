import { Hono } from 'hono';
import { upgradeWebSocket } from '../ws';
import { fileWatcher, type FileChangeEvent } from '../services/file-watcher';

const app = new Hono();

/**
 * Set (or change) the root directory being watched.
 * Body: { rootPath: string }
 */
app.post('/watch', async (c) => {
  const body = await c.req.json<{ rootPath?: string }>();
  if (!body.rootPath) return c.json({ ok: false, error: 'rootPath required' }, 400);
  fileWatcher.watch(body.rootPath);
  return c.json({ ok: true, data: { root: fileWatcher.root } });
});

/** Report which directory is currently watched (null when not watching). */
app.get('/status', (c) => {
  return c.json({ ok: true, data: { root: fileWatcher.root } });
});

/**
 * Stream file change events over WebSocket.
 * Messages: { type: 'change'|'delete', path, mtime }
 */
app.get(
  '/ws',
  upgradeWebSocket(() => {
    let listener: ((ev: FileChangeEvent) => void) | null = null;
    return {
      onOpen(_event, ws) {
        listener = (ev: FileChangeEvent) => {
          try {
            ws.send(JSON.stringify(ev));
          } catch {
            // Socket likely closed mid-dispatch; cleanup happens in onClose.
          }
        };
        fileWatcher.on('event', listener);
        ws.send(JSON.stringify({ type: 'hello', root: fileWatcher.root }));
      },
      onClose() {
        if (listener) {
          fileWatcher.off('event', listener);
          listener = null;
        }
      },
    };
  }),
);

export { app as fileWatchRoutes };
