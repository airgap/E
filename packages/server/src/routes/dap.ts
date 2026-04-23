import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { upgradeWebSocket } from '../ws';
import { listAdapters } from '../services/dap-adapter-registry';
import { dapManager } from '../services/dap-instance-manager';

const app = new Hono();

/** List available debug adapters (with availability flag). */
app.get('/adapters', (c) => {
  return c.json({ ok: true, data: listAdapters() });
});

/** Inspect running sessions — used by the UI status bar and by tests. */
app.get('/sessions', (c) => {
  return c.json({ ok: true, data: dapManager.getStats() });
});

/** Force-kill a session (used by the UI's Stop button as a fallback). */
app.delete('/sessions/:id', (c) => {
  const id = c.req.param('id');
  dapManager.stop(id);
  return c.json({ ok: true });
});

/**
 * WebSocket bridge: the client opens one socket per debug session.
 *
 * Query params:
 *   - adapter: adapter id ("python", "node", …)
 *   - cwd:     working directory for the adapter process
 *   - sessionId (optional): client-chosen id; otherwise generated
 *
 * After open, both directions forward DAP JSON payloads (no framing — the
 * adapter-side stdio reader already strips Content-Length headers and we
 * pack them back on when writing to adapter stdin).
 */
app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const adapterId = c.req.query('adapter') || '';
    const cwd = c.req.query('cwd') || process.cwd();
    const sessionId = c.req.query('sessionId') || nanoid(10);
    const clientId = nanoid(8);

    return {
      onOpen(_event, ws) {
        const client = {
          id: clientId,
          send: (data: string) => {
            try {
              ws.send(data);
            } catch {
              // Socket closed mid-send — next cleanup covers it.
            }
          },
        };

        const info = dapManager.start(sessionId, adapterId, cwd);
        if (!info) {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: `Cannot start debug adapter: ${adapterId}`,
            }),
          );
          ws.close(1008, 'adapter unavailable');
          return;
        }
        dapManager.attachClient(sessionId, client);
        ws.send(JSON.stringify({ type: 'ready', sessionId, adapter: info.adapter.id }));
      },

      onMessage(event, _ws) {
        const raw =
          typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);
        try {
          const msg = JSON.parse(raw);
          dapManager.sendToAdapter(sessionId, msg);
        } catch {
          // Malformed — ignore, since the adapter would also reject it.
        }
      },

      onClose() {
        dapManager.detachClient(sessionId);
        // We intentionally do NOT call stop() on close — a user may reload the
        // page during a run. The adapter's own exit (or an explicit DELETE)
        // tears the session down.
      },

      onError() {
        dapManager.detachClient(sessionId);
      },
    };
  }),
);

export { app as dapRoutes };
