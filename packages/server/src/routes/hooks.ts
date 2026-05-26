/**
 * /api/hooks/* — endpoints that bridge Claude Code's hook scripts to E.
 *
 * Today this covers PreToolUse approval for the inline edit-approval UX:
 *   - POST /api/hooks/pretooluse         (called by the hook script — blocks)
 *   - POST /api/hooks/pretooluse-respond (called by the UI — unblocks)
 *   - GET  /api/hooks/pending            (debugging / reconnect snapshot)
 */
import { Hono } from 'hono';
import {
  register as registerPreToolUse,
  resolveRequest as resolveRequestPreToolUse,
  listPending,
  type PreToolUseHookInput,
} from '../services/pretooluse-registry';
import { eventBridge } from '../services/event-bridge';
import { claudeManager } from '../services/claude-process';
import { HOOK_TOKEN } from '../services/hook-token';

export const hooksRoutes = new Hono();

hooksRoutes.post('/pretooluse', async (c) => {
  // Bearer-token check — only our own spawned hook script knows it.
  const auth = c.req.header('Authorization') ?? '';
  if (auth !== `Bearer ${HOOK_TOKEN}`) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: PreToolUseHookInput;
  try {
    body = (await c.req.json()) as PreToolUseHookInput;
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  const { entry, decision } = registerPreToolUse(body);

  // Emit a UI event on the matching workspace's event bridge so the chat /
  // editor surface can render the approval prompt with a diff preview. The
  // claudeSessionId on the entry lets the client filter to the right session.
  // We look up the workspacePath from the ClaudeSession map so the right
  // workspace's commentator + sidebar instance receives it.
  const wsPath = entry.claudeSessionId
    ? claudeManager.workspacePathForCliSessionId(entry.claudeSessionId)
    : null;
  if (wsPath) {
    eventBridge.emitRaw(
      wsPath,
      JSON.stringify({
        type: 'pre_tool_approval',
        requestId: entry.requestId,
        toolName: entry.toolName,
        toolInput: entry.toolInput,
        claudeSessionId: entry.claudeSessionId,
      }),
    );
  }

  // BLOCK here until the UI calls /pretooluse-respond and resolves the
  // request. The hook script is itself blocking on this HTTP response, so
  // Claude Code stays paused until we return.
  const output = await decision;
  return c.json(output);
});

hooksRoutes.post('/pretooluse-respond', async (c) => {
  let body: { requestId?: string; decision?: 'allow' | 'deny'; reason?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  if (!body.requestId || (body.decision !== 'allow' && body.decision !== 'deny')) {
    return c.json({ error: 'requestId and decision ("allow"|"deny") required' }, 400);
  }
  const ok = resolveRequestPreToolUse(body.requestId, body.decision, body.reason);
  return c.json({ ok });
});

hooksRoutes.get('/pending', (c) => {
  // Strip resolve fns before returning (functions aren't serialisable anyway).
  return c.json(listPending().map(({ resolve: _r, ...rest }) => rest));
});
