import { Hono } from 'hono';
import { undercoverService } from '../services/undercover';

const app = new Hono();

// Check workspace and get undercover state
app.get('/status', (c) => {
  const workspacePath = c.req.query('workspace') || '.';
  const state = undercoverService.check(workspacePath);
  return c.json({ ok: true, state });
});

// Manually activate undercover mode
app.post('/activate', async (c) => {
  const { workspacePath } = await c.req.json<{ workspacePath: string }>();
  const state = undercoverService.activate(workspacePath);
  return c.json({ ok: true, state });
});

// Deactivate undercover mode
app.post('/deactivate', async (c) => {
  const { workspacePath } = await c.req.json<{ workspacePath: string }>();
  const state = undercoverService.deactivate(workspacePath);
  return c.json({ ok: true, state });
});

// Scrub text
app.post('/scrub', async (c) => {
  const { workspacePath, text } = await c.req.json<{ workspacePath: string; text: string }>();
  const scrubbed = undercoverService.scrub(workspacePath, text);
  return c.json({ ok: true, scrubbed });
});

// Check commit message for internal refs
app.post('/check-commit', async (c) => {
  const { workspacePath, message } = await c.req.json<{ workspacePath: string; message: string }>();
  const warning = undercoverService.checkCommitMessage(workspacePath, message);
  return c.json({ ok: true, warning, clean: !warning });
});

// Check PR content
app.post('/check-pr', async (c) => {
  const { workspacePath, title, body } = await c.req.json<{
    workspacePath: string;
    title: string;
    body: string;
  }>();
  const warning = undercoverService.checkPRContent(workspacePath, title, body);
  return c.json({ ok: true, warning, clean: !warning });
});

// Dismiss a warning
app.post('/dismiss-warning', async (c) => {
  const { workspacePath, warningId } = await c.req.json<{
    workspacePath: string;
    warningId: string;
  }>();
  undercoverService.dismissWarning(workspacePath, warningId);
  return c.json({ ok: true });
});

// Update config
app.post('/config', async (c) => {
  const config = await c.req.json();
  undercoverService.setConfig(config);
  return c.json({ ok: true });
});

export const undercoverRoutes = app;
