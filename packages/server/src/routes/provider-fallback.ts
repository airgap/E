import { Hono } from 'hono';
import { providerFallback } from '../services/provider-fallback';

export const providerFallbackRoutes = new Hono();

// Get health of all providers
providerFallbackRoutes.get('/health', (c) => {
  return c.json({ ok: true, health: providerFallback.getAllHealth() });
});

// Get/set config
providerFallbackRoutes.get('/config', (c) => {
  return c.json({ ok: true, config: providerFallback.getConfig() });
});

providerFallbackRoutes.post('/config', async (c) => {
  const body = await c.req.json();
  providerFallback.setConfig(body);
  return c.json({ ok: true, config: providerFallback.getConfig() });
});
