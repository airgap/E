import { Hono } from 'hono';
import { upgradeWebSocket } from '../ws';
import { sessionManager } from '../services/terminal-session-manager';
import { TERMINAL_PROTOCOL } from '@e/shared';
import type { TerminalCreateRequest } from '@e/shared';

const app = new Hono();

// --- REST Endpoints ---

/** List all active terminal sessions */
app.get('/sessions', (c) => {
  return c.json({ ok: true, data: sessionManager.list() });
});

/** Create a new terminal session */
app.post('/sessions', async (c) => {
  if (!sessionManager.available) {
    return c.json({ ok: false, error: 'Terminal unavailable: native pty module not loaded' }, 503);
  }

  const body = (await c.req.json().catch(() => ({}))) as TerminalCreateRequest;

  try {
    const result = sessionManager.create(body);
    return c.json({ ok: true, data: result }, 201);
  } catch (err) {
    return c.json({ ok: false, error: `Failed to create session: ${(err as Error).message}` }, 500);
  }
});

/** Get details of a specific session */
app.get('/sessions/:id', (c) => {
  const id = c.req.param('id');
  const sessions = sessionManager.list();
  const session = sessions.find((s) => s.id === id);
  if (!session) return c.json({ ok: false, error: 'Session not found' }, 404);
  return c.json({ ok: true, data: session });
});

/** Kill a specific session */
app.delete('/sessions/:id', (c) => {
  const id = c.req.param('id');
  const killed = sessionManager.kill(id);
  if (!killed) return c.json({ ok: false, error: 'Session not found' }, 404);
  return c.json({ ok: true });
});

/** Toggle session logging on/off */
app.post('/sessions/:id/logging', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
  const enabled = body.enabled !== false; // default to true

  if (enabled) {
    const result = sessionManager.startLogging(id);
    if (!result)
      return c.json({ ok: false, error: 'Session not found or log creation failed' }, 404);
    return c.json({ ok: true, data: { logging: true, logFilePath: result.logFilePath } });
  } else {
    const stopped = sessionManager.stopLogging(id);
    if (!stopped) return c.json({ ok: false, error: 'Session not found or not logging' }, 404);
    return c.json({ ok: true, data: { logging: false } });
  }
});

/** Get the log file path for a session */
app.get('/sessions/:id/log', (c) => {
  const id = c.req.param('id');
  const logFilePath = sessionManager.getLogFilePath(id);
  if (!logFilePath) return c.json({ ok: false, error: 'No log file for this session' }, 404);
  return c.json({ ok: true, data: { logFilePath } });
});

/** List available shells */
app.get('/shells', async (c) => {
  const shells = await sessionManager.detectShells();
  return c.json({ ok: true, data: shells });
});

// --- WebSocket Endpoint ---

/**
 * Attach to a terminal session via WebSocket.
 *
 * Query params:
 *   - sessionId: ID of an existing session to attach to
 *   - cwd: Working directory (only used if no sessionId — creates a legacy session)
 *   - cols: Initial columns (default 80)
 *   - rows: Initial rows (default 24)
 *   - storyId: Story ID — when provided, terminal CWD resolves to the story's worktree path
 *
 * Protocol:
 *   - Raw text: forwarded as PTY input
 *   - \x01cols,rows: resize command (backward-compatible)
 *   - \x02{json}: JSON control message
 *   - Server sends raw PTY output, plus \x02-prefixed JSON control messages
 */
app.get(
  '/ws',
  upgradeWebSocket((c) => {
    let sessionId = c.req.query('sessionId') || '';
    const cwd = c.req.query('cwd') || process.env.HOME || '/';
    const cols = parseInt(c.req.query('cols') || '80');
    const rows = parseInt(c.req.query('rows') || '24');
    const storyId = c.req.query('storyId') || undefined;

    return {
      onOpen(_evt, ws) {
        const rawWs = (ws as any).raw;

        if (!sessionManager.available) {
          rawWs.send('\r\n[Terminal unavailable: native pty module not loaded]\r\n');
          rawWs.close(1011, 'pty not available');
          return;
        }

        // If no sessionId provided, create a new session (backward-compatible with old client)
        if (!sessionId) {
          try {
            const result = sessionManager.create({ cwd, cols, rows, storyId });
            sessionId = result.sessionId;
          } catch (err) {
            rawWs.send(`\r\n[Failed to create terminal session: ${(err as Error).message}]\r\n`);
            rawWs.close(1011, 'Failed to create session');
            return;
          }
        }

        // Attach to the session
        const attached = sessionManager.attach(sessionId, rawWs);
        if (!attached) {
          rawWs.send(`\r\n[Session not found: ${sessionId}]\r\n`);
          rawWs.close(1011, 'Session not found');
          return;
        }
      },

      onMessage(evt, _ws) {
        if (!sessionId) return;

        const data =
          typeof evt.data === 'string'
            ? evt.data
            : new TextDecoder().decode(evt.data as ArrayBuffer);

        // Resize command: \x01cols,rows (backward-compatible)
        if (data.charCodeAt(0) === TERMINAL_PROTOCOL.RESIZE) {
          const parts = data.slice(1).split(',');
          if (parts.length === 2) {
            const newCols = parseInt(parts[0]);
            const newRows = parseInt(parts[1]);
            sessionManager.resize(sessionId, newCols, newRows);
          }
          return;
        }

        // JSON control message: \x02{json}
        if (data.charCodeAt(0) === TERMINAL_PROTOCOL.CONTROL) {
          // Future: handle client->server control messages
          return;
        }

        // Raw input: forward to PTY
        sessionManager.write(sessionId, data);
      },

      onClose(_evt, ws) {
        if (sessionId) {
          const rawWs = (ws as any).raw;
          sessionManager.detach(sessionId, rawWs);
        }
      },

      onError(_evt, ws) {
        if (sessionId) {
          const rawWs = (ws as any).raw;
          sessionManager.detach(sessionId, rawWs);
        }
      },
    };
  }),
);

export { app as terminalRoutes };
