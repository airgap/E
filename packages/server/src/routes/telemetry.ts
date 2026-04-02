/**
 * Telemetry Routes
 */

import { Hono } from 'hono';
import { telemetry } from '../services/telemetry';

export const telemetryRoutes = new Hono();

// Get telemetry config
telemetryRoutes.get('/config', (c) => {
  return c.json({ ok: true, config: telemetry.getConfig() });
});

// Update telemetry config
telemetryRoutes.post('/config', async (c) => {
  const body = await c.req.json();
  telemetry.setConfig(body);
  return c.json({ ok: true, config: telemetry.getConfig() });
});

// Get events
telemetryRoutes.get('/events', (c) => {
  const since = c.req.query('since') ? Number(c.req.query('since')) : undefined;
  const until = c.req.query('until') ? Number(c.req.query('until')) : undefined;
  const type = c.req.query('type') as any;
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 100;
  const events = telemetry.getEvents(since, until, type, limit);
  return c.json({ ok: true, events });
});

// Get daily summary
telemetryRoutes.get('/summary/:date', (c) => {
  const date = c.req.param('date');
  const summary = telemetry.getDailySummary(date);
  return c.json({ ok: true, summary });
});

// Track an event manually
telemetryRoutes.post('/track', async (c) => {
  const body = await c.req.json();
  telemetry.track(body.type, body.data || {});
  return c.json({ ok: true });
});

// Prune old events
telemetryRoutes.post('/prune', (c) => {
  const pruned = telemetry.prune();
  return c.json({ ok: true, pruned });
});
