import { Hono } from 'hono';
import { swarmCoordinator } from '../services/swarm-coordinator';
import type { SwarmGroupConfig } from '@e/shared';

const app = new Hono();

// Create a swarm group
app.post('/', async (c) => {
  const { name, workspacePath, tasks, config, loopId, storyId } = await c.req.json<{
    name: string;
    workspacePath: string;
    tasks: { title: string; description: string; dependsOn?: string[] }[];
    config?: Partial<SwarmGroupConfig>;
    loopId?: string;
    storyId?: string;
  }>();

  const group = swarmCoordinator.createGroup(name, workspacePath, tasks, config, {
    loopId,
    storyId,
  });
  return c.json({ ok: true, group });
});

// Execute a swarm group
app.post('/:id/execute', async (c) => {
  const id = c.req.param('id');
  // Run async — don't block the response
  swarmCoordinator.executeGroup(id).catch(() => {});
  return c.json({ ok: true, message: 'Execution started' });
});

// Cancel a swarm group
app.post('/:id/cancel', (c) => {
  swarmCoordinator.cancel(c.req.param('id'));
  return c.json({ ok: true });
});

// Get swarm group state
app.get('/:id', (c) => {
  const group = swarmCoordinator.getGroup(c.req.param('id'));
  if (!group) return c.json({ ok: false, error: 'Group not found' }, 404);
  return c.json({ ok: true, group });
});

// List all swarm groups
app.get('/', (c) => {
  return c.json({ ok: true, groups: swarmCoordinator.getAllGroups() });
});

// SSE stream for swarm events
app.get('/:id/stream', (c) => {
  const id = c.req.param('id');
  const group = swarmCoordinator.getGroup(id);
  if (!group) return c.json({ ok: false, error: 'Group not found' }, 404);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const handler = (event: any) => {
        if (event.groupId === id) send(event);
      };

      swarmCoordinator.on('swarm_event', handler);
      c.req.raw.signal.addEventListener('abort', () => {
        swarmCoordinator.off('swarm_event', handler);
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

export const swarmRoutes = app;
