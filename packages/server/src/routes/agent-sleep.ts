/**
 * Agent Sleep / Self-Resume Routes
 */

import { Hono } from 'hono';
import { agentSleep } from '../services/agent-sleep';
import type { SleepState } from '@e/shared';

export const agentSleepRoutes = new Hono();

// Put an agent to sleep
agentSleepRoutes.post('/sleep', async (c) => {
  try {
    const body = await c.req.json();
    const checkpoint = agentSleep.sleep(
      body.agentId,
      JSON.stringify(body.state || {}),
      body.wakeCondition,
      body.workspacePath || '.',
      body.conversationId,
      body.reason,
    );
    return c.json({ ok: true, checkpoint });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Wake an agent
agentSleepRoutes.post('/:id/wake', (c) => {
  const id = c.req.param('id');
  const checkpoint = agentSleep.wake(id);
  if (!checkpoint) return c.json({ ok: false, error: 'Checkpoint not found' }, 404);
  return c.json({ ok: true, checkpoint });
});

// Cancel a sleeping agent
agentSleepRoutes.post('/:id/cancel', (c) => {
  const id = c.req.param('id');
  agentSleep.cancel(id);
  return c.json({ ok: true });
});

// Get a checkpoint
agentSleepRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const checkpoint = agentSleep.get(id);
  if (!checkpoint) return c.json({ ok: false, error: 'Checkpoint not found' }, 404);
  return c.json({ ok: true, checkpoint });
});

// List checkpoints
agentSleepRoutes.get('/', (c) => {
  const state = c.req.query('state') as SleepState | undefined;
  const checkpoints = agentSleep.list(state);
  return c.json({ ok: true, checkpoints });
});
