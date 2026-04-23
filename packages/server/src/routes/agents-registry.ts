import { Hono } from 'hono';
import { listAgents, getAgent } from '../services/agent-registry';

const app = new Hono();

/** List every installed agent, built-in and user-defined. */
app.get('/', (c) => {
  return c.json({ ok: true, data: listAgents() });
});

/** Single agent by handle. */
app.get('/:handle', (c) => {
  const a = getAgent(c.req.param('handle'));
  if (!a) return c.json({ ok: false, error: 'agent not found' }, 404);
  return c.json({ ok: true, data: a });
});

export { app as agentRegistryRoutes };
