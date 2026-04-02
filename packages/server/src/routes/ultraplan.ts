import { Hono } from 'hono';
import { ultraPlanService } from '../services/ultraplan';

const app = new Hono();

// Start an ULTRAPLAN session
app.post('/start', async (c) => {
  const { prompt, workspacePath, prdId, config } = await c.req.json();
  const session = await ultraPlanService.startPlan(prompt, workspacePath || '.', prdId, config);
  return c.json({ ok: true, session });
});

// Approve a plan
app.post('/:id/approve', async (c) => {
  const { note } = await c.req.json().catch(() => ({ note: undefined }));
  const session = await ultraPlanService.approve(c.req.param('id'), note);
  if (!session) return c.json({ ok: false, error: 'Session not found or not completed' }, 404);
  return c.json({ ok: true, session });
});

// Reject a plan
app.post('/:id/reject', async (c) => {
  const { note } = await c.req.json().catch(() => ({ note: undefined }));
  const session = ultraPlanService.reject(c.req.param('id'), note);
  if (!session) return c.json({ ok: false, error: 'Session not found or not completed' }, 404);
  return c.json({ ok: true, session });
});

// Get session state
app.get('/:id', (c) => {
  const session = ultraPlanService.getSession(c.req.param('id'));
  if (!session) return c.json({ ok: false, error: 'Session not found' }, 404);
  return c.json({ ok: true, session });
});

// List all sessions
app.get('/', (c) => {
  return c.json({ ok: true, sessions: ultraPlanService.getAllSessions() });
});

// SSE stream for planning events
app.get('/:id/stream', (c) => {
  const id = c.req.param('id');
  const session = ultraPlanService.getSession(id);
  if (!session) return c.json({ ok: false, error: 'Session not found' }, 404);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const handler = (event: any) => {
        if (event.sessionId === id) send(event);
      };

      ultraPlanService.on('ultraplan_event', handler);
      c.req.raw.signal.addEventListener('abort', () => {
        ultraPlanService.off('ultraplan_event', handler);
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

export const ultraPlanRoutes = app;
