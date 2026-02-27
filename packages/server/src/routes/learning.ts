/**
 * Learning / Pattern Detection Routes
 *
 * Placeholder for future learning features.
 */

import { Hono } from 'hono';

const app = new Hono();

// Placeholder - learning features to be implemented
app.get('/status', (c) => {
  return c.json({ ok: true, data: { enabled: false } });
});

export { app as learningRoutes };
