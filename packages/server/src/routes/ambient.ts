import { Hono } from 'hono';
import { ambientAgent } from '../services/ambient-agent';
import type { AmbientNotification } from '../services/ambient-agent';

const app = new Hono();

// POST /ambient/watch — start watching a workspace
app.post('/watch', async (c) => {
  let body: { workspacePath?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { workspacePath } = body;
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  try {
    ambientAgent.startWatching(workspacePath);
    return c.json({ ok: true, data: { watching: true, workspacePath } }, 201);
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// DELETE /ambient/watch?workspacePath=... — stop watching a workspace
app.delete('/watch', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query param is required' }, 400);
  }

  ambientAgent.stopWatching(workspacePath);
  return c.json({ ok: true, data: { watching: false, workspacePath } });
});

// GET /ambient/notifications?workspacePath=... — get pending notifications
app.get('/notifications', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query param is required' }, 400);
  }

  const notifications = ambientAgent.getNotifications(workspacePath);
  return c.json({ ok: true, data: notifications });
});

// DELETE /ambient/notifications/:id — dismiss a single notification
app.delete('/notifications/:id', (c) => {
  const id = c.req.param('id');
  ambientAgent.dismissNotification(id);
  return c.json({ ok: true });
});

// DELETE /ambient/notifications?workspacePath=... — clear all notifications for workspace
app.delete('/notifications', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query param is required' }, 400);
  }

  ambientAgent.clearNotifications(workspacePath);
  return c.json({ ok: true });
});

// GET /ambient/status?workspacePath=... — get watching status and notification count
app.get('/status', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query param is required' }, 400);
  }

  const watching = ambientAgent.isWatching(workspacePath);
  const notificationCount = ambientAgent.getNotifications(workspacePath).length;
  return c.json({ ok: true, data: { watching, notificationCount } });
});

// GET /ambient/stream?workspacePath=... — SSE stream for real-time notification events
app.get('/stream', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query param is required' }, 400);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const handler = (notif: AmbientNotification) => {
        if (notif.workspacePath === workspacePath) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(notif)}\n\n`));
          } catch {
            /* client disconnected */
          }
        }
      };

      ambientAgent.events.on('notification', handler);

      // Ping every 15 seconds to keep the connection alive
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`));
        } catch {
          clearInterval(pingInterval);
        }
      }, 15000);

      // Clean up on client disconnect
      c.req.raw.signal.addEventListener('abort', () => {
        ambientAgent.events.off('notification', handler);
        clearInterval(pingInterval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

export { app as ambientRoutes };
