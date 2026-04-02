/**
 * Prompt Cache Routes
 */

import { Hono } from 'hono';
import { promptCache } from '../services/prompt-cache';

export const promptCacheRoutes = new Hono();

// Get aggregate cache stats
promptCacheRoutes.get('/stats', (c) => {
  const stats = promptCache.getAggregateStats();
  return c.json({ ok: true, stats });
});

// Get cache stats for a specific conversation
promptCacheRoutes.get('/stats/:conversationId', (c) => {
  const conversationId = c.req.param('conversationId');
  const stats = promptCache.getStats(conversationId);
  if (!stats) return c.json({ ok: false, error: 'No stats found' }, 404);
  return c.json({ ok: true, stats });
});

// Get current config
promptCacheRoutes.get('/config', (c) => {
  return c.json({ ok: true, config: promptCache.getConfig() });
});

// Update config
promptCacheRoutes.post('/config', async (c) => {
  const body = await c.req.json();
  promptCache.setConfig(body);
  return c.json({ ok: true, config: promptCache.getConfig() });
});
