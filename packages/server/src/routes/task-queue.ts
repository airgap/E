import { Hono } from 'hono';
import { taskQueue } from '../services/task-queue';
import type { TaskQueuePriority } from '@e/shared';

export const taskQueueRoutes = new Hono();

// Enqueue a task
taskQueueRoutes.post('/enqueue', async (c) => {
  try {
    const body = await c.req.json();
    const task = taskQueue.enqueue(
      body.name,
      body.payload || {},
      (body.priority || 'normal') as TaskQueuePriority,
      {
        timeoutMs: body.timeoutMs,
        maxRetries: body.maxRetries,
        groupId: body.groupId,
        source: body.source,
      },
    );
    return c.json({ ok: true, task });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Cancel a task
taskQueueRoutes.post('/:id/cancel', (c) => {
  const id = c.req.param('id');
  const cancelled = taskQueue.cancel(id);
  return c.json({ ok: true, cancelled });
});

// Get a task
taskQueueRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const task = taskQueue.getTask(id);
  if (!task) return c.json({ ok: false, error: 'Task not found' }, 404);
  return c.json({ ok: true, task });
});

// List all tasks
taskQueueRoutes.get('/', (c) => {
  return c.json({ ok: true, tasks: taskQueue.getAllTasks() });
});

// Get queue stats
taskQueueRoutes.get('/stats/summary', (c) => {
  return c.json({ ok: true, stats: taskQueue.getStats() });
});

// Get/set config
taskQueueRoutes.get('/config/current', (c) => {
  return c.json({ ok: true, config: taskQueue.getConfig() });
});

taskQueueRoutes.post('/config', async (c) => {
  const body = await c.req.json();
  taskQueue.setConfig(body);
  return c.json({ ok: true, config: taskQueue.getConfig() });
});
