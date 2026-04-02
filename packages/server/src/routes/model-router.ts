import { Hono } from 'hono';
import { modelRouter } from '../services/model-router';

export const modelRouterRoutes = new Hono();

// Analyze complexity and get model recommendation
modelRouterRoutes.post('/analyze', async (c) => {
  const body = await c.req.json();
  const signal = modelRouter.route(body.input, body.currentModel);
  return c.json({ ok: true, signal });
});

// Get routing stats
modelRouterRoutes.get('/stats', (c) => {
  return c.json({ ok: true, stats: modelRouter.getStats() });
});

// Get/set config
modelRouterRoutes.get('/config', (c) => {
  return c.json({ ok: true, config: modelRouter.getConfig() });
});

modelRouterRoutes.post('/config', async (c) => {
  const body = await c.req.json();
  modelRouter.setConfig(body);
  return c.json({ ok: true, config: modelRouter.getConfig() });
});
