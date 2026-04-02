/**
 * Browser Automation Routes
 */

import { Hono } from 'hono';
import { browserTool } from '../services/browser-tool';
import type { BrowserAction, BrowserConfig } from '@e/shared';

export const browserRoutes = new Hono();

// Create a new browser session
browserRoutes.post('/sessions', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const config = body.config as Partial<BrowserConfig> | undefined;
    const session = await browserTool.createSession(config);
    return c.json({ ok: true, session });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Execute an action in a session
browserRoutes.post('/sessions/:id/action', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const action = body as BrowserAction;
    const result = await browserTool.executeAction(id, action);
    return c.json({ ok: true, result });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Get session info
browserRoutes.get('/sessions/:id', (c) => {
  const id = c.req.param('id');
  const session = browserTool.getSession(id);
  if (!session) return c.json({ ok: false, error: 'Session not found' }, 404);
  return c.json({ ok: true, session });
});

// List all sessions
browserRoutes.get('/sessions', (c) => {
  const sessions = browserTool.listSessions();
  return c.json({ ok: true, sessions });
});

// Close a session
browserRoutes.post('/sessions/:id/close', async (c) => {
  try {
    const id = c.req.param('id');
    await browserTool.closeSession(id);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});
