/**
 * /api/claude-code — read-only access to Claude Code's per-workspace
 * conversation history. All endpoints are workspace-scoped and gated by
 * the same workspacePath param the rest of E uses; we never read outside
 * `~/.claude/projects/<encoded-workspace>/`.
 *
 * Off-by-default in the client (Settings → Claude Code history toggle) so
 * the integration is opt-in; the server endpoints themselves are always
 * available — they're just unauthenticated reads of files the user
 * already wrote on this machine, so no access-control story is needed
 * beyond the existing server auth.
 */
import { Hono } from 'hono';
import { listConversations, readConversation } from '../services/claude-code-history';

const app = new Hono();

/**
 * GET /api/claude-code/conversations?workspacePath=…
 * List CC conversations for a workspace, most-recently-updated first.
 */
app.get('/conversations', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath required' }, 400);
  }
  return c.json({ ok: true, data: listConversations(workspacePath) });
});

/**
 * GET /api/claude-code/conversations/:id?workspacePath=…
 * Fetch the full parsed conversation. 404 when not present.
 */
app.get('/conversations/:id', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath required' }, 400);
  }
  const id = c.req.param('id');
  const conv = readConversation(workspacePath, id);
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);
  return c.json({ ok: true, data: conv });
});

export { app as claudeCodeRoutes };
