import { Hono } from 'hono';
import { contextSelection } from '../services/context-selection';

export const contextSelectionRoutes = new Hono();

// Select relevant context for a query
contextSelectionRoutes.post('/select', async (c) => {
  const body = await c.req.json();
  const result = contextSelection.selectContext(
    body.query,
    body.workspacePath || '.',
    body.recentFiles || [],
    body.errorFiles || [],
    body.mentionedFiles || [],
  );
  return c.json({ ok: true, result });
});

// Get/set config
contextSelectionRoutes.get('/config', (c) => {
  return c.json({ ok: true, config: contextSelection.getConfig() });
});

contextSelectionRoutes.post('/config', async (c) => {
  const body = await c.req.json();
  contextSelection.setConfig(body);
  return c.json({ ok: true, config: contextSelection.getConfig() });
});
