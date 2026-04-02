import { Hono } from 'hono';
import { autoDream } from '../services/auto-dream';
import { getDb } from '../db/database';

const app = new Hono();

// Get dream state
app.get('/state', (c) => {
  return c.json({ ok: true, state: autoDream.getState() });
});

// Trigger a dream cycle manually
app.post('/trigger', async (c) => {
  const result = await autoDream.triggerDream('manual');
  return c.json({ ok: true, result });
});

// Get dream logs
app.get('/logs', (c) => {
  try {
    const db = getDb();
    const logs = db
      .query(
        `
      SELECT * FROM dream_logs ORDER BY started_at DESC LIMIT 20
    `,
      )
      .all();
    return c.json({ ok: true, logs });
  } catch {
    return c.json({ ok: true, logs: [] });
  }
});

// SSE stream for dream events
app.get('/stream', (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const handler = (event: any) => send(event);
      autoDream.on('dream_event', handler);

      c.req.raw.signal.addEventListener('abort', () => {
        autoDream.off('dream_event', handler);
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

export const autoDreamRoutes = app;
