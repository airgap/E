import { Hono } from 'hono';
import { kairosDaemon } from '../services/kairos-daemon';
import type { KairosConfig } from '@e/shared';

const app = new Hono();

// Start a KAIROS daemon
app.post('/start', async (c) => {
  const { golemId, workspacePath, config } = await c.req.json<{
    golemId: string;
    workspacePath: string;
    config?: Partial<KairosConfig>;
  }>();

  const state = kairosDaemon.start(golemId, workspacePath, config);
  return c.json({ ok: true, daemon: state });
});

// Stop a daemon
app.post('/:id/stop', (c) => {
  kairosDaemon.stop(c.req.param('id'));
  return c.json({ ok: true });
});

// Pause a daemon
app.post('/:id/pause', (c) => {
  kairosDaemon.pause(c.req.param('id'));
  return c.json({ ok: true });
});

// Resume a daemon
app.post('/:id/resume', (c) => {
  kairosDaemon.resume(c.req.param('id'));
  return c.json({ ok: true });
});

// Get daemon state
app.get('/:id', (c) => {
  const state = kairosDaemon.getState(c.req.param('id'));
  if (!state) return c.json({ ok: false, error: 'Daemon not found' }, 404);
  return c.json({ ok: true, daemon: state });
});

// List all daemons
app.get('/', (c) => {
  return c.json({ ok: true, daemons: kairosDaemon.getAllDaemons() });
});

// SSE stream for daemon events
app.get('/:id/stream', (c) => {
  const id = c.req.param('id');
  const state = kairosDaemon.getState(id);
  if (!state) return c.json({ ok: false, error: 'Daemon not found' }, 404);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const handler = (event: any) => {
        if (event.daemonId === id) send(event);
      };

      kairosDaemon.on('kairos_event', handler);

      // Cleanup when client disconnects
      c.req.raw.signal.addEventListener('abort', () => {
        kairosDaemon.off('kairos_event', handler);
        controller.close();
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

export const kairosRoutes = app;
