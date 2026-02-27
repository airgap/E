/**
 * Task Runner API routes
 *
 * Provides discovery of workspace tasks from package.json scripts
 * and Makefile targets.
 */

import { Hono } from 'hono';
import { taskRunnerService } from '../services/task-runner';

const app = new Hono();

/**
 * GET /discover?workspacePath=...
 *
 * Discover all runnable tasks in the workspace. Returns package.json scripts
 * and Makefile targets. Results are cached and auto-refresh on file change.
 */
app.get('/discover', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query parameter is required' }, 400);
  }

  try {
    const result = taskRunnerService.discover(workspacePath);
    return c.json({ ok: true, data: result });
  } catch (err) {
    return c.json({ ok: false, error: `Failed to discover tasks: ${(err as Error).message}` }, 500);
  }
});

/**
 * POST /refresh?workspacePath=...
 *
 * Force-refresh the task cache for a workspace (e.g. after manually editing
 * package.json or Makefile outside the editor).
 */
app.post('/refresh', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query parameter is required' }, 400);
  }

  try {
    const result = taskRunnerService.refresh(workspacePath);
    return c.json({ ok: true, data: result });
  } catch (err) {
    return c.json({ ok: false, error: `Failed to refresh tasks: ${(err as Error).message}` }, 500);
  }
});

export { app as taskRunnerRoutes };
