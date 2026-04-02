import { Hono } from 'hono';
import { retryExecutor } from '../services/retry-executor';

export const retryRoutes = new Hono();

// Get all circuit breaker states
retryRoutes.get('/circuits', (c) => {
  return c.json({ ok: true, circuits: retryExecutor.getAllCircuits() });
});

// Get circuit state for a key
retryRoutes.get('/circuits/:key', (c) => {
  const key = c.req.param('key');
  const state = retryExecutor.getCircuitState(key);
  return c.json({ ok: true, state });
});

// Reset a circuit breaker
retryRoutes.post('/circuits/:key/reset', (c) => {
  const key = c.req.param('key');
  retryExecutor.resetCircuit(key);
  return c.json({ ok: true });
});

// Get/set config
retryRoutes.get('/config', (c) => {
  return c.json({ ok: true, config: retryExecutor.getConfig() });
});

retryRoutes.post('/config', async (c) => {
  const body = await c.req.json();
  retryExecutor.setConfig(body);
  return c.json({ ok: true, config: retryExecutor.getConfig() });
});
