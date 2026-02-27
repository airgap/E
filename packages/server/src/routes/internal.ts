/**
 * Internal routes — used by MCP server subprocesses to communicate with E.
 *
 * Mounted OUTSIDE /api/* to bypass auth/CSRF middleware, since these endpoints
 * are only called by localhost MCP child processes, not by browser clients.
 */

import { Hono } from 'hono';
import { appendFileSync } from 'fs';
import { submitQuestion, waitForAnswer } from '../services/ask-user-bridge';

const log = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    appendFileSync('/tmp/e-ask-user-debug.log', line);
  } catch {}
};

const app = new Hono();

/**
 * POST /ask-user — MCP server submits a question, gets a token for long-polling.
 *
 * The manager already emitted the user_question_request SSE event when it saw
 * the tool_use block in the CLI stream (before the MCP call executes). The bridge's
 * prelink mechanism auto-links the CLI's block.id to this token so the user's
 * answer resolves the MCP server's long-poll.
 */
app.post('/ask-user', async (c) => {
  log('POST /ask-user received');
  try {
    const body = await c.req.json();
    const { questions } = body;
    log(`POST /ask-user questions: ${JSON.stringify(questions).slice(0, 200)}`);

    if (!questions || !Array.isArray(questions)) {
      return c.json({ error: 'Missing questions array' }, 400);
    }

    const token = submitQuestion(questions);
    log(`POST /ask-user token: ${token}`);

    // The manager emits user_question_request when it sees the tool_use in the
    // CLI stream (which happens BEFORE this POST). We don't emit here to avoid
    // duplicate dialogs. The bridge's prelink mechanism links block.id → token
    // so the user's answer resolves the MCP server's long-poll.

    return c.json({ token });
  } catch (err: any) {
    log(`POST /ask-user ERROR: ${err.message}`);
    console.error('[internal/ask-user] POST error:', err);
    return c.json({ error: err.message }, 500);
  }
});

/**
 * GET /ask-user/:token — MCP server long-polls until the user answers.
 * Returns { answers } when resolved, or 408 on timeout.
 */
app.get('/ask-user/:token', async (c) => {
  const token = c.req.param('token');
  log(`GET /ask-user/${token} — long-poll started`);
  try {
    const answers = await waitForAnswer(token);
    log(`GET /ask-user/${token} — answer received: ${JSON.stringify(answers).slice(0, 200)}`);
    return c.json({ answers });
  } catch (err: any) {
    log(`GET /ask-user/${token} — error: ${err.message}`);
    return c.json({ error: err.message }, 408);
  }
});

export { app as internalRoutes };
